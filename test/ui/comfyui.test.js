import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer as httpServer } from "node:http";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import sharp from "sharp";
import { chromium } from "../helpers/authenticatedServer.js";
import { resolveBrowserPath } from "../resolveBrowserPath.js";
import { comfyuiConfig, comfyuiWorkflow, configuredComfyuiWorkflow } from "../../src/shared/domain/comfyui.js";
import { defaultImageGenerationConfig, imageGenerationConfig } from "../../src/shared/domain/imageGeneration.js";
import { defaultOrganizationConfig } from "../../src/shared/domain/organization.js";
import { generateComfyui, probeComfyui, recoverComfyuiImage } from "../../src/agent/executors/comfyui.js";
import { createServer, fetch } from "../helpers/authenticatedServer.js";
import { convertComfyuiWorkflow, describeComfyuiWorkflow, loadComfyuiWorkflow } from "../../src/agent/executors/comfyuiWorkflows.js";
import { chooseOption, selectedValue, currentSessionId } from "../ui-select.js";
import { workflowNode as n, constant as c, output as o } from '../../src/shared/domain/workflow/examples.js';

const template = JSON.parse(await readFile(new URL("../fixtures/comfyui-workflow.json", import.meta.url), "utf8"));
const nodeInfo = JSON.parse(await readFile(new URL("../fixtures/comfyui-nodes.json", import.meta.url), "utf8"));
const canvas = JSON.parse(await readFile(new URL("../fixtures/comfyui-canvas.json", import.meta.url), "utf8"));
function configuration(baseUrl = "http://127.0.0.1:8188") {
  return { baseUrl, workflowName: "水彩工作流.json", workflow: structuredClone(template), prompt: { nodeId: "6", input: "text" }, outputNodeId: "9" };
}

function imageCanvas() {
  const graph = structuredClone(canvas);
  Object.assign(graph.nodes.find((node) => node.id === 5), { type: "VAEEncode", widgets_values: [],
    inputs: [{ name: "pixels", type: "IMAGE", link: 10 }, { name: "vae", type: "VAE", link: 11 }] });
  graph.nodes.push({ id: 72, type: "LoadImage", inputs: [], widgets_values: ["unrelated.png"] });
  graph.links.push([10, 72, 0, 5, 0, "IMAGE"], [11, 4, 2, 5, 1, "VAE"]);
  return graph;
}

test("ComfyUI config upgrades old settings, validates mappings and isolates the selected output", () => {
  const old = defaultImageGenerationConfig(); delete old.comfyui;
  assert.equal(imageGenerationConfig(old).comfyui.baseUrl, "http://127.0.0.1:8188");
  const config = comfyuiConfig(configuration("http://127.0.0.1:8188/nested/"));
  assert.equal(config.baseUrl, "http://127.0.0.1:8188/nested");
  const workflow = configuredComfyuiWorkflow(config);
  assert.deepEqual(Object.keys(workflow), ["3", "4", "5", "6", "7", "8", "9"]);
  workflow["6"].inputs.text = "changed"; assert.equal(config.workflow["6"].inputs.text, "original positive");
  for (const baseUrl of ["file:///tmp", "http://user:pass@host", "http://host/?token=secret", "http://host/#path", "localhost:8188"]) {
    assert.throws(() => comfyuiConfig({ ...config, baseUrl }), /ComfyUI/);
  }
  assert.throws(() => comfyuiWorkflow({ nodes: [], links: [] }), /执行图无效/);
  assert.throws(() => comfyuiWorkflow({ a: { inputs: {} } }), /API/);
  assert.throws(() => comfyuiWorkflow({ 1: { class_type: "Test", inputs: { text: "字".repeat(180000) } } }), /512 KiB/);
  assert.throws(() => comfyuiConfig({ ...config, prompt: { nodeId: "6", input: "clip" } }), /文本字段/);
  assert.throws(() => configuredComfyuiWorkflow({ ...config, outputNodeId: "99" }), /没有连接/);
  const cycle = structuredClone(config); cycle.workflow["4"].inputs.cycle = ["9", 0];
  assert.throws(() => configuredComfyuiWorkflow(cycle), /循环/);
  assert.equal(imageGenerationConfig({ ...old, executor: "comfyui" }).comfyui.workflow, null);
});

