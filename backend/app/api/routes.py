import json
from pathlib import Path

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import FileResponse, Response

from app.core.config import get_settings
from app.core.errors import api_error
from app.db import repository
from app.domain.contracts import (
    ApplicationResetRequest,
    ApplicationResetResponse,
    Arrangement,
    AudioAsset,
    CreateJobUpload,
    EmbeddedCover,
    ExportKaraokeResponse,
    ExportSelection,
    ExportValidationReport,
    JobStatus,
    NoteEvent,
    PitchFrame,
    ProjectArchiveResponse,
    ProjectClientState,
    ProjectImportResponse,
    ResetStageRequest,
    ResetStageResponse,
    ResegmentArrangementRequest,
    SaveArrangementRequest,
    StageSettingsRequest,
    StageStatus,
    TranscriptSegment,
    UpdateJobSourceRequest,
    UploadInspection,
    final_transcription_settings,
    initial_processing,
    stage_key,
    utc_now,
)
from app.services import audio_probe
from app.services.ids import new_id
from app.services.queue import enqueue_job, enqueue_pitch, enqueue_separation, enqueue_transcription, redis_client
from app.services.project_archive import generate_draft_archive, generate_job_archive, import_project_archive
from app.services.storage import (
    purge_tree,
    read_json,
    relative_to_root,
    resolve_inside,
    safe_filename,
    save_upload,
    sha256_file,
    write_json,
)
from app.services.ultrastar_export import (
    export_ref,
    generate_karaoke_exports,
    validate_export,
    write_validation_report_artifact,
)
from app.workers.pitch import build_arrangement, resolve_syllabification_language
from app.workers.stages import require_stage_settings
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


@router.get("/uploads/drafts/{draft_id}/cover/{kind}")
def project_draft_cover(draft_id: str, kind: str) -> Response:
    if kind not in {"tag", "manual"}:
        raise api_error(404, "cover_not_found", "Nieznany wariant covera.")
    draft_path = resolve_inside(f"drafts/{draft_id}/draft.json")
    if not draft_path.exists():
        raise api_error(404, "draft_not_found", "Draft uploadu nie istnieje.")
    draft = read_json(draft_path)
    cover = draft.get("embeddedCover" if kind == "tag" else "manualCover")
    if not cover:
        raise api_error(404, "cover_not_found", "Draft nie zawiera wybranego covera.")
    return FileResponse(resolve_inside(cover["path"]), media_type=cover.get("mimeType") or "application/octet-stream")


@router.post("/uploads/drafts/{draft_id}/manual-cover", response_model=EmbeddedCover)
async def save_draft_manual_cover(draft_id: str, cover: UploadFile = File(...)) -> EmbeddedCover:
    draft_path = resolve_inside(f"drafts/{draft_id}/draft.json")
    if not draft_path.exists():
        raise api_error(404, "draft_not_found", "Draft uploadu nie istnieje.")
    draft = read_json(draft_path)
    name = safe_filename(cover.filename, "manual-cover")
    path = resolve_inside(f"drafts/{draft_id}/manual-cover{Path(name).suffix.lower() or '.bin'}")
    size = await save_upload(cover, path, 25 * 1024 * 1024)
    draft["manualCover"] = {
        "path": relative_to_root(path),
        "filename": name,
        "mimeType": cover.content_type,
        "sizeBytes": size,
    }
    write_json(draft_path, draft)
    return EmbeddedCover(
        coverDraftId=f"manual_{draft_id}",
        mimeType=cover.content_type or "application/octet-stream",
        sizeBytes=size,
        previewUrl=f"/api/uploads/drafts/{draft_id}/cover/manual",
        source="manual_upload",
    )


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
    processing[upload_key].settingsConfirmedAt = utc_now()
    processing[upload_key].settingsSummary = _settings_summary_for_config(
        "uploaded",
        request.metadata,
        request.profiles,
        transcription_settings,
        request.pitchSettings,
        request.syllabificationSettings,
    )

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
    cover_payload = None
    cover_kind = None
    if cover:
        cover_name = safe_filename(cover.filename, "cover")
        cover_path = job_dir / "assets" / cover_name
        size = await save_upload(cover, cover_path, 25 * 1024 * 1024)
        cover_asset_id = _save_cover_asset(job_id, cover_path, cover_name, cover.content_type, size, "manual_upload")
    else:
        cover_kind = request.draftCoverKind or ("tag" if request.useEmbeddedCover else None)
        cover_payload = draft.get("manualCover") if cover_kind == "manual" else draft.get("embeddedCover") if cover_kind == "tag" else None
    if not cover and cover_payload:
        cover_src = resolve_inside(cover_payload["path"])
        cover_dst = job_dir / "assets" / Path(cover_src).name
        cover_dst.parent.mkdir(parents=True, exist_ok=True)
        cover_src.replace(cover_dst)
        cover_asset_id = _save_cover_asset(job_id, cover_dst, Path(cover_dst).name, cover_payload.get("mimeType"), cover_dst.stat().st_size, "manual_upload" if cover_kind == "manual" else "audio_tags")

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


