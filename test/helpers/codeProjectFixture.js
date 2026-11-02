import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
export async function codeProjectFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jiva-code-project-'));
  const cleanup = [];
  t.after(async () => { for(const fn of cleanup.reverse()) await fn(); assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('jiva-code-project-')); await rm(root, { recursive: true, force: true, maxRetries: 3 }); });
  const git = async (...args) => (await exec('git', ['-c', `safe.directory=${root}`, '-c', 'user.name=Jiva Test', '-c', 'user.email=jiva-test@example.invalid', '-C', root, ...args], { windowsHide: true })).stdout.trim();
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name:'fixture-project', description:'Code project fixture', scripts:{ start:'node src/main.js' } }));
  await writeFile(path.join(root, 'src/main.js'), 'import { leaf } from "./leaf.js";\nexport function start() { return leaf(); }\n');
  await writeFile(path.join(root, 'src/leaf.js'), 'export function leaf() { return 1; }\n');
  await git('init', '--initial-branch=main'); await git('add', '.'); await git('commit', '-m', 'initial project');
  const initial = await git('rev-parse','HEAD');
  await git('switch','-c','feature'); await writeFile(path.join(root, 'src/feature.js'),'export const feature = () => 3;\n'); await git('add','.'); await git('commit','-m','add feature');
  await git('switch','main'); await writeFile(path.join(root, 'README.md'),'# Fixture\n'); await git('add','.'); await git('commit','-m','document project');
  await git('merge','--no-ff','feature','-m','merge feature'); const head=await git('rev-parse','HEAD');
  await writeFile(path.join(root, 'src/leaf.js'),'export function leaf() { return 2; }\n'); await git('add','src/leaf.js');
  await writeFile(path.join(root, 'src/main.js'),'import { leaf } from "./leaf.js";\nexport function start() { return leaf() + 1; }\n');
  await writeFile(path.join(root, 'src/new.js'),'export function unsaved() {}\n');
  await writeFile(path.join(root, '.env'),'SECRET=not-to-be-indexed');
  return {root,git,head,initial,onCleanup:fn=>cleanup.push(fn)};
}
