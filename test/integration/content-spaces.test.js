import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "os";
import { createServer, fetch } from "../helpers/authenticatedServer.js";
import { initDb } from "../../src/server/data/sqlite.js";
import { latestWikiVersion } from "../../src/server/data/wikiMigrations.js";
import { createElementRepository } from "../../src/server/data/elementRepository.js";

async function appFor(t) {
  let app;
  const dir = await mkdtemp(path.join(os.tmpdir(), "wiki-spaces-"));
  t.after(async () => { await app?.close(); await rm(dir, { recursive: true, force: true, maxRetries: 3 }); });
  app = await createServer({ port: 0, dataDir: dir });
  const request = (route, method = "GET", body, headers = {}) => fetch(new URL(route, app.url), {
    method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { dir, app, request };
}

test("migration creates default space and attaches existing-shaped libraries", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wiki-spaces-mig-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const db = initDb(path.join(dir, "library.sqlite3"));
  try {
    assert.equal(db.prepare("SELECT max(version) AS v FROM wiki_schema").get().v, latestWikiVersion);
    const space = db.prepare("SELECT * FROM spaces WHERE archived_at IS NULL").get();
    assert.equal(space.name, "默认");
    assert.equal(space.color, "#6B7C93");
    assert.ok(db.prepare("PRAGMA table_info(elements)").all().some((column) => column.name === "space_id"));
    assert.ok(db.prepare("PRAGMA index_list(tags)").all().length >= 1);
  } finally { db.close(); }
});

test("list and tags are isolated per space; create defaults to current space", async (t) => {
  const { request } = await appFor(t);
  const spaces = await (await request("api/spaces")).json();
  assert.equal(spaces.spaces.length, 1);
  assert.equal(spaces.spaces[0].name, "默认");
  const created = await (await request("api/spaces", "POST", { name: "工作", color: "#5F7A6A" })).json();
  assert.equal(created.name, "工作");
  await request("api/elements", "POST", { body: "默认里的文字" }, { "x-jiva-space-id": String(spaces.spaces[0].id) });
  await request("api/elements", "POST", { body: "工作里的文字", tags: ["项目"] }, { "x-jiva-space-id": String(created.id) });
  const defaultList = await (await request(`api/elements?spaceId=${spaces.spaces[0].id}`)).json();
  const workList = await (await request(`api/elements?spaceId=${created.id}`)).json();
  assert.equal(defaultList.pagination.total, 1);
  assert.equal(workList.pagination.total, 1);
  assert.equal(defaultList.elements[0].body, "默认里的文字");
  assert.equal(workList.elements[0].body, "工作里的文字");
  assert.deepEqual((await (await request(`api/tags?spaceId=${created.id}`)).json()).tags.filter((tag) => tag === "项目"), ["项目"]);
  assert.equal((await (await request(`api/tags?spaceId=${spaces.spaces[0].id}`)).json()).tags.includes("项目"), false);
});

test("move relocates content and forbids cross-space relations", async (t) => {
  const { request } = await appFor(t);
  const spaces = (await (await request("api/spaces")).json()).spaces;
  const work = await (await request("api/spaces", "POST", { name: "私人", color: "#7A6B8A" })).json();
  const a = await (await request("api/elements", "POST", { body: "甲" }, { "x-jiva-space-id": String(spaces[0].id) })).json();
  const b = await (await request("api/elements", "POST", { body: "乙" }, { "x-jiva-space-id": String(work.id) })).json();
  assert.equal((await request("api/relations", "POST", { sourceId: a.id, targetId: b.id, name: "相关" })).status, 400);
  const moved = await (await request("api/elements/move", "POST", { ids: [a.id], targetSpaceId: work.id }, { "x-jiva-space-id": String(spaces[0].id) })).json();
  assert.equal(moved.ok, true);
  assert.equal((await (await request(`api/elements?spaceId=${spaces[0].id}`)).json()).pagination.total, 0);
  assert.equal((await (await request(`api/elements?spaceId=${work.id}`)).json()).pagination.total, 2);
});