@router.post("/jobs/{job_id}/source")
async def update_job_source(job_id: str, payload: str = Form(...), cover: UploadFile | None = File(default=None)):
    job = repository.get_job(job_id)
    if not job:
        raise api_error(404, "job_not_found", "Job nie istnieje.")
    _ensure_not_running(job)

    request = UpdateJobSourceRequest.model_validate_json(payload)
    changed_stages: list[str] = []
    if _metadata_language(job.metadata) != _metadata_language(request.metadata):
        changed_stages = _merge_stages(changed_stages, ["transcribing", "aligning"])

    draft = None
    if request.uploadDraftId:
        draft_path = resolve_inside(f"drafts/{request.uploadDraftId}/draft.json")
        if not draft_path.exists():
            raise api_error(404, "draft_not_found", "Nie znaleziono zaakceptowanego draftu uploadu.")
        draft = read_json(draft_path)
        changed_stages = _merge_stages(changed_stages, _stages_from("preprocessing"))

    repository.update_job_config(job_id, metadata=request.metadata)

    upload_key = stage_key("uploaded", "source")
    processing = job.processing
    source_artifact_ids = []
    if draft:
        job_dir = resolve_inside(f"jobs/{job_id}")
        source_src = resolve_inside(draft["sourcePath"])
        source_dst = job_dir / "source" / safe_filename(draft["originalFilename"])
        source_dst.parent.mkdir(parents=True, exist_ok=True)
        source_src.replace(source_dst)
        repository.delete_artifacts_by_type(job_id, ["source_audio"])
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
        repository.update_job_config(job_id, audio=draft["audio"])
        source_artifact_ids.append(source_asset.assetId)
    else:
        source_artifact_ids.extend(asset.assetId for asset in job.artifacts if asset.type == "source_audio")

    replace_cover = cover is not None or bool(draft)
    if replace_cover:
        repository.delete_artifacts_by_type(job_id, ["cover"])
        if cover:
            cover_name = safe_filename(cover.filename, "cover")
            cover_path = resolve_inside(f"jobs/{job_id}/assets/{cover_name}")
            size = await save_upload(cover, cover_path, 25 * 1024 * 1024)
            source_artifact_ids.append(_save_cover_asset(job_id, cover_path, cover_name, cover.content_type, size, "manual_upload"))
        elif draft and request.useEmbeddedCover:
            cover_kind = request.draftCoverKind or "tag"
            draft_cover = draft.get("manualCover") if cover_kind == "manual" else draft.get("embeddedCover")
            if draft_cover:
                cover_src = resolve_inside(draft_cover["path"])
                cover_dst = resolve_inside(f"jobs/{job_id}/assets/{Path(cover_src).name}")
                cover_dst.parent.mkdir(parents=True, exist_ok=True)
                cover_src.replace(cover_dst)
                source_artifact_ids.append(_save_cover_asset(job_id, cover_dst, Path(cover_dst).name, draft_cover.get("mimeType"), cover_dst.stat().st_size, "manual_upload" if cover_kind == "manual" else "audio_tags"))
    else:
        source_artifact_ids.extend(asset.assetId for asset in job.artifacts if asset.type == "cover")

    processing[upload_key].artifactIds = source_artifact_ids
    processing[upload_key].settingsConfirmedAt = utc_now()
    processing[upload_key].settingsSummary = _settings_summary_for_config(
        "uploaded",
        request.metadata,
        job.profiles,
        job.transcriptionSettings,
        job.pitchSettings,
        job.syllabificationSettings,
    )
    repository.update_processing(job_id, processing)

    should_queue = bool(draft) or _should_queue_invalidated(job, changed_stages)
    invalidated = _invalidate_stages(job_id, changed_stages)
    queued = bool(invalidated) and should_queue
    if queued:
        _enqueue_stage(job_id, invalidated[0])
    refreshed = repository.get_job(job_id)
    return {"job": refreshed, "invalidatedStages": invalidated, "queued": queued}


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    job = repository.get_job(job_id)
    if not job:
        raise api_error(404, "job_not_found", "Job nie istnieje.")
    return job


