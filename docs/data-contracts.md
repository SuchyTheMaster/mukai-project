# Kontrakty danych

## Zasady

- Wewnętrzne czasy przechowywać w sekundach jako liczby zmiennoprzecinkowe.
- Eksport UltraStar przelicza sekundy na beaty dopiero na końcu.
- Każdy artefakt AI ma zapisaną wersję modelu, parametry i hash wejścia.
- Edycje użytkownika są osobną warstwą względem wyników AI.
- MVP utrwala tylko aktualny stan edycji `Arrangement`; historia undo/redo jest sesyjna po stronie edytora i nie jest kontraktem trwałego storage.
- Rekordy `Job`, metadane, wybory eksportu i aktualny `Arrangement` są przechowywane w Postgresie, a pliki audio, artefakty, eksporty oraz cache modeli są przechowywane na wolumenie Docker poza repozytorium.
- Pola BPM i `#GAP` należą do kontraktu `Tempo`; nie duplikować ich w `Job.metadata`.

## Job

```json
{
  "jobId": "job_01J...",
  "status": "awaiting_review",
  "createdAt": "2026-05-28T00:00:00Z",
  "updatedAt": "2026-05-28T00:10:00Z",
  "metadata": {
    "title": "Song Title",
    "artist": "Artist",
    "language": "pl",
    "languageMode": "forced"
  },
  "profiles": {
    "separationModel": "htdemucs_ft",
    "transcriptionModel": "large-v3",
    "pitch": "default"
  },
  "retention": {
    "projectExportedAt": null,
    "cleanupEligibleAt": null,
    "cleanupReason": null
  }
}
```

`languageMode`:

- `forced`: użytkownik wskazał język.
- `auto`: użytkownik zostawił język pusty i detekcja należy do Whispera.

`separationModel`:

- `htdemucs`: szybki.
- `htdemucs_ft`: dokładniejszy.

`transcriptionModel`:

- `large-v3`: dokładniejszy.
- `large-v3-turbo`: szybszy.

## AudioAsset

```json
{
  "assetId": "asset_vocals",
  "type": "vocals",
  "path": "jobs/job_01J/artifacts/vocals.wav",
  "originalFilename": "source-file.mp3",
  "durationSec": 213.42,
  "sampleRate": 44100,
  "channels": 2,
  "sha256": "..."
}
```

## UploadInspection

`UploadInspection` jest odpowiedzią z `POST /api/uploads/inspect`. Służy wyłącznie do wstępnego uzupełnienia formularza i nie tworzy `Job`.

```json
{
  "uploadDraftId": "draft_01J...",
  "originalFilename": "source-file.mp3",
  "audio": {
    "durationSec": 213.42,
    "sampleRate": 44100,
    "channels": 2,
    "codec": "mp3",
    "container": "mp3"
  },
  "metadata": {
    "title": "Song Title",
    "artist": "Artist",
    "album": "Album",
    "year": "2026",
    "genre": "Pop",
    "source": "audio_tags",
    "tagEncoding": "utf16",
    "missingFields": ["language"]
  },
  "embeddedCover": {
    "coverDraftId": "cover_01J...",
    "mimeType": "image/jpeg",
    "sizeBytes": 123456,
    "previewUrl": "/api/uploads/drafts/draft_01J/cover"
  }
}
```

Zasady:

- `uploadDraftId` wskazuje tymczasowy wynik inspekcji i może zostać użyty przy `POST /api/jobs/uploads`.
- `metadata` zawiera wyłącznie wartości odczytane z pliku; użytkownik może nadpisać je w formularzu przed utworzeniem `Job`.
- `embeddedCover` ma wartość `null`, jeśli plik nie zawiera okładki.
- Preflight musi poprawnie dekodować tagi UTF-8, UTF-16 oraz przypadki mieszane bez uszkadzania znaków narodowych.
- Odczyt tagów powinien używać biblioteki metadanych audio, np. Mutagen; `ffprobe` nie jest jedynym źródłem tagów tekstowych ani covera.

## SourceMetadata

```json
{
  "title": "Song Title",
  "artist": "Artist",
  "album": "Album",
  "year": "2026",
  "genre": "Pop",
  "source": "audio_tags",
  "tagEncoding": "utf16",
  "missingFields": ["language"]
}
```

