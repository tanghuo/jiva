import { spawnSync } from 'node:child_process';
import path from 'node:path';
const cwd = path.resolve(import.meta.dirname, '../src/server/adapters/115bridge');
const result = spawnSync('go', ['build', '-trimpath', '-o', process.platform === 'win32' ? '115bridge.exe' : '115bridge', '.'], { cwd, stdio: 'inherit', windowsHide: true });
if (result.error) console.error('Building the 115 adapter requires Go 1.24+');
process.exitCode = result.status ?? 1;
