import json
import os
import shutil
import subprocess
import time
from pathlib import Path

from app.core.config import get_settings
from app.core.errors import sanitize_log
from app.db import repository
from app.domain.contracts import AudioAsset, JobStatus, ProgressMode, StageStatus
from app.services.ids import new_id
from app.services.queue import redis_client
from app.services.storage import relative_to_root, resolve_inside, sha256_file, write_json
from app.workers.audio_tools import ffmpeg_convert
from app.workers.stages import fail_stage, require_stage_settings, set_stage


# First run intentionally omits --segment, so Demucs uses the model default.
DEFAULT_SEGMENT_SEC = None
OOM_SEGMENT_SEC = 4


def main() -> None:
    client = redis_client()
    queue = get_settings().separation_queue_name
    while True:
        item = client.brpop(queue, timeout=5)
        if not item:
            continue
        _, payload = item
        event = json.loads(payload)
        process_job(event["jobId"])


def process_job(job_id: str) -> None:
    try:
        run_separation(job_id)
    except Exception as exc:  # pragma: no cover - worker guard
        fail_stage(job_id, "separating_vocals", "demucs", "Separacja wokalu nie powiodla sie.", sanitize_log(str(exc)), "worker-separate-stems")


def run_separation(job_id: str) -> None:
    job = repository.get_job(job_id)
    if not job:
        raise RuntimeError("job not found")
    if any(asset.type == "vocals" for asset in job.artifacts):
        return

    repository.update_job_status(job_id, JobStatus.separating_vocals)
    set_stage(job_id, "separating_vocals", "demucs", StageStatus.running, "Start Demucs", "worker-separate-stems", ProgressMode.estimated, 5)
    mix = next((asset for asset in job.artifacts if asset.type == "mix"), None)
    if not mix:
        raise RuntimeError("Brak mix.wav z etapu preprocessing.")
    mix_path = resolve_inside(mix.path)
    job_dir = resolve_inside(f"jobs/{job_id}")
    demucs_input = job_dir / "artifacts" / "worker_inputs" / "demucs.wav"
    if not demucs_input.exists():
        shutil.copy2(mix_path, demucs_input)

    diagnostics = runtime_diagnostics()
    if diagnostics["device"] == "cpu" and not get_settings().allow_cpu_separation:
        raise RuntimeError("GPU nie jest dostepne, a tryb CPU jest wylaczony.")

    started = time.monotonic()
    output_root = job_dir / "work" / "demucs"
    model = job.profiles.separationModel
    segment = DEFAULT_SEGMENT_SEC
    try:
        run_demucs(demucs_input, output_root, model, diagnostics["device"], segment)
    except DemucsOutOfMemory:
        set_stage(job_id, "separating_vocals", "demucs", StageStatus.running, "OOM GPU, ponowna proba z mniejszym segmentem", "worker-separate-stems", ProgressMode.estimated, 42)
        segment = OOM_SEGMENT_SEC
        run_demucs(demucs_input, output_root, model, diagnostics["device"], segment)

    source_dir = output_root / model / demucs_input.stem
    vocals_src = source_dir / "vocals.wav"
    instrumental_src = source_dir / "no_vocals.wav"
    if not vocals_src.exists() or not instrumental_src.exists():
        raise RuntimeError("Demucs nie utworzyl oczekiwanych stems vocals.wav i no_vocals.wav.")

    artifacts_dir = job_dir / "artifacts"
    vocals_path = artifacts_dir / "vocals.wav"
    instrumental_path = artifacts_dir / "instrumental.wav"
    shutil.copy2(vocals_src, vocals_path)
    shutil.copy2(instrumental_src, instrumental_path)
    whisperx_path = artifacts_dir / "worker_inputs" / "whisperx.wav"
    torchcrepe_path = artifacts_dir / "worker_inputs" / "torchcrepe.wav"
    ffmpeg_convert(vocals_path, whisperx_path, 16000, 1)
    ffmpeg_convert(vocals_path, torchcrepe_path, 16000, 1)

    diagnostics |= {
        "model": model,
        "demucsVersion": package_version("demucs"),
        "torchVersion": package_version("torch"),
        "cudaVariant": os.getenv("TORCH_CUDA_VARIANT", "unknown"),
        "environmentSource": os.getenv("TORCH_ENV_SOURCE", "unknown"),
        "segmentSec": segment,
        "segmentMode": "model_default" if segment is None else "explicit",
        "inputSha256": sha256_file(demucs_input),
        "processingSec": round(time.monotonic() - started, 3),
    }
    separation_path = artifacts_dir / "separation.json"
    write_json(separation_path, diagnostics)

    assets = [
        AudioAsset(assetId=new_id("asset"), type="demucs_input", path=relative_to_root(demucs_input), sampleRate=44100, channels=2, sha256=sha256_file(demucs_input), sizeBytes=demucs_input.stat().st_size, producedByStage="separating_vocals", producedBySubstep="demucs", metadata={"model": model}),
        AudioAsset(assetId=new_id("asset"), type="vocals", path=relative_to_root(vocals_path), sampleRate=44100, channels=2, sha256=sha256_file(vocals_path), sizeBytes=vocals_path.stat().st_size, producedByStage="separating_vocals", producedBySubstep="demucs", metadata={"model": model}),
        AudioAsset(assetId=new_id("asset"), type="instrumental", path=relative_to_root(instrumental_path), sampleRate=44100, channels=2, sha256=sha256_file(instrumental_path), sizeBytes=instrumental_path.stat().st_size, producedByStage="separating_vocals", producedBySubstep="demucs", metadata={"model": model}),
        AudioAsset(assetId=new_id("asset"), type="whisperx_input", path=relative_to_root(whisperx_path), sampleRate=16000, channels=1, sha256=sha256_file(whisperx_path), sizeBytes=whisperx_path.stat().st_size, producedByStage="separating_vocals", producedBySubstep="demucs", metadata={"source": "vocals"}),
        AudioAsset(assetId=new_id("asset"), type="torchcrepe_input", path=relative_to_root(torchcrepe_path), sampleRate=16000, channels=1, sha256=sha256_file(torchcrepe_path), sizeBytes=torchcrepe_path.stat().st_size, producedByStage="separating_vocals", producedBySubstep="demucs", metadata={"source": "vocals"}),
        AudioAsset(assetId=new_id("asset"), type="separation_manifest", path=relative_to_root(separation_path), mimeType="application/json", sha256=sha256_file(separation_path), sizeBytes=separation_path.stat().st_size, producedByStage="separating_vocals", producedBySubstep="demucs", metadata={"model": model}),
    ]
    for asset in assets:
        repository.create_artifact(job_id, asset)
    set_stage(job_id, "separating_vocals", "demucs", StageStatus.completed, "Separacja wokalu", "worker-separate-stems", ProgressMode.determinate, 100, artifact_ids=[asset.assetId for asset in assets])
    require_stage_settings(
        job_id,
        "transcribing",
        "whisperx",
        "Wybierz ustawienia transkrypcji",
        "worker-transcribe",
        "transcription",
        {
            "transcriptionModel": job.profiles.transcriptionModel,
            "vadMethod": job.transcriptionSettings.vadMethod,
            "syllabification": job.syllabificationSettings.method,
        },
    )


