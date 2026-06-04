# Stos modeli AI

## Separacja: Demucs v4

Profile wybierane przez użytkownika:

- `htdemucs`: profil szybszy.
- `htdemucs_ft`: profil dokładniejszy.

Domyślny wybór UI: `htdemucs_ft`.

Uzasadnienie:

- Demucs v4 jest modelem separacji źródeł dla muzyki i obsługuje separację wokalu.
- Dokumentacja Demucs wskazuje `--two-stems=vocals` dla izolacji wokalu oraz parametry segmentów przy ograniczonej pamięci GPU.
- Repozytorium pierwotne nie jest aktywnie rozwijane funkcjonalnie, więc wersje i środowisko trzeba pinować.

Ryzyka:

- Artefakty i bleeding mogą pogarszać ASR oraz pitch detection.
- Długie utwory i `htdemucs_ft` zwiększą czas przetwarzania oraz zużycie VRAM.
- Zależności CUDA/PyTorch muszą być dobrane do GPU hosta.

## Transkrypcja: WhisperX

Profile wybierane przez użytkownika:

- `large-v3`: profil dokładniejszy.
- `large-v3-turbo`: profil szybszy.

Domyślny wybór UI: `large-v3`.

Uzasadnienie:

- WhisperX dodaje forced alignment i czasy słów, co jest bezpośrednio potrzebne do edytora karaoke.
- Dla karaoke ważniejsza jest stabilność timingów i ręczna korekta niż sam tekst.
- Nie polegać na samym Whisper bez alignacji, bo aplikacja potrzebuje czasów słów/fraz.

Wymagania:

- Model działa lokalnie, bez zewnętrznych API.
- Jeśli użytkownik poda język, przekazać go do transkrypcji.
- Jeśli użytkownik nie poda języka, zostawić detekcję języka Whisperowi.
- Dla utworów wielojęzycznych rekomendować użytkownikowi brak wymuszonego języka.
- Dla długich utworów zachować globalne czasy mimo pracy Whispera na oknach około 30 sekund.

## Pitch detection: torchcrepe

Rekomendacja:

- Użyć `torchcrepe` jako głównej implementacji CREPE.
- Przechowywać zarówno surowe ramki F0, jak i zsegmentowane nuty.

Uzasadnienie:

- Oryginalny CREPE używa TensorFlow/Keras i według dokumentacji działa szybciej na GPU, ale jest starszy.
- torchcrepe jest implementacją PyTorch, ma użycie `device='cuda:0'`, Viterbi decoding, periodicity i filtry przydatne przy wokalu.
- Stos PyTorch upraszcza środowisko, bo Demucs i część stosu WhisperX również opiera się o PyTorch.

Wymagania:

- Model działa lokalnie, bez zewnętrznych API.
- Worker dostaje audio przygotowane przez FFmpeg do wymagań torchcrepe.
- Surowe ramki F0 są przechowywane niezależnie od nut po segmentacji.

## BPM: Essentia RhythmExtractor2013

Decyzja:

- Do lokalnej detekcji BPM używać Essentia `RhythmExtractor2013`.

Uzasadnienie:

- Essentia `RhythmExtractor2013` zwraca BPM, pozycje beatów, confidence i rozkład estymacji, co pasuje do UI z ostrzeżeniem o niepewnym BPM.
- Essentia wymaga sygnału 44100 Hz, więc FFmpeg musi przygotować osobny input do detekcji BPM.

## Benchmark akceptacyjny modeli

Przed implementacją produkcyjną przygotować zestaw co najmniej 20 krótkich fragmentów:

- różne języki, w tym polski;
- szybki rap;
- legato i długie samogłoski;
- wokal z pogłosem;
- duet albo chór jako przypadek trudny;
- utwór z długim instrumentalnym intro.

Metryki:

- Word error rate albo ręczna liczba korekt tekstu.
- Średni błąd start/end fraz.
- Liczba ręcznych korekt pitch na minutę.
- Czas przetwarzania na minutę audio.
- Zużycie VRAM.

## Pinowanie i manifesty

- Wersje Demucs, WhisperX, torchcrepe, Essentia, FFmpeg, PyTorch, CUDA oraz wybrane identyfikatory modeli muszą być zapisane w artefaktach etapów i w ZIP-ie projektu.
- Cache modeli musi znajdować się na wolumenie Docker poza repozytorium aplikacji.
- Worker powinien zapisać parametry wejścia audio, device, batch/segment, progi filtracji i hash wejścia, żeby wynik dało się odtworzyć albo zdiagnozować bez zgadywania konfiguracji.
- Przy braku pamięci GPU worker separacji może wykonać jedną automatyczną próbę z mniejszym segmentem; kolejne niepowodzenie jest błędem infrastruktury widocznym w statusie `Job`.

## Wariant PyTorch/CUDA w Dockerze

- PyTorch i CUDA są częścią środowiska wykonawczego workerów AI, dlatego ich wariant musi być wybierany jawnie, a nie pozostawiony resolverowi `pip`.
- Dla workerów GPU preferować obraz bazowy PyTorch/CUDA albo jawny indeks wheelów PyTorch zgodny z docelową wersją CUDA. Nie dodawać zwykłego `torch==...` do `requirements-worker.txt`, jeśli Dockerfile nie wskazuje kontrolowanego źródła pakietów.
- Dla profilu CPU używać osobnego wariantu obrazu albo osobnego requirements, oznaczonego jako tryb awaryjny. CPU nie jest domyślną ścieżką jakościową ani wydajnościową.
- Zmiana wersji PyTorch, torchaudio, CUDA albo źródła wheelów wymaga aktualizacji tej dokumentacji i ponownego smoke testu `docker compose build worker --progress=plain`.
- Manifesty etapów muszą zapisywać nie tylko wersję `torch`, ale też wariant CUDA/CPU oraz źródło środowiska, np. obraz bazowy albo indeks wheelów.

## Źródła

- Demucs: https://github.com/facebookresearch/demucs
- WhisperX: https://github.com/m-bain/whisperX
- OpenAI Whisper: https://github.com/openai/whisper
- CREPE: https://github.com/marl/crepe
- torchcrepe: https://github.com/maxrmorrison/torchcrepe
- FFmpeg: https://ffmpeg.org/
- Essentia RhythmExtractor2013: https://essentia.upf.edu/reference/std_RhythmExtractor2013.html
