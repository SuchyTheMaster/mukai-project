# Stos modeli AI

## Separacja: Demucs v4

Rekomendacja:

- Domyślnie `htdemucs` dla szybkości.
- Profil jakości `htdemucs_ft` dla finalnych eksportów albo gdy użytkownik zaakceptuje dłuższe przetwarzanie.

Uzasadnienie:

- Demucs v4 jest modelem separacji źródeł dla muzyki i obsługuje separację wokalu.
- Dokumentacja Demucs wskazuje `--two-stems=vocals` dla izolacji wokalu oraz parametry segmentów przy ograniczonej pamięci GPU.
- Repozytorium pierwotne nie jest aktywnie rozwijane funkcjonalnie, więc wersje i środowisko trzeba pinować.

Ryzyka:

- Artefakty i bleeding mogą pogarszać ASR oraz pitch detection.
- Długie utwory i `htdemucs_ft` zwiększą czas przetwarzania.
- Zależności CUDA/PyTorch muszą być dobrane do GPU hosta.

## Transkrypcja: WhisperX

Rekomendacja:

- Domyślnie WhisperX + `large-v3`.
- Dodać profil `large-v3-turbo` do benchmarku szybkości i jakości.
- Nie polegać na samym Whisper bez alignacji, bo aplikacja potrzebuje czasów słów/fraz.

Uzasadnienie:

- WhisperX dodaje forced alignment i czasy słów, co jest bezpośrednio potrzebne do edytora karaoke.
- OpenAI Whisper wskazuje model `turbo` jako domyślny dla transkrypcji, ale nie dla tłumaczenia.
- Dla karaoke ważniejsza jest stabilność timingów i ręczna korekta niż sam tekst.

Alternatywy:

- NVIDIA Parakeet RNNT multilingual obsługuje m.in. `pl-PL` i działa na GPU, ale jego podstawowy wynik to tekst. Wymagałby osobnej warstwy alignacji i benchmarku na śpiewie.
- Zewnętrzne API ASR może mieć lepszą jakość w niektórych językach, ale komplikuje prywatność, koszty i pracę offline.

## Pitch detection: torchcrepe

Rekomendacja:

- Użyć `torchcrepe` jako głównej implementacji CREPE.
- Przechowywać zarówno surowe ramki F0, jak i zsegmentowane nuty.

Uzasadnienie:

- Oryginalny CREPE używa TensorFlow/Keras i według dokumentacji działa szybciej na GPU, ale jest starszy.
- torchcrepe jest implementacją PyTorch, ma użycie `device='cuda:0'`, Viterbi decoding, periodicity i filtry przydatne przy wokalu.
- Stos PyTorch upraszcza środowisko, bo Demucs i część stosu WhisperX również opiera się o PyTorch.

Alternatywy:

- Basic Pitch generuje note events i MIDI, może być wartościowy jako dodatkowy benchmark segmentacji nut.
- Basic Pitch jest projektowany jako instrument-agnostic AMT i najlepiej działa na jednym instrumencie naraz; dla izolowanego wokalu może pomóc, ale nie zastępuje potrzeby alignacji z tekstem.

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

## Źródła

- Demucs: https://github.com/facebookresearch/demucs
- WhisperX: https://github.com/m-bain/whisperX
- OpenAI Whisper: https://github.com/openai/whisper
- CREPE: https://github.com/marl/crepe
- torchcrepe: https://github.com/maxrmorrison/torchcrepe
- Basic Pitch: https://github.com/spotify/basic-pitch
- NVIDIA Parakeet RNNT multilingual: https://build.nvidia.com/nvidia/parakeet-1_1b-rnnt-multilingual-asr/modelcard
