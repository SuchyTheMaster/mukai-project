import json
from datetime import datetime, timezone
from pathlib import Path

from app.db.database import get_conn
from app.domain.contracts import (
    Arrangement,
    AudioAsset,
    AudioInfo,
    ExportSelection,
    Job,
    JobStatus,
    ModelProfiles,
    PitchSettings,
    Retention,
    SourceMetadata,
    StageSnapshot,
    SyllabificationSettings,
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
    configuration_preset: str,
    configuration_preset_name: str,
    configuration_preset_type: str,
    configuration_fallback_fields: list[str],
    processing_mode: str,
    transcription_settings: TranscriptionSettings,
    pitch_settings: PitchSettings,
    syllabification_settings: SyllabificationSettings,
    processing: dict[str, StageSnapshot],
    audio: AudioInfo,
) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO jobs (
              job_id, status, metadata, profiles, configuration_preset, configuration_preset_name, configuration_preset_type, configuration_fallback_fields, processing_mode, transcription_settings, pitch_settings, syllabification_settings, processing, retention, audio
            )
            VALUES (%s, %s, %s::jsonb, %s::jsonb, %s, %s, %s, %s::jsonb, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb)
            """,
            (
                job_id,
                JobStatus.uploaded.value,
                json.dumps(_json(metadata)),
                json.dumps(_json(profiles)),
                configuration_preset,
                configuration_preset_name,
                configuration_preset_type,
                json.dumps(configuration_fallback_fields),
                processing_mode,
                json.dumps(_json(transcription_settings)),
                json.dumps(_json(pitch_settings)),
                json.dumps(_json(syllabification_settings)),
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


def list_jobs() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT
              jobs.job_id,
              jobs.created_at,
              GREATEST(
                jobs.updated_at,
                COALESCE((SELECT MAX(created_at) FROM artifacts WHERE artifacts.job_id = jobs.job_id), jobs.updated_at),
                COALESCE((SELECT updated_at FROM arrangements WHERE arrangements.job_id = jobs.job_id), jobs.updated_at),
                COALESCE((SELECT updated_at FROM export_selections WHERE export_selections.job_id = jobs.job_id), jobs.updated_at)
              ) AS updated_at,
              jobs.processing,
              EXISTS(SELECT 1 FROM arrangements WHERE arrangements.job_id = jobs.job_id) AS has_arrangement,
              source.original_filename AS source_filename
            FROM jobs
            LEFT JOIN LATERAL (
              SELECT original_filename
              FROM artifacts
              WHERE artifacts.job_id = jobs.job_id AND artifacts.type = 'source_audio'
              ORDER BY artifacts.created_at ASC
              LIMIT 1
            ) AS source ON TRUE
            ORDER BY jobs.updated_at DESC, jobs.job_id ASC
            """
        ).fetchall()
    return list(rows)


def delete_jobs(job_ids: list[str]) -> list[str]:
    if not job_ids:
        return []
    with get_conn() as conn:
        rows = conn.execute(
            "DELETE FROM jobs WHERE job_id = ANY(%s) RETURNING job_id",
            (job_ids,),
        ).fetchall()
        conn.commit()
    deleted = {row["job_id"] for row in rows}
    return [job_id for job_id in job_ids if job_id in deleted]


def delete_job(job_id: str) -> None:
    delete_jobs([job_id])


def _row_to_job(row: dict, artifact_rows: list[dict]) -> Job:
    return Job(
        jobId=row["job_id"],
        status=row["status"],
        createdAt=row["created_at"],
        updatedAt=row["updated_at"],
        metadata=SourceMetadata.model_validate(row["metadata"]),
        profiles=ModelProfiles.model_validate(row["profiles"]),
        configurationPreset=row.get("configuration_preset") or "default",
        configurationPresetName=row.get("configuration_preset_name") or "Domyślna",
        configurationPresetType=row.get("configuration_preset_type") or "predefined",
        configurationFallbackFields=row.get("configuration_fallback_fields") or [],
        processingMode=row.get("processing_mode") or "manual",
        transcriptionSettings=TranscriptionSettings.model_validate(row["transcription_settings"] or {}),
        pitchSettings=PitchSettings.model_validate(row["pitch_settings"]),
        syllabificationSettings=SyllabificationSettings.model_validate(row.get("syllabification_settings") or {}),
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


def update_job_config(
    job_id: str,
    *,
    metadata: SourceMetadata | None = None,
    profiles: ModelProfiles | None = None,
    configuration_preset: str | None = None,
    processing_mode: str | None = None,
    transcription_settings: TranscriptionSettings | None = None,
    pitch_settings: PitchSettings | None = None,
    syllabification_settings: SyllabificationSettings | None = None,
    audio: AudioInfo | None = None,
) -> None:
    assignments = []
    values = []
    if metadata is not None:
        assignments.append("metadata = %s::jsonb")
        values.append(json.dumps(_json(metadata)))
    if profiles is not None:
        assignments.append("profiles = %s::jsonb")
        values.append(json.dumps(_json(profiles)))
    if configuration_preset is not None:
        assignments.append("configuration_preset = %s")
        values.append(configuration_preset)
    if processing_mode is not None:
        assignments.append("processing_mode = %s")
        values.append(processing_mode)
    if transcription_settings is not None:
        assignments.append("transcription_settings = %s::jsonb")
        values.append(json.dumps(_json(transcription_settings)))
    if pitch_settings is not None:
        assignments.append("pitch_settings = %s::jsonb")
        values.append(json.dumps(_json(pitch_settings)))
    if syllabification_settings is not None:
        assignments.append("syllabification_settings = %s::jsonb")
        values.append(json.dumps(_json(syllabification_settings)))
    if audio is not None:
        assignments.append("audio = %s::jsonb")
        values.append(json.dumps(_json(audio)))
    if not assignments:
        return
    values.append(job_id)
    with get_conn() as conn:
        conn.execute(
            f"UPDATE jobs SET {', '.join(assignments)}, updated_at = now() WHERE job_id = %s",
            tuple(values),
        )
        conn.commit()


def update_configuration_fallback_fields(job_id: str, fields: list[str]) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE jobs SET configuration_fallback_fields = %s::jsonb, updated_at = now() WHERE job_id = %s",
            (json.dumps(fields), job_id),
        )
        conn.commit()


