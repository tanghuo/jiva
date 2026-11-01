import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium, createServer, fetch } from "../helpers/authenticatedServer.js";
import { resolveBrowserPath } from "../resolveBrowserPath.js";

const browserPath = resolveBrowserPath();
const options = { timeout: 60000, skip: !browserPath && "Browser required" };

// Where the floating layer's pieces sit relative to the page column, in one comparable shape.
async function layout(page) {
  return page.evaluate(() => {
    const box = (selector) => document.querySelector(selector)?.getBoundingClientRect();
    const main = box(".wiki-main"); const search = box(".ui-float-search .wiki-search"); const actions = box(".ui-float-actions");
    const capsule = box(".ui-float-capsule"); const title = box(".ui-float-title h1");
    const fixed = [...document.querySelectorAll(".ui-float-layer *")].filter((node) => getComputedStyle(node).position === "fixed").length;
    return {
      searchNearTop: search.top < 120, actionsTopRight: actions.top < 120 && actions.right <= main.right + 1 && actions.left > search.right - 1,
      titleLeftOfSearch: title.right <= search.left, capsuleAtBottom: capsule.bottom > innerHeight - 80 && capsule.bottom <= innerHeight,
      capsuleInsideColumn: capsule.left >= main.left - 1 && capsule.right <= main.right + 1, searchInsideColumn: search.left >= main.left && search.right <= main.right,
      fixed,
    };
  });
}

test("detail is immersive: one glass bar, media on the left, a 360px info panel on the right, one edit entry", options, async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "detail-ui-"));
  const app = await createServer({ port: 0, dataDir });
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  t.after(async () => { await browser.close(); await app.close(); await rm(dataDir, { recursive: true, force: true, maxRetries: 3 }); });
  const note = await (await fetch(new URL("api/elements", app.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "沉浸式详情" }) })).json();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(10000);
  await page.goto(`${app.url}#wiki`);
  await page.locator(`article[data-element-id="${note.id}"] .wiki-card-open`).click();
  const detail = page.getByRole("region", { name: "内容详情", exact: true });
  const bar = detail.locator(".wiki-detail-bar");
  await bar.getByRole("heading", { name: "沉浸式详情" }).waitFor();
  await bar.getByRole("button", { name: "返回", exact: true }).waitFor();
  assert.equal(await detail.getByRole("button", { name: "编辑", exact: true }).count(), 1, "one edit entry, in the bar");
  assert.equal(await detail.getByRole("button", { name: "编辑文字", exact: true }).count(), 0);
  assert.equal(await bar.getByRole("button", { name: "放进资料篮", exact: true }).count(), 1);
  await bar.getByLabel("更多内容操作").click();
  await bar.getByRole("checkbox", { name: "标记为资料", exact: true }).waitFor();
  const boxes = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect();
    return { main: box(".wiki-detail-main"), panel: box(".wiki-detail-panel"), bar: box(".wiki-detail-bar") };
  });
  assert.equal(Math.round(boxes.panel.width), 360);
  assert.ok(boxes.main.right <= boxes.panel.left, "media column is left of the info panel");
  assert.ok(Math.abs(boxes.main.top - boxes.panel.top) < 2, "the two columns start on the same line");
  assert.ok(boxes.bar.bottom <= boxes.main.top, "the bar sits above both columns");
  assert.equal(await page.locator(".wiki-detail-panel").getByRole("region", { name: "关联内容" }).count(), 1, "relations live in the info panel");
});
