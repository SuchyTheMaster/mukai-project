from pathlib import Path
import unittest
from unittest.mock import patch

from app.domain.contracts import SyllabificationSettings, TranscriptSegment, TranscriptWord, TranscriptionSettings, final_transcription_settings
from app.workers.transcribe import SILERO_VAD_REVISION, active_vad_options, build_sentence_segments, detected_sentence_gap, install_vad_segment_recorder, load_asr_model, normalize_segments, return_char_alignments_enabled


class FakeWhisperX:
    calls = []

    @staticmethod
    def load_model(model_name, device, *, compute_type, download_root, vad_options, vad_method=None, vad_model=None, language=None):
        FakeWhisperX.calls.append(
            {
                "model_name": model_name,
                "device": device,
                "compute_type": compute_type,
                "download_root": download_root,
                "vad_method": vad_method,
                "vad_model": vad_model,
                "vad_options": vad_options,
                "language": language,
            }
        )
        return object()


class FakeLegacyWhisperX:
    calls = []

    @staticmethod
    def load_model(model_name, device, *, compute_type, download_root, vad_options, language=None):
        FakeLegacyWhisperX.calls.append(
            {
                "model_name": model_name,
                "device": device,
                "compute_type": compute_type,
                "download_root": download_root,
                "vad_options": vad_options,
                "language": language,
            }
        )
        return object()


class FakeVadBase:
    pass


class FakeVadDelegate(FakeVadBase):
    @staticmethod
    def preprocess_audio(audio):
        return audio

    def __call__(self, audio, **kwargs):
        return audio

    @staticmethod
    def merge_chunks(segments, chunk_size, onset=0.5, offset=None):
        return [{"start": 1.0, "end": 3.0, "segments": [(1.0, 1.8), (2.1, 3.0)]}]


class FakeWhisperWithVads:
    class vads:
        Vad = FakeVadBase


