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
  "transcriptionSettings": {
    "vadMethod": "silero",
    "vadOnset": 0.5,
    "vadOffset": 0.363,
    "vadChunkSizeSec": 30,
    "sentenceGapMs": null,
    "sentencePaddingMs": 80
  },
  "syllabificationSettings": {
    "method": "kokosznicka"
  },
  "processing": {
    "separating_vocals.demucs": {
      "stage": "separating_vocals",
      "substep": "demucs",
      "status": "running",
      "startedAt": "2026-05-28T00:03:00Z",
      "progressMode": "estimated",
      "progressPercent": 42,
      "etaSec": 180,
      "message": "Separacja wokalu",
      "artifactIds": [],
      "workerRole": "worker-separate-stems"
    }
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

Domyślne wartości w UI:

- `separationModel`: `htdemucs_ft`.
- `transcriptionModel`: `large-v3`.

## TranscriptionSettings

Ustawienia transkrypcji sterują VAD WhisperX i finalnym grupowaniem słów w frazy karaoke. Surowe segmenty ASR pozostają w `transcript.raw.json`, a `transcript.aligned.json` zawiera finalne `TranscriptSegment` zbudowane z aligned words.

```json
{
  "vadMethod": "silero",
  "vadOnset": 0.5,
  "vadOffset": 0.363,
  "vadChunkSizeSec": 30,
  "sentenceGapMs": null,
  "sentencePaddingMs": 80
}
```

`vadMethod`:

- `silero`: domyślny VAD dla WhisperX.
- `pyannote`: obsługiwany tryb alternatywny.

Zasady:

- `vadChunkSizeSec` pozostaje domyślnie `30`, żeby pasował do okna kontekstowego Whispera.
- `sentenceGapMs` jest opcjonalnym progiem przerwy między słowami rozdzielającym finalne sentencje; `null` oznacza tryb auto.
- `sentencePaddingMs` rozszerza start i koniec frazy, ale nie może powodować nachodzenia na sąsiednie frazy.
- Artefakty transkrypcji zapisują wybraną metodę VAD, parametry VAD oraz parametry grupowania fraz.

## PitchSettings

Domyślne ustawienia pitch są dobrane pod typowe piosenki i późniejsze łączenie słów z nutami w szkicu karaoke: zachowują krok analizy `10 ms`, ale odrzucają bardzo krótkie nuty i scalają drobne przerwy po separacji wokalu.

```json
{
  "silenceThresholdDb": -42.0,
  "periodicityThreshold": 0.55,
  "frameStepMs": 10,
  "minNoteLengthMs": 120,
  "mergeGapMs": 90
}
```

Etykiety w UI:

- `silenceThresholdDb`: Czułość na cichy wokal (dB).
- `periodicityThreshold`: Minimalna pewność tonu (0-1).
- `frameStepMs`: Dokładność czasu analizy (ms).
- `minNoteLengthMs`: Najkrótsza nuta karaoke (ms).
- `mergeGapMs`: Scalanie krótkich przerw (ms).

## SyllabificationSettings

Ustawienia sylabizacji sterują tym, jak słowa z `transcript.aligned.json` są dzielone na sylaby edycyjne. Ustawienie jest zapisywane w `Job`, a worker aligningu zapisuje w `Arrangement.syllabification`, która metoda została finalnie zastosowana.

```json
{
  "method": "kokosznicka"
}
```

`method`:

- `kokosznicka`: zalecana metoda dla języka polskiego; obsługiwana tylko dla `pl`.
- `pyphen`: metoda multijęzyczna oparta o słowniki hyphenation Pyphen.
- `heuristic`: dotychczasowa heurystyka bez zewnętrznego słownika.
- `none`: brak podziału; całe słowa z transkrypcji są przekazywane jako pojedyncze sylaby.

Zasady:

- Jeśli użytkownik poda język `pl`, UI domyślnie wybiera `kokosznicka`; dla pozostałych języków domyślnie wybiera `pyphen`.
- Język dla workera aligningu jest rozstrzygany kolejno z wymuszonego języka `Job.metadata`, `detectedLanguage`, a potem `alignmentLanguage` z `transcript.aligned.json`.
- Jeśli wybrana metoda nie obsługuje języka, pakiet nie jest dostępny albo zwróci niepoprawny podział, worker używa `heuristic` i zapisuje powód w `Arrangement.syllabification.fallbackReason`.

## StageSnapshot

`Job.processing` przechowuje mapę snapshotów etapów i podetapów pipeline'u. UI używa jej do prawej kolumny etapów, pasków postępu, komunikatów błędów i akcji pobierania artefaktów.

Klucz mapy powinien być nazwą etapu, a jeśli etap ma kilka widocznych podetapów, formatem `{stage}.{substep}`, np. `preprocessing.ffmpeg` albo `separating_vocals.demucs`.

```json
{
  "stage": "separating_vocals",
  "substep": "demucs",
  "status": "running",
  "startedAt": "2026-05-28T00:03:00Z",
  "finishedAt": null,
  "progressMode": "estimated",
  "progressPercent": 42,
  "etaSec": 180,
  "message": "Separacja wokalu",
  "logExcerpt": null,
  "artifactIds": [],
  "workerRole": "worker-separate-stems"
}
```

`status`:

- `pending`: etap jest spodziewany, ale jeszcze nie rozpoczęty.
- `running`: etap jest aktualnie przetwarzany.
- `completed`: etap zakończył się sukcesem.
- `failed`: etap zakończył się błędem.
- `skipped`: etap świadomie pominięto, np. po imporcie projektu.

`progressMode`:

- `determinate`: `progressPercent` pochodzi z mierzalnego postępu.
- `estimated`: `progressPercent` jest szacunkiem backendu lub workera.
- `indeterminate`: worker nie zna procentu; UI pokazuje animację albo statyczny stan oczekiwania pod reduced motion.

Zasady:

- `progressPercent` ma zakres `0..100`; przy `indeterminate` może mieć wartość `null`.
- `etaSec` ma wartość `null`, jeśli nie da się wiarygodnie oszacować pozostałego czasu.
- `message` jest krótkim komunikatem dla UI.
- `logExcerpt` zawiera kompaktowy fragment diagnostyczny bez sekretów, tokenów i prywatnych ścieżek.
- `artifactIds` wskazuje artefakty gotowe do pobrania przy danym etapie lub podetapie.
- `workerRole` opisuje docelową rolę workera, np. `orchestrator`, `worker-separate-stems`, `worker-transcribe`, `worker-pitch`, `worker-aligner`, `worker-export`.

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
  "sha256": "...",
  "producedByStage": "separating_vocals",
  "producedBySubstep": "demucs"
}
```

Zasady:

- `producedByStage` jest nazwą statusu/etapu pipeline'u, który utworzył artefakt.
- `producedBySubstep` jest nazwą podetapu widocznego w UI, np. `ffmpeg`, `bpm`, `demucs`, `whisperx`, `pitch_detection`, `alignment`.
- UI pobiera artefakty przez `GET /api/jobs/{jobId}/artifacts/{assetId}`; pola `producedByStage` i `producedBySubstep` służą tylko do grupowania przycisków pobierania przy podetapach.

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
- Sekcja `audio` jest źródłem danych technicznych widocznych po preflight: `container` jako format/kontener, `codec`, `channels`, `sampleRate` jako częstotliwość próbkowania oraz `durationSec`.
- Preflight musi poprawnie dekodować tagi UTF-8, UTF-16 oraz przypadki mieszane bez uszkadzania znaków narodowych.
- Odczyt tagów powinien używać biblioteki metadanych audio, np. Mutagen; `ffprobe` nie jest jedynym źródłem tagów tekstowych ani covera.

## CreateJobUpload

`CreateJobUpload` jest JSON-em przekazywanym w polu formularza `payload` przy `POST /api/jobs/uploads`.

```json
{
  "uploadDraftId": "draft_01J...",
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
  "transcriptionSettings": {
    "vadMethod": "silero",
    "vadOnset": 0.5,
    "vadOffset": 0.363,
    "vadChunkSizeSec": 30,
    "sentenceGapMs": null,
    "sentencePaddingMs": 80
  },
  "pitchSettings": {
    "silenceThresholdDb": -42.0,
    "periodicityThreshold": 0.55,
    "frameStepMs": 10,
    "minNoteLengthMs": 120,
    "mergeGapMs": 90
  },
  "syllabificationSettings": {
    "method": "kokosznicka"
  },
  "useEmbeddedCover": true
}
```

Zasady:

- Brak `transcriptionSettings` w payloadzie oznacza użycie wartości domyślnych.
- `transcriptionSettings` są zapisywane w `Job` i używane przy pierwszym uruchomieniu oraz ponownym przeliczeniu transkrypcji.
- Brak `syllabificationSettings` w payloadzie oznacza użycie wartości domyślnej backendu `pyphen`; UI powinien wysłać jawny wybór użytkownika.

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

UI traktuje `EmbeddedCover` jako domyślny cover uploadu. Akcja `Przywróć domyślny` przywraca ten cover, jeśli istnieje; jeśli `embeddedCover` ma wartość `null`, akcja czyści ręczny wybór covera.

## Reset etapu

Docelowy kontrakt resetu etapu:

`POST /api/jobs/{jobId}/stages/{stage}/reset`

```json
{
  "resetFromStage": "separating_vocals",
  "reason": "user_requested"
}
```

Odpowiedź:

```json
{
  "jobId": "job_01J...",
  "status": "separating_vocals",
  "resetFromStage": "separating_vocals",
  "invalidatedStages": ["separating_vocals", "transcribing", "detecting_pitch", "aligning"],
  "queued": true
}
```

Zasady:

- Reset zachowuje oryginalny plik audio, zaakceptowane metadane, cover oraz aktualne ustawienia modeli i pitch, chyba że użytkownik zmieni je przed resetem.
- Reset unieważnia artefakty wybranego etapu i wszystkich dalszych etapów zależnych.
- Reset jest niedostępny podczas aktywnego przetwarzania, dopóki nie zostanie dodany osobny kontrakt anulowania albo pauzowania.
- Reset nie usuwa eksportów projektu ani paczek karaoke już pobranych przez użytkownika.

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

`TranscriptSegment` reprezentuje finalną frazę/sentencję karaoke po forced alignment i pogrupowaniu słów na podstawie dłuższych pauz. Nie musi odpowiadać jednemu surowemu segmentowi ASR z WhisperX.

```json
{
  "segmentId": "seg_001",
  "startSec": 12.34,
  "endSec": 15.87,
  "text": "pierwsza fraza tekstu",
  "confidence": 0.84,
  "requiresReview": false,
  "words": [
    {
      "wordId": "word_001",
      "startSec": 12.34,
      "endSec": 12.91,
      "text": "pierwsza",
      "confidence": 0.81,
      "requiresReview": false
    }
  ]
}
```

`requiresReview` jest ustawiane bez usuwania tekstu, jeśli segment albo słowo ma niską pewność, brakujące czasy alignacji albo inną diagnostykę wymagającą ręcznej korekty w edytorze.

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
  "requiresReview": false,
  "qualityFlags": []
}
```

