import { test } from "node:test";
import assert from "node:assert/strict";
import { persistAlbumLayout, readStoredAlbumLayout } from "../../src/renderer/src/albumLayout.js";

function withStore(map, run) {
  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
  try { run(); } finally { globalThis.localStorage = original; }
}

test("wikiAlbumView grid and strip are kept", () => {
  withStore(new Map([["wikiAlbumView", "grid"]]), () => {
    assert.equal(readStoredAlbumLayout(), "grid");
  });
  withStore(new Map([["wikiAlbumView", "strip"]]), () => {
    assert.equal(readStoredAlbumLayout(), "strip");
  });
});

test("legacy wall / justified / 等比 / 齐行 fall back to grid", () => {
  for (const raw of ["wall", "justified", "等比", "齐行", "preview", ""]) {
    withStore(new Map([["wikiAlbumView", raw]]), () => {
      assert.equal(readStoredAlbumLayout(), "grid", raw);
    });
  }
  withStore(new Map(), () => {
    assert.equal(readStoredAlbumLayout(), "grid");
  });
});

test("persistAlbumLayout only writes grid or strip", () => {
  const store = new Map();
  withStore(store, () => {
    persistAlbumLayout("strip");
    assert.equal(store.get("wikiAlbumView"), "strip");
    persistAlbumLayout("grid");
    assert.equal(store.get("wikiAlbumView"), "grid");
    persistAlbumLayout("wall");
    assert.equal(store.get("wikiAlbumView"), "grid");
  });
});
