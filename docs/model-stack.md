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
- Obraz `worker-orchestrator` dla etapów 00-05 używa `python:3.11-slim`, ponieważ przypięta paczka `essentia==2.1b6.dev1110` ma wheel `manylinux` dla CPython 3.11, a nie dla Python 3.12. API może pozostać na Python 3.12, bo nie instaluje Essentii.
- `backend/requirements-worker.txt` pinuje `numpy<2`, ponieważ wheel Essentii używany w workerze BPM nie jest bezpiecznie importowalny z najnowszą linią NumPy 2.x. Dockerfile workera wykonuje `python -c "import essentia.standard"` podczas buildu, żeby wykryć ten problem przed runtime.

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

Aktualna decyzja implementacyjna dla etapów 00-05:

- `worker-separate-stems` używa obrazu bazowego `pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime`.
- `backend/requirements-separate-stems.txt` instaluje Demucs, ale nie instaluje ponownie `torch` ani `torchaudio` z domyślnego PyPI.
- `worker-separate-stems` w pierwszej próbie nie przekazuje `--segment`, żeby Demucs użył domyślnego segmentu modelu. To jest ważne dla modeli Transformer, np. `htdemucs_ft`, które mają maksymalny segment 7.8 s, a CLI Demucs `4.0.1` przy ręcznym argumencie waliduje `--segment` jako `int`.
- Przy błędzie OOM worker wykonuje jedną ponowną próbę z jawnym `--segment 4`.
- `separation.json` zapisuje `cudaVariant`, `environmentSource`, wersję `torch`, wersję Demucs, użyty profil modelu, `segmentMode`, segment i hash wejścia.
- Tryb CPU jest traktowany jako fallback infrastrukturalny kontrolowany przez `ALLOW_CPU_SEPARATION`; domyślna konfiguracja Compose pozwala na fallback, żeby brak GPU był widoczny diagnostycznie zamiast blokować start usług.

Aktualna decyzja implementacyjna dla etapu 06:

- `worker-transcribe` używa osobnego obrazu `backend/Transcribe.Dockerfile` opartego o `pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime`, tak jak worker separacji, żeby nie instalować PyTorch/CUDA z domyślnego PyPI.
- `backend/requirements-transcribe.txt` pinuje `whisperx==3.8.6`, czyli aktualną stabilną wersję PyPI z 2026-05-25; wersja `3.8.2` pozostaje pominięta, bo została wycofana przez problem z timestampami słów i kompatybilnością `faster-whisper`.
- Worker zapisuje `transcript.raw.json` z wynikiem ASR oraz `transcript.aligned.json` z finalnymi frazami `TranscriptSegment`, słowami, opcjonalnymi czasami znaków, confidence i `requiresReview`.
- Język jest przekazywany do WhisperX tylko dla `languageMode=forced` i nie jest przekazywany, gdy użytkownik zostawił język pusty.
- Worker ładuje cały plik `worker_inputs/whisperx.wav` przez `whisperx.load_audio` i przekazuje cały waveform do `model.transcribe`; nie wykonuje własnego obcięcia do pierwszych 30 sekund.
- Worker jawnie ustawia WhisperX `vad_method="silero"` jako domyślny VAD. `pyannote` pozostaje obsługiwanym trybem alternatywnym przez `TranscriptionSettings.vadMethod`.
- Jeśli uruchomiona wersja WhisperX nie udostępnia parametru `vad_method`, worker nie przerywa transkrypcji. Próbuje użyć `vad_model`, jeśli API go udostępnia, a w przeciwnym razie działa z domyślnym VAD tej wersji i zapisuje tę informację w diagnostyce.
- Worker przekazuje `vad_options` z `chunk_size=30`, `vad_onset=0.5` i `vad_offset=0.363`, żeby dopasować wewnętrzny podział VAD/Cut & Merge do okna kontekstowego Whispera i zachować globalne czasy długiego wokalu.
- Worker przekazuje do `whisperx.align` `return_char_alignments=True` tylko dla `TranscriptionSettings.positioning="words_and_syllables"`; przy `words_only` zapisuje wyłącznie czasy słów.
- Po forced alignment worker buduje finalne sentencje karaoke z aligned words. Sentencje są rozdzielane przerwą większą niż efektywny `sentenceGapMs`; `null` oznacza automatyczne oszacowanie z BPM i odstępów między słowami.
- `transcript.raw.json` zachowuje surowe segmenty ASR, a `transcript.aligned.json` zapisuje finalne `TranscriptSegment` jako frazy karaoke oraz wersje WhisperX/PyTorch, wariant CUDA, źródło środowiska, model ASR, język alignacji, `batchSize`, `computeType`, hash wejścia, próg niskiej pewności, czas trwania wejścia, oczekiwaną liczbę okien 30 s, maksymalne czasy końca segmentów ASR/alignacji, metodę VAD, opcje VAD i parametry budowania fraz.