## ArrangementSyllable

```json
{
  "syllableId": "syl_001",
  "text": "pierw",
  "syllableIndex": 0,
  "startSec": 12.34,
  "endSec": 12.88,
  "midi": 57,
  "noteType": "normal",
  "requiresReview": false,
  "qualityFlags": []
}
```

`ArrangementSyllable` jest podstawowym blokiem edycji karaoke. Sylaba ma własną wartość `midi` albo `null`, ale nie przechowuje `noteId`; nuty są niezależną warstwą diagnostyczną.

## ArrangementWord

```json
{
  "wordId": "word_001",
  "startSec": 12.34,
  "endSec": 13.2,
  "text": "pierwszy",
  "confidence": 0.91,
  "requiresReview": false,
  "qualityFlags": [],
  "syllables": []
}
```

## ArrangementSentence

```json
{
  "sentenceId": "sent_001",
  "startSec": 12.34,
  "endSec": 15.87,
  "text": "pierwszy wers",
  "requestedSentenceGapMs": null,
  "detectedSentenceGapMs": 720,
  "effectiveSentenceGapMs": 720,
  "requiresReview": false,
  "qualityFlags": [],
  "words": []
}
```

Reguły automatycznego szkicu:

- WhisperX dostarcza słowa i czasy słów; sentencje są agregowane z kolejnych słów według `effectiveSentenceGapMs`.
- Jeśli `requestedSentenceGapMs` jest `null`, próg sentencji jest wykrywany automatycznie z BPM i odstępów między słowami.
- Czas trwania sylab wypełnia czas trwania słowa bez przerw między sylabami.
- `midi` sylaby jest uśrednioną wartością nut przecinających jej czas trwania.
- Kolejne sylaby tego samego słowa z tą samą wartością `midi` mogą zostać scalone w szkicu.
- Jeśli sylaba nie ma wyliczonego `midi`, dostaje `missing_note` oraz `needs_syllable_review`.
- Jeśli nuta nie przecina żadnej sylaby, pozostaje w `noteEvents` jako niezależny element diagnostyczny bez flagi jakości.

