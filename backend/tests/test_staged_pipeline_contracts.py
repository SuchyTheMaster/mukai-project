import unittest

from app.api import routes
from app.domain.contracts import (
    Job,
    JobStatus,
    ModelProfiles,
    PitchFrame,
    PitchSettings,
    SourceMetadata,
    StageSettingsRequest,
    StageSnapshot,
    StageStatus,
    SyllabificationSettings,
    TranscriptionSettings,
    initial_processing,
    utc_now,
)
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

    def test_non_language_metadata_changes_do_not_invalidate_stages(self):
        job = self._job(metadata=SourceMetadata(title="Old", artist="Artist", year="1999", language="pl"))
        request = StageSettingsRequest(metadata=SourceMetadata(title="New", artist="Artist", album="Album", year="2026", genre="Pop", language="pl"))

        self.assertEqual(routes._changed_stages_for_settings(job, "uploaded", request), [])

    def test_language_change_invalidates_transcription_and_alignment(self):
        job = self._job(metadata=SourceMetadata(title="Song", artist="Artist", language="pl"))
        request = StageSettingsRequest(metadata=SourceMetadata(title="Song", artist="Artist", language="en"))

        self.assertEqual(routes._changed_stages_for_settings(job, "uploaded", request), ["transcribing", "aligning"])

    def test_transcription_asr_change_keeps_pitch_artifacts_valid(self):
        job = self._job(transcription_settings=TranscriptionSettings(vadOnset=0.5))
        request = StageSettingsRequest(transcriptionSettings=TranscriptionSettings(vadOnset=0.6))

        self.assertEqual(routes._changed_stages_for_settings(job, "transcribing", request), ["transcribing", "aligning"])

    def test_syllabification_change_between_methods_invalidates_only_alignment(self):
        job = self._job(syllabification_settings=SyllabificationSettings(method="pyphen"))
        request = StageSettingsRequest(syllabificationSettings=SyllabificationSettings(method="heuristic"))

        self.assertEqual(routes._changed_stages_for_settings(job, "transcribing", request), ["aligning"])

    def test_syllabification_none_change_invalidates_transcription_and_alignment(self):
        job = self._job(syllabification_settings=SyllabificationSettings(method="pyphen"))
        request = StageSettingsRequest(syllabificationSettings=SyllabificationSettings(method="none"))

        self.assertEqual(routes._changed_stages_for_settings(job, "transcribing", request), ["transcribing", "aligning"])

    def test_pitch_detection_settings_change_invalidates_pitch_and_alignment(self):
        job = self._job(pitch_settings=PitchSettings(periodicityThreshold=0.55))
        request = StageSettingsRequest(pitchSettings=PitchSettings(periodicityThreshold=0.7))

        self.assertEqual(routes._changed_stages_for_settings(job, "detecting_pitch", request), ["detecting_pitch", "aligning"])

    def test_alignment_settings_change_invalidates_only_alignment(self):
        job = self._job(pitch_settings=PitchSettings(minNoteLengthMs=120), transcription_settings=TranscriptionSettings(sentenceGapMs=None))
        request = StageSettingsRequest(
            transcriptionSettings=TranscriptionSettings(sentenceGapMs=250),
            pitchSettings=PitchSettings(minNoteLengthMs=120),
        )

        self.assertEqual(routes._changed_stages_for_settings(job, "aligning", request), ["aligning"])

    def test_source_file_change_invalidates_all_audio_processing_stages(self):
        self.assertEqual(
            routes._stages_from("preprocessing"),
            ["preprocessing", "detecting_bpm", "separating_vocals", "transcribing", "detecting_pitch", "aligning"],
        )

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

    def _job(
        self,
        *,
        metadata: SourceMetadata | None = None,
        profiles: ModelProfiles | None = None,
        transcription_settings: TranscriptionSettings | None = None,
        pitch_settings: PitchSettings | None = None,
        syllabification_settings: SyllabificationSettings | None = None,
    ) -> Job:
        return Job(
            jobId="job_test",
            status=JobStatus.awaiting_review,
            createdAt=utc_now(),
            updatedAt=utc_now(),
            metadata=metadata or SourceMetadata(title="Song", artist="Artist"),
            profiles=profiles or ModelProfiles(),
            transcriptionSettings=transcription_settings or TranscriptionSettings(),
            pitchSettings=pitch_settings or PitchSettings(),
            syllabificationSettings=syllabification_settings or SyllabificationSettings(),
            processing=initial_processing(),
        )


if __name__ == "__main__":
    unittest.main()
