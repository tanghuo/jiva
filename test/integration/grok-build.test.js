import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateGrokBuild, probeGrokBuild } from "../../src/agent/executors/grokBuild.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wiki-grok-"));
  const workspace = path.join(root, "workspace"); await mkdir(workspace);
  const previous = process.env.GROK_HOME; process.env.GROK_HOME = root;
  const executable = path.join(root, "grok 中文.mjs");
  await writeFile(executable, await readFile(new URL("../fixtures/grok-build.txt", import.meta.url)));
  const config = { executable, model: "grok-4.6", aspectRatio: "16:9" };
  const cleanup = [];
  t.after(async () => {
    for (const close of cleanup) await close();
    if (previous === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = previous;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("wiki-grok-"));
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  return { root, workspace, config, cleanup, generate: (value = {}, options = {}) => generateGrokBuild({ prompt: "橘猫 ` $() \n", ...value }, { config, workspace, ...options }),
    observed: async () => JSON.parse(await readFile(path.join(root, "observed.json"), "utf8")) };
}

test("Grok CLI boundary probes, generates once and returns verified image bytes", async (t) => {
  const f = await fixture(t), events = [];
  assert.equal((await probeGrokBuild(f.config, f.workspace)).available, true);
  assert.equal((await probeGrokBuild({ ...f.config, executable: path.join(f.root, "missing.exe") }, f.workspace)).available, false);
  const result = await f.generate({}, { onProgress: (event) => events.push(event) });
  assert.equal(result.bytes.subarray(1, 4).toString(), "PNG");
  assert.ok(result.savedPath.startsWith(await realpath(f.workspace) + path.sep));
  const observed = await f.observed(), input = JSON.parse(observed.request.split('\n').slice(1).join('\n'));
  assert.equal(input.prompt, "橘猫 ` $() \n"); assert.equal(input.aspect_ratio, "16:9");
  assert.equal(observed.args[observed.args.indexOf("--tools") + 1], "image_gen");
  assert.equal(events.filter((event) => event.type === "submitted").length, 1);
  assert.ok(events.find((event) => event.metadata?.grokBuild?.input.prompt === input.prompt));
});

test("Grok editing validates references and preserves single-image aspect ratio", async (t) => {
  const f = await fixture(t);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await writeFile(path.join(f.workspace, "reference.png"), png);
  await writeFile(path.join(f.root, "outside.png"), png);
  await assert.rejects(f.generate({ referencePaths: ["../outside.png"] }), /当前会话/);
  await assert.rejects(f.generate({ referencePaths: Array(9).fill("reference.png") }), /无效/);
  await assert.rejects(f.generate({ aspectRatio: "5:7" }), /无效/);
  await f.generate({ referencePaths: ["reference.png"], aspectRatio: "9:16" });
  let observed = await f.observed(), input = JSON.parse(observed.request.slice(observed.request.indexOf('\n') + 1));
  assert.equal(observed.args[observed.args.indexOf("--tools") + 1], "image_edit");
  assert.equal(input.image.length, 1); assert.equal(input.aspect_ratio, undefined);
  await f.generate({ referencePaths: ["reference.png", "reference.png"], aspectRatio: "9:16" });
  observed = await f.observed(); input = JSON.parse(observed.request.slice(observed.request.indexOf('\n') + 1));
  assert.equal(input.aspect_ratio, "9:16"); assert.equal(input.image.length, 2);
});

test("Grok rejects malformed, failed, duplicate and foreign-session results without retry", async (t) => {
  const f = await fixture(t);
  for (const [prompt, message] of [["malformed", /无效事件/], ["failed", /图片工具执行失败/], ["duplicate", /重复图片/], ["wrong-session", /不属于本次会话/]]) {
    await assert.rejects(f.generate({ prompt }), message);
  }
});

test("Grok cancellation terminates the local process and does not confirm pending calls", async (t) => {
  const f = await fixture(t), controller = new AbortController(), events = [];
  await assert.rejects(f.generate({ prompt: "hang" }, { signal: controller.signal, onProgress(event) {
    events.push(event); if (event.metadata?.grokBuild) controller.abort();
  } }), /已停止/);
  assert.equal(events.some((event) => event.type === "submitted"), false);
});
