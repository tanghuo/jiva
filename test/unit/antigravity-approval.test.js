import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { antigravityReadOnlyCommand } from '../../src/server/application/agentWorkbench/antigravityApproval.js';

test('Antigravity auto approval matches whole read-only commands and canonical workspace directories', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'wiki-antigravity-approval-')));
  t.after(async () => {
    assert.equal(path.basename(root).startsWith('wiki-antigravity-approval-'), true);
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const workspace = { path: path.join(root, 'project') }, outside = path.join(root, 'outside');
  await mkdir(workspace.path); await mkdir(outside);
  const check = (command, input = {}, tool = 'execute') => antigravityReadOnlyCommand({ tool, input: { CommandLine: command, Cwd: workspace.path, ...input } }, workspace);
  for (const command of ['git status', ' git status --short --branch ', 'git status --porcelain=v1', 'git branch --show-current', 'git rev-parse --show-toplevel', 'pwd', 'Get-Location']) {
    assert.equal(await check(command, { WaitMsBeforeAsync: 5000 }), true, command);
  }
  for (const command of ['git status; echo bad', 'git status && echo bad', 'git status | cmd', 'git status > result.txt', 'git status\necho bad', 'git status`necho bad', 'git status $(echo bad)', 'git status --short;exit', 'git -c core.fsmonitor=bad status', 'git status --unknown', 'git reset --hard', 'npm test', 'powershell -Command "git status"', 'git diff', '']) {
    assert.equal(await check(command), false, command);
  }
  assert.equal(await check('git status', { Cwd: outside }), false);
  assert.equal(await check('git status', { Cwd: '.' }), false);
  assert.equal(await check('git status', { Cwd: path.join(workspace.path, 'missing') }), false);
  assert.equal(await check('git status', { Environment: { BAD: 'value' } }), false);
  assert.equal(await check('git status', { WaitMsBeforeAsync: -1 }), false);
  assert.equal(await check('git status', {}, 'other'), false);
  const link = path.join(workspace.path, 'outside-link');
  await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await check('git status', { Cwd: link }), false, 'directory junctions must not bypass the workspace boundary');
});