class DemucsOutOfMemory(RuntimeError):
    pass


def run_demucs(input_path: Path, output_root: Path, model: str, device: str, segment: int | None) -> None:
    output_root.mkdir(parents=True, exist_ok=True)
    cmd = [
        "python",
        "-m",
        "demucs",
        "--two-stems",
        "vocals",
        "-n",
        model,
        "--device",
        device,
        "-o",
        str(output_root),
        str(input_path),
    ]
    if segment is not None:
        cmd[9:9] = ["--segment", str(segment)]
    completed = subprocess.run(cmd, capture_output=True, text=True)
    if completed.returncode == 0:
        return
    log = sanitize_log(completed.stderr + "\n" + completed.stdout)
    if "out of memory" in log.lower() or "cuda oom" in log.lower():
        raise DemucsOutOfMemory(log)
    raise RuntimeError(log)


def runtime_diagnostics() -> dict:
    try:
        import torch

        cuda = torch.cuda.is_available()
        device = "cuda" if cuda else "cpu"
        return {
            "device": device,
            "cudaAvailable": cuda,
            "cudaDeviceName": torch.cuda.get_device_name(0) if cuda else None,
            "cudaDeviceCount": torch.cuda.device_count() if cuda else 0,
            "cudaMemoryBytes": torch.cuda.get_device_properties(0).total_memory if cuda else None,
        }
    except Exception as exc:
        return {"device": "cpu", "cudaAvailable": False, "cudaDeviceName": None, "cudaDeviceCount": 0, "cudaMemoryBytes": None, "torchDiagnostic": sanitize_log(str(exc))}


def package_version(module_name: str) -> str | None:
    try:
        module = __import__(module_name)
        return getattr(module, "__version__", None)
    except Exception:
        return None


if __name__ == "__main__":
    main()
