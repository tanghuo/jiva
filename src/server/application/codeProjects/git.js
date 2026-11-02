import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';

const exec = promisify(execFile);
const gitError = message => Object.assign(new Error(message), { statusCode: 400 });
export async function projectGit(root, args, { maxBuffer = 4 * 1024 * 1024 } = {}) {
  try {
    const { stdout } = await exec('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', '-c', `safe.directory=${root}`, '-C', root, ...args], {
      encoding: 'utf8', windowsHide: true, timeout: 12000, maxBuffer,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', LC_ALL: 'C' },
    });
    return stdout;
  } catch (error) {
    if (error.code === 'ENOENT') throw gitError('未找到 Git，请安装 Git 后重试');
    if (error.killed || error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw gitError('Git 读取超时或输出过大，请选择更小的范围');
    throw gitError('Git 无法读取此仓库，请检查目录、权限和仓库状态');
  }
}
export async function gitOverview(root) {
  try {
    const top = await projectGit(root, ['rev-parse', '--show-toplevel']);
    const canonicalTop = await realpath(top.trim());
    const sameRoot = process.platform === 'win32' ? canonicalTop.toLowerCase() === root.toLowerCase() : canonicalTop === root;
    if (!sameRoot) return { available: false, reason: '此目录不是 Git 仓库根目录，打开仓库根目录后可查看历史' };
    const branch = (await projectGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim();
    const status = await projectGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=normal']);
    const changes = []; const records = status.split('\0').filter(Boolean);
    for (let i = 0; i < records.length; i++) {
      const row = records[i]; if (row.length < 4) continue;
      const code = row.slice(0, 2), file = row.slice(3);
      const oldPath = /[RC]/.test(code) ? records[++i] : undefined;
      changes.push({ path: file, oldPath, staged: code[0] !== ' ' && code !== '??', unstaged: code[1] !== ' ' && code !== '??', untracked: code === '??', code });
    }
    let head = '', commits = [];
    try {
      head = (await projectGit(root, ['rev-parse', '--verify', 'HEAD'])).trim();
      const log = await projectGit(root, ['log', '--no-show-signature', '--all', '--topo-order', '-n', '160', '--format=%H%x00%P%x00%an%x00%aI%x00%D%x00%s%x00']);
      const fields = log.split('\0');
      for (let i = 0; i + 5 < fields.length; i += 6) {
        const hash = fields[i].trim(); if (!/^[a-f0-9]{40,64}$/.test(hash)) continue;
        commits.push({ hash, parents: fields[i+1].split(' ').filter(Boolean), author: fields[i+2], date: fields[i+3], refs: fields[i+4].split(', ').filter(Boolean), message: fields[i+5] });
      }
    } catch (error) { if (head) throw error; /* An unborn HEAD still has a usable working tree. */ }
    const refs = (await projectGit(root, ['for-each-ref', '--format=%(refname:short)%00%(objectname)', 'refs/heads', 'refs/remotes', 'refs/tags'])).trim().split('\n').filter(Boolean).map(s => { const [name, hash] = s.split('\0'); return { name, hash }; });
    return { available: true, branch, head, refs, commits, changes, historyLimit: 160 };
  } catch (error) { return { available: false, reason: error.message }; }
}
export async function gitCommit(root, hash) {
  if (!/^[a-f0-9]{40,64}$/.test(hash)) throw gitError('无效的提交编号');
  const message = await projectGit(root, ['show', '--no-show-signature', '-s', '--format=%B', hash]);
  const names = (await projectGit(root, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-m', '-z', hash])).split('\0').filter(Boolean);
  return { hash, message, files: [...new Set(names)] };
}
export async function gitDiff(root, { hash, file, area }) {
  if (typeof file !== 'string' || !file || file.length > 1000 || file.startsWith('/') || file.includes('\\') || file.split('/').includes('..') || file.includes('\0')) throw gitError('无效的文件路径');
  const options = ['--no-ext-diff', '--no-textconv', '--no-renames', '--unified=3'];
  if (hash) {
    if (!/^[a-f0-9]{40,64}$/.test(hash)) throw gitError('无效的提交编号');
    return { diff: await projectGit(root, ['show', '--no-show-signature', '--format=', '--first-parent', ...options, hash, '--', `:(literal)${file}`], { maxBuffer: 768 * 1024 }) };
  }
  if (!['staged', 'unstaged'].includes(area)) throw gitError('请选择暂存区或工作区');
  return { diff: await projectGit(root, ['diff', ...(area === 'staged' ? ['--cached'] : []), ...options, '--', `:(literal)${file}`], { maxBuffer: 768 * 1024 }) };
}
