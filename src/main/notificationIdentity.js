import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

// Must match electron-builder's build.appId, including for unpackaged launches.
export const notificationAppId = 'local.jiva';

export async function registerNotificationIdentity(iconPath) {
  if (process.platform !== 'win32') return;
  // Windows resolves the toast header from the AUMID registration, not the
  // BrowserWindow title. Without this, electron.exe supplies "Electron".
  const registryKey = `HKCU\\Software\\Classes\\AppUserModelId\\${notificationAppId}`;
  const reg = path.join(process.env.SystemRoot, 'System32', 'reg.exe');
  const run = promisify(execFile);
  for (const [name, value] of [['DisplayName', 'Jiva'], ['IconUri', iconPath]]) {
    await run(reg, ['add', registryKey, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], {
      windowsHide: true,
      timeout: 5000,
    });
  }
}
