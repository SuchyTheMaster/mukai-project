from __future__ import annotations

import gc
import json
import math
import os
import time
import wave
from importlib import metadata
from pathlib import Path

from app.core.config import get_settings
from app.core.errors import sanitize_log
from app.db import repository
from app.domain.contracts import (
    Arrangement,
    ArrangementLine,
    AudioAsset,
    JobStatus,
    KaraokeToken,
    NoteEvent,
    PitchFrame,
    ProgressMode,
    StageStatus,
    TranscriptSegment,
)
from app.services.ids import new_id
from app.services.queue import redis_client
from app.services.storage import read_json, relative_to_root, resolve_inside, sha256_file, write_json
from app.workers.stages import fail_stage, set_stage


PITCH_SAMPLE_RATE = 16000
MIN_VOCAL_MIDI = 36
MAX_VOCAL_MIDI = 84


def main() -> None:
    client = redis_client()
    queue = get_settings().pitch_queue_name
    while True:
        item = client.brpop(queue, timeout=5)
        if not item:
            continue
        _, payload = item
        event = json.loads(payload)
        process_job(event["jobId"], event.get("startStage", "detecting_pitch"))


def process_job(job_id: str, start_stage: str = "detecting_pitch") -> None:
    if start_stage == "aligning":
        try:
            run_draft_alignment(job_id)
        except Exception as exc:  # pragma: no cover - worker guard
            fail_stage(job_id, "aligning", "draft", "Szkic arrangement nie powiodl sie.", sanitize_log(str(exc)), "worker-aligner")
        return
    try:
        run_pitch_detection(job_id)
    except Exception as exc:  # pragma: no cover - worker guard
        fail_stage(job_id, "detecting_pitch", "pitch_detection", "Detekcja pitch nie powiodla sie.", sanitize_log(str(exc)), "worker-pitch")
        return
    try:
        run_draft_alignment(job_id)
    except Exception as exc:  # pragma: no cover - worker guard
        fail_stage(job_id, "aligning", "draft", "Szkic arrangement nie powiodl sie.", sanitize_log(str(exc)), "worker-aligner")


