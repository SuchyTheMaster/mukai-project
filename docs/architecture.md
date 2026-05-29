# Architektura

## Widok ogólny

Aplikacja działa w Dockerze i składa się z interfejsu webowego, backendu API, kolejki zadań, workerów AI używających GPU, magazynu artefaktów, eksportera paczek karaoke oraz eksportera/importera projektu. Może być uruchomiona lokalnie albo wystawiona w sieci. Nie ma kont użytkowników, logowania, autoryzacji ani podziału uprawnień; zakładany jest jeden operator aplikacji. Ewentualne zabezpieczenia sieciowe są poza zakresem MVP i mogą zostać zaprojektowane później.

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
- Uzupełnia pola tytułu, artysty i innych metadanych z tagów pliku audio, jeśli są dostępne.
- Pozwala wybrać szybki albo dokładniejszy model separacji.
- Pozwala wybrać szybki albo dokładniejszy model transkrypcji.
- Pozwala opcjonalnie wskazać język utworu.
- Pozwala wczytać ZIP projektu utworzony przez opcję `Wyeksportuj projekt` i kontynuować pracę nad utworem.
- Pokazuje status zadania i błędy.
- Udostępnia edytor tekstu, sylab, fraz, nut i timingów.
- Pozwala odsłuchać oryginał, wokal i instrumental.
- Uruchamia eksport jednej lub wielu paczek karaoke ZIP po zatwierdzeniu wersji finalnej.
- Udostępnia osobną akcję `Wyeksportuj projekt`, która pakuje pełny `Job` do ZIP-a projektu.
- Stosuje design system RetroWave opisany w [UI.md](UI.md) dla kolorów, typografii, komponentów i stanów.

### Backend API

- Waliduje upload i metadane.
- Tworzy `Job`.
- Obsługuje import projektu z ZIP-a projektu.
- Obsługuje eksport projektu jako ZIP zawierający pełny `Job`, artefakty, oryginalny plik i manifesty JSON potrzebne do odtworzenia stanu.
- Udostępnia statusy, artefakty i zapis edycji.
- Zabezpiecza ścieżki plików przed dostępem poza katalogiem roboczym aplikacji.
- Nie wykonuje ciężkich obliczeń synchronicznie w żądaniu HTTP.
- Nie implementuje logowania ani autoryzacji użytkowników w MVP, także przy wystawieniu aplikacji w sieci.

### Kolejka i orkiestracja

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

- Przechowuje oryginalny plik, znormalizowane audio, stems, transkrypcję, pitch frames, nuty, wersje edycji i eksporty.
- Każdy artefakt ma typ, hash, czas utworzenia i parametry procesu.
- Pliki audio użytkownika nie powinny trafiać do repozytorium.
- Po pomyślnym eksporcie projektu usuwa lokalny rekord `Job`, oryginalny plik oraz wszystkie artefakty tego zadania. ZIP projektu jest wtedy jedyną kopią potrzebną do późniejszego importu.
- Zwykły eksport paczek karaoke nie usuwa automatycznie `Job` ani artefaktów.

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
- `completed`
- `failed`
- `cancelled`

## Założenia niefunkcjonalne

- Czas przetwarzania jest akceptowalny jako proces asynchroniczny.
- Wynik AI zawsze wymaga możliwości ręcznej korekty.
- Każda wersja wyniku musi być odtwarzalna z zapisanych parametrów.
- GPU jest zasobem limitowanym, więc zadania powinny być kolejkowane.
- Tryb CPU jest awaryjny i może być wyłączony dla dużych modeli.
- Aplikacja nie korzysta z zewnętrznych API; modele i narzędzia działają lokalnie.
