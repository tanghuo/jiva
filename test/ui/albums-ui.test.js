import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("album card markup uses below-cover title layout (A) and album page keeps one primary browse button", async () => {
  const card = await readFile(path.join(root, "src/renderer/src/ElementCard.jsx"), "utf8");
  assert.match(card, /wiki-album-card-face/);
  assert.match(card, /wiki-album-card-meta/);
  assert.match(card, /wiki-album-card-title/);
  assert.doesNotMatch(card, /media-title-scrim|压在封面/);
  const page = await readFile(path.join(root, "src/renderer/src/AlbumPage.jsx"), "utf8");
  assert.match(page, /开始浏览/);
  assert.match(page, /page-header-actions/);
  const viewer = await readFile(path.join(root, "src/renderer/src/AlbumViewer.jsx"), "utf8");
  assert.match(viewer, /wiki-album-filmstrip/);
  const css = await readFile(path.join(root, "src/renderer/src/wiki.css"), "utf8");
  assert.match(css, /wiki-album-cover-stack/);
  assert.match(css, /wiki-album-card-title/);
  const sidebar = await readFile(path.join(root, "src/renderer/src/WikiSidebar.jsx"), "utf8");
  assert.match(sidebar, /key: "album"/);
});
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { chromium, createServer, fetch } from "../helpers/authenticatedServer.js";
import { resolveBrowserPath } from "../resolveBrowserPath.js";
import { stubWorkbenchModels } from "../helpers/workbenchModels.js";

const browserPath = resolveBrowserPath();

