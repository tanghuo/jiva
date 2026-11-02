import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STRIP_GAP_PX,
  buildStripOffsets,
  computeStripWindow,
  defaultStripItemHeight,
  findStripIndexAtOffset,
  indexToScrubRatio,
  scrubRatioToIndex,
  scrollTopForIndex,
  stripIndexFromScroll,
  stripTotalHeight,
} from "../../src/renderer/src/albumStripVirtual.js";

test("defaultStripItemHeight uses 3:4", () => {
  assert.equal(defaultStripItemHeight(300), 400);
});

test("buildStripOffsets accounts for gap and heights", () => {
  const offsets = buildStripOffsets(3, () => 100);
  assert.equal(offsets[0], 0);
  assert.equal(offsets[1], 100 + STRIP_GAP_PX);
  assert.equal(offsets[2], 2 * (100 + STRIP_GAP_PX));
  assert.equal(stripTotalHeight(offsets), 300 + 2 * STRIP_GAP_PX);
});

test("findStripIndexAtOffset binary search", () => {
  const offsets = buildStripOffsets(5, () => 100);
  assert.equal(findStripIndexAtOffset(offsets, 0), 0);
  assert.equal(findStripIndexAtOffset(offsets, 50), 0);
  assert.equal(findStripIndexAtOffset(offsets, 102), 1);
  assert.equal(findStripIndexAtOffset(offsets, 9999), 4);
});

test("computeStripWindow only covers viewport + overscan", () => {
  const count = 1000;
  const offsets = buildStripOffsets(count, () => 200);
  const win = computeStripWindow({
    scrollTop: 20000,
    viewportHeight: 800,
    itemCount: count,
    offsets,
    overscan: 10,
  });
  assert.ok(win.end - win.start + 1 < 80, `window too large: ${win.end - win.start + 1}`);
  assert.ok(win.start > 0);
  assert.ok(win.end < count - 1);
  const rendered = (win.end < count - 1 ? offsets[win.end + 1] - STRIP_GAP_PX : offsets[count]) - offsets[win.start];
  assert.ok(Math.abs(win.padTop + rendered + win.padBottom - offsets[count]) < 0.01);
});

test("scrubRatioToIndex / indexToScrubRatio round trip ends", () => {
  assert.equal(scrubRatioToIndex(0, 1000), 0);
  assert.equal(scrubRatioToIndex(1, 1000), 999);
  assert.equal(indexToScrubRatio(0, 1000), 0);
  assert.equal(indexToScrubRatio(999, 1000), 1);
  assert.equal(scrubRatioToIndex(0.5, 11), 5);
});

test("scroll helpers seek and read index", () => {
  const offsets = buildStripOffsets(10, () => 100);
  assert.equal(scrollTopForIndex(offsets, 3), offsets[3]);
  assert.equal(stripIndexFromScroll(offsets, offsets[3], 100), 3);
});
