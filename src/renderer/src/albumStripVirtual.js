/** Strip (comic) virtualization + scrub math. No React. */

export const STRIP_GAP_PX = 2;
export const STRIP_DEFAULT_ASPECT = 3 / 4; // width / height
export const STRIP_OVERSCAN = 3;

export function defaultStripItemHeight(columnWidth) {
  const w = Math.max(1, Number(columnWidth) || 1);
  return w / STRIP_DEFAULT_ASPECT;
}

/** Cumulative offsets: offsets[i] = top of item i; offsets[count] = total height. */
export function buildStripOffsets(count, getHeight, gap = STRIP_GAP_PX) {
  const n = Math.max(0, count | 0);
  const offsets = new Float64Array(n + 1);
  let y = 0;
  for (let i = 0; i < n; i += 1) {
    offsets[i] = y;
    y += Math.max(1, getHeight(i));
    if (i < n - 1) y += gap;
  }
  offsets[n] = y;
  return offsets;
}

export function stripTotalHeight(offsets) {
  return offsets?.length ? offsets[offsets.length - 1] : 0;
}

/** Largest i with offsets[i] <= y (clamped to last item). */
export function findStripIndexAtOffset(offsets, y) {
  const n = (offsets?.length || 1) - 1;
  if (n <= 0) return 0;
  let lo = 0;
  let hi = n - 1;
  const target = Math.max(0, y);
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Visible window with overscan. padTop/padBottom keep total scroll height stable
 * when only items [start..end] are mounted (container uses column gap).
 */
export function computeStripWindow({
  scrollTop,
  viewportHeight,
  itemCount,
  offsets,
  overscan = STRIP_OVERSCAN,
  gap = STRIP_GAP_PX,
}) {
  const n = Math.max(0, itemCount | 0);
  if (!n || !offsets || offsets.length < n + 1) {
    return { start: 0, end: -1, padTop: 0, padBottom: 0 };
  }
  const vh = Math.max(1, viewportHeight || 1);
  const top = Math.max(0, scrollTop || 0);
  const bottom = top + vh;
  let start = findStripIndexAtOffset(offsets, top);
  let end = findStripIndexAtOffset(offsets, bottom);
  start = Math.max(0, start - overscan);
  end = Math.min(n - 1, end + overscan);
  const padTop = offsets[start];
  // Bottom edge of item `end` (exclude trailing gap before next item).
  const endBottom = end < n - 1 ? offsets[end + 1] - gap : offsets[n];
  const padBottom = Math.max(0, offsets[n] - endBottom);
  return { start, end, padTop, padBottom };
}

export function scrubRatioToIndex(ratio, total) {
  const n = Math.max(0, total | 0);
  if (n <= 1) return 0;
  const r = Math.min(1, Math.max(0, Number(ratio) || 0));
  return Math.max(0, Math.min(n - 1, Math.round(r * (n - 1))));
}

export function indexToScrubRatio(index, total) {
  const n = Math.max(0, total | 0);
  if (n <= 1) return 0;
  const i = Math.max(0, Math.min(n - 1, index | 0));
  return i / (n - 1);
}

export function stripIndexFromScroll(offsets, scrollTop, viewportHeight) {
  const n = (offsets?.length || 1) - 1;
  if (n <= 0) return 0;
  const mid = Math.max(0, scrollTop) + Math.max(1, viewportHeight) * 0.35;
  return findStripIndexAtOffset(offsets, mid);
}

export function scrollTopForIndex(offsets, index) {
  const n = (offsets?.length || 1) - 1;
  if (n <= 0) return 0;
  const i = Math.max(0, Math.min(n - 1, index | 0));
  return offsets[i];
}
