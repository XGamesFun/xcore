// Finding and launching a browser for the page check (./check.mjs), on Windows, macOS and Linux: CHROME_PATH, an
// installed Chrome, Chromium or Edge in the usual places, then PATH; the last resort is Playwright's own Chromium,
// downloaded once on demand with a clear message. The kit's own browser tools import these too.
import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Where Chrome, Chromium and Edge live on each system, most preferred first: [{path, kind}]. Pure: the platform, the
 * environment and the home folder come in, paths go out (so the Windows and macOS lists are checked from any system).
 *   Windows  Program Files, Program Files (x86) and the per-user install (%LOCALAPPDATA%): Chrome, Edge, Chromium
 *   macOS    /Applications and ~/Applications: Chrome, Edge, Chromium
 *   Linux    the distribution's packages, /opt and the snap: Chrome, Chromium, Edge
 */
export function chromeCandidates({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  const out = [],
    add = (p, kind) => out.push({ path: p, kind });
  if (platform === 'win32') {
    const w = path.win32;
    const roots = [
      env.PROGRAMFILES ?? 'C:\\Program Files',
      env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
      env.LOCALAPPDATA ?? w.join(home, 'AppData', 'Local'),
    ];
    for (const r of roots) add(w.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'), 'chrome');
    for (const r of roots) add(w.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), 'edge');
    for (const r of roots) add(w.join(r, 'Chromium', 'Application', 'chrome.exe'), 'chromium');
  } else if (platform === 'darwin') {
    for (const base of ['/Applications', path.posix.join(home, 'Applications')]) {
      add(`${base}/Google Chrome.app/Contents/MacOS/Google Chrome`, 'chrome');
      add(`${base}/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`, 'edge');
      add(`${base}/Chromium.app/Contents/MacOS/Chromium`, 'chromium');
    }
  } else {
    for (const p of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'])
      add(p, 'chrome');
    for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']) add(p, 'chromium');
    for (const p of ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge'])
      add(p, 'edge');
  }
  return out;
}
const isFile = p => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** The browser to drive: CHROME_PATH when it exists, else the first installed candidate. → {path, kind, source} or null */
export function findChrome({ platform = process.platform, env = process.env, home = homedir(), exists = isFile } = {}) {
  if (env.CHROME_PATH && exists(env.CHROME_PATH))
    return { path: env.CHROME_PATH, kind: 'chrome', source: 'CHROME_PATH' };
  for (const c of chromeCandidates({ platform, env, home })) if (exists(c.path)) return { ...c, source: 'installed' };
  for (const n of PATH_NAMES[platform] ?? PATH_NAMES.linux) {
    const p = onPath(n, { platform, env, exists });
    if (p)
      return { path: p, kind: /edge/.test(n) ? 'edge' : /chromium/.test(n) ? 'chromium' : 'chrome', source: 'PATH' };
  }
  return null;
}
/** Program names looked for on PATH when the usual places are empty (a Nix, Homebrew or portable install). */
const PATH_NAMES = {
  win32: ['chrome', 'msedge'],
  darwin: [],
  linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'],
};
/** A program on PATH, found without a shell (PATHEXT on Windows). → its path or null */
export function onPath(name, { platform = process.platform, env = process.env, exists = isFile } = {}) {
  const impl = platform === 'win32' ? path.win32 : path.posix;
  const dirs = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const exts = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  for (const d of dirs)
    for (const e of exts)
      for (const p of new Set([impl.join(d, name + e.toLowerCase()), impl.join(d, name + e)])) if (exists(p)) return p;
  return null;
}

/** Playwright's own Chromium for the pinned playwright-core: { path, installed } */
export async function playwrightChromium() {
  const { chromium } = await import('playwright-core');
  let p = null;
  try {
    p = chromium.executablePath();
  } catch {}
  return { path: p, installed: !!p && existsSync(p) };
}

/**
 * Make sure there is a browser, and point CHROME_PATH at it. Never throws for a missing browser when it can install
 * one; returns { path, kind, source } or throws with what to do.
 */
export async function ensureBrowser({ log = console.error, install = true, env = process.env } = {}) {
  const found = findChrome({ env });
  if (found) {
    env.CHROME_PATH = found.path;
    return found;
  }
  const pw = await playwrightChromium();
  if (pw.installed) {
    env.CHROME_PATH = pw.path;
    return { path: pw.path, kind: 'chromium', source: 'playwright' };
  }
  if (!install)
    throw new Error(
      "No Chrome or Edge found, and Playwright's Chromium is not installed. Install Google Chrome, or run: npx playwright-core install chromium",
    );
  log(
    "xcore: no Chrome or Edge found (set CHROME_PATH to use another). Downloading Playwright's Chromium once (about 170 MB) into its cache…",
  );
  // its progress goes to stderr: stdout stays the command's own (the JSON of --json)
  const r = spawnSync(process.execPath, [playwrightCli(), 'install', 'chromium'], {
    stdio: ['ignore', 2, 2],
    windowsHide: true,
  });
  const after = await playwrightChromium();
  if (r.status !== 0 || !after.installed) {
    throw new Error(
      `Could not install Playwright's Chromium (exit ${r.status}). Install Google Chrome, or run: npx playwright-core install chromium${process.platform === 'linux' ? ' (on Linux it may need: npx playwright-core install-deps chromium)' : ''}`,
    );
  }
  env.CHROME_PATH = after.path;
  log(`xcore: using Playwright's Chromium at ${after.path}`);
  return { path: after.path, kind: 'chromium', source: 'playwright (installed now)' };
}

/** playwright-core's own command line (its `install`). Found beside its package.json: the package's exports do not
 *  name cli.js, so it cannot be resolved by that name. → its path */
export function playwrightCli() {
  return path.join(path.dirname(createRequire(import.meta.url).resolve('playwright-core/package.json')), 'cli.js');
}

/** A headless browser for the page check (HEADED=1 shows it). `chromium`: another Playwright BrowserType (the kit's). */
export async function launchBrowser({ chromium = null, headless = process.env.HEADED !== '1' } = {}) {
  const type = chromium ?? (await import('playwright-core')).chromium;
  const found = await ensureBrowser({});
  return type.launch({ headless, executablePath: found.path });
}

/** A program on PATH by the first of `names` that exists. → its path or null */
export function findProgram(names, { platform = process.platform, env = process.env, exists } = {}) {
  for (const n of names) {
    const p = onPath(n.replace(/\.(exe|cmd|bat)$/i, ''), { platform, env, ...(exists ? { exists } : {}) });
    if (p) return p;
  }
  return null;
}
