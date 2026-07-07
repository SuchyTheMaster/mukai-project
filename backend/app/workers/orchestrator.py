import json
import time
from pathlib import Path

from redis import Redis

from app.core.config import get_settings
from app.core.errors import ApiError, sanitize_log
from app.db import repository
from app.domain.contracts import AudioAsset, JobStatus, ProgressMode, StageStatus, Tempo
from app.services.audio_probe import ffprobe
from app.services.ids import new_id
from app.services.queue import enqueue_pitch, enqueue_separation, redis_client
from app.services.storage import relative_to_root, resolve_inside, sha256_file, write_json
from app.workers.audio_tools import ffmpeg_convert
from app.workers.stages import complete_stage_from_existing_artifacts, fail_stage, is_stage_confirmed, require_stage_settings, set_stage


def main() -> None:
    client = redis_client()
    queue = get_settings().queue_name
    while True:
        item = client.brpop(queue, timeout=5)
        if not item:
            continue
        _, payload = item
        event = json.loads(payload)
        process_job(event["jobId"], event.get("startStage", "preprocessing"))


def process_job(job_id: str, start_stage: str) -> None:
    if start_stage == "separating_vocals":
        enqueue_separation(job_id)
        return
    if start_stage in {"detecting_pitch", "aligning"}:
        enqueue_pitch(job_id, start_stage=start_stage)
        return
    if start_stage == "preprocessing":
        if not run_stage(job_id, "preprocessing", "ffmpeg", run_preprocessing):
            return
    if start_stage in {"preprocessing", "detecting_bpm"}:
        if not run_stage(job_id, "detecting_bpm", "essentia", run_bpm):
            return
        job = repository.get_job(job_id)
        if job and is_stage_confirmed(job, "separating_vocals"):
            enqueue_separation(job_id)
        else:
            require_stage_settings(
                job_id,
                "separating_vocals",
                "demucs",
                "Wybierz ustawienia separacji wokalu",
                "worker-separate-stems",
                "separation",
                {"separationModel": job.profiles.separationModel if job else "htdemucs_ft"},
            )


def run_stage(job_id: str, stage: str, substep: str, handler) -> bool:
    try:
        handler(job_id)
        return True
    except ApiError as exc:
        fail_stage(job_id, stage, substep, exc.message, str(exc.details), "orchestrator")
    except Exception as exc:  # pragma: no cover - worker guard
        fail_stage(job_id, stage, substep, "Nieoczekiwany blad workera.", sanitize_log(str(exc)), "orchestrator")
    return False


def source_asset(job_id: str) -> AudioAsset:
    job = repository.get_job(job_id)
    if not job:
        raise RuntimeError("job not found")
    for asset in job.artifacts:
        if asset.type == "source_audio":
            return asset
    raise RuntimeError("source artifact missing")


