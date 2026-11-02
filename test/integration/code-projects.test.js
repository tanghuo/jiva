import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, symlink, access } from 'node:fs/promises';
import path from 'node:path';
import { codeProjectFixture } from '../helpers/codeProjectFixture.js';
import { createCodeProjectsService } from '../../src/server/application/codeProjects/service.js';
import { createServer, fetch } from '../helpers/authenticatedServer.js';
import { handleCodeProjectRoute } from '../../src/server/http/codeProjectRoutes.js';
import {scanProject,codeProjectLimits,canonicalProject} from '../../src/server/assets/codeProjectFiles.js';

test('local project snapshot, merges, commit files, staged/unstaged diff and close work against real Git', {timeout:60000}, async t=>{
  const f=await codeProjectFixture(t),service=createCodeProjectsService({defaultRoot:f.root});t.after(()=>service.shutdown());
  const snapshot=await service.open({path:f.root});
  assert.ok(!snapshot.files.some(f=>f.path.startsWith('.')));
  assert.equal(service.file(snapshot.id,'src/leaf.js').text.includes('return 2'),true);
  assert.throws(()=>service.file(snapshot.id,'../package.json'),{statusCode:404});
  assert.equal(snapshot.git.available,true);assert.equal(snapshot.git.commits.find(c=>c.hash===f.head).parents.length,2);
  assert.ok(snapshot.git.changes.some(c=>c.path==='src/leaf.js'&&c.staged&&!c.unstaged));
  assert.ok(snapshot.git.changes.some(c=>c.path==='src/main.js'&&!c.staged&&c.unstaged));
  const detail=await service.commit(snapshot.id,f.initial);assert.ok(detail.files.includes('src/main.js'));
  assert.match((await service.diff(snapshot.id,{file:'src/leaf.js',area:'staged'})).diff,/return 2/);
  assert.match((await service.diff(snapshot.id,{file:'src/main.js',area:'unstaged'})).diff,/leaf\(\) \+ 1/);
  assert.match((await service.diff(snapshot.id,{file:'src/main.js',hash:f.initial})).diff,/function start/);
  await assert.rejects(service.diff(snapshot.id,{file:'../.git/config',area:'unstaged'}),/无效/);
  service.close(snapshot.id);assert.throws(()=>service.file(snapshot.id,'src/main.js'),{statusCode:404});
});
test('scanner excludes outside links, hidden files and runtime data; empty Git repo still opens',async t=>{
  const f=await codeProjectFixture(t),service=createCodeProjectsService({defaultRoot:f.root});t.after(()=>service.shutdown());
  await mkdir(path.join(f.root,'data'));await writeFile(path.join(f.root,'data/private.json'),'{}');
  const link=path.join(f.root,'outside');try{await symlink(path.dirname(f.root),link,'junction');}catch(e){t.diagnostic('Junction unavailable: '+e.code);}
  const snap=await service.open({path:f.root});assert.ok(!snap.files.some(f=>f.path.startsWith('outside/')||f.path.startsWith('data/')));
  await f.git('config','core.fsmonitor','a-command-that-must-never-run');
  assert.equal((await service.open({path:f.root})).git.available,true);
  await mkdir(path.join(f.root,'empty'));await f.git('init','--initial-branch=main',path.join(f.root,'empty'));
  const empty=await service.open({path:path.join(f.root,'empty')});assert.equal(empty.git.available,true);assert.equal(empty.git.commits.length,0);
});
test('code project API requires paired local user and rejects LAN, cross-origin and unavailable file IDs', {timeout:60000}, async t=>{
  const f=await codeProjectFixture(t);await mkdir(path.join(f.root,'runtime'));
  const app=await createServer({port:0,dataDir:path.join(f.root,'runtime')});f.onCleanup(()=>app.close());
  assert.equal((await globalThis.fetch(new URL('/api/code-projects/jiva',app.url),{method:'POST'})).status,401);
  assert.equal((await fetch(new URL('/api/code-projects/jiva',app.url),{headers:{origin:'https://example.com'}})).status,403);
  await assert.rejects(handleCodeProjectRoute({}, {method:'POST'}, {},new URL('http://localhost/api/code-projects/jiva'),'lan'),{statusCode:403});
  const options={method:'POST',headers:{'content-type':'application/json'},body:'{}'};
  assert.equal((await fetch(new URL('/api/code-projects/open',app.url),{...options,body:JSON.stringify({path:f.root})})).status,404);
  assert.equal((await fetch(new URL('/api/code-projects/jiva',app.url),{...options,body:JSON.stringify({path:f.root})})).status,400);
  const response=await fetch(new URL('/api/code-projects/jiva',app.url),options);
  assert.equal(response.status,200);const project=await response.json();
  assert.equal(project.name,'jiva');
  assert.equal((await fetch(new URL(`/api/code-projects/${project.id}/file?path=src/server/server.js`,app.url))).status,200);
  assert.equal((await fetch(new URL(`/api/code-projects/${project.id}/file?path=..%2Fpackage.json`,app.url))).status,404);
  assert.equal((await fetch(new URL(`/api/code-projects/${project.id}/commit?hash=--all`,app.url))).status,400);
});

test('scan limits are explicit and shutdown interrupts an in-flight open',async t=>{
  const f=await codeProjectFixture(t),limit=codeProjectLimits.files;
  try {codeProjectLimits.files=2;const result=await scanProject(await canonicalProject(f.root));assert.equal(result.files.length,2);assert.equal(result.truncated,true);}
  finally {codeProjectLimits.files=limit;}
  const service=createCodeProjectsService({defaultRoot:f.root}),pending=service.open({path:f.root});
  await service.shutdown();await assert.rejects(pending,{statusCode:503});
});
