from __future__ import annotations

import gc
import json
import math
import os
import time
import wave
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path
from typing import Callable

from app.core.config import get_settings
from app.core.errors import sanitize_log
from app.db import repository
from app.domain.contracts import (
    Arrangement,
    ArrangementSentence,
    ArrangementSyllable,
    ArrangementWord,
    AudioAsset,
    JobStatus,
    NoteEvent,
    PitchFrame,
    PitchSettings,
    ProgressMode,
    StageStatus,
    SyllabificationInfo,
    SyllabificationSettings,
    TranscriptWord,
    TranscriptSegment,
)
from app.services.ids import new_id
from app.services.queue import redis_client
from app.services.storage import read_json, relative_to_root, resolve_inside, sha256_file, write_json
from app.workers.stages import cleanup_deleted_job_files, complete_stage_from_existing_artifacts, fail_stage, is_stage_confirmed, require_stage_settings, set_stage
from app.workers.transcribe import estimate_auto_sentence_gap


PITCH_SAMPLE_RATE = 16000
MIN_VOCAL_MIDI = 36
MAX_VOCAL_MIDI = 84
MIN_ALIGNMENT_PART_SEC = 0.001
PITCH_MODEL_BY_PROFILE = {
    "fast": "tiny",
    "default": "full",
    "accurate": "full",
}
SYLLABIFICATION_PACKAGE_NAMES = ("kokosznicka", "pyphen")
KOKOSZNICKA_FUNCTION_NAMES = ("syllabify", "syllabize", "split", "hyphenate", "sylabizuj", "podziel")
KOKOSZNICKA_CLASS_NAMES = ("Syllabifier", "Sylabizator", "Kokosznicka")
KOKOSZNICKA_OUTPUT_MARKERS = (
    ("ʒ́", ("dz",)),
    ("k̂", ("k",)),
    ("ǯ", ("dż", "dz")),
    ("č", ("cz",)),
    ("š", ("sz",)),
    ("ž", ("rz", "ż")),
    ("ĥ", ("ch",)),
    ("ň", ("n",)),
    ("ĉ", ("c",)),
    ("ŝ", ("s",)),
    ("ẑ", ("z",)),
    ("ĝ", ("g",)),
    ("ĵ", ("i",)),
    ("ĺ", ("u", "l")),
    ("ɨ", ("i", "y")),
)
KOKOSZNICKA_TERMINAL_ONSET_MARKERS = {
    "ʒ́": ("dz",),
    "k̂": ("k",),
    "ň": ("n",),
    "ĉ": ("c",),
    "ŝ": ("s",),
    "ẑ": ("z",),
    "ĝ": ("g",),
}


@dataclass(frozen=True)
class SyllableSlot:
    slot_index: int
    segment_index: int
    word_id: str
    word_text: str
    word_requires_review: bool
    syllable_index: int
    text: str
    start_sec: float
    end_sec: float


@dataclass
class SyllabificationPlan:
    requested_method: str
    applied_method: str
    language: str | None
    language_source: str
    package_versions: dict[str, str | None]
    splitter: Callable[[str], list[str]]
    fallback_reason: str | None = None

    def split(self, text: str) -> list[str]:
        if self.applied_method in {"heuristic", "none"}:
            return self.splitter(text)
        try:
            syllables = self.splitter(text)
        except Exception as exc:
            syllables = []
            error = sanitize_log(str(exc))
        else:
            error = None
        if valid_syllables(text, syllables):
            return syllables
        reason = f"{self.applied_method} zwrocil niepoprawny podzial dla slowa."
        if error:
            reason = f"{self.applied_method} zwrocil blad: {error}"
        self.use_heuristic(reason)
        return self.splitter(text)

    def use_heuristic(self, reason: str) -> None:
        self.applied_method = "heuristic"
        self.splitter = heuristic_syllables
        self.fallback_reason = self.fallback_reason or reason

    def to_info(self) -> SyllabificationInfo:
        return SyllabificationInfo(
            requestedMethod=self.requested_method,
            appliedMethod=self.applied_method,
            language=self.language,
            languageSource=self.language_source,
            fallbackReason=self.fallback_reason,
            packageVersions=self.package_versions,
        )


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
    try:
        _process_job(job_id, start_stage)
    finally:
        cleanup_deleted_job_files(job_id)


def _process_job(job_id: str, start_stage: str) -> None:
    if start_stage == "aligning":
        try:
            run_draft_alignment(job_id)
        except Exception as exc:  # pragma: no cover - worker guard
            fail_stage(job_id, "aligning", "draft", "Wstepne dopasowanie nie powiodlo sie.", sanitize_log(str(exc)), "worker-aligner")
        return
    try:
        run_pitch_detection(job_id)
    except Exception as exc:  # pragma: no cover - worker guard
        fail_stage(job_id, "detecting_pitch", "pitch_detection", "Detekcja tonow nie powiodla sie.", sanitize_log(str(exc)), "worker-pitch")
        return
    job = repository.get_job(job_id)
    if job and is_stage_confirmed(job, "aligning"):
        try:
            run_draft_alignment(job_id)
        except Exception as exc:  # pragma: no cover - worker guard
            fail_stage(job_id, "aligning", "draft", "Wstepne dopasowanie nie powiodlo sie.", sanitize_log(str(exc)), "worker-aligner")
    else:
        require_stage_settings(
            job_id,
            "aligning",
            "draft",
            "Wybierz ustawienia wstępnego dopasowania",
            "worker-aligner",
            "alignment",
            {
                "sentenceGapMs": job.transcriptionSettings.sentenceGapMs if job else None,
                "minNoteLengthMs": job.pitchSettings.minNoteLengthMs if job else 75,
                "mergeGapMs": job.pitchSettings.mergeGapMs if job else 130,
                "checkNoteLongerThan": job.pitchSettings.checkNoteLongerThan if job else 400,
                "silenceTresholdForNoteChecking": job.pitchSettings.silenceTresholdForNoteChecking if job else -60.0,
            },
        )


