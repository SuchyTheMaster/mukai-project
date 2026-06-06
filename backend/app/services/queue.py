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
