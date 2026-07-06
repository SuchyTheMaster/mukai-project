import gc
import inspect
import json
import math
import os
import statistics
import time
from importlib import metadata
from pathlib import Path

from app.core.config import get_settings
from app.core.errors import sanitize_log
from app.db import repository
from app.domain.contracts import AudioAsset, JobStatus, ProgressMode, StageStatus, TranscriptChar, TranscriptSegment, TranscriptWord, TranscriptionSettings
from app.services.audio_probe import ffprobe
from app.services.ids import new_id
from app.services.queue import enqueue_pitch, redis_client
from app.services.storage import relative_to_root, resolve_inside, sha256_file, write_json
from app.workers.stages import fail_stage, is_stage_confirmed, require_stage_settings, set_stage


WHISPER_AUDIO_SAMPLE_RATE = 16000
WHISPER_CONTEXT_WINDOW_SEC = 30


def main() -> None:
    client = redis_client()
    queue = get_settings().transcription_queue_name
    while True:
        item = client.brpop(queue, timeout=5)
        if not item:
            continue
        _, payload = item
        event = json.loads(payload)
        process_job(event["jobId"])


def process_job(job_id: str) -> None:
    try:
        run_transcription(job_id)
    except Exception as exc:  # pragma: no cover - worker guard
        fail_stage(job_id, "transcribing", "whisperx", "Transkrypcja nie powiodla sie.", sanitize_log(str(exc)), "worker-transcribe")


