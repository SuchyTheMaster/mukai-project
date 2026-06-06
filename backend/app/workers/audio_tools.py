import json
import subprocess
from pathlib import Path

from app.core.errors import api_error, sanitize_log


def run_command(cmd: list[str], timeout: int | None = None) -> str:
    try:
        completed = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError as exc:
        raise api_error(503, "tool_missing", f"Brak wymaganego narzedzia: {cmd[0]}") from exc
    except subprocess.CalledProcessError as exc:
        raise api_error(500, "tool_failed", f"Polecenie {cmd[0]} zakonczylo sie bledem.", {"log": sanitize_log(exc.stderr)}) from exc
    except subprocess.TimeoutExpired as exc:
        raise api_error(500, "tool_timeout", f"Polecenie {cmd[0]} przekroczylo limit czasu.") from exc
    return completed.stdout


def ffmpeg_convert(source: Path, target: Path, sample_rate: int, channels: int) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-y",
        "-i",
        str(source),
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        str(sample_rate),
        "-ac",
        str(channels),
        str(target),
    ]
    run_command(cmd)


def ffprobe_json(path: Path) -> dict:
    stdout = run_command(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            str(path),
        ]
    )
    return json.loads(stdout)