`tagEncoding`:

- `utf8`: tagi tekstowe odczytano jako UTF-8.
- `utf16`: tagi tekstowe odczytano jako UTF-16.
- `mixed`: plik zawierał tagi w więcej niż jednym kodowaniu albo biblioteka metadanych raportuje mieszane źródła.
- `unknown`: kodowanie nie jest dostępne, ale wartości zostały znormalizowane do tekstu aplikacji.

## EmbeddedCover

```json
{
  "coverDraftId": "cover_01J...",
  "mimeType": "image/jpeg",
  "sizeBytes": 123456,
  "previewUrl": "/api/uploads/drafts/draft_01J/cover",
  "source": "audio_tags"
}
```

`EmbeddedCover` jest tymczasowym coverem wykrytym w tagach audio podczas preflightu. Jeśli użytkownik nie wskaże ręcznie innego covera, `POST /api/jobs/uploads` promuje go do normalnego assetu covera dla `Job`. Ręczny cover wskazany w formularzu ma pierwszeństwo przed `EmbeddedCover`.

## Tempo

```json
{
  "detectedSongBpm": 123.45,
  "acceptedSongBpm": 123.45,
  "ultrastarBpm": 493.8,
  "gapMs": 12345,
  "confidence": 0.68,
  "method": "auto_detected",
  "requiresReview": true,
  "beatPositionsSec": [12.345, 12.466]
}
```

`detectedSongBpm` pochodzi z detektora BPM. `acceptedSongBpm` jest wartością zaakceptowaną albo poprawioną przez użytkownika i to z niej eksporter wylicza `ultrastarBpm`. `gapMs` jest domyślnie czasem startu pierwszej zatwierdzonej nuty. `beatPositionsSec` pochodzi z Essentii i może być użyte przez UI do kontroli siatki, ale eksport nadal opiera się na zaakceptowanym BPM.

## TranscriptSegment

```json
{
  "segmentId": "seg_001",
  "startSec": 12.34,
  "endSec": 15.87,
  "text": "pierwsza fraza tekstu",
  "confidence": 0.84,
  "words": [
    {
      "wordId": "word_001",
      "startSec": 12.34,
      "endSec": 12.91,
      "text": "pierwsza",
      "confidence": 0.81
    }
  ]
}
```

## PitchFrame

```json
{
  "timeSec": 12.345,
  "frequencyHz": 220.0,
  "midi": 57.0,
  "periodicity": 0.76,
  "voiced": true
}
```

## NoteEvent

```json
{
  "noteId": "note_001",
  "startSec": 12.34,
  "endSec": 12.88,
  "midi": 57,
  "frequencyHz": 220.0,
  "confidence": 0.72,
  "source": "pitch_ai",
  "requiresReview": false
}
```

## KaraokeToken

```json
{
  "tokenId": "tok_001",
  "text": "pierw",
  "wordId": "word_001",
  "syllableIndex": 0,
  "noteId": "note_001",
  "startSec": 12.34,
  "endSec": 12.88,
  "midi": 57,
  "noteType": "normal",
  "isExtension": false,
  "extendsTokenId": null
}
```

`KaraokeToken` żyje jako część aktualnego `Arrangement`; w manifeście projektu jest reprezentowany w `arrangement.tokens`. Token może mieć pusty `text` tylko wtedy, gdy `isExtension` ma wartość `true` i `extendsTokenId` wskazuje token, którego sylabę albo samogłoskę przedłuża. Eksporter nie tworzy tekstu przedłużeń heurystycznie.

## ExportSelection

```json
{
  "packageName": "source-file-name",
  "internalDirectoryName": "Artist - Song Title",
  "baseFilename": "Artist - Song Title",
  "zipNamePattern": "{baseFilename} [{target} {variant}].zip",
  "targets": ["ultrastar_deluxe", "ultrastar_play", "vocaluxe"],
  "variants": ["original_audio", "instrumental"],
  "coverAssetId": null,
  "includeVocalsInInstrumentalPackage": true,
  "includeInstrumentalTag": true,
  "instrumentalPackageAudioRouting": "audio_and_instrumental_same_file"
}
```

