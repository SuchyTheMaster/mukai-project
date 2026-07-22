import re
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
DEFAULT_CONFIGURATION_PRESET = "default"
AUTOMATIC_PROCESSING_MODE = "automatic"
MANUAL_PROCESSING_MODE = "manual"
ConfigurationPresetType = Literal["predefined", "custom"]


class TranscriptionSettings(BaseModel):
    vadMethod: Literal["silero", "pyannote"] = "pyannote"
    sileroThreshold: float = Field(default=0.3, gt=0.0, lt=1.0)
    sileroNegThreshold: float = Field(default=0.15, gt=0.0, lt=1.0)
    sileroMinSpeechDurationMs: int = Field(default=80, ge=0)
    sileroMinSilenceDurationMs: int = Field(default=100, ge=0)
    sileroSpeechPadMs: int = Field(default=100, ge=0)
    pyannoteVadOnset: float = Field(default=0.45, gt=0.0, lt=1.0)
    pyannoteVadOffset: float = Field(default=0.25, gt=0.0, lt=1.0)
    vadChunkSizeSec: int = Field(default=30, ge=1)
    sentenceGapMs: int | None = Field(default=None, ge=0)
    sentencePaddingMs: int = Field(default=80, ge=0)
    positioning: TranscriptionPositioning = "words_and_syllables"

    @model_validator(mode="before")
    @classmethod
    def migrate_sentence_pause_ms(cls, value):
        if not isinstance(value, dict):
            return value
        migrated = dict(value)
        if "sentenceGapMs" not in migrated and "sentencePauseMs" in migrated:
            migrated["sentenceGapMs"] = migrated.get("sentencePauseMs")
        legacy_onset = migrated.get("vadOnset")
        legacy_offset = migrated.get("vadOffset")
        if migrated.get("vadMethod", "pyannote") == "silero":
            if "sileroThreshold" not in migrated and legacy_onset is not None:
                migrated["sileroThreshold"] = legacy_onset
            if "sileroNegThreshold" not in migrated and legacy_onset is not None:
                migrated["sileroNegThreshold"] = max(float(legacy_onset) - 0.15, 0.01)
        else:
            if "pyannoteVadOnset" not in migrated and legacy_onset is not None:
                migrated["pyannoteVadOnset"] = legacy_onset
            if "pyannoteVadOffset" not in migrated and legacy_offset is not None:
                migrated["pyannoteVadOffset"] = legacy_offset
        return migrated

    @model_validator(mode="after")
    def validate_vad_hysteresis(self):
        if self.sileroNegThreshold >= self.sileroThreshold:
            raise ValueError("sileroNegThreshold must be lower than sileroThreshold")
        if self.pyannoteVadOffset >= self.pyannoteVadOnset:
            raise ValueError("pyannoteVadOffset must be lower than pyannoteVadOnset")
        return self


class PitchSettings(BaseModel):
    silenceThresholdDb: float = -48.0
    periodicityThreshold: float = 0.48
    frameStepMs: int = 10
    minNoteLengthMs: int = 75
    mergeGapMs: int = 130
    checkNoteLongerThan: int = Field(default=400, ge=0)
    silenceTresholdForNoteChecking: float = Field(default=-60.0, le=0.0)


class SyllabificationSettings(BaseModel):
    method: SyllabificationMethod = "pyphen"


class PresetConfiguration(BaseModel):
    profiles: ModelProfiles = Field(default_factory=ModelProfiles)
    transcriptionSettings: TranscriptionSettings = Field(default_factory=TranscriptionSettings)
    pitchSettings: PitchSettings = Field(default_factory=PitchSettings)
    syllabificationSettings: SyllabificationSettings = Field(default_factory=SyllabificationSettings)


class ConfigurationPresetSummary(BaseModel):
    presetId: str
    name: str
    presetType: ConfigurationPresetType
    canDelete: bool = False
    canOverwrite: bool = False
    missingFields: list[str] = Field(default_factory=list)
    invalidReason: str | None = None


class ConfigurationPresetCatalog(BaseModel):
    presets: list[ConfigurationPresetSummary] = Field(default_factory=list)


class SaveConfigurationPresetRequest(BaseModel):
    sourceJobId: str
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("name is required")
        return normalized


