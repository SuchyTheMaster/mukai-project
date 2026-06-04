# Etap 05: Separacja wokalu

## Cel

Podłączyć worker separacji źródeł, który z przygotowanego audio tworzy wokal, instrumental i wejścia dla dalszych modeli.

## Źródła prawdy

- [Pipeline przetwarzania](../processing-pipeline.md#4-separacja-wokalu)
- [Stos modeli AI](../model-stack.md#separacja-demucs-v4)
- [Architektura](../architecture.md#workery-ai)
- [Operacje i testowanie](../operations-and-testing.md#build-obrazu-workera)

## Zakres

- Osobny serwis Docker `worker-separate-stems`.
- Demucs v4 z profilami `htdemucs` i `htdemucs_ft`.
- Domyślny profil dokładniejszy `htdemucs_ft`, zgodny z wyborem z uploadu.
- Kontrolowany wariant PyTorch/CUDA w obrazie workera lub jawny indeks wheelów PyTorch.
- Użycie GPU, jeśli jest dostępne, z diagnostyką urządzenia, VRAM, wersji bibliotek i wariantu CUDA/CPU.
- Jedna automatyczna próba ponowna z mniejszym segmentem przy błędzie braku pamięci GPU.
- Zapis `vocals.wav`, `instrumental.wav` i `separation.json`.
- Przygotowanie `worker_inputs/whisperx.wav`: WAV PCM, 16000 Hz, mono z `vocals.wav`.
- Przygotowanie `worker_inputs/torchcrepe.wav`: WAV PCM, 16000 Hz, mono z `vocals.wav`.
- Zapis wersji Demucs, PyTorch/CUDA, parametrów segmentu, hashy wejścia i czasu przetwarzania.
- Aktualizacja statusu `separating_vocals` i artefaktów przy właściwym podetapie.

## Poza zakresem

- Transkrypcja WhisperX.
- Pitch detection.
- Ocena jakości separacji jako blokada dalszego pipeline'u.

## Zależności

- Etap 04 musi dostarczać `mix.wav` i opcjonalne `worker_inputs/demucs.wav`.
- Etap 03 musi obsługiwać statusy, błędy, retry jako diagnostykę i pobieranie artefaktów.

## Wynik etapu

- `Job` ma stems wokalu i instrumentalu zapisane jako artefakty.
- Kolejne workery dostają gotowe wejścia mono 16000 Hz.
- UI pokazuje zakończony etap Demucs, diagnostykę i przyciski pobrania stems.

## Kryteria akceptacji

- Worker nie instaluje niekontrolowanego stosu CUDA przez zwykłe `torch==...` z domyślnego PyPI.
- Brak GPU jest raportowany jako tryb awaryjny CPU albo czytelny błąd infrastruktury, zgodnie z konfiguracją.
- Błąd OOM wykonuje maksymalnie jedną automatyczną próbę z mniejszym segmentem.
- Artefakty zawierają użyty profil modelu i parametry potrzebne do diagnostyki.
- Dalsze etapy nie zakładają idealnej separacji i tolerują bleeding instrumentów.

## Proponowane testy

- `docker compose build worker-separate-stems --progress=plain`.
- Smoke test GPU w kontenerze CUDA przed uruchomieniem ciężkiego workera.
- Test separacji krótkiego fragmentu audio dla `htdemucs` i `htdemucs_ft`.
- Test zapisu `separation.json` z wersjami, parametrami i wariantem CUDA/CPU.
- Test sztucznego błędu OOM i jednej próby ponownej.
- Test UI pobierania `vocals.wav` i `instrumental.wav`.

