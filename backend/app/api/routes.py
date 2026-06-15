import json
from pathlib import Path

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import FileResponse, Response

from app.core.config import get_settings
from app.core.errors import api_error
from app.db import repository
from app.domain.contracts import (
    Arrangement,
    AudioAsset,
    CreateJobUpload,
    EmbeddedCover,
    JobStatus,
    NoteEvent,
    ResetStageRequest,
    ResetStageResponse,
    ResegmentArrangementRequest,
    SaveArrangementRequest,
    StageStatus,
    TranscriptSegment,
    UploadInspection,
    final_transcription_settings,
    initial_processing,
    stage_key,
    utc_now,
)
from app.services import audio_probe
from app.services.ids import new_id
from app.services.queue import enqueue_job, redis_client
from app.services.storage import (
    read_json,
    relative_to_root,
    resolve_inside,
    safe_filename,
    save_upload,
    sha256_file,
    write_json,
)
from app.workers.pitch import build_arrangement, resolve_syllabification_language
from app.workers.transcribe import build_sentence_segments, estimate_auto_sentence_gap

router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> dict:
    checks = {"api": "ok", "postgres": "ok", "redis": "ok"}
    try:
        from app.db.database import get_conn

        with get_conn() as conn:
            conn.execute("SELECT 1").fetchone()
    except Exception as exc:  # pragma: no cover - health reports diagnostics
        checks["postgres"] = f"error: {type(exc).__name__}"
    try:
        redis_client().ping()
    except Exception as exc:  # pragma: no cover
        checks["redis"] = f"error: {type(exc).__name__}"
    return checks


@router.post("/uploads/inspect", response_model=UploadInspection)
async def inspect_upload(file: UploadFile = File(...)) -> UploadInspection:
    original = safe_filename(file.filename)
    audio_probe.validate_extension(original)
    audio_probe.validate_mime(original, file.content_type)

    draft_id = new_id("draft")
    draft_dir = resolve_inside(f"drafts/{draft_id}")
    source_path = draft_dir / original
    size = await save_upload(file, source_path, get_settings().max_upload_bytes)
    audio = audio_probe.ffprobe(source_path)
    metadata, cover = audio_probe.read_tags(source_path)

    embedded_cover = None
    cover_payload = None
    if cover:
        mime_type, data = cover
        cover_id = new_id("cover")
        cover_name = f"{cover_id}{audio_probe.cover_extension(mime_type)}"
        cover_path = draft_dir / cover_name
        cover_path.write_bytes(data)
        embedded_cover = EmbeddedCover(
            coverDraftId=cover_id,
            mimeType=mime_type,
            sizeBytes=len(data),
            previewUrl=f"/api/uploads/drafts/{draft_id}/cover",
        )
        cover_payload = {
            "coverDraftId": cover_id,
            "path": relative_to_root(cover_path),
            "mimeType": mime_type,
            "sizeBytes": len(data),
        }

    write_json(
        draft_dir / "draft.json",
        {
            "uploadDraftId": draft_id,
            "originalFilename": original,
            "sourcePath": relative_to_root(source_path),
            "sizeBytes": size,
            "audio": audio.model_dump(),
            "metadata": metadata.model_dump(),
            "embeddedCover": cover_payload,
        },
    )
    return UploadInspection(
        uploadDraftId=draft_id,
        originalFilename=original,
        audio=audio,
        metadata=metadata,
        embeddedCover=embedded_cover,
    )


@router.get("/uploads/drafts/{draft_id}/cover")
def draft_cover(draft_id: str) -> Response:
    draft_path = resolve_inside(f"drafts/{draft_id}/draft.json")
    if not draft_path.exists():
        raise api_error(404, "draft_not_found", "Draft uploadu nie istnieje.")
    draft = read_json(draft_path)
    cover = draft.get("embeddedCover")
    if not cover:
        raise api_error(404, "cover_not_found", "Draft nie zawiera covera.")
    cover_path = resolve_inside(cover["path"])
    return FileResponse(cover_path, media_type=cover["mimeType"])