def run_pitch_detection(job_id: str) -> None:
    job = repository.get_job(job_id)
    if not job:
        raise RuntimeError("job not found")
    if any(asset.type == "pitch_notes" for asset in job.artifacts):
        return

    torchcrepe_input = next((asset for asset in job.artifacts if asset.type == "torchcrepe_input"), None)
    if not torchcrepe_input:
        raise RuntimeError("Brak worker_inputs/torchcrepe.wav z etapu separacji.")

    settings = get_settings()
    repository.update_job_status(job_id, JobStatus.detecting_pitch)
    set_stage(job_id, "detecting_pitch", "pitch_detection", StageStatus.running, "Start torchcrepe", "worker-pitch", ProgressMode.estimated, 5)

    input_path = resolve_inside(torchcrepe_input.path)
    diagnostics = runtime_diagnostics()
    if diagnostics["device"] == "cpu" and not settings.allow_cpu_pitch:
        raise RuntimeError("GPU nie jest dostepne, a tryb CPU dla pitch detection jest wylaczony.")

    started = time.monotonic()
    audio, sample_rate = read_wav_mono(input_path)
    if sample_rate != PITCH_SAMPLE_RATE:
        raise RuntimeError(f"worker_inputs/torchcrepe.wav ma sample rate {sample_rate}, oczekiwano {PITCH_SAMPLE_RATE}.")

    set_stage(job_id, "detecting_pitch", "pitch_detection", StageStatus.running, "Analiza F0", "worker-pitch", ProgressMode.estimated, 35)
    frequencies, periodicities = predict_pitch(audio, sample_rate, diagnostics["device"], settings.pitch_batch_size, job.pitchSettings.frameStepMs)
    frames = build_pitch_frames(audio, sample_rate, frequencies, periodicities, job.pitchSettings)

    set_stage(job_id, "detecting_pitch", "pitch_detection", StageStatus.running, "Segmentacja nut", "worker-pitch", ProgressMode.estimated, 75)
    notes = segment_notes(frames, job.pitchSettings)

    diagnostics |= {
        "torchcrepeVersion": package_version("torchcrepe"),
        "torchVersion": package_version("torch"),
        "cudaVariant": os.getenv("TORCH_CUDA_VARIANT", "unknown"),
        "environmentSource": os.getenv("TORCH_ENV_SOURCE", "unknown"),
        "sampleRate": sample_rate,
        "frameStepMs": job.pitchSettings.frameStepMs,
        "silenceThresholdDb": job.pitchSettings.silenceThresholdDb,
        "periodicityThreshold": job.pitchSettings.periodicityThreshold,
        "minNoteLengthMs": job.pitchSettings.minNoteLengthMs,
        "mergeGapMs": job.pitchSettings.mergeGapMs,
        "inputSha256": sha256_file(input_path),
        "frameCount": len(frames),
        "noteCount": len(notes),
        "processingSec": round(time.monotonic() - started, 3),
    }

    artifacts_dir = resolve_inside(f"jobs/{job_id}/artifacts")
    frames_path = artifacts_dir / "pitch.frames.json"
    notes_path = artifacts_dir / "pitch.notes.json"
    write_json(
        frames_path,
        {
            "schemaVersion": "1.0.0",
            "jobId": job_id,
            "stage": "detecting_pitch",
            "substep": "pitch_detection",
            "diagnostics": diagnostics,
            "frames": [frame.model_dump() for frame in frames],
        },
    )
    write_json(
        notes_path,
        {
            "schemaVersion": "1.0.0",
            "jobId": job_id,
            "stage": "detecting_pitch",
            "substep": "pitch_detection",
            "diagnostics": diagnostics,
            "noteEvents": [note.model_dump() for note in notes],
        },
    )

    assets = [
        AudioAsset(
            assetId=new_id("asset"),
            type="pitch_frames",
            path=relative_to_root(frames_path),
            mimeType="application/json",
            sha256=sha256_file(frames_path),
            sizeBytes=frames_path.stat().st_size,
            producedByStage="detecting_pitch",
            producedBySubstep="pitch_detection",
            metadata={"model": "torchcrepe", "frameCount": len(frames)},
        ),
        AudioAsset(
            assetId=new_id("asset"),
            type="pitch_notes",
            path=relative_to_root(notes_path),
            mimeType="application/json",
            sha256=sha256_file(notes_path),
            sizeBytes=notes_path.stat().st_size,
            producedByStage="detecting_pitch",
            producedBySubstep="pitch_detection",
            metadata={"model": "torchcrepe", "noteCount": len(notes)},
        ),
    ]
    for asset in assets:
        repository.create_artifact(job_id, asset)
    set_stage(job_id, "detecting_pitch", "pitch_detection", StageStatus.completed, "Detekcja pitch", "worker-pitch", ProgressMode.determinate, 100, artifact_ids=[asset.assetId for asset in assets])
    cleanup_memory()


