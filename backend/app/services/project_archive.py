import hashlib
import json
import shutil
import stat
import zipfile
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from fastapi import UploadFile

from app.core.config import get_settings
from app.core.errors import api_error
from app.db import repository
from app.domain.contracts import (
    Arrangement,
    AudioAsset,
    EmbeddedCover,
    Job,
    JobStatus,
    ProjectArchiveRef,
    ProjectArchiveResponse,
    ProjectClientState,
    ProjectImportResponse,
    StageSnapshot,
    StageStatus,
    UploadInspection,
)
from app.services.ids import new_id
from app.services.storage import (
    purge_tree,
    read_json,
    relative_to_root,
    resolve_inside,
    safe_filename,
    sha256_file,
    write_json,
)


SCHEMA_VERSION = "1.0.0"
PIPELINE_STAGES = [
    "preprocessing",
    "detecting_bpm",
    "separating_vocals",
    "transcribing",
    "detecting_pitch",
    "aligning",
]
STAGE_OUTPUT_TYPES = {
    "preprocessing": {"mix", "bpm_input", "audio_metadata"},
    "detecting_bpm": {"tempo"},
    "separating_vocals": {"vocals", "instrumental", "whisperx_input", "torchcrepe_input"},
    "transcribing": {"transcript_raw", "transcript_aligned"},
    "detecting_pitch": {"pitch_frames"},
    "aligning": {"draft_arrangement"},
}
ALLOWED_COMPRESSION = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}


def generate_draft_archive(draft_id: str, state: ProjectClientState, manual_cover: UploadFile | None = None) -> ProjectArchiveResponse:
    draft_path = resolve_inside(f"drafts/{draft_id}/draft.json")
    if not draft_path.exists():
        raise api_error(404, "draft_not_found", "Draft uploadu nie istnieje.")
    draft = read_json(draft_path)
    source = resolve_inside(draft["sourcePath"])
    if not source.exists():
        raise api_error(409, "draft_source_missing", "Brakuje pliku źródłowego draftu.")

    if manual_cover is not None:
        manual_name = safe_filename(manual_cover.filename, "manual-cover")
        manual_path = resolve_inside(f"drafts/{draft_id}/manual-cover{Path(manual_name).suffix.lower() or '.bin'}")
        _save_limited_upload(manual_cover, manual_path, 25 * 1024 * 1024)
        draft["manualCover"] = {
            "path": relative_to_root(manual_path),
            "filename": manual_name,
            "mimeType": manual_cover.content_type,
            "sizeBytes": manual_path.stat().st_size,
        }
        write_json(draft_path, draft)

    files: list[tuple[Path, dict]] = []
    source_entry = _file_entry(source, f"source/{safe_filename(draft['originalFilename'])}", "source_audio")
    files.append((source, source_entry))
    for kind, key in (("tag", "embeddedCover"), ("manual", "manualCover")):
        cover = draft.get(key)
        if not cover:
            continue
        cover_path = resolve_inside(cover["path"])
        if cover_path.exists():
            entry = _file_entry(cover_path, f"covers/{kind}{cover_path.suffix.lower()}", f"{kind}_cover")
            entry["mimeType"] = cover.get("mimeType")
            files.append((cover_path, entry))

    project_id = new_id("proj")
    archive_filename = _project_filename(state.workingState, draft["originalFilename"])
    archive_path = resolve_inside(f"drafts/{draft_id}/exports/{project_id}/{archive_filename}")
    applied = {"inspection": _draft_inspection_payload(draft, draft_id)}
    manifest = _manifest(
        project_id=project_id,
        phase="draft",
        applied_state=applied,
        working_state=state.workingState,
        editor_workspace=None,
        resume={"mode": "manual", "resumeStage": None},
        entries=[entry for _, entry in files],
    )
    documents = {"draft.json": draft, "mukai-project.json": manifest}
    _write_archive(archive_path, documents, files)
    return _archive_response("draft", archive_path, f"/api/projects/drafts/{draft_id}/archive")