test("album strip keeps images in view when seeking before load and resizing", { timeout: 60000, skip: !browserPath && "Browser required" }, async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "album-strip-"));
  const app = await createServer({ port: 0, dataDir });
  let browser;
  let releaseImages;
  const imagesReady = new Promise((resolve) => { releaseImages = resolve; });
  t.after(async () => {
    releaseImages();
    await browser?.close();
    await app.close();
    assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith("album-strip-"));
    await rm(dataDir, { recursive: true, force: true, maxRetries: 3 });
  });
  const response = await fetch(new URL("api/albums", app.url), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "长条滚动回归" }),
  });
  const album = await response.json();
  const items = Array.from({ length: 206 }, (_, i) => ({ id: 1000 + i, image: { originalName: `${i + 1}.png` } }));
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await stubWorkbenchModels(page);
  await page.addInitScript(() => localStorage.setItem("wikiAlbumView", "strip"));
  await page.route(`**/api/albums/${album.id}`, (route) => route.fulfill({ json: { album, items } }));
  await page.route(/\/api\/elements\/1\d{3}\/thumbnail/, async (route) => {
    await imagesReady;
    const id = Number(new URL(route.request().url()).pathname.split("/")[3]);
    const height = id % 2 ? 600 : 1800;
    await route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}"><rect width="1200" height="${height}" fill="#405f8f"/></svg>` });
  });
  await page.goto(`${app.url}#wiki`);
  await page.locator(`article[data-element-id="${album.id}"] .wiki-card-open`).click();
  const waitForFullReadingArea = () => page.waitForFunction(() => {
    const stage = document.querySelector(".wiki-album-strip-scroller");
    if (!stage) return false;
    const main = stage.closest(".wiki-main"), shell = stage.closest(".wiki-shell");
    const inset = parseFloat(getComputedStyle(main).paddingBottom)
      + (parseFloat(getComputedStyle(shell).paddingBottom) || 0);
    return Math.abs(stage.getBoundingClientRect().bottom - (window.innerHeight - inset)) < 2;
  }, null, { timeout: 5000 }).catch(async (error) => {
    const geometry = await page.locator(".wiki-album-strip-scroller").evaluate((stage) => ({
      top: stage.getBoundingClientRect().top, bottom: stage.getBoundingClientRect().bottom,
      viewport: window.innerHeight, scroll: window.scrollY,
      height: stage.parentElement.style.cssText,
      inset: getComputedStyle(stage.closest(".wiki-main")).paddingBottom,
    }));
    throw new Error(`${error.message}: ${JSON.stringify(geometry)}`);
  });
  await waitForFullReadingArea();
  const scrub = page.getByRole("slider", { name: "图集进度", exact: true });
  await scrub.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("PageDown");
  // Even before any image responds, the target tile must occupy the viewport.
  await page.waitForFunction(() => {
    const stage = document.querySelector(".wiki-album-strip-scroller");
    const index = Number(document.querySelector('[aria-label="图集进度"]').getAttribute("aria-valuenow")) - 1;
    const tile = document.querySelector(`[data-strip-index="${index}"]`);
    if (!stage || !tile || index < 90) return false;
    const a = stage.getBoundingClientRect(), b = tile.getBoundingClientRect();
    return b.height > 500 && b.top < a.bottom && b.bottom > a.top;
  });
  assert.ok(await page.locator("[data-strip-index]").count() < 40);
  releaseImages();
  const waitForVisibleImage = () => page.waitForFunction(() => {
    const stage = document.querySelector(".wiki-album-strip-scroller").getBoundingClientRect();
    return [...document.querySelectorAll("[data-strip-index] img")].some((img) => {
      const rect = img.getBoundingClientRect();
      return img.complete && img.naturalWidth > 0 && rect.bottom > stage.top && rect.top < stage.bottom;
    });
  });
  await waitForVisibleImage();
  await page.getByRole("slider", { name: "长条图片宽度", exact: true }).fill("720");
  await waitForVisibleImage();
  await scrub.focus();
  await page.keyboard.press("End");
  await page.waitForFunction(() => document.querySelector('[aria-label="图集进度"]').getAttribute("aria-valuenow") === "206");
  await waitForVisibleImage();
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForFullReadingArea();
  await waitForVisibleImage();
  await scrub.focus();
  await page.keyboard.press("Home");
  await waitForVisibleImage();
  await page.waitForFunction(() => document.querySelector('[data-strip-index="0"] img')?.complete);
  assert.equal(await scrub.getAttribute("aria-valuenow"), "1");
  await page.setViewportSize({ width: 1920, height: 1200 });
  await waitForFullReadingArea();
  await waitForVisibleImage();
  // Activity preserves the image DOM while disconnecting/reconnecting effects.
  // Returning from imports must retain the measured heights of loaded images.
  await page.locator('.wiki-sidebar a[href="#imports"]').click();
  await page.getByRole("heading", { name: "磁力导入图集", exact: true }).waitFor();
  await page.evaluate(() => { location.hash = "wiki"; });
  await page.locator(".wiki-album-strip-scroller").waitFor({ state: "visible" });
  await waitForFullReadingArea();
  await waitForVisibleImage();
  await page.waitForFunction(() => [...document.querySelectorAll("[data-strip-index] img")].every((img) => {
    if (!img.complete || !img.naturalWidth) return false;
    const expected = img.clientWidth * img.naturalHeight / img.naturalWidth;
    return Math.abs(img.parentElement.clientHeight - expected) < 2;
  }), null, { timeout: 5000 });
  const readingArea = page.locator(".wiki-album-strip-scroller");
  const wheelStart = await readingArea.evaluate(node => node.scrollTop);
  await readingArea.hover();
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(top => Math.abs(document.querySelector(".wiki-album-strip-scroller").scrollTop - top - 168) < 2, wheelStart);
  const reverse = await readingArea.evaluate(node => {
    const before = node.scrollTop;
    node.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true }));
    return { before, after: node.scrollTop };
  });
  assert.equal(reverse.after, reverse.before, "Wheel motion starts on animation frames, without an instant jump");
  await page.waitForFunction(top => Math.abs(document.querySelector(".wiki-album-strip-scroller").scrollTop - top) < 2, wheelStart);
  // A fast wheel burst must catch up promptly, rather than queuing seconds of
  // movement behind a fixed pixel-per-second limit.
  const burst = await readingArea.evaluate(async node => {
    const before = node.scrollTop;
    const started = performance.now();
    for (let i = 0; i < 10; i++) node.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 450));
    return { distance: node.scrollTop - before, elapsed: performance.now() - started };
  });
  assert.ok(Math.abs(burst.distance - 1680) < 2, `Fast wheel burst should finish promptly: ${JSON.stringify(burst)}`);
  await readingArea.evaluate(node => { node.scrollTop = 0; });
  for (const init of [{ deltaY: 4.5 }, { deltaY: 120, ctrlKey: true }, { deltaY: 120, shiftKey: true }, { deltaY: 120, deltaX: 10 }]) {
    assert.equal(await readingArea.evaluate((node, options) => {
      const event = new WheelEvent("wheel", { ...options, bubbles: true, cancelable: true });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    }, init), false);
  }
  const minimap = page.locator(".wiki-album-minimap-scroller");
  const before = await page.locator(".wiki-album-strip-scroller").evaluate(node => node.scrollTop);
  await minimap.hover();
  await page.mouse.wheel(0, 600);
  await page.waitForFunction(() => document.querySelector(".wiki-album-minimap-scroller").scrollTop > 200);
  assert.equal(await page.locator(".wiki-album-strip-scroller").evaluate(node => node.scrollTop), before);
  assert.ok(await page.locator("[data-minimap-index]").count() < 30);
  const target = await minimap.evaluate(node => Math.ceil(node.scrollTop / 96) + 1);
  const thumbnail = page.locator(`[data-minimap-index="${target}"]`);
  await thumbnail.click();
  await page.waitForFunction(i => document.querySelector('[aria-label="图集进度"]').getAttribute("aria-valuenow") === String(i + 1), target);
  assert.equal(await thumbnail.getAttribute("aria-current"), "true");
  const rect = await thumbnail.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2 + 96, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(i => document.querySelector('[aria-label="图集进度"]').getAttribute("aria-valuenow") === String(i + 2), target);
  const styles = await thumbnail.evaluate(node => ({
    radius: getComputedStyle(node).borderRadius,
    imageRadius: getComputedStyle(node.querySelector("img")).borderRadius,
  }));
  assert.deepEqual(styles, { radius: "0px", imageRadius: "0px" });
  // Hold the mouse still at the bottom edge: navigation continues without
  // requiring more pointermove events, and stops as soon as the button is up.
  const navRect = await minimap.boundingBox();
  // Wheel input must keep working while the left button remains held, with
  // the main image following the thumbnail under the stationary pointer.
  await page.mouse.move(navRect.x + navRect.width / 2, navRect.y + navRect.height / 2);
  await page.mouse.down();
  const heldTop = await minimap.evaluate(node => node.scrollTop);
  const heldMainTop = await readingArea.evaluate(node => node.scrollTop);
  await page.mouse.wheel(0, 192);
  await page.waitForFunction(top => document.querySelector(".wiki-album-minimap-scroller").scrollTop >= top + 190, heldTop);
  await page.waitForFunction(top => document.querySelector(".wiki-album-strip-scroller").scrollTop > top + 100, heldMainTop);
  const afterHeldWheel = await readingArea.evaluate(node => node.scrollTop);
  await page.mouse.wheel(0, -192);
  await page.waitForFunction(top => Math.abs(document.querySelector(".wiki-album-minimap-scroller").scrollTop - top) < 2, heldTop);
  await page.waitForFunction(top => document.querySelector(".wiki-album-strip-scroller").scrollTop < top - 100, afterHeldWheel);
  await page.mouse.up();
  const viewport = page.locator(".wiki-album-minimap-viewport");
  const viewportRect = await viewport.boundingBox();
  await page.mouse.move(navRect.x + navRect.width / 2, viewportRect.y + Math.min(viewportRect.height / 2, 10));
  await page.mouse.down();
  await page.mouse.move(navRect.x + navRect.width / 2, navRect.y + navRect.height - 2);
  const dragTop = await minimap.evaluate(node => node.scrollTop);
  await page.waitForFunction(top => document.querySelector(".wiki-album-minimap-scroller").scrollTop > top + 96, dragTop);
  const beforeOutside = await minimap.evaluate(node => node.scrollTop);
  const indexBeforeOutside = Number(await scrub.getAttribute("aria-valuenow"));
  await page.mouse.move(navRect.x + navRect.width / 2, navRect.y + navRect.height + 400);
  await page.waitForTimeout(150);
  assert.ok((await minimap.evaluate(node => node.scrollTop)) - beforeOutside < 60, "Moving far outside does not multiply edge speed");
  assert.ok(Math.abs(Number(await scrub.getAttribute("aria-valuenow")) - indexBeforeOutside) <= 2, "Pointer overflow does not jump several images");
  await page.mouse.up();
  const stoppedTop = await minimap.evaluate(node => node.scrollTop);
  await page.waitForTimeout(100);
  assert.equal(await minimap.evaluate(node => node.scrollTop), stoppedTop);
  await waitForVisibleImage();
  if (process.env.ALBUM_MINIMAP_SCREENSHOT) await page.screenshot({ path: process.env.ALBUM_MINIMAP_SCREENSHOT });
});