class OverwriteConfigurationPresetRequest(BaseModel):
    sourceJobId: str


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
    actionRequired: bool = False
    settingsForm: str | None = None
    settingsSummary: dict = Field(default_factory=dict)
    settingsConfirmedAt: datetime | None = None

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
    projectCovers: dict[str, EmbeddedCover] = Field(default_factory=dict)
    selectedCoverKind: Literal["tag", "manual"] | None = None


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
    configurationPreset: str = Field(default=DEFAULT_CONFIGURATION_PRESET, pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    configurationPresetName: str = "Domyślna"
    configurationPresetType: ConfigurationPresetType = "predefined"
    configurationFallbackFields: list[str] = Field(default_factory=list)
    processingMode: Literal["manual", "automatic"] = MANUAL_PROCESSING_MODE
    transcriptionSettings: TranscriptionSettings = Field(default_factory=TranscriptionSettings)
    pitchSettings: PitchSettings = Field(default_factory=PitchSettings)
    syllabificationSettings: SyllabificationSettings = Field(default_factory=SyllabificationSettings)
    processing: dict[str, StageSnapshot] = Field(default_factory=dict)
    retention: Retention = Field(default_factory=Retention)
    tempo: Tempo | None = None
    audio: AudioInfo | None = None
    artifacts: list[AudioAsset] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_manual_preset(cls, data):
        if not isinstance(data, dict):
            return data
        migrated = dict(data)
        preset_was_present = "configurationPreset" in migrated
        if migrated.get("configurationPreset") == "manual":
            migrated["configurationPreset"] = DEFAULT_CONFIGURATION_PRESET
            migrated["processingMode"] = MANUAL_PROCESSING_MODE
        elif "processingMode" not in migrated and preset_was_present:
            migrated["processingMode"] = AUTOMATIC_PROCESSING_MODE
        return migrated


class JobSummary(BaseModel):
    jobId: str
    sourceFilename: str | None = None
    createdAt: datetime
    updatedAt: datetime
    furthestCompletedStage: str | None = None


class JobCatalog(BaseModel):
    jobs: list[JobSummary] = Field(default_factory=list)


class DeleteJobsRequest(BaseModel):
    jobIds: list[str] = Field(min_length=1, max_length=500)
    activeJobId: str | None = Field(pattern=r"^job_[0-9a-f]{32}$")

    @field_validator("jobIds")
    @classmethod
    def normalize_job_ids(cls, values: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(values))
        if any(not re.fullmatch(r"job_[0-9a-f]{32}", value) for value in normalized):
            raise ValueError("jobIds contains an invalid job identifier")
        return normalized


class DeleteJobsResponse(BaseModel):
    deletedJobIds: list[str] = Field(default_factory=list)


class CreateJobUpload(BaseModel):
    uploadDraftId: str
    metadata: SourceMetadata
    profiles: ModelProfiles = Field(default_factory=ModelProfiles)
    configurationPreset: str = Field(default=DEFAULT_CONFIGURATION_PRESET, pattern=r"^[a-z][a-z0-9_-]{0,63}$")
    acknowledgeConfigurationFallback: bool = False
    processingMode: Literal["manual", "automatic"] = AUTOMATIC_PROCESSING_MODE
    transcriptionSettings: TranscriptionSettings = Field(default_factory=TranscriptionSettings)
    pitchSettings: PitchSettings = Field(default_factory=PitchSettings)
    syllabificationSettings: SyllabificationSettings = Field(default_factory=SyllabificationSettings)
    useEmbeddedCover: bool = True
    draftCoverKind: Literal["tag", "manual"] | None = None

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_manual_preset(cls, data):
        if not isinstance(data, dict) or data.get("configurationPreset") != "manual":
            return data
        migrated = dict(data)
        migrated["configurationPreset"] = DEFAULT_CONFIGURATION_PRESET
        migrated["processingMode"] = MANUAL_PROCESSING_MODE
        return migrated

    @model_validator(mode="after")
    def require_title_and_artist(self):
        if not (self.metadata.title or "").strip():
            raise ValueError("metadata.title is required")
        if not (self.metadata.artist or "").strip():
            raise ValueError("metadata.artist is required")
        return self


class StageSettingsRequest(BaseModel):
    metadata: SourceMetadata | None = None
    profiles: ModelProfiles | None = None
    transcriptionSettings: TranscriptionSettings | None = None
    pitchSettings: PitchSettings | None = None
    syllabificationSettings: SyllabificationSettings | None = None
    editedConfigurationFields: list[str] = Field(default_factory=list)


class UpdateJobSourceRequest(BaseModel):
    uploadDraftId: str | None = None
    metadata: SourceMetadata
    useEmbeddedCover: bool = True
    draftCoverKind: Literal["tag", "manual"] | None = None

    @model_validator(mode="after")
    def require_title_and_artist(self):
        if not (self.metadata.title or "").strip():
            raise ValueError("metadata.title is required")
        if not (self.metadata.artist or "").strip():
            raise ValueError("metadata.artist is required")
        return self


class SaveArrangementRequest(BaseModel):
    revision: int = Field(ge=1)
    arrangement: Arrangement


class ResegmentArrangementRequest(BaseModel):
    sentenceGapMs: int | None = Field(default=None, ge=0)


class ResetStageRequest(BaseModel):
    reason: str = "user_requested"
    forceManualMode: bool = False


class ApplicationResetRequest(BaseModel):
    jobId: str | None = Field(default=None, pattern=r"^job_[0-9a-f]{32}$")
    uploadDraftId: str | None = Field(default=None, pattern=r"^draft_[0-9a-f]{32}$")
    deleteJob: bool = True


class ApplicationResetResponse(BaseModel):
    reset: bool = True


class ResetStageResponse(BaseModel):
    jobId: str
    status: JobStatus
    resetFromStage: str
    invalidatedStages: list[str]
    queued: bool


ExportIssueSeverity = Literal["error", "warning"]


class ExportAudioFilenames(BaseModel):
    audio: str | None = None
    instrumental: str | None = None
    vocals: str | None = None


class ExportSelection(BaseModel):
    packageName: str | None = None
    internalDirectoryName: str
    baseFilename: str
    zipNamePattern: str = "{baseFilename} [karaoke].zip"
    audioFilenames: ExportAudioFilenames = Field(default_factory=ExportAudioFilenames)
    coverAssetId: str | None = None

    @field_validator("internalDirectoryName", "baseFilename")
    @classmethod
    def non_blank_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be blank")
        return value


class ExportValidationIssue(BaseModel):
    severity: ExportIssueSeverity
    code: str
    message: str
    details: dict = Field(default_factory=dict)


class ExportValidationReport(BaseModel):
    jobId: str
    valid: bool
    selection: ExportSelection
    errors: list[ExportValidationIssue] = Field(default_factory=list)
    warnings: list[ExportValidationIssue] = Field(default_factory=list)
    generatedAt: datetime = Field(default_factory=utc_now)


class ExportArtifactRef(BaseModel):
    assetId: str
    type: str
    filename: str


class ExportKaraokeResponse(BaseModel):
    jobId: str
    status: JobStatus
    validationReport: ExportValidationReport
    validationArtifact: ExportArtifactRef
    exports: list[ExportArtifactRef] = Field(default_factory=list)


ProjectPhase = Literal["draft", "processing", "review"]


class ProjectClientState(BaseModel):
    workingState: dict = Field(default_factory=dict)
    editorWorkspace: dict | None = None


class ProjectArchiveRef(BaseModel):
    filename: str
    downloadUrl: str
    sha256: str
    sizeBytes: int


class ProjectArchiveResponse(BaseModel):
    phase: ProjectPhase
    archive: ProjectArchiveRef
    resumeStage: str | None = None


class ProjectImportResponse(BaseModel):
    phase: ProjectPhase
    inspection: UploadInspection | None = None
    job: Job | None = None
    workingState: dict = Field(default_factory=dict)
    editorWorkspace: dict | None = None
    resumeStage: str | None = None
    autoResume: bool = False
    queued: bool = False


STAGE_ORDER = [
    ("uploaded", "source", "Źródło", "api"),
    ("preprocessing", "ffmpeg", "Preprocessing audio", "orchestrator"),
    ("detecting_bpm", "essentia", "Rozpoznawanie BPM", "orchestrator"),
    ("separating_vocals", "demucs", "Separacja wokalu", "worker-separate-stems"),
    ("transcribing", "whisperx", "Transkrypcja", "worker-transcribe"),
    ("detecting_pitch", "pitch_detection", "Detekcja tonów", "worker-pitch"),
    ("aligning", "draft", "Wstępne dopasowanie", "worker-aligner"),
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
