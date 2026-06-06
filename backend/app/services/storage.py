import hashlib
import json
import re
import unicodedata
from pathlib import Path
from shutil import copyfileobj
from typing import BinaryIO

from fastapi import UploadFile

from app.core.config import get_settings
from app.core.errors import api_error


CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
SAFE_NAME = re.compile(r"[^\w._ -]+", flags=re.UNICODE)


def artifact_root() -> Path:
    root = Path(get_settings().artifact_root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def safe_filename(filename: str | None, fallback: str = "upload.bin") -> str:
    clean = (filename or fallback).replace("\\", "/").split("/")[-1]
    clean = unicodedata.normalize("NFC", clean)
    clean = CONTROL_CHARS.sub("", clean)
    clean = SAFE_NAME.sub("_", clean).strip(" .")
    return clean or fallback


def resolve_inside(relative_path: str) -> Path:
    root = artifact_root()
    target = (root / relative_path).resolve()
    if root != target and root not in target.parents:
        raise api_error(400, "unsafe_path", "Sciezka artefaktu wychodzi poza magazyn aplikacji.")
    return target


def relative_to_root(path: Path) -> str:
    return path.resolve().relative_to(artifact_root()).as_posix()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


async def save_upload(upload: UploadFile, destination: Path, max_bytes: int) -> int:
    destination.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    with destination.open("wb") as out:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                raise api_error(413, "upload_too_large", "Plik przekracza limit 500 MB.")
            out.write(chunk)
    await upload.seek(0)
    return size


def copy_stream(source: BinaryIO, destination: Path) -> int:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as out:
        copyfileobj(source, out)
    return destination.stat().st_size


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))