test("album grid keeps rectangular images and viewer preserves browsing context", { timeout: 60000, skip: !browserPath && "Browser required" }, async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "album-browse-"));
  const app = await createServer({ port: 0, dataDir });
  let browser;
  t.after(async () => {
    await browser?.close();
    await app.close();
    assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith("album-browse-"));
    await rm(dataDir, { recursive: true, force: true, maxRetries: 3 });
  });
  const response = await fetch(new URL("api/albums", app.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "浏览体验测试" }) });
  assert.equal(response.status, 201);
  const album = await response.json();
  const items = Array.from({ length: 30 }, (_, i) => ({ id: 1000 + i, image: { originalName: `${i + 1}.png` } }));
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await stubWorkbenchModels(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`**/api/albums/${album.id}`, (route) => route.fulfill({ json: { album, items } }));
  let failImage = true;
  await page.route(/\/api\/elements\/10\d\d\/(image|thumbnail)/, (route) => {
    if (failImage && route.request().url().endsWith("/image")) return route.fulfill({ status: 503 });
    return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="2400"><rect width="1800" height="2400" fill="#405f8f"/><circle cx="900" cy="900" r="400" fill="#eedbb9"/></svg>' });
  });
  await page.goto(`${app.url}#wiki`);
  await page.locator(`article[data-element-id="${album.id}"] .wiki-card-open`).click();
  const density = page.getByRole("slider", { name: "缩略图大小" });
  const firstTile = page.getByRole("button", { name: "浏览第 1 张", exact: true });
  const initialWidth = (await firstTile.boundingBox()).width;
  await density.fill("300");
  await page.waitForFunction(() => document.querySelector(".wiki-album-grid")?.style.getPropertyValue("--album-tile-size") === "300px");
  assert.ok((await firstTile.boundingBox()).width > initialWidth);
  await density.fill("200");
  const tile = page.getByRole("button", { name: "浏览第 25 张", exact: true });
  await tile.scrollIntoViewIfNeeded();
  const geometry = await tile.evaluate((element) => ({ radius: parseFloat(getComputedStyle(element).borderRadius), width: element.clientWidth, height: element.clientHeight }));
  assert.ok(geometry.radius < 24, `Image radius was ${geometry.radius}`);
  assert.ok(Math.abs(geometry.width - geometry.height) <= 1);
  assert.equal(await tile.locator("img").evaluate((img) => img.draggable), false);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await tile.click();
  const viewer = page.getByRole("dialog", { name: "图集浏览" });
  await viewer.waitFor();
  await viewer.locator(".yarl__slide_current").getByRole("alert").waitFor();
  failImage = false;
  await viewer.locator(".yarl__slide_current").getByRole("button", { name: "重试", exact: true }).click();
  await viewer.locator(".yarl__slide_current img").waitFor({ state: "visible" });
  assert.equal(await viewer.evaluate((element) => element.matches(":modal")), true);
  assert.equal(await viewer.locator(".wiki-album-page-count").textContent(), "25 / 30");
  assert.ok(await viewer.locator(".wiki-album-filmstrip").evaluate((element) => element.scrollLeft > 0));
  const filmstrip = viewer.locator(".wiki-album-filmstrip");
  assert.equal(await filmstrip.locator("img").first().evaluate((img) => img.draggable), false);
  assert.equal(await filmstrip.locator("img").first().evaluate((img) => {
    return img.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true }));
  }), false);
  await filmstrip.evaluate((element) => { element.scrollLeft = 0; });
  await filmstrip.hover();
  await page.mouse.wheel(0, 160);
  await page.waitForFunction(() => document.querySelector(".wiki-album-filmstrip").scrollLeft > 0);
  assert.equal(await viewer.locator(".wiki-album-page-count").textContent(), "25 / 30");
  assert.equal(await viewer.locator(".wiki-album-zoom-value").textContent(), "适应");
  await page.mouse.wheel(0, -1000);
  await page.waitForFunction(() => document.querySelector(".wiki-album-filmstrip").scrollLeft === 0);
  await page.mouse.wheel(160, 0);
  await page.waitForFunction(() => document.querySelector(".wiki-album-filmstrip").scrollLeft > 0);
  // Wheel over either arrow changes images, while the image retains wheel zoom.
  const nextArrow = viewer.getByRole("button", { name: "下一张", exact: true });
  const previousArrow = viewer.getByRole("button", { name: "上一张", exact: true });
  await nextArrow.hover();
  await page.mouse.wheel(0, 100);
  await page.waitForFunction(() => document.querySelector(".wiki-album-page-count")?.textContent === "26 / 30");
  await nextArrow.evaluate((button) => {
    for (let i = 0; i < 3; i++) button.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => document.querySelector(".wiki-album-page-count")?.textContent === "29 / 30");
  assert.equal(await viewer.locator(".wiki-album-zoom-value").textContent(), "适应", "Wheeling an arrow must not zoom the image");
  await nextArrow.evaluate((button) => {
    for (let i = 0; i < 4; i++) button.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => document.querySelector(".wiki-album-page-count")?.textContent === "25 / 30");
  await page.keyboard.press("ArrowRight");
  assert.equal(await viewer.locator(".wiki-album-page-count").textContent(), "26 / 30");
  await page.keyboard.press("End");
  assert.equal(await viewer.getByRole("button", { name: "下一张", exact: true }).isDisabled(), true);
  await page.waitForTimeout(160);
  await nextArrow.hover({ force: true });
  await page.mouse.wheel(0, -100);
  await page.waitForFunction(() => document.querySelector(".wiki-album-page-count")?.textContent === "29 / 30");
  await page.waitForTimeout(160);
  await previousArrow.hover();
  await page.mouse.wheel(0, 100);
  await page.waitForFunction(() => document.querySelector(".wiki-album-page-count")?.textContent === "30 / 30");
  await page.keyboard.press("Home");
  assert.equal(await viewer.getByRole("button", { name: "上一张", exact: true }).isDisabled(), true);
  await viewer.locator(".yarl__slide_current img").waitFor({ state: "visible" });
  await page.keyboard.press("z");
  await page.waitForFunction(() => document.querySelector(".wiki-album-zoom-value")?.textContent !== "适应");
  const zoomWrapper = viewer.locator(".yarl__slide_current .yarl__slide_wrapper_interactive");
  await zoomWrapper.waitFor();
  const panLayer = viewer.locator(".yarl__slide_current .wiki-album-pan-layer");
  const desktopStage = await viewer.locator(".wiki-album-viewer-stage").boundingBox();
  await page.mouse.move(desktopStage.x + desktopStage.width / 2, desktopStage.y + desktopStage.height / 2);
  await page.mouse.down();
  await page.mouse.move(desktopStage.x + desktopStage.width / 2 + 100, desktopStage.y + desktopStage.height / 2 + 80, { steps: 10 });
  await page.mouse.up();
  assert.equal(await panLayer.evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return Math.abs(matrix.m41 - 100) < 1 && Math.abs(matrix.m42 - 80) < 1;
  }), true, "Drag follows the pointer in both axes without being clamped to image edges");
  await viewer.getByRole("button", { name: "重置缩放", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".wiki-album-zoom-value")?.textContent === "适应");
  assert.equal(await panLayer.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41), 0);
  await page.mouse.move(desktopStage.x + desktopStage.width / 2, desktopStage.y + desktopStage.height / 2);
  await page.mouse.wheel(0, -140);
  await page.waitForFunction(() => document.querySelector(".wiki-album-zoom-value")?.textContent !== "适应");
  const wheelZoom = Number.parseInt(await viewer.locator(".wiki-album-zoom-value").textContent(), 10);
  assert.ok(wheelZoom >= 120 && wheelZoom <= 130, `A wheel step should use a moderate zoom increment, got ${wheelZoom}%`);
  await page.mouse.down();
  await page.mouse.move(desktopStage.x + desktopStage.width / 2 + 120, desktopStage.y + desktopStage.height / 2 + 60, { steps: 10 });
  await page.mouse.up();
  assert.equal(await panLayer.evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return Math.abs(matrix.m41 - 120) < 1 && Math.abs(matrix.m42 - 60) < 1;
  }), true, "A slightly enlarged image can move freely even when it is narrower than the viewport");
  // Track one source-image point through zooming after a free drag, on both axes.
  const anchorRect = await viewer.locator(".yarl__slide_current img").boundingBox();
  const anchor = { x: anchorRect.x + anchorRect.width * .6, y: anchorRect.y + anchorRect.height * .4, u: .6, v: .4 };
  await page.mouse.move(anchor.x, anchor.y);
  for (const delta of [-100, 100]) {
    const beforeZoom = await viewer.locator(".wiki-album-zoom-value").textContent();
    await page.mouse.wheel(0, delta);
    await page.waitForFunction((previous) => document.querySelector(".wiki-album-zoom-value")?.textContent !== previous, beforeZoom);
    await page.waitForFunction(({ x, y, u, v }) => {
      const rect = document.querySelector(".yarl__slide_current img").getBoundingClientRect();
      return Math.abs(rect.left + u * rect.width - x) < 2 && Math.abs(rect.top + v * rect.height - y) < 2;
    }, anchor);
  }
  await viewer.getByRole("button", { name: "重置缩放", exact: true }).click();
  await viewer.getByRole("button", { name: "图片详情", exact: true }).click();
  await viewer.getByRole("complementary", { name: "图片信息" }).waitFor();
  assert.ok((await viewer.locator(".wiki-album-details-name").textContent()).includes("1.png"));
  await viewer.getByRole("button", { name: "下一张", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".wiki-album-details-name")?.textContent === "2.png");
  await viewer.getByRole("button", { name: "收起图片详情", exact: true }).click();
  assert.equal(await viewer.getByRole("button", { name: "图片详情", exact: true }).evaluate((button) => document.activeElement === button), true);
  await viewer.getByRole("button", { name: "缩略图", exact: true }).click();
  assert.equal(await viewer.locator(".wiki-album-filmstrip").count(), 0);
  await viewer.getByRole("button", { name: "缩略图", exact: true }).click();
  await viewer.locator(".wiki-album-filmstrip").waitFor();
  await filmstrip.evaluate((element) => { element.scrollLeft = 0; });
  await filmstrip.hover();
  await page.mouse.wheel(0, 160);
  await page.waitForFunction(() => document.querySelector(".wiki-album-filmstrip").scrollLeft > 0);
  await page.keyboard.press("Escape");
  await viewer.waitFor({ state: "detached" });
  assert.equal(await tile.evaluate((element) => document.activeElement === element), true);
  assert.equal(await page.evaluate(() => window.scrollY), scrollBefore);
  await page.getByRole("button", { name: "竖向长条", exact: true }).click();
  const stripWidth = page.getByRole("slider", { name: "长条图片宽度", exact: true });
  await stripWidth.fill("720");
  await page.waitForFunction(() => document.querySelector(".wiki-album-grid.is-strip")?.getBoundingClientRect().width === 720);
  assert.equal(await page.locator(".wiki-album-tile-caption").count(), 0);
  await page.reload();
  await page.locator(`article[data-element-id="${album.id}"] .wiki-card-open`).click();
  assert.equal(await stripWidth.inputValue(), "720");
  assert.equal((await page.locator(".wiki-album-grid.is-strip").boundingBox()).width, 720);
  await page.getByRole("button", { name: "浏览第 1 张", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".wiki-album-grid.is-strip").count(), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "浏览第 1 张", exact: true }).click();
  await viewer.locator(".yarl__slide_current img").waitFor({ state: "visible" });
  assert.ok(await viewer.evaluate((element) => element.scrollWidth <= window.innerWidth));
  const stage = await viewer.locator(".wiki-album-viewer-stage").boundingBox();
  const centerY = stage.y + stage.height / 2;
  await page.mouse.move(stage.x + stage.width * .8, centerY);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width * .2, centerY, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector(".wiki-album-page-count")?.textContent === "2 / 30");
  assert.equal(await viewer.locator(".wiki-album-page-count").textContent(), "2 / 30");
  await viewer.getByRole("button", { name: "图片详情", exact: true }).click();
  const mobileDetails = viewer.getByRole("complementary", { name: "图片信息" });
  assert.ok((await mobileDetails.boundingBox()).width <= 390);
  await viewer.getByRole("button", { name: "收起图片详情", exact: true }).click();
  await viewer.locator(".yarl__container").focus();
  await page.keyboard.press("Escape");
  await viewer.waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
});