def run_transcription(job_id: str) -> None:
    job = repository.get_job(job_id)
    if not job:
        raise RuntimeError("job not found")
    if any(asset.type == "transcript_aligned" for asset in job.artifacts):
        return

    whisperx_input = next((asset for asset in job.artifacts if asset.type == "whisperx_input"), None)
    if not whisperx_input:
        raise RuntimeError("Brak worker_inputs/whisperx.wav z etapu separacji.")

    settings = get_settings()
    repository.update_job_status(job_id, JobStatus.transcribing)
    set_stage(job_id, "transcribing", "whisperx", StageStatus.running, "Start WhisperX", "worker-transcribe", ProgressMode.estimated, 5)

    input_path = resolve_inside(whisperx_input.path)
    diagnostics = runtime_diagnostics()
    if diagnostics["device"] == "cpu" and not settings.allow_cpu_transcription:
        raise RuntimeError("GPU nie jest dostepne, a tryb CPU dla transkrypcji jest wylaczony.")

    import whisperx

    model_name = job.profiles.transcriptionModel
    transcription_settings = job.transcriptionSettings
    language = forced_language(job)
    batch_size = settings.transcription_batch_size
    compute_type = "float16" if diagnostics["device"] == "cuda" else "int8"
    started = time.monotonic()

    cache_root = Path(settings.model_cache_root) / "whisperx"
    cache_root.mkdir(parents=True, exist_ok=True)
    audio = whisperx.load_audio(str(input_path))
    input_audio = ffprobe(input_path)
    input_duration_sec = input_audio.durationSec or audio_duration_sec(audio)
    expected_window_count = math.ceil(input_duration_sec / transcription_settings.vadChunkSizeSec) if input_duration_sec else None
    model, language_passed_to, asr_vad_diagnostics = load_asr_model(
        whisperx=whisperx,
        model_name=model_name,
        device=diagnostics["device"],
        compute_type=compute_type,
        cache_root=cache_root,
        language=language,
        transcription_settings=transcription_settings,
    )
    set_stage(job_id, "transcribing", "whisperx", StageStatus.running, "Transkrypcja ASR calego wokalu", "worker-transcribe", ProgressMode.estimated, 25)
    result, transcribe_language_passed_to = transcribe_audio(
        model,
        audio,
        batch_size,
        language if language_passed_to is None else None,
        transcription_settings.vadChunkSizeSec,
    )
    detected_language = result.get("language")
    del model
    cleanup_memory()

    alignment_language = detected_language or language
    if not alignment_language:
        raise RuntimeError("WhisperX nie zwrocil jezyka potrzebnego do alignacji.")

    set_stage(job_id, "transcribing", "whisperx", StageStatus.running, "Alignacja slow", "worker-transcribe", ProgressMode.estimated, 70)
    model_a, align_metadata = whisperx.load_align_model(language_code=alignment_language, device=diagnostics["device"])
    return_char_alignments = return_char_alignments_enabled(transcription_settings)
    aligned = whisperx.align(result.get("segments", []), model_a, align_metadata, audio, diagnostics["device"], return_char_alignments=return_char_alignments)
    del model_a
    cleanup_memory()

    aligned_asr_segments = normalize_segments(aligned.get("segments", []), settings.transcription_low_confidence_threshold)
    detected_sentence_gap_ms = estimate_auto_sentence_gap(aligned_asr_segments, job.tempo.detectedSongBpm if job.tempo else None)
    segments = renumber_segments(aligned_asr_segments, settings.transcription_low_confidence_threshold)
    raw_segments = jsonable(result.get("segments", []))
    max_raw_end_sec = max_segment_end(raw_segments)
    max_aligned_end_sec = max((segment.endSec for segment in segments), default=None)
    transcript_diagnostics = diagnostics | {
        "whisperxVersion": package_version("whisperx"),
        "torchVersion": package_version("torch"),
        "cudaVariant": os.getenv("TORCH_CUDA_VARIANT", "unknown"),
        "environmentSource": os.getenv("TORCH_ENV_SOURCE", "unknown"),
        "asrModel": model_name,
        "alignmentLanguage": alignment_language,
        "alignmentModel": alignment_model_name(align_metadata),
        "batchSize": batch_size,
        "computeType": compute_type,
        "languageMode": job.metadata.languageMode,
        "requestedLanguage": language,
        "detectedLanguage": detected_language,
        "languagePassedTo": language_passed_to or transcribe_language_passed_to,
        "lowConfidenceThreshold": settings.transcription_low_confidence_threshold,
        "audioInputDurationSec": input_duration_sec,
        "audioSubmittedToAsr": "full_worker_inputs/whisperx.wav",
        "windowingStrategy": "whisperx_vad_cut_merge_full_audio",
        "vadMethod": transcription_settings.vadMethod,
        "vadMethodApplied": asr_vad_diagnostics["methodApplied"],
        "vadMethodSupported": asr_vad_diagnostics["methodSupported"],
        "vadOptions": asr_vad_diagnostics["options"],
        "vadOptionsApplied": asr_vad_diagnostics["optionsApplied"],
        "vadModelInjected": asr_vad_diagnostics["modelInjected"],
        "vadCompatibilityNote": asr_vad_diagnostics["compatibilityNote"],
        "positioning": transcription_settings.positioning,
        "returnCharAlignments": return_char_alignments,
        "requestedSentenceGapMs": None,
        "detectedSentenceGapMs": detected_sentence_gap_ms,
        "effectiveSentenceGapMs": None,
        "sentencePaddingMs": transcription_settings.sentencePaddingMs,
        "whisperContextWindowSec": WHISPER_CONTEXT_WINDOW_SEC,
        "expectedWindowCount": expected_window_count,
        "rawAsrSegmentCount": len(raw_segments),
        "alignedWordSegmentCount": len(segments),
        "asrSegmentCount": len(raw_segments),
        "alignedSegmentCount": len(segments),
        "maxRawSegmentEndSec": max_raw_end_sec,
        "maxAlignedSegmentEndSec": max_aligned_end_sec,
        "transcribedBeyondFirstWindow": bool(max_raw_end_sec and max_raw_end_sec > WHISPER_CONTEXT_WINDOW_SEC),
        "inputSha256": sha256_file(input_path),
        "processingSec": round(time.monotonic() - started, 3),
    }

    artifacts_dir = resolve_inside(f"jobs/{job_id}/artifacts")
    raw_path = artifacts_dir / "transcript.raw.json"
    aligned_path = artifacts_dir / "transcript.aligned.json"
    write_json(
        raw_path,
        {
            "schemaVersion": "1.0.0",
            "jobId": job_id,
            "stage": "transcribing",
            "substep": "whisperx",
            "diagnostics": transcript_diagnostics,
            "segments": raw_segments,
        },
    )
    write_json(
        aligned_path,
        {
            "schemaVersion": "1.0.0",
            "jobId": job_id,
            "stage": "transcribing",
            "substep": "whisperx",
            "diagnostics": transcript_diagnostics,
            "segments": [segment.model_dump() for segment in segments],
        },
    )

    assets = [
        AudioAsset(
            assetId=new_id("asset"),
            type="transcript_raw",
            path=relative_to_root(raw_path),
            mimeType="application/json",
            sha256=sha256_file(raw_path),
            sizeBytes=raw_path.stat().st_size,
            producedByStage="transcribing",
            producedBySubstep="whisperx",
            metadata={"model": model_name, "language": detected_language or language},
        ),
        AudioAsset(
            assetId=new_id("asset"),
            type="transcript_aligned",
            path=relative_to_root(aligned_path),
            mimeType="application/json",
            sha256=sha256_file(aligned_path),
            sizeBytes=aligned_path.stat().st_size,
            producedByStage="transcribing",
            producedBySubstep="whisperx",
            metadata={"model": model_name, "language": detected_language or language, "requiresReviewCount": sum(1 for segment in segments if segment.requiresReview)},
        ),
    ]
    for asset in assets:
        repository.create_artifact(job_id, asset)
    set_stage(job_id, "transcribing", "whisperx", StageStatus.completed, "Transkrypcja", "worker-transcribe", ProgressMode.determinate, 100, artifact_ids=[asset.assetId for asset in assets])
    refreshed = repository.get_job(job_id)
    if refreshed and any(asset.type == "pitch_frames" for asset in refreshed.artifacts):
        if is_stage_confirmed(refreshed, "aligning"):
            enqueue_pitch(job_id, start_stage="aligning")
        else:
            require_stage_settings(
                job_id,
                "aligning",
                "draft",
                "Wybierz ustawienia wstępnego dopasowania",
                "worker-aligner",
                "alignment",
                {
                    "sentenceGapMs": refreshed.transcriptionSettings.sentenceGapMs,
                    "minNoteLengthMs": refreshed.pitchSettings.minNoteLengthMs,
                    "mergeGapMs": refreshed.pitchSettings.mergeGapMs,
                },
            )
    elif refreshed and is_stage_confirmed(refreshed, "detecting_pitch"):
        enqueue_pitch(job_id)
    else:
        require_stage_settings(
            job_id,
            "detecting_pitch",
            "pitch_detection",
            "Wybierz ustawienia detekcji tonów",
            "worker-pitch",
            "pitch",
            {
                "pitch": job.profiles.pitch,
                "silenceThresholdDb": job.pitchSettings.silenceThresholdDb,
                "periodicityThreshold": job.pitchSettings.periodicityThreshold,
                "frameStepMs": job.pitchSettings.frameStepMs,
            },
        )


