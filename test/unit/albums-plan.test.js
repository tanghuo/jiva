import { test } from "node:test";
import assert from "node:assert/strict";
import { planAlbumFolders, albumFolderTitle, parentFolderTag } from "../../src/shared/domain/albums.js";

test("planAlbumFolders uses deepest image dirs as albums and only immediate parent as tag candidate", () => {
  const albums = planAlbumFolders([
    { relativePath: "Alice/冬日礼服/01.jpg", fileName: "01.jpg" },
    { relativePath: "Alice/冬日礼服/02.jpg", fileName: "02.jpg" },
    { relativePath: "Alice/夏日/a.png", fileName: "a.png" },
    { relativePath: "solo.webp", fileName: "solo.webp" },
  ]);
  assert.equal(albums.length, 3);
  const winter = albums.find((album) => album.title === "冬日礼服");
  assert.ok(winter);
  assert.equal(winter.parentTag, "Alice");
  assert.equal(winter.files.length, 2);
  const summer = albums.find((album) => album.title === "夏日");
  assert.equal(summer.parentTag, "Alice");
  const solo = albums.find((album) => album.dir === "");
  assert.equal(solo.parentTag, null);
  assert.equal(albumFolderTitle("Alice/冬日礼服"), "冬日礼服");
  assert.equal(parentFolderTag("Alice/冬日礼服/x.jpg"), "Alice");
});

test("natural-ish file order inside a planned album", () => {
  const [album] = planAlbumFolders([
    { relativePath: "set/10.jpg", fileName: "10.jpg" },
    { relativePath: "set/2.jpg", fileName: "2.jpg" },
    { relativePath: "set/1.jpg", fileName: "1.jpg" },
  ]);
  assert.deepEqual(album.files.map((file) => file.fileName), ["1.jpg", "2.jpg", "10.jpg"]);
});