def run_draft_alignment(job_id: str) -> None:
    job = repository.get_job(job_id)
    if not job:
        raise RuntimeError("job not found")
    if repository.get_arrangement(job_id) and any(asset.type == "draft_arrangement" for asset in job.artifacts):
        repository.update_job_status(job_id, JobStatus.awaiting_review)
        return

    transcript_asset = next((asset for asset in job.artifacts if asset.type == "transcript_aligned"), None)
    notes_asset = next((asset for asset in job.artifacts if asset.type == "pitch_notes"), None)
    if not transcript_asset:
        raise RuntimeError("Brak transcript.aligned.json z etapu transkrypcji.")
    if not notes_asset:
        raise RuntimeError("Brak pitch.notes.json z etapu pitch detection.")

    repository.update_job_status(job_id, JobStatus.aligning)
    set_stage(job_id, "aligning", "draft", StageStatus.running, "Laczenie tekstu z nutami", "worker-aligner", ProgressMode.estimated, 20)

    transcript_payload = read_json(resolve_inside(transcript_asset.path))
    notes_payload = read_json(resolve_inside(notes_asset.path))
    segments = [TranscriptSegment.model_validate(segment) for segment in transcript_payload.get("segments", [])]
    notes = [NoteEvent.model_validate(note) for note in notes_payload.get("noteEvents", [])]
    arrangement = build_arrangement(job_id, segments, notes)

    draft_path = resolve_inside(f"jobs/{job_id}/artifacts/draft.arrangement.json")
    write_json(
        draft_path,
        {
            "schemaVersion": "1.0.0",
            "jobId": job_id,
            "stage": "aligning",
            "substep": "draft",
            "sourceArtifacts": {
                "transcriptAlignedAssetId": transcript_asset.assetId,
                "pitchNotesAssetId": notes_asset.assetId,
            },
            "arrangement": arrangement.model_dump(mode="json"),
        },
    )

    saved = repository.save_arrangement(job_id, arrangement)
    draft_asset = AudioAsset(
        assetId=new_id("asset"),
        type="draft_arrangement",
        path=relative_to_root(draft_path),
        mimeType="application/json",
        sha256=sha256_file(draft_path),
        sizeBytes=draft_path.stat().st_size,
        producedByStage="aligning",
        producedBySubstep="draft",
        metadata={"arrangementId": saved.arrangementId, "revision": saved.revision, "qualitySummary": saved.qualitySummary},
    )
    repository.create_artifact(job_id, draft_asset)
    set_stage(job_id, "aligning", "draft", StageStatus.completed, "Szkic arrangement", "worker-aligner", ProgressMode.determinate, 100, artifact_ids=[draft_asset.assetId])
    repository.update_job_status(job_id, JobStatus.awaiting_review)


def read_wav_mono(path: Path) -> tuple[np.ndarray, int]:
    import numpy as np

    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        sample_rate = wav.getframerate()
        sample_width = wav.getsampwidth()
        frame_count = wav.getnframes()
        raw = wav.readframes(frame_count)
    if sample_width == 1:
        values = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif sample_width == 2:
        values = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif sample_width == 4:
        values = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise RuntimeError(f"Nieobslugiwany sample width WAV: {sample_width}.")
    if channels > 1:
        values = values.reshape(-1, channels).mean(axis=1)
    return values.astype(np.float32, copy=False), sample_rate


def predict_pitch(audio: np.ndarray, sample_rate: int, device: str, batch_size: int, frame_step_ms: int) -> tuple[list[float], list[float]]:
    import torch
    import torchcrepe

    hop_length = int(sample_rate * frame_step_ms / 1000)
    tensor = torch.from_numpy(audio).unsqueeze(0).to(device)
    with torch.no_grad():
        frequency, periodicity = torchcrepe.predict(
            tensor,
            sample_rate,
            hop_length,
            fmin=midi_to_frequency(MIN_VOCAL_MIDI),
            fmax=midi_to_frequency(MAX_VOCAL_MIDI),
            model="full",
            batch_size=batch_size,
            device=device,
            return_periodicity=True,
        )
    return tensor_to_list(frequency), tensor_to_list(periodicity)


