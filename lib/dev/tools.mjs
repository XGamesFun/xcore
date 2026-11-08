// The tools `xcore dev` runs a game's server/ with: Miniflare and workerd (the runtime Cloudflare runs hosted games'
// servers on). About 140 MB, so never a dependency of this package: installed on first use, once, by a game that has
// server/, into the folder of this package's state (../config-dir.mjs → state/deps/server-tools-<miniflare version>).
// GAMESFUN_SERVER_DEPS=<folder> uses one installed elsewhere (a folder whose node_modules has miniflare).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { userConfigDir } from '../config-dir.mjs';

/** The Miniflare this package runs servers with (v4: the options shape ./server.mjs passes). */
export const MINIFLARE = '4.20260730.0';
const DONE = '.xcore-installed';
const WAIT_MS = 10 * 60_000;

/** Where the tools are (or go). */
export function toolsFolder(env = process.env) {
  if (env.GAMESFUN_SERVER_DEPS) return path.resolve(env.GAMESFUN_SERVER_DEPS);
  return path.join(userConfigDir({ env }), 'state', 'deps', `server-tools-${MINIFLARE}`);
}

const ready = dir =>
  existsSync(path.join(dir, 'node_modules', DONE)) ||
  existsSync(path.join(dir, 'node_modules', 'miniflare', 'package.json'));

/** npm's own CLI script, run with this Node (no shell: npm.cmd cannot be spawned directly on Windows). */
function npmCli() {
  const cands = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return cands.find(p => p && /npm-cli\.js$/.test(p) && existsSync(p)) ?? null;
}

const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Install the tools when they are not there yet (one process at a time; whole or not at all). → the folder */
export function ensureTools({ log = m => console.error(m), env = process.env } = {}) {
  const dir = toolsFolder(env);
  if (ready(dir)) return dir;
  if (env.GAMESFUN_SERVER_DEPS) throw new Error(`GAMESFUN_SERVER_DEPS (${dir}) has no node_modules/miniflare`);
  mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, '.installing');
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (ready(dir)) return dir;
      let age = 0;
      try {
        age = Date.now() - statSync(lock).mtimeMs;
      } catch {}
      if (age > WAIT_MS * 2) rmSync(lock, { recursive: true, force: true });
      else if (Date.now() - started > WAIT_MS)
        throw new Error(`another xcore is still installing the server tools in ${dir}`);
      else pause(500);
    }
  }
  try {
    if (ready(dir)) return dir;
    const cli = npmCli();
    if (!cli)
      throw new Error(
        `npm was not found: install the tools yourself with npm i miniflare@${MINIFLARE} --prefix "${dir}"`,
      );
    log(`installing the server tools once (Miniflare ${MINIFLARE} with workerd, about 140 MB) into ${dir}…`);
    const stage = path.join(dir, `.stage-${process.pid}`);
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true });
    writeFileSync(
      path.join(stage, 'package.json'),
      JSON.stringify({ name: 'xcore-server-tools', private: true, dependencies: { miniflare: MINIFLARE } }, null, 2),
    );
    const r = spawnSync(process.execPath, [cli, 'install', '--no-audit', '--no-fund', '--omit=dev'], {
      cwd: stage,
      stdio: ['ignore', 2, 2],
      windowsHide: true,
    });
    if (r.status !== 0) {
      rmSync(stage, { recursive: true, force: true });
      throw new Error(`installing Miniflare failed (npm exit ${r.status}): try again online`);
    }
    writeFileSync(path.join(stage, 'node_modules', DONE), `${new Date().toISOString()}\n`);
    rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true });
    renameSync(path.join(stage, 'node_modules'), path.join(dir, 'node_modules'));
    renameSync(path.join(stage, 'package.json'), path.join(dir, 'package.json'));
    rmSync(stage, { recursive: true, force: true });
    return dir;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** Miniflare's module, installed first when needed. */
export async function loadMiniflare(opts = {}) {
  const dir = ensureTools(opts);
  const req = createRequire(path.join(dir, 'package.json'));
  return import(req.resolve('miniflare'));
}