Aktualna decyzja implementacyjna dla etapu 07:

- `worker-pitch` używa osobnego obrazu `backend/Pitch.Dockerfile` opartego o `pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime`, żeby zachować ten sam kontrolowany wariant PyTorch/CUDA co workery AI.
- `backend/requirements-pitch.txt` pinuje `torchcrepe==0.0.24`, `kokosznicka==0.2.5` i `pyphen==0.17.2`; PyTorch pochodzi z obrazu bazowego, a nie z domyślnego resolvera PyPI.
- Worker czyta `worker_inputs/torchcrepe.wav` i zapisuje surowe ramki `pitch.frames.json`. Segmentacja ramek do nut `pitch.notes.json` odbywa się później w kroku `Wstępne dopasowanie`, zgodnie z ustawieniami tego kroku.
- Podział słów na sylaby używa `Job.syllabificationSettings`: `kokosznicka` tylko dla polskiego `pl`, `pyphen` dla języków z dostępnym słownikiem hyphenation, `heuristic` jako dotychczasowa heurystyka oraz `none` jako brak podziału na sylaby.
- Przy pozycjonowaniu `words_and_syllables` worker szkicu używa czasów znaków do początkowych czasów sylab; brak kompletnych znaków powoduje fallback do równego podziału czasu słowa z flagą recenzji sylab.
- Jeśli `kokosznicka` albo `pyphen` nie obsłużą języka lub zwrócą niepoprawny wynik, worker używa heurystyki i zapisuje powód w `Arrangement.syllabification.fallbackReason`.
- Kokosznicka `0.2.5` jest pakietem GPLv3; akceptacja tej zależności jest decyzją projektową dla obsługi polskiej sylabizacji.
- Pyphen `0.17.2` jest pakietem tri-license `GPLv2+ / LGPLv2+ / MPL 1.1` i używa słowników hyphenation; jest traktowany jako sylabizator przybliżony, bo słowniki dzielenia wyrazów nie zawsze odpowiadają podziałowi śpiewanych sylab.
- `draft.arrangement.json` pozostaje artefaktem szkicu, a aktywny `Arrangement` jest inicjalizowany w tabeli `arrangements`.
- Brak `midi` dla sylaby, niepewny pitch oraz sylaby wymagające recenzji sylabizacji są oznaczane flagami jakości do ręcznej recenzji. Nuty bez przecięcia z tekstem pozostają w `noteEvents` jako niezależna warstwa diagnostyczna bez osobnej flagi jakości.

## Źródła

- Demucs: https://github.com/facebookresearch/demucs
- WhisperX: https://github.com/m-bain/whisperX
- OpenAI Whisper: https://github.com/openai/whisper
- CREPE: https://github.com/marl/crepe
- torchcrepe: https://github.com/maxrmorrison/torchcrepe
- Kokosznicka: https://pypi.org/project/kokosznicka/
- Pyphen: https://pypi.org/project/pyphen/0.17.2/
- FFmpeg: https://ffmpeg.org/
- Essentia RhythmExtractor2013: https://essentia.upf.edu/reference/std_RhythmExtractor2013.html