def build_pitch_frames(audio: np.ndarray, sample_rate: int, frequencies: list[float], periodicities: list[float], settings) -> list[PitchFrame]:
    frame_step_sec = settings.frameStepMs / 1000.0
    hop_samples = max(int(sample_rate * frame_step_sec), 1)
    frames: list[PitchFrame] = []
    for index, frequency in enumerate(frequencies):
        periodicity = periodicities[index] if index < len(periodicities) else None
        center = index * hop_samples
        loudness = frame_loudness_db(audio, center, hop_samples)
        voiced = (
            frequency is not None
            and frequency > 0
            and periodicity is not None
            and periodicity >= settings.periodicityThreshold
            and loudness >= settings.silenceThresholdDb
        )
        midi = frequency_to_midi(frequency) if voiced else None
        frames.append(
            PitchFrame(
                timeSec=round(index * frame_step_sec, 6),
                frequencyHz=round(float(frequency), 4) if frequency and frequency > 0 else None,
                midi=round(midi, 4) if midi is not None else None,
                periodicity=round(float(periodicity), 4) if periodicity is not None else None,
                voiced=voiced,
                loudnessDb=round(loudness, 2) if math.isfinite(loudness) else None,
            )
        )
    return frames


def segment_notes(frames: list[PitchFrame], settings) -> list[NoteEvent]:
    frame_step_sec = settings.frameStepMs / 1000.0
    merge_gap_sec = settings.mergeGapMs / 1000.0
    min_length_sec = settings.minNoteLengthMs / 1000.0
    notes: list[NoteEvent] = []
    current: list[PitchFrame] = []
    gap_sec = 0.0
    current_midi: int | None = None

    def flush() -> None:
        nonlocal current, current_midi, gap_sec
        if current:
            note = note_from_frames(len(notes) + 1, current, frame_step_sec, settings.periodicityThreshold)
            if note.endSec - note.startSec >= min_length_sec:
                notes.append(note)
        current = []
        current_midi = None
        gap_sec = 0.0

    for frame in frames:
        if not frame.voiced or frame.midi is None:
            if current:
                gap_sec += frame_step_sec
                if gap_sec > merge_gap_sec:
                    flush()
            continue
        rounded_midi = int(round(frame.midi))
        if current and current_midi is not None and rounded_midi != current_midi:
            flush()
        current.append(frame)
        current_midi = rounded_midi
        gap_sec = 0.0
    flush()
    return notes


def note_from_frames(index: int, frames: list[PitchFrame], frame_step_sec: float, periodicity_threshold: float) -> NoteEvent:
    voiced_midis = [frame.midi for frame in frames if frame.midi is not None]
    voiced_frequencies = [frame.frequencyHz for frame in frames if frame.frequencyHz is not None]
    periodicities = [frame.periodicity for frame in frames if frame.periodicity is not None]
    midi = int(round(sum(voiced_midis) / len(voiced_midis)))
    confidence = round(sum(periodicities) / len(periodicities), 4) if periodicities else None
    quality_flags = []
    if confidence is None or confidence < periodicity_threshold + 0.1:
        quality_flags.append("uncertain_pitch")
    return NoteEvent(
        noteId=f"note_{index:04d}",
        startSec=round(frames[0].timeSec, 6),
        endSec=round(frames[-1].timeSec + frame_step_sec, 6),
        midi=midi,
        frequencyHz=round(sum(voiced_frequencies) / len(voiced_frequencies), 4),
        confidence=confidence,
        source="pitch_ai",
        requiresReview=bool(quality_flags),
        qualityFlags=quality_flags,
    )