@router.post("/jobs/{job_id}/stages/{stage}/settings")
def save_stage_settings(job_id: str, stage: str, request: StageSettingsRequest):
    job = repository.get_job(job_id)
    if not job:
        raise api_error(404, "job_not_found", "Job nie istnieje.")
    _ensure_not_running(job)

    invalidated = _changed_stages_for_settings(job, stage, request)
    must_queue = _stage_requires_action(job, stage) or _should_queue_invalidated(job, invalidated)
    _apply_stage_settings(job, stage, request)
    _confirm_stage_settings(job_id, stage)
    if stage == "uploaded":
        invalidated = _invalidate_stages(job_id, invalidated)
        queued = bool(invalidated)
        if queued:
            _enqueue_stage(job_id, invalidated[0])
        return {"job": repository.get_job(job_id), "invalidatedStages": invalidated, "queued": queued}

    invalidated = _invalidate_stages(job_id, invalidated)
    if must_queue:
        _enqueue_stage(job_id, invalidated[0] if invalidated else stage)
    refreshed = repository.get_job(job_id)
    return {"job": refreshed, "invalidatedStages": invalidated, "queued": must_queue}


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
    frames_asset = next((asset for asset in job.artifacts if asset.type == "pitch_frames"), None)
    if not transcript_asset or not notes_asset or not frames_asset:
        raise api_error(409, "missing_artifacts", "Brakuje transcript.aligned.json, pitch.notes.json albo pitch.frames.json do ponownej agregacji.")

    transcript_payload = read_json(resolve_inside(transcript_asset.path))
    notes_payload = read_json(resolve_inside(notes_asset.path))
    frames_payload = read_json(resolve_inside(frames_asset.path))
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
    frames = [PitchFrame.model_validate(frame) for frame in frames_payload.get("frames", [])]
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
        pitch_frames=frames,
        pitch_settings=job.pitchSettings,
    )
    return repository.save_arrangement(job_id, arrangement)


@router.post("/jobs/{job_id}/exports/validate", response_model=ExportValidationReport)
def validate_karaoke_export(job_id: str, selection: ExportSelection) -> ExportValidationReport:
    job = repository.get_job(job_id)
    if not job:
        raise api_error(404, "job_not_found", "Job nie istnieje.")
    arrangement = repository.get_arrangement(job_id)
    repository.upsert_export_selection(job_id, selection)
    report = validate_export(job, arrangement, selection)
    repository.create_artifact(job_id, write_validation_report_artifact(job_id, report))
    return report


@router.post("/jobs/{job_id}/exports/karaoke", response_model=ExportKaraokeResponse)
def export_karaoke(job_id: str, selection: ExportSelection) -> ExportKaraokeResponse:
    job = repository.get_job(job_id)
    if not job:
        raise api_error(404, "job_not_found", "Job nie istnieje.")
    arrangement = repository.get_arrangement(job_id)
    repository.upsert_export_selection(job_id, selection)
    report = validate_export(job, arrangement, selection)
    validation_asset = write_validation_report_artifact(job_id, report)
    repository.create_artifact(job_id, validation_asset)
    if report.errors:
        raise api_error(409, "export_validation_failed", "Eksport wymaga poprawek przed wygenerowaniem ZIP.", {"report": report.model_dump(mode="json")})
    if arrangement is None:
        raise api_error(409, "missing_arrangement", "Arrangement nie istnieje dla tego joba.")

    repository.update_job_status(job_id, JobStatus.exporting)
    try:
        export_assets = generate_karaoke_exports(job, arrangement, selection)
        for asset in export_assets:
            repository.create_artifact(job_id, asset)
        repository.update_job_status(job_id, JobStatus.awaiting_review)
    except Exception:
        repository.update_job_status(job_id, JobStatus.awaiting_review)
        raise

    return ExportKaraokeResponse(
        jobId=job_id,
        status=JobStatus.awaiting_review,
        validationReport=report,
        validationArtifact=export_ref(validation_asset),
        exports=[export_ref(asset) for asset in export_assets],
    )