test("album filmstrip thumbnails load through the real image API", { timeout: 60000, skip: !browserPath && "Browser required" }, async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "album-thumbnails-"));
  const app = await createServer({ port: 0, dataDir });
  let browser;
  t.after(async () => {
    await browser?.close();
    await app.close();
    assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith("album-thumbnails-"));
    await rm(dataDir, { recursive: true, force: true, maxRetries: 3 });
  });
  const created = await fetch(new URL("api/albums", app.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "真实缩略图验证" }) });
  assert.equal(created.status, 201);
  const album = await created.json();
  const { default: sharp } = await import("sharp");
  for (const [index, background] of ["#405f8f", "#ad725b", "#578271"].entries()) {
    const bytes = await sharp({ create: { width: 600, height: 900, channels: 3, background } }).png().toBuffer();
    const imported = await fetch(new URL("api/images", app.url), {
      method: "POST", headers: { "content-type": "application/octet-stream", "x-file-name": `${index + 1}.png`, "x-album-id": String(album.id) }, body: bytes,
    });
    assert.equal(imported.status, 201);
  }
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await stubWorkbenchModels(page);
  const failedThumbnails = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith("/thumbnail") && !response.ok()) failedThumbnails.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`${app.url}#wiki`);
  await page.locator(`article[data-element-id="${album.id}"] .wiki-card-open`).click();
  await page.getByRole("button", { name: "开始浏览", exact: true }).click();
  await page.locator(".wiki-album-filmstrip").waitFor();
  const images = page.locator(".wiki-album-filmstrip img");
  assert.equal(await images.count(), 3);
  await page.waitForFunction(() => [...document.querySelectorAll(".wiki-album-filmstrip img")].every((img) => img.complete && img.naturalWidth > 0));
  await page.locator(".yarl__slide_current img").waitFor({ state: "visible" });
  assert.deepEqual(failedThumbnails, []);
  await page.getByRole("button", { name: "切换原尺寸与适应窗口", exact: true }).click();
  await page.waitForFunction(() => {
    const img = document.querySelector(".yarl__slide_current img");
    return Math.abs(img.getBoundingClientRect().width - img.naturalWidth) < 2;
  });
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await page.waitForFunction(() => {
    const img = document.querySelector(".yarl__slide_current img");
    return img.getBoundingClientRect().width > img.naturalWidth * 3.8;
  });
  const widthBeforeWheel = await page.locator(".yarl__slide_current img").evaluate((img) => img.getBoundingClientRect().width);
  await page.locator(".wiki-album-viewer-stage").hover();
  await page.mouse.wheel(0, -100);
  await page.waitForFunction((width) => document.querySelector(".yarl__slide_current img").getBoundingClientRect().width > width + 10, widthBeforeWheel);
  await page.getByRole("button", { name: "重置缩放", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".wiki-album-zoom-value")?.textContent === "适应");
  await page.getByRole("button", { name: "图片详情", exact: true }).click();
  const details = page.getByRole("complementary", { name: "图片信息" });
  assert.equal(await details.locator("dd").first().textContent(), "600 × 900");
  assert.equal(await details.getByRole("link", { name: "下载原图" }).getAttribute("href"), await page.locator(".yarl__slide_current img").getAttribute("src").then((src) => src.replace("/image", "/download")));
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.querySelector(".wiki-album-page-count")?.textContent === "2 / 3");
  await page.locator(".yarl__slide_current img").waitFor({ state: "visible" });
  const viewer = page.getByRole("dialog", { name: "图集浏览" });
  await page.locator(".yarl__slide_current img").click();
  assert.equal(await viewer.isVisible(), true, "Clicking the image keeps the viewer open");
  await details.locator(".wiki-album-details-name").click();
  assert.equal(await viewer.isVisible(), true, "Clicking image details keeps the viewer open");
  const resetZoom = viewer.getByRole("button", { name: "重置缩放", exact: true });
  if (await resetZoom.isEnabled()) await resetZoom.click();
  await page.waitForFunction(() => {
    const img = document.querySelector(".yarl__slide_current img");
    const stage = document.querySelector(".wiki-album-viewer-stage");
    return img.getBoundingClientRect().width < stage.clientWidth / 2;
  });
  const stage = await viewer.locator(".wiki-album-viewer-stage").boundingBox();
  const blank = { x: stage.x + 12, y: stage.y + 12 };
  await page.mouse.move(blank.x, blank.y);
  await page.mouse.down();
  await page.mouse.move(blank.x + 25, blank.y + 25, { steps: 5 });
  await page.mouse.move(blank.x, blank.y, { steps: 5 });
  await page.mouse.up();
  assert.equal(await viewer.isVisible(), true, "Dragging through blank space does not close the viewer");
  if (await resetZoom.isEnabled()) await resetZoom.click();
  await page.waitForFunction(() => {
    const img = document.querySelector(".yarl__slide_current img");
    return img.getBoundingClientRect().width < document.querySelector(".wiki-album-viewer-stage").clientWidth / 2;
  });
  // Let any zoom and swipe animations settle before clicking the background.
  await page.waitForTimeout(400);
  await page.mouse.click(blank.x, blank.y);
  await viewer.waitFor({ state: "detached" });
  assert.equal(await page.getByRole("button", { name: "开始浏览", exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "竖向长条", exact: true }).click();
  await page.waitForFunction(() => {
    const thumbnails = [...document.querySelectorAll(".wiki-album-minimap img")];
    return thumbnails.length === 3 && thumbnails.every(img => img.complete && img.naturalWidth > 0);
  });
});

