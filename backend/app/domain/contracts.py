from datetime import datetime, timezone
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class JobStatus(StrEnum):
    uploaded = "uploaded"
    preprocessing = "preprocessing"
    detecting_bpm = "detecting_bpm"
    separating_vocals = "separating_vocals"
    transcribing = "transcribing"
    detecting_pitch = "detecting_pitch"
    aligning = "aligning"
    awaiting_review = "awaiting_review"
    exporting = "exporting"
    exporting_project = "exporting_project"
    importing_project = "importing_project"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class StageStatus(StrEnum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    skipped = "skipped"


class ProgressMode(StrEnum):
    determinate = "determinate"
    estimated = "estimated"
    indeterminate = "indeterminate"


class SourceMetadata(BaseModel):
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    year: str | None = None
    genre: str | None = None
    language: str | None = None
    languageMode: Literal["forced", "auto"] = "auto"
    source: str = "manual"
    tagEncoding: Literal["utf8", "utf16", "mixed", "unknown"] = "unknown"
    missingFields: list[str] = Field(default_factory=list)


class ModelProfiles(BaseModel):
    separationModel: Literal["htdemucs", "htdemucs_ft"] = "htdemucs_ft"
    transcriptionModel: Literal["large-v3", "large-v3-turbo"] = "large-v3"
    pitch: str = "default"


SyllabificationMethod = Literal["kokosznicka", "pyphen", "heuristic", "none"]
SyllabificationLanguageSource = Literal["forced", "detected", "alignment", "unknown"]
TranscriptionPositioning = Literal["words_and_syllables", "words_only"]


class TranscriptionSettings(BaseModel):
    vadMethod: Literal["silero", "pyannote"] = "silero"
    vadOnset: float = Field(default=0.5, gt=0.0, lt=1.0)
    vadOffset: float = Field(default=0.363, gt=0.0, lt=1.0)
    vadChunkSizeSec: int = Field(default=30, ge=1)
    sentenceGapMs: int | None = Field(default=None, ge=0)
    sentencePaddingMs: int = Field(default=80, ge=0)
    positioning: TranscriptionPositioning = "words_and_syllables"

    @model_validator(mode="before")
    @classmethod
    def migrate_sentence_pause_ms(cls, value):
        if isinstance(value, dict) and "sentenceGapMs" not in value and "sentencePauseMs" in value:
            return value | {"sentenceGapMs": value.get("sentencePauseMs")}
        return value


class PitchSettings(BaseModel):
    silenceThresholdDb: float = -42.0
    periodicityThreshold: float = 0.55
    frameStepMs: int = 10
    minNoteLengthMs: int = 120
    mergeGapMs: int = 90


class SyllabificationSettings(BaseModel):
    method: SyllabificationMethod = "pyphen"


def final_transcription_settings(
    transcription_settings: TranscriptionSettings,
    syllabification_settings: SyllabificationSettings,
) -> TranscriptionSettings:
    if syllabification_settings.method == "none":
        return transcription_settings.model_copy(update={"positioning": "words_only"})
    return transcription_settings


class StageSnapshot(BaseModel):
    stage: str
    substep: str
    status: StageStatus
    startedAt: datetime | None = None
    finishedAt: datetime | None = None
    progressMode: ProgressMode = ProgressMode.indeterminate
    progressPercent: int | None = None
    etaSec: int | None = None
    message: str
    logExcerpt: str | None = None
    artifactIds: list[str] = Field(default_factory=list)
    workerRole: str

    @field_validator("progressPercent")
    @classmethod
    def progress_in_range(cls, value: int | None) -> int | None:
        if value is not None and not 0 <= value <= 100:
            raise ValueError("progressPercent must be in 0..100")
        return value


class AudioInfo(BaseModel):
    durationSec: float | None = None
    sampleRate: int | None = None
    channels: int | None = None
    codec: str | None = None
    container: str | None = None


class EmbeddedCover(BaseModel):
    coverDraftId: str
    mimeType: str
    sizeBytes: int
    previewUrl: str
    source: str = "audio_tags"


class UploadInspection(BaseModel):
    uploadDraftId: str
    originalFilename: str
    audio: AudioInfo
    metadata: SourceMetadata
    embeddedCover: EmbeddedCover | None = None


class Retention(BaseModel):
    projectExportedAt: datetime | None = None
    cleanupEligibleAt: datetime | None = None
    cleanupReason: str | None = None


class AudioAsset(BaseModel):
    assetId: str
    type: str
    path: str
    originalFilename: str | None = None
    durationSec: float | None = None
    sampleRate: int | None = None
    channels: int | None = None
    sha256: str | None = None
    mimeType: str | None = None
    sizeBytes: int | None = None
    producedByStage: str
    producedBySubstep: str
    metadata: dict = Field(default_factory=dict)


class Tempo(BaseModel):
    detectedSongBpm: float
    acceptedSongBpm: float
    ultrastarBpm: float
    gapMs: int = 0
    confidence: float | None = None
    method: str = "auto_detected"
    requiresReview: bool = False
    beatPositionsSec: list[float] = Field(default_factory=list)
    alternatives: list[float] = Field(default_factory=list)


class TranscriptChar(BaseModel):
    char: str
    startSec: float
    endSec: float
    confidence: float | None = None

    @field_validator("endSec")
    @classmethod
    def char_end_after_start(cls, value: float, info) -> float:
        start = info.data.get("startSec")
        if start is not None and value <= start:
            raise ValueError("endSec must be greater than startSec")
        return value


class TranscriptWord(BaseModel):
    wordId: str
    startSec: float
    endSec: float
    text: str
    confidence: float | None = None
    requiresReview: bool = False
    chars: list[TranscriptChar] = Field(default_factory=list)

    @field_validator("endSec")
    @classmethod
    def word_end_after_start(cls, value: float, info) -> float:
        start = info.data.get("startSec")
        if start is not None and value <= start:
            raise ValueError("endSec must be greater than startSec")
        return value


class TranscriptSegment(BaseModel):
    segmentId: str
    startSec: float
    endSec: float
    text: str
    confidence: float | None = None
    requiresReview: bool = False
    words: list[TranscriptWord] = Field(default_factory=list)

    @field_validator("endSec")
    @classmethod
    def segment_end_after_start(cls, value: float, info) -> float:
        start = info.data.get("startSec")
        if start is not None and value <= start:
            raise ValueError("endSec must be greater than startSec")
        return value


class PitchFrame(BaseModel):
    timeSec: float
    frequencyHz: float | None = None
    midi: float | None = None
    periodicity: float | None = None
    voiced: bool = False
    loudnessDb: float | None = None


class NoteEvent(BaseModel):
    noteId: str
    startSec: float
    endSec: float
    midi: int
    frequencyHz: float
    confidence: float | None = None
    source: Literal["pitch_ai", "manual"] = "pitch_ai"
    requiresReview: bool = False
    qualityFlags: list[str] = Field(default_factory=list)

    @field_validator("endSec")
    @classmethod
    def note_end_after_start(cls, value: float, info) -> float:
        start = info.data.get("startSec")
        if start is not None and value <= start:
            raise ValueError("endSec must be greater than startSec")
        return value


NoteType = Literal["normal", "golden", "freestyle", "rap", "rap_golden"]


class ArrangementSyllable(BaseModel):
    syllableId: str
    text: str
    syllableIndex: int = 0
    startSec: float
    endSec: float
    midi: int | None = None
    noteType: NoteType = "normal"
    requiresReview: bool = False
    qualityFlags: list[str] = Field(default_factory=list)

    @field_validator("endSec")
    @classmethod
    def syllable_end_after_start(cls, value: float, info) -> float:
        start = info.data.get("startSec")
        if start is not None and value <= start:
            raise ValueError("endSec must be greater than startSec")
        return value


class ArrangementWord(BaseModel):
    wordId: str
    startSec: float
    endSec: float
    text: str
    confidence: float | None = None
    requiresReview: bool = False
    qualityFlags: list[str] = Field(default_factory=list)
    syllables: list[ArrangementSyllable] = Field(default_factory=list)

    @field_validator("endSec")
    @classmethod
    def word_end_after_start(cls, value: float, info) -> float:
        start = info.data.get("startSec")
        if start is not None and value <= start:
            raise ValueError("endSec must be greater than startSec")
        return value


class ArrangementSentence(BaseModel):
    sentenceId: str
    startSec: float
    endSec: float
    text: str
    effectiveSentenceGapMs: int | None = None
    requestedSentenceGapMs: int | None = None
    detectedSentenceGapMs: int | None = None
    requiresReview: bool = False
    qualityFlags: list[str] = Field(default_factory=list)
    words: list[ArrangementWord] = Field(default_factory=list)

    @field_validator("endSec")
    @classmethod
    def sentence_end_after_start(cls, value: float, info) -> float:
        start = info.data.get("startSec")
        if start is not None and value <= start:
            raise ValueError("endSec must be greater than startSec")
        return value


class SyllabificationInfo(BaseModel):
    requestedMethod: SyllabificationMethod
    appliedMethod: SyllabificationMethod
    language: str | None = None
    languageSource: SyllabificationLanguageSource = "unknown"
    fallbackReason: str | None = None
    packageVersions: dict[str, str | None] = Field(default_factory=dict)


class Arrangement(BaseModel):
    arrangementId: str
    jobId: str
    revision: int = 1
    approved: bool = False
    updatedAt: datetime = Field(default_factory=utc_now)
    sentences: list[ArrangementSentence] = Field(default_factory=list)
    noteEvents: list[NoteEvent] = Field(default_factory=list)
    source: Literal["draft_ai", "manual", "imported"] = "draft_ai"
    qualitySummary: dict[str, int] = Field(default_factory=dict)
    syllabification: SyllabificationInfo | None = None


class Job(BaseModel):
    jobId: str
    status: JobStatus
    createdAt: datetime
    updatedAt: datetime
    metadata: SourceMetadata
    profiles: ModelProfiles
    transcriptionSettings: TranscriptionSettings = Field(default_factory=TranscriptionSettings)
    pitchSettings: PitchSettings = Field(default_factory=PitchSettings)
    syllabificationSettings: SyllabificationSettings = Field(default_factory=SyllabificationSettings)
    processing: dict[str, StageSnapshot] = Field(default_factory=dict)
    retention: Retention = Field(default_factory=Retention)
    tempo: Tempo | None = None
    audio: AudioInfo | None = None
    artifacts: list[AudioAsset] = Field(default_factory=list)


class CreateJobUpload(BaseModel):
    uploadDraftId: str
    metadata: SourceMetadata
    profiles: ModelProfiles = Field(default_factory=ModelProfiles)
    transcriptionSettings: TranscriptionSettings = Field(default_factory=TranscriptionSettings)
    pitchSettings: PitchSettings = Field(default_factory=PitchSettings)
    syllabificationSettings: SyllabificationSettings = Field(default_factory=SyllabificationSettings)
    useEmbeddedCover: bool = True


class SaveArrangementRequest(BaseModel):
    revision: int = Field(ge=1)
    arrangement: Arrangement


class ResegmentArrangementRequest(BaseModel):
    sentenceGapMs: int | None = Field(default=None, ge=0)


class ResetStageRequest(BaseModel):
    reason: str = "user_requested"


class ResetStageResponse(BaseModel):
    jobId: str
    status: JobStatus
    resetFromStage: str
    invalidatedStages: list[str]
    queued: bool


STAGE_ORDER = [
    ("uploaded", "source", "Źródło", "api"),
    ("preprocessing", "ffmpeg", "Preprocessing audio", "orchestrator"),
    ("detecting_bpm", "essentia", "Rozpoznawanie BPM", "orchestrator"),
    ("separating_vocals", "demucs", "Separacja wokalu", "worker-separate-stems"),
    ("transcribing", "whisperx", "Transkrypcja", "worker-transcribe"),
    ("detecting_pitch", "pitch_detection", "Detekcja pitch", "worker-pitch"),
    ("aligning", "draft", "Szkic arrangement", "worker-aligner"),
]


def stage_key(stage: str, substep: str) -> str:
    return f"{stage}.{substep}"


def initial_processing() -> dict[str, StageSnapshot]:
    return {
        stage_key(stage, substep): StageSnapshot(
            stage=stage,
            substep=substep,
            status=StageStatus.pending,
            progressMode=ProgressMode.indeterminate,
            message=message,
            workerRole=worker,
        )
        for stage, substep, message, worker in STAGE_ORDER
    }