@router.post("/projects/drafts/{draft_id}/export", response_model=ProjectArchiveResponse)
def export_draft_project(
    draft_id: str,
    state: str = Form(...),
    cover: UploadFile | None = File(default=None),
) -> ProjectArchiveResponse:
    client_state = ProjectClientState.model_validate_json(state)
    return generate_draft_archive(draft_id, client_state, cover)


@router.get("/projects/drafts/{draft_id}/archive")
def download_draft_project(draft_id: str):
    exports_dir = resolve_inside(f"drafts/{draft_id}/exports")
    archives = sorted(exports_dir.glob("*/*.zip"), key=lambda path: path.stat().st_mtime, reverse=True) if exports_dir.exists() else []
    if not archives:
        raise api_error(404, "project_archive_missing", "Nie znaleziono zapisanego archiwum projektu.")
    return FileResponse(archives[0], media_type="application/zip", filename=archives[0].name)


@router.post("/jobs/{job_id}/exports/project", response_model=ProjectArchiveResponse)
def export_job_project(job_id: str, state: ProjectClientState) -> ProjectArchiveResponse:
    response, asset = generate_job_archive(job_id, state)
    repository.create_artifact(job_id, asset)
    return response


@router.post("/projects/import", response_model=ProjectImportResponse)
def import_project(file: UploadFile = File(...)) -> ProjectImportResponse:
    result = import_project_archive(file)
    if result.job and result.autoResume and result.resumeStage:
        _enqueue_stage(result.job.jobId, result.resumeStage)
        result = result.model_copy(update={"queued": True})
    return result


@router.get("/jobs/{job_id}/artifacts/{asset_id}")
def download_artifact(job_id: str, asset_id: str):
    asset = repository.get_artifact(job_id, asset_id)
    if not asset:
        raise api_error(404, "artifact_not_found", "Artefakt nie istnieje dla tego joba.")
    path = resolve_inside(asset.path)
    if not path.exists():
        raise api_error(404, "artifact_missing", "Plik artefaktu nie istnieje w magazynie.")
    return FileResponse(path, media_type=asset.mimeType or "application/octet-stream", filename=asset.originalFilename or path.name)


@router.post("/jobs/{job_id}/restart", response_model=ResetStageResponse)
def restart_job(job_id: str, request: ResetStageRequest):
    job = repository.get_job(job_id)
    if not job:
        raise api_error(404, "job_not_found", "Job nie istnieje.")
    _ensure_not_running(job)
    invalidated = _invalidate_stages(job_id, _stages_from("preprocessing"))
    repository.update_job_status(job_id, JobStatus.uploaded)
    return ResetStageResponse(jobId=job_id, status=JobStatus.uploaded, resetFromStage="preprocessing", invalidatedStages=invalidated, queued=False)


@router.post("/reset", response_model=ApplicationResetResponse)
def reset_application(request: ApplicationResetRequest) -> ApplicationResetResponse:
    if request.jobId:
        repository.delete_job(request.jobId)
        purge_tree(f"jobs/{request.jobId}")
    if request.uploadDraftId:
        purge_tree(f"drafts/{request.uploadDraftId}")
    return ApplicationResetResponse()