class TranscriptionVadAndSentencesTest(unittest.TestCase):
    def test_transcription_settings_defaults(self):
        settings = TranscriptionSettings()

        self.assertEqual(settings.vadMethod, "silero")
        self.assertEqual(settings.sileroThreshold, 0.3)
        self.assertEqual(settings.sileroNegThreshold, 0.15)
        self.assertEqual(settings.sileroMinSpeechDurationMs, 80)
        self.assertEqual(settings.sileroMinSilenceDurationMs, 100)
        self.assertEqual(settings.sileroSpeechPadMs, 100)
        self.assertEqual(settings.pyannoteVadOnset, 0.45)
        self.assertEqual(settings.pyannoteVadOffset, 0.25)
        self.assertEqual(settings.vadChunkSizeSec, 30)
        self.assertIsNone(settings.sentenceGapMs)
        self.assertEqual(settings.sentencePaddingMs, 80)
        self.assertEqual(settings.positioning, "words_and_syllables")

    def test_none_syllabification_forces_words_only_positioning(self):
        settings = final_transcription_settings(
            TranscriptionSettings(positioning="words_and_syllables"),
            SyllabificationSettings(method="none"),
        )

        self.assertEqual(settings.positioning, "words_only")

    def test_return_char_alignments_follows_positioning(self):
        self.assertTrue(return_char_alignments_enabled(TranscriptionSettings(positioning="words_and_syllables")))
        self.assertFalse(return_char_alignments_enabled(TranscriptionSettings(positioning="words_only")))

    def test_normalize_segments_preserves_character_alignments_on_words(self):
        segments = normalize_segments(
            [
                {
                    "start": 0.0,
                    "end": 1.0,
                    "text": "aa",
                    "words": [{"word": "aa", "start": 0.0, "end": 1.0, "score": 0.9}],
                    "chars": [
                        {"char": "a", "start": 0.0, "end": 0.4, "score": 0.8, "word-idx": 0},
                        {"char": "a", "start": 0.5, "end": 1.0, "score": 0.9, "word-idx": 0},
                    ],
                }
            ],
            low_confidence_threshold=0.55,
        )

        chars = segments[0].words[0].chars
        self.assertEqual([item.char for item in chars], ["a", "a"])
        self.assertEqual([(item.startSec, item.endSec) for item in chars], [(0.0, 0.4), (0.5, 1.0)])

    def test_load_asr_model_passes_silero_vad_options(self):
        FakeWhisperX.calls = []
        settings = TranscriptionSettings()

        pinned_vad = object()
        with patch("app.workers.transcribe.build_manual_vad_model", return_value=(pinned_vad, None)):
            _, language_passed_to, vad_diagnostics = load_asr_model(
                whisperx=FakeWhisperX,
                model_name="large-v3",
                device="cuda",
                compute_type="float16",
                cache_root=Path("model-cache"),
                language="pl",
                transcription_settings=settings,
            )

        self.assertEqual(language_passed_to, "load_model")
        self.assertEqual(
            vad_diagnostics["options"],
            {
                "chunk_size": 30,
                "vad_onset": 0.3,
                "vad_offset": 0.15,
                "threshold": 0.3,
                "neg_threshold": 0.15,
                "min_speech_duration_ms": 80,
                "min_silence_duration_ms": 100,
                "speech_pad_ms": 100,
            },
        )
        self.assertEqual(vad_diagnostics["methodApplied"], "silero")
        self.assertTrue(vad_diagnostics["methodSupported"])
        self.assertIs(FakeWhisperX.calls[0]["vad_model"], pinned_vad)
        self.assertIsNone(FakeWhisperX.calls[0]["vad_method"])
        self.assertEqual(vad_diagnostics["modelRevision"], SILERO_VAD_REVISION)
        self.assertEqual(FakeWhisperX.calls[0]["language"], "pl")

    def test_load_asr_model_does_not_fail_without_vad_method_parameter(self):
        FakeLegacyWhisperX.calls = []
        settings = TranscriptionSettings(vadMethod="pyannote")

        _, language_passed_to, vad_diagnostics = load_asr_model(
            whisperx=FakeLegacyWhisperX,
            model_name="large-v3",
            device="cuda",
            compute_type="float16",
            cache_root=Path("model-cache"),
            language="pl",
            transcription_settings=settings,
        )

        self.assertEqual(language_passed_to, "load_model")
        self.assertEqual(FakeLegacyWhisperX.calls[0]["vad_options"], {"chunk_size": 30, "vad_onset": 0.45, "vad_offset": 0.25})
        self.assertFalse(vad_diagnostics["methodSupported"])
        self.assertEqual(vad_diagnostics["methodApplied"], "whisperx_default")
        self.assertIn("vad_method", vad_diagnostics["compatibilityNote"])

    def test_legacy_thresholds_are_migrated_for_selected_vad(self):
        silero = TranscriptionSettings.model_validate({"vadMethod": "silero", "vadOnset": 0.31, "vadOffset": 0.28})
        pyannote = TranscriptionSettings.model_validate({"vadMethod": "pyannote", "vadOnset": 0.41, "vadOffset": 0.21})

        self.assertEqual((silero.sileroThreshold, silero.sileroNegThreshold), (0.31, 0.16))
        self.assertEqual((pyannote.pyannoteVadOnset, pyannote.pyannoteVadOffset), (0.41, 0.21))

    def test_only_selected_vad_options_are_applied(self):
        settings = TranscriptionSettings(vadMethod="pyannote", sileroThreshold=0.2, pyannoteVadOnset=0.44, pyannoteVadOffset=0.24)

        self.assertEqual(active_vad_options(settings), {"chunk_size": 30, "vad_onset": 0.44, "vad_offset": 0.24})

    def test_vad_recorder_captures_chunks_submitted_to_asr(self):
        model = type("FakeModel", (), {"vad_model": FakeVadDelegate()})()

        captured, note = install_vad_segment_recorder(FakeWhisperWithVads, model)
        model.vad_model.merge_chunks([], 30, onset=0.3, offset=0.15)

        self.assertIsNone(note)
        self.assertEqual(
            captured,
            [
                {
                    "vadSegmentId": "vad_0001",
                    "startSec": 1.0,
                    "endSec": 3.0,
                    "sourceSegments": [{"startSec": 1.0, "endSec": 1.8}, {"startSec": 2.1, "endSec": 3.0}],
                }
            ],
        )

    def test_sentence_segments_split_on_pause_threshold(self):
        words = [
            TranscriptWord(wordId="w1", startSec=0.0, endSec=0.2, text="ala", confidence=0.9),
            TranscriptWord(wordId="w2", startSec=0.4, endSec=0.6, text="ma", confidence=0.9),
            TranscriptWord(wordId="w3", startSec=1.3, endSec=1.5, text="kota", confidence=0.9),
        ]
        aligned = [
            TranscriptSegment(
                segmentId="raw_1",
                startSec=0.0,
                endSec=1.5,
                text="ala ma kota",
                confidence=0.9,
                words=words,
            )
        ]
        settings = TranscriptionSettings(sentenceGapMs=600, sentencePaddingMs=0)

        segments = build_sentence_segments(aligned, settings, low_confidence_threshold=0.55)

        self.assertEqual([segment.text for segment in segments], ["ala ma", "kota"])
        self.assertEqual(segments[0].startSec, 0.0)
        self.assertEqual(segments[0].endSec, 0.6)
        self.assertEqual(segments[1].startSec, 1.3)
        self.assertEqual(segments[1].endSec, 1.5)

    def test_sentence_segments_auto_gap_uses_word_gaps_and_bpm(self):
        words = [
            TranscriptWord(wordId="w1", startSec=0.0, endSec=0.2, text="ala", confidence=0.9),
            TranscriptWord(wordId="w2", startSec=0.35, endSec=0.55, text="ma", confidence=0.9),
            TranscriptWord(wordId="w3", startSec=1.6, endSec=1.8, text="kota", confidence=0.9),
        ]
        aligned = [
            TranscriptSegment(
                segmentId="raw_1",
                startSec=0.0,
                endSec=1.8,
                text="ala ma kota",
                confidence=0.9,
                words=words,
            )
        ]
        settings = TranscriptionSettings(sentenceGapMs=None, sentencePaddingMs=0)

        self.assertGreaterEqual(detected_sentence_gap(settings, aligned, detected_song_bpm=120), 625)
        segments = build_sentence_segments(aligned, settings, low_confidence_threshold=0.55, detected_song_bpm=120)

        self.assertEqual([segment.text for segment in segments], ["ala ma", "kota"])

    def test_sentence_padding_extends_bounds_without_overlapping_neighbors(self):
        words = [
            TranscriptWord(wordId="w1", startSec=1.0, endSec=1.4, text="ala", confidence=0.9),
            TranscriptWord(wordId="w2", startSec=2.2, endSec=2.6, text="kota", confidence=0.9),
        ]
        aligned = [TranscriptSegment(segmentId="raw_1", startSec=1.0, endSec=2.6, text="ala kota", confidence=0.9, words=words)]

        segments = build_sentence_segments(aligned, TranscriptionSettings(sentenceGapMs=500, sentencePaddingMs=200), 0.55)

        self.assertEqual([(segment.startSec, segment.endSec) for segment in segments], [(0.8, 1.6), (2.0, 2.8)])


if __name__ == "__main__":
    unittest.main()