async function fixture(t, mode = "success") {
  const root = await mkdtemp(path.join(os.tmpdir(), "wiki-comfyui-"));
  const cleanup = [];
  const png = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#88bbaa" } }).png().toBuffer();
  const state = { path: "文生图/水彩.json", canvas: structuredClone(canvas), mode, requests: [], submissions: [], jobs: new Map(), uploads: [], deletions: [], cancellations: [], historyReads: 0, otherId: randomUUID() };
  const server = httpServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://fixture"), chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length && url.pathname !== "/upload/image" ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      state.requests.push({ method: req.method, path: url.pathname, body });
      const respond = (value, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
      if (url.pathname === "/upload/image") {
        const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": req.headers["content-type"] } }).formData();
        const image = form.get("image"), uploaded = { name: image.name, subfolder: form.get("subfolder"), type: form.get("type") };
        state.uploads.push({ ...uploaded, overwrite: form.get("overwrite"), bytes: Buffer.from(await image.arrayBuffer()) });
        if (state.mode === "upload-error") return respond({ error: "图片上传失败" }, 500);
        if (state.mode === "upload-mismatch") return respond({ ...uploaded, subfolder: "../other" });
        return respond(uploaded);
      }
      if (url.pathname === "/system_stats") return respond({ system: { comfyui_version: "fixture" }, devices: [] });
      if (url.pathname === "/userdata") return respond([{ path: state.path, modified: 10, size: JSON.stringify(state.canvas).length }, { path: ".index.json" }, { path: "../secret.json" }]);
      if (decodeURIComponent(url.pathname) === `/userdata/workflows/${state.path}`) return respond(state.canvas);
      if (url.pathname.startsWith("/object_info/")) {
        const type = decodeURIComponent(url.pathname.split("/").at(-1));
        return respond(state.mode === "missing-node" && type === "KSampler" ? {} : { [type]: nodeInfo[type] });
      }
      if (url.pathname === "/prompt") {
        state.submissions.push(body); state.promptId = state.mode === "old-cancel" ? randomUUID() : body.prompt_id;
        state.jobs.set(state.promptId, state.submissions.length - 1);
        if (state.mode === "lost-response" || state.mode === 'second-submit-lost' && state.submissions.length === 2) { req.socket.destroy(); return; }
        if (state.mode === "submit-error") return respond({ error: { message: "工作流验证失败" }, node_errors: { 4: { errors: [{ details: "模型文件不存在" }] } } }, 400);
        if (state.mode === "delayed-submit") await new Promise((resolve) => { state.releaseSubmission = resolve; });
        return respond({ prompt_id: state.promptId, number: 1, node_errors: {} });
      }
      if (url.pathname.startsWith("/history/")) {
        state.historyReads++;
        const id = decodeURIComponent(url.pathname.slice('/history/'.length)), index = state.jobs.get(id);
        if (index === undefined) return respond({});
        if (state.mode === "read-retry" && state.historyReads < 3) return respond({ error: "temporary failure" }, 503);
        if (["running", "old-cancel", "pending", "deleted", "delayed-submit"].includes(state.mode) || state.mode === 'second-running' && index === 1) return respond({});
        const images = [{ filename: "结果 #1.png", subfolder: "测试 子目录", type: "output" }];
        if (state.mode.startsWith('sequential') && index === 1) images[0].filename = 'second.png';
        if (["multiple", "second-image-error"].includes(state.mode)) images.push({ ...images[0], filename: "second.png" });
        const failed = state.mode === "run-error";
        return respond({ [id]: { outputs: state.mode === "no-image" ? {} : { 9: { images } },
          status: { completed: !failed, status_str: failed ? "error" : "success", messages: failed ? [["execution_error", { exception_message: "显存不足" }]] : [] } } });
      }
      if (url.pathname === "/queue" && req.method === "GET") return respond({
        queue_running: [[0, state.otherId], ...(["running", "old-cancel", "delayed-submit", 'second-running'].includes(state.mode) ? [[1, state.promptId]] : [])],
        queue_pending: state.mode === "pending" ? [[2, state.promptId]] : [],
      });
      if (url.pathname === "/queue" && req.method === "POST") { state.deletions.push(...body.delete); res.end(); return; }
      if (/^\/api\/jobs\/[^/]+\/cancel$/.test(url.pathname)) {
        if (state.mode === "old-cancel") return respond({ error: "Not found" }, 404);
        state.cancellations.push(url.pathname.split("/")[3]); return respond({ cancelled: true });
      }
      if (url.pathname === "/view") {
        state.imageQuery = Object.fromEntries(url.searchParams);
        if (['second-image-error', 'sequential-second-error'].includes(state.mode) && url.searchParams.get('filename') === 'second.png') return respond({ error: 'download interrupted' }, 503);
        res.end(state.mode === "bad-image" ? "not an image" : png); return;
      }
      respond({ error: "Not found" }, 404);
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
    state.releaseSubmission?.(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("wiki-comfyui-"));
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  return { root, png, state, cleanup, config: configuration(`http://127.0.0.1:${server.address().port}`) };
}

test("ComfyUI connection probe needs only an address; workflow loading checks node availability", async (t) => {
  const f = await fixture(t);
  assert.equal((await probeComfyui({ baseUrl: f.config.baseUrl })).available, true);
  assert.ok(f.state.requests.every((r) => r.method === "GET"));
  assert.equal(f.state.submissions.length, 0);
  assert.ok(!f.state.requests.some((r) => r.path.includes("object_info")));
  f.state.mode = "missing-node";
  await assert.rejects(loadComfyuiWorkflow(f.config, { path: "文生图/水彩.json" }), /未提供节点类型 KSampler 的定义/);
});

test("ComfyUI workflow loading accepts only saved remote paths and never imports or modifies workflows", async (t) => {
  const f = await fixture(t);
  for (const payload of [{ workflow: template, name: 'import.json' }, { path: f.state.path, workflow: template }, {}, { path: '../secret.json' }]) {
    await assert.rejects(loadComfyuiWorkflow(f.config, payload), /已保存的工作流|无效的远端工作流路径/);
  }
  assert.equal(f.state.requests.length, 0);
  const result = await loadComfyuiWorkflow(f.config, { path: f.state.path });
  assert.equal(result.path, f.state.path);
  assert.equal(result.name, f.state.path);
  assert.ok(f.state.requests.every((entry) => entry.method === 'GET'));
  assert.equal(f.state.submissions.length, 0);
});

test('saved ComfyUI subgraphs load by path and map their inner prompt through to generation', async (t) => {
  const f = await fixture(t), inner = structuredClone(canvas);
  inner.nodes = inner.nodes.filter((node) => node.id !== 9);
  inner.nodes.find((node) => node.id === 6).inputs.push({ name: 'text', type: 'STRING', widget: { name: 'text' }, link: 10 });
  inner.links.find((link) => link[0] === 9)[3] = -20;
  inner.links.push([10, -10, 0, 6, 1, 'STRING']);
  Object.assign(inner, { id: 'fixture-subgraph', inputNode: { id: -10 }, outputNode: { id: -20 }, inputs: [{ name: 'prompt' }], outputs: [{ name: 'image' }] });
  f.state.canvas = { nodes: [{ id: 100, type: inner.id, inputs: [{ name: 'prompt', type: 'STRING', widget: { name: 'prompt' }, link: null }], widgets_values: ['saved subgraph prompt'] }, structuredClone(canvas.nodes.find((node) => node.id === 9))],
    links: [[9, 100, 0, 9, 0, 'IMAGE']], definitions: { subgraphs: [inner] } };
  const before = structuredClone(f.state.canvas);
  const loaded = await loadComfyuiWorkflow(f.config, { path: f.state.path });
  assert.deepEqual(loaded.prompt, { nodeId: '100:6', input: 'text' });
  assert.equal(loaded.workflow['100:6'].inputs.text, 'saved subgraph prompt');
  assert.ok(!f.state.requests.some((request) => request.path.includes('fixture-subgraph')));
  assert.ok(f.state.requests.every((request) => request.method === 'GET'));
  await generateComfyui({ prompt: 'Wiki prompt' }, { config: { ...f.config, workflow: loaded.workflow, prompt: loaded.prompt, outputNodeId: loaded.outputNodeId }, workspace: f.root });
  assert.equal(f.state.submissions[0].prompt['100:6'].inputs.text, 'Wiki prompt');
  assert.deepEqual(f.state.submissions[0].prompt['9'].inputs.images, ['100:8', 0]);
  assert.deepEqual(f.state.canvas, before);
});

test('random seed controls survive import and consecutive generations submit distinct recorded seeds', async (t) => {
  const f = await fixture(t), graph = convertComfyuiWorkflow(canvas, nodeInfo);
  const config = { ...f.config, workflow: graph }, before = structuredClone(config), events = [];
  assert.equal(graph['3']._meta.seedControls.seed.mode, 'randomize');
  for (let i = 0; i < 2; i++) await generateComfyui({ prompt: 'same prompt' }, { config, workspace: f.root, onProgress: (event) => events.push(event) });
  const values = f.state.submissions.map((entry) => entry.prompt['3'].inputs.seed);
  assert.notEqual(values[0], values[1]);
  assert.ok(values.every((seed) => Number.isSafeInteger(seed) && seed >= 0));
  assert.deepEqual(events.filter((event) => event.type === 'metadata' && !event.metadata.comfyui.promptId).map((event) => event.metadata.comfyui.seeds[0].value), values);
  assert.deepEqual(config, before);
  graph['3']._meta.seedControls.seed.mode = 'fixed';
  for (let i = 0; i < 2; i++) await generateComfyui({ prompt: 'same prompt' }, { config, workspace: f.root });
  assert.deepEqual(f.state.submissions.slice(2).map((entry) => entry.prompt['3'].inputs.seed), [42, 42]);
});

test('old imports recover seed controls without replacing local parameter overrides', async (t) => {
  const f = await fixture(t), config = { ...f.config, workflowName: f.state.path };
  config.workflow['3'].inputs.steps = 17;
  const before = structuredClone(config);
  for (let i = 0; i < 2; i++) await generateComfyui({ prompt: 'unchanged prompt' }, { config, workspace: f.root });
  assert.notEqual(f.state.submissions[0].prompt['3'].inputs.seed, f.state.submissions[1].prompt['3'].inputs.seed);
  assert.ok(f.state.submissions.every((entry) => entry.prompt['3'].inputs.steps === 17));
  assert.deepEqual(config, before);
});



test('ComfyUI multi-image execution saves every output separately and validates count before dispatch', async (t) => {
  const f = await fixture(t, 'multiple');
  for (const count of [0, 17, 1.5]) {
    const config = structuredClone(f.config); config.workflow['5'].inputs.batch_size = count;
    await assert.rejects(generateComfyui({ prompt: 'two images' }, { config, workspace: f.root, multiple: true }), /生成数量须为/);
  }
  assert.equal(f.state.submissions.length, 0);
  const result = await generateComfyui({ prompt: 'two images' }, { config: f.config, workspace: f.root, multiple: true });
  assert.equal(result.images.length, 2);
  assert.notEqual(result.images[0].savedPath, result.images[1].savedPath);
  for (const image of result.images) assert.deepEqual(await readFile(image.savedPath), f.png);
  assert.equal(f.state.requests.filter((entry) => entry.path === '/view').length, 2);
  assert.equal(f.state.submissions.length, 1);
});

test('ComfyUI image count submits sequential single-image requests with fresh seeds and one reference upload', async (t) => {
  const f = await fixture(t), events = [];
  const config = { ...f.config, workflow: convertComfyuiWorkflow(canvas, nodeInfo) };
  config.workflow['5'].inputs.batch_size = 4;
  config.workflow['5'].class_type = 'EmptyLatentImage';
  config.workflow['5'].inputs.reference = ['72', 0];
  config.workflow['72'] = { class_type: 'LoadImage', inputs: { image: 'original.png' } };
  config.imageInputs = [{ nodeId: '72', input: 'image' }];
  const before = structuredClone(config);
  await writeFile(path.join(f.root, 'reference.png'), f.png);
  let dispatches = 0;
  const result = await generateComfyui({ prompt: 'four single images', referencePaths: ['reference.png'] }, {
    config, workspace: f.root, multiple: true, onProgress: (event) => events.push(event), onDispatch() { dispatches++; },
  });
  assert.equal(result.images.length, 4);
  assert.equal(f.state.submissions.length, 4);
  assert.equal(f.state.uploads.length, 1);
  assert.equal(dispatches, 1);
  const sent = f.state.submissions;
  assert.ok(sent.every((request) => request.prompt['5'].inputs.batch_size === 1 && request.prompt['6'].inputs.text === 'four single images'));
  assert.equal(new Set(sent.map((request) => request.prompt['3'].inputs.seed)).size, 4);
  assert.equal(new Set(sent.map((request) => request.prompt['72'].inputs.image)).size, 1);
  assert.equal(new Set(sent.map((request) => request.prompt_id)).size, 4);
  const requests = f.state.requests;
  const posts = requests.map((request, i) => request.path === '/prompt' ? i : -1).filter((i) => i >= 0);
  for (let i = 1; i < posts.length; i++) assert.ok(requests.slice(posts[i-1]+1, posts[i]).some((request) => request.path === `/history/${sent[i-1].prompt_id}`));
  assert.ok(requests.findIndex((request) => request.path === '/view') > posts.at(-1), 'all requests finish before downloading');
  const metadata = events.filter((event) => event.type === 'metadata').at(-1).metadata.comfyui;
  assert.equal(metadata.sequence.count, 4);
  assert.deepEqual(metadata.sequence.requests.map((request) => request.promptId), sent.map((request) => request.prompt_id));
  assert.deepEqual(metadata.sequence.requests.map((request) => request.seeds[0].value), sent.map((request) => request.prompt['3'].inputs.seed));
  assert.deepEqual(config, before);
});

test('ComfyUI sequential requests preserve fixed seeds and refuse incompatible counts before dispatch', async (t) => {
  const f = await fixture(t);
  f.config.workflow['5'].inputs.batch_size = 2;
  const result = await generateComfyui({ prompt: 'fixed seed' }, { config: f.config, workspace: f.root, multiple: true });
  assert.equal(result.images.length, 2);
  assert.deepEqual(f.state.submissions.map((request) => request.prompt['3'].inputs.seed), [42, 42]);
  f.config.workflow['3'].inputs.batch_size = 3;
  await assert.rejects(generateComfyui({ prompt: 'conflicting counts' }, { config: f.config, workspace: f.root, multiple: true }), /数量不一致/);
  assert.equal(f.state.submissions.length, 2);
});

test('ComfyUI sequential recovery fetches every task after a failed download without submitting again', async (t) => {
  const f = await fixture(t, 'sequential-second-error'), events = [];
  f.config.workflow['5'].inputs.batch_size = 2;
  await assert.rejects(generateComfyui({ prompt: 'two images' }, {
    config: f.config, workspace: f.root, multiple: true, onProgress: (event) => events.push(event),
  }), /download interrupted/);
  assert.equal(f.state.submissions.length, 2);
  const sequence = events.filter((event) => event.type === 'metadata').at(-1).metadata.comfyui.sequence;
  const ticket = { count: sequence.count, promptIds: sequence.requests.map((request) => request.promptId) };
  f.state.mode = 'sequential';
  const result = await recoverComfyuiImage(f.config, ticket, { multiple: true });
  assert.equal(result.images.length, 2);
  assert.ok(result.images.every((image) => image.bytes.equals(f.png)));
  assert.equal(f.state.submissions.length, 2);
});

test('ComfyUI sequential submission uncertainty stops later requests and cannot recover a partial list as success', async (t) => {
  const f = await fixture(t, 'second-submit-lost'), events = [];
  f.config.workflow['5'].inputs.batch_size = 4;
  await assert.rejects(generateComfyui({ prompt: 'four images' }, { config: f.config, workspace: f.root, multiple: true, onProgress: (event) => events.push(event) }), /提交状态未知/);
  assert.equal(f.state.submissions.length, 2);
  const sequence = events.filter((event) => event.type === 'metadata').at(-1).metadata.comfyui.sequence;
  assert.equal(sequence.count, 4);
  assert.equal(sequence.requests.length, 2);
  await assert.rejects(recoverComfyuiImage(f.config, { count: sequence.count, promptIds: sequence.requests.map((request) => request.promptId || request.requestedPromptId) }, { multiple: true }), /尚未全部提交/);
  assert.equal(f.state.submissions.length, 2);
});

test('ComfyUI sequential cancellation stops the active request and never submits the remainder', async (t) => {
  const f = await fixture(t, 'second-running'), controller = new AbortController();
  f.config.workflow['5'].inputs.batch_size = 4;
  await assert.rejects(generateComfyui({ prompt: 'four images' }, {
    config: f.config, workspace: f.root, multiple: true, signal: controller.signal,
    onProgress(event) { if (f.state.submissions.length === 2 && event.type === 'progress' && event.message.includes('正在执行')) controller.abort(); },
  }), /已停止/);
  assert.equal(f.state.submissions.length, 2);
  assert.deepEqual(f.state.cancellations, [f.state.submissions[1].prompt_id]);
  assert.ok(!f.state.requests.some((request) => request.path === '/interrupt'));
});

for (const [mode, error] of [["submit-error", /模型文件不存在/], ["lost-response", /提交状态未知/], ["run-error", /显存不足/], ["no-image", /没有返回图片/], ["multiple", /2 张图片/], ["bad-image", /不是有效的单张/], ["deleted", /不在队列或历史/]]) {
  test(`ComfyUI ${mode} is reported without resubmitting or switching executors`, async (t) => {
    const f = await fixture(t, mode), events = [];
    await assert.rejects(generateComfyui({ prompt: "test" }, { config: f.config, workspace: f.root, onProgress: (event) => events.push(event) }), error);
    assert.equal(f.state.submissions.length, 1);
    assert.equal(events.some((event) => event.type === "submitted"), !["submit-error", "lost-response"].includes(mode));
  });
}

test("ComfyUI read retries query the original job and reject unsupported input before submission", async (t) => {
  const f = await fixture(t, "read-retry");
  await generateComfyui({ prompt: "test" }, { config: f.config, workspace: f.root });
  assert.equal(f.state.submissions.length, 1); assert.equal(f.state.historyReads, 3);
  for (const value of [{ prompt: "test", referencePaths: ["one.png", "two.png"] }, { prompt: "test", size: "auto" }, { prompt: null }]) {
    await assert.rejects(generateComfyui(value, { config: f.config, workspace: f.root }), /只接受/);
  }
  const stopped = AbortSignal.abort();
  await assert.rejects(generateComfyui({ prompt: "test" }, { config: f.config, workspace: f.root, signal: stopped }));
  assert.equal(f.state.submissions.length, 1);
});

for (const mode of ["running", "old-cancel", "delayed-submit"]) test(`ComfyUI ${mode} stop cancels only its own job`, async (t) => {
  const f = await fixture(t, mode), controller = new AbortController();
  const result = generateComfyui({ prompt: "test" }, { config: f.config, workspace: f.root, signal: controller.signal,
    onProgress: (event) => { if (event.type === "progress" && event.message.includes("正在执行")) controller.abort(); } });
  const rejected = assert.rejects(result, /已停止/);
  if (mode === "delayed-submit") {
    while (!f.state.releaseSubmission) await sleep(10);
    controller.abort(); f.state.releaseSubmission();
  }
  await rejected;
  assert.deepEqual(mode === "old-cancel" ? f.state.deletions : f.state.cancellations, [f.state.promptId]);
  assert.ok(!f.state.requests.some((r) => r.path === "/interrupt"));
  assert.ok(!f.state.deletions.includes(f.state.otherId));
  assert.equal(f.state.submissions.length, 1);
});

async function wikiFixture(t, f) {
  const config = defaultOrganizationConfig();
  config.executor.codexCli.executable = path.join(f.root, "app-server.mjs");
  config.imageGeneration = { ...config.imageGeneration, executor: "comfyui", comfyui: f.config };
  await writeFile(config.executor.codexCli.executable, await readFile(new URL("../fixtures/chat-app-server.txt", import.meta.url)));
  await writeFile(path.join(f.root, "organization.json"), JSON.stringify(config));
  const app = await createServer({ port: 0, dataDir: f.root });
  f.cleanup.push(() => app.close());
  const api = async (route, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(new URL(`api/${route}`, app.url), { method, headers: { "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
  };
  return { app, api, config };
}





test("organization config preserves legacy templates and accepts address-only setup", async (t) => {
  const f = await fixture(t), w = await wikiFixture(t, f);
  w.config.imageGeneration.comfyui.workflow["6"]._meta.description = "字".repeat(30000);
  const saved = await w.api("organization/config", w.config, "PUT");
  assert.equal(saved.config.imageGeneration.comfyui.workflow["6"]._meta.description.length, 30000);
  w.config.imageGeneration.comfyui.prompt = null;
  const response = await fetch(new URL("api/organization/config", w.app.url), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(w.config) });
  assert.equal(response.status, 200);
  assert.equal((await w.api("organization/status")).config.imageGeneration.comfyui.prompt, null);
});

const browserPath = resolveBrowserPath();

test('runtime resolution choices follow aspect ratio and submit the matching preset', { timeout: 30000, skip: !browserPath && 'Browser required' }, async (t) => {
  const f = await fixture(t);
  const groups = { '16:9': ['1280×720', '1920×1080'], '9:16': ['720×1280', '1080×1920'], '1:1': ['1024×1024', '1536×1536'] };
  nodeInfo.CharacterVideoImageSize = { input: { required: {
    '画幅比例': [Object.keys(groups)], '分辨率档位': [[...Object.values(groups).flat(), '自定义'], { sizes_by_ratio: groups }],
    '自定义宽': ['INT', { min: 64, max: 8192 }], '自定义高': ['INT', { min: 64, max: 8192 }],
  } }, output: ['INT', 'INT', 'STRING'] };
  t.after(() => { delete nodeInfo.CharacterVideoImageSize; });
  f.state.canvas.nodes.push({ id: 13, type: 'CharacterVideoImageSize', inputs: [], widgets_values: ['9:16', '1920×1080', 1280, 720] });
  f.state.canvas.nodes.find((node) => node.id === 5).inputs = [{ name: 'width', link: 20 }, { name: 'height', link: 21 }];
  f.state.canvas.links.push([20, 13, 0, 5, 0, 'INT'], [21, 13, 1, 5, 1, 'INT']);
  const w = await wikiFixture(t, f), record = await w.api('workflows/adapters/comfyui/load', { path: f.state.path });
  assert.deepEqual(record.fields.find((field) => field.input === '分辨率档位').optionsByInput, { input: '画幅比例', values: groups });
  const config = { workflow: record.workflow, workflowName: f.state.path, prompt: record.prompt, outputNodeId: record.outputNodeId, imageInputs: [] };
  const references = [];
  for (const [width, height] of [[400, 700], [700, 400]]) {
    const response = await fetch(new URL('api/workflow-input-images', w.app.url), { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'reference.png' }, body: await sharp({ create: { width, height, channels: 3, background: 'red' } }).png().toBuffer() });
    assert.ok(response.ok); references.push(await response.json());
  }
  const created = await w.api('workflows', { name: '分辨率联动测试', definition: { schemaVersion: 1, nodes: [n('reference', 'element', { source: 'fixed', parameter: 'reference', valueType: 'list<image>', default: references }), n('generate', 'image.generate', { adapterId: 'comfyui', adapterConfig: config }, { prompt: c('same prompt'), images: c([]) })], outputs: {} }, requestKey: randomUUID() });
  const browser = await chromium.launch({ executablePath: browserPath, headless: true }); f.cleanup.push(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }); page.setDefaultTimeout(10000);
  await page.goto(`${w.app.url}#workflow`);
  await page.locator('.workflow-home-card').filter({ hasText: '分辨率联动测试' }).getByRole('button', { name: '运行', exact: true }).click();
  await page.getByRole('button', { name: '调整本次生图参数', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '本次生图参数', exact: true });
  const ratio = dialog.getByLabel(/^工作流参数 .*→ 画幅比例$/), size = dialog.getByLabel(/^工作流参数 .*→ 分辨率档位$/);
  const width = dialog.getByLabel(/^工作流参数 .*→ 自定义宽$/), height = dialog.getByLabel(/^工作流参数 .*→ 自定义高$/);
  await page.waitForFunction(() => [...document.querySelectorAll('select')].some((select) => select.getAttribute('aria-label')?.endsWith('→ 分辨率档位') && select.value === JSON.stringify('1080×1920')));
  assert.deepEqual(await size.locator('option').allTextContents(), ['720×1280', '1080×1920', '自定义']);
  assert.equal(await width.count(), 0);
  assert.equal(await height.count(), 0);
  await ratio.selectOption(JSON.stringify('16:9'));
  assert.equal(await size.inputValue(), JSON.stringify('1920×1080'));
  await size.selectOption(JSON.stringify('1280×720'));
  await ratio.selectOption(JSON.stringify('9:16'));
  assert.equal(await size.inputValue(), JSON.stringify('720×1280'));
  await size.selectOption(JSON.stringify('自定义'));
  assert.equal(await width.isEnabled(), true);
  assert.equal(await height.isEnabled(), true);
  await width.fill('1600');
  await height.fill('900');
  await size.selectOption(JSON.stringify('1080×1920'));
  await width.waitFor({ state: 'detached' });
  assert.equal(await height.count(), 0);
  await size.selectOption(JSON.stringify('自定义'));
  assert.equal(await width.inputValue(), '1600');
  assert.equal(await height.inputValue(), '900');
  await width.fill('');
  await dialog.getByText('请输入数值', { exact: true }).waitFor();
  await size.selectOption(JSON.stringify('720×1280'));
  await width.waitFor({ state: 'detached' });
  assert.equal(await dialog.locator('[aria-invalid="true"]').count(), 0);
  await size.selectOption(JSON.stringify('自定义'));
  assert.equal(await width.inputValue(), '1600');
  assert.equal(await height.inputValue(), '900');
  await ratio.selectOption(JSON.stringify('1:1'));
  assert.equal(await size.inputValue(), JSON.stringify('自定义'));
  await ratio.selectOption(JSON.stringify('9:16'));
  await size.selectOption(JSON.stringify('1080×1920'));
  await width.waitFor({ state: 'detached' });
  assert.equal(await height.count(), 0);
  const reference = dialog.getByLabel('匹配用的参考图', { exact: true });
  await reference.selectOption('reference:1');
  await dialog.getByRole('button', { name: '按参考图匹配', exact: true }).click();
  await dialog.getByRole('status').filter({ hasText: '700×400' }).waitFor();
  assert.equal(await ratio.inputValue(), JSON.stringify('16:9'));
  assert.equal(await size.inputValue(), JSON.stringify('1920×1080'));
  await reference.selectOption('reference:0');
  await dialog.getByRole('button', { name: '按参考图匹配', exact: true }).click();
  await dialog.getByRole('status').filter({ hasText: '400×700' }).waitFor();
  assert.equal(await ratio.inputValue(), JSON.stringify('9:16'));
  assert.equal(await size.inputValue(), JSON.stringify('1080×1920'));
  await page.screenshot({ path: '.local/comfyui-reference-match.png', fullPage: true });
  await dialog.getByRole('button', { name: '应用到本次运行', exact: true }).click();
  await page.getByRole('button', { name: '开始运行', exact: true }).click();
  await page.locator('.workflow-run h2 [data-state="succeeded"]').waitFor();
  assert.equal(f.state.submissions[0].prompt['13'].inputs['画幅比例'], '9:16');
  assert.equal(f.state.submissions[0].prompt['13'].inputs['分辨率档位'], '1080×1920');
  assert.equal(f.state.submissions[0].prompt['13'].inputs['自定义宽'], 1600);
  assert.equal(f.state.submissions[0].prompt['13'].inputs['自定义高'], 900);
  assert.deepEqual((await w.api(`workflows/${created.id}`)).definition, created.definition);
});

for (const recover of [false, true]) test(`workflow generates multiple images and reviews them individually (${recover ? 'recover interrupted download' : 'normal completion'})`, { timeout: 30000, skip: !browserPath && 'Browser required' }, async (t) => {
  const f = await fixture(t, recover ? 'sequential-second-error' : 'sequential'), w = await wikiFixture(t, f);
  const record = await w.api('workflows/adapters/comfyui/load', { path: f.state.path });
  const adapterConfig = { workflow: record.workflow, workflowName: f.state.path, prompt: record.prompt, outputNodeId: record.outputNodeId, promptMode: 'input', imageInputs: [] };
  const created = await w.api('workflows', { name: '多张生成测试', definition: { schemaVersion: 1, nodes: [
    n('generate', 'image.generate', { adapterId: 'comfyui', adapterConfig }, { prompt: c('two images'), images: c([]) }),
    n('check', 'review', { valueType: 'list<image>' }, { value: o('generate') }),
  ], outputs: {} }, requestKey: randomUUID() });
  const browser = await chromium.launch({ executablePath: browserPath, headless: true }); f.cleanup.push(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }); page.setDefaultTimeout(10000);
  await page.goto(`${w.app.url}#workflow`);
  await page.locator('.workflow-home-card').filter({ hasText: '多张生成测试' }).getByRole('button', { name: '运行', exact: true }).click();
  await page.getByRole('button', { name: '调整本次生图参数', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '本次生图参数', exact: true });
  const count = dialog.getByLabel(/^工作流参数 .*→ batch_size$/);
  await count.waitFor();
  assert.equal(await count.isVisible(), true, 'image count is visible among common parameters');
  await count.fill('17');
  await dialog.getByRole('button', { name: '应用到本次运行', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: '请修正' }).waitFor();
  assert.equal(f.state.submissions.length, 0);
  await count.fill('2');
  await dialog.getByRole('button', { name: '应用到本次运行', exact: true }).click();
  await page.getByRole('button', { name: '开始运行', exact: true }).click();
  if (recover) {
    await page.locator('.workflow-run h2 [data-state="needs_attention"]').waitFor();
    assert.equal(await page.locator('.workflow-review-images').count(), 0, 'partial downloads cannot reach review');
    f.state.mode = 'sequential';
    await page.getByRole('button', { name: '核对并取回结果', exact: true }).click();
  }
  const cards = page.locator('.workflow-review-images');
  await cards.getByRole('checkbox', { name: '保留图片 2' }).waitFor();
  assert.equal(await cards.locator('.workflow-review-image').count(), 2);
  assert.equal(f.state.submissions.length, 2, 'generation uses two single-image tasks; recovery submits neither again');
  assert.ok(f.state.submissions.every((request) => request.prompt['5'].inputs.batch_size === 1));
  await cards.getByRole('checkbox', { name: '保留图片 2' }).uncheck();
  await page.getByRole('button', { name: '通过选中的 1 / 2 张', exact: true }).click();
  await page.locator('.workflow-run h2 [data-state="succeeded"]').waitFor();
  const workflow = await w.api(`workflows/${created.id}`), run = await w.api(`workflow-runs/${workflow.runs[0].id}`);
  const generated = await w.api(`workflow-artifacts/${run.instances.find((i) => i.nodeId === 'generate').outputs.value}?runId=${run.id}`);
  const accepted = await w.api(`workflow-artifacts/${run.instances.find((i) => i.nodeId === 'check').outputs.value}?runId=${run.id}`);
  assert.equal(generated.value.length, 2);
  assert.deepEqual(accepted.value, [generated.value[0]], 'only the selected image continues downstream');
  assert.deepEqual(workflow.definition, created.definition, 'runtime count does not change workflow defaults');
});

