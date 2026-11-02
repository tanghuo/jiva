import { randomUUID } from 'node:crypto';
import { canonicalProject, scanProject, visibleProjectPath, projectError } from '../../assets/codeProjectFiles.js';
import { gitOverview, gitCommit, gitDiff } from './git.js';

export function createCodeProjectsService({ defaultRoot }) {
  const projects = new Map(); let opening = false, stopped = false;
  const find = id => { const project = projects.get(id); if (!project) throw projectError(404, '源码快照已失效，请刷新 Jiva 源码'); return project; };
  const service = {
    openJiva: () => service.open({path:defaultRoot}),
    async open(input) {
      if (stopped) throw projectError(503, '服务正在关闭');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw projectError(400, '请提供项目目录');
      if (opening) throw projectError(409, '已有项目正在分析，请稍后重试');
      opening = true;
      try {
        const root = await canonicalProject(input.path || defaultRoot);
        const scan = await scanProject(root);
        if (stopped) throw projectError(503, '服务正在关闭');
        const git = await gitOverview(root);
        if (stopped) throw projectError(503, '服务正在关闭');
        const id = randomUUID(), capturedAt = new Date().toISOString();
        if (projects.size >= 4) projects.delete(projects.keys().next().value);
        const record = { id, root, texts: scan.texts };
        projects.set(id, record);
        return { id, name:'jiva', capturedAt, files:scan.files, truncated:scan.truncated, warnings:scan.warnings, git };
      } finally { opening = false; }
    },
    file(id, name) {
      const p = find(id);
      if (!visibleProjectPath(name) || !p.texts.has(name)) throw projectError(404, '文件未收录、已排除或超出本次索引范围');
      return { path: name, text: p.texts.get(name) };
    },
    commit: (id, hash) => gitCommit(find(id).root, hash),
    diff: (id, input) => gitDiff(find(id).root, input),
    close(id) { projects.delete(id); return { ok: true }; },
    async shutdown() { stopped = true; projects.clear(); },
  };
  return service;
}
