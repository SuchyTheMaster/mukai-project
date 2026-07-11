# Architektura

## Widok ogólny

Aplikacja działa w Dockerze i składa się z interfejsu webowego React, backendu API w Pythonie/FastAPI, kolejki zadań Redis, bazy Postgres, workerów AI używających GPU, magazynu artefaktów na wolumenie Docker poza repozytorium, eksportera karaoke oraz eksportera/importera projektu. Może być uruchomiona lokalnie albo wystawiona w sieci. Nie ma kont użytkowników, logowania, autoryzacji ani podziału uprawnień; zakładany jest jeden operator aplikacji. Przy wystawieniu w sieci MVP nadal nie dodaje auth, dlatego upload ma limit 500 MB oraz walidację rozszerzenia, MIME i `ffprobe`.

Każde przetwarzanie utworu jest reprezentowane jako `Job`, który przechodzi przez jawne statusy i zapisuje pośrednie artefakty.

```text
Upload UI
  -> API
  -> Job Queue
  -> Audio Preprocessor
  -> BPM Detector
  -> Demucs Worker
  -> WhisperX Worker
  -> Pitch Worker
  -> Alignment/Segmentation Worker
  -> Review Editor
  -> Karaoke Package Exporter / Project Exporter

Project ZIP Import
  -> API
  -> Artifact Restore
  -> Review Editor
```

## Komponenty

### Frontend

- Przyjmuje plik audio i metadane utworu.
- Po wyborze pliku audio wysyła go do inspekcji uploadu i uzupełnia pola tytułu, artysty i innych metadanych z tagów, jeśli są dostępne.
- Pokazuje dane techniczne z preflightu: format/kontener, kodek, kanały, częstotliwość próbkowania i czas trwania.
- Pokazuje osadzony cover z tagów tak samo jak cover wybrany z dysku, pozwala zastąpić go ręcznie wskazanym plikiem i przywrócić domyślny cover z tagów.
- Domyślnie wybiera dokładniejsze modele `htdemucs_ft` i `large-v3`, a szybsze profile zostawia jako ręczny wybór użytkownika.
- Pozwala opcjonalnie wskazać język utworu.
- Pozwala wczytać ZIP projektu utworzony przez opcję `Wyeksportuj projekt` i kontynuować pracę nad utworem.
- Pokazuje cały stage rail z etapami wykonanymi, przetwarzanymi, oczekującymi i błędnymi.
- Pokazuje postęp, ETA albo stan indeterminate dla czasochłonnych etapów.
- Pokazuje błędy jako krótki komunikat oraz kompaktowy rozwijany log diagnostyczny.
- Udostępnia pobieranie artefaktów obok zakończonych podetapów.
- Udostępnia reset aktualnego etapu, jeśli backend pozwala przeliczyć pracę od tego miejsca.
- Udostępnia edytor tekstu, sylab, fraz, nut i timingów.
- Pozwala odsłuchać oryginał, wokal i instrumental.
- Uruchamia eksport jednej paczki karaoke ZIP po zatwierdzeniu aktualnego stanu edycji.
- Udostępnia osobną akcję `Wyeksportuj projekt`, która pakuje pełny `Job` do ZIP-a projektu.
- Stosuje design system RetroWave opisany w [UI.md](UI.md) dla kolorów, typografii, komponentów i stanów.

### Backend API

- Jest aplikacją Python/FastAPI.
- Waliduje upload i metadane.
- Udostępnia preflight uploadu, który odczytuje tagi audio i osadzony cover bez tworzenia `Job`.
- Odrzuca upload większy niż 500 MB.
- Waliduje rozszerzenie, MIME oraz wynik `ffprobe`, żeby przyjmować tylko faktyczne pliki audio albo kontenery z obsługiwaną ścieżką audio.
- Odczytuje tagi audio biblioteką metadanych, np. Mutagen; `ffprobe` pozostaje walidacją techniczną ścieżki audio i źródłem danych technicznych.
- Tworzy `Job`.
- W docelowym MVP obsługuje import projektu z ZIP-a projektu.
- W docelowym MVP obsługuje eksport projektu jako ZIP zawierający pełny `Job`, artefakty, oryginalny plik i manifesty JSON potrzebne do odtworzenia stanu.
- Udostępnia statusy, artefakty i zapis edycji.
- Zabezpiecza ścieżki plików przed dostępem poza katalogiem roboczym aplikacji.
- Nie wykonuje ciężkich obliczeń synchronicznie w żądaniu HTTP.
- Nie implementuje logowania ani autoryzacji użytkowników w MVP, także przy wystawieniu aplikacji w sieci.

Minimalne API MVP obejmuje endpointy już zaimplementowane oraz endpointy planowane dla etapów eksportu/importu.

Obecnie zaimplementowane:

- `GET /api/health`: podstawowy healthcheck API, Postgresa i Redisa.
- `POST /api/uploads/inspect`: preflight wybranego pliku audio, odczyt tagów, technicznych danych audio i osadzonego covera bez tworzenia `Job`.
- `GET /api/uploads/drafts/{draftId}/cover`: podgląd osadzonego covera wykrytego podczas preflightu.
- `POST /api/jobs/uploads`: utworzenie `Job` z `uploadDraftId`, zaakceptowanych metadanych, covera i profili modeli.
- `GET /api/jobs/{jobId}`: status, metadane, błędy i aktualny etap pipeline'u.
- `GET /api/jobs/{jobId}/arrangement`: pobranie aktualnego `Arrangement`.
- `PUT /api/jobs/{jobId}/arrangement`: zapis aktualnego `Arrangement`.
- `POST /api/jobs/{jobId}/arrangement/resegment`: ponowna agregacja aligned words do sentencji z nowym `sentenceGapMs`, bez uruchamiania przetwarzania audio.
- `GET /api/jobs/{jobId}/artifacts/{assetId}`: pobranie albo streaming dozwolonego artefaktu.
- `POST /api/jobs/{jobId}/stages/{stage}/reset`: reset wskazanego etapu i ponowne kolejkowanie zależnych etapów.
- `POST /api/reset`: idempotentne usunięcie wskazanego joba, aktywnego draftu uploadu, rekordów zależnych i wszystkich plików bieżącego projektu.

