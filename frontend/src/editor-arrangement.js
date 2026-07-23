function tokenWordId(token) {
  return token?.wordId || token?.tokenId || null;
}

function tokensById(arrangement) {
  return new Map((arrangement?.tokens ?? []).map((token) => [token.tokenId, token]));
}

function lineWords(arrangement, line, tokenMap = tokensById(arrangement)) {
  const words = [];
  for (const tokenId of line?.tokenIds ?? []) {
    const token = tokenMap.get(tokenId);
    if (!token) continue;
    const wordId = tokenWordId(token);
    const previous = words.at(-1);
    if (previous?.wordId === wordId) {
      previous.tokenIds.push(tokenId);
    } else {
      words.push({ wordId, tokenIds: [tokenId] });
    }
  }
  return words;
}

function temporalLines(arrangement) {
  return (arrangement?.lines ?? [])
    .map((line, index) => ({ line, index }))
    .sort((left, right) => {
      const startDifference = Number(left.line.startSec) - Number(right.line.startSec);
      return Number.isFinite(startDifference) && startDifference !== 0
        ? startDifference
        : left.index - right.index;
    })
    .map(({ line }) => line);
}

export function sortSentenceSyllablesByStart(arrangement) {
  if (!arrangement) return arrangement;
  const tokenMap = tokensById(arrangement);
  for (const line of arrangement.lines ?? []) {
    line.tokenIds = (line.tokenIds ?? [])
      .map((tokenId, index) => ({ tokenId, index, token: tokenMap.get(tokenId) }))
      .sort((left, right) => {
        const leftStart = Number(left.token?.startSec);
        const rightStart = Number(right.token?.startSec);
        if (Number.isFinite(leftStart) && Number.isFinite(rightStart) && leftStart !== rightStart) {
          return leftStart - rightStart;
        }
        if (Number.isFinite(leftStart) !== Number.isFinite(rightStart)) {
          return Number.isFinite(leftStart) ? -1 : 1;
        }
        return left.index - right.index;
      })
      .map(({ tokenId }) => tokenId);
  }
  return arrangement;
}

export function wordSegmentRenderKey(word, segmentIndex = 0) {
  return word?.tokens?.[0]?.tokenId
    ?? word?.tokenIds?.[0]
    ?? `${word?.wordId ?? "word"}:${segmentIndex}`;
}

export function boundaryWordDropTargets(arrangement, sourceWordId) {
  if (!arrangement || !sourceWordId) return [];
  const tokenMap = tokensById(arrangement);
  const lines = temporalLines(arrangement);
  const sourceLineIndex = lines.findIndex((line) => lineWords(arrangement, line, tokenMap).some((word) => word.wordId === sourceWordId));
  if (sourceLineIndex === -1) return [];

  const sourceLine = lines[sourceLineIndex];
  const words = lineWords(arrangement, sourceLine, tokenMap);
  const sourceWordIndex = words.findIndex((word) => word.wordId === sourceWordId);
  if (sourceWordIndex === -1) return [];

  const sourceWord = words[sourceWordIndex];
  const targets = [];
  const previousLine = lines[sourceLineIndex - 1];
  const nextLine = lines[sourceLineIndex + 1];

  if (sourceWordIndex === 0 && previousLine) {
    targets.push({
      sourceLineId: sourceLine.lineId,
      targetLineId: previousLine.lineId,
      position: "end",
      sourceTokenIds: [...sourceWord.tokenIds],
    });
  }
  if (sourceWordIndex === words.length - 1 && nextLine) {
    targets.push({
      sourceLineId: sourceLine.lineId,
      targetLineId: nextLine.lineId,
      position: "start",
      sourceTokenIds: [...sourceWord.tokenIds],
    });
  }
  return targets;
}

export function draggableBoundaryWordIds(arrangement) {
  const result = new Set();
  const tokenMap = tokensById(arrangement);
  const lines = temporalLines(arrangement);
  lines.forEach((line, lineIndex) => {
    const words = lineWords(arrangement, line, tokenMap);
    if (lineIndex > 0 && words[0]?.wordId) result.add(words[0].wordId);
    if (lineIndex < lines.length - 1 && words.at(-1)?.wordId) result.add(words.at(-1).wordId);
  });
  return result;
}

export function getBoundaryWordDrop(arrangement, sourceWordId, targetLineId) {
  return boundaryWordDropTargets(arrangement, sourceWordId)
    .find((target) => target.targetLineId === targetLineId) ?? null;
}

function recalculateLineBounds(line, tokenMap) {
  const tokens = (line?.tokenIds ?? []).map((tokenId) => tokenMap.get(tokenId)).filter(Boolean);
  if (!tokens.length) return;
  line.startSec = Math.min(...tokens.map((token) => token.startSec));
  line.endSec = Math.max(...tokens.map((token) => token.endSec));
}

export function moveBoundaryWordToAdjacentSentence(arrangement, sourceWordId, targetLineId) {
  const drop = getBoundaryWordDrop(arrangement, sourceWordId, targetLineId);
  if (!drop) return arrangement;

  const sourceLine = arrangement.lines.find((line) => line.lineId === drop.sourceLineId);
  const targetLine = arrangement.lines.find((line) => line.lineId === drop.targetLineId);
  if (!sourceLine || !targetLine) return arrangement;

  const movedTokenIds = new Set(drop.sourceTokenIds);
  sourceLine.tokenIds = sourceLine.tokenIds.filter((tokenId) => !movedTokenIds.has(tokenId));
  targetLine.tokenIds = drop.position === "start"
    ? [...drop.sourceTokenIds, ...targetLine.tokenIds]
    : [...targetLine.tokenIds, ...drop.sourceTokenIds];

  const tokenMap = tokensById(arrangement);
  recalculateLineBounds(targetLine, tokenMap);
  if (sourceLine.tokenIds.length) {
    recalculateLineBounds(sourceLine, tokenMap);
  } else {
    arrangement.lines = arrangement.lines.filter((line) => line.lineId !== sourceLine.lineId);
  }
  return arrangement;
}
