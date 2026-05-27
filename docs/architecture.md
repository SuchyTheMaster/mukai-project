# Architektura

## Widok ogólny

Aplikacja składa się z interfejsu webowego, backendu API, kolejki zadań, workerów AI używających GPU, magazynu artefaktów oraz eksportera UltraStar. Każde przetwarzanie utworu jest reprezentowane jako `Job`, który przechodzi przez jawne statusy i zapisuje pośrednie artefakty.

```text
Upload UI
  -> API
  -> Job Queue
  -> Audio Preprocessor
  -> Demucs Worker
  -> WhisperX Worker
  -> Pitch Worker
  -> Alignment/Segmentation Worker
  -> Review Editor
  -> UltraStar Exporter
```

## Komponenty

### Frontend

- Przyjmuje plik audio i metadane utworu.
- Pokazuje status zadania i błędy.
- Udostępnia edytor tekstu, fraz, nut i timingów.
- Pozwala odsłuchać oryginał, wokal i instrumental.
- Uruchamia eksport po zatwierdzeniu wersji finalnej.

### Backend API

- Waliduje upload i metadane.
- Tworzy `Job`.
- Udostępnia statusy, artefakty i zapis edycji.
- Zabezpiecza ścieżki plików przed dostępem poza katalogiem roboczym aplikacji.
- Nie wykonuje ciężkich obliczeń synchronicznie w żądaniu HTTP.

### Kolejka i orkiestracja

- Zapewnia pojedynczy punkt kontroli dla zadań GPU.
- Pozwala wznowić zadanie od ostatniego poprawnego artefaktu.
- Przechowuje parametry modeli użyte dla danego wyniku.
- Odróżnia błędy użytkownika od błędów infrastruktury.

### Workery AI

- Worker separacji: Demucs.
- Worker ASR: WhisperX.
- Worker pitch detection: torchcrepe/CREPE.
- Worker alignacji: łączy tekst, słowa, nuty i frazy.

### Magazyn artefaktów

- Przechowuje oryginalny plik, znormalizowane audio, stems, transkrypcję, pitch frames, nuty, wersje edycji i eksporty.
- Każdy artefakt ma typ, hash, czas utworzenia i parametry procesu.
- Pliki audio użytkownika nie powinny trafiać do repozytorium.

## Statusy zadania

- `uploaded`
- `preprocessing`
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
