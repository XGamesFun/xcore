// Open a URL for the person at the keyboard, without a shell. Their own Chrome when we can find it (their profile, so
// wallet extensions work in the studio), else the system's default browser.
import { spawn } from 'node:child_process';
import { findChrome } from './browser.mjs';

// `web: true` (xgames.fun's own sign-in page, `xcore login`) also allows an https address; nothing else ever does.
export function openCommand(
  url,
  { platform = process.platform, chrome = findChrome()?.path ?? null, web = false } = {},
) {
  let u = null;
  try {
    u = new URL(url);
  } catch {}
  const local = u && u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname);
  const https = web && u && u.protocol === 'https:' && !u.username && !u.password;
  if (!u || !(local || https) || u.href !== url || /["'\s<>^|`]/.test(url)) throw new Error(`refusing to open ${url}`);
  if (chrome) return { cmd: chrome, args: [url] };
  if (platform === 'win32') return { cmd: 'explorer.exe', args: [url] };
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  return { cmd: 'xdg-open', args: [url] };
}

export function openUrl(url, opts = {}) {
  const { cmd, args } = openCommand(url, opts);
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
