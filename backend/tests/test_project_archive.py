import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from app.domain.contracts import (
    AudioAsset,
    Job,
    JobStatus,
    ModelProfiles,
    SourceMetadata,
    StageStatus,
    initial_processing,
    utc_now,
)
from app.services import project_archive


class ProjectArchiveTest(unittest.TestCase):
    def test_running_stage_becomes_auto_resume_checkpoint(self):
        processing = initial_processing()
        processing["uploaded.source"].status = StageStatus.completed
        processing["separating_vocals.demucs"].status = StageStatus.running
        source = self._asset("source", "source_audio", "uploaded")
        partial = self._asset("partial", "vocals", "separating_vocals")
        job = self._job(JobStatus.preprocessing, processing, [source, partial])

        checkpoint, assets, resume = project_archive._checkpoint_job(job)

        self.assertEqual(resume, {"mode": "auto", "resumeStage": "preprocessing"})
        self.assertEqual({asset.assetId for asset in assets}, {"asset_source"})
        self.assertEqual(checkpoint.processing["separating_vocals.demucs"].status, StageStatus.pending)

    def test_action_required_stage_is_restored_without_auto_resume(self):
        processing = initial_processing()
        processing["uploaded.source"].status = StageStatus.completed
        processing["separating_vocals.demucs"].actionRequired = True
        processing["preprocessing.ffmpeg"].actionRequired = True
        job = self._job(JobStatus.preprocessing, processing, [self._asset("source", "source_audio", "uploaded")])

        _, _, resume = project_archive._checkpoint_job(job)

        self.assertEqual(resume, {"mode": "manual", "resumeStage": "preprocessing"})

    def test_completed_stage_without_required_artifacts_is_rejected(self):
        processing = initial_processing()
        processing["uploaded.source"].status = StageStatus.completed
        processing["preprocessing.ffmpeg"].status = StageStatus.completed
        job = self._job(JobStatus.detecting_bpm, processing, [self._asset("source", "source_audio", "uploaded")])

        with self.assertRaises(Exception):
            project_archive._checkpoint_job(job)

    def test_archive_keeps_working_and_editor_state_and_verifies_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.mp3"
            source.write_bytes(b"audio")
            entry = project_archive._file_entry(source, "source/source.mp3", "source_audio")
            working = {"metadata": {"title": "Roboczy"}, "stageForms": {"transcribing": {"vadMethod": "silero"}}}
            editor = {"past": [{"revision": 1}], "zoomSec": 12, "snapThresholdMs": 20}
            manifest = project_archive._manifest(
                project_id="proj_test",
                phase="draft",
                applied_state={"inspection": {}},
                working_state=working,
                editor_workspace=editor,
                resume={"mode": "manual", "resumeStage": None},
                entries=[entry],
            )
            archive_path = root / "project.zip"
            project_archive._write_archive(archive_path, {"mukai-project.json": manifest}, [(source, entry)])

            with zipfile.ZipFile(archive_path) as archive:
                restored = project_archive._read_manifest(archive)
                project_archive._verify_manifest_files(archive, restored)

            self.assertEqual(restored["workingState"], working)
            self.assertEqual(restored["editorWorkspace"], editor)

    def test_hash_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "project.zip"
            entry = {"role": "source_audio", "archivePath": "source/a.mp3", "sha256": hashlib.sha256(b"other").hexdigest(), "sizeBytes": 5}
            manifest = project_archive._manifest(
                project_id="proj_test",
                phase="draft",
                applied_state={},
                working_state={},
                editor_workspace=None,
                resume={"mode": "manual", "resumeStage": None},
                entries=[entry],
            )
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("mukai-project.json", json.dumps(manifest))
                archive.writestr("source/a.mp3", b"audio")
            with zipfile.ZipFile(archive_path) as archive:
                with self.assertRaises(Exception):
                    project_archive._verify_manifest_files(archive, manifest)

    def test_unsafe_archive_path_is_rejected(self):
        for path in ["../secret", "/absolute", "folder\\file"]:
            with self.subTest(path=path), self.assertRaises(Exception):
                project_archive._validate_archive_path(path)

    @staticmethod
    def _asset(suffix: str, asset_type: str, stage: str) -> AudioAsset:
        return AudioAsset(
            assetId=f"asset_{suffix}",
            type=asset_type,
            path=f"jobs/job_test/{suffix}",
            producedByStage=stage,
            producedBySubstep="test",
        )

    @staticmethod
    def _job(status, processing, artifacts) -> Job:
        return Job(
            jobId="job_test",
            status=status,
            createdAt=utc_now(),
            updatedAt=utc_now(),
            metadata=SourceMetadata(title="Song", artist="Artist"),
            profiles=ModelProfiles(),
            processing=processing,
            artifacts=artifacts,
        )


if __name__ == "__main__":
    unittest.main()
