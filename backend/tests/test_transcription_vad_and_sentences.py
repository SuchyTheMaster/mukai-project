from pathlib import Path
import unittest

from app.domain.contracts import TranscriptSegment, TranscriptWord, TranscriptionSettings
from app.workers.transcribe import build_sentence_segments, load_asr_model


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
        self.assertEqual(settings.sentencePauseMs, 700)
        self.assertEqual(settings.sentencePaddingMs, 80)

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
        settings = TranscriptionSettings(sentencePauseMs=700, sentencePaddingMs=0)

        segments = build_sentence_segments(aligned, settings, low_confidence_threshold=0.55)

        self.assertEqual([segment.text for segment in segments], ["ala ma", "kota"])
        self.assertEqual(segments[0].startSec, 0.0)
        self.assertEqual(segments[0].endSec, 0.6)
        self.assertEqual(segments[1].startSec, 1.3)
        self.assertEqual(segments[1].endSec, 1.5)


if __name__ == "__main__":
    unittest.main()