test('run-time ComfyUI parameters stay local to the run and regeneration reuses upstream results', { timeout: 45000, skip: !browserPath && 'Browser required' }, async (t) => {
  const f = await fixture(t), w = await wikiFixture(t, f);
  const record = await w.api('workflows/adapters/comfyui/load', { path: f.state.path });
  const adapterConfig = { workflow: record.workflow, workflowName: f.state.path, prompt: record.prompt, outputNodeId: record.outputNodeId, promptMode: 'input', imageInputs: [] };
  const nodes = [n('text', 'element', { source: 'fixed', parameter: 'text', valueType: 'text', default: '沿用这段提示词' }),
    n('generate', 'image.generate', { adapterId: 'comfyui', adapterConfig }, { prompt: o('text'), images: c([]) })];
  const created = await w.api('workflows', { name: '本次参数测试', definition: { schemaVersion: 1, nodes, outputs: {} }, requestKey: randomUUID() });
  const browser = await chromium.launch({ executablePath: browserPath, headless: true }); f.cleanup.push(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${w.app.url}#workflow`);
  await page.locator('.workflow-home-card').filter({ hasText: '本次参数测试' }).getByRole('button', { name: '运行', exact: true }).click();
  await page.getByRole('button', { name: '调整本次生图参数', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '本次生图参数', exact: true });
  const parameter = (key) => dialog.getByLabel(new RegExp(`^工作流参数 .*→ ${key}$`));
  await parameter('seed').fill('123');
  await parameter('width').fill('768');
  assert.equal(await dialog.getByLabel('ComfyUI 工作流', { exact: true }).count(), 0, 'runtime editing cannot switch the workflow or bindings');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(f.state.submissions.length, 0, 'opening and cancelling parameters never submits a task');
  await page.getByRole('button', { name: '调整本次生图参数', exact: true }).click();
  assert.notEqual(await parameter('seed').inputValue(), '123', 'cancel discards edits');
  await parameter('seed').fill('123'); await parameter('width').fill('768');
  await dialog.getByLabel(/^种子模式 /).selectOption('fixed');
  await parameter('width').fill('0');
  await dialog.getByRole('button', { name: '应用到本次运行', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: '请修正' }).waitFor();
  await parameter('width').fill('768');
  await page.screenshot({ path: '.local/workflow-runtime-parameters.png', fullPage: true });
  await dialog.getByRole('button', { name: '应用到本次运行', exact: true }).click();
  await page.getByRole('button', { name: '开始运行', exact: true }).click();
  await page.locator('.workflow-run h2 [data-state="succeeded"]').waitFor();
  assert.equal(f.state.submissions.length, 1);
  assert.equal(f.state.submissions[0].prompt['3'].inputs.seed, 123);
  assert.equal(f.state.submissions[0].prompt['5'].inputs.width, 768);
  assert.equal(f.state.submissions[0].prompt['6'].inputs.text, '沿用这段提示词');
  const saved = await w.api(`workflows/${created.id}`), parentId = saved.runs[0].id;
  const parent = await w.api(`workflow-runs/${parentId}`);
  assert.equal(saved.revision, created.revision);
  assert.deepEqual(saved.definition, created.definition, 'temporary parameters never change the saved draft');
  const result = page.locator('.workflow-run-results .workflow-node-result[data-node-id="generate"]');
  await result.locator('.workflow-result-heading').click();
  await result.getByRole('button', { name: '调整本次生图参数', exact: true }).click();
  assert.equal(await parameter('seed').inputValue(), '123', 'regeneration starts from the executed parameters');
  await parameter('seed').fill('456'); await parameter('width').fill('1024');
  await dialog.getByRole('button', { name: '应用到本次运行', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(f.state.submissions.length, 1, 'saving parameters does not generate');
  assert.equal((await w.api(`workflows/${created.id}`)).runs.length, 1, 'saving parameters does not create a run');
  await page.getByRole('region', { name: '运行设置', exact: true }).getByText('已修改 1 个节点', { exact: true }).waitFor();
  await result.getByRole('button', { name: '调整本次生图参数', exact: true }).click();
  assert.equal(await parameter('seed').inputValue(), '456', 'saved pending parameters reopen for editing');
  await parameter('seed').fill('789');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('region', { name: '运行设置', exact: true }).getByRole('button', { name: '运行', exact: true }).click();
  await page.waitForFunction((id) => !document.querySelector('.workflow-run h2')?.textContent.includes(`#${id} `), parentId);
  await page.locator('.workflow-run h2 [data-state="succeeded"]').waitFor();
  assert.equal(f.state.submissions.length, 2);
  assert.equal(f.state.submissions[1].prompt['3'].inputs.seed, 456);
  assert.equal(f.state.submissions[1].prompt['5'].inputs.width, 1024);
  assert.equal(f.state.submissions[1].prompt['6'].inputs.text, '沿用这段提示词');
  const latest = await w.api(`workflows/${created.id}`), child = await w.api(`workflow-runs/${latest.runs[0].id}`);
  assert.equal(child.parentId, parentId);
  assert.deepEqual(child.rootInstances.find((i) => i.nodeId === 'text').outputs, parent.rootInstances.find((i) => i.nodeId === 'text').outputs, 'upstream text is reused');
  assert.deepEqual(latest.definition, created.definition);
  assert.deepEqual((await w.api(`workflow-runs/${parentId}`)).definition, parent.definition, 'parent parameters and output remain immutable');
  await page.locator('.workflow-run-results .workflow-node-result[data-node-id="generate"] .workflow-result-heading').click();
  await page.getByRole('button', { name: '调整本次生图参数', exact: true }).click();
  await dialog.getByLabel(/^种子模式 /).selectOption('randomize');
  await dialog.getByRole('button', { name: '应用到本次运行', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(f.state.submissions.length, 2, 'saving random mode still does not generate');
  await page.getByRole('button', { name: '取消修改', exact: true }).click();
  await page.getByRole('button', { name: '调整本次生图参数', exact: true }).click();
  assert.equal(await dialog.getByLabel(/^种子模式 /).inputValue(), 'fixed', 'reset restores the executed parameters');
  await dialog.getByLabel(/^种子模式 /).selectOption('randomize');
  await dialog.getByRole('button', { name: '应用到本次运行', exact: true }).click();
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await page.waitForFunction((id) => !document.querySelector('.workflow-run h2')?.textContent.includes(`#${id} `), child.id);
  await page.locator('.workflow-run h2 [data-state="succeeded"]').waitFor();
  const randomRun = (await w.api(`workflows/${created.id}`)).runs[0].id;
  await page.locator('.workflow-run-results .workflow-node-result[data-node-id="generate"] .workflow-result-heading').click();
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await page.waitForFunction((id) => !document.querySelector('.workflow-run h2')?.textContent.includes(`#${id} `), randomRun);
  await page.locator('.workflow-run h2 [data-state="succeeded"]').waitFor();
  assert.equal(f.state.submissions.length, 4);
  assert.notEqual(f.state.submissions[2].prompt['3'].inputs.seed, f.state.submissions[3].prompt['3'].inputs.seed, 'plain redo honors the random mode');
  assert.deepEqual(errors, []);
});

test('workflow image nodes select saved ComfyUI workflows and explicitly map prompt, image input and output', { timeout: 30000, skip: !browserPath && 'Browser required' }, async (t) => {
  const f = await fixture(t); f.state.canvas = imageCanvas();
  const w = await wikiFixture(t, f), browser = await chromium.launch({ executablePath: browserPath, headless: true }); f.cleanup.push(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${w.app.url}#workflow`);
  await page.getByRole('button', { name: '新建工作流', exact: true }).click();
  await page.getByRole('button', { name: '从空白开始搭建', exact: true }).click();
  await page.locator('.workflow-canvas').waitFor();
  await page.locator('.workflow-palette').getByRole('button', { name: /^AI 生成图片/ }).click();
  await page.locator('.workflow-inspector select').first().waitFor();
  await page.getByLabel('使用的 AI', { exact: true }).selectOption('comfyui');
  assert.equal(await page.getByLabel('ComfyUI 工作流', { exact: true }).count(), 0, 'the sidebar contains only the summary and dialog trigger');
  await page.getByRole('button', { name: '配置 ComfyUI', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '配置 ComfyUI', exact: true });
  await dialog.waitFor();
  const chooser = page.getByLabel('ComfyUI 工作流', { exact: true });
  assert.equal(await page.locator('.workflow-binding input[type="file"]').count(), 0);
  await page.getByRole('button', { name: '刷新工作流列表', exact: true }).click();
  await chooser.locator('option[value="文生图/水彩.json"]').waitFor({ state: 'attached' });
  await chooser.selectOption('文生图/水彩.json');
  await page.getByLabel('ComfyUI 图片输出节点', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('ComfyUI 提示词字段', { exact: true }).inputValue(), JSON.stringify({ nodeId: '6', input: 'text' }), 'the explicitly titled positive field is detected');
  assert.equal(await page.getByLabel('ComfyUI 图片输出节点', { exact: true }).inputValue(), '9', 'unique output needs no extra choice');
  await page.getByLabel('ComfyUI 提示词字段', { exact: true }).selectOption(JSON.stringify({ nodeId: '6', input: 'text' }));
  assert.equal(await page.getByLabel('第 1 张参考图入口', { exact: true }).inputValue(), '72', 'unique image input needs no extra choice');
  assert.equal(await page.getByRole('button', { name: '添加参考图映射', exact: true }).isDisabled(), true);
  const parameter = (name) => page.getByLabel(new RegExp(`^工作流参数 .*#3 → ${name}$`));
  await parameter('seed').fill('777'); await parameter('seed').blur();
  await dialog.getByLabel(/^种子模式 /).selectOption('fixed');
  await parameter('steps').fill('12'); await parameter('steps').blur();
  await parameter('cfg').fill('4.5'); await parameter('cfg').blur();
  await parameter('sampler_name').selectOption(JSON.stringify('dpmpp_2m'));
  await parameter('steps').fill('0'); await parameter('steps').blur();
  assert.equal(await parameter('steps').inputValue(), '0', 'invalid edits remain visible');
  assert.equal(await parameter('steps').getAttribute('aria-invalid'), 'true');
  await page.getByRole('alert').filter({ hasText: '不能小于 1' }).waitFor();
  await page.getByRole('button', { name: '应用到节点', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '请修正' }).waitFor();
  assert.equal(f.state.submissions.length, 0);
  await parameter('steps').fill('12');
  assert.equal(await parameter('steps').getAttribute('aria-invalid'), 'false');
  assert.equal(await page.getByLabel(/^工作流参数 .*#6 → text$/).count(), 0, 'mapped prompt is edited only in its binding');
  assert.equal(f.state.submissions.length, 0, 'choosing mappings must not submit a job');
  await page.screenshot({ path: '.local/workflow-comfyui-mappings.png' });
  await page.getByRole('button', { name: '应用到节点', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByLabel('提示词', { exact: true }).fill('指定字段的文字');
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await page.getByRole('button', { name: '开始运行', exact: true }).click();
  await page.locator('.workflow-run h2 [data-state="succeeded"]').waitFor();
  assert.equal(f.state.submissions[0].prompt['6'].inputs.text, '指定字段的文字');
  assert.equal(f.state.submissions[0].prompt['7'].inputs.text, 'original negative');
  assert.equal(f.state.submissions[0].prompt['72'].inputs.image, 'unrelated.png', 'without reference images keep workflow input');
  assert.equal(f.state.submissions[0].prompt['3'].inputs.seed, 777);
  assert.equal(f.state.submissions[0].prompt['3'].inputs.steps, 12);
  assert.equal(f.state.submissions[0].prompt['3'].inputs.cfg, 4.5);
  assert.equal(f.state.submissions[0].prompt['3'].inputs.sampler_name, 'dpmpp_2m');
  assert.deepEqual(f.state.submissions[0].prompt['3'].inputs.positive, ['6', 0], 'parameter editing preserves graph links');
  await page.getByRole('button', { name: '修改流程', exact: true }).click();
  await page.locator('.react-flow__node').click();
  await page.getByRole('button', { name: '配置 ComfyUI', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('input')].some((input) => input.getAttribute('aria-label')?.endsWith('#3 → seed')));
  assert.equal(await parameter('seed').inputValue(), '777', 'reopening preserves parameters and refreshes definitions');
  await parameter('seed').fill('888');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '配置 ComfyUI', exact: true }).click();
  await parameter('seed').waitFor();
  assert.equal(await parameter('seed').inputValue(), '777', 'cancel discards dialog edits');
  await page.getByRole('button', { name: '取消', exact: true }).focus();
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('.react-flow__node').count(), 1, 'modal shortcuts do not undo the underlying workflow');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: '配置 ComfyUI', exact: true }).evaluate((node) => node === document.activeElement), true, 'Escape closes the modal and restores focus');
  await page.getByRole('button', { name: '配置 ComfyUI', exact: true }).click();
  assert.equal(await page.getByLabel('第 1 张参考图入口', { exact: true }).inputValue(), '72');
  await page.getByLabel('ComfyUI 提示词来源', { exact: true }).selectOption('workflow');
  await page.getByRole('button', { name: '应用到节点', exact: true }).click();
  assert.equal(await page.getByLabel('提示词', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await page.getByRole('button', { name: '开始运行', exact: true }).click();
  await page.locator('.workflow-run h2 [data-state="succeeded"]').waitFor();
  assert.equal(f.state.submissions[1].prompt['6'].inputs.text, 'original positive');
  assert.equal(f.state.submissions[1].prompt['7'].inputs.text, 'original negative');
  assert.equal(f.state.submissions[1].prompt['3'].inputs.seed, 777);
  assert.deepEqual(errors, []);
});

test("saved canvas conversion preserves links, seed controls, widget order and explicit ambiguous mappings", () => {
  const converted = convertComfyuiWorkflow(canvas, nodeInfo);
  for (const [id, node] of Object.entries(configuredComfyuiWorkflow(configuration()))) assert.deepEqual(converted[id].inputs, node.inputs);
  const description = describeComfyuiWorkflow(converted, nodeInfo);
  assert.deepEqual(description.prompt, { nodeId: "6", input: "text" });
  assert.equal(description.outputNodeId, "9");
  assert.ok(description.fields.some((field) => field.input === "width" && field.value === 32));
  assert.equal(description.fields.some((field) => field.input === "positive"), false, "Connected inputs are not editable parameters");
  const ambiguous = structuredClone(converted); delete ambiguous["6"]._meta;
  assert.equal(describeComfyuiWorkflow(ambiguous, nodeInfo).prompt, null);
  const unsupported = structuredClone(canvas); unsupported.nodes[0].widgets_values.push("custom extension widget");
  assert.throws(() => convertComfyuiWorkflow(unsupported, nodeInfo), /节点 3.*控件数量/);
  const broken = structuredClone(canvas); broken.links[0][3] = 999;
  assert.throws(() => convertComfyuiWorkflow(broken, nodeInfo), /连线不完整/);
  const bypass = structuredClone(canvas); bypass.nodes[0].mode = 4;
  assert.deepEqual(convertComfyuiWorkflow(bypass, nodeInfo)["8"].inputs.samples, ["5", 0]);
  assert.equal(convertComfyuiWorkflow(bypass, nodeInfo)["3"], undefined);
  const ordered = structuredClone(nodeInfo);
  ordered.EmptyLatentImage.input.required = { batch_size: ["INT"], height: ["INT"], width: ["INT"] };
  ordered.EmptyLatentImage.input_order = { required: ["width", "height", "batch_size"] };
  assert.deepEqual(convertComfyuiWorkflow(canvas, ordered)["5"].inputs, template["5"].inputs);
});

test("ComfyUI keeps workflow prompts for blank input and uploads only to the reachable image input", async (t) => {
  const f = await fixture(t), events = [];
  f.config.workflow = { ...convertComfyuiWorkflow(imageCanvas(), nodeInfo), 99: template["99"], 100: template["100"] };
  const original = structuredClone(f.config), file = path.join(f.root, "reference.png");
  await writeFile(file, f.png);
  await generateComfyui({ prompt: "  \n", referencePaths: [file] }, { config: f.config, workspace: f.root, onProgress: (event) => events.push(event) });
  assert.equal(f.state.submissions.length, 1); assert.equal(f.state.uploads.length, 1);
  const upload = f.state.uploads[0], sent = f.state.submissions[0].prompt;
  assert.deepEqual(upload.bytes, f.png); assert.equal(upload.type, "input"); assert.equal(upload.overwrite, null);
  assert.equal(sent["72"].inputs.image, `self-wiki/${upload.name}`);
  assert.equal(sent["6"].inputs.text, "original positive"); assert.equal(sent["7"].inputs.text, "original negative");
  assert.equal(sent["100"], undefined); assert.deepEqual(f.config, original);
  assert.equal(events.find((event) => event.type === "prepared_prompt").prompt, "original positive");
  const metadata = events.filter((event) => event.type === "metadata").at(-1).metadata.comfyui;
  assert.equal(metadata.promptSource, "workflow"); assert.equal(metadata.referenceImage.nodeId, "72");
  assert.equal(metadata.referenceImage.sha256.length, 64);
  await generateComfyui({ prompt: "" }, { config: f.config, workspace: f.root });
  assert.equal(f.state.uploads.length, 1);
  assert.equal(f.state.submissions[1].prompt["72"].inputs.image, "unrelated.png");
});

test('explicit multi-image mappings route each image to its chosen node and preserve all other workflow values', async (t) => {
  const f = await fixture(t), events = [];
  f.config.workflow = convertComfyuiWorkflow(imageCanvas(), nodeInfo);
  f.config.workflow['3']._meta.seedControls.seed.mode = 'fixed';
  f.config.workflow['73'] = { class_type: 'LoadImage', inputs: { image: 'second-original.png' } };
  f.config.workflow['74'] = { class_type: 'LoadImage', inputs: { image: 'keep-original.png' } };
  f.config.workflow['20'] = { class_type: 'ImageBlend', inputs: { image1: ['72', 0], image2: ['73', 0], blend_factor: 0.5 } };
  f.config.workflow['21'] = { class_type: 'ImageBlend', inputs: { image1: ['20', 0], image2: ['74', 0], blend_factor: 0.5 } };
  f.config.workflow['5'].inputs.pixels = ['21', 0];
  f.config.imageInputs = [{ nodeId: '73', input: 'image' }, { nodeId: '72', input: 'image' }];
  const original = structuredClone(f.config), second = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } }).png().toBuffer();
  await writeFile(path.join(f.root, 'first.png'), f.png); await writeFile(path.join(f.root, 'second.png'), second);
  await generateComfyui({ prompt: '指定的新提示词', referencePaths: ['first.png', 'second.png'] }, { config: f.config, workspace: f.root, onProgress: (event) => events.push(event) });
  const sent = f.state.submissions[0].prompt;
  assert.deepEqual(f.state.uploads.map((entry) => entry.bytes), [f.png, second]);
  assert.equal(sent['73'].inputs.image, `self-wiki/${f.state.uploads[0].name}`);
  assert.equal(sent['72'].inputs.image, `self-wiki/${f.state.uploads[1].name}`);
  assert.equal(sent['74'].inputs.image, 'keep-original.png');
  assert.equal(sent['6'].inputs.text, '指定的新提示词'); assert.equal(sent['7'].inputs.text, 'original negative');
  assert.equal(sent['3'].inputs.seed, original.workflow['3'].inputs.seed);
  assert.deepEqual(f.config, original, 'do not alter the stored template');
  assert.deepEqual(events.filter((event) => event.type === 'metadata').at(-1).metadata.comfyui.referenceImages.map((entry) => entry.nodeId), ['73', '72']);
  await assert.rejects(generateComfyui({ prompt: 'test', referencePaths: ['first.png'] }, { config: f.config, workspace: f.root }), /数量/);
  assert.throws(() => comfyuiConfig({ ...f.config, imageInputs: [{ nodeId: '73', input: 'image' }, { nodeId: '73', input: 'image' }] }), /独立 LoadImage/);
  assert.equal(f.state.uploads.length, 2); assert.equal(f.state.submissions.length, 1);
});

test('retaining the original ComfyUI prompt needs no guessed text-field mapping', async (t) => {
  const f = await fixture(t);
  f.config.prompt = null; f.config.imageInputs = [];
  await generateComfyui({ prompt: '' }, { config: f.config, workspace: f.root });
  assert.equal(f.state.submissions[0].prompt['6'].inputs.text, 'original positive');
  assert.equal(f.state.submissions[0].prompt['7'].inputs.text, 'original negative');
});

test("ComfyUI rejects ambiguous image inputs and unsafe files before uploading or submitting", async (t) => {
  const f = await fixture(t), file = path.join(f.root, "reference.png");
  await writeFile(file, f.png);
  await assert.rejects(generateComfyui({ prompt: "", referencePaths: [file] }, { config: f.config, workspace: f.root }), /没有 LoadImage/);
  f.config.workflow = convertComfyuiWorkflow(imageCanvas(), nodeInfo);
  await assert.rejects(generateComfyui({ prompt: "", referencePaths: [path.resolve("test/fixtures/comfyui-canvas.json")] }, { config: f.config, workspace: f.root }), /工作目录内/);
  await writeFile(path.join(f.root, "invalid.png"), "not an image");
  await assert.rejects(generateComfyui({ prompt: "", referencePaths: ["invalid.png"] }, { config: f.config, workspace: f.root }), /参考图必须/);
  f.config.workflow["73"] = structuredClone(f.config.workflow["72"]);
  f.config.workflow["20"] = { class_type: "ImageBlend", inputs: { image1: ["72", 0], image2: ["73", 0], blend_factor: 0.5 } };
  f.config.workflow["5"].inputs.pixels = ["20", 0];
  await assert.rejects(generateComfyui({ prompt: "", referencePaths: [file] }, { config: f.config, workspace: f.root }), /多个 LoadImage/);
  assert.equal(f.state.uploads.length, 0); assert.equal(f.state.submissions.length, 0);
});

for (const mode of ["upload-error", "upload-mismatch"]) test(`ComfyUI ${mode} never submits a generation`, async (t) => {
  const f = await fixture(t, mode);
  f.config.workflow = convertComfyuiWorkflow(imageCanvas(), nodeInfo);
  await writeFile(path.join(f.root, "reference.png"), f.png);
  await assert.rejects(generateComfyui({ prompt: "", referencePaths: ["reference.png"] }, { config: f.config, workspace: f.root }), /上传失败|上传不符/);
  assert.equal(f.state.uploads.length, 1); assert.equal(f.state.submissions.length, 0);
});

test("disabled reference branches omit optional inputs without requiring disabled node definitions", async (t) => {
  const f = await fixture(t), graph = f.state.canvas;
  graph.nodes.push({ id: 92, type: "VAEEncode", mode: 4,
    inputs: [{ name: "pixels", type: "IMAGE", link: null }, { name: "vae", type: "VAE", link: 10 }],
    outputs: [{ type: "LATENT" }] });
  graph.links.push([10, 4, 2, 92, 1, "VAE"], [11, 92, 0, 3, 4, "LATENT"]);
  graph.nodes[0].inputs.push({ name: "reference_latent", type: "LATENT", link: 11 });
  const infos = structuredClone(nodeInfo);
  infos.KSampler.input.optional = { reference_latent: ["LATENT"] };
  for (const mode of [4, 2]) {
    graph.nodes.at(-1).mode = mode;
    const result = convertComfyuiWorkflow(graph, infos);
    assert.equal(result["92"], undefined);
    assert.equal(Object.hasOwn(result["3"].inputs, "reference_latent"), false);
    assert.deepEqual(result["3"].inputs.latent_image, ["5", 0]);
  }
  graph.nodes.at(-1).mode = 4;
  delete infos.KSampler.input.optional;
  infos.KSampler.input.required.reference_latent = ["LATENT"];
  assert.throws(() => convertComfyuiWorkflow(graph, infos), /节点 3.*必填输入 reference_latent.*旁路/);
  graph.nodes[0].inputs.pop(); graph.links.pop();
  const loaded = await loadComfyuiWorkflow(f.config, { path: f.state.path });
  assert.equal(loaded.workflow["92"], undefined);
  assert.equal(f.state.requests.some((request) => request.path === "/object_info/VAEEncode"), false);
  assert.equal(f.state.submissions.length, 0);
});

test("bypass chains preserve slot preference through reroutes and reject cycles or broken links", () => {
  const graph = structuredClone(canvas);
  graph.nodes.push(
    { id: 80, type: "DisabledConditioningPair", mode: 4,
      inputs: [{ name: "first", type: "CONDITIONING", link: 10 }, { name: "second", type: "CONDITIONING", link: 11 }],
      outputs: [{ type: "CONDITIONING" }, { type: "CONDITIONING" }] },
    { id: 81, type: "DisabledConditioningFilter", mode: 4,
      inputs: [{ name: "mask", type: "MASK", link: null }, { name: "conditioning", type: "CONDITIONING", link: 12 }],
      outputs: [{ type: "CONDITIONING" }] },
    { id: 82, type: "Reroute", inputs: [{ name: "value", type: "*", link: 13 }] },
  );
  graph.links.find((link) => link[0] === 2)[1] = 82;
  graph.links.push([10, 6, 0, 80, 0, "CONDITIONING"], [11, 7, 0, 80, 1, "CONDITIONING"],
    [12, 80, 1, 81, 1, "CONDITIONING"], [13, 81, 0, 82, 0, "CONDITIONING" ]);
  const original = structuredClone(graph);
  const result = convertComfyuiWorkflow(graph, nodeInfo);
  assert.deepEqual(result["3"].inputs.positive, ["7", 0]);
  for (const id of [80, 81, 82]) assert.equal(result[id], undefined);
  assert.deepEqual(graph, original);
  graph.nodes.at(-3).inputs[1].type = "CONDITIONING,MASK";
  assert.deepEqual(convertComfyuiWorkflow(graph, nodeInfo)["3"].inputs.positive, ["7", 0]);
  graph.nodes.at(-3).inputs[1].link = null;
  assert.throws(() => convertComfyuiWorkflow(graph, nodeInfo), /必填输入 positive.*旁路/);
  graph.nodes.at(-3).inputs[1].link = 11;
  graph.links.find((link) => link[0] === 11)[3] = 999;
  assert.throws(() => convertComfyuiWorkflow(graph, nodeInfo), /连线不完整/);
  graph.links.find((link) => link[0] === 11)[3] = 80;
  graph.links.find((link) => link[0] === 11)[1] = 82;
  assert.throws(() => convertComfyuiWorkflow(graph, nodeInfo), /循环/);
});

test("disabled widget connections retain stored values while missing bypass types fail explicitly", () => {
  const graph = structuredClone(canvas);
  graph.nodes.push({ id: 80, type: "DisabledSeed", mode: 4, inputs: [], outputs: [{ type: "INT" }] });
  graph.nodes[0].inputs.push({ name: "seed", type: "INT", widget: { name: "seed" }, link: 10 });
  graph.links.push([10, 80, 0, 3, 4, "INT"]);
  for (const mode of [4, 2]) {
    graph.nodes.at(-1).mode = mode;
    const result = convertComfyuiWorkflow(graph, nodeInfo);
    assert.equal(result["3"].inputs.seed, 42);
    assert.equal(result["80"], undefined);
  }
  graph.nodes.at(-1).mode = 4;
  delete graph.nodes.at(-1).outputs;
  assert.throws(() => convertComfyuiWorkflow(graph, nodeInfo), /旁路节点 80.*缺少插槽类型/);
});