def run_pitch_detection(job_id: str) -> None:
    job = repository.get_job(job_id)
    if not job:
        raise RuntimeError("job not found")
    if any(asset.type == "pitch_frames" for asset in job.artifacts):
        complete_stage_from_existing_artifacts(job_id, "detecting_pitch", "pitch_detection", "Detekcja tonów", "worker-pitch")
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
        raise RuntimeError("GPU nie jest dostepne, a tryb CPU dla detekcji tonow jest wylaczony.")

    started = time.monotonic()
    audio, sample_rate = read_wav_mono(input_path)
    if sample_rate != PITCH_SAMPLE_RATE:
        raise RuntimeError(f"worker_inputs/torchcrepe.wav ma sample rate {sample_rate}, oczekiwano {PITCH_SAMPLE_RATE}.")

    pitch_model = pitch_model_for_profile(job.profiles.pitch)
    set_stage(job_id, "detecting_pitch", "pitch_detection", StageStatus.running, f"Analiza F0 ({pitch_model})", "worker-pitch", ProgressMode.estimated, 35)
    frequencies, periodicities = predict_pitch(
        audio,
        sample_rate,
        diagnostics["device"],
        settings.pitch_batch_size,
        job.pitchSettings.frameStepMs,
        pitch_model,
        job_id,
    )
    frames = build_pitch_frames(audio, sample_rate, frequencies, periodicities, job.pitchSettings)

    diagnostics |= {
        "torchcrepeVersion": package_version("torchcrepe"),
        "torchVersion": package_version("torch"),
        "cudaVariant": os.getenv("TORCH_CUDA_VARIANT", "unknown"),
        "environmentSource": os.getenv("TORCH_ENV_SOURCE", "unknown"),
        "sampleRate": sample_rate,
        "pitchProfile": job.profiles.pitch,
        "torchcrepeModel": pitch_model,
        "pitchBatchSize": settings.pitch_batch_size,
        "frameStepMs": job.pitchSettings.frameStepMs,
        "silenceThresholdDb": job.pitchSettings.silenceThresholdDb,
        "periodicityThreshold": job.pitchSettings.periodicityThreshold,
        "inputSha256": sha256_file(input_path),
        "frameCount": len(frames),
        "processingSec": round(time.monotonic() - started, 3),
    }

    artifacts_dir = resolve_inside(f"jobs/{job_id}/artifacts")
    frames_path = artifacts_dir / "pitch.frames.json"
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
            metadata={"model": "torchcrepe", "torchcrepeModel": pitch_model, "frameCount": len(frames)},
        )
    ]
    for asset in assets:
        repository.create_artifact(job_id, asset)
    set_stage(job_id, "detecting_pitch", "pitch_detection", StageStatus.completed, "Detekcja tonów", "worker-pitch", ProgressMode.determinate, 100, artifact_ids=[asset.assetId for asset in assets])
    cleanup_memory()