@router.post("/jobs/uploads")
async def create_job_from_upload(payload: str = Form(...), cover: UploadFile | None = File(default=None)):
    request = CreateJobUpload.model_validate_json(payload)
    draft_path = resolve_inside(f"drafts/{request.uploadDraftId}/draft.json")
    if not draft_path.exists():
        raise api_error(404, "draft_not_found", "Nie znaleziono zaakceptowanego draftu uploadu.")
    draft = read_json(draft_path)
    job_id = new_id("job")
    job_dir = resolve_inside(f"jobs/{job_id}")
    source_src = resolve_inside(draft["sourcePath"])
    source_dst = job_dir / "source" / safe_filename(draft["originalFilename"])
    source_dst.parent.mkdir(parents=True, exist_ok=True)
    source_src.replace(source_dst)
    transcription_settings = final_transcription_settings(request.transcriptionSettings, request.syllabificationSettings)

    processing = initial_processing()
    upload_key = stage_key("uploaded", "source")
    processing[upload_key].status = StageStatus.completed
    processing[upload_key].startedAt = utc_now()
    processing[upload_key].finishedAt = utc_now()
    processing[upload_key].progressMode = "determinate"
    processing[upload_key].progressPercent = 100

    repository.create_job(
        job_id=job_id,
        metadata=request.metadata,
        profiles=request.profiles,
        transcription_settings=transcription_settings,
        pitch_settings=request.pitchSettings,
        syllabification_settings=request.syllabificationSettings,
        processing=processing,
        audio=draft["audio"],
    )
    source_asset = AudioAsset(
        assetId=new_id("asset"),
        type="source_audio",
        path=relative_to_root(source_dst),
        originalFilename=draft["originalFilename"],
        durationSec=draft["audio"].get("durationSec"),
        sampleRate=draft["audio"].get("sampleRate"),
        channels=draft["audio"].get("channels"),
        sha256=sha256_file(source_dst),
        mimeType=None,
        sizeBytes=source_dst.stat().st_size,
        producedByStage="uploaded",
        producedBySubstep="source",
        metadata={"immutable": True},
    )
    repository.create_artifact(job_id, source_asset)
    processing[upload_key].artifactIds = [source_asset.assetId]

    cover_asset_id = None
    if cover:
        cover_name = safe_filename(cover.filename, "cover")
        cover_path = job_dir / "assets" / cover_name
        size = await save_upload(cover, cover_path, 25 * 1024 * 1024)
        cover_asset_id = _save_cover_asset(job_id, cover_path, cover_name, cover.content_type, size, "manual_upload")
    elif request.useEmbeddedCover and draft.get("embeddedCover"):
        cover_src = resolve_inside(draft["embeddedCover"]["path"])
        cover_dst = job_dir / "assets" / Path(cover_src).name
        cover_dst.parent.mkdir(parents=True, exist_ok=True)
        cover_src.replace(cover_dst)
        cover_asset_id = _save_cover_asset(job_id, cover_dst, Path(cover_dst).name, draft["embeddedCover"]["mimeType"], cover_dst.stat().st_size, "audio_tags")

    if cover_asset_id:
        processing[upload_key].artifactIds.append(cover_asset_id)
    repository.update_processing(job_id, processing)
    enqueue_job(job_id)
    return repository.get_job(job_id)


def _save_cover_asset(job_id: str, path: Path, filename: str, mime_type: str | None, size: int, source: str) -> str:
    asset_id = new_id("asset")
    repository.create_artifact(
        job_id,
        AudioAsset(
            assetId=asset_id,
            type="cover",
            path=relative_to_root(path),
            originalFilename=filename,
            sha256=sha256_file(path),
            mimeType=mime_type,
            sizeBytes=size,
            producedByStage="uploaded",
            producedBySubstep="source",
            metadata={"source": source},
        ),
    )
    return asset_id


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    job = repository.get_job(job_id)
    if not job:
        raise api_error(404, "job_not_found", "Job nie istnieje.")
    return job


@router.get("/jobs/{job_id}/arrangement", response_model=Arrangement)
def get_arrangement(job_id: str) -> Arrangement:
    arrangement = repository.get_arrangement(job_id)
    if not arrangement:
        raise api_error(404, "arrangement_not_found", "Arrangement nie istnieje dla tego joba.")
    return arrangement


@router.put("/jobs/{job_id}/arrangement", response_model=Arrangement)
def save_arrangement(job_id: str, request: SaveArrangementRequest) -> Arrangement:
    job = repository.get_job(job_id)
    if not job:
        raise api_error(404, "job_not_found", "Job nie istnieje.")
    if job.status != JobStatus.awaiting_review:
        raise api_error(409, "job_not_editable", "Arrangement mozna zapisac tylko w statusie awaiting_review.")
    current = repository.get_arrangement(job_id)
    if not current:
        raise api_error(404, "arrangement_not_found", "Arrangement nie istnieje dla tego joba.")
    if request.arrangement.jobId != job_id:
        raise api_error(400, "job_mismatch", "Arrangement nalezy do innego joba.")
    if request.arrangement.arrangementId != current.arrangementId:
        raise api_error(400, "arrangement_mismatch", "Nieprawidlowy identyfikator arrangementu.")
    if request.arrangement.revision != request.revision:
        raise api_error(400, "revision_mismatch", "Revision w payloadzie nie zgadza sie z aktualizowanym arrangementem.")
    saved = repository.update_arrangement_if_revision(job_id, request.arrangement, request.revision)
    if not saved:
        latest = repository.get_arrangement(job_id)
        raise api_error(
            409,
            "revision_conflict",
            "Arrangement zostal zmieniony w innej sesji. Odswiez dane przed ponownym zapisem.",
            {"currentRevision": latest.revision if latest else None},
        )
    return saved


