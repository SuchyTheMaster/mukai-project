from pathlib import Path
import unittest

from app.domain.contracts import SyllabificationSettings, TranscriptSegment, TranscriptWord, TranscriptionSettings, final_transcription_settings
from app.workers.transcribe import build_sentence_segments, detected_sentence_gap, load_asr_model, normalize_segments, return_char_alignments_enabled


class FakeWhisperX:
    calls = []

    @staticmethod
    def load_model(model_name, device, *, compute_type, download_root, vad_method, vad_options, language=None):
        FakeWhisperX.calls.append(
            {
                "model_name": model_name,
                "device": device,
                "compute_type": compute_type,
                "download_root": download_root,
                "vad_method": vad_method,
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


class TranscriptionVadAndSentencesTest(unittest.TestCase):
    def test_transcription_settings_defaults(self):
        settings = TranscriptionSettings()

        self.assertEqual(settings.vadMethod, "silero")
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
        self.assertEqual(vad_diagnostics["options"], {"chunk_size": 30, "vad_onset": 0.5, "vad_offset": 0.363})
        self.assertEqual(vad_diagnostics["methodApplied"], "silero")
        self.assertTrue(vad_diagnostics["methodSupported"])
        self.assertEqual(FakeWhisperX.calls[0]["vad_method"], "silero")
        self.assertEqual(FakeWhisperX.calls[0]["language"], "pl")

    def test_load_asr_model_does_not_fail_without_vad_method_parameter(self):
        FakeLegacyWhisperX.calls = []
        settings = TranscriptionSettings()

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
        self.assertEqual(FakeLegacyWhisperX.calls[0]["vad_options"], {"chunk_size": 30, "vad_onset": 0.5, "vad_offset": 0.363})
        self.assertFalse(vad_diagnostics["methodSupported"])
        self.assertEqual(vad_diagnostics["methodApplied"], "whisperx_default")
        self.assertIn("vad_method", vad_diagnostics["compatibilityNote"])

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


if __name__ == "__main__":
    unittest.main()