def generate_job_archive(job_id: str, state: ProjectClientState) -> tuple[ProjectArchiveResponse, AudioAsset]:
    job = repository.get_job(job_id)
    if not job:
        raise api_error(404, "job_not_found", "Job nie istnieje.")
    arrangement = repository.get_arrangement(job_id)
    selection = repository.get_export_selection(job_id)
    normalized_job, eligible_assets, resume = _checkpoint_job(job)
    normalized_job.artifacts = eligible_assets
    phase = "review" if arrangement is not None and job.status == JobStatus.awaiting_review else "processing"

    files: list[tuple[Path, dict]] = []
    for asset in eligible_assets:
        path = resolve_inside(asset.path)
        if not path.exists():
            raise api_error(409, "artifact_missing", "Brakuje artefaktu wymaganego do zapisu projektu.", {"assetId": asset.assetId})
        if asset.type == "source_audio":
            archive_path = f"source/{safe_filename(asset.originalFilename or path.name)}"
        else:
            archive_path = f"artifacts/{asset.assetId}/{safe_filename(asset.originalFilename or path.name)}"
        entry = _file_entry(path, archive_path, asset.type)
        entry.update({"assetId": asset.assetId, "artifact": asset.model_dump(mode="json")})
        files.append((path, entry))
    working_state = deepcopy(state.workingState)
    files.extend(_working_draft_files(working_state))

    project_id = new_id("proj")
    archive_filename = _project_filename(state.workingState, _source_filename(job))
    asset_id = new_id("asset")
    archive_path = resolve_inside(f"jobs/{job_id}/exports/{asset_id}/{archive_filename}")
    applied = {
        "job": normalized_job.model_dump(mode="json"),
        "arrangement": arrangement.model_dump(mode="json") if arrangement else None,
        "exportSelection": selection.model_dump(mode="json") if selection else None,
    }
    manifest = _manifest(
        project_id=project_id,
        phase=phase,
        applied_state=applied,
        working_state=working_state,
        editor_workspace=state.editorWorkspace,
        resume=resume,
        entries=[entry for _, entry in files],
    )
    documents = {
        "job.json": normalized_job.model_dump(mode="json"),
        "mukai-project.json": manifest,
    }
    if state.editorWorkspace is not None or arrangement is not None:
        documents["editor-state.json"] = {
            "arrangement": arrangement.model_dump(mode="json") if arrangement else None,
            "workspace": state.editorWorkspace,
        }
    _write_archive(archive_path, documents, files)
    asset = AudioAsset(
        assetId=asset_id,
        type="project_archive",
        path=relative_to_root(archive_path),
        originalFilename=archive_filename,
        mimeType="application/zip",
        sha256=sha256_file(archive_path),
        sizeBytes=archive_path.stat().st_size,
        producedByStage="project_save",
        producedBySubstep="archive",
        metadata={"phase": phase, "resumeStage": resume.get("resumeStage"), "schemaVersion": SCHEMA_VERSION},
    )
    return _archive_response(phase, archive_path, f"/api/jobs/{job_id}/artifacts/{asset_id}", resume.get("resumeStage")), asset


def import_project_archive(upload: UploadFile) -> ProjectImportResponse:
    import_id = new_id("import")
    temp_dir = resolve_inside(f"imports/{import_id}")
    archive_path = temp_dir / "project.zip"
    try:
        _save_limited_upload(upload, archive_path, get_settings().max_project_archive_bytes)
        with _validated_zip(archive_path) as archive:
            manifest = _read_manifest(archive)
            _verify_manifest_files(archive, manifest)
            if manifest["phase"] == "draft":
                return _restore_draft(archive, manifest)
            return _restore_job(archive, manifest)
    finally:
        if temp_dir.exists():
            purge_tree(f"imports/{import_id}")