def run_draft_alignment(job_id: str) -> None:
    job = repository.get_job(job_id)
    if not job:
        raise RuntimeError("job not found")
    if repository.get_arrangement(job_id) and any(asset.type == "draft_arrangement" for asset in job.artifacts):
        complete_stage_from_existing_artifacts(job_id, "aligning", "draft", "Wstępne dopasowanie", "worker-aligner")
        repository.update_job_status(job_id, JobStatus.awaiting_review)
        return

    transcript_asset = next((asset for asset in job.artifacts if asset.type == "transcript_aligned"), None)
    frames_asset = next((asset for asset in job.artifacts if asset.type == "pitch_frames"), None)
    if not transcript_asset:
        raise RuntimeError("Brak transcript.aligned.json z etapu transkrypcji.")
    if not frames_asset:
        raise RuntimeError("Brak pitch.frames.json z etapu detekcji tonow.")

    repository.update_job_status(job_id, JobStatus.aligning)
    set_stage(job_id, "aligning", "draft", StageStatus.running, "Budowanie sentencji i nut karaoke", "worker-aligner", ProgressMode.estimated, 20)

    transcript_payload = read_json(resolve_inside(transcript_asset.path))
    frames_payload = read_json(resolve_inside(frames_asset.path))
    aligned_segments = [TranscriptSegment.model_validate(segment) for segment in transcript_payload.get("segments", [])]
    frames = [PitchFrame.model_validate(frame) for frame in frames_payload.get("frames", [])]
    detected_sentence_gap_ms = estimate_auto_sentence_gap(aligned_segments, job.tempo.detectedSongBpm if job.tempo else None)
    effective_sentence_gap_ms = job.transcriptionSettings.sentenceGapMs if job.transcriptionSettings.sentenceGapMs is not None else detected_sentence_gap_ms
    notes = segment_notes(frames, job.pitchSettings)
    syllabification_language, syllabification_language_source = resolve_syllabification_language(job, transcript_payload)
    arrangement = build_arrangement(
        job_id,
        aligned_segments,
        notes,
        syllabification_settings=job.syllabificationSettings,
        language=syllabification_language,
        language_source=syllabification_language_source,
        prefer_char_timings=job.transcriptionSettings.positioning == "words_and_syllables",
        requested_sentence_gap_ms=job.transcriptionSettings.sentenceGapMs,
        detected_sentence_gap_ms=detected_sentence_gap_ms,
        effective_sentence_gap_ms=effective_sentence_gap_ms,
        sentence_padding_ms=job.transcriptionSettings.sentencePaddingMs,
        pitch_frames=frames,
        pitch_settings=job.pitchSettings,
    )

    artifacts_dir = resolve_inside(f"jobs/{job_id}/artifacts")
    notes_path = artifacts_dir / "pitch.notes.json"
    draft_path = artifacts_dir / "draft.arrangement.json"
    note_diagnostics = {
        "sourcePitchFramesAssetId": frames_asset.assetId,
        "frameStepMs": job.pitchSettings.frameStepMs,
        "minNoteLengthMs": job.pitchSettings.minNoteLengthMs,
        "mergeGapMs": job.pitchSettings.mergeGapMs,
        "checkNoteLongerThan": job.pitchSettings.checkNoteLongerThan,
        "silenceTresholdForNoteChecking": job.pitchSettings.silenceTresholdForNoteChecking,
        "periodicityThreshold": job.pitchSettings.periodicityThreshold,
        "noteCount": len(notes),
        "frameCount": len(frames),
    }
    write_json(
        notes_path,
        {
            "schemaVersion": "1.0.0",
            "jobId": job_id,
            "stage": "aligning",
            "substep": "draft",
            "diagnostics": note_diagnostics,
            "noteEvents": [note.model_dump() for note in notes],
        },
    )
    write_json(
        draft_path,
        {
            "schemaVersion": "1.0.0",
            "jobId": job_id,
            "stage": "aligning",
            "substep": "draft",
            "sourceArtifacts": {
                "transcriptAlignedAssetId": transcript_asset.assetId,
                "pitchFramesAssetId": frames_asset.assetId,
            },
            "requestedSentenceGapMs": job.transcriptionSettings.sentenceGapMs,
            "detectedSentenceGapMs": detected_sentence_gap_ms,
            "effectiveSentenceGapMs": effective_sentence_gap_ms,
            "diagnostics": {
                "checkNoteLongerThan": job.pitchSettings.checkNoteLongerThan,
                "silenceTresholdForNoteChecking": job.pitchSettings.silenceTresholdForNoteChecking,
                "correctedLongSyllableCount": arrangement.qualitySummary.get("correctedLongSyllableCount", 0),
            },
            "syllabification": arrangement.syllabification.model_dump(mode="json") if arrangement.syllabification else None,
            "arrangement": arrangement.model_dump(mode="json"),
        },
    )

    saved = repository.save_arrangement(job_id, arrangement)
    notes_asset = AudioAsset(
        assetId=new_id("asset"),
        type="pitch_notes",
        path=relative_to_root(notes_path),
        mimeType="application/json",
        sha256=sha256_file(notes_path),
        sizeBytes=notes_path.stat().st_size,
        producedByStage="aligning",
        producedBySubstep="draft",
        metadata={"source": "pitch_frames", "noteCount": len(notes)},
    )
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
    repository.create_artifact(job_id, notes_asset)
    repository.create_artifact(job_id, draft_asset)
    set_stage(job_id, "aligning", "draft", StageStatus.completed, "Wstępne dopasowanie", "worker-aligner", ProgressMode.determinate, 100, artifact_ids=[notes_asset.assetId, draft_asset.assetId])
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


def pitch_model_for_profile(profile: str | None) -> str:
    return PITCH_MODEL_BY_PROFILE.get(profile or "default", "full")


