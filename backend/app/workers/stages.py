from app.db import repository
from app.domain.contracts import JobStatus, ProgressMode, StageSnapshot, StageStatus, stage_key, utc_now


def is_stage_confirmed(job, stage: str) -> bool:
    return any(snapshot.stage == stage and snapshot.settingsConfirmedAt is not None for snapshot in job.processing.values())


def set_stage(
    job_id: str,
    stage: str,
    substep: str,
    status: StageStatus,
    message: str,
    worker_role: str,
    progress_mode: ProgressMode = ProgressMode.indeterminate,
    progress_percent: int | None = None,
    eta_sec: int | None = None,
    log_excerpt: str | None = None,
    artifact_ids: list[str] | None = None,
) -> None:
    job = repository.get_job(job_id)
    if not job:
        return
    key = stage_key(stage, substep)
    current = job.processing.get(
        key,
        StageSnapshot(stage=stage, substep=substep, status=StageStatus.pending, message=message, workerRole=worker_role),
    )
    if status == StageStatus.running and current.startedAt is None:
        current.startedAt = utc_now()
    if status in {StageStatus.completed, StageStatus.failed, StageStatus.skipped}:
        current.finishedAt = utc_now()
    current.status = status
    current.message = message
    current.workerRole = worker_role
    current.progressMode = progress_mode
    current.progressPercent = progress_percent
    current.etaSec = eta_sec
    current.logExcerpt = log_excerpt
    if artifact_ids is not None:
        current.artifactIds = artifact_ids
    if status != StageStatus.pending:
        current.actionRequired = False
        current.settingsForm = None
    job.processing[key] = current
    repository.update_processing(job_id, job.processing)


def complete_stage_from_existing_artifacts(
    job_id: str,
    stage: str,
    substep: str,
    message: str,
    worker_role: str,
) -> None:
    job = repository.get_job(job_id)
    if not job:
        return
    artifact_ids = [
        asset.assetId
        for asset in job.artifacts
        if asset.producedByStage == stage and asset.producedBySubstep == substep
    ]
    set_stage(
        job_id,
        stage,
        substep,
        StageStatus.completed,
        message,
        worker_role,
        ProgressMode.determinate,
        100,
        artifact_ids=artifact_ids,
    )


def require_stage_settings(
    job_id: str,
    stage: str,
    substep: str,
    message: str,
    worker_role: str,
    settings_form: str,
    settings_summary: dict | None = None,
) -> None:
    job = repository.get_job(job_id)
    if not job:
        return
    key = stage_key(stage, substep)
    current = job.processing.get(
        key,
        StageSnapshot(stage=stage, substep=substep, status=StageStatus.pending, message=message, workerRole=worker_role),
    )
    current.status = StageStatus.pending
    current.startedAt = None
    current.finishedAt = None
    current.progressMode = ProgressMode.indeterminate
    current.progressPercent = None
    current.etaSec = None
    current.logExcerpt = None
    current.actionRequired = True
    current.settingsForm = settings_form
    current.settingsSummary = settings_summary or {}
    job.processing[key] = current
    repository.update_processing(job_id, job.processing)
    repository.update_job_status(job_id, JobStatus(stage))


def fail_stage(job_id: str, stage: str, substep: str, message: str, log_excerpt: str, worker_role: str) -> None:
    set_stage(
        job_id,
        stage,
        substep,
        StageStatus.failed,
        message,
        worker_role,
        progress_mode=ProgressMode.indeterminate,
        log_excerpt=log_excerpt,
    )
    repository.update_job_status(job_id, JobStatus.failed)