@router.post("/jobs/{job_id}/stages/{stage}/resume", response_model=ResetStageResponse)
def resume_stage(job_id: str, stage: str, request: ResetStageRequest):
    job = repository.get_job(job_id)
    if not job:
        raise api_error(404, "job_not_found", "Job nie istnieje.")
    _ensure_not_running(job)
    if stage not in STAGE_NAMES:
        raise api_error(400, "invalid_stage", "Nieprawidlowy etap wznowienia.")
    snapshot = _stage_snapshot(job, stage)
    if snapshot and snapshot.status != StageStatus.failed and _stage_has_complete_outputs(job, stage):
        _enqueue_stage(job_id, stage)
        return ResetStageResponse(jobId=job_id, status=JobStatus(stage), resetFromStage=stage, invalidatedStages=[], queued=True)
    start_stage = _resume_start_stage(job, stage)
    invalidated = _invalidate_stages(job_id, _stages_from(start_stage))
    refreshed = repository.get_job(job_id)
    if start_stage in STAGE_FORMS and refreshed and not _stage_requires_action(refreshed, start_stage) and not any(snapshot.stage == start_stage and snapshot.settingsConfirmedAt for snapshot in refreshed.processing.values()):
        require_stage_settings(job_id, start_stage, STAGE_SUBSTEPS[start_stage], STAGE_MESSAGES[start_stage], STAGE_WORKERS[start_stage], STAGE_FORMS[start_stage])
        return ResetStageResponse(jobId=job_id, status=JobStatus(start_stage), resetFromStage=start_stage, invalidatedStages=invalidated, queued=False)
    _enqueue_stage(job_id, start_stage)
    return ResetStageResponse(jobId=job_id, status=JobStatus(start_stage), resetFromStage=start_stage, invalidatedStages=invalidated, queued=True)


STAGE_NAMES = ["preprocessing", "detecting_bpm", "separating_vocals", "transcribing", "detecting_pitch", "aligning"]
STAGE_DEFAULT_MESSAGES = {
    "preprocessing": "Preprocessing audio",
    "detecting_bpm": "Rozpoznawanie BPM",
    "separating_vocals": "Separacja wokalu",
    "transcribing": "Transkrypcja",
    "detecting_pitch": "Detekcja tonów",
    "aligning": "Wstępne dopasowanie",
}
STAGE_OUTPUT_TYPES = {
    "preprocessing": {"mix", "bpm_input", "audio_metadata"},
    "detecting_bpm": {"tempo"},
    "separating_vocals": {"vocals", "instrumental", "whisperx_input", "torchcrepe_input"},
    "transcribing": {"transcript_raw", "transcript_aligned"},
    "detecting_pitch": {"pitch_frames"},
    "aligning": {"draft_arrangement"},
}
STAGE_FORMS = {
    "uploaded": "source",
    "separating_vocals": "separation",
    "transcribing": "transcription",
    "detecting_pitch": "pitch",
    "aligning": "alignment",
}
STAGE_SUBSTEPS = {
    "uploaded": "source",
    "separating_vocals": "demucs",
    "transcribing": "whisperx",
    "detecting_pitch": "pitch_detection",
    "aligning": "draft",
}
STAGE_WORKERS = {
    "uploaded": "api",
    "separating_vocals": "worker-separate-stems",
    "transcribing": "worker-transcribe",
    "detecting_pitch": "worker-pitch",
    "aligning": "worker-aligner",
}
STAGE_MESSAGES = {
    "separating_vocals": "Wybierz ustawienia separacji wokalu",
    "transcribing": "Wybierz ustawienia transkrypcji",
    "detecting_pitch": "Wybierz ustawienia detekcji tonów",
    "aligning": "Wybierz ustawienia wstępnego dopasowania",
}


def _metadata_language(metadata) -> str:
    return (metadata.language or "").strip()


def _merge_stages(current: list[str], incoming: list[str]) -> list[str]:
    merged = list(current)
    for stage in incoming:
        if stage not in merged:
            merged.append(stage)
    return sorted(merged, key=lambda item: STAGE_NAMES.index(item) if item in STAGE_NAMES else len(STAGE_NAMES))


def _stages_from(stage: str) -> list[str]:
    if stage not in STAGE_NAMES:
        raise api_error(400, "invalid_stage", "Nieprawidlowy etap resetu.")
    return STAGE_NAMES[STAGE_NAMES.index(stage) :]


def _stage_snapshot(job, stage: str):
    return next((snapshot for snapshot in job.processing.values() if snapshot.stage == stage), None)


