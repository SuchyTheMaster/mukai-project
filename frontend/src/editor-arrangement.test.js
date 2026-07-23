import test from "node:test";
import assert from "node:assert/strict";
import {
  boundaryWordDropTargets,
  draggableBoundaryWordIds,
  getBoundaryWordDrop,
  moveBoundaryWordToAdjacentSentence,
  sortSentenceSyllablesByStart,
  wordSegmentRenderKey,
} from "./editor-arrangement.js";

function token(tokenId, wordId, startSec, endSec) {
  return {
    tokenId,
    wordId,
    text: tokenId,
    startSec,
    endSec,
    midi: 60,
    qualityFlags: [],
  };
}

function arrangementFixture() {
  return {
    lines: [
      { lineId: "line-a", startSec: 1, endSec: 2, tokenIds: ["a1"] },
      { lineId: "line-b", startSec: 3, endSec: 6, tokenIds: ["b1", "b2", "b3"] },
      { lineId: "line-c", startSec: 7, endSec: 8, tokenIds: ["c1"] },
    ],
    tokens: [
      token("a1", "word-a", 1, 2),
      token("b1", "word-b-first", 3, 4),
      token("b2", "word-b-middle", 4, 5),
      token("b3", "word-b-last", 5, 6),
      token("c1", "word-c", 7, 8),
    ],
  };
}

test("allows only the first word to move backward and the last word to move forward", () => {
  const arrangement = arrangementFixture();

  assert.deepEqual(boundaryWordDropTargets(arrangement, "word-b-first").map(({ targetLineId, position }) => ({ targetLineId, position })), [
    { targetLineId: "line-a", position: "end" },
  ]);
  assert.deepEqual(boundaryWordDropTargets(arrangement, "word-b-last").map(({ targetLineId, position }) => ({ targetLineId, position })), [
    { targetLineId: "line-c", position: "start" },
  ]);
  assert.deepEqual(boundaryWordDropTargets(arrangement, "word-b-middle"), []);
  assert.deepEqual([...draggableBoundaryWordIds(arrangement)], ["word-a", "word-b-first", "word-b-last", "word-c"]);
  assert.equal(getBoundaryWordDrop(arrangement, "word-b-first", "line-c"), null);
});

test("moves a boundary word without changing syllable data and recalculates only affected bounds", () => {
  const arrangement = arrangementFixture();
  const tokenBefore = structuredClone(arrangement.tokens.find((item) => item.tokenId === "b1"));
  const untouchedLineBefore = structuredClone(arrangement.lines[2]);

  moveBoundaryWordToAdjacentSentence(arrangement, "word-b-first", "line-a");

  assert.deepEqual(arrangement.lines[0], { lineId: "line-a", startSec: 1, endSec: 4, tokenIds: ["a1", "b1"] });
  assert.deepEqual(arrangement.lines[1], { lineId: "line-b", startSec: 4, endSec: 6, tokenIds: ["b2", "b3"] });
  assert.deepEqual(arrangement.lines[2], untouchedLineBefore);
  assert.deepEqual(arrangement.tokens.find((item) => item.tokenId === "b1"), tokenBefore);
});

test("prepends the last word to the next sentence", () => {
  const arrangement = arrangementFixture();

  moveBoundaryWordToAdjacentSentence(arrangement, "word-b-last", "line-c");

  assert.deepEqual(arrangement.lines[1], { lineId: "line-b", startSec: 3, endSec: 5, tokenIds: ["b1", "b2"] });
  assert.deepEqual(arrangement.lines[2], { lineId: "line-c", startSec: 5, endSec: 8, tokenIds: ["b3", "c1"] });
});

test("removes a sentence after moving its only word", () => {
  const arrangement = arrangementFixture();

  moveBoundaryWordToAdjacentSentence(arrangement, "word-a", "line-b");

  assert.deepEqual(arrangement.lines.map((line) => line.lineId), ["line-b", "line-c"]);
  assert.deepEqual(arrangement.lines[0], {
    lineId: "line-b",
    startSec: 1,
    endSec: 6,
    tokenIds: ["a1", "b1", "b2", "b3"],
  });
});

test("allows the only word of a middle sentence to move to either neighbor", () => {
  const arrangement = {
    lines: [
      { lineId: "line-a", startSec: 1, endSec: 2, tokenIds: ["a1"] },
      { lineId: "line-b", startSec: 3, endSec: 4, tokenIds: ["b1"] },
      { lineId: "line-c", startSec: 5, endSec: 6, tokenIds: ["c1"] },
    ],
    tokens: [
      token("a1", "word-a", 1, 2),
      token("b1", "word-b", 3, 4),
      token("c1", "word-c", 5, 6),
    ],
  };

  assert.deepEqual(boundaryWordDropTargets(arrangement, "word-b").map(({ targetLineId, position }) => ({ targetLineId, position })), [
    { targetLineId: "line-a", position: "end" },
    { targetLineId: "line-c", position: "start" },
  ]);
});

test("ignores a drop on a non-adjacent or wrong-direction sentence", () => {
  const arrangement = arrangementFixture();
  const before = structuredClone(arrangement);

  moveBoundaryWordToAdjacentSentence(arrangement, "word-b-first", "line-c");
  moveBoundaryWordToAdjacentSentence(arrangement, "word-b-middle", "line-a");

  assert.deepEqual(arrangement, before);
});

test("sorts syllables by start time and preserves the previous order for ties", () => {
  const arrangement = {
    lines: [{ lineId: "line-a", startSec: 1, endSec: 4, tokenIds: ["late", "tie-a", "early", "tie-b"] }],
    tokens: [
      token("late", "word-a", 3, 4),
      token("tie-a", "word-a", 2, 3),
      token("early", "word-a", 1, 2),
      token("tie-b", "word-a", 2, 2.5),
    ],
  };

  sortSentenceSyllablesByStart(arrangement);

  assert.deepEqual(arrangement.lines[0].tokenIds, ["early", "tie-a", "tie-b", "late"]);
});

test("uses unique render keys for temporarily separated fragments of the same word", () => {
  const separated = [
    { wordId: "word-words", tokens: [{ tokenId: "wy" }] },
    { wordId: "word-to", tokens: [{ tokenId: "to" }] },
    { wordId: "word-words", tokens: [{ tokenId: "ra" }, { tokenId: "zy" }] },
  ];
  const separatedKeys = separated.map(wordSegmentRenderKey);
  const merged = { wordId: "word-words", tokens: [{ tokenId: "wy" }, { tokenId: "ra" }, { tokenId: "zy" }] };

  assert.deepEqual(separatedKeys, ["wy", "to", "ra"]);
  assert.equal(new Set(separatedKeys).size, separatedKeys.length);
  assert.equal(wordSegmentRenderKey(merged), "wy");
});