test("album overview exposes 方格|长条 only and keeps toggle outside manage mode", async () => {
  const page = await readFile(path.join(root, "src/renderer/src/AlbumPage.jsx"), "utf8");
  assert.match(page, /wiki-album-toolbar/);
  assert.match(page, /aria-label="总览布局"/);
  assert.match(page, />方格</);
  assert.match(page, />长条</);
  assert.doesNotMatch(page, />照片墙</);
  assert.doesNotMatch(page, />等比</);
  assert.doesNotMatch(page, />齐行</);
  assert.doesNotMatch(page, /layout === "wall"|changeLayout\("wall"\)|packAlbumWall|wiki-album-wall/);
  const manageStart = page.indexOf("wiki-album-manage-bar");
  const manageEnd = page.indexOf("wiki-album-toolbar");
  assert.ok(manageStart > 0 && manageEnd > manageStart);
  const manageChunk = page.slice(manageStart, manageEnd);
  assert.doesNotMatch(manageChunk, /wiki-album-view-toggle|方格|长条/);
  assert.match(page, /!managing && <Button variant="primary"/);
  assert.match(page, /variant="secondary"[^>]*>保存标题与标签/);
  assert.match(page, /wikiAlbumView|readStoredAlbumLayout|persistAlbumLayout/);
});