def list_configuration_presets() -> list[dict]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT preset_id, name, preset_type, configuration, created_at, updated_at FROM configuration_presets ORDER BY preset_type, lower(name), preset_id"
        ).fetchall()


def get_configuration_preset(preset_id: str) -> dict | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT preset_id, name, preset_type, configuration, created_at, updated_at FROM configuration_presets WHERE preset_id = %s",
            (preset_id,),
        ).fetchone()


def find_custom_configuration_preset_by_name(name: str) -> dict | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT preset_id, name, preset_type, configuration, created_at, updated_at FROM configuration_presets WHERE preset_type = 'custom' AND lower(btrim(name)) = lower(btrim(%s))",
            (name,),
        ).fetchone()


def create_configuration_preset(preset_id: str, name: str, preset_type: str, configuration: dict) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            """
            INSERT INTO configuration_presets (preset_id, name, preset_type, configuration)
            VALUES (%s, %s, %s, %s::jsonb)
            ON CONFLICT DO NOTHING
            RETURNING preset_id, name, preset_type, configuration, created_at, updated_at
            """,
            (preset_id, name, preset_type, json.dumps(configuration)),
        ).fetchone()
        conn.commit()
    return row


def update_configuration_preset(preset_id: str, configuration: dict) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            """
            UPDATE configuration_presets
            SET configuration = %s::jsonb, updated_at = now()
            WHERE preset_id = %s
            RETURNING preset_id, name, preset_type, configuration, created_at, updated_at
            """,
            (json.dumps(configuration), preset_id),
        ).fetchone()
        conn.commit()
    return row


def delete_configuration_preset(preset_id: str) -> bool:
    with get_conn() as conn:
        deleted = conn.execute("DELETE FROM configuration_presets WHERE preset_id = %s", (preset_id,)).rowcount
        conn.commit()
    return bool(deleted)


def set_tempo(job_id: str, tempo: Tempo) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE jobs SET tempo = %s::jsonb, updated_at = now() WHERE job_id = %s", (json.dumps(_json(tempo)), job_id))
        conn.commit()


def clear_tempo(job_id: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE jobs SET tempo = NULL, updated_at = now() WHERE job_id = %s", (job_id,))
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


def upsert_export_selection(job_id: str, selection: ExportSelection) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO export_selections (job_id, selection)
            VALUES (%s, %s::jsonb)
            ON CONFLICT (job_id) DO UPDATE SET
              selection = EXCLUDED.selection,
              updated_at = now()
            """,
            (job_id, json.dumps(_json(selection))),
        )
        conn.commit()


def get_export_selection(job_id: str) -> ExportSelection | None:
    with get_conn() as conn:
        row = conn.execute("SELECT selection FROM export_selections WHERE job_id = %s", (job_id,)).fetchone()
    if not row or not row["selection"]:
        return None
    return ExportSelection.model_validate(row["selection"])


def invalidate_from_stage(job_id: str, stages: list[str]) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM artifacts WHERE job_id = %s AND produced_by_stage = ANY(%s)", (job_id, stages))
        if "aligning" in stages:
            conn.execute("DELETE FROM arrangements WHERE job_id = %s", (job_id,))
        conn.commit()


def delete_artifacts_by_type(job_id: str, types: list[str]) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM artifacts WHERE job_id = %s AND type = ANY(%s)", (job_id, types))
        conn.commit()