def build_arrangement(job_id: str, segments: list[TranscriptSegment], notes: list[NoteEvent]) -> Arrangement:
    assigned_notes: set[str] = set()
    tokens: list[KaraokeToken] = []
    lines: list[ArrangementLine] = []
    notes_by_id = {note.noteId: note.model_copy(deep=True) for note in notes}

    for segment_index, segment in enumerate(segments, start=1):
        line_token_ids: list[str] = []
        for word in segment.words:
            if not word.text:
                continue
            overlapping = sorted(overlapping_notes(word.startSec, word.endSec, notes), key=lambda note: note.startSec)
            syllables = basic_syllables(word.text)
            syllable_spans = syllable_time_spans(word.startSec, word.endSec, len(syllables))
            notes_by_syllable = assign_notes_to_syllables(overlapping, syllable_spans)

            for syllable_index, syllable in enumerate(syllables):
                syllable_start, syllable_end = syllable_spans[syllable_index]
                syllable_notes = notes_by_syllable[syllable_index]
                if not syllable_notes:
                    flags = ["missing_note", "needs_syllable_review"]
                    if word.requiresReview:
                        flags.append("uncertain_text")
                    token = KaraokeToken(
                        tokenId=f"tok_{len(tokens) + 1:04d}",
                        text=syllable,
                        wordId=word.wordId,
                        syllableIndex=syllable_index,
                        noteId=None,
                        startSec=syllable_start,
                        endSec=syllable_end,
                        midi=None,
                        requiresReview=True,
                        qualityFlags=dedupe_flags(flags),
                    )
                    tokens.append(token)
                    line_token_ids.append(token.tokenId)
                    continue

                anchor_token_id = None
                for note_index, note in enumerate(syllable_notes):
                    assigned_notes.add(note.noteId)
                    flags = list(note.qualityFlags)
                    if word.requiresReview:
                        flags.append("uncertain_text")
                    start_sec, end_sec = token_timing(syllable_start, syllable_end, note)
                    is_extension = note_index > 0
                    token = KaraokeToken(
                        tokenId=f"tok_{len(tokens) + 1:04d}",
                        text="" if is_extension else syllable,
                        wordId=word.wordId,
                        syllableIndex=syllable_index,
                        noteId=note.noteId,
                        startSec=start_sec,
                        endSec=end_sec,
                        midi=note.midi,
                        isExtension=is_extension,
                        extendsTokenId=anchor_token_id if is_extension else None,
                        requiresReview=note.requiresReview or word.requiresReview,
                        qualityFlags=dedupe_flags(flags),
                    )
                    if anchor_token_id is None:
                        anchor_token_id = token.tokenId
                    tokens.append(token)
                    line_token_ids.append(token.tokenId)

        line_flags = []
        if segment.requiresReview:
            line_flags.append("uncertain_text")
        if any(token.requiresReview for token in tokens if token.tokenId in line_token_ids):
            line_flags.append("contains_review_items")
        lines.append(
            ArrangementLine(
                lineId=f"line_{segment_index:04d}",
                startSec=segment.startSec,
                endSec=segment.endSec,
                tokenIds=line_token_ids,
                requiresReview=bool(line_flags),
                qualityFlags=line_flags,
            )
        )

    for note_id, note in notes_by_id.items():
        if note_id not in assigned_notes:
            note.requiresReview = True
            note.qualityFlags = sorted(set(note.qualityFlags + ["unassigned_note"]))

    note_events = list(notes_by_id.values())
    quality_summary = summarize_quality(tokens, note_events)
    return Arrangement(
        arrangementId=new_id("arr"),
        jobId=job_id,
        revision=1,
        approved=False,
        lines=lines,
        tokens=tokens,
        noteEvents=note_events,
        source="draft_ai",
        qualitySummary=quality_summary,
    )


def overlapping_notes(start_sec: float, end_sec: float, notes: list[NoteEvent]) -> list[NoteEvent]:
    return [note for note in notes if min(end_sec, note.endSec) - max(start_sec, note.startSec) > 0]


def syllable_time_spans(start_sec: float, end_sec: float, syllable_count: int) -> list[tuple[float, float]]:
    count = max(syllable_count, 1)
    duration = max(end_sec - start_sec, 0.001)
    step = duration / count
    spans = []
    for index in range(count):
        start = start_sec + step * index
        end = end_sec if index == count - 1 else start_sec + step * (index + 1)
        spans.append((round(start, 6), round(max(end, start + 0.001), 6)))
    return spans


