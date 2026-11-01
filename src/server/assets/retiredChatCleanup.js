import { rm, lstat } from 'node:fs/promises';
import path from 'node:path';

// Only the two dedicated legacy storage roots belong to retired conversations.
// Saved Wiki images live in assets; new sessions use agent-* directories.
export async function cleanupRetiredChat(dataDir) {
  const root = path.resolve(dataDir);
  for (const name of ['chat-artifacts', 'chat-workspace']) {
    const target = path.resolve(root, name);
    if (path.dirname(target) !== root) throw new Error('Invalid retired chat storage path');
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink()) await rm(target, { force: true });
      else await rm(target, { recursive: true, force: true });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
