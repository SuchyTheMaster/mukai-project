import shutil
import zipfile
from pathlib import Path

from app.core.errors import api_error
from app.domain.contracts import (
    Arrangement,
    ArrangementSentence,
    ArrangementSyllable,
    AudioAsset,
    ExportArtifactRef,
    ExportSelection,
    ExportValidationIssue,
    ExportValidationReport,
    Job,
    JobStatus,
)
from app.services.ids import new_id
from app.services.storage import relative_to_root, resolve_inside, safe_filename, sha256_file, write_json
from app.workers.audio_tools import run_command


NOTE_SYMBOL = {
    "normal": ":",
    "golden": "*",
    "freestyle": "F",
    "rap": "R",
    "rap_golden": "G",
}

PITCHED_NOTE_TYPES = {"normal", "golden", "rap", "rap_golden"}


def seconds_to_ultrastar_beats(start_sec: float, end_sec: float, accepted_song_bpm: float, gap_ms: int) -> tuple[int, int, int]:
    ultrastar_bpm = accepted_song_bpm * 4
    beat_ms = 60000 / ultrastar_bpm
    start_beat = round((start_sec * 1000 - gap_ms) / beat_ms)
    raw_length_beats = round((end_sec - start_sec) * 1000 / beat_ms)
    return start_beat, max(1, raw_length_beats), raw_length_beats


def midi_to_ultrastar_pitch(midi_note: int) -> int:
    return midi_note - 60


def validate_export(job: Job, arrangement: Arrangement | None, selection: ExportSelection) -> ExportValidationReport:
    issues: list[ExportValidationIssue] = []
    warnings: list[ExportValidationIssue] = []

    def error(code: str, message: str, details: dict | None = None) -> None:
        issues.append(ExportValidationIssue(severity="error", code=code, message=message, details=details or {}))

    def warning(code: str, message: str, details: dict | None = None) -> None:
        warnings.append(ExportValidationIssue(severity="warning", code=code, message=message, details=details or {}))

    assets_by_type = _assets_by_type(job)
    assets_by_id = {asset.assetId: asset for asset in job.artifacts}

    if job.status != JobStatus.awaiting_review:
        error("job_not_exportable", "Eksport jest dostepny tylko w statusie awaiting_review.", {"status": job.status})
    if not job.tempo:
        error("missing_tempo", "Brakuje zaakceptowanego BPM i GAP.")
    else:
        if job.tempo.acceptedSongBpm <= 0:
            error("invalid_bpm", "acceptedSongBpm musi byc dodatnie.", {"acceptedSongBpm": job.tempo.acceptedSongBpm})
        if job.tempo.gapMs is None:
            error("missing_gap", "Brakuje Tempo.gapMs.")
        elif job.tempo.gapMs < 0:
            warning("negative_gap", "#GAP jest ujemny.", {"gapMs": job.tempo.gapMs})
    if not arrangement:
        error("missing_arrangement", "Brakuje arrangementu do eksportu.")
    elif not arrangement.approved:
        error("arrangement_not_approved", "Arrangement musi byc zatwierdzony przed eksportem.")
    if not (job.metadata.title or "").strip():
        error("missing_title", "Brakuje tytulu utworu.")
    if not (job.metadata.artist or "").strip():
        error("missing_artist", "Brakuje artysty.")
    if not assets_by_type.get("source_audio"):
        error("missing_source_audio", "Brakuje oryginalnego audio dla tagu #AUDIO.")
    if not assets_by_type.get("instrumental"):
        error("missing_instrumental", "Brakuje stemu instrumentalnego dla tagu #INSTRUMENTAL.")
    if not assets_by_type.get("vocals"):
        error("missing_vocals", "Brakuje stemu wokalu dla tagu #VOCALS.")
    if selection.coverAssetId:
        cover = assets_by_id.get(selection.coverAssetId)
        if not cover or cover.type != "cover":
            error("invalid_cover", "Wybrany cover nie istnieje albo nie jest assetem cover.", {"coverAssetId": selection.coverAssetId})
    base_filename = export_safe_name(selection.baseFilename, "song")
    expected_audio_filenames = _expected_audio_filenames(base_filename)
    selected_audio_filenames = _selected_audio_filenames(selection)
    for key, expected in expected_audio_filenames.items():
        selected = selected_audio_filenames.get(key)
        if selected is not None and selected != expected:
            error(
                "invalid_audio_filename",
                "Nazwa pliku audio musi byc zgodna ze stalym wzorem eksportu.",
                {"field": key, "expected": expected, "actual": selected},
            )

    if arrangement and job.tempo:
        _validate_arrangement(arrangement, job.tempo.acceptedSongBpm, job.tempo.gapMs, error, warning)

    return ExportValidationReport(
        jobId=job.jobId,
        valid=not issues,
        selection=selection,
        errors=issues,
        warnings=warnings,
    )


