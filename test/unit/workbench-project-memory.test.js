import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preferredProject, rememberProject, rememberedProject } from '../../src/renderer/src/features/agentWorkbench/workbenchProjectMemory.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)) };
}

const projects = [
  { id: 3, name: 'sukebei-local-browser', path: 'D:\\Tools\\sukebei-local-browser' },
  { id: 8, name: 'other', path: 'D:\\Tools\\other' },
];

test('a new task starts in the last chosen project', () => {
  const storage = memoryStorage();
  assert.equal(rememberedProject(storage), null);
  assert.deepEqual(preferredProject(projects, [], storage), { kind: 'scratch', projectId: null, projectPath: '', projectName: '' });
  rememberProject({ kind: 'project', projectId: 3, projectPath: projects[0].path, projectName: projects[0].name }, storage);
  assert.equal(rememberedProject(storage).projectId, 3);
  assert.deepEqual(preferredProject(projects, [{ id: 9, purpose: 'interactive', workspaceId: 8 }], storage).projectName, 'sukebei-local-browser');
  rememberProject({ kind: 'scratch' }, storage);
  assert.equal(preferredProject(projects, [{ id: 9, purpose: 'interactive', workspaceId: 3 }], storage).kind, 'scratch');
});

test('without a saved choice, the newest project session supplies the project', () => {
  const storage = memoryStorage();
  const sessions = [
    { id: 12, purpose: 'workflow', workspaceId: 8 },
    { id: 11, purpose: 'interactive', workspaceId: 99 },
    { id: 10, purpose: 'interactive', workspaceId: 3 },
  ];
  assert.deepEqual(preferredProject(projects, sessions, storage), { kind: 'project', projectId: 3, projectPath: projects[0].path, projectName: 'sukebei-local-browser' });
});

test('a missing saved project falls through, and invalid memory is ignored', () => {
  const storage = memoryStorage({ workbenchLastProject: JSON.stringify({ kind: 'project', projectId: 0, projectName: 'bad' }) });
  assert.equal(rememberedProject(storage), null);
  assert.equal(preferredProject(projects, [], storage).kind, 'scratch');
  rememberProject({ kind: 'project', projectId: 4, projectPath: 'D:\\gone', projectName: 'gone' }, storage);
  assert.equal(preferredProject(projects, [{ purpose: 'interactive', workspaceId: 8 }], storage).projectId, 8);
  rememberProject({ kind: 'project', projectId: 'nope' }, storage);
  assert.equal(rememberedProject(storage).projectId, 4);
});
