# Wdrożenie etapu 1: upload i ustawienia

## Zakres

Ten etap dodaje pierwszy działający fragment aplikacji:

- formularz React dla uploadu pojedynczego pliku audio;
- opcjonalny upload covera;
- ręczne metadane utworu;
- wybór profilu separacji `htdemucs` albo `htdemucs_ft`;
- wybór profilu transkrypcji `large-v3-turbo` albo `large-v3`;
- zaawansowane ustawienia pitch zgodne z wartościami startowymi z `processing-pipeline.md`;
- endpoint `POST /api/jobs/uploads`;
- endpoint `GET /api/jobs/{jobId}`;
- zapis oryginalnego pliku audio jako artefaktu niemodyfikowanego;
- walidację rozszerzenia, MIME, rozmiaru 500 MB i wyniku `ffprobe`;
- utworzenie rekordu `Job` w Postgresie ze statusem `uploaded`;
- opcjonalne zdarzenie `uploaded` w Redis Stream `mukai:jobs`;
- wstępne obrazy Docker dla frontendu i API oraz `docker-compose.yml`.

## Założenia

- Automatyczne odczytywanie tagów audio i osadzonego covera przez `POST /api/uploads/inspect` jest wymaganiem docelowym opisanym w specyfikacji, ale nie jest jeszcze wdrożone w tym etapie. Obecny formularz umożliwia ręczne wpisanie metadanych i ręczne dodanie covera.
- Docelowy preflight musi odczytywać tagi UTF-8, UTF-16 i przypadki mieszane oraz pokazywać osadzony cover tak jak cover wybrany z dysku.
- Etap nie uruchamia normalizacji FFmpeg ani workerów AI. Po poprawnym uploadzie `Job` pozostaje w statusie `uploaded`.
- Redis jest przygotowany jako kolejka dla kolejnego etapu, ale błąd publikacji zdarzenia nie odrzuca poprawnego uploadu.
- Pliki audio i covery są przechowywane w wolumenie Docker `mukai_artifacts`, poza repozytorium.
- Cache modeli jest przygotowany jako wolumen `mukai_model_cache`, ale nie jest jeszcze używany przez worker AI.
- Frontend powinien utrzymywać przypięte wersje paczek Node i `package-lock.json`; Dockerfile frontendu powinien używać `npm ci`.
- Pliki marki dostarczone przez użytkownika powinny trafić do `docs/assets/` jako materiały źródłowe dla agenta. Agent przygotowuje z nich wynikowe assety aplikacyjne w katalogach frontendu, np. `frontend/public/brand/`, zgodnie z [UI.md](UI.md).

## Endpoint uploadu

`POST /api/jobs/uploads` przyjmuje `multipart/form-data`:

- `audio`: wymagany plik audio;
- `cover`: opcjonalny plik `JPEG`, `PNG` albo `WebP`;
- `title`, `artist`, `album`, `year`, `genre`, `language`;
- `separationModel`: `htdemucs` albo `htdemucs_ft`;
- `transcriptionModel`: `large-v3-turbo` albo `large-v3`;
- `silenceThresholdDbfs`;
- `periodicityThreshold`;
- `frameStepMs`;
- `minNoteLengthMs`;
- `mergeGapMs`.

Odpowiedź zawiera `jobId`, status `uploaded`, metadane, wybrane profile, ustawienia pitch, dane z `ffprobe`, rozmiar i hash SHA-256 pliku audio.
