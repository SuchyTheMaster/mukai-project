# Etap 04: Normalizacja audio i BPM

## Cel

Dodać pierwszy prawdziwy etap przetwarzania audio: przygotowanie spójnych plików roboczych przez FFmpeg oraz detekcję BPM przez Essentia.

## Źródła prawdy

- [Pipeline przetwarzania](../processing-pipeline.md#2-normalizacja-audio)
- [Pipeline przetwarzania](../processing-pipeline.md#3-detekcja-bpm)
- [Kontrakty danych](../data-contracts.md#tempo)
- [Operacje i testowanie](../operations-and-testing.md#przechowywanie-plików)

## Zakres

- Przejście `Job` przez statusy `preprocessing` i `detecting_bpm`.
- Konwersja źródła do `mix.wav`: WAV PCM, 44100 Hz, stereo, bez zmiany długości i offsetu.
- Przygotowanie `worker_inputs/bpm.wav`: WAV PCM, 44100 Hz, mono jako downmix wszystkich kanałów.
- Opcjonalne przygotowanie `worker_inputs/demucs.wav`, jeśli Demucs wymaga osobnego wejścia.
- Zapis `audio_metadata.json` z sample rate, kanałami, czasem trwania, loudness i hashem.
- Detekcja BPM przez Essentia `RhythmExtractor2013`.
- Zapis `tempo.json` z `detectedSongBpm`, confidence, metodą, alternatywami i beat positions.
- Utworzenie lub aktualizacja kontraktu `Tempo` z `acceptedSongBpm`, `ultrastarBpm`, `gapMs` i `requiresReview`.
- UI pokazujące wykryty BPM jako wartość do akceptacji lub korekty przed eksportem.
- Aktualizacja `StageSnapshot` i metadanych artefaktów.

## Poza zakresem

- Separacja wokalu.
- Transkrypcja.
- Pitch detection.
- Łączenie tekstu z nutami.

## Zależności

- Etap 03 musi zapewniać kolejkę, statusy, artefakty i obsługę błędów.
- Etap 02 musi dostarczać poprawnie zwalidowany oryginalny plik audio.

## Wynik etapu

- Aplikacja przygotowuje pliki wejściowe dla kolejnych workerów bez modyfikowania oryginału.
- `Job` ma zapisane techniczne metadane audio i tempo.
- UI może pokazać zakończone podetapy FFmpeg i BPM oraz pobieralne artefakty.

## Kryteria akceptacji

- `mix.wav` zachowuje długość i offset źródła.
- Mono powstaje przez downmix wszystkich kanałów, a nie przez odrzucenie jednego kanału.
- Plik MP4 z wideo jest traktowany jako kontener z audio, a obraz jest ignorowany.
- Niepewne BPM jest oznaczane do sprawdzenia, ale nie blokuje dalszego pipeline'u.
- `#BPM` UltraStar nie jest zapisywany jako stała techniczna, tylko wynika z zaakceptowanego BPM utworu.

## Proponowane testy

- Test FFmpeg dla `WAV`, `MP3`, `MP4`, `M4A`, `OGG` i `FLAC`.
- Test zachowania długości i offsetu po konwersji.
- Test downmixu wielokanałowego do mono.
- Test `Tempo`: `detectedSongBpm`, `acceptedSongBpm`, `ultrastarBpm` i `gapMs`.
- Test etapu BPM z pewnym i niepewnym wynikiem.
- Test UI pokazujący artefakty `mix.wav`, `worker_inputs/bpm.wav` i `tempo.json`.