def forced_language(job) -> str | None:
    language = (job.metadata.language or "").strip()
    if job.metadata.languageMode == "forced" and language:
        return language
    return None


def load_asr_model(
    whisperx,
    model_name: str,
    device: str,
    compute_type: str,
    cache_root: Path,
    language: str | None,
    transcription_settings: TranscriptionSettings,
):
    kwargs = {"compute_type": compute_type, "download_root": str(cache_root)}
    language_passed_to = None
    load_model_params = inspect.signature(whisperx.load_model).parameters
    vad_options = {
        "chunk_size": transcription_settings.vadChunkSizeSec,
        "vad_onset": transcription_settings.vadOnset,
        "vad_offset": transcription_settings.vadOffset,
    }
    vad_diagnostics = {
        "requestedMethod": transcription_settings.vadMethod,
        "methodApplied": "whisperx_default",
        "methodSupported": "vad_method" in load_model_params,
        "options": vad_options,
        "optionsApplied": "vad_options" in load_model_params,
        "modelInjected": False,
        "compatibilityNote": None,
    }
    if vad_diagnostics["optionsApplied"]:
        kwargs["vad_options"] = vad_options
    if vad_diagnostics["methodSupported"]:
        kwargs["vad_method"] = transcription_settings.vadMethod
        vad_diagnostics["methodApplied"] = transcription_settings.vadMethod
    elif "vad_model" in load_model_params:
        vad_model, note = build_manual_vad_model(whisperx, transcription_settings.vadMethod, device, vad_options)
        if vad_model is not None:
            kwargs["vad_model"] = vad_model
            vad_diagnostics["methodApplied"] = transcription_settings.vadMethod
            vad_diagnostics["modelInjected"] = True
        else:
            vad_diagnostics["compatibilityNote"] = note
    else:
        vad_diagnostics["compatibilityNote"] = "WhisperX load_model nie obsluguje vad_method ani vad_model; uzyto domyslnego VAD tej wersji."
    if language and "language" in load_model_params:
        kwargs["language"] = language
        language_passed_to = "load_model"
    return whisperx.load_model(model_name, device, **kwargs), language_passed_to, vad_diagnostics