def predict_pitch(
    audio: np.ndarray,
    sample_rate: int,
    device: str,
    batch_size: int,
    frame_step_ms: int,
    model: str,
    job_id: str,
) -> tuple[list[float], list[float]]:
    import torch
    import torchcrepe

    hop_length = int(sample_rate * frame_step_ms / 1000)
    tensor = torch.from_numpy(audio).unsqueeze(0).to(device)
    total_frames = max(1, 1 + int(tensor.size(1) // hop_length))
    processed_frames = 0
    started = time.monotonic()
    pitch_results = []
    periodicity_results = []

    with torch.no_grad():
        generator = torchcrepe.preprocess(
            tensor,
            sample_rate,
            hop_length,
            batch_size=batch_size,
            device=device,
            pad=True,
        )
        for frames in generator:
            probabilities = torchcrepe.infer(frames, model, device, embed=False)
            probabilities = probabilities.reshape(tensor.size(0), -1, torchcrepe.PITCH_BINS).transpose(1, 2)
            frequency, periodicity = torchcrepe.postprocess(
                probabilities,
                midi_to_frequency(MIN_VOCAL_MIDI),
                midi_to_frequency(MAX_VOCAL_MIDI),
                torchcrepe.decode.viterbi,
                False,
                True,
            )
            frequency = frequency.to(tensor.device)
            periodicity = periodicity.to(tensor.device)
            pitch_results.append(frequency)
            periodicity_results.append(periodicity)
            processed_frames = min(total_frames, processed_frames + int(frequency.numel()))
            set_pitch_progress(job_id, processed_frames, total_frames, started)

    return tensor_to_list(torch.cat(pitch_results, 1)), tensor_to_list(torch.cat(periodicity_results, 1))


def set_pitch_progress(job_id: str, processed_frames: int, total_frames: int, started: float) -> None:
    fraction = min(max(processed_frames / max(total_frames, 1), 0.0), 1.0)
    elapsed = max(time.monotonic() - started, 0.001)
    eta_sec = int((elapsed / fraction) - elapsed) if fraction > 0 else None
    progress_percent = min(95, 35 + int(fraction * 60))
    set_stage(
        job_id,
        "detecting_pitch",
        "pitch_detection",
        StageStatus.running,
        f"Analiza F0: {processed_frames}/{total_frames} ramek",
        "worker-pitch",
        ProgressMode.estimated,
        progress_percent,
        eta_sec=eta_sec,
    )


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


def build_arrangement(
    job_id: str,
    segments: list[TranscriptSegment],
    notes: list[NoteEvent],
    *,
    syllabification_settings: SyllabificationSettings | None = None,
    language: str | None = None,
    language_source: str = "unknown",
    prefer_char_timings: bool = False,
    requested_sentence_gap_ms: int | None = None,
    detected_sentence_gap_ms: int | None = None,
    effective_sentence_gap_ms: int | None = None,
    sentence_padding_ms: int = 0,
    pitch_frames: list[PitchFrame] | None = None,
    pitch_settings: PitchSettings | None = None,
) -> Arrangement:
    syllabification_plan = build_syllabification_plan(syllabification_settings, language, language_source)
    note_events = [note.model_copy(deep=True) for note in notes]
    aligned_lines: list[tuple[TranscriptSegment, list[ArrangementWord]]] = []
    slots: list[SyllableSlot] = []
    corrected_long_syllable_count = 0
    ordered_pitch_frames = sorted(pitch_frames, key=lambda frame: frame.timeSec) if pitch_frames is not None else None

    for segment_index, segment in enumerate(segments, start=1):
        words: list[ArrangementWord] = []
        for word in segment.words:
            if not word.text:
                continue
            syllables = syllabification_plan.split(word.text)
            syllable_spans, timing_requires_review = syllable_time_spans_for_word(word, syllables, prefer_char_timings)
            word_syllables: list[ArrangementSyllable] = []
            for syllable_index, syllable in enumerate(syllables):
                syllable_start, syllable_end = syllable_spans[syllable_index]
                slot = SyllableSlot(
                    slot_index=len(slots),
                    segment_index=segment_index,
                    word_id=word.wordId,
                    word_text=word.text,
                    word_requires_review=word.requiresReview,
                    syllable_index=syllable_index,
                    text=syllable,
                    start_sec=syllable_start,
                    end_sec=syllable_end,
                )
                slots.append(slot)
                midi, flags = syllable_midi_and_flags(note_events, syllable_start, syllable_end)
                if slot.word_requires_review:
                    flags.append("uncertain_text")
                if timing_requires_review:
                    flags.append("needs_syllable_review")
                word_syllables.append(
                    ArrangementSyllable(
                        syllableId=f"syl_{len(slots):04d}",
                        text=slot.text,
                        syllableIndex=slot.syllable_index,
                        startSec=slot.start_sec,
                        endSec=slot.end_sec,
                        midi=midi,
                        requiresReview=bool(flags),
                        qualityFlags=dedupe_flags(flags),
                    )
                )
            merged_syllables = merge_adjacent_same_midi_syllables(word_syllables)
            if pitch_settings is not None and ordered_pitch_frames is not None:
                corrected_long_syllable_count += correct_long_syllable_ends(merged_syllables, ordered_pitch_frames, pitch_settings)
            words.append(
                ArrangementWord(
                    wordId=word.wordId,
                    startSec=word.startSec,
                    endSec=word.endSec,
                    text=word.text,
                    confidence=word.confidence,
                    requiresReview=word.requiresReview or any(syllable.requiresReview for syllable in merged_syllables),
                    qualityFlags=dedupe_flags(["uncertain_text"] if word.requiresReview else []),
                    syllables=merged_syllables,
                )
            )

        aligned_lines.append((segment, words))

    sentences = build_sentences_from_aligned_lines(
        aligned_lines,
        requested_sentence_gap_ms=requested_sentence_gap_ms,
        detected_sentence_gap_ms=detected_sentence_gap_ms,
        effective_sentence_gap_ms=effective_sentence_gap_ms,
        sentence_padding_ms=sentence_padding_ms,
    )

    for note in note_events:
        note.qualityFlags = [flag for flag in note.qualityFlags if flag != "unassigned_note"]
        note.requiresReview = note.requiresReview or bool(note.qualityFlags)

    quality_summary = summarize_quality(sentences, note_events)
    quality_summary["correctedLongSyllableCount"] = corrected_long_syllable_count
    return Arrangement(
        arrangementId=new_id("arr"),
        jobId=job_id,
        revision=1,
        approved=False,
        sentences=sentences,
        noteEvents=note_events,
        source="draft_ai",
        qualitySummary=quality_summary,
        syllabification=syllabification_plan.to_info(),
    )


def build_sentences_from_aligned_lines(
    aligned_lines: list[tuple[TranscriptSegment, list[ArrangementWord]]],
    *,
    requested_sentence_gap_ms: int | None,
    detected_sentence_gap_ms: int | None,
    effective_sentence_gap_ms: int | None,
    sentence_padding_ms: int,
) -> list[ArrangementSentence]:
    """Split aligned words only after syllable timing and long-syllable correction."""
    sentence_groups: list[tuple[TranscriptSegment, list[ArrangementWord], float, float]] = []
    pause_sec = effective_sentence_gap_ms / 1000.0 if effective_sentence_gap_ms is not None else None

    for source_line, words in aligned_lines:
        if not words:
            sentence_groups.append((source_line, [], source_line.startSec, source_line.endSec))
            continue

        current: list[ArrangementWord] = []
        for word in words:
            previous = current[-1] if current else None
            if previous is not None and pause_sec is not None:
                gap_sec = arrangement_word_start(word) - arrangement_word_end(previous)
                if gap_sec > pause_sec:
                    sentence_groups.append(
                        (source_line, current, arrangement_word_start(current[0]), arrangement_word_end(current[-1]))
                    )
                    current = []
            current.append(word)
        if current:
            sentence_groups.append(
                (source_line, current, arrangement_word_start(current[0]), arrangement_word_end(current[-1]))
            )

    padding_sec = max(sentence_padding_ms, 0) / 1000.0
    raw_bounds = [(raw_start, raw_end) for _, _, raw_start, raw_end in sentence_groups]
    sentences: list[ArrangementSentence] = []
    for sentence_index, (source_line, words, raw_start, raw_end) in enumerate(sentence_groups, start=1):
        start = max(0.0, raw_start - padding_sec)
        end = raw_end + padding_sec
        if sentence_index > 1:
            previous_end = raw_bounds[sentence_index - 2][1]
            start = max(start, midpoint(previous_end, raw_start))
        if sentence_index < len(sentence_groups):
            next_start = raw_bounds[sentence_index][0]
            end = min(end, midpoint(raw_end, next_start))
        if end <= start:
            start = raw_start
            end = raw_end if raw_end > raw_start else raw_start + MIN_ALIGNMENT_PART_SEC

        sentence_flags: list[str] = []
        if source_line.requiresReview:
            sentence_flags.append("uncertain_text")
        if any(word.requiresReview for word in words):
            sentence_flags.append("contains_review_items")
        sentences.append(
            ArrangementSentence(
                sentenceId=f"sent_{sentence_index:04d}",
                startSec=round(start, 6),
                endSec=round(end, 6),
                text=" ".join(word.text.strip() for word in words if word.text.strip()).strip() or source_line.text,
                effectiveSentenceGapMs=effective_sentence_gap_ms,
                requestedSentenceGapMs=requested_sentence_gap_ms,
                detectedSentenceGapMs=detected_sentence_gap_ms,
                requiresReview=bool(sentence_flags),
                qualityFlags=sentence_flags,
                words=words,
            )
        )
    return sentences


def arrangement_word_start(word: ArrangementWord) -> float:
    return min((syllable.startSec for syllable in word.syllables), default=word.startSec)


def arrangement_word_end(word: ArrangementWord) -> float:
    return max((syllable.endSec for syllable in word.syllables), default=word.endSec)


def midpoint(left: float, right: float) -> float:
    return left + (right - left) / 2.0


def syllable_midi_and_flags(notes: list[NoteEvent], start_sec: float, end_sec: float) -> tuple[int | None, list[str]]:
    weighted_sum = 0.0
    total_weight = 0.0
    flags: list[str] = []
    for note in notes:
        overlap = overlap_seconds(note.startSec, note.endSec, start_sec, end_sec)
        if overlap <= 0:
            continue
        weighted_sum += note.midi * overlap
        total_weight += overlap
        flags.extend(note.qualityFlags)
        if note.requiresReview:
            flags.append("uncertain_pitch")
    if total_weight <= 0:
        return None, ["missing_note"]
    return int(round(weighted_sum / total_weight)), dedupe_flags(flags)


def merge_adjacent_same_midi_syllables(syllables: list[ArrangementSyllable]) -> list[ArrangementSyllable]:
    merged: list[ArrangementSyllable] = []
    for syllable in syllables:
        previous = merged[-1] if merged else None
        if previous and previous.midi is not None and previous.midi == syllable.midi:
            previous.text = f"{previous.text}{syllable.text}"
            previous.endSec = syllable.endSec
            previous.requiresReview = previous.requiresReview or syllable.requiresReview
            previous.qualityFlags = dedupe_flags([*previous.qualityFlags, *syllable.qualityFlags])
            continue
        merged.append(syllable)
    for index, syllable in enumerate(merged):
        syllable.syllableIndex = index
    return merged


def correct_long_syllable_ends(
    syllables: list[ArrangementSyllable],
    frames: list[PitchFrame],
    settings: PitchSettings,
) -> int:
    frame_step_sec = max(settings.frameStepMs / 1000.0, MIN_ALIGNMENT_PART_SEC)
    min_silence_sec = max(settings.mergeGapMs / 1000.0, frame_step_sec)
    corrected_count = 0

    for syllable in syllables:
        duration_ms = (syllable.endSec - syllable.startSec) * 1000.0
        if duration_ms <= settings.checkNoteLongerThan:
            continue

        overlapping_frames = [
            frame
            for frame in frames
            if frame.timeSec < syllable.endSec and frame.timeSec + frame_step_sec > syllable.startSec
        ]
        if not overlapping_frames:
            mark_syllable_for_review(syllable)
            continue

        audible_seen = False
        silence_start: float | None = None
        corrected_end: float | None = None
        for frame in overlapping_frames:
            if frame_is_audible(frame, settings.silenceTresholdForNoteChecking):
                audible_seen = True
                silence_start = None
                continue
            if not audible_seen:
                continue
            if silence_start is None:
                silence_start = max(frame.timeSec, syllable.startSec)
            silence_end = min(frame.timeSec + frame_step_sec, syllable.endSec)
            if silence_end - silence_start >= min_silence_sec:
                corrected_end = silence_start
                break

        if not audible_seen:
            mark_syllable_for_review(syllable)
            continue
        if corrected_end is None or corrected_end <= syllable.startSec or corrected_end >= syllable.endSec:
            continue
        syllable.endSec = round(corrected_end, 6)
        corrected_count += 1

    return corrected_count


def frame_is_audible(frame: PitchFrame, silence_threshold_db: float) -> bool:
    return frame.loudnessDb is not None and frame.loudnessDb >= silence_threshold_db


def mark_syllable_for_review(syllable: ArrangementSyllable) -> None:
    syllable.requiresReview = True
    syllable.qualityFlags = dedupe_flags([*syllable.qualityFlags, "needs_syllable_review"])


def note_ids_overlapping_slots(notes: list[NoteEvent], slots: list[SyllableSlot]) -> set[str]:
    return {
        note.noteId
        for note in notes
        for slot in slots
        if overlap_seconds(note.startSec, note.endSec, slot.start_sec, slot.end_sec) > 0
    }


def split_notes_for_syllable_slots(notes: list[NoteEvent], slots: list[SyllableSlot]) -> tuple[list[NoteEvent], dict[int, list[NoteEvent]]]:
    note_events: list[NoteEvent] = []
    notes_by_slot: dict[int, list[NoteEvent]] = {slot.slot_index: [] for slot in slots}
    used_note_ids: set[str] = set()
    sorted_slots = sorted(slots, key=lambda slot: (slot.start_sec, slot.end_sec, slot.slot_index))

    for note in sorted(notes, key=lambda item: (item.startSec, item.endSec, item.noteId)):
        overlaps = [
            (slot, *note_part_times(note, slot.start_sec, slot.end_sec))
            for slot in sorted_slots
            if overlap_seconds(note.startSec, note.endSec, slot.start_sec, slot.end_sec) > 0
        ]
        if not overlaps:
            copied = copy_note_with_id(note, reserve_note_id(note.noteId, used_note_ids))
            note_events.append(copied)
            continue

        for part_index, (slot, part_start, part_end) in enumerate(overlaps):
            note_id = reserve_note_id(note.noteId, used_note_ids) if part_index == 0 else reserve_note_id(f"{note.noteId}_part_{part_index + 1:02d}", used_note_ids)
            copied = copy_note_with_id(note, note_id, part_start, part_end)
            note_events.append(copied)
            notes_by_slot[slot.slot_index].append(copied)

    for slot_notes in notes_by_slot.values():
        slot_notes.sort(key=lambda note: (note.startSec, note.endSec, note.noteId))
    return note_events, notes_by_slot


def merge_same_midi_notes_by_slot(note_events: list[NoteEvent], notes_by_slot: dict[int, list[NoteEvent]]) -> tuple[list[NoteEvent], dict[int, list[NoteEvent]]]:
    removed_note_ids: set[str] = set()
    normalized_by_slot: dict[int, list[NoteEvent]] = {}

    for slot_index, slot_notes in notes_by_slot.items():
        sorted_notes = sorted(slot_notes, key=lambda note: (note.startSec, note.endSec, note.noteId))
        merged_notes: list[NoteEvent] = []
        current_group: list[NoteEvent] = []

        for note in sorted_notes:
            if current_group and note.midi != current_group[-1].midi:
                merged_notes.append(merge_note_group(current_group, removed_note_ids))
                current_group = []
            current_group.append(note)

        if current_group:
            merged_notes.append(merge_note_group(current_group, removed_note_ids))
        normalized_by_slot[slot_index] = merged_notes

    return [note for note in note_events if note.noteId not in removed_note_ids], normalized_by_slot


def merge_note_group(notes: list[NoteEvent], removed_note_ids: set[str]) -> NoteEvent:
    if len(notes) == 1:
        return notes[0]

    base = notes[0]
    frequency_hz = weighted_note_average(notes, "frequencyHz")
    confidence = weighted_note_average(notes, "confidence")
    requires_review = any(note.requiresReview for note in notes)
    quality_flags = dedupe_flags([flag for note in notes for flag in note.qualityFlags])
    base.startSec = round(notes[0].startSec, 6)
    base.endSec = round(max(notes[-1].endSec, base.startSec + MIN_ALIGNMENT_PART_SEC), 6)
    base.frequencyHz = round(frequency_hz or base.frequencyHz, 4)
    base.confidence = confidence
    if base.confidence is not None:
        base.confidence = round(base.confidence, 4)
    base.requiresReview = requires_review
    base.qualityFlags = quality_flags
    removed_note_ids.update(note.noteId for note in notes[1:])
    return base


def weighted_note_average(notes: list[NoteEvent], field_name: str) -> float | None:
    weighted_sum = 0.0
    total_weight = 0.0
    for note in notes:
        value = getattr(note, field_name)
        if value is None:
            continue
        weight = max(note.endSec - note.startSec, MIN_ALIGNMENT_PART_SEC)
        weighted_sum += float(value) * weight
        total_weight += weight
    if total_weight <= 0:
        return None
    return weighted_sum / total_weight


def reserve_note_id(preferred: str, used_note_ids: set[str]) -> str:
    if preferred not in used_note_ids:
        used_note_ids.add(preferred)
        return preferred
    suffix = 2
    while f"{preferred}_{suffix}" in used_note_ids:
        suffix += 1
    note_id = f"{preferred}_{suffix}"
    used_note_ids.add(note_id)
    return note_id


def copy_note_with_id(note: NoteEvent, note_id: str, start_sec: float | None = None, end_sec: float | None = None) -> NoteEvent:
    updates = {"noteId": note_id}
    if start_sec is not None and end_sec is not None:
        updates["startSec"] = round(start_sec, 6)
        updates["endSec"] = round(max(end_sec, start_sec + MIN_ALIGNMENT_PART_SEC), 6)
    return note.model_copy(deep=True, update=updates)


def note_part_times(note: NoteEvent, start_sec: float, end_sec: float) -> tuple[float, float]:
    start = max(note.startSec, start_sec)
    end = min(note.endSec, end_sec)
    if end - start >= MIN_ALIGNMENT_PART_SEC:
        return round(start, 6), round(end, 6)

    center = start + max(end - start, 0.0) / 2.0
    start = max(note.startSec, center - MIN_ALIGNMENT_PART_SEC / 2.0)
    end = min(note.endSec, start + MIN_ALIGNMENT_PART_SEC)
    start = max(note.startSec, end - MIN_ALIGNMENT_PART_SEC)
    return round(start, 6), round(max(end, start + MIN_ALIGNMENT_PART_SEC), 6)


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


def syllable_time_spans_for_word(word: TranscriptWord, syllables: list[str], prefer_char_timings: bool) -> tuple[list[tuple[float, float]], bool]:
    if prefer_char_timings and len(syllables) > 1:
        char_spans = syllable_char_time_spans(word, syllables)
        if char_spans:
            return char_spans, False
        return syllable_time_spans(word.startSec, word.endSec, len(syllables)), True
    return syllable_time_spans(word.startSec, word.endSec, len(syllables)), False


def syllable_char_time_spans(word: TranscriptWord, syllables: list[str]) -> list[tuple[float, float]] | None:
    word_text = word.text.strip()
    chars = word.chars or []
    if not word_text or not syllables or "".join(syllables) != word_text or len(chars) != len(word_text):
        return None

    spans: list[tuple[float, float]] = []
    char_index = 0
    for syllable in syllables:
        syllable_chars = chars[char_index : char_index + len(syllable)]
        if len(syllable_chars) != len(syllable) or "".join(item.char for item in syllable_chars) != syllable:
            return None
        start = max(word.startSec, syllable_chars[0].startSec)
        end = min(word.endSec, syllable_chars[-1].endSec)
        if end <= start:
            return None
        spans.append((round(start, 6), round(end, 6)))
        char_index += len(syllable)
    return spans


def overlap_seconds(left_start: float, left_end: float, right_start: float, right_end: float) -> float:
    return max(min(left_end, right_end) - max(left_start, right_start), 0.0)


def token_timing(syllable_start: float, syllable_end: float, note: NoteEvent) -> tuple[float, float]:
    start = max(syllable_start, note.startSec)
    end = min(syllable_end, note.endSec)
    if end <= start:
        start, end = note.startSec, note.endSec
    return round(start, 6), round(end if end > start else start + 0.001, 6)


def dedupe_flags(flags: list[str]) -> list[str]:
    return list(dict.fromkeys(flags))


def resolve_syllabification_language(job, transcript_payload: dict) -> tuple[str | None, str]:
    forced = normalize_language(job.metadata.language if job.metadata.languageMode == "forced" else None)
    if forced:
        return forced, "forced"
    diagnostics = transcript_payload.get("diagnostics") or {}
    detected = normalize_language(diagnostics.get("detectedLanguage"))
    if detected:
        return detected, "detected"
    alignment = normalize_language(diagnostics.get("alignmentLanguage"))
    if alignment:
        return alignment, "alignment"
    return None, "unknown"


def build_syllabification_plan(
    settings: SyllabificationSettings | None,
    language: str | None,
    language_source: str,
) -> SyllabificationPlan:
    resolved_settings = settings or SyllabificationSettings()
    requested_method = resolved_settings.method
    normalized_language = normalize_language(language)
    package_versions = syllabification_package_versions()
    plan = SyllabificationPlan(
        requested_method=requested_method,
        applied_method=requested_method,
        language=normalized_language,
        language_source=language_source if language_source in {"forced", "detected", "alignment"} else "unknown",
        package_versions=package_versions,
        splitter=heuristic_syllables,
    )

    if requested_method == "none":
        plan.splitter = word_as_syllable
        return plan
    if requested_method == "heuristic":
        return plan
    if requested_method == "kokosznicka":
        if language_base(normalized_language) != "pl":
            plan.use_heuristic("Kokosznicka obsluguje tylko jezyk pl.")
            return plan
        splitter, fallback_reason = build_kokosznicka_splitter()
        if fallback_reason:
            plan.use_heuristic(fallback_reason)
            return plan
        plan.splitter = splitter
        return plan
    if requested_method == "pyphen":
        splitter, fallback_reason = build_pyphen_splitter(normalized_language)
        if fallback_reason:
            plan.use_heuristic(fallback_reason)
            return plan
        plan.splitter = splitter
        return plan

    plan.use_heuristic("Nieznana metoda sylabizacji.")
    return plan


def build_pyphen_splitter(language: str | None) -> tuple[Callable[[str], list[str]], str | None]:
    try:
        import pyphen
    except Exception as exc:
        return heuristic_syllables, f"Pyphen jest niedostepny: {sanitize_log(str(exc))}"

    dictionary_language = resolve_pyphen_language(pyphen, language)
    if not dictionary_language:
        return heuristic_syllables, f"Pyphen nie ma slownika dla jezyka {language or 'unknown'}."

    try:
        dictionary = pyphen.Pyphen(lang=dictionary_language)
    except Exception as exc:
        return heuristic_syllables, f"Pyphen nie zaladowal slownika {dictionary_language}: {sanitize_log(str(exc))}"

    def split(text: str) -> list[str]:
        word = text.strip()
        if not word:
            return [text]
        positions = [position for position in dictionary.positions(word) if 0 < position < len(word)]
        if not positions:
            return [word]
        pieces = []
        start = 0
        for position in positions:
            pieces.append(word[start:position])
            start = position
        pieces.append(word[start:])
        return [piece for piece in pieces if piece]

    return split, None


def resolve_pyphen_language(pyphen, language: str | None) -> str | None:
    if not language:
        return None
    normalized = language.replace("-", "_")
    available = set(getattr(pyphen, "LANGUAGES", {}).keys())
    if normalized in available:
        return normalized
    base = language_base(language)
    if not base:
        return None
    exact_base = next((item for item in available if item.lower() == base), None)
    if exact_base:
        return exact_base
    preferred = f"{base}_{base.upper()}"
    if preferred in available:
        return preferred
    if base == "en" and "en_US" in available:
        return "en_US"
    candidates = sorted(item for item in available if language_base(item) == base)
    return candidates[0] if candidates else None


def build_kokosznicka_splitter() -> tuple[Callable[[str], list[str]], str | None]:
    try:
        import kokosznicka
    except Exception as exc:
        return heuristic_syllables, f"Kokosznicka jest niedostepna: {sanitize_log(str(exc))}"

    for candidate in kokosznicka_candidates(kokosznicka):
        try:
            sample = normalize_kokosznicka_output("Panie", candidate("Panie"))
        except Exception:
            continue
        if valid_syllables("Panie", sample):
            return lambda text, selected=candidate: normalize_kokosznicka_output(text, selected(text)), None
    return heuristic_syllables, "Kokosznicka nie udostepnia rozpoznanej funkcji sylabizacji."


def kokosznicka_candidates(module) -> list[Callable[[str], object]]:
    candidates: list[Callable[[str], object]] = []
    for name in KOKOSZNICKA_FUNCTION_NAMES:
        function = getattr(module, name, None)
        if callable(function):
            candidates.append(function)
    for class_name in KOKOSZNICKA_CLASS_NAMES:
        cls = getattr(module, class_name, None)
        if not callable(cls):
            continue
        for method_name in KOKOSZNICKA_FUNCTION_NAMES:
            method = getattr(cls, method_name, None)
            if callable(method):
                candidates.append(method)
        try:
            instance = cls()
        except Exception:
            continue
        for method_name in KOKOSZNICKA_FUNCTION_NAMES:
            method = getattr(instance, method_name, None)
            if callable(method):
                candidates.append(method)
    return candidates


def normalize_syllable_output(word: str, output) -> list[str]:
    clean_word = word.strip()
    if not clean_word:
        return [word]
    if isinstance(output, str):
        normalized = output
        for separator in ("-", "\u00ad", "·", "•", "|", "/", "+"):
            normalized = normalized.replace(separator, " ")
        pieces = normalized.split()
    elif isinstance(output, (list, tuple)):
        pieces = [str(piece).strip() for piece in output]
    else:
        return []
    syllables = [piece for piece in pieces if piece]
    return syllables if valid_syllables(clean_word, syllables) else []


def normalize_kokosznicka_output(word: str, output) -> list[str]:
    clean_word = word.strip()
    if not clean_word:
        return [word]
    if not isinstance(output, str):
        return normalize_syllable_output(word, output)
    hyphenated = output.strip()
    pieces = [piece for piece in hyphenated.split("-") if piece]
    if len(pieces) <= 1:
        return [clean_word]
    cuts = kokosznicka_original_cuts(clean_word, pieces)
    if not cuts:
        return []
    syllables = []
    start = 0
    for cut in cuts:
        syllables.append(clean_word[start:cut])
        start = cut
    syllables.append(clean_word[start:])
    return syllables if valid_syllables(clean_word, syllables) else []


def kokosznicka_original_cuts(word: str, pieces: list[str]) -> list[int]:
    index_by_normalized = original_indexes_by_kokosznicka_index(word, "".join(pieces))
    cuts = []
    normalized_position = 0
    previous_cut = 0
    for piece in pieces[:-1]:
        normalized_position += len(piece)
        raw_cut = index_by_normalized.get(normalized_position, previous_cut)
        cut = raw_cut - kokosznicka_terminal_onset_length(piece, word, raw_cut)
        cut = max(previous_cut + 1, min(cut, len(word) - 1))
        if previous_cut < cut < len(word):
            cuts.append(cut)
            previous_cut = cut
    return cuts


def original_indexes_by_kokosznicka_index(word: str, normalized: str) -> dict[int, int]:
    indexes = {0: 0}
    word_lower = word.lower()
    original_index = 0
    normalized_index = 0
    while normalized_index < len(normalized):
        marker, expansions = kokosznicka_marker_at(normalized, normalized_index)
        if marker:
            original_index = consume_kokosznicka_marker(word_lower, original_index, expansions)
            normalized_index += len(marker)
        else:
            original_index = min(original_index + 1, len(word))
            normalized_index += 1
        indexes[normalized_index] = original_index
    return indexes


def kokosznicka_marker_at(text: str, index: int) -> tuple[str | None, tuple[str, ...]]:
    for marker, expansions in KOKOSZNICKA_OUTPUT_MARKERS:
        if text.startswith(marker, index):
            return marker, expansions
    return None, ()


def consume_kokosznicka_marker(word_lower: str, index: int, expansions: tuple[str, ...]) -> int:
    for expansion in expansions:
        if word_lower.startswith(expansion.lower(), index):
            return min(index + len(expansion), len(word_lower))
    return min(index + 1, len(word_lower))


def kokosznicka_terminal_onset_length(piece: str, word: str, raw_cut: int) -> int:
    word_lower = word.lower()
    for marker, onsets in KOKOSZNICKA_TERMINAL_ONSET_MARKERS.items():
        if not piece.endswith(marker):
            continue
        for onset in onsets:
            start = max(raw_cut - len(onset), 0)
            if word_lower.startswith(onset.lower(), start):
                return len(onset)
        return 1
    return 0


def valid_syllables(text: str, syllables: list[str]) -> bool:
    word = text.strip()
    return bool(word) and bool(syllables) and "".join(syllables) == word


def syllabification_package_versions() -> dict[str, str | None]:
    return {package_name: package_version(package_name) for package_name in SYLLABIFICATION_PACKAGE_NAMES}


def normalize_language(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip().replace("_", "-").lower()
    return normalized or None


def language_base(value: str | None) -> str | None:
    normalized = normalize_language(value)
    return normalized.split("-", 1)[0] if normalized else None


def word_as_syllable(text: str) -> list[str]:
    word = text.strip()
    return [word] if word else [text]


POLISH_VOWELS = set("aąeęioóuyAĄEĘIOÓUY")


def heuristic_syllables(text: str) -> list[str]:
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


def basic_syllables(text: str) -> list[str]:
    return heuristic_syllables(text)


def arrangement_syllables(sentences: list[ArrangementSentence]) -> list[ArrangementSyllable]:
    return [
        syllable
        for sentence in sentences
        for word in sentence.words
        for syllable in word.syllables
    ]


def summarize_quality(sentences: list[ArrangementSentence], notes: list[NoteEvent]) -> dict[str, int]:
    syllables = arrangement_syllables(sentences)
    summary = {
        "syllablesRequiringReview": sum(1 for syllable in syllables if syllable.requiresReview),
        "notesRequiringReview": sum(1 for note in notes if note.requiresReview),
        "missingNoteSyllables": sum(1 for syllable in syllables if "missing_note" in syllable.qualityFlags),
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
