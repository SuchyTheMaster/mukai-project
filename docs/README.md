# Specyfikacja projektu Mukai

Ostatnia weryfikacja źródeł: 2026-05-28.

## Cel aplikacji

Mukai ma być aplikacją uruchamianą w Dockerze do przygotowywania plików karaoke dla UltraStar Deluxe, UltraStar Play i Vocaluxe. Użytkownik wgrywa utwór audio, aplikacja izoluje wokal, rozpoznaje tekst z czasami, wykrywa wysokości śpiewanych nut, pozwala ręcznie poprawić wynik i eksportuje wybrane paczki ZIP.

## Zakres MVP

- Upload pojedynczego pliku audio w formacie `WAV`, `MP3`, `MP4`, `M4A`, `OGG` albo `FLAC`.
- Automatyczne uzupełnienie metadanych z tagów pliku audio, jeśli są dostępne.
- Konwersja audio przez FFmpeg do formatów roboczych wymaganych przez workery.
- Separacja wokalu i instrumentalnego podkładu z wyborem profilu Demucs.
- Transkrypcja wokalu z czasami fraz oraz słów z wyborem profilu WhisperX.
- Detekcja wysokości dźwięku z wokalu i segmentacja do nut.
- Edytor tekstu, sylab, timingów, typów nut i pitch.
- Import i kontynuacja pracy z `mukai-project.json`.
- Eksport jednej lub wielu paczek ZIP zgodnych z wybranymi odtwarzaczami.

## Poza zakresem pierwszej wersji

- Konta użytkowników i współpraca wielu osób.
- Logowanie i zarządzanie uprawnieniami.
- Automatyczne pobieranie tekstów piosenek z zewnętrznych serwisów.
- Automatyczna publikacja do baz piosenek.
- Obsługa duetów jako wymaganie bazowe.
- Trening własnych modeli.
- Zewnętrzne API do transkrypcji, pitch detection albo separacji audio.
- Komunikaty przypominające o prawach do przetwarzanego utworu; zakładamy, że użytkownik ma potrzebne prawa.

## Rekomendacja stosu AI

- Separacja źródeł: Demucs v4 z wyborem użytkownika: szybki `htdemucs` albo dokładniejszy `htdemucs_ft`.
- Transkrypcja: WhisperX z wyborem użytkownika: dokładniejszy `large-v3` albo szybszy `large-v3-turbo`.
- Detekcja wysokości: `torchcrepe` zamiast oryginalnego pakietu CREPE, bo daje ten sam kierunek modelu w PyTorch, obsługuje GPU i łatwiej pasuje do stosu Demucs/WhisperX.
- Detekcja BPM: Essentia `RhythmExtractor2013`.

Wszystkie modele i narzędzia mają działać lokalnie w kontenerze lub przez lokalnie dostępne binaria. Specyfikacja nie przewiduje zewnętrznych API.

## Dokumenty

- [Architektura](architecture.md)
- [Pipeline przetwarzania](processing-pipeline.md)
- [Stos modeli AI](model-stack.md)
- [Kontrakty danych](data-contracts.md)
- [Design system UI](UI.md)
- [Edytor UI](editor-ui.md)
- [Eksport UltraStar](ultrastar-export.md)
- [Operacje i testowanie](operations-and-testing.md)

## Źródła

- Demucs: https://github.com/facebookresearch/demucs
- WhisperX: https://github.com/m-bain/whisperX
- OpenAI Whisper: https://github.com/openai/whisper
- CREPE: https://github.com/marl/crepe
- torchcrepe: https://github.com/maxrmorrison/torchcrepe
- FFmpeg: https://ffmpeg.org/
- Essentia RhythmExtractor2013: https://essentia.upf.edu/reference/std_RhythmExtractor2013.html
- UltraStar format: https://usdx.eu/format/
