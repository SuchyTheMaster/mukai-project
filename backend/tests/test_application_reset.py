import unittest
from unittest.mock import call, patch

from pydantic import ValidationError

from app.api import routes
from app.domain.contracts import ApplicationResetRequest
from app.workers import stages


class ApplicationResetTest(unittest.TestCase):
    def test_reset_removes_job_and_upload_draft_by_default(self):
        request = ApplicationResetRequest(
            jobId="job_0123456789abcdef0123456789abcdef",
            uploadDraftId="draft_fedcba9876543210fedcba9876543210",
        )

        with patch.object(routes, "_delete_job_data") as delete_job_data, patch.object(routes, "purge_tree") as purge_tree:
            response = routes.reset_application(request)

        self.assertTrue(response.reset)
        delete_job_data.assert_called_once_with([request.jobId])
        purge_tree.assert_called_once_with(f"drafts/{request.uploadDraftId}")

    def test_reset_can_detach_and_keep_job(self):
        request = ApplicationResetRequest(
            jobId="job_0123456789abcdef0123456789abcdef",
            uploadDraftId="draft_fedcba9876543210fedcba9876543210",
            deleteJob=False,
        )

        with patch.object(routes, "_delete_job_data") as delete_job_data, patch.object(routes, "purge_tree") as purge_tree:
            response = routes.reset_application(request)

        self.assertTrue(response.reset)
        delete_job_data.assert_not_called()
        purge_tree.assert_called_once_with(f"drafts/{request.uploadDraftId}")

    def test_reset_without_identifiers_is_idempotent(self):
        with patch.object(routes, "_delete_job_data") as delete_job_data, patch.object(routes, "purge_tree") as purge_tree:
            response = routes.reset_application(ApplicationResetRequest())

        self.assertTrue(response.reset)
        delete_job_data.assert_not_called()
        purge_tree.assert_not_called()

    def test_reset_rejects_paths_in_identifiers(self):
        with self.assertRaises(ValidationError):
            ApplicationResetRequest(jobId="../jobs/job_other")

    def test_worker_cleans_files_after_job_was_deleted(self):
        job_id = "job_0123456789abcdef0123456789abcdef"
        with patch.object(stages.repository, "get_job", return_value=None), patch.object(stages, "purge_tree") as purge_tree:
            stages.cleanup_deleted_job_files(job_id)

        purge_tree.assert_called_once_with(f"jobs/{job_id}")


if __name__ == "__main__":
    unittest.main()
