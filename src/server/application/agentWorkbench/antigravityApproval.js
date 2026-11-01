import { realpath, stat } from 'node:fs/promises';
import { containsPath, localPath } from './workspaces.js';

// Match complete commands, never prefixes: shell composition and unknown input
// must still go through the one-time approval UI. This is not a shell sandbox.
const readOnlyCommands = [
  /^git[ \t]+status(?:[ \t]+(?:--short|--branch|--porcelain(?:=v[12])?|--untracked-files=(?:no|normal|all)|--show-stash|--no-renames))*$/,
  /^git[ \t]+branch[ \t]+--show-current$/,
  /^git[ \t]+rev-parse[ \t]+(?:--show-toplevel|--is-inside-work-tree|--show-prefix)$/,
  /^(?:pwd|Get-Location)$/,
];

export async function antigravityReadOnlyCommand(operation, workspace) {
  if (operation.tool !== 'execute') return false;
  const input = operation.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['CommandLine', 'Cwd', 'WaitMsBeforeAsync'].includes(key))) return false;
  const command = input.CommandLine;
  if (typeof command !== 'string' || command.length > 256 || /[\r\n]/.test(command)
      || !readOnlyCommands.some(pattern => pattern.test(command.trim()))) return false;
  if (input.WaitMsBeforeAsync !== undefined && (!Number.isSafeInteger(input.WaitMsBeforeAsync) || input.WaitMsBeforeAsync < 0)) return false;
  try {
    const cwd = await realpath(localPath(input.Cwd));
    return containsPath(workspace.path, cwd) && (await stat(cwd)).isDirectory();
  } catch { return false; }
}
