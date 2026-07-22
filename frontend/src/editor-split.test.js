import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSplitPoint } from "./editor-split.js";

const item = { startSec: 1, endSec: 2 };

test("rejects a playhead outside the selected item", () => {
  assert.deepEqual(evaluateSplitPoint(item, 0.999), { status: "outside", splitSec: 0.999 });
  assert.deepEqual(evaluateSplitPoint(item, 2.001), { status: "outside", splitSec: 2.001 });
});

test("treats item boundaries and the inclusive 20 ms margin as too close", () => {
  assert.equal(evaluateSplitPoint(item, 1).status, "near_edge");
  assert.equal(evaluateSplitPoint(item, 1.02).status, "near_edge");
  assert.equal(evaluateSplitPoint(item, 1.98).status, "near_edge");
  assert.equal(evaluateSplitPoint(item, 2).status, "near_edge");
});

test("accepts a split at least one stored millisecond beyond the edge margin", () => {
  assert.deepEqual(evaluateSplitPoint(item, 1.021), { status: "valid", splitSec: 1.021 });
  assert.deepEqual(evaluateSplitPoint(item, 1.979), { status: "valid", splitSec: 1.979 });
});

test("uses the editor's millisecond precision before validating the margin", () => {
  assert.equal(evaluateSplitPoint(item, 1.0204).status, "near_edge");
  assert.equal(evaluateSplitPoint(item, 1.0206).status, "valid");
});
