# Specyfikacja projektu Mukai

Ostatnia weryfikacja źródeł: 2026-06-15.

## Cel aplikacji

Mukai ma być aplikacją uruchamianą w Dockerze do przygotowywania plików karaoke dla aktualnych wersji UltraStar Deluxe, UltraStar Play i Vocaluxe. Użytkownik wgrywa utwór audio, aplikacja izoluje wokal, rozpoznaje tekst z czasami, wykrywa wysokości śpiewanych nut, pozwala ręcznie poprawić wynik i eksportuje jedną paczkę ZIP z oryginalnym audio, instrumentalem i wokalem/a capella. Aplikacja pozwala też osobno wyeksportować pełny projekt jako ZIP do późniejszego importu.

## Zakres MVP

- Upload pojedynczego pliku audio w formacie `WAV`, `MP3`, `MP4`, `M4A`, `OGG` albo `FLAC`.
- Limit uploadu 500 MB z walidacją rozszerzenia, MIME oraz `ffprobe`.
- Automatyczne uzupełnienie metadanych z tagów pliku audio, jeśli są dostępne.
- Automatyczne ustawienie covera z tagów, możliwość podmiany ręcznej i przywrócenia domyślnego covera z tagów.
- Konwersja audio przez FFmpeg do formatów roboczych wymaganych przez workery.
- Separacja wokalu i instrumentalnego podkładu z wyborem profilu Demucs.
- Transkrypcja wokalu z czasami fraz oraz słów z wyborem profilu WhisperX.
- Detekcja wysokości dźwięku z wokalu i segmentacja do nut.
- Edytor tekstu, sylab, timingów, typów nut i pitch.
- Import i kontynuacja pracy z ZIP-em projektu utworzonym przez opcję `Wyeksportuj projekt`.
- Eksport jednej paczki ZIP zgodnej z aktualnymi wersjami wspieranych odtwarzaczy, bez danych projektu w tej paczce.
- Osobny eksport pełnego projektu jako ZIP zawierający `Job`, artefakty, oryginalny plik i manifesty JSON potrzebne do odtworzenia stanu.
- Retencja lokalnego `Job` i artefaktów przez 24 godziny po eksporcie projektu.

## Status implementacji

Dokumentacja nadrzędna opisuje pełny docelowy zakres MVP. Aktualny kod implementuje upload z preflightem, tworzenie `Job`, orkiestrację pipeline'u do edytowalnego `Arrangement`, zapis/resegmentację edycji, pobieranie artefaktów i reset etapów. Eksport karaoke, eksport ZIP-a projektu, import ZIP-a projektu i retencja po eksporcie pozostają wymaganymi etapami MVP, ale nie mają jeszcze endpointów API ani pełnego UI w obecnej implementacji.

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

- Separacja źródeł: Demucs v4 z domyślnym dokładniejszym `htdemucs_ft` i opcjonalnym szybszym `htdemucs`.
- Transkrypcja: WhisperX z domyślnym dokładniejszym `large-v3` i opcjonalnym szybszym `large-v3-turbo`.
- Detekcja wysokości: `torchcrepe` zamiast oryginalnego pakietu CREPE, bo daje ten sam kierunek modelu w PyTorch, obsługuje GPU i łatwiej pasuje do stosu Demucs/WhisperX.
- Detekcja BPM: Essentia `RhythmExtractor2013`.

Wszystkie modele i narzędzia mają działać lokalnie w kontenerze lub przez lokalnie dostępne binaria. Specyfikacja nie przewiduje zewnętrznych API.

## Rekomendacja stosu aplikacji

- Frontend: React.
- Backend API: Python/FastAPI.
- Baza danych: Postgres dla `Job`, metadanych, aktualnego `Arrangement` i wyborów eksportu.
- Kolejka i koordynacja workerów: Redis.
- Ciężkie workery docelowe: osobne serwisy Docker dla Demucs, WhisperX i pitch detection.
- Pliki audio, artefakty, eksporty i cache modeli: wolumen Docker poza repozytorium aplikacji.
- Edycja: MVP utrwala tylko aktualny stan; undo/redo działa sesyjnie w edytorze.

## GPU i kontenery

Główny tryb pracy zakłada GPU NVIDIA dostępne dla workerów Dockera. Jeśli kontenery nie widzą GPU, procedura diagnostyczna i kroki instalacji NVIDIA Container Toolkit dla Debiana na WSL są opisane w [Operacje i testowanie](operations-and-testing.md#troubleshooting-gpu-nvidia-w-dockerze-na-wsldebianie).

## Dokumenty

- [Architektura](architecture.md)
- [Pipeline przetwarzania](processing-pipeline.md)
- [Stos modeli AI](model-stack.md)
- [Kontrakty danych](data-contracts.md)
- [Design system UI](UI.md)
- [Edytor UI](editor-ui.md)
- [Eksport UltraStar](ultrastar-export.md)
- [Etapy potencjalnego wdrożenia](implementation-steps/00-index.md)
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
- NVIDIA Container Toolkit: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html
- CUDA on WSL: https://docs.nvidia.com/cuda/wsl-user-guide/index.html
