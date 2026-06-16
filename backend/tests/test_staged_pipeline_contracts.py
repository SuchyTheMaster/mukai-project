import unittest

from app.domain.contracts import PitchFrame, PitchSettings, StageSnapshot, StageStatus
from app.workers.pitch import segment_notes


class StagedPipelineContractsTest(unittest.TestCase):
    def test_pending_stage_can_require_settings_form(self):
        snapshot = StageSnapshot(
            stage="separating_vocals",
            substep="demucs",
            status=StageStatus.pending,
            message="Wybierz ustawienia separacji wokalu",
            workerRole="worker-separate-stems",
            actionRequired=True,
            settingsForm="separation",
            settingsSummary={"separationModel": "htdemucs_ft"},
        )

        self.assertEqual(snapshot.status, StageStatus.pending)
        self.assertTrue(snapshot.actionRequired)
        self.assertEqual(snapshot.settingsForm, "separation")
        self.assertEqual(snapshot.settingsSummary["separationModel"], "htdemucs_ft")

    def test_alignment_note_segmentation_uses_min_length_and_merge_gap(self):
        frames = [
            PitchFrame(timeSec=0.00, frequencyHz=261.6, midi=60, periodicity=0.9, voiced=True),
            PitchFrame(timeSec=0.01, frequencyHz=261.6, midi=60, periodicity=0.9, voiced=True),
            PitchFrame(timeSec=0.02, frequencyHz=261.6, midi=60, periodicity=0.9, voiced=True),
            PitchFrame(timeSec=0.03, voiced=False),
            PitchFrame(timeSec=0.04, voiced=False),
            PitchFrame(timeSec=0.05, voiced=False),
            PitchFrame(timeSec=0.06, voiced=False),
            PitchFrame(timeSec=0.07, voiced=False),
            PitchFrame(timeSec=0.08, voiced=False),
            PitchFrame(timeSec=0.09, frequencyHz=261.6, midi=60, periodicity=0.9, voiced=True),
            PitchFrame(timeSec=0.10, frequencyHz=261.6, midi=60, periodicity=0.9, voiced=True),
            PitchFrame(timeSec=0.11, frequencyHz=261.6, midi=60, periodicity=0.9, voiced=True),
        ]

        split = segment_notes(frames, PitchSettings(frameStepMs=10, minNoteLengthMs=20, mergeGapMs=30))
        merged = segment_notes(frames, PitchSettings(frameStepMs=10, minNoteLengthMs=20, mergeGapMs=100))
        filtered = segment_notes(frames, PitchSettings(frameStepMs=10, minNoteLengthMs=80, mergeGapMs=30))

        self.assertEqual(len(split), 2)
        self.assertEqual(len(merged), 1)
        self.assertEqual(len(filtered), 0)


if __name__ == "__main__":
    unittest.main()