def _stage_requires_action(job, stage: str) -> bool:
    snapshot = _stage_snapshot(job, stage)
    return bool(snapshot and snapshot.actionRequired)


def _stage_has_complete_outputs(job, stage: str) -> bool:
    if stage == "detecting_bpm" and job.tempo:
        return True
    if stage == "aligning" and not repository.get_arrangement(job.jobId):
        return False
    required = STAGE_OUTPUT_TYPES.get(stage)
    if not required:
        return False
    existing = {asset.type for asset in job.artifacts if asset.producedByStage == stage}
    return required.issubset(existing)


def _resume_start_stage(job, requested_stage: str) -> str:
    requested_index = STAGE_NAMES.index(requested_stage)
    for prerequisite in STAGE_NAMES[:requested_index]:
        if not _stage_has_complete_outputs(job, prerequisite):
            return prerequisite
    return requested_stage


def _should_queue_invalidated(job, stages: list[str]) -> bool:
    if not stages:
        return False
    first = stages[0]
    snapshot = _stage_snapshot(job, first)
    if snapshot and snapshot.status != StageStatus.pending:
        return True
    return any(asset.producedByStage == first for asset in job.artifacts)


def _settings_summary_for_config(stage: str, metadata, profiles, transcription_settings, pitch_settings, syllabification_settings) -> dict:
    if stage == "uploaded":
        return {"title": metadata.title, "artist": metadata.artist, "language": metadata.language or "auto"}
    if stage == "separating_vocals":
        return {"separationModel": profiles.separationModel}
    if stage == "transcribing":
        return {
            "transcriptionModel": profiles.transcriptionModel,
            "vadMethod": transcription_settings.vadMethod,
            "positioning": transcription_settings.positioning,
            "syllabification": syllabification_settings.method,
        }
    if stage == "detecting_pitch":
        return {
            "pitch": profiles.pitch,
            "silenceThresholdDb": pitch_settings.silenceThresholdDb,
            "periodicityThreshold": pitch_settings.periodicityThreshold,
            "frameStepMs": pitch_settings.frameStepMs,
        }
    if stage == "aligning":
        return {
            "sentenceGapMs": transcription_settings.sentenceGapMs,
            "minNoteLengthMs": pitch_settings.minNoteLengthMs,
            "mergeGapMs": pitch_settings.mergeGapMs,
            "checkNoteLongerThan": pitch_settings.checkNoteLongerThan,
            "silenceTresholdForNoteChecking": pitch_settings.silenceTresholdForNoteChecking,
        }
    return {}


def _settings_summary_for_job(job, stage: str) -> dict:
    return _settings_summary_for_config(stage, job.metadata, job.profiles, job.transcriptionSettings, job.pitchSettings, job.syllabificationSettings)


def _confirm_stage_settings(job_id: str, stage: str) -> None:
    job = repository.get_job(job_id)
    if not job:
        return
    snapshot = _stage_snapshot(job, stage)
    if not snapshot:
        return
    snapshot.settingsConfirmedAt = utc_now()
    snapshot.settingsSummary = _settings_summary_for_job(job, stage)
    snapshot.actionRequired = False
    snapshot.settingsForm = None
    repository.update_processing(job_id, job.processing)


def _ensure_not_running(job) -> None:
    if any(snapshot.status == StageStatus.running for snapshot in job.processing.values()):
        raise api_error(409, "job_running", "Nie mozna zmienic ustawien podczas aktywnego przetwarzania.")