Planowane, ale wymagane w MVP:

- `POST /api/projects/import`: import ZIP-a projektu.
- `POST /api/jobs/{jobId}/exports/validate`: walidacja przed eksportem.
- `POST /api/jobs/{jobId}/exports/karaoke`: eksport jednej paczki karaoke; po sukcesie `Job` wraca do `awaiting_review`.
- `POST /api/jobs/{jobId}/exports/project`: eksport ZIP-a projektu, ustawienie TTL retencji i powrót `Job` do `awaiting_review`.

### Kolejka i orkiestracja

- Używa Redis jako kolejki i mechanizmu koordynacji workerów.
- Zapewnia pojedynczy punkt kontroli dla zadań GPU i ograniczeń współbieżności.
- Pozwala wznowić zadanie od ostatniego poprawnego artefaktu.
- Przechowuje parametry modeli użyte dla danego wyniku.
- Odróżnia błędy użytkownika od błędów infrastruktury.
- Rozdziela ciężkie operacje na osobne role workerów w Dockerze, żeby separacja, transkrypcja i pitch detection mogły mieć własne zależności, logi i limity zasobów.
- Lekkie etapy, takie jak publikacja zdarzeń, normalizacja, przygotowanie wejść i koordynacja, mogą pozostać w workerze orkiestrującym.

### Workery AI

- `worker-separate-stems`: separacja wokalu i instrumentalnego podkładu przez Demucs.
- `worker-transcribe`: transkrypcja i forced alignment tekstu przez WhisperX.
- `worker-pitch`: pitch detection i segmentacja nut przez torchcrepe.
- `worker-aligner`: łączenie tekstu, słów, nut i fraz w szkic karaoke.
- Worker eksportu karaoke: generuje jeden ZIP zgodny z aktualnymi wersjami wspieranych odtwarzaczy, bez danych projektu w paczce karaoke.
- Worker eksportu projektu: generuje ZIP projektu zawierający pełny `Job`, wszystkie wymagane artefakty, oryginalny plik i manifesty JSON.
- Worker importu projektu: odtwarza `Job` i artefakty z ZIP-a projektu bez ponownego uruchamiania normalizacji, BPM, separacji, transkrypcji, alignacji ani pitch detection.

### Magazyn artefaktów

- Przechowuje oryginalny plik, znormalizowane audio, stems, transkrypcję, pitch frames, nuty, eksporty i snapshoty wymagane przez ZIP projektu.
- Każdy artefakt ma typ, hash, czas utworzenia i parametry procesu.
- Pliki audio użytkownika nie powinny trafiać do repozytorium.
- Po pomyślnym eksporcie projektu ustawia `cleanupEligibleAt` na 24 godziny po eksporcie. Lokalny rekord `Job`, oryginalny plik i artefakty mogą zostać usunięte dopiero po upływie tego TTL.
- Zwykły eksport karaoke nie usuwa automatycznie `Job` ani artefaktów.

### Warstwa trwałości

- Postgres przechowuje rekordy `Job`, metadane, statusy, wybory eksportu, diagnostykę etapów i aktualny `Arrangement`.
- Redis przechowuje kolejkę zadań i krótkotrwałe blokady koordynujące workery GPU.
- Wolumen Docker poza repozytorium przechowuje pliki audio, artefakty workerów, ZIP-y eksportu, manifesty projektu, modele i cache modeli.

## Statusy zadania

- `uploaded`
- `preprocessing`
- `detecting_bpm`
- `separating_vocals`
- `transcribing`
- `detecting_pitch`
- `aligning`
- `awaiting_review`
- `exporting`
- `exporting_project`
- `importing_project`
- `completed` (poza normalnym flow MVP)
- `failed`
- `cancelled`

`exporting`, `exporting_project` i `importing_project` istnieją w kontraktach jako statusy przepływów eksportu/importu wymaganych w MVP. W obecnej implementacji endpointy eksportu i importu nie są jeszcze dostępne. Po ich wdrożeniu udany eksport karaoke albo ZIP-a projektu ma przywracać `Job` do `awaiting_review`; eksport projektu dodatkowo ustawia pola retencji. `completed` jest zarezerwowany na przyszłe przepływy i nie jest ustawiany po zwykłym eksporcie w MVP.

## Założenia niefunkcjonalne

- Czas przetwarzania jest akceptowalny jako proces asynchroniczny.
- Wynik AI zawsze wymaga możliwości ręcznej korekty.
- Aktualny wynik i każdy zapisany artefakt muszą być odtwarzalne z zapisanych parametrów.
- GPU jest zasobem limitowanym, więc zadania powinny być kolejkowane.
- Tryb CPU jest awaryjny i może być wyłączony dla dużych modeli.
- Aplikacja nie korzysta z zewnętrznych API; modele i narzędzia działają lokalnie.