def _checkpoint_job(job: Job) -> tuple[Job, list[AudioAsset], dict]:
    clone = Job.model_validate(job.model_dump(mode="json"))
    snapshots = {snapshot.stage: snapshot for snapshot in clone.processing.values()}
    assets_by_stage = {
        stage: {asset.type for asset in job.artifacts if asset.producedByStage == stage}
        for stage in PIPELINE_STAGES
    }
    if not any(asset.type == "source_audio" for asset in job.artifacts):
        raise api_error(409, "project_source_missing", "Brakuje źródłowego audio wymaganego do zapisu projektu.")
    for stage, snapshot in snapshots.items():
        required = STAGE_OUTPUT_TYPES.get(stage)
        if snapshot.status == StageStatus.completed and required and not required.issubset(assets_by_stage.get(stage, set())):
            raise api_error(
                409,
                "project_checkpoint_incomplete",
                "Ukończony etap nie ma kompletu artefaktów wymaganych do zapisu projektu.",
                {"stage": stage, "missingTypes": sorted(required - assets_by_stage.get(stage, set()))},
            )
    resume_stage = None
    resume_mode = "none"
    for stage in PIPELINE_STAGES:
        snapshot = snapshots.get(stage)
        if snapshot and snapshot.status in {StageStatus.completed, StageStatus.skipped}:
            continue
        resume_stage = stage
        if snapshot and (snapshot.actionRequired or snapshot.status == StageStatus.failed) or job.status == JobStatus.failed:
            resume_mode = "manual"
        elif job.status != JobStatus.awaiting_review:
            resume_mode = "auto"
        else:
            resume_mode = "manual"
        break

    completed = {stage for stage, snapshot in snapshots.items() if snapshot.status in {StageStatus.completed, StageStatus.skipped}}
    eligible = [
        asset for asset in job.artifacts
        if asset.type != "project_archive" and (asset.producedByStage in completed or asset.producedByStage not in PIPELINE_STAGES)
    ]
    eligible_ids = {asset.assetId for asset in eligible}
    for snapshot in clone.processing.values():
        snapshot.artifactIds = [asset_id for asset_id in snapshot.artifactIds if asset_id in eligible_ids]
        if snapshot.status == StageStatus.running:
            snapshot.status = StageStatus.pending
            snapshot.startedAt = None
            snapshot.finishedAt = None
            snapshot.progressPercent = None
            snapshot.etaSec = None
            snapshot.logExcerpt = None
    return clone, eligible, {"mode": resume_mode, "resumeStage": resume_stage}


def _restore_draft(archive: zipfile.ZipFile, manifest: dict) -> ProjectImportResponse:
    new_draft_id = new_id("draft")
    draft_dir = resolve_inside(f"drafts/{new_draft_id}")
    entries = {entry["role"]: entry for entry in manifest["files"]}
    source_entry = entries.get("source_audio")
    if not source_entry:
        raise api_error(422, "project_source_missing", "Projekt nie zawiera źródłowego audio.")
    original = safe_filename(manifest.get("appliedState", {}).get("inspection", {}).get("originalFilename"), "source.bin")
    source_path = draft_dir / original
    _copy_archive_entry(archive, source_entry["archivePath"], source_path)

    covers = {}
    for kind, role in (("tag", "tag_cover"), ("manual", "manual_cover")):
        entry = entries.get(role)
        if not entry:
            continue
        cover_path = draft_dir / f"{kind}-cover{Path(entry['archivePath']).suffix.lower()}"
        _copy_archive_entry(archive, entry["archivePath"], cover_path)
        covers[kind] = {
            "path": relative_to_root(cover_path),
            "filename": cover_path.name,
            "mimeType": entry.get("mimeType"),
            "sizeBytes": cover_path.stat().st_size,
        }

    inspection_data = manifest.get("appliedState", {}).get("inspection") or {}
    draft = {
        "uploadDraftId": new_draft_id,
        "originalFilename": original,
        "sourcePath": relative_to_root(source_path),
        "sizeBytes": source_path.stat().st_size,
        "audio": inspection_data.get("audio") or {},
        "metadata": inspection_data.get("metadata") or {},
        "embeddedCover": covers.get("tag"),
        "manualCover": covers.get("manual"),
    }
    write_json(draft_dir / "draft.json", draft)
    working = manifest.get("workingState") or {}
    selected = working.get("selectedCoverKind") or ("manual" if covers.get("manual") else "tag" if covers.get("tag") else None)
    project_covers = {
        kind: _cover_contract(new_draft_id, kind, payload)
        for kind, payload in covers.items()
    }
    inspection = UploadInspection(
        uploadDraftId=new_draft_id,
        originalFilename=original,
        audio=draft["audio"],
        metadata=draft["metadata"],
        embeddedCover=project_covers.get(selected),
        projectCovers=project_covers,
        selectedCoverKind=selected,
    )
    return ProjectImportResponse(phase="draft", inspection=inspection, workingState=working)


