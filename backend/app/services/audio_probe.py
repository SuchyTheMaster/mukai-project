import json
import mimetypes
import subprocess
from pathlib import Path

from mutagen import File as MutagenFile

from app.core.errors import api_error, sanitize_log
from app.domain.contracts import AudioInfo, EmbeddedCover, SourceMetadata
from app.services.ids import new_id
from app.services.storage import safe_filename


SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".mp4", ".m4a", ".ogg", ".flac"}
SUPPORTED_MIME_PREFIXES = ("audio/",)
SUPPORTED_MIME_VALUES = {"video/mp4", "application/ogg", "video/ogg", "application/octet-stream"}


def validate_extension(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise api_error(400, "unsupported_extension", "Obslugiwane formaty to WAV, MP3, MP4, M4A, OGG i FLAC.")
    return suffix


def validate_mime(filename: str, content_type: str | None) -> str:
    detected = content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    if not (detected.startswith(SUPPORTED_MIME_PREFIXES) or detected in SUPPORTED_MIME_VALUES):
        raise api_error(400, "unsupported_mime", "MIME pliku nie wyglada na obslugiwany kontener audio.", {"mimeType": detected})
    return detected


def ffprobe(path: Path) -> AudioInfo:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        str(path),
    ]
    try:
        completed = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=30)
    except FileNotFoundError as exc:
        raise api_error(503, "ffprobe_missing", "ffprobe jest wymagany do walidacji uploadu.") from exc
    except subprocess.CalledProcessError as exc:
        raise api_error(400, "ffprobe_rejected", "Plik nie zawiera poprawnej obslugiwanej sciezki audio.", {"log": sanitize_log(exc.stderr)}) from exc
    except subprocess.TimeoutExpired as exc:
        raise api_error(400, "ffprobe_timeout", "Walidacja techniczna pliku przekroczyla limit czasu.") from exc

    payload = json.loads(completed.stdout)
    audio_stream = next((stream for stream in payload.get("streams", []) if stream.get("codec_type") == "audio"), None)
    if not audio_stream:
        raise api_error(400, "no_audio_stream", "Plik nie zawiera obslugiwanej sciezki audio.")
    fmt = payload.get("format", {})
    duration = audio_stream.get("duration") or fmt.get("duration")
    return AudioInfo(
        durationSec=float(duration) if duration else None,
        sampleRate=int(audio_stream["sample_rate"]) if audio_stream.get("sample_rate") else None,
        channels=int(audio_stream["channels"]) if audio_stream.get("channels") else None,
        codec=audio_stream.get("codec_name"),
        container=(fmt.get("format_name") or Path(path).suffix.lower().lstrip(".")),
    )


def _first_text(tags: dict, keys: list[str]) -> str | None:
    for key in keys:
        value = tags.get(key)
        if value is None:
            continue
        if isinstance(value, list) and value:
            return str(value[0])
        if hasattr(value, "text") and value.text:
            return str(value.text[0])
        text = str(value)
        if text:
            return text
    return None


def _detect_encoding(tags: dict) -> str:
    encodings = set()
    for value in tags.values():
        encoding = getattr(value, "encoding", None)
        if encoding is None:
            continue
        encodings.add("utf16" if int(encoding) in {1, 2} else "utf8")
    if len(encodings) > 1:
        return "mixed"
    if encodings:
        return encodings.pop()
    return "unknown"


def read_tags(path: Path) -> tuple[SourceMetadata, tuple[str, bytes] | None]:
    audio = MutagenFile(path)
    if not audio or not audio.tags:
        return SourceMetadata(missingFields=["title", "artist", "language"]), None
    tags = audio.tags
    metadata = SourceMetadata(
        title=_first_text(tags, ["TIT2", "\xa9nam", "TITLE", "title"]),
        artist=_first_text(tags, ["TPE1", "\xa9ART", "ARTIST", "artist"]),
        album=_first_text(tags, ["TALB", "\xa9alb", "ALBUM", "album"]),
        year=_first_text(tags, ["TDRC", "TYER", "\xa9day", "DATE", "date"]),
        genre=_first_text(tags, ["TCON", "\xa9gen", "GENRE", "genre"]),
        source="audio_tags",
        tagEncoding=_detect_encoding(tags),
    )
    missing = [field for field in ["title", "artist", "language"] if not getattr(metadata, field, None)]
    metadata.missingFields = missing

    cover: tuple[str, bytes] | None = None
    for key, value in tags.items():
        if key.startswith("APIC") and hasattr(value, "data"):
            cover = (value.mime or "image/jpeg", value.data)
            break
        if key == "covr" and value:
            item = value[0]
            mime = "image/png" if getattr(item, "imageformat", None) == 14 else "image/jpeg"
            cover = (mime, bytes(item))
            break
        if key.lower() in {"metadata_block_picture", "coverart"}:
            data = bytes(value[0] if isinstance(value, list) else value)
            cover = ("image/jpeg", data)
            break
    return metadata, cover


def cover_extension(mime_type: str) -> str:
    return ".png" if mime_type == "image/png" else ".jpg"
