# Wdrożenie etapu 2: procesowanie audio

## Zakres

Ten etap dodaje asynchroniczny worker audio uruchamiany jako osobny serwis Docker Compose:

- normalizacja uploadu przez FFmpeg do `mix.wav`;
- przygotowanie `worker_inputs/bpm.wav` jako mono 44100 Hz;
- rozpoznanie BPM przez Essentia `RhythmExtractor2013`;
- separacja wokalu przez Demucs `htdemucs` albo `htdemucs_ft` zgodnie z profilem wybranym przy uploadzie;
- przygotowanie `worker_inputs/whisperx.wav` i `worker_inputs/torchcrepe.wav` z wokalu;
- rozpoznanie pitch przez `torchcrepe`;
- segmentacja ramek pitch do wstępnych nut;
- zapis artefaktów i manifestów etapów w wolumenie `mukai_artifacts`;
- aktualizacja statusów `Job` w Postgresie.

To jest etap przejściowy. Docelowa architektura rozdziela ciężkie operacje na osobne serwisy Docker:

- `worker-separate-stems` dla separacji wokalu;
- `worker-transcribe` dla transkrypcji i forced alignment;
- `worker-pitch` dla pitch detection i segmentacji nut.

Normalizacja FFmpeg, BPM, przygotowanie wejść workerów i orkiestracja mogą pozostać w lżejszym workerze koordynującym, o ile nie blokują API i poprawnie raportują postęp.

## Przepływ

`POST /api/jobs/uploads` nadal tworzy `Job` w statusie `uploaded` i publikuje zdarzenie `uploaded` do Redis Stream `mukai:jobs`.

Worker `app.worker` czyta stream i przeprowadza etapy:

1. `preprocessing`
2. `detecting_bpm`
3. `separating_vocals`
4. `detecting_pitch`
5. `awaiting_review`

W przypadku błędu worker ustawia status `failed`, zapisuje etap błędu oraz skróconą diagnostykę w polu `error`.

Każdy etap i podetap powinien aktualizować `Job.processing` zgodnie z kontraktem `StageSnapshot`: status, start/koniec, `progressMode`, opcjonalny `progressPercent`, opcjonalne `etaSec`, komunikat oraz identyfikatory artefaktów gotowych do pobrania. Jeśli worker nie zna procentu postępu, ustawia `progressMode=indeterminate`.

## Artefakty

Worker zapisuje między innymi:

- `jobs/{jobId}/artifacts/mix.wav`
- `jobs/{jobId}/artifacts/worker_inputs/bpm.wav`
- `jobs/{jobId}/artifacts/worker_inputs/demucs.wav`
- `jobs/{jobId}/artifacts/tempo.json`
- `jobs/{jobId}/artifacts/vocals.wav`
- `jobs/{jobId}/artifacts/instrumental.wav`
- `jobs/{jobId}/artifacts/separation.json`
- `jobs/{jobId}/artifacts/worker_inputs/torchcrepe.wav`
- `jobs/{jobId}/artifacts/pitch.frames.json`
- `jobs/{jobId}/artifacts/pitch.notes.json`

Artefakty zapisywane przez workery powinny mieć metadane `producedByStage` i `producedBySubstep`, żeby frontend mógł pokazać przyciski pobierania obok właściwych podetapów.

## Założenia

- Ciężkie zależności AI są instalowane tylko w obrazie workera `backend/Worker.Dockerfile`, a nie w obrazie API.
- Worker próbuje użyć CUDA, jeśli PyTorch ją widzi; przy braku CUDA przechodzi na CPU, co jest trybem awaryjnym i może być wolne.
- Demucs przy błędzie `CUDA out of memory` wykonuje jedną próbę ponowną z `--segment 8`.
- Modele i cache bibliotek są kierowane do wolumenu `mukai_model_cache`.
- Etap nie wykonuje jeszcze transkrypcji WhisperX ani łączenia tekstu z nutami.
- Docelowy split workerów musi używać wspólnego magazynu artefaktów i cache modeli, ale osobnych ról workerów i logów diagnostycznych.

## Testy akceptacyjne

- `docker compose build worker`
- `docker compose up -d postgres redis api worker`
- upload krótkiego pliku audio przez UI albo API;
- sprawdzenie `GET /api/jobs/{jobId}`, czy status przechodzi przez etapy processingu;
- sprawdzenie, czy w wolumenie artefaktów powstały `tempo.json`, `vocals.wav`, `instrumental.wav`, `pitch.frames.json` i `pitch.notes.json`.
