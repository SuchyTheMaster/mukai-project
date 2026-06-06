from app.db import repository
from app.domain.contracts import JobStatus, ProgressMode, StageSnapshot, StageStatus, stage_key, utc_now


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
    job.processing[key] = current
    repository.update_processing(job_id, job.processing)


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
