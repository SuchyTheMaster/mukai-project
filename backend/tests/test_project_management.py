import json
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, call, patch

from app.api import routes
from app.core.errors import ApiError
from app.domain.contracts import DeleteJobsRequest
from app.services import queue


JOB_A = "job_0123456789abcdef0123456789abcdef"
JOB_B = "job_fedcba9876543210fedcba9876543210"


class ProjectManagementTest(unittest.TestCase):
    def test_catalog_reports_furthest_completed_stage(self):
        now = datetime(2026, 7, 22, tzinfo=timezone.utc)
        row = {
            "job_id": JOB_A,
            "source_filename": "song.flac",
            "created_at": now,
            "updated_at": now,
            "has_arrangement": False,
            "processing": {
                "uploaded.source": {"stage": "uploaded", "status": "completed"},
                "preprocessing.ffmpeg": {"stage": "preprocessing", "status": "completed"},
                "detecting_bpm.essentia": {"stage": "detecting_bpm", "status": "failed"},
            },
        }

        with patch.object(routes.repository, "list_jobs", return_value=[row]):
            catalog = routes.get_jobs()

        self.assertEqual(len(catalog.jobs), 1)
        self.assertEqual(catalog.jobs[0].sourceFilename, "song.flac")
        self.assertEqual(catalog.jobs[0].furthestCompletedStage, "preprocessing")

    def test_catalog_treats_existing_arrangement_as_completed_alignment(self):
        now = datetime(2026, 7, 22, tzinfo=timezone.utc)
        row = {
            "job_id": JOB_A,
            "source_filename": "song.flac",
            "created_at": now,
            "updated_at": now,
            "has_arrangement": True,
            "processing": {
                "aligning.draft": {"stage": "aligning", "status": "pending"},
            },
        }

        with patch.object(routes.repository, "list_jobs", return_value=[row]):
            catalog = routes.get_jobs()

        self.assertEqual(catalog.jobs[0].furthestCompletedStage, "aligning")

    def test_delete_rejects_active_job_without_side_effects(self):
        request = DeleteJobsRequest(jobIds=[JOB_A, JOB_B], activeJobId=JOB_A)

        with patch.object(routes, "_delete_job_data") as delete_job_data:
            with self.assertRaises(ApiError) as raised:
                routes.delete_jobs(request)

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.code, "active_job_delete_forbidden")
        delete_job_data.assert_not_called()

    def test_delete_cleans_database_queues_and_artifacts(self):
        with (
            patch.object(routes.repository, "delete_jobs", return_value=[JOB_A, JOB_B]) as delete_jobs,
            patch.object(routes, "remove_jobs_from_queues") as remove_jobs,
            patch.object(routes, "purge_tree") as purge_tree,
        ):
            deleted = routes._delete_job_data([JOB_A, JOB_A, JOB_B])

        self.assertEqual(deleted, [JOB_A, JOB_B])
        delete_jobs.assert_called_once_with([JOB_A, JOB_B])
        remove_jobs.assert_called_once_with([JOB_A, JOB_B])
        self.assertEqual(purge_tree.call_args_list, [call(f"jobs/{JOB_A}"), call(f"jobs/{JOB_B}")])

    def test_delete_cleanup_is_idempotent_when_database_rows_are_missing(self):
        with (
            patch.object(routes.repository, "delete_jobs", return_value=[]),
            patch.object(routes, "remove_jobs_from_queues") as remove_jobs,
            patch.object(routes, "purge_tree") as purge_tree,
        ):
            deleted = routes._delete_job_data([JOB_A])

        self.assertEqual(deleted, [])
        remove_jobs.assert_called_once_with([JOB_A])
        purge_tree.assert_called_once_with(f"jobs/{JOB_A}")

    def test_delete_request_deduplicates_job_ids(self):
        request = DeleteJobsRequest(jobIds=[JOB_A, JOB_A, JOB_B], activeJobId=None)
        self.assertEqual(request.jobIds, [JOB_A, JOB_B])


class QueueCleanupTest(unittest.TestCase):
    def test_removes_only_messages_for_selected_jobs(self):
        selected = json.dumps({"jobId": JOB_A, "startStage": "preprocessing"})
        other = json.dumps({"jobId": JOB_B, "startStage": "preprocessing"})
        pipeline = MagicMock()
        client = MagicMock()
        client.lrange.side_effect = [[selected, other, "not-json"], [], [], []]
        client.pipeline.return_value = pipeline

        with patch.object(queue, "redis_client", return_value=client):
            queue.remove_jobs_from_queues([JOB_A])

        pipeline.lrem.assert_called_once_with("mukai:jobs", 0, selected)
        pipeline.execute.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