def build_manual_vad_model(whisperx, vad_method: str, device: str, vad_options: dict):
    vads = getattr(whisperx, "vads", None)
    if vads is None:
        return None, "WhisperX nie udostepnia modulu whisperx.vads do recznego utworzenia VAD."
    try:
        if vad_method == "silero":
            silero_cls = getattr(vads, "Silero", None)
            if silero_cls is None:
                return None, "WhisperX nie udostepnia klasy vads.Silero; uzyto domyslnego VAD tej wersji."
            return silero_cls(**vad_options), None
        if vad_method == "pyannote":
            pyannote_cls = getattr(vads, "Pyannote", None)
            if pyannote_cls is None:
                return None, "WhisperX nie udostepnia klasy vads.Pyannote; uzyto domyslnego VAD tej wersji."
            import torch

            return pyannote_cls(torch.device(device), token=None, **vad_options), None
    except Exception as exc:
        return None, f"Nie udalo sie utworzyc recznego modelu VAD: {sanitize_log(str(exc))}"
    return None, f"Nieznana metoda VAD: {vad_method}; uzyto domyslnego VAD tej wersji."


def transcribe_audio(model, audio, batch_size: int, language: str | None, chunk_size_sec: int):
    kwargs = {"batch_size": batch_size}
    language_passed_to = None
    transcribe_params = inspect.signature(model.transcribe).parameters
    if "chunk_size" in transcribe_params:
        kwargs["chunk_size"] = chunk_size_sec
    if language and "language" in transcribe_params:
        kwargs["language"] = language
        language_passed_to = "transcribe"
    return model.transcribe(audio, **kwargs), language_passed_to


def return_char_alignments_enabled(transcription_settings: TranscriptionSettings) -> bool:
    return transcription_settings.positioning == "words_and_syllables"


def normalize_segments(raw_segments: list[dict], low_confidence_threshold: float) -> list[TranscriptSegment]:
    segments: list[TranscriptSegment] = []
    for segment_index, raw_segment in enumerate(raw_segments, start=1):
        start = float(raw_segment.get("start") or 0.0)
        end = float(raw_segment.get("end") or start)
        if end <= start:
            end = start + 0.001
        words = normalize_words(raw_segment.get("words") or [], start, end, segment_index, low_confidence_threshold, raw_segment.get("chars") or [])
        confidence = segment_confidence(raw_segment, words)
        requires_review = confidence is None or confidence < low_confidence_threshold or any(word.requiresReview for word in words)
        segments.append(
            TranscriptSegment(
                segmentId=f"seg_{segment_index:04d}",
                startSec=start,
                endSec=end,
                text=(raw_segment.get("text") or "").strip(),
                confidence=confidence,
                requiresReview=requires_review,
                words=words,
            )
        )
    return segments


def build_sentence_segments(
    aligned_segments: list[TranscriptSegment],
    transcription_settings: TranscriptionSettings,
    low_confidence_threshold: float,
    detected_song_bpm: float | None = None,
) -> list[TranscriptSegment]:
    words = sorted(
        [word for segment in aligned_segments for word in segment.words if word.text],
        key=lambda word: (word.startSec, word.endSec),
    )
    if not words:
        return renumber_segments(aligned_segments, low_confidence_threshold)

    pause_sec = detected_sentence_gap(transcription_settings, aligned_segments, detected_song_bpm) / 1000.0
    groups: list[list[TranscriptWord]] = []
    current: list[TranscriptWord] = []
    previous: TranscriptWord | None = None
    for word in words:
        if previous is not None and word.startSec - previous.endSec > pause_sec:
            groups.append(current)
            current = []
        current.append(word)
        previous = word
    if current:
        groups.append(current)

    padding_sec = transcription_settings.sentencePaddingMs / 1000.0
    raw_bounds = [(group[0].startSec, max(word.endSec for word in group)) for group in groups]
    sentence_segments: list[TranscriptSegment] = []
    for segment_index, group in enumerate(groups, start=1):
        raw_start, raw_end = raw_bounds[segment_index - 1]
        start = max(0.0, raw_start - padding_sec)
        end = raw_end + padding_sec
        if segment_index > 1:
            previous_end = raw_bounds[segment_index - 2][1]
            start = max(start, midpoint(previous_end, raw_start))
        if segment_index < len(groups):
            next_start = raw_bounds[segment_index][0]
            end = min(end, midpoint(raw_end, next_start))
        if end <= start:
            start, end = raw_start, raw_end if raw_end > raw_start else raw_start + 0.001

        sentence_words = [
            word.model_copy(update={"wordId": f"word_{segment_index:04d}_{word_index:03d}"})
            for word_index, word in enumerate(group, start=1)
        ]
        confidence = segment_confidence({}, sentence_words)
        requires_review = confidence is None or confidence < low_confidence_threshold or any(word.requiresReview for word in sentence_words)
        sentence_segments.append(
            TranscriptSegment(
                segmentId=f"seg_{segment_index:04d}",
                startSec=round(start, 6),
                endSec=round(end, 6),
                text=join_words(sentence_words),
                confidence=confidence,
                requiresReview=requires_review,
                words=sentence_words,
            )
        )
    return sentence_segments