def assign_notes_to_syllables(notes: list[NoteEvent], syllable_spans: list[tuple[float, float]]) -> list[list[NoteEvent]]:
    assigned: list[list[NoteEvent]] = [[] for _ in syllable_spans]
    if not syllable_spans:
        return assigned
    for note in notes:
        best_index = max(
            range(len(syllable_spans)),
            key=lambda index: (
                overlap_seconds(note.startSec, note.endSec, syllable_spans[index][0], syllable_spans[index][1]),
                -abs(note_center(note) - span_center(syllable_spans[index])),
            ),
        )
        assigned[best_index].append(note)
    return assigned


def overlap_seconds(left_start: float, left_end: float, right_start: float, right_end: float) -> float:
    return max(min(left_end, right_end) - max(left_start, right_start), 0.0)


def note_center(note: NoteEvent) -> float:
    return span_center((note.startSec, note.endSec))


def span_center(span: tuple[float, float]) -> float:
    return span[0] + (span[1] - span[0]) / 2.0


def token_timing(syllable_start: float, syllable_end: float, note: NoteEvent) -> tuple[float, float]:
    start = max(syllable_start, note.startSec)
    end = min(syllable_end, note.endSec)
    if end <= start:
        start, end = note.startSec, note.endSec
    return round(start, 6), round(end if end > start else start + 0.001, 6)


def dedupe_flags(flags: list[str]) -> list[str]:
    return list(dict.fromkeys(flags))


POLISH_VOWELS = set("aąeęioóuyAĄEĘIOÓUY")


def basic_syllables(text: str) -> list[str]:
    word = text.strip()
    if not word:
        return [text]
    vowel_indexes = [index for index, char in enumerate(word) if char in POLISH_VOWELS]
    if len(vowel_indexes) <= 1:
        return [word]
    cuts = []
    for left, right in zip(vowel_indexes, vowel_indexes[1:]):
        consonants_between = max(right - left - 1, 0)
        if consonants_between <= 1:
            cuts.append(right)
        else:
            cuts.append(left + 1 + consonants_between // 2)
    pieces = []
    start = 0
    for cut in cuts:
        pieces.append(word[start:cut])
        start = cut
    pieces.append(word[start:])
    return [piece for piece in pieces if piece]


def summarize_quality(tokens: list[KaraokeToken], notes: list[NoteEvent]) -> dict[str, int]:
    summary = {
        "tokensRequiringReview": sum(1 for token in tokens if token.requiresReview),
        "notesRequiringReview": sum(1 for note in notes if note.requiresReview),
        "missingNoteTokens": sum(1 for token in tokens if "missing_note" in token.qualityFlags),
        "unassignedNotes": sum(1 for note in notes if "unassigned_note" in note.qualityFlags),
        "uncertainPitchNotes": sum(1 for note in notes if "uncertain_pitch" in note.qualityFlags),
    }
    return summary


def frame_loudness_db(audio: np.ndarray, center: int, hop_samples: int) -> float:
    import numpy as np

    start = max(center - hop_samples // 2, 0)
    end = min(center + hop_samples // 2, len(audio))
    if end <= start:
        return float("-inf")
    rms = float(np.sqrt(np.mean(np.square(audio[start:end]))))
    if rms <= 0:
        return float("-inf")
    return 20.0 * math.log10(rms)


def frequency_to_midi(frequency_hz: float) -> float | None:
    if frequency_hz <= 0:
        return None
    return 69.0 + 12.0 * math.log2(frequency_hz / 440.0)


def midi_to_frequency(midi: int | float) -> float:
    return 440.0 * (2.0 ** ((float(midi) - 69.0) / 12.0))


def tensor_to_list(value) -> list[float]:
    array = value.detach().cpu().numpy()
    return [float(item) for item in array.reshape(-1)]


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


def package_version(package_name: str) -> str | None:
    try:
        return metadata.version(package_name)
    except metadata.PackageNotFoundError:
        return None


def cleanup_memory() -> None:
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        return


if __name__ == "__main__":
    main()