def _changed_stages_for_settings(job, stage: str, request: StageSettingsRequest) -> list[str]:
    if stage == "uploaded":
        if request.metadata and _metadata_language(job.metadata) != _metadata_language(request.metadata):
            return ["transcribing", "aligning"]
        return []
    if stage == "separating_vocals":
        requested = request.profiles or job.profiles
        return _stages_from("separating_vocals") if requested.separationModel != job.profiles.separationModel else []
    if stage == "transcribing":
        requested_profiles = request.profiles or job.profiles
        requested_syllabification = request.syllabificationSettings or job.syllabificationSettings
        requested_transcription = final_transcription_settings(request.transcriptionSettings or job.transcriptionSettings, requested_syllabification)
        changed: list[str] = []
        asr_fields = [
            "vadMethod",
            "sileroThreshold",
            "sileroNegThreshold",
            "sileroMinSpeechDurationMs",
            "sileroMinSilenceDurationMs",
            "sileroSpeechPadMs",
            "pyannoteVadOnset",
            "pyannoteVadOffset",
            "vadChunkSizeSec",
            "sentencePaddingMs",
            "positioning",
        ]
        asr_changed = requested_profiles.transcriptionModel != job.profiles.transcriptionModel or any(
            getattr(requested_transcription, field) != getattr(job.transcriptionSettings, field) for field in asr_fields
        )
        if asr_changed or (requested_syllabification.method == "none") != (job.syllabificationSettings.method == "none"):
            changed = _merge_stages(changed, ["transcribing", "aligning"])
        elif requested_syllabification.method != job.syllabificationSettings.method:
            changed = _merge_stages(changed, ["aligning"])
        return changed
    if stage == "detecting_pitch":
        requested_profiles = request.profiles or job.profiles
        requested_pitch = request.pitchSettings or job.pitchSettings
        pitch_changed = requested_profiles.pitch != job.profiles.pitch or any(
            getattr(requested_pitch, field) != getattr(job.pitchSettings, field)
            for field in ["silenceThresholdDb", "periodicityThreshold", "frameStepMs"]
        )
        return ["detecting_pitch", "aligning"] if pitch_changed else []
    if stage == "aligning":
        requested_transcription = request.transcriptionSettings or job.transcriptionSettings
        requested_pitch = request.pitchSettings or job.pitchSettings
        alignment_changed = (
            requested_transcription.sentenceGapMs != job.transcriptionSettings.sentenceGapMs
            or requested_pitch.minNoteLengthMs != job.pitchSettings.minNoteLengthMs
            or requested_pitch.mergeGapMs != job.pitchSettings.mergeGapMs
            or requested_pitch.checkNoteLongerThan != job.pitchSettings.checkNoteLongerThan
            or requested_pitch.silenceTresholdForNoteChecking != job.pitchSettings.silenceTresholdForNoteChecking
        )
        return ["aligning"] if alignment_changed else []
    return []


def _apply_stage_settings(job, stage: str, request: StageSettingsRequest) -> None:
    if stage == "uploaded":
        metadata = request.metadata
        if metadata is None:
            raise api_error(400, "missing_settings", "Brakuje metadanych zrodla.")
        if not (metadata.title or "").strip() or not (metadata.artist or "").strip():
            raise api_error(422, "metadata_required", "Tytul i artysta sa wymagane.")
        repository.update_job_config(job.jobId, metadata=metadata)
        return

    if stage == "separating_vocals":
        profiles = job.profiles.model_copy(update={"separationModel": (request.profiles or job.profiles).separationModel})
        repository.update_job_config(job.jobId, profiles=profiles)
        return

    if stage == "transcribing":
        transcription_settings = final_transcription_settings(request.transcriptionSettings or job.transcriptionSettings, request.syllabificationSettings or job.syllabificationSettings)
        profiles = job.profiles.model_copy(update={"transcriptionModel": (request.profiles or job.profiles).transcriptionModel})
        repository.update_job_config(
            job.jobId,
            profiles=profiles,
            transcription_settings=transcription_settings,
            syllabification_settings=request.syllabificationSettings or job.syllabificationSettings,
        )
        return

    if stage == "detecting_pitch":
        requested = request.pitchSettings or job.pitchSettings
        pitch_settings = job.pitchSettings.model_copy(
            update={
                "silenceThresholdDb": requested.silenceThresholdDb,
                "periodicityThreshold": requested.periodicityThreshold,
                "frameStepMs": requested.frameStepMs,
            }
        )
        profiles = job.profiles.model_copy(update={"pitch": (request.profiles or job.profiles).pitch})
        repository.update_job_config(job.jobId, profiles=profiles, pitch_settings=pitch_settings)
        return

    if stage == "aligning":
        requested_transcription = request.transcriptionSettings or job.transcriptionSettings
        requested_pitch = request.pitchSettings or job.pitchSettings
        transcription_settings = job.transcriptionSettings.model_copy(update={"sentenceGapMs": requested_transcription.sentenceGapMs})
        pitch_settings = job.pitchSettings.model_copy(
            update={
                "minNoteLengthMs": requested_pitch.minNoteLengthMs,
                "mergeGapMs": requested_pitch.mergeGapMs,
                "checkNoteLongerThan": requested_pitch.checkNoteLongerThan,
                "silenceTresholdForNoteChecking": requested_pitch.silenceTresholdForNoteChecking,
            }
        )
        repository.update_job_config(job.jobId, transcription_settings=transcription_settings, pitch_settings=pitch_settings)
        return

    raise api_error(400, "invalid_stage", "Ten etap nie ma formularza ustawien.")


