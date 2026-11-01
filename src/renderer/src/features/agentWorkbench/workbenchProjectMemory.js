const KEY = 'workbenchLastProject';

function storageOf(storage) {
  return storage || globalThis.localStorage;
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function scratchChoice() {
  return { kind: 'scratch', projectId: null, projectPath: '', projectName: '' };
}

function projectChoice(project) {
  return { kind: 'project', projectId: project.id, projectPath: project.path || '', projectName: project.name || '' };
}

export function rememberedProject(storage) {
  try {
    const parsed = JSON.parse(storageOf(storage).getItem(KEY) || '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (parsed.kind === 'scratch') return scratchChoice();
    const projectId = Number(parsed.projectId);
    if (parsed.kind !== 'project' || !Number.isInteger(projectId) || projectId <= 0) return null;
    return { kind: 'project', projectId, projectPath: cleanText(parsed.projectPath, 1024), projectName: cleanText(parsed.projectName, 80) };
  } catch {
    return null;
  }
}

export function rememberProject(value, storage) {
  const target = storageOf(storage);
  if (!target || !value || (value.kind !== 'project' && value.kind !== 'scratch')) return;
  const projectId = Number(value.projectId);
  const next = value.kind === 'project' && Number.isInteger(projectId) && projectId > 0
    ? { kind: 'project', projectId, projectPath: cleanText(value.projectPath, 1024), projectName: cleanText(value.projectName, 80) }
    : value.kind === 'scratch' ? { kind: 'scratch' } : null;
  if (!next) return;
  try { target.setItem(KEY, JSON.stringify(next)); } catch { /* keep the in-memory choice when storage is unavailable */ }
}

export function preferredProject(projects, sessions, storage) {
  const list = Array.isArray(projects) ? projects.filter(project => project && Number.isInteger(Number(project.id))) : [];
  const remembered = rememberedProject(storage);
  if (remembered?.kind === 'scratch') return scratchChoice();
  if (remembered?.kind === 'project') {
    const match = list.find(project => Number(project.id) === remembered.projectId);
    if (match) return projectChoice(match);
  }
  const session = (Array.isArray(sessions) ? sessions : []).find(item => item?.purpose !== 'workflow' && list.some(project => Number(project.id) === Number(item.workspaceId)));
  if (session) return projectChoice(list.find(project => Number(project.id) === Number(session.workspaceId)));
  return scratchChoice();
}
