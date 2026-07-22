export const SPLIT_EDGE_MARGIN_SEC = 0.02;

export function evaluateSplitPoint(item, playheadSec, edgeMarginSec = SPLIT_EDGE_MARGIN_SEC) {
  const startSec = Number(item?.startSec);
  const endSec = Number(item?.endSec);
  const numericPlayhead = Number(playheadSec);
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec || !Number.isFinite(numericPlayhead)) {
    return { status: "outside", splitSec: null };
  }

  const splitSec = Number(Math.max(0, numericPlayhead).toFixed(3));
  if (splitSec < startSec || splitSec > endSec) return { status: "outside", splitSec };

  const margin = Math.max(0, Number(edgeMarginSec) || 0);
  const comparisonEpsilon = 1e-9;
  if (splitSec - startSec <= margin + comparisonEpsilon || endSec - splitSec <= margin + comparisonEpsilon) {
    return { status: "near_edge", splitSec };
  }
  return { status: "valid", splitSec };
}
