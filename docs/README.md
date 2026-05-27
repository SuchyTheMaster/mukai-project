# Specyfikacja projektu Mukai

Ostatnia weryfikacja źródeł: 2026-05-28.

## Cel aplikacji

Mukai ma być lokalną lub self-hosted aplikacją do przygotowywania plików karaoke dla UltraStar. Użytkownik wgrywa utwór audio, aplikacja izoluje wokal, rozpoznaje tekst z czasami, wykrywa wysokości śpiewanych nut, pozwala ręcznie poprawić wynik i eksportuje gotowy plik `.txt` zgodny z UltraStar.

## Zakres MVP

- Upload pojedynczego pliku audio.
- Separacja wokalu i instrumentalnego podkładu.
- Transkrypcja wokalu z czasami fraz oraz słów.
- Detekcja wysokości dźwięku z wokalu i segmentacja do nut.
- Edytor tekstu, timingów i nut.
- Eksport paczki UltraStar zawierającej `.txt` oraz wskazane pliki audio.

## Poza zakresem pierwszej wersji

- Konta użytkowników i współpraca wielu osób.
- Automatyczne pobieranie tekstów piosenek z zewnętrznych serwisów.
- Automatyczna publikacja do baz piosenek.
- Obsługa duetów jako wymaganie bazowe.
- Trening własnych modeli.

## Rekomendacja stosu AI

- Separacja źródeł: Demucs v4, domyślnie `htdemucs`, opcjonalnie `htdemucs_ft` dla wyższej jakości kosztem czasu.
- Transkrypcja: WhisperX z modelem `large-v3` jako domyślna ścieżka jakościowa. Warto przetestować `large-v3-turbo` jako profil szybki, szczególnie dla języka angielskiego i krótszych kolejek GPU.
- Detekcja wysokości: `torchcrepe` zamiast oryginalnego pakietu CREPE, bo daje ten sam kierunek modelu w PyTorch, obsługuje GPU i łatwiej pasuje do stosu Demucs/WhisperX.
- Alternatywy eksperymentalne: NVIDIA Parakeet dla ASR oraz Basic Pitch dla note events, ale tylko po benchmarku na realnych piosenkach i po potwierdzeniu jakości alignacji do tekstu.

Nie ma jednej oczywiście lepszej zamiany za WhisperX dla tego przypadku, ponieważ aplikacja potrzebuje nie tylko tekstu, ale też stabilnych czasów fraz/słów do dalszej edycji karaoke. Decyzję należy potwierdzić benchmarkiem na zestawie utworów docelowych.

## Dokumenty

- [Architektura](architecture.md)
- [Pipeline przetwarzania](processing-pipeline.md)
- [Stos modeli AI](model-stack.md)
- [Kontrakty danych](data-contracts.md)
- [Edytor UI](editor-ui.md)
- [Eksport UltraStar](ultrastar-export.md)
- [Operacje i testowanie](operations-and-testing.md)
- [Otwarte pytania](open-questions.md)

## Źródła

- Demucs: https://github.com/facebookresearch/demucs
- WhisperX: https://github.com/m-bain/whisperX
- OpenAI Whisper: https://github.com/openai/whisper
- CREPE: https://github.com/marl/crepe
- torchcrepe: https://github.com/maxrmorrison/torchcrepe
- Basic Pitch: https://github.com/spotify/basic-pitch
- NVIDIA Parakeet RNNT multilingual: https://build.nvidia.com/nvidia/parakeet-1_1b-rnnt-multilingual-asr/modelcard
- UltraStar format: https://usdx.eu/format/