def _restore_job(archive: zipfile.ZipFile, manifest: dict) -> ProjectImportResponse:
    applied = manifest.get("appliedState") or {}
    old_job = Job.model_validate(applied.get("job"))
    new_job_id = new_id("job")
    new_job_dir = resolve_inside(f"jobs/{new_job_id}")
    asset_id_map = {asset.assetId: new_id("asset") for asset in old_job.artifacts}
    processing = {
        key: StageSnapshot.model_validate(snapshot.model_dump(mode="json"))
        for key, snapshot in old_job.processing.items()
    }
    for snapshot in processing.values():
        snapshot.artifactIds = [asset_id_map[item] for item in snapshot.artifactIds if item in asset_id_map]

    resume = manifest.get("resume") or {}
    restored_status = old_job.status
    if manifest["phase"] == "review":
        restored_status = JobStatus.awaiting_review
    elif resume.get("resumeStage"):
        restored_status = JobStatus(resume["resumeStage"]) if resume["resumeStage"] in PIPELINE_STAGES else old_job.status

    working = deepcopy(manifest.get("workingState") or {})
    try:
        repository.create_job(
            job_id=new_job_id,
            metadata=old_job.metadata,
            profiles=old_job.profiles,
            transcription_settings=old_job.transcriptionSettings,
            pitch_settings=old_job.pitchSettings,
            syllabification_settings=old_job.syllabificationSettings,
            processing=processing,
            audio=old_job.audio,
        )
        repository.update_job_status(new_job_id, restored_status)
        if old_job.tempo:
            repository.set_tempo(new_job_id, old_job.tempo)

        entries_by_asset = {entry.get("assetId"): entry for entry in manifest["files"] if entry.get("assetId")}
        for old_asset in old_job.artifacts:
            entry = entries_by_asset.get(old_asset.assetId)
            if not entry:
                raise api_error(422, "project_artifact_missing", "Manifest nie zawiera wymaganego artefaktu.", {"assetId": old_asset.assetId})
            new_asset_id = asset_id_map[old_asset.assetId]
            filename = safe_filename(old_asset.originalFilename or Path(old_asset.path).name)
            folder = "source" if old_asset.type == "source_audio" else f"artifacts/{new_asset_id}"
            destination = new_job_dir / folder / filename
            _copy_archive_entry(archive, entry["archivePath"], destination)
            new_asset = old_asset.model_copy(update={
                "assetId": new_asset_id,
                "path": relative_to_root(destination),
                "sha256": sha256_file(destination),
                "sizeBytes": destination.stat().st_size,
            })
            repository.create_artifact(new_job_id, new_asset)

        arrangement_data = applied.get("arrangement")
        if arrangement_data:
            arrangement = Arrangement.model_validate(arrangement_data).model_copy(update={
                "arrangementId": new_id("arr"),
                "jobId": new_job_id,
                "source": "imported",
            })
            repository.save_arrangement(new_job_id, arrangement)
        selection_data = applied.get("exportSelection")
        if selection_data:
            if selection_data.get("coverAssetId") in asset_id_map:
                selection_data = deepcopy(selection_data)
                selection_data["coverAssetId"] = asset_id_map[selection_data["coverAssetId"]]
            from app.domain.contracts import ExportSelection
            repository.upsert_export_selection(new_job_id, ExportSelection.model_validate(selection_data))
        working = _restore_working_draft(archive, manifest, working)
    except Exception:
        repository.delete_job(new_job_id)
        if new_job_dir.exists():
            purge_tree(f"jobs/{new_job_id}")
        raise

    restored = repository.get_job(new_job_id)
    return ProjectImportResponse(
        phase=manifest["phase"],
        job=restored,
        workingState=working,
        editorWorkspace=manifest.get("editorWorkspace"),
        resumeStage=resume.get("resumeStage"),
        autoResume=resume.get("mode") == "auto",
        queued=False,
    )


def _manifest(*, project_id: str, phase: str, applied_state: dict, working_state: dict, editor_workspace: dict | None, resume: dict, entries: list[dict]) -> dict:
    return {
        "format": "mukai-project",
        "schemaVersion": SCHEMA_VERSION,
        "projectId": project_id,
        "savedAt": datetime.now(timezone.utc).isoformat(),
        "phase": phase,
        "appliedState": applied_state,
        "workingState": working_state,
        "editorWorkspace": editor_workspace,
        "resume": resume,
        "files": entries,
    }


def _write_archive(destination: Path, documents: dict[str, dict], files: list[tuple[Path, dict]]) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
        for name, payload in documents.items():
            archive.writestr(name, json.dumps(payload, ensure_ascii=False, indent=2))
        for source, entry in files:
            archive.write(source, entry["archivePath"])


