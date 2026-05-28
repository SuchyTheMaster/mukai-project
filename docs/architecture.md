# Architektura

## Widok ogólny

Aplikacja działa w Dockerze i składa się z interfejsu webowego, backendu API, kolejki zadań, workerów AI używających GPU, magazynu artefaktów oraz eksportera paczek karaoke. Może być uruchomiona lokalnie albo wystawiona w sieci. Nie ma kont użytkowników, logowania ani podziału uprawnień; zakładany jest jeden operator aplikacji.

Każde przetwarzanie utworu jest reprezentowane jako `Job`, który przechodzi przez jawne statusy i zapisuje pośrednie artefakty.

```text
Upload UI / Project Import
  -> API
  -> Job Queue
  -> Audio Preprocessor
  -> BPM Detector
  -> Demucs Worker
  -> WhisperX Worker
  -> Pitch Worker
  -> Alignment/Segmentation Worker
  -> Review Editor
  -> Karaoke Package Exporter
```

## Komponenty

### Frontend

- Przyjmuje plik audio i metadane utworu.
- Uzupełnia pola tytułu, artysty i innych metadanych z tagów pliku audio, jeśli są dostępne.
- Pozwala wybrać szybki albo dokładniejszy model separacji.
- Pozwala wybrać szybki albo dokładniejszy model transkrypcji.
- Pozwala opcjonalnie wskazać język utworu.
- Pozwala wczytać `mukai-project.json` i kontynuować pracę nad utworem.
- Pokazuje status zadania i błędy.
- Udostępnia edytor tekstu, sylab, fraz, nut i timingów.
- Pozwala odsłuchać oryginał, wokal i instrumental.
- Uruchamia eksport jednej lub wielu paczek ZIP po zatwierdzeniu wersji finalnej.

### Backend API

- Waliduje upload i metadane.
- Tworzy `Job`.
- Obsługuje import projektu z `mukai-project.json`.
- Udostępnia statusy, artefakty i zapis edycji.
- Zabezpiecza ścieżki plików przed dostępem poza katalogiem roboczym aplikacji.
- Nie wykonuje ciężkich obliczeń synchronicznie w żądaniu HTTP.
- Nie implementuje autoryzacji użytkowników w MVP.

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
- Worker eksportu: generuje ZIP-y dla wybranych wariantów i odtwarzaczy.
- Worker importu projektu: odtwarza stan edycji z JSON-a bez ponownego uruchamiania BPM, transkrypcji i pitch detection.

### Magazyn artefaktów

- Przechowuje oryginalny plik, znormalizowane audio, stems, transkrypcję, pitch frames, nuty, wersje edycji i eksporty.
- Każdy artefakt ma typ, hash, czas utworzenia i parametry procesu.
- Pliki audio użytkownika nie powinny trafiać do repozytorium.
- Po pomyślnym eksporcie może usunąć pliki audio i artefakty, jeśli użytkownik zaznaczył taką opcję przed eksportem.

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
