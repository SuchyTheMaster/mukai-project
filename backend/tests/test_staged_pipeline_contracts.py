import unittest
from unittest.mock import patch

from app.api import routes
from app.domain.contracts import (
    CreateJobUpload,
    DEFAULT_CONFIGURATION_PRESET,
    AUTOMATIC_PROCESSING_MODE,
    Job,
    JobStatus,
    MANUAL_PROCESSING_MODE,
    ModelProfiles,
    PitchFrame,
    PitchSettings,
    ResetStageRequest,
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
from app.workers.stages import is_stage_confirmed, requires_manual_stage_confirmation


class StagedPipelineContractsTest(unittest.TestCase):
    def test_configuration_and_processing_mode_defaults(self):
        request = CreateJobUpload(
            uploadDraftId="draft_test",
            metadata=SourceMetadata(title="Song", artist="Artist"),
        )

        self.assertEqual(request.configurationPreset, DEFAULT_CONFIGURATION_PRESET)
        self.assertEqual(request.processingMode, AUTOMATIC_PROCESSING_MODE)
        self.assertEqual(self._job().configurationPreset, DEFAULT_CONFIGURATION_PRESET)
        self.assertEqual(self._job().processingMode, MANUAL_PROCESSING_MODE)
        self.assertTrue(ResetStageRequest(forceManualMode=True).forceManualMode)

    def test_only_manual_processing_mode_requires_stage_confirmation(self):
        automatic = self._job(configuration_preset="future_preset", processing_mode=AUTOMATIC_PROCESSING_MODE)
        manual = self._job(configuration_preset="future_preset", processing_mode=MANUAL_PROCESSING_MODE)

        self.assertFalse(requires_manual_stage_confirmation(automatic))
        self.assertTrue(is_stage_confirmed(automatic, "separating_vocals"))
        self.assertTrue(requires_manual_stage_confirmation(manual))
        self.assertFalse(is_stage_confirmed(manual, "separating_vocals"))

        manual.processing["separating_vocals.demucs"].settingsConfirmedAt = utc_now()
        self.assertTrue(is_stage_confirmed(manual, "separating_vocals"))

    def test_legacy_manual_preset_is_migrated_to_default_manual_mode(self):
        request = CreateJobUpload.model_validate({
            "uploadDraftId": "draft_test",
            "metadata": {"title": "Song", "artist": "Artist"},
            "configurationPreset": "manual",
        })
        legacy_job = self._job().model_dump(mode="json")
        legacy_job.pop("processingMode")
        legacy_job["configurationPreset"] = "manual"
        job = Job.model_validate(legacy_job)

        self.assertEqual(request.configurationPreset, DEFAULT_CONFIGURATION_PRESET)
        self.assertEqual(request.processingMode, MANUAL_PROCESSING_MODE)
        self.assertEqual(job.configurationPreset, DEFAULT_CONFIGURATION_PRESET)
        self.assertEqual(job.processingMode, MANUAL_PROCESSING_MODE)

    def test_legacy_non_manual_preset_keeps_automatic_behavior(self):
        legacy_job = self._job().model_dump(mode="json")
        legacy_job.pop("processingMode")
        legacy_job["configurationPreset"] = "studio"

        job = Job.model_validate(legacy_job)

        self.assertEqual(job.configurationPreset, "studio")
        self.assertEqual(job.processingMode, AUTOMATIC_PROCESSING_MODE)

    def test_non_manual_stage_reset_requeues_without_a_form(self):
        job = self._job(configuration_preset="future_preset", processing_mode=AUTOMATIC_PROCESSING_MODE)

        with patch.object(routes.repository, "get_job", return_value=job), patch.object(routes, "_invalidate_for_stage", return_value=["aligning"]), patch.object(routes, "_enqueue_stage", return_value=True) as enqueue_stage, patch.object(routes, "require_stage_settings") as require_settings:
            response = routes.reset_stage("job_test", "aligning", ResetStageRequest())

        self.assertTrue(response.queued)
        enqueue_stage.assert_called_once_with("job_test", "aligning")
        require_settings.assert_not_called()

    def test_enqueue_guard_uses_mode_independently_of_future_preset(self):
        manual = self._job(configuration_preset="studio", processing_mode=MANUAL_PROCESSING_MODE)
        automatic = self._job(configuration_preset="studio", processing_mode=AUTOMATIC_PROCESSING_MODE)

        with patch.object(routes.repository, "get_job", return_value=manual), patch.object(routes, "require_stage_settings") as require_settings, patch.object(routes, "enqueue_pitch") as enqueue_pitch:
            self.assertFalse(routes._enqueue_stage("job_test", "detecting_pitch"))

        require_settings.assert_called_once()
        enqueue_pitch.assert_not_called()

        with patch.object(routes.repository, "get_job", return_value=automatic), patch.object(routes, "require_stage_settings") as require_settings, patch.object(routes, "enqueue_pitch") as enqueue_pitch:
            self.assertTrue(routes._enqueue_stage("job_test", "detecting_pitch"))

        require_settings.assert_not_called()
        enqueue_pitch.assert_called_once_with("job_test")

    def test_return_to_audio_forces_manual_mode_and_form(self):
        automatic = self._job(processing_mode=AUTOMATIC_PROCESSING_MODE)
        manual = self._job(processing_mode=MANUAL_PROCESSING_MODE)

        with patch.object(routes.repository, "get_job", side_effect=[automatic, manual]), patch.object(routes.repository, "update_job_config") as update_job_config, patch.object(routes, "_invalidate_for_stage", return_value=["aligning"]), patch.object(routes, "_enqueue_stage") as enqueue_stage, patch.object(routes, "require_stage_settings") as require_settings:
            response = routes.reset_stage(
                "job_test",
                "aligning",
                ResetStageRequest(forceManualMode=True, reason="return_to_audio"),
            )

        self.assertFalse(response.queued)
        update_job_config.assert_called_once_with("job_test", processing_mode=MANUAL_PROCESSING_MODE)
        require_settings.assert_called_once()
        enqueue_stage.assert_not_called()

    def test_new_jobs_use_complete_pitch_defaults(self):
        self.assertEqual(ModelProfiles().pitch, "default")
        self.assertEqual(
            PitchSettings().model_dump(),
            {
                "silenceThresholdDb": -48.0,
                "periodicityThreshold": 0.48,
                "frameStepMs": 10,
                "minNoteLengthMs": 75,
                "mergeGapMs": 130,
                "checkNoteLongerThan": 400,
                "silenceTresholdForNoteChecking": -60.0,
            },
        )

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
        job = self._job(transcription_settings=TranscriptionSettings(sileroThreshold=0.3))
        request = StageSettingsRequest(transcriptionSettings=TranscriptionSettings(sileroThreshold=0.35))

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

    def test_pitch_settings_default_and_legacy_payload_use_long_syllable_threshold(self):
        self.assertEqual(PitchSettings().checkNoteLongerThan, 400)
        self.assertEqual(PitchSettings.model_validate({"minNoteLengthMs": 150}).checkNoteLongerThan, 400)
        self.assertEqual(PitchSettings().silenceTresholdForNoteChecking, -60.0)
        self.assertEqual(PitchSettings.model_validate({"silenceThresholdDb": -42.0}).silenceTresholdForNoteChecking, -60.0)
        with self.assertRaises(ValueError):
            PitchSettings(silenceTresholdForNoteChecking=1.0)

    def test_long_syllable_threshold_change_invalidates_only_alignment(self):
        job = self._job(pitch_settings=PitchSettings(checkNoteLongerThan=400))
        request = StageSettingsRequest(pitchSettings=PitchSettings(checkNoteLongerThan=650))

        self.assertEqual(routes._changed_stages_for_settings(job, "aligning", request), ["aligning"])

    def test_note_checking_silence_threshold_change_invalidates_only_alignment(self):
        job = self._job(pitch_settings=PitchSettings(silenceTresholdForNoteChecking=-60.0))
        request = StageSettingsRequest(pitchSettings=PitchSettings(silenceTresholdForNoteChecking=-66.0))

        self.assertEqual(routes._changed_stages_for_settings(job, "aligning", request), ["aligning"])

    def test_alignment_applies_and_summarizes_long_syllable_threshold(self):
        job = self._job(pitch_settings=PitchSettings(checkNoteLongerThan=400))
        request = StageSettingsRequest(pitchSettings=PitchSettings(checkNoteLongerThan=650, silenceTresholdForNoteChecking=-64.0))

        with patch.object(routes.repository, "update_job_config") as update_job_config:
            routes._apply_stage_settings(job, "aligning", request)

        saved_pitch_settings = update_job_config.call_args.kwargs["pitch_settings"]
        self.assertEqual(saved_pitch_settings.checkNoteLongerThan, 650)
        self.assertEqual(saved_pitch_settings.silenceTresholdForNoteChecking, -64.0)
        summary = routes._settings_summary_for_job(job.model_copy(update={"pitchSettings": saved_pitch_settings}), "aligning")
        self.assertEqual(summary["checkNoteLongerThan"], 650)
        self.assertEqual(summary["silenceTresholdForNoteChecking"], -64.0)

    def test_source_file_change_invalidates_all_audio_processing_stages(self):
        self.assertEqual(
            routes._stages_from("preprocessing"),
            ["preprocessing", "detecting_bpm", "separating_vocals", "transcribing", "detecting_pitch", "aligning"],
        )

    def test_resume_alignment_starts_from_missing_transcription(self):
        job = self._job()
        complete = {"preprocessing", "detecting_bpm", "separating_vocals"}

        with patch.object(routes, "_stage_has_complete_outputs", side_effect=lambda _job, stage: stage in complete):
            self.assertEqual(routes._resume_start_stage(job, "aligning"), "transcribing")

    def test_resume_alignment_starts_from_missing_pitch_detection(self):
        job = self._job()
        complete = {"preprocessing", "detecting_bpm", "separating_vocals", "transcribing"}

        with patch.object(routes, "_stage_has_complete_outputs", side_effect=lambda _job, stage: stage in complete):
            self.assertEqual(routes._resume_start_stage(job, "aligning"), "detecting_pitch")

    def test_invalidated_stage_does_not_keep_failure_message(self):
        snapshot = StageSnapshot(
            stage="aligning",
            substep="draft",
            status=StageStatus.failed,
            message="Wstepne dopasowanie nie powiodlo sie.",
            workerRole="worker-aligner",
            logExcerpt="missing pitch frames",
        )

        routes._reset_invalidated_snapshot(snapshot, clear_confirmation=False)

        self.assertEqual(snapshot.status, StageStatus.pending)
        self.assertEqual(snapshot.message, "Wstępne dopasowanie")
        self.assertIsNone(snapshot.logExcerpt)

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
        configuration_preset: str = DEFAULT_CONFIGURATION_PRESET,
        processing_mode: str = MANUAL_PROCESSING_MODE,
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
            configurationPreset=configuration_preset,
            processingMode=processing_mode,
            transcriptionSettings=transcription_settings or TranscriptionSettings(),
            pitchSettings=pitch_settings or PitchSettings(),
            syllabificationSettings=syllabification_settings or SyllabificationSettings(),
            processing=initial_processing(),
        )


if __name__ == "__main__":
    unittest.main()