def build_ultrastar_text(job: Job, arrangement: Arrangement, selection: ExportSelection, cover_filename: str | None = None) -> str:
    if not job.tempo:
        raise api_error(409, "missing_tempo", "Brakuje zaakceptowanego BPM i GAP.")
    base_filename = export_safe_name(selection.baseFilename, "song")
    audio_filenames = _audio_filenames(selection, base_filename)
    headers = [
        "#VERSION:1.1.0",
        f"#TITLE:{_header_value(job.metadata.title)}",
        f"#ARTIST:{_header_value(job.metadata.artist)}",
        f"#AUDIO:{audio_filenames['audio']}",
        f"#INSTRUMENTAL:{audio_filenames['instrumental']}",
        f"#VOCALS:{audio_filenames['vocals']}",
    ]
    headers.extend(
        [
            f"#BPM:{job.tempo.acceptedSongBpm * 4:g}",
            f"#GAP:{job.tempo.gapMs}",
            "#CREATOR:Mukai",
        ]
    )
    if job.metadata.language:
        headers.append(f"#LANGUAGE:{_header_value(job.metadata.language)}")
    if cover_filename:
        headers.append(f"#COVER:{cover_filename}")
    headers.append("#COMMENT:Generated draft reviewed in Mukai")

    lines = [*headers]
    for sentence in sorted(arrangement.sentences, key=lambda item: item.startSec):
        note_lines, separator = _sentence_note_lines(sentence, job.tempo.acceptedSongBpm, job.tempo.gapMs)
        if not note_lines:
            continue
        lines.extend(note_lines)
        lines.append(f"- {separator}")
    lines.append("E")
    return "\n".join(lines) + "\n"


def write_validation_report_artifact(job_id: str, report: ExportValidationReport) -> AudioAsset:
    asset_id = new_id("asset")
    report_path = resolve_inside(f"jobs/{job_id}/exports/{asset_id}/validation-report.json")
    write_json(report_path, report.model_dump(mode="json"))
    return AudioAsset(
        assetId=asset_id,
        type="export_validation_report",
        path=relative_to_root(report_path),
        originalFilename="validation-report.json",
        mimeType="application/json",
        sha256=sha256_file(report_path),
        sizeBytes=report_path.stat().st_size,
        producedByStage="exporting",
        producedBySubstep="validate",
        metadata={"valid": report.valid, "errors": len(report.errors), "warnings": len(report.warnings)},
    )


def generate_karaoke_exports(job: Job, arrangement: Arrangement, selection: ExportSelection) -> list[AudioAsset]:
    return [_generate_single_zip(job, arrangement, selection)]


def export_ref(asset: AudioAsset) -> ExportArtifactRef:
    return ExportArtifactRef(
        assetId=asset.assetId,
        type=asset.type,
        filename=asset.originalFilename or Path(asset.path).name,
    )


def export_safe_name(value: str | None, fallback: str) -> str:
    return safe_filename(value, fallback)