@router.post("/jobs/{job_id}/arrangement/resegment", response_model=Arrangement)
def resegment_arrangement(job_id: str, request: ResegmentArrangementRequest) -> Arrangement:
    job = repository.get_job(job_id)
    if not job:
        raise api_error(404, "job_not_found", "Job nie istnieje.")
    if job.status != JobStatus.awaiting_review:
        raise api_error(409, "job_not_editable", "Arrangement mozna przeliczyc tylko w statusie awaiting_review.")

    transcript_asset = next((asset for asset in job.artifacts if asset.type == "transcript_aligned"), None)
    notes_asset = next((asset for asset in job.artifacts if asset.type == "pitch_notes"), None)
    if not transcript_asset or not notes_asset:
        raise api_error(409, "missing_artifacts", "Brakuje transcript.aligned.json albo pitch.notes.json do ponownej agregacji.")

    transcript_payload = read_json(resolve_inside(transcript_asset.path))
    notes_payload = read_json(resolve_inside(notes_asset.path))
    aligned_segments = [TranscriptSegment.model_validate(segment) for segment in transcript_payload.get("segments", [])]
    transcription_settings = job.transcriptionSettings.model_copy(update={"sentenceGapMs": request.sentenceGapMs})
    segments = build_sentence_segments(
        aligned_segments,
        transcription_settings,
        get_settings().transcription_low_confidence_threshold,
        detected_song_bpm=job.tempo.detectedSongBpm if job.tempo else None,
    )
    detected_gap_ms = estimate_auto_sentence_gap(aligned_segments, job.tempo.detectedSongBpm if job.tempo else None)
    effective_gap_ms = request.sentenceGapMs if request.sentenceGapMs is not None else detected_gap_ms
    notes = [NoteEvent.model_validate(note) for note in notes_payload.get("noteEvents", [])]
    language, language_source = resolve_syllabification_language(job, transcript_payload)
    arrangement = build_arrangement(
        job_id,
        segments,
        notes,
        syllabification_settings=job.syllabificationSettings,
        language=language,
        language_source=language_source,
        prefer_char_timings=job.transcriptionSettings.positioning == "words_and_syllables",
        requested_sentence_gap_ms=request.sentenceGapMs,
        detected_sentence_gap_ms=detected_gap_ms,
        effective_sentence_gap_ms=effective_gap_ms,
    )
    return repository.save_arrangement(job_id, arrangement)


@router.get("/jobs/{job_id}/artifacts/{asset_id}")
def download_artifact(job_id: str, asset_id: str):
    asset = repository.get_artifact(job_id, asset_id)
    if not asset:
        raise api_error(404, "artifact_not_found", "Artefakt nie istnieje dla tego joba.")
    path = resolve_inside(asset.path)
    if not path.exists():
        raise api_error(404, "artifact_missing", "Plik artefaktu nie istnieje w magazynie.")
    return FileResponse(path, media_type=asset.mimeType or "application/octet-stream", filename=asset.originalFilename or path.name)


@router.post("/jobs/{job_id}/stages/{stage}/reset", response_model=ResetStageResponse)
def reset_stage(job_id: str, stage: str, request: ResetStageRequest):
    job = repository.get_job(job_id)
    if not job:
        raise api_error(404, "job_not_found", "Job nie istnieje.")
    if any(snapshot.status == StageStatus.running for snapshot in job.processing.values()):
        raise api_error(409, "job_running", "Reset jest niedostepny podczas aktywnego przetwarzania.")
    stage_names = ["preprocessing", "detecting_bpm", "separating_vocals", "transcribing", "detecting_pitch", "aligning"]
    if stage not in stage_names:
        raise api_error(400, "invalid_stage", "Nieprawidlowy etap resetu.")
    invalidated = stage_names[stage_names.index(stage) :]
    repository.invalidate_from_stage(job_id, invalidated)
    for key, snapshot in job.processing.items():
        if snapshot.stage in invalidated:
            snapshot.status = StageStatus.pending
            snapshot.startedAt = None
            snapshot.finishedAt = None
            snapshot.progressMode = "indeterminate"
            snapshot.progressPercent = None
            snapshot.etaSec = None
            snapshot.logExcerpt = None
            snapshot.artifactIds = []
    repository.update_processing(job_id, job.processing)
    repository.update_job_status(job_id, JobStatus(stage))
    enqueue_job(job_id, start_stage=stage)
    return ResetStageResponse(jobId=job_id, status=JobStatus(stage), resetFromStage=stage, invalidatedStages=invalidated, queued=True)
