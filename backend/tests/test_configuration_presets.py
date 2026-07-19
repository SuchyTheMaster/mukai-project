import unittest
from unittest.mock import patch

from app.api import routes
from app.core.errors import ApiError
from app.domain.contracts import (
    Job,
    JobStatus,
    ModelProfiles,
    OverwriteConfigurationPresetRequest,
    PitchSettings,
    SaveConfigurationPresetRequest,
    SourceMetadata,
    SyllabificationSettings,
    TranscriptionSettings,
    initial_processing,
    utc_now,
)
from app.services import configuration_presets


class ConfigurationPresetServiceTest(unittest.TestCase):
    def tearDown(self):
        configuration_presets.load_default_preset_document.cache_clear()

    def test_default_preset_file_is_complete_and_language_aware(self):
        document = configuration_presets.load_default_preset_document()
        polish = configuration_presets.default_configuration("pl")
        english = configuration_presets.default_configuration("en")

        self.assertEqual(document["presetId"], "default")
        self.assertEqual(polish.syllabificationSettings.method, "kokosznicka")
        self.assertEqual(english.syllabificationSettings.method, "pyphen")

    def test_partial_preset_uses_default_and_reports_leaf_paths(self):
        row = {
            "preset_id": "preset_test",
            "name": "Starszy preset",
            "preset_type": "custom",
            "configuration": {"pitchSettings": {"periodicityThreshold": 0.4}},
        }
        with patch.object(configuration_presets.repository, "get_configuration_preset", return_value=row):
            resolved = configuration_presets.resolve_configuration_preset("preset_test", "pl")

        self.assertEqual(resolved.configuration.pitchSettings.periodicityThreshold, 0.4)
        self.assertEqual(resolved.configuration.pitchSettings.frameStepMs, 10)
        self.assertIn("pitchSettings.frameStepMs", resolved.fallback_fields)
        self.assertNotIn("pitchSettings.periodicityThreshold", resolved.fallback_fields)
        self.assertEqual(resolved.configuration.syllabificationSettings.method, "kokosznicka")

    def test_invalid_present_value_blocks_preset(self):
        row = {
            "preset_id": "preset_test",
            "name": "Błędny preset",
            "preset_type": "custom",
            "configuration": {"pitchSettings": {"frameStepMs": "nie-liczba"}},
        }
        with patch.object(configuration_presets.repository, "get_configuration_preset", return_value=row):
            with self.assertRaises(configuration_presets.PresetConfigurationError):
                configuration_presets.resolve_configuration_preset("preset_test", None)


class ConfigurationPresetRoutesTest(unittest.TestCase):
    def test_existing_custom_name_returns_conflict(self):
        existing = {"preset_id": "preset_existing", "name": "Mój preset", "preset_type": "custom", "configuration": {}}
        with patch.object(routes, "_completed_job_for_preset", return_value=self._job()), patch.object(routes.repository, "find_custom_configuration_preset_by_name", return_value=existing):
            with self.assertRaises(ApiError) as raised:
                routes.create_configuration_preset(SaveConfigurationPresetRequest(sourceJobId="job_test", name="mÓj   PRESET"))

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.code, "custom_preset_name_exists")
        self.assertEqual(raised.exception.details["presetId"], "preset_existing")

    def test_predefined_name_does_not_block_custom_creation(self):
        created = {"preset_id": "preset_new", "name": "Studyjny", "preset_type": "custom", "configuration": {}}
        with patch.object(routes, "_completed_job_for_preset", return_value=self._job()), patch.object(routes.repository, "find_custom_configuration_preset_by_name", return_value=None), patch.object(routes.repository, "create_configuration_preset", return_value=created):
            result = routes.create_configuration_preset(SaveConfigurationPresetRequest(sourceJobId="job_test", name="Studyjny"))

        self.assertEqual(result.presetType, "custom")
        self.assertTrue(result.canOverwrite)

    def test_predefined_preset_cannot_be_overwritten(self):
        predefined = {"preset_id": "preset_builtin", "name": "Studyjny", "preset_type": "predefined", "configuration": {}}
        with patch.object(routes, "_completed_job_for_preset", return_value=self._job()), patch.object(routes.repository, "get_configuration_preset", return_value=predefined):
            with self.assertRaises(ApiError) as raised:
                routes.overwrite_configuration_preset("preset_builtin", OverwriteConfigurationPresetRequest(sourceJobId="job_test"))

        self.assertEqual(raised.exception.status_code, 403)

    def test_only_custom_preset_can_be_deleted(self):
        custom = {"preset_id": "preset_custom", "name": "Mój", "preset_type": "custom", "configuration": {}}
        with patch.object(routes.repository, "get_configuration_preset", return_value=custom), patch.object(routes.repository, "delete_configuration_preset", return_value=True) as delete_preset:
            result = routes.delete_configuration_preset("preset_custom")

        self.assertTrue(result["deleted"])
        delete_preset.assert_called_once_with("preset_custom")

    def test_only_explicitly_edited_fallbacks_are_removed(self):
        job = self._job()
        job.configurationFallbackFields = ["profiles.pitch", "pitchSettings.frameStepMs"]
        with patch.object(routes.repository, "update_configuration_fallback_fields") as update_fields:
            routes._clear_edited_configuration_fallbacks(job, "detecting_pitch", ["profiles.pitch"])

        update_fields.assert_called_once_with("job_test", ["pitchSettings.frameStepMs"])

    @staticmethod
    def _job() -> Job:
        return Job(
            jobId="job_test",
            status=JobStatus.awaiting_review,
            createdAt=utc_now(),
            updatedAt=utc_now(),
            metadata=SourceMetadata(title="Song", artist="Artist"),
            profiles=ModelProfiles(),
            transcriptionSettings=TranscriptionSettings(),
            pitchSettings=PitchSettings(),
            syllabificationSettings=SyllabificationSettings(),
            processing=initial_processing(),
        )


if __name__ == "__main__":
    unittest.main()