def _generate_single_zip(job: Job, arrangement: Arrangement, selection: ExportSelection) -> AudioAsset:
    assets_by_type = _assets_by_type(job)
    assets_by_id = {asset.assetId: asset for asset in job.artifacts}
    base_filename = export_safe_name(selection.baseFilename, "song")
    directory_name = export_safe_name(selection.internalDirectoryName, base_filename)
    audio_filenames = _audio_filenames(selection, base_filename)
    zip_filename = _zip_filename(selection, base_filename)
    asset_id = new_id("asset")
    exports_dir = resolve_inside(f"jobs/{job.jobId}/exports/{asset_id}")
    staging_dir = exports_dir / "staging-karaoke"
    zip_path = exports_dir / zip_filename
    if staging_dir.exists():
        shutil.rmtree(staging_dir)
    staging_song_dir = staging_dir / directory_name
    staging_song_dir.mkdir(parents=True, exist_ok=True)

    _convert_mp3(resolve_inside(assets_by_type["source_audio"].path), staging_song_dir / audio_filenames["audio"])
    _convert_mp3(resolve_inside(assets_by_type["instrumental"].path), staging_song_dir / audio_filenames["instrumental"])
    _convert_mp3(resolve_inside(assets_by_type["vocals"].path), staging_song_dir / audio_filenames["vocals"])

    cover_filename = None
    if selection.coverAssetId:
        cover = assets_by_id[selection.coverAssetId]
        cover_filename = _cover_filename(cover)
        shutil.copy2(resolve_inside(cover.path), staging_song_dir / cover_filename)

    txt = build_ultrastar_text(job, arrangement, selection, cover_filename=cover_filename)
    (staging_song_dir / f"{base_filename}.txt").write_text(txt, encoding="utf-8")

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_path in sorted(staging_song_dir.iterdir()):
            archive.write(file_path, arcname=f"{directory_name}/{file_path.name}")
    shutil.rmtree(staging_dir)

    return AudioAsset(
        assetId=asset_id,
        type="karaoke_zip",
        path=relative_to_root(zip_path),
        originalFilename=zip_filename,
        mimeType="application/zip",
        sha256=sha256_file(zip_path),
        sizeBytes=zip_path.stat().st_size,
        producedByStage="exporting",
        producedBySubstep="karaoke",
        metadata={"baseFilename": base_filename, "audioFilenames": audio_filenames},
    )


def _assets_by_type(job: Job) -> dict[str, AudioAsset]:
    return {asset.type: asset for asset in job.artifacts}


def _syllable_issue_details(syllable: ArrangementSyllable, **extra) -> dict:
    return {
        "syllableId": syllable.syllableId,
        "text": syllable.text or None,
        "startSec": syllable.startSec,
        "durationMs": round((syllable.endSec - syllable.startSec) * 1000),
        "midi": syllable.midi,
        **extra,
    }


def _validate_arrangement(arrangement: Arrangement, accepted_song_bpm: float, gap_ms: int, error, warning) -> None:
    previous_sentence_start = None
    previous_sentence = None
    for sentence in arrangement.sentences:
        if previous_sentence_start is not None and sentence.startSec < previous_sentence_start:
            error("sentences_out_of_order", "Frazy sa poza kolejnoscia.", {"sentenceId": sentence.sentenceId})
        if previous_sentence is not None and sentence.startSec < previous_sentence.endSec:
            error(
                "overlapping_line",
                "Frazy nachodza na siebie.",
                {"sentenceId": sentence.sentenceId, "previousSentenceId": previous_sentence.sentenceId},
            )
        previous_sentence_start = sentence.startSec
        previous_sentence = sentence
        previous_syllable_start = None
        for word in sentence.words:
            for syllable in word.syllables:
                if not syllable.text:
                    continue
                if "\n" in syllable.text or "\r" in syllable.text:
                    error("newline_in_syllable", "Tekst sylaby nie moze zawierac znaku nowej linii.", _syllable_issue_details(syllable))
                if previous_syllable_start is not None and syllable.startSec < previous_syllable_start:
                    error("syllables_out_of_order", "Sylaby w frazie sa poza kolejnoscia.", _syllable_issue_details(syllable))
                previous_syllable_start = syllable.startSec
                _, _, raw_length = seconds_to_ultrastar_beats(syllable.startSec, syllable.endSec, accepted_song_bpm, gap_ms)
                if raw_length < 1:
                    error("note_too_short", "Nuta ma mniej niz jeden beat po przeliczeniu do UltraStar.", _syllable_issue_details(syllable))
                if syllable.noteType in PITCHED_NOTE_TYPES and syllable.midi is None:
                    error("missing_midi", "Sylaba punktowana albo rap wymaga wartosci MIDI.", _syllable_issue_details(syllable, noteType=syllable.noteType))
                if syllable.noteType == "freestyle" and syllable.midi is None:
                    warning("freestyle_missing_midi", "Freestyle bez MIDI zostanie wyeksportowany z pitch 0.", _syllable_issue_details(syllable))
                if syllable.midi is not None and not 36 <= syllable.midi <= 84:
                    warning("pitch_out_of_vocal_range", "Pitch jest poza typowym zakresem wokalu.", _syllable_issue_details(syllable))


