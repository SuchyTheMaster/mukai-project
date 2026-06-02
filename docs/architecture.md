# Architektura

## Widok ogólny

Aplikacja działa w Dockerze i składa się z interfejsu webowego React, backendu API w Pythonie/FastAPI, kolejki zadań Redis, bazy Postgres, workerów AI używających GPU, magazynu artefaktów na wolumenie Docker poza repozytorium, eksportera paczek karaoke oraz eksportera/importera projektu. Może być uruchomiona lokalnie albo wystawiona w sieci. Nie ma kont użytkowników, logowania, autoryzacji ani podziału uprawnień; zakładany jest jeden operator aplikacji. Przy wystawieniu w sieci MVP nadal nie dodaje auth, dlatego upload ma limit 500 MB oraz walidację rozszerzenia, MIME i `ffprobe`.

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
- Pokazuje osadzony cover z tagów tak samo jak cover wybrany z dysku i pozwala zastąpić go ręcznie wskazanym plikiem.
- Pozwala wybrać szybki albo dokładniejszy model separacji.
- Pozwala wybrać szybki albo dokładniejszy model transkrypcji.
- Pozwala opcjonalnie wskazać język utworu.
- Pozwala wczytać ZIP projektu utworzony przez opcję `Wyeksportuj projekt` i kontynuować pracę nad utworem.
- Pokazuje status zadania i błędy.
- Udostępnia edytor tekstu, sylab, fraz, nut i timingów.
- Pozwala odsłuchać oryginał, wokal i instrumental.
- Uruchamia eksport jednej lub wielu paczek karaoke ZIP po zatwierdzeniu aktualnego stanu edycji.
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
- Obsługuje import projektu z ZIP-a projektu.
- Obsługuje eksport projektu jako ZIP zawierający pełny `Job`, artefakty, oryginalny plik i manifesty JSON potrzebne do odtworzenia stanu.
- Udostępnia statusy, artefakty i zapis edycji.
- Zabezpiecza ścieżki plików przed dostępem poza katalogiem roboczym aplikacji.
- Nie wykonuje ciężkich obliczeń synchronicznie w żądaniu HTTP.
- Nie implementuje logowania ani autoryzacji użytkowników w MVP, także przy wystawieniu aplikacji w sieci.

Minimalne API MVP:

- `POST /api/uploads/inspect`: preflight wybranego pliku audio, odczyt tagów, technicznych danych audio i osadzonego covera bez tworzenia `Job`.
- `POST /api/jobs/uploads`: utworzenie `Job` z `uploadDraftId`, zaakceptowanych metadanych, covera i profili modeli.
- `POST /api/projects/import`: import ZIP-a projektu.
- `GET /api/jobs/{jobId}`: status, metadane, błędy i aktualny etap pipeline'u.
- `GET /api/jobs/{jobId}/artifacts/{assetId}`: pobranie albo streaming dozwolonego artefaktu audio.
- `PUT /api/jobs/{jobId}/arrangement`: zapis aktualnego `Arrangement`.
- `POST /api/jobs/{jobId}/exports/validate`: walidacja przed eksportem.
- `POST /api/jobs/{jobId}/exports/karaoke`: eksport jednej albo wielu paczek karaoke; po sukcesie `Job` wraca do `awaiting_review`.
- `POST /api/jobs/{jobId}/exports/project`: eksport ZIP-a projektu, ustawienie TTL retencji i powrót `Job` do `awaiting_review`.

### Kolejka i orkiestracja

- Używa Redis jako kolejki i mechanizmu koordynacji workerów.
- Zapewnia pojedynczy punkt kontroli dla zadań GPU.
- Pozwala wznowić zadanie od ostatniego poprawnego artefaktu.
- Przechowuje parametry modeli użyte dla danego wyniku.
- Odróżnia błędy użytkownika od błędów infrastruktury.

### Workery AI

- Worker separacji: Demucs.
- Worker ASR: WhisperX.
- Worker pitch detection: torchcrepe.
- Worker alignacji: łączy tekst, słowa, nuty i frazy.
- Worker eksportu karaoke: generuje ZIP-y dla wybranych wariantów i odtwarzaczy, bez danych projektu w paczkach karaoke.
- Worker eksportu projektu: generuje ZIP projektu zawierający pełny `Job`, wszystkie wymagane artefakty, oryginalny plik i manifesty JSON.
- Worker importu projektu: odtwarza `Job` i artefakty z ZIP-a projektu bez ponownego uruchamiania normalizacji, BPM, separacji, transkrypcji, alignacji ani pitch detection.

### Magazyn artefaktów

- Przechowuje oryginalny plik, znormalizowane audio, stems, transkrypcję, pitch frames, nuty, eksporty i snapshoty wymagane przez ZIP projektu.
- Każdy artefakt ma typ, hash, czas utworzenia i parametry procesu.
- Pliki audio użytkownika nie powinny trafiać do repozytorium.
- Po pomyślnym eksporcie projektu ustawia `cleanupEligibleAt` na 24 godziny po eksporcie. Lokalny rekord `Job`, oryginalny plik i artefakty mogą zostać usunięte dopiero po upływie tego TTL.
- Zwykły eksport paczek karaoke nie usuwa automatycznie `Job` ani artefaktów.

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

`exporting` i `exporting_project` są statusami przejściowymi. Po udanym eksporcie paczek karaoke albo ZIP-a projektu `Job` wraca do `awaiting_review`; eksport projektu dodatkowo ustawia pola retencji. `completed` jest zarezerwowany na przyszłe przepływy i nie jest ustawiany po zwykłym eksporcie w MVP.

## Założenia niefunkcjonalne

- Czas przetwarzania jest akceptowalny jako proces asynchroniczny.
- Wynik AI zawsze wymaga możliwości ręcznej korekty.
- Aktualny wynik i każdy zapisany artefakt muszą być odtwarzalne z zapisanych parametrów.
- GPU jest zasobem limitowanym, więc zadania powinny być kolejkowane.
- Tryb CPU jest awaryjny i może być wyłączony dla dużych modeli.
- Aplikacja nie korzysta z zewnętrznych API; modele i narzędzia działają lokalnie.