def run_preprocessing(job_id: str) -> None:
    job = repository.get_job(job_id)
    if not job:
        raise RuntimeError("job not found")
    existing_types = {asset.type for asset in job.artifacts}
    if {"mix", "bpm_input", "audio_metadata"}.issubset(existing_types):
        complete_stage_from_existing_artifacts(job_id, "preprocessing", "ffmpeg", "Preprocessing audio", "orchestrator")
        return
    repository.update_job_status(job_id, JobStatus.preprocessing)
    set_stage(job_id, "preprocessing", "ffmpeg", StageStatus.running, "Preprocessing audio", "orchestrator", ProgressMode.estimated, 15)
    src = source_asset(job_id)
    source_path = resolve_inside(src.path)
    job_dir = resolve_inside(f"jobs/{job_id}")
    mix_path = job_dir / "artifacts" / "mix.wav"
    bpm_path = job_dir / "artifacts" / "worker_inputs" / "bpm.wav"
    ffmpeg_convert(source_path, mix_path, 44100, 2)
    set_stage(job_id, "preprocessing", "ffmpeg", StageStatus.running, "Preprocessing audio", "orchestrator", ProgressMode.estimated, 65)
    ffmpeg_convert(source_path, bpm_path, 44100, 1)
    audio = ffprobe(mix_path)
    audio_metadata = {
        "sampleRate": audio.sampleRate,
        "channels": audio.channels,
        "durationSec": audio.durationSec,
        "loudness": None,
        "sha256": sha256_file(mix_path),
        "sourceSha256": src.sha256,
    }
    metadata_path = job_dir / "artifacts" / "audio_metadata.json"
    write_json(metadata_path, audio_metadata)
    artifacts = [
        AudioAsset(assetId=new_id("asset"), type="mix", path=relative_to_root(mix_path), durationSec=audio.durationSec, sampleRate=44100, channels=2, sha256=sha256_file(mix_path), sizeBytes=mix_path.stat().st_size, producedByStage="preprocessing", producedBySubstep="ffmpeg"),
        AudioAsset(assetId=new_id("asset"), type="bpm_input", path=relative_to_root(bpm_path), sampleRate=44100, channels=1, sha256=sha256_file(bpm_path), sizeBytes=bpm_path.stat().st_size, producedByStage="preprocessing", producedBySubstep="ffmpeg"),
        AudioAsset(assetId=new_id("asset"), type="audio_metadata", path=relative_to_root(metadata_path), mimeType="application/json", sha256=sha256_file(metadata_path), sizeBytes=metadata_path.stat().st_size, producedByStage="preprocessing", producedBySubstep="ffmpeg"),
    ]
    for asset in artifacts:
        repository.create_artifact(job_id, asset)
    set_stage(job_id, "preprocessing", "ffmpeg", StageStatus.completed, "Preprocessing audio", "orchestrator", ProgressMode.determinate, 100, artifact_ids=[asset.assetId for asset in artifacts])


def run_bpm(job_id: str) -> None:
    job = repository.get_job(job_id)
    if not job:
        raise RuntimeError("job not found")
    if job.tempo:
        complete_stage_from_existing_artifacts(job_id, "detecting_bpm", "essentia", "Rozpoznawanie BPM", "orchestrator")
        return
    repository.update_job_status(job_id, JobStatus.detecting_bpm)
    set_stage(job_id, "detecting_bpm", "essentia", StageStatus.running, "Rozpoznawanie BPM", "orchestrator", ProgressMode.indeterminate)
    bpm_asset = next(asset for asset in job.artifacts if asset.type == "bpm_input")
    bpm_path = resolve_inside(bpm_asset.path)
    tempo, raw = detect_bpm(bpm_path)
    tempo_path = resolve_inside(f"jobs/{job_id}/artifacts/tempo.json")
    write_json(tempo_path, raw | tempo.model_dump())
    tempo_asset = AudioAsset(
        assetId=new_id("asset"),
        type="tempo",
        path=relative_to_root(tempo_path),
        mimeType="application/json",
        sha256=sha256_file(tempo_path),
        sizeBytes=tempo_path.stat().st_size,
        producedByStage="detecting_bpm",
        producedBySubstep="essentia",
        metadata={"method": tempo.method},
    )
    repository.create_artifact(job_id, tempo_asset)
    repository.set_tempo(job_id, tempo)
    set_stage(job_id, "detecting_bpm", "essentia", StageStatus.completed, "Rozpoznawanie BPM", "orchestrator", ProgressMode.determinate, 100, artifact_ids=[tempo_asset.assetId])


def detect_bpm(path: Path) -> tuple[Tempo, dict]:
    try:
        import essentia.standard as es
    except Exception as exc:
        raise RuntimeError("Essentia nie jest dostepna w obrazie workera BPM.") from exc
    audio = es.MonoLoader(filename=str(path), sampleRate=44100)()
    rhythm = es.RhythmExtractor2013(method="multifeature")
    bpm, beats, confidence, estimates, _ = rhythm(audio)
    alternatives = [float(value) for value in list(estimates)[:8]]
    tempo = Tempo(
        detectedSongBpm=float(bpm),
        acceptedSongBpm=float(bpm),
        ultrastarBpm=float(bpm) * 4,
        gapMs=int(float(beats[0]) * 1000) if len(beats) else 0,
        confidence=float(confidence),
        method="essentia_RhythmExtractor2013",
        requiresReview=float(confidence) < 0.7,
        beatPositionsSec=[float(value) for value in beats],
        alternatives=alternatives,
    )
    return tempo, {"essentia": {"algorithm": "RhythmExtractor2013", "sampleRate": 44100}}


if __name__ == "__main__":
    main()