def _invalidate_for_stage(job_id: str, stage: str) -> list[str]:
    invalidated = _stages_from(stage)
    return _invalidate_stages(job_id, invalidated, clear_confirmed_stages=[stage])


def _invalidate_stages(job_id: str, stages: list[str], clear_confirmed_stages: list[str] | None = None) -> list[str]:
    invalidated = _merge_stages([], [stage for stage in stages if stage in STAGE_NAMES])
    if not invalidated:
        return []
    repository.invalidate_from_stage(job_id, invalidated)
    if "detecting_bpm" in invalidated:
        repository.clear_tempo(job_id)
    job = repository.get_job(job_id)
    if not job:
        return invalidated
    clear_confirmed = set(clear_confirmed_stages or [])
    for snapshot in job.processing.values():
        if snapshot.stage in invalidated:
            _reset_invalidated_snapshot(snapshot, snapshot.stage in clear_confirmed)
    repository.update_processing(job_id, job.processing)
    repository.update_job_status(job_id, JobStatus(invalidated[0]))
    return invalidated


def _reset_invalidated_snapshot(snapshot, clear_confirmation: bool) -> None:
    snapshot.status = StageStatus.pending
    snapshot.startedAt = None
    snapshot.finishedAt = None
    snapshot.progressMode = "indeterminate"
    snapshot.progressPercent = None
    snapshot.etaSec = None
    snapshot.message = STAGE_DEFAULT_MESSAGES.get(snapshot.stage, snapshot.message)
    snapshot.logExcerpt = None
    snapshot.artifactIds = []
    snapshot.actionRequired = False
    snapshot.settingsForm = None
    if clear_confirmation:
        snapshot.settingsConfirmedAt = None
        snapshot.settingsSummary = {}


def _enqueue_stage(job_id: str, stage: str) -> None:
    if stage in {"preprocessing", "detecting_bpm"}:
        enqueue_job(job_id, start_stage=stage)
    elif stage == "separating_vocals":
        enqueue_separation(job_id)
    elif stage == "transcribing":
        enqueue_transcription(job_id)
    elif stage == "detecting_pitch":
        enqueue_pitch(job_id)
    elif stage == "aligning":
        enqueue_pitch(job_id, start_stage="aligning")
    else:
        raise api_error(400, "invalid_stage", "Nieprawidlowy etap kolejki.")


@router.post("/jobs/{job_id}/stages/{stage}/reset", response_model=ResetStageResponse)
def reset_stage(job_id: str, stage: str, request: ResetStageRequest):
    job = repository.get_job(job_id)
    if not job:
        raise api_error(404, "job_not_found", "Job nie istnieje.")
    _ensure_not_running(job)
    if stage not in STAGE_NAMES:
        raise api_error(400, "invalid_stage", "Nieprawidlowy etap resetu.")
    invalidated = _invalidate_for_stage(job_id, stage)
    if stage in {"separating_vocals", "transcribing", "detecting_pitch", "aligning"}:
        form = STAGE_FORMS[stage]
        substep = STAGE_SUBSTEPS[stage]
        worker = STAGE_WORKERS[stage]
        message = STAGE_MESSAGES[stage]
        require_stage_settings(job_id, stage, substep, message, worker, form)
        return ResetStageResponse(jobId=job_id, status=JobStatus(stage), resetFromStage=stage, invalidatedStages=invalidated, queued=False)
    _enqueue_stage(job_id, stage)
    return ResetStageResponse(jobId=job_id, status=JobStatus(stage), resetFromStage=stage, invalidatedStages=invalidated, queued=True)