`variants`:

- `original_audio`: `.txt` + playback MP3 zawierający oryginalne audio + opcjonalny cover.
- `instrumental`: `.txt` + playback MP3 zawierający audio bez wokalu + osobny plik wokalu + opcjonalny cover.

`coverAssetId`:

- `null`: eksport bez covera.
- identyfikator assetu: eksport z wybranym coverem.

`internalDirectoryName` i `baseFilename`:

- Są takie same dla wszystkich profili docelowych i wariantów audio.
- Różnice między profilami i wariantami występują w nazwie ZIP, np. przez `zipNamePattern`.

`instrumentalPackageAudioRouting`:

- `audio_and_instrumental_same_file`: w paczce instrumentalnej `#AUDIO` i `#INSTRUMENTAL` wskazują ten sam plik instrumentalny, a `#VOCALS` wskazuje osobny stem wokalu.

Paczki karaoke nie zawierają `mukai-project.json` ani innych danych projektu.

## ProjectExport

```json
{
  "archiveNamePattern": "{baseFilename} [mukai-project].zip",
  "includeOriginalAudio": true,
  "includeAllJobArtifacts": true,
  "includeJobManifest": true,
  "retainJobAfterSuccessfulExport": true,
  "retentionAfterSuccessfulExportHours": 24
}
```

Zasady:

- `ProjectExport` odpowiada osobnej akcji `Wyeksportuj projekt`, niezależnej od `ExportSelection`.
- `includeOriginalAudio`, `includeAllJobArtifacts`, `includeJobManifest` i `retainJobAfterSuccessfulExport` są zawsze `true` w MVP.
- Po pomyślnym utworzeniu i przekazaniu ZIP-a projektu aplikacja ustawia `projectExportedAt`, `cleanupEligibleAt = projectExportedAt + 24h` i `cleanupReason = "project_export_ttl"`.
- Lokalny rekord `Job` oraz artefakty mogą zostać usunięte dopiero przez mechanizm czyszczenia po upływie TTL.
- Zwykły eksport paczek karaoke nie ustawia retencji po eksporcie projektu.

## MukaiProject

`mukai-project.json` jest manifestem wewnątrz ZIP-a projektu. Nie jest dodawany do paczek karaoke i nie jest samodzielnym formatem importu w MVP.

ZIP projektu musi pozwalać kontynuować pracę bez ponownego uruchamiania normalizacji audio, separacji, wykrywania BPM, transkrypcji, timingów i pitch.

```json
{
  "schemaVersion": "1.0.0",
  "projectId": "proj_01J...",
  "job": {
    "jobId": "job_01J...",
    "restoredStatus": "awaiting_review"
  },
  "sourceAudio": {
    "originalFilename": "source-file.mp3",
    "archivePath": "source/source-file.mp3",
    "durationSec": 213.42,
    "sha256": "..."
  },
  "artifacts": [
    {
      "type": "vocals",
      "archivePath": "artifacts/vocals.wav",
      "sha256": "...",
      "sizeBytes": 123456
    }
  ],
  "metadata": {},
  "modelSettings": {},
  "tempo": {},
  "transcriptSegments": [],
  "pitchFrames": [],
  "noteEvents": [],
  "arrangement": {},
  "retentionPolicy": {
    "projectExportRetentionHours": 24
  },
  "exportSelections": []
}
```

W `MukaiProject` pola najwyższego poziomu `pitchFrames` i `noteEvents` przechowują wynik AI przed ręczną korektą, a `arrangement` przechowuje serializowany aktualny stan edycji z Postgresa.

Import:

- Import przyjmuje ZIP projektu utworzony przez opcję `Wyeksportuj projekt`.
- Import waliduje, że każdy wpis z `sourceAudio` i `artifacts` istnieje w archiwum i ma zgodny hash.
- Import odtwarza `Job` i artefakty tak, jakby odpowiednie etapy pipeline'u były już zakończone.
- Import nie uruchamia ponownie normalizacji audio, separacji, BPM, ASR, alignacji ani pitch detection.
- Jeśli wymagany plik nie istnieje albo hash się nie zgadza, import kończy się błędem zamiast próbować przeliczać brakujący etap.

