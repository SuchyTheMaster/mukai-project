import json
from datetime import datetime, timezone
from pathlib import Path

from app.db.database import get_conn
from app.domain.contracts import (
    Arrangement,
    AudioAsset,
    AudioInfo,
    Job,
    JobStatus,
    ModelProfiles,
    PitchSettings,
    Retention,
    SourceMetadata,
    StageSnapshot,
    Tempo,
    TranscriptionSettings,
)


def _json(data):
    if hasattr(data, "model_dump"):
        return json.loads(data.model_dump_json())
    return data


def create_job(
    job_id: str,
    metadata: SourceMetadata,
    profiles: ModelProfiles,
    transcription_settings: TranscriptionSettings,
    pitch_settings: PitchSettings,
    processing: dict[str, StageSnapshot],
    audio: AudioInfo,
) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO jobs (
              job_id, status, metadata, profiles, transcription_settings, pitch_settings, processing, retention, audio
            )
            VALUES (%s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb)
            """,
            (
                job_id,
                JobStatus.uploaded.value,
                json.dumps(_json(metadata)),
                json.dumps(_json(profiles)),
                json.dumps(_json(transcription_settings)),
                json.dumps(_json(pitch_settings)),
                json.dumps({key: _json(value) for key, value in processing.items()}),
                json.dumps(_json(Retention())),
                json.dumps(_json(audio)),
            ),
        )
        conn.commit()


def get_job(job_id: str) -> Job | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE job_id = %s", (job_id,)).fetchone()
        if not row:
            return None
        artifacts = conn.execute("SELECT * FROM artifacts WHERE job_id = %s ORDER BY created_at", (job_id,)).fetchall()
    return _row_to_job(row, artifacts)


def _row_to_job(row: dict, artifact_rows: list[dict]) -> Job:
    return Job(
        jobId=row["job_id"],
        status=row["status"],
        createdAt=row["created_at"],
        updatedAt=row["updated_at"],
        metadata=SourceMetadata.model_validate(row["metadata"]),
        profiles=ModelProfiles.model_validate(row["profiles"]),
        transcriptionSettings=TranscriptionSettings.model_validate(row["transcription_settings"] or {}),
        pitchSettings=PitchSettings.model_validate(row["pitch_settings"]),
        processing={key: StageSnapshot.model_validate(value) for key, value in row["processing"].items()},
        retention=Retention.model_validate(row["retention"]),
        tempo=Tempo.model_validate(row["tempo"]) if row["tempo"] else None,
        audio=AudioInfo.model_validate(row["audio"]) if row["audio"] else None,
        artifacts=[_row_to_asset(item) for item in artifact_rows],
    )


def _row_to_asset(row: dict) -> AudioAsset:
    return AudioAsset(
        assetId=row["asset_id"],
        type=row["type"],
        path=row["path"],
        originalFilename=row["original_filename"],
        durationSec=row["duration_sec"],
        sampleRate=row["sample_rate"],
        channels=row["channels"],
        sha256=row["sha256"],
        mimeType=row["mime_type"],
        sizeBytes=row["size_bytes"],
        producedByStage=row["produced_by_stage"],
        producedBySubstep=row["produced_by_substep"],
        metadata=row["metadata"] or {},
    )


def update_job_status(job_id: str, status: JobStatus | str) -> None:
    value = status.value if isinstance(status, JobStatus) else status
    with get_conn() as conn:
        conn.execute("UPDATE jobs SET status = %s, updated_at = now() WHERE job_id = %s", (value, job_id))
        conn.commit()


def update_processing(job_id: str, processing: dict[str, StageSnapshot]) -> None:
    payload = json.dumps({key: _json(value) for key, value in processing.items()})
    with get_conn() as conn:
        conn.execute("UPDATE jobs SET processing = %s::jsonb, updated_at = now() WHERE job_id = %s", (payload, job_id))
        conn.commit()


def set_tempo(job_id: str, tempo: Tempo) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE jobs SET tempo = %s::jsonb, updated_at = now() WHERE job_id = %s", (json.dumps(_json(tempo)), job_id))
        conn.commit()


def get_arrangement(job_id: str) -> Arrangement | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM arrangements WHERE job_id = %s", (job_id,)).fetchone()
    if not row:
        return None
    document = row["document"] or {}
    return Arrangement.model_validate(
        document
        | {
            "arrangementId": row["arrangement_id"],
            "jobId": row["job_id"],
            "revision": row["revision"],
            "approved": row["approved"],
            "updatedAt": row["updated_at"],
        }
    )


def save_arrangement(job_id: str, arrangement: Arrangement) -> Arrangement:
    payload = arrangement.model_copy(update={"jobId": job_id})
    document = _json(payload)
    with get_conn() as conn:
        row = conn.execute(
            """
            INSERT INTO arrangements (arrangement_id, job_id, revision, approved, document)
            VALUES (%s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (job_id) DO UPDATE SET
              revision = arrangements.revision + 1,
              approved = EXCLUDED.approved,
              document = EXCLUDED.document,
              updated_at = now()
            RETURNING *
            """,
            (
                payload.arrangementId,
                job_id,
                payload.revision,
                payload.approved,
                json.dumps(document),
            ),
        ).fetchone()
        conn.commit()
    return get_arrangement(row["job_id"])


def update_arrangement_if_revision(job_id: str, arrangement: Arrangement, expected_revision: int) -> Arrangement | None:
    next_revision = expected_revision + 1
    payload = arrangement.model_copy(update={"jobId": job_id, "revision": next_revision})
    document = _json(payload)
    with get_conn() as conn:
        row = conn.execute(
            """
            UPDATE arrangements
            SET
              revision = revision + 1,
              approved = %s,
              document = %s::jsonb,
              updated_at = now()
            WHERE job_id = %s AND revision = %s
            RETURNING job_id
            """,
            (
                payload.approved,
                json.dumps(document),
                job_id,
                expected_revision,
            ),
        ).fetchone()
        conn.commit()
    if not row:
        return None
    return get_arrangement(row["job_id"])


def create_artifact(job_id: str, asset: AudioAsset) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO artifacts (
              asset_id, job_id, type, path, original_filename, duration_sec, sample_rate, channels,
              sha256, mime_type, size_bytes, produced_by_stage, produced_by_substep, metadata
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (asset_id) DO UPDATE SET
              path = EXCLUDED.path,
              sha256 = EXCLUDED.sha256,
              size_bytes = EXCLUDED.size_bytes,
              metadata = EXCLUDED.metadata
            """,
            (
                asset.assetId,
                job_id,
                asset.type,
                asset.path,
                asset.originalFilename,
                asset.durationSec,
                asset.sampleRate,
                asset.channels,
                asset.sha256,
                asset.mimeType,
                asset.sizeBytes,
                asset.producedByStage,
                asset.producedBySubstep,
                json.dumps(asset.metadata),
            ),
        )
        conn.commit()


def get_artifact(job_id: str, asset_id: str) -> AudioAsset | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM artifacts WHERE job_id = %s AND asset_id = %s",
            (job_id, asset_id),
        ).fetchone()
    return _row_to_asset(row) if row else None


def invalidate_from_stage(job_id: str, stages: list[str]) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM artifacts WHERE job_id = %s AND produced_by_stage = ANY(%s)", (job_id, stages))
        if "aligning" in stages:
            conn.execute("DELETE FROM arrangements WHERE job_id = %s", (job_id,))
        conn.commit()
