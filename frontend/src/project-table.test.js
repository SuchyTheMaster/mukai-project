import test from "node:test";
import assert from "node:assert/strict";
import { filterProjects, selectableProjectIds, sortProjects } from "./project-table.js";

const projects = [
  { jobId: "job_2", sourceFilename: "Beta.flac", createdAt: "2026-07-21T10:00:00Z", updatedAt: "2026-07-22T08:00:00Z", furthestCompletedStage: "aligning" },
  { jobId: "job_1", sourceFilename: "alpha.wav", createdAt: "2026-07-20T10:00:00Z", updatedAt: "2026-07-21T08:00:00Z", furthestCompletedStage: "preprocessing" },
];

test("sorts project text, dates and pipeline stages", () => {
  assert.deepEqual(sortProjects(projects, { key: "sourceFilename", direction: "asc" }).map((item) => item.jobId), ["job_1", "job_2"]);
  assert.deepEqual(sortProjects(projects, { key: "updatedAt", direction: "desc" }).map((item) => item.jobId), ["job_2", "job_1"]);
  assert.deepEqual(sortProjects(projects, { key: "furthestCompletedStage", direction: "asc" }).map((item) => item.jobId), ["job_1", "job_2"]);
});

test("filters text and inclusive date ranges independently", () => {
  const filtered = filterProjects(projects, {
    jobId: "job",
    sourceFilename: "beta",
    furthestCompletedStage: "dopasowanie",
    createdFrom: "2026-07-21T09:00:00Z",
    createdTo: "2026-07-21T11:00:00Z",
    updatedFrom: "",
    updatedTo: "",
  }, (stage) => stage === "aligning" ? "Wstępne dopasowanie" : stage);
  assert.deepEqual(filtered.map((item) => item.jobId), ["job_2"]);
});

test("excludes the active project from selectable rows", () => {
  assert.deepEqual(selectableProjectIds(projects, "job_2"), ["job_1"]);
});