def _sentence_note_lines(sentence: ArrangementSentence, accepted_song_bpm: float, gap_ms: int) -> tuple[list[str], int]:
    lines: list[str] = []
    last_end_beat = None
    non_empty_word_index = 0
    for word in sentence.words:
        syllables = [item for item in word.syllables if item.text]
        if not syllables:
            continue
        for syllable_index, syllable in enumerate(syllables):
            start_beat, length_beats, _ = seconds_to_ultrastar_beats(syllable.startSec, syllable.endSec, accepted_song_bpm, gap_ms)
            pitch = _syllable_pitch(syllable)
            text = _syllable_text(syllable.text)
            if non_empty_word_index > 0 and syllable_index == 0:
                text = f" {text}"
            lines.append(f"{NOTE_SYMBOL[syllable.noteType]} {start_beat} {length_beats} {pitch} {text}")
            last_end_beat = start_beat + length_beats
        non_empty_word_index += 1
    sentence_end, _, _ = seconds_to_ultrastar_beats(sentence.endSec, sentence.endSec + 0.001, accepted_song_bpm, gap_ms)
    separator = max(sentence_end, last_end_beat or sentence_end)
    return lines, separator


def _syllable_pitch(syllable: ArrangementSyllable) -> int:
    if syllable.midi is None:
        return 0
    return midi_to_ultrastar_pitch(syllable.midi)


def _syllable_text(value: str) -> str:
    return value.replace("\r", " ").replace("\n", " ")


def _header_value(value: str | None) -> str:
    return (value or "").replace("\r", " ").replace("\n", " ").strip()


def _audio_filenames(selection: ExportSelection, base_filename: str) -> dict[str, str]:
    expected = _expected_audio_filenames(base_filename)
    selected = _selected_audio_filenames(selection)
    return {key: selected.get(key) or expected[key] for key in expected}


def _expected_audio_filenames(base_filename: str) -> dict[str, str]:
    return {
        "audio": f"{base_filename} [FULL].mp3",
        "instrumental": f"{base_filename} [INSTR].mp3",
        "vocals": f"{base_filename} [VOC].mp3",
    }


def _selected_audio_filenames(selection: ExportSelection) -> dict[str, str | None]:
    return {
        "audio": selection.audioFilenames.audio,
        "instrumental": selection.audioFilenames.instrumental,
        "vocals": selection.audioFilenames.vocals,
    }


def _zip_filename(selection: ExportSelection, base_filename: str) -> str:
    pattern = selection.zipNamePattern or "{baseFilename} [karaoke].zip"
    rendered = pattern.format(baseFilename=base_filename)
    if not rendered.lower().endswith(".zip"):
        rendered = f"{rendered}.zip"
    if pattern == "{baseFilename} [karaoke].zip":
        return rendered
    return safe_filename(rendered, f"{base_filename} [karaoke].zip")


def _cover_filename(cover: AudioAsset) -> str:
    suffix = Path(cover.originalFilename or cover.path).suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png"}:
        suffix = ".jpg" if cover.mimeType == "image/jpeg" else ".png"
    return f"cover{suffix}"


def _convert_mp3(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    run_command(
        [
            "ffmpeg",
            "-hide_banner",
            "-y",
            "-i",
            str(source),
            "-vn",
            "-codec:a",
            "libmp3lame",
            "-q:a",
            "2",
            str(destination),
        ]
    )