`qualityFlags` oznaczają elementy do ręcznej recenzji bez usuwania danych AI. MVP używa co najmniej:

- `uncertain_pitch`: nuta ma niską pewność detekcji pitch.
- `missing_note`: sylaba nie ma wartości MIDI.
- `uncertain_text`: segment albo słowo z transkrypcji wymaga korekty.
- `needs_syllable_review`: podział sylaby, tokenu albo nuty wymaga ręcznej kontroli.

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
  "sentences": [
    {
      "sentenceId": "sent_001",
      "startSec": 12.34,
      "endSec": 15.87,
      "text": "pierwszy wers",
      "effectiveSentenceGapMs": 720,
      "requestedSentenceGapMs": null,
      "detectedSentenceGapMs": 720,
      "requiresReview": false,
      "qualityFlags": [],
      "words": []
    }
  ],
  "noteEvents": [],
  "source": "draft_ai",
  "qualitySummary": {},
  "syllabification": {
    "requestedMethod": "kokosznicka",
    "appliedMethod": "kokosznicka",
    "language": "pl",
    "languageSource": "forced",
    "fallbackReason": null,
    "packageVersions": {
      "kokosznicka": "0.2.5",
      "pyphen": "0.17.2"
    }
  }
}
```

`revision` służy do kontroli współbieżnego zapisu aktualnego stanu i nie oznacza trwałej historii wersji. Eksporter używa aktualnego zatwierdzonego `Arrangement`, jego sylab oraz `noteEvents`.

Aktywny `Arrangement` jest przechowywany wyłącznie w Postgresie. `mukai-project.json` zawiera jego serializowany snapshot na potrzeby eksportu projektu i późniejszego importu; ten snapshot nie jest osobnym źródłem prawdy podczas pracy nad aktywnym `Job`.

`Arrangement.syllabification` opisuje finalną sylabizację szkicu:

- `requestedMethod`: metoda wybrana przez użytkownika.
- `appliedMethod`: metoda faktycznie użyta przez worker.
- `language`: język użyty do wyboru metody lub słownika.
- `languageSource`: `forced`, `detected`, `alignment` albo `unknown`.
- `fallbackReason`: powód użycia heurystyki, jeśli `appliedMethod` różni się od `requestedMethod`.
- `packageVersions`: wersje pakietów sylabizacji dostępnych w obrazie workera.

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
- Sylaba musi mieć tekst.
- Sylaba eksportowana do UltraStar musi mieć wartość `midi`, chyba że jej `noteType` albo przyszły tryb eksportu pozwala na freestyle bez pitch.
- Nuta eksportowana do UltraStar musi mieć długość co najmniej jednego beatu.
- Puste frazy nie są eksportowane.