## Arrangement

```json
{
  "arrangementId": "arr_001",
  "jobId": "job_01J...",
  "revision": 3,
  "approved": false,
  "updatedAt": "2026-05-28T00:10:00Z",
  "lines": [
    {
      "lineId": "line_001",
      "startSec": 12.34,
      "endSec": 15.87,
      "tokenIds": ["tok_001", "tok_002"]
    }
  ],
  "tokens": [],
  "noteEvents": []
}
```

`revision` służy do kontroli współbieżnego zapisu aktualnego stanu i nie oznacza trwałej historii wersji. Eksporter używa aktualnego zatwierdzonego `Arrangement`, jego `tokens` oraz `noteEvents`.

Aktywny `Arrangement` jest przechowywany wyłącznie w Postgresie. `mukai-project.json` zawiera jego serializowany snapshot na potrzeby eksportu projektu i późniejszego importu; ten snapshot nie jest osobnym źródłem prawdy podczas pracy nad aktywnym `Job`.

## Semantyka statusów eksportu

- `exporting` i `exporting_project` są statusami przejściowymi.
- Po udanym eksporcie paczek karaoke `Job` wraca do `awaiting_review`, a ZIP-y i raport walidacji są zapisywane jako artefakty eksportu.
- Po udanym eksporcie projektu `Job` wraca do `awaiting_review` i ma ustawione `projectExportedAt`, `cleanupEligibleAt` oraz `cleanupReason`.
- `completed` jest statusem zarezerwowanym poza normalnym flow MVP i nie jest ustawiany po zwykłym eksporcie karaoke ani po eksporcie projektu.

## Artefakty wymagane według statusu

Minimalny komplet artefaktów wymagany do importu ZIP-a projektu i wznowienia pracy:

| Status | Wymagane artefakty |
| --- | --- |
| `uploaded` | oryginalny plik źródłowy, `Job`, `SourceMetadata` jeśli wykryto tagi, cover asset jeśli użyto covera z tagów albo ręcznego uploadu |
| `preprocessing` | artefakty statusu `uploaded`, `audio_metadata.json`, `mix.wav`, `worker_inputs/bpm.wav`, opcjonalnie `worker_inputs/demucs.wav` |
| `detecting_bpm` | artefakty statusu `preprocessing` |
| `separating_vocals` | artefakty statusu `preprocessing`, `tempo.json` |
| `transcribing` | artefakty statusu `separating_vocals`, `vocals.wav`, `instrumental.wav`, `separation.json`, `worker_inputs/whisperx.wav`, `worker_inputs/torchcrepe.wav` |
| `detecting_pitch` | artefakty statusu `transcribing`, `transcript.raw.json`, `transcript.aligned.json` |
| `aligning` | artefakty statusu `detecting_pitch`, `pitch.frames.json`, `pitch.notes.json` |
| `awaiting_review` | artefakty statusu `aligning`, aktualny `Arrangement` w Postgresie |
| `exporting` | artefakty statusu `awaiting_review`, aktualny zatwierdzony `Arrangement` |
| `exporting_project` | artefakty wymagane dla bieżącego statusu `Job` oraz manifest eksportu projektu |
| `completed` | status zarezerwowany poza normalnym flow MVP; jeśli zostanie użyty później, wymaga artefaktów ostatniego ukończonego etapu |
| `failed` / `cancelled` | artefakty ostatniego poprawnie zakończonego etapu oraz diagnostyka błędu, jeśli istnieje |

## Typy nut

- `normal`: nuta punktowana w UltraStar jako `:`.
- `golden`: nuta bonusowa jako `*`.
- `freestyle`: nuta niepunktowana jako `F`.
- `rap`: rytmiczny tekst jako `R`.
- `rap_golden`: bonusowy rap jako `G`.

## Walidacja

- `endSec` musi być większe niż `startSec`.
- Token musi mieć tekst albo być oznaczony jako przedłużenie.
- Nuta eksportowana do UltraStar musi mieć długość co najmniej jednego beatu.
- Puste frazy nie są eksportowane.
