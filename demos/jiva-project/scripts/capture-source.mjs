import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Allowlisted source excerpts only. No user database, media, config or credentials.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const specs = [
  ['content-ui','src/renderer/src/AddContentDialog.jsx','文字从哪里发出去','const element = entry.kind === "text"',1,10],
  ['content-route','src/server/http/elementRoutes.js','HTTP 接口接住创建请求','else if (method === "POST") {\n      const payload = await readJson(req);',0,8],
  ['content-service','src/server/application/elementService.js','校验内容，再交给仓储','    create(payload) {',0,7],
  ['content-store','src/server/data/elementRepository.js','正文和标签一起保存','    createText(content) {',0,4],
  ['storage-setup','src/server/server.js','数据库和媒体目录的配置','  const dataDir = path.resolve(options.dataDir',0,14],
  ['reference-entry','src/renderer/src/App.jsx','添加到资料篮','  function addReference(element) {',0,9],
  ['reference-start','src/renderer/src/App.jsx','检查资料，再创建会话','  async function startReferenceChat() {',0,16],
  ['wiki-template','src/server/application/agentWorkbench/wikiTemplate.js','把选定资料变成上下文','      const parts = [',0,11],
  ['wiki-draft','src/server/application/agentWorkbench/wikiTemplate.js','只准备草稿，不在此处调用模型','      const root = await workspace();',0,9],
  ['album-schema','src/server/data/albumMigration.js','图集的附加信息和成员','      CREATE TABLE album_meta (',0,17],
  ['album-store','src/server/data/elementRepository.js','创建和读取图集','    createAlbum({ title',0,22],
  ['album-open','src/renderer/src/WikiApp.jsx','点击后识别图集','    // Albums use a dedicated page, not ElementDetail.',0,12],
  ['album-render','src/renderer/src/WikiApp.jsx','图集与普通详情走不同页面','      {albumViewId && <AlbumPage',0,5],
  ['album-page','src/renderer/src/AlbumPage.jsx','专用页面读取图集与浏览状态','export default function AlbumPage(',0,10]
];
const gitArgs = ['-c',`safe.directory=${root.replaceAll('\\','/').replace(/\/$/,'')}`];
const baseCommit = execFileSync('git',[...gitArgs,'rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const excerpts = [];
for(const [id,file,title,needle,before,count] of specs) {
  const body = await readFile(path.join(root,file),'utf8');
  const normalized = body.replace(/\r\n/g,'\n');
  const pos = normalized.indexOf(needle);
  if(pos < 0) throw new Error('Source anchor missing: '+id);
  const lines = normalized.split('\n');
  const start = Math.max(0,normalized.slice(0,pos).split('\n').length-1-before);
  let modified = true;
  try { modified = execFileSync('git',[...gitArgs,'show',`${baseCommit}:${file}`],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).replace(/\r\n/g,'\n') !== normalized; } catch {}
  excerpts.push({id,file,title,start:start+1,end:Math.min(lines.length,start+count),code:lines.slice(start,start+count).join('\n'),fileSha256:createHash('sha256').update(body).digest('hex'),modified});
}
const snapshot={baseCommit,capturedAt:new Date().toISOString(),excerpts};
await writeFile(new URL('../dist/source-snapshot.js',import.meta.url),'window.JIVA_SOURCE = '+JSON.stringify(snapshot,null,2)+';\n');
console.log(JSON.stringify({baseCommit,excerpts:excerpts.length,modifiedExcerpts:excerpts.filter(e=>e.modified).map(e=>e.id)}));