def _validated_zip(path: Path):
    try:
        archive = zipfile.ZipFile(path, "r")
        infos = archive.infolist()
        settings = get_settings()
        if len(infos) > settings.max_project_archive_entries:
            raise api_error(413, "project_too_many_entries", "Archiwum projektu zawiera zbyt wiele plików.")
        total = 0
        seen = set()
        for info in infos:
            _validate_archive_path(info.filename)
            if info.filename in seen:
                raise api_error(422, "project_duplicate_path", "Archiwum zawiera zduplikowaną ścieżkę.", {"path": info.filename})
            seen.add(info.filename)
            if info.flag_bits & 0x1:
                raise api_error(422, "project_encrypted_entry", "Szyfrowane pliki ZIP nie są obsługiwane.")
            if info.compress_type not in ALLOWED_COMPRESSION:
                raise api_error(422, "project_compression_unsupported", "Archiwum używa nieobsługiwanej metody kompresji.")
            mode = info.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise api_error(422, "project_symlink", "Archiwum projektu nie może zawierać dowiązań symbolicznych.")
            total += info.file_size
            if total > settings.max_project_unpacked_bytes:
                raise api_error(413, "project_unpacked_too_large", "Rozpakowany projekt przekracza dozwolony rozmiar.")
        return archive
    except zipfile.BadZipFile as exc:
        raise api_error(422, "invalid_project_zip", "Plik nie jest poprawnym archiwum ZIP projektu.") from exc


def _read_manifest(archive: zipfile.ZipFile) -> dict:
    try:
        manifest = json.loads(archive.read("mukai-project.json"))
    except KeyError as exc:
        raise api_error(422, "project_manifest_missing", "Archiwum nie zawiera mukai-project.json.") from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise api_error(422, "project_manifest_invalid", "Manifest projektu nie jest poprawnym JSON-em.") from exc
    if manifest.get("format") != "mukai-project" or manifest.get("schemaVersion") != SCHEMA_VERSION:
        raise api_error(422, "project_schema_unsupported", "Nieobsługiwana wersja formatu projektu.", {"schemaVersion": manifest.get("schemaVersion")})
    if manifest.get("phase") not in {"draft", "processing", "review"} or not isinstance(manifest.get("files"), list):
        raise api_error(422, "project_manifest_invalid", "Manifest projektu ma nieprawidłową strukturę.")
    return manifest


def _verify_manifest_files(archive: zipfile.ZipFile, manifest: dict) -> None:
    names = set(archive.namelist())
    for entry in manifest["files"]:
        path = entry.get("archivePath")
        _validate_archive_path(path)
        if path not in names:
            raise api_error(422, "project_file_missing", "Brakuje pliku wymaganego przez manifest.", {"path": path})
        digest = hashlib.sha256()
        size = 0
        with archive.open(path) as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
                size += len(chunk)
        if digest.hexdigest() != entry.get("sha256") or size != entry.get("sizeBytes"):
            raise api_error(422, "project_hash_mismatch", "Plik projektu nie zgadza się z manifestem.", {"path": path})


def _validate_archive_path(value: str | None) -> None:
    if not value or "\\" in value:
        raise api_error(422, "project_unsafe_path", "Archiwum zawiera niebezpieczną ścieżkę.")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or any(part in {"", "."} for part in path.parts):
        raise api_error(422, "project_unsafe_path", "Archiwum zawiera niebezpieczną ścieżkę.", {"path": value})


def _file_entry(path: Path, archive_path: str, role: str) -> dict:
    return {
        "role": role,
        "archivePath": archive_path,
        "sha256": sha256_file(path),
        "sizeBytes": path.stat().st_size,
    }


