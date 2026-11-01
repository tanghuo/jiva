import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer,chromium } from '../helpers/authenticatedServer.js';
import { resolveBrowserPath } from '../resolveBrowserPath.js';
import { quotaBucket } from '../../src/shared/domain/quota.js';
const executablePath=resolveBrowserPath();
test('quota defaults off, supports settings detection, keyboard focus, positions and narrow layouts',{skip:!executablePath,timeout:40000},async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'wiki-quota-ui-'));let app,browser,calls=0;
  t.after(async()=>{await browser?.close();await app?.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('wiki-quota-ui-'));await rm(dir,{recursive:true,force:true});});
  const read=async()=>{calls++;return {accountKey:'fixture',identityStatus:'unverified',accountLabel:'当前本机登录（身份未验证）',completeness:'full',limits:[],buckets:[quotaBucket({bucketId:'weekly',limitId:'credits',label:'共享 · 每周',usedPercent:82,resetsAt:Date.now()+3600000})]};};
  app=await createServer({port:0,dataDir:dir,quotaReaders:{
    codex:async()=>{const result=await read();return {...result,buckets:[{...result.buckets[0],usedPercent:12,remainingPercent:88},quotaBucket({bucketId:'five-hour',limitId:'credits',label:'codex · 五小时',usedPercent:6,windowMinutes:300})]};},
    grok:async()=>{const result=await read();return {...result,buckets:[{...result.buckets[0],usedPercent:21,remainingPercent:79},quotaBucket({bucketId:'wallet',limitId:'wallet',label:'预付余额',balance:{value:25,unit:'cents'}})]};},gemini:read}});
  browser=await chromium.launch({executablePath,headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url+'#wiki');
  assert.equal(await page.locator('.quota-float').count(),0);assert.equal(calls,0);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('显示额度浮动条',{exact:true}).check();
  await page.getByLabel('关闭设置',{exact:true}).click();const capsule=page.locator('.quota-capsule');await capsule.waitFor();await page.waitForFunction(()=>document.querySelector('.quota-capsule')?.textContent.includes('剩 18%'));
  await capsule.focus();await page.keyboard.press('Enter');await page.getByRole('region',{name:'账号额度详情'}).waitFor();assert.equal(await page.getByRole('progressbar').count(),4);
  await mkdir('.local/quota-implementation',{recursive:true});await page.screenshot({path:'.local/quota-implementation/quota-desktop.png'});
  await page.getByRole('checkbox',{name:/^Codex · 共享 · 每周额度 常驻浮动条$/}).check();await page.getByRole('checkbox',{name:/^Codex · .*5 小时额度 常驻浮动条$/}).check();await page.getByRole('checkbox',{name:/^Grok Build · 共享 · 每周额度 常驻浮动条$/}).check();
  await page.getByRole('checkbox',{name:/^Grok Build · 预付余额 常驻浮动条$/}).check();assert.match(await capsule.innerText(),/25 美分/);await page.getByRole('checkbox',{name:/^Grok Build · 预付余额 常驻浮动条$/}).uncheck();
  await page.keyboard.press('Escape');assert.equal(await capsule.locator('.quota-pinned-item').count(),3);assert.match(await capsule.innerText(),/88%/);assert.match(await capsule.innerText(),/94%/);assert.match(await capsule.innerText(),/79%/);
  assert.ok(await capsule.evaluate(el=>parseFloat(getComputedStyle(el).borderTopLeftRadius)<=12),'multi-item quota card must not inherit the global pill radius');
  const valueEdges=await capsule.locator('.quota-pinned-item strong').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().right));assert.ok(Math.max(...valueEdges)-Math.min(...valueEdges)<1,'remaining values share a right-aligned column');
  await page.locator('.quota-float').screenshot({path:'.local/quota-implementation/quota-pinned-preview.png'});
  await page.evaluate(()=>{document.documentElement.dataset.theme='night';});await page.locator('.quota-float').screenshot({path:'.local/quota-implementation/quota-card-night.png'});await page.evaluate(()=>{document.documentElement.dataset.theme='auto';});
  await page.reload();await capsule.waitFor();assert.equal(await capsule.locator('.quota-pinned-item').count(),3);
  await capsule.click();assert.equal(await page.getByRole('checkbox',{name:/^Codex · 共享 · 每周额度 常驻浮动条$/}).isChecked(),true);assert.equal(await page.getByRole('checkbox',{name:/^Grok Build · 共享 · 每周额度 常驻浮动条$/}).isChecked(),true);
  await page.getByRole('checkbox',{name:/^Codex · 共享 · 每周额度 常驻浮动条$/}).uncheck();assert.equal(await capsule.locator('.quota-pinned-item').count(),2);assert.match(await capsule.innerText(),/94%/);
  await page.setViewportSize({width:390,height:760});const pinnedRect=await capsule.boundingBox();assert.ok(pinnedRect.x>=0&&pinnedRect.x+pinnedRect.width<=390&&pinnedRect.y+pinnedRect.height<=760);
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'恢复自动选择',exact:true}).click();assert.equal(await capsule.locator('.quota-pinned-item').count(),0);
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('region',{name:'账号额度详情'}).count(),0);assert.equal(await capsule.evaluate(el=>el===document.activeElement),true);
  const beforeDrag=await capsule.boundingBox();
  await page.mouse.move(beforeDrag.x+beforeDrag.width/2,beforeDrag.y+beforeDrag.height/2);await page.mouse.down();await page.mouse.move(700,140,{steps:15});await page.mouse.up();
  assert.equal(await page.getByRole('region',{name:'账号额度详情'}).count(),0);
  const moved=await capsule.boundingBox();assert.ok(moved.y<200&&moved.x>300);
  await page.reload();await capsule.waitFor();const restored=await capsule.boundingBox();assert.ok(Math.abs(restored.x-moved.x)<2&&Math.abs(restored.y-moved.y)<2);
  await capsule.focus();await page.keyboard.press('Enter');const downPanel=await page.locator('.quota-panel').boundingBox();assert.ok(downPanel.y>=restored.y+restored.height);
  const grip=await page.getByRole('button',{name:'拖动额度浮动条',exact:true}).boundingBox();
  await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(1430,990,{steps:15});await page.mouse.up();
  const edge=await capsule.boundingBox();assert.ok(edge.x+edge.width<=1429&&edge.y+edge.height<=989);
  await page.setViewportSize({width:390,height:760});const resized=await capsule.boundingBox();assert.ok(resized.x>=0&&resized.x+resized.width<=390&&resized.y>=0&&resized.y+resized.height<=760);
  const resizedPanel=await page.locator('.quota-panel').boundingBox();assert.ok(resizedPanel.x>=0&&resizedPanel.x+resizedPanel.width<=390&&resizedPanel.y>=0);
  await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('显示位置',{exact:true}).selectOption('right');await page.getByLabel('关闭设置',{exact:true}).click();assert.ok(await page.locator('.quota-right').count());
  await page.setViewportSize({width:390,height:760});await capsule.click();const rect=await page.locator('.quota-panel').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=390&&rect.y>=0&&rect.y+rect.height<=760);
  await page.screenshot({path:'.local/quota-implementation/quota-mobile.png'});await page.keyboard.press('Escape');
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('显示额度浮动条',{exact:true}).uncheck();
  await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:'Agent 连接',exact:false}).click();await page.getByRole('button',{name:'检测额度',exact:true}).first().waitFor();
  await page.getByRole('button',{name:'检测额度',exact:true}).first().click();await page.getByLabel('关闭设置',{exact:true}).click();assert.equal(await page.locator('.quota-float').count(),0);assert.deepEqual(errors,[]);
});


