import json

from redis import Redis

from app.core.config import get_settings


def redis_client() -> Redis:
    return Redis.from_url(get_settings().redis_url, decode_responses=True)


def enqueue_job(job_id: str, start_stage: str = "preprocessing") -> None:
    payload = {"jobId": job_id, "startStage": start_stage}
    redis_client().lpush(get_settings().queue_name, json.dumps(payload))


def enqueue_separation(job_id: str) -> None:
    redis_client().lpush(get_settings().separation_queue_name, json.dumps({"jobId": job_id, "startStage": "separating_vocals"}))


def enqueue_transcription(job_id: str) -> None:
    redis_client().lpush(get_settings().transcription_queue_name, json.dumps({"jobId": job_id, "startStage": "transcribing"}))


def enqueue_pitch(job_id: str, start_stage: str = "detecting_pitch") -> None:
    redis_client().lpush(get_settings().pitch_queue_name, json.dumps({"jobId": job_id, "startStage": start_stage}))


def remove_jobs_from_queues(job_ids: list[str]) -> None:
    targets = set(job_ids)
    if not targets:
        return
    settings = get_settings()
    queues = list(dict.fromkeys([
        settings.queue_name,
        settings.separation_queue_name,
        settings.transcription_queue_name,
        settings.pitch_queue_name,
    ]))
    client = redis_client()
    removals: list[tuple[str, str]] = []
    for queue in queues:
        for raw in client.lrange(queue, 0, -1):
            try:
                payload = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                continue
            if payload.get("jobId") in targets:
                removals.append((queue, raw))
    if not removals:
        return
    pipeline = client.pipeline()
    for queue, raw in removals:
        pipeline.lrem(queue, 0, raw)
    pipeline.execute()