def _copy_archive_entry(archive: zipfile.ZipFile, name: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with archive.open(name) as source, destination.open("wb") as target:
        shutil.copyfileobj(source, target, length=1024 * 1024)


def _working_draft_files(working: dict) -> list[tuple[Path, dict]]:
    source_form = (working.get("stageForms") or {}).get("uploaded") or {}
    inspection = source_form.get("sourceInspection") or {}
    draft_id = inspection.get("uploadDraftId")
    if not draft_id:
        return []
    draft_path = resolve_inside(f"drafts/{draft_id}/draft.json")
    if not draft_path.exists():
        raise api_error(409, "working_draft_missing", "Brakuje roboczego pliku źródłowego zapisanego w formularzu.")
    draft = read_json(draft_path)
    source = resolve_inside(draft["sourcePath"])
    result = [(source, _file_entry(source, f"working/source/{safe_filename(draft['originalFilename'])}", "working_source_audio"))]
    for kind, key in (("tag", "embeddedCover"), ("manual", "manualCover")):
        cover = draft.get(key)
        if not cover:
            continue
        path = resolve_inside(cover["path"])
        if path.exists():
            entry = _file_entry(path, f"working/covers/{kind}{path.suffix.lower()}", f"working_{kind}_cover")
            entry["mimeType"] = cover.get("mimeType")
            result.append((path, entry))
    return result


def _restore_working_draft(archive: zipfile.ZipFile, manifest: dict, working: dict) -> dict:
    entries = {entry.get("role"): entry for entry in manifest.get("files", [])}
    source_entry = entries.get("working_source_audio")
    if not source_entry:
        return working
    source_form = (working.get("stageForms") or {}).get("uploaded") or {}
    old_inspection = source_form.get("sourceInspection") or {}
    draft_id = new_id("draft")
    draft_dir = resolve_inside(f"drafts/{draft_id}")
    original = safe_filename(old_inspection.get("originalFilename"), "source.bin")
    source_path = draft_dir / original
    _copy_archive_entry(archive, source_entry["archivePath"], source_path)
    covers = {}
    for kind in ("tag", "manual"):
        entry = entries.get(f"working_{kind}_cover")
        if not entry:
            continue
        path = draft_dir / f"{kind}-cover{Path(entry['archivePath']).suffix.lower()}"
        _copy_archive_entry(archive, entry["archivePath"], path)
        covers[kind] = {
            "path": relative_to_root(path),
            "filename": path.name,
            "mimeType": entry.get("mimeType"),
            "sizeBytes": path.stat().st_size,
        }
    draft = {
        "uploadDraftId": draft_id,
        "originalFilename": original,
        "sourcePath": relative_to_root(source_path),
        "sizeBytes": source_path.stat().st_size,
        "audio": old_inspection.get("audio") or {},
        "metadata": old_inspection.get("metadata") or {},
        "embeddedCover": covers.get("tag"),
        "manualCover": covers.get("manual"),
    }
    write_json(draft_dir / "draft.json", draft)
    project_covers = {kind: _cover_contract(draft_id, kind, payload) for kind, payload in covers.items()}
    selected = old_inspection.get("selectedCoverKind") or ("manual" if "manual" in covers else "tag" if "tag" in covers else None)
    source_form["sourceInspection"] = UploadInspection(
        uploadDraftId=draft_id,
        originalFilename=original,
        audio=draft["audio"],
        metadata=draft["metadata"],
        embeddedCover=project_covers.get(selected),
        projectCovers=project_covers,
        selectedCoverKind=selected,
    ).model_dump(mode="json")
    working.setdefault("stageForms", {})["uploaded"] = source_form
    return working


def _save_limited_upload(upload: UploadFile, destination: Path, limit: int) -> int:
    destination.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    with destination.open("wb") as target:
        while True:
            chunk = upload.file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                target.close()
                destination.unlink(missing_ok=True)
                raise api_error(413, "project_archive_too_large", "Archiwum projektu przekracza dozwolony rozmiar.")
            target.write(chunk)
    return size


def _project_filename(working: dict, fallback_source: str) -> str:
    metadata = working.get("metadata") or working.get("sourceForm", {}).get("metadata") or {}
    artist = (metadata.get("artist") or "").strip()
    title = (metadata.get("title") or "").strip()
    if artist and title:
        base = f"{artist} - {title}"
    else:
        base = Path(fallback_source).stem or "projekt"
    return safe_filename(f"{base} [mukai-project].zip", "projekt [mukai-project].zip")


def _source_filename(job: Job) -> str:
    source = next((asset for asset in job.artifacts if asset.type == "source_audio"), None)
    return source.originalFilename if source and source.originalFilename else "projekt"


def _draft_inspection_payload(draft: dict, draft_id: str) -> dict:
    return {
        "uploadDraftId": draft_id,
        "originalFilename": draft["originalFilename"],
        "audio": draft.get("audio") or {},
        "metadata": draft.get("metadata") or {},
    }


def _cover_contract(draft_id: str, kind: str, payload: dict) -> EmbeddedCover:
    return EmbeddedCover(
        coverDraftId=f"{kind}_{draft_id}",
        mimeType=payload.get("mimeType") or "application/octet-stream",
        sizeBytes=payload["sizeBytes"],
        previewUrl=f"/api/uploads/drafts/{draft_id}/cover/{kind}",
        source="manual_upload" if kind == "manual" else "audio_tags",
    )


def _archive_response(phase: str, path: Path, download_url: str, resume_stage: str | None = None) -> ProjectArchiveResponse:
    return ProjectArchiveResponse(
        phase=phase,
        resumeStage=resume_stage,
        archive=ProjectArchiveRef(
            filename=path.name,
            downloadUrl=download_url,
            sha256=sha256_file(path),
            sizeBytes=path.stat().st_size,
        ),
    )