def detected_sentence_gap(
    transcription_settings: TranscriptionSettings,
    aligned_segments: list[TranscriptSegment],
    detected_song_bpm: float | None = None,
) -> int:
    if transcription_settings.sentenceGapMs is not None:
        return transcription_settings.sentenceGapMs
    return estimate_auto_sentence_gap(aligned_segments, detected_song_bpm)


def estimate_auto_sentence_gap(
    aligned_segments: list[TranscriptSegment],
    detected_song_bpm: float | None = None,
) -> int:

    words = sorted(
        [word for segment in aligned_segments for word in segment.words if word.text],
        key=lambda word: (word.startSec, word.endSec),
    )
    gaps_ms = [
        max(0.0, (words[index].startSec - words[index - 1].endSec) * 1000.0)
        for index in range(1, len(words))
        if words[index].startSec >= words[index - 1].endSec
    ]
    nonzero_gaps = [gap for gap in gaps_ms if gap > 0]
    sorted_gaps = sorted(nonzero_gaps)
    short_gap_sample = sorted_gaps[: max(1, len(sorted_gaps) // 2)] if sorted_gaps else []
    avg_short_gap_ms = statistics.mean(short_gap_sample) if short_gap_sample else 250.0
    median_gap_ms = statistics.median(short_gap_sample) if short_gap_sample else avg_short_gap_ms
    bpm_gap_ms = 60000.0 / detected_song_bpm if detected_song_bpm and detected_song_bpm > 0 else 500.0
    estimate = max(median_gap_ms * 2.5, avg_short_gap_ms * 1.8, bpm_gap_ms * 1.25)
    return int(round(max(300.0, min(1500.0, estimate))))


def renumber_segments(segments: list[TranscriptSegment], low_confidence_threshold: float) -> list[TranscriptSegment]:
    renumbered: list[TranscriptSegment] = []
    for segment_index, segment in enumerate(segments, start=1):
        words = [
            word.model_copy(update={"wordId": f"word_{segment_index:04d}_{word_index:03d}"})
            for word_index, word in enumerate(segment.words, start=1)
        ]
        confidence = segment_confidence({}, words) if words else segment.confidence
        requires_review = confidence is None or confidence < low_confidence_threshold or segment.requiresReview or any(word.requiresReview for word in words)
        renumbered.append(
            segment.model_copy(
                update={
                    "segmentId": f"seg_{segment_index:04d}",
                    "confidence": confidence,
                    "requiresReview": requires_review,
                    "words": words,
                }
            )
        )
    return renumbered


def midpoint(left: float, right: float) -> float:
    return left + (right - left) / 2.0


def join_words(words: list[TranscriptWord]) -> str:
    return " ".join(word.text.strip() for word in words if word.text.strip()).strip()


def normalize_words(raw_words: list[dict], segment_start: float, segment_end: float, segment_index: int, low_confidence_threshold: float, segment_chars: list[dict] | None = None) -> list[TranscriptWord]:
    words: list[TranscriptWord] = []
    fallback_step = max((segment_end - segment_start) / max(len(raw_words), 1), 0.001)
    chars_by_word = segment_chars_by_local_word(segment_chars or [], raw_words)
    for word_index, raw_word in enumerate(raw_words, start=1):
        has_timing = raw_word.get("start") is not None and raw_word.get("end") is not None
        start = float(raw_word.get("start")) if has_timing else segment_start + fallback_step * (word_index - 1)
        end = float(raw_word.get("end")) if has_timing else min(segment_end, start + fallback_step)
        if end <= start:
            end = start + 0.001
        confidence = raw_word.get("score", raw_word.get("confidence"))
        confidence = float(confidence) if confidence is not None else None
        requires_review = not has_timing or confidence is None or confidence < low_confidence_threshold
        raw_chars = raw_word.get("chars") or chars_by_word.get(word_index - 1, [])
        words.append(
            TranscriptWord(
                wordId=f"word_{segment_index:04d}_{word_index:03d}",
                startSec=start,
                endSec=end,
                text=(raw_word.get("word") or raw_word.get("text") or "").strip(),
                confidence=confidence,
                requiresReview=requires_review,
                chars=normalize_chars(raw_chars, start, end),
            )
        )
    return words


def segment_chars_by_local_word(segment_chars: list[dict], raw_words: list[dict]) -> dict[int, list[dict]]:
    indexed: dict[int, list[dict]] = {}
    for raw_char in segment_chars:
        word_index = raw_char_word_index(raw_char)
        if word_index is not None:
            indexed.setdefault(word_index, []).append(raw_char)
    if indexed:
        unique_indexes = sorted(indexed)
        if len(unique_indexes) == len(raw_words):
            return {local_index: indexed[raw_index] for local_index, raw_index in enumerate(unique_indexes)}
        return {index: chars for index, chars in indexed.items() if 0 <= index < len(raw_words)}
    return segment_chars_by_text(segment_chars, raw_words)


def raw_char_word_index(raw_char: dict) -> int | None:
    for key in ("word-idx", "word_idx", "wordIndex", "word_index"):
        value = raw_char.get(key)
        if value is None:
            continue
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
    return None


def segment_chars_by_text(segment_chars: list[dict], raw_words: list[dict]) -> dict[int, list[dict]]:
    grouped: dict[int, list[dict]] = {}
    char_index = 0
    for word_index, raw_word in enumerate(raw_words):
        text = (raw_word.get("word") or raw_word.get("text") or "").strip()
        if not text:
            continue
        matched: list[dict] = []
        success = True
        for expected in text:
            while char_index < len(segment_chars) and raw_char_text(segment_chars[char_index]).isspace():
                char_index += 1
            if char_index >= len(segment_chars):
                success = False
                break
            raw_char = segment_chars[char_index]
            if raw_char_text(raw_char).lower() != expected.lower():
                success = False
                break
            matched.append(raw_char)
            char_index += 1
        if success:
            grouped[word_index] = matched
    return grouped


def normalize_chars(raw_chars: list[dict], word_start: float, word_end: float) -> list[TranscriptChar]:
    chars: list[TranscriptChar] = []
    for raw_char in raw_chars:
        char = raw_char_text(raw_char)
        if not char or char.isspace():
            continue
        has_timing = raw_char.get("start") is not None and raw_char.get("end") is not None
        if not has_timing:
            continue
        start = max(word_start, float(raw_char["start"]))
        end = min(word_end, float(raw_char["end"]))
        if end <= start:
            continue
        confidence = raw_char.get("score", raw_char.get("confidence"))
        chars.append(
            TranscriptChar(
                char=char,
                startSec=round(start, 6),
                endSec=round(end, 6),
                confidence=float(confidence) if confidence is not None else None,
            )
        )
    return chars


def raw_char_text(raw_char: dict) -> str:
    return str(raw_char.get("char") or raw_char.get("text") or "")


def segment_confidence(raw_segment: dict, words: list[TranscriptWord]) -> float | None:
    if raw_segment.get("confidence") is not None:
        return float(raw_segment["confidence"])
    scored_words = [word.confidence for word in words if word.confidence is not None]
    if scored_words:
        return round(sum(scored_words) / len(scored_words), 4)
    avg_logprob = raw_segment.get("avg_logprob")
    if avg_logprob is not None:
        return round(max(0.0, min(1.0, 1.0 + float(avg_logprob))), 4)
    return None


def audio_duration_sec(audio) -> float | None:
    try:
        return round(len(audio) / WHISPER_AUDIO_SAMPLE_RATE, 3)
    except TypeError:
        return None


def max_segment_end(segments: list[dict]) -> float | None:
    values = [float(segment["end"]) for segment in segments if segment.get("end") is not None]
    return max(values, default=None)


def alignment_model_name(align_metadata) -> str | None:
    if isinstance(align_metadata, dict):
        return align_metadata.get("model") or align_metadata.get("name") or align_metadata.get("model_name")
    return getattr(align_metadata, "model", None) or getattr(align_metadata, "name", None)


def jsonable(value):
    if isinstance(value, dict):
        return {key: jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [jsonable(item) for item in value]
    if hasattr(value, "item"):
        return value.item()
    if hasattr(value, "tolist"):
        return value.tolist()
    return value


def cleanup_memory() -> None:
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        return


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


if __name__ == "__main__":
    main()