test("album overview has no photo wall and no hover/space quick preview", async () => {
  const page = await readFile(path.join(root, "src/renderer/src/AlbumPage.jsx"), "utf8");
  assert.doesNotMatch(page, /wiki-album-preview-float|wiki-album-preview-card|PREVIEW_HOVER_MS|悬停或按住空格快预览/);
  assert.doesNotMatch(page, /is-preview-hot|has-preview|openPreview|closePreview/);
  assert.doesNotMatch(page, /aria-pressed=\{layout === "preview"\}/);
  assert.doesNotMatch(page, /albumWallLayout|packAlbumWall|visibleWallPlacements|wallTraits|wiki-album-wall/);
  assert.doesNotMatch(page, /照片墙/);
  const css = await readFile(path.join(root, "src/renderer/src/wiki.css"), "utf8");
  assert.doesNotMatch(css, /\.wiki-album-preview-float|is-preview-hot/);
  assert.doesNotMatch(css, /\.wiki-album-wall|\.is-wall-stage/);
  assert.match(css, /minmax\(72px, 12vw\)/);
  assert.match(page, /from "\.\/albumLayout\.js"/);
});

test("album strip layout is comic continuous reading (no third segment)", async () => {
  const page = await readFile(path.join(root, "src/renderer/src/AlbumPage.jsx"), "utf8");
  const css = await readFile(path.join(root, "src/renderer/src/wiki.css"), "utf8");
  assert.match(page, />方格</);
  assert.match(page, />长条</);
  assert.doesNotMatch(page, />漫画连读</);
  assert.doesNotMatch(page, />照片墙</);
  assert.match(page, /wiki-album-strip-progress/);
  assert.match(page, /is-strip-stage/);
  assert.match(css, /\.wiki-album-grid\.is-strip/);
  assert.match(css, /gap:\s*2px/);
  assert.match(css, /object-fit:\s*contain/);
  assert.match(css, /wiki-album-strip-progress/);
  assert.match(css, /border-radius:\s*0/);
  assert.doesNotMatch(page, /漫画连读/);
  assert.doesNotMatch(css, /\.wiki-album-wall|\.is-wall-stage/);
  assert.doesNotMatch(css, /wiki-album-tile-open[^}]*rotate\(/s);
});

test("album strip uses virtual thumbnail navigation", async () => {
  const page = await readFile(path.join(root, "src/renderer/src/AlbumPage.jsx"), "utf8");
  assert.match(page, /<AlbumMinimap/);
  assert.match(page, /computeStripWindow/);
});
