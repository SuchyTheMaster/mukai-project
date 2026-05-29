# Kontrakty danych

## Zasady

- Wewnętrzne czasy przechowywać w sekundach jako liczby zmiennoprzecinkowe.
- Eksport UltraStar przelicza sekundy na beaty dopiero na końcu.
- Każdy artefakt AI ma zapisaną wersję modelu, parametry i hash wejścia.
- Edycje użytkownika są osobną warstwą względem wyników AI.

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
    "languageMode": "forced",
    "detectedSongBpm": 123.45,
    "ultrastarBpm": 493.8
  },
  "profiles": {
    "separationModel": "htdemucs_ft",
    "transcriptionModel": "large-v3",
    "pitch": "default"
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

## SourceMetadata

```json
{
  "title": "Song Title",
  "artist": "Artist",
  "album": "Album",
  "year": "2026",
  "genre": "Pop",
  "source": "audio_tags",
  "missingFields": ["language"]
}
```

## Tempo

```json
{
  "songBpm": 123.45,
  "ultrastarBpm": 493.8,
  "confidence": 0.68,
  "method": "auto_detected",
  "requiresReview": true
}
```

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
  "noteType": "normal"
}
```

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
  "deleteJobAfterSuccessfulExport": true
}
```

Zasady:

- `ProjectExport` odpowiada osobnej akcji `Wyeksportuj projekt`, niezależnej od `ExportSelection`.
- `includeOriginalAudio`, `includeAllJobArtifacts`, `includeJobManifest` i `deleteJobAfterSuccessfulExport` są zawsze `true` w MVP.
- Po pomyślnym utworzeniu i przekazaniu ZIP-a projektu aplikacja usuwa lokalny rekord `Job` oraz wszystkie artefakty tego zadania.
- Zwykły eksport paczek karaoke nie ustawia ani nie wykonuje `deleteJobAfterSuccessfulExport`.

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
  "exportSelections": []
}
```

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
  "version": 3,
  "approved": false,
  "lines": [
    {
      "lineId": "line_001",
      "startSec": 12.34,
      "endSec": 15.87,
      "tokens": ["tok_001", "tok_002"]
    }
  ]
}
```

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
