import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DatabaseSync } from "node:sqlite";
import { initDb } from "../../src/server/data/sqlite.js";
import { migrateWiki, latestWikiVersion } from "../../src/server/data/wikiMigrations.js";
import { migrateAlbums } from "../../src/server/data/albumMigration.js";
import { createElementRepository } from "../../src/server/data/elementRepository.js";
import { createElementService } from "../../src/server/application/elementService.js";
import { createImageStore } from "../../src/server/assets/imageStore.js";
import { createOrganizationRepository } from "../../src/server/data/organizationRepository.js";

test("album migration widens kind check and creates album tables", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("PRAGMA foreign_keys=ON");
  // Build up to spaces, then albums via migrateWiki
  migrateWiki(db);
  assert.equal(db.prepare("SELECT max(version) AS v FROM wiki_schema").get().v, latestWikiVersion);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='album_meta'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='album_items'").get());
  const id = db.prepare("INSERT INTO elements(kind,body,created_at,updated_at,space_id) VALUES(6,'','now','now',1)").run().lastInsertRowid;
  db.prepare("INSERT INTO album_meta(element_id,title) VALUES(?,?)").run(id, "测试");
  assert.throws(() => db.exec("INSERT INTO elements(kind,body,created_at,updated_at,space_id) VALUES(6,'x','now','now',1)"), /CHECK/);
  migrateAlbums(db); // idempotent
});

test("album members stay out of library, skip AI jobs, trash with album, and parent tag attaches only to album", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wiki-albums-"));
  const db = initDb(":memory:");
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  const wiki = createElementService(createElementRepository(db), createImageStore(path.join(dir, "assets")));
  const org = createOrganizationRepository(db);
  db.prepare("UPDATE organization_state SET enabled=1").run();

  const album = wiki.createAlbum({ title: "冬日礼服", tags: ["Alice"], sourceUrl: "https://example.com/post" });
  assert.equal(album.kind, "album");
  assert.equal(album.album.title, "冬日礼服");
  assert.deepEqual(album.tags, ["Alice"]);

  const a = await sharp({ create: { width: 12, height: 10, channels: 3, background: "#336699" } }).png().toBuffer();
  const b = await sharp({ create: { width: 12, height: 10, channels: 3, background: "#993366" } }).png().toBuffer();
  const first = await wiki.importImage(a, "01.png", [], false, album.spaceId, album.id);
  const second = await wiki.importImage(b, "02.png", [], false, album.spaceId, album.id);
  assert.equal(first.importStatus, "album-member");
  assert.equal(second.kind, "album");

  const library = wiki.list({ scope: "library" });
  assert.equal(library.elements.filter((el) => el.kind === "image").length, 0);
  assert.equal(library.elements.filter((el) => el.kind === "album").length, 1);
  assert.equal(library.elements[0].album.itemCount, 2);

  const imagesOnly = wiki.list({ scope: "library", kind: "image" });
  assert.equal(imagesOnly.pagination.total, 0);

  const detail = wiki.albumItems(album.id);
  assert.equal(detail.items.length, 2);
  assert.equal(detail.items[0].tags.length, 0);

  const pending = db.prepare("SELECT count(*) AS n FROM organization_jobs WHERE element_id IN (SELECT image_id FROM album_items WHERE album_id=?) AND state IN (0,1)").get(album.id).n;
  assert.equal(pending, 0);
  const semantic = db.prepare("SELECT count(*) AS n FROM semantic_documents WHERE element_id IN (SELECT image_id FROM album_items WHERE album_id=?)").get(album.id).n;
  assert.equal(semantic, 0);

  wiki.removeAlbumItem(album.id, detail.items[0].id);
  assert.equal(wiki.albumItems(album.id).items.length, 1);
  assert.ok(db.prepare("SELECT deleted_at FROM elements WHERE id=?").get(detail.items[0].id).deleted_at);
  // Restored member remains an album member, still hidden from library.
  wiki.restore(detail.items[0].id);
  assert.equal(wiki.list({ scope: "library", kind: "image" }).pagination.total, 0);

  wiki.trash(album.id);
  assert.equal(wiki.list({ scope: "library" }).pagination.total, 0);
  assert.ok(db.prepare("SELECT deleted_at FROM elements WHERE id=?").get(album.id).deleted_at);
  const membersTrashed = db.prepare("SELECT count(*) AS n FROM album_items ai JOIN elements e ON e.id=ai.image_id WHERE ai.album_id=? AND e.deleted_at IS NOT NULL").get(album.id).n;
  assert.equal(membersTrashed, 2);
  void org;
});

test("space move carries album members together", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wiki-albums-move-"));
  const db = initDb(":memory:");
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  const repo = createElementRepository(db);
  const wiki = createElementService(repo, createImageStore(path.join(dir, "assets")));
  const album = wiki.createAlbum({ title: "搬迁", tags: ["T"] });
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "green" } }).png().toBuffer();
  await wiki.importImage(bytes, "m.png", [], false, album.spaceId, album.id);
  const target = wiki.createSpace({ name: "另一空间", color: "#5F7A6A" });
  const moved = wiki.moveElements(album.spaceId, { ids: [album.id], targetSpaceId: target.id });
  assert.equal(moved.ok, true);
  const after = wiki.get(album.id);
  assert.equal(after.spaceId, target.id);
  const memberSpace = db.prepare("SELECT space_id AS id FROM elements WHERE id IN (SELECT image_id FROM album_items WHERE album_id=?)").get(album.id).id;
  assert.equal(memberSpace, target.id);
});
