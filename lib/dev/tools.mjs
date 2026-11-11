// The tools `xcore dev` runs a game's server/ with: Miniflare and workerd (the runtime Cloudflare runs hosted games'
// servers on). About 140 MB, so never a dependency of this package: installed on first use, once, by a game that has
// server/, into the folder of this package's state (../config-dir.mjs → state/deps/server-tools-<miniflare version>).
// GAMESFUN_SERVER_DEPS=<folder> uses one installed elsewhere (a folder whose node_modules has miniflare).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
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

/** Is process `pid` running (on this machine)? EPERM: it is, as another user's. */
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

/**
 * The install lock, <tools folder>/.installing, is in one of three states:
 *   free   no folder: take it (mkdir, which only one process wins), and write `<pid> <host>` in its pid file.
 *   held   the folder, by an xcore still installing: wait for it (up to waitMs), then say another xcore is installing.
 *   stale  the folder, left by an install that was stopped (Ctrl-C kills xcore before it can remove it): taken over at
 *          once. Stale when its pid file names a process on this machine that is gone; when its holder can't be asked
 *          (no pid file: an xcore before this one wrote none; or a pid on another machine) and it is older than twice
 *          waitMs; and, whoever holds it, when it is older than LIVE_HOLD_MS (a pid the system has given to another
 *          process since, as after a restart, looks alive: no install runs that long).
 */
/** The longest a lock held by a live process on this machine is waited on: far past any install of the tools. */
export const LIVE_HOLD_MS = 30 * 60 * 1000;
function lockState(lock, waitMs) {
  let age;
  try {
    age = Date.now() - statSync(lock).mtimeMs;
  } catch {
    return 'free';
  }
  let holder = null;
  try {
    const [pid, host] = readFileSync(path.join(lock, 'pid'), 'utf8').trim().split(/\s+/);
    if (Number.isSafeInteger(Number(pid)) && Number(pid) > 0) holder = { pid: Number(pid), host };
  } catch {
    /* no pid file */
  }
  // (a holder on this machine is asked: alive, it holds the lock however long it takes; gone, the lock is stale. Only a
  // lock whose holder can't be asked, none named or another machine's, goes stale by its age.)
  if (age > LIVE_HOLD_MS) return 'stale';
  if (holder && holder.host === os.hostname()) return alive(holder.pid) ? 'held' : 'stale';
  return age > waitMs * 2 ? 'stale' : 'held';
}

/**
 * Take the install lock in `dir` (one install at a time), waiting while another xcore holds it. → release(), or null
 * when `done()` turned true while waiting (the other xcore installed the tools). Once held, any .stage-<pid> folder
 * there is a stopped install's, and goes.
 */
export function takeInstallLock(dir, { waitMs = WAIT_MS, done = () => false } = {}) {
  const lock = path.join(dir, '.installing');
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (done()) return null;
      const state = lockState(lock, waitMs);
      if (state === 'stale') rmSync(lock, { recursive: true, force: true });
      else if (state === 'held' && Date.now() - started > waitMs)
        throw new Error(
          `another xcore is still installing the server tools in ${dir}; if no other xcore is running, delete ${lock} and run this again`,
          { cause: e },
        );
      else if (state === 'held') pause(500);
    }
  }
  try {
    writeFileSync(path.join(lock, 'pid'), `${process.pid} ${os.hostname()}\n`);
  } catch {
    /* without it, the lock goes stale by its age */
  }
  for (const name of readdirSync(dir))
    if (/^\.stage-\d+$/.test(name)) rmSync(path.join(dir, name), { recursive: true, force: true });
  return () => rmSync(lock, { recursive: true, force: true });
}

/** Install the tools when they are not there yet (one process at a time; whole or not at all). → the folder */
export function ensureTools({ log = m => console.error(m), env = process.env } = {}) {
  const dir = toolsFolder(env);
  if (ready(dir)) return dir;
  if (env.GAMESFUN_SERVER_DEPS) throw new Error(`GAMESFUN_SERVER_DEPS (${dir}) has no node_modules/miniflare`);
  mkdirSync(dir, { recursive: true });
  const release = takeInstallLock(dir, { done: () => ready(dir) });
  if (!release) return dir;
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
    release();
  }
}

/** Miniflare's module, installed first when needed. */
export async function loadMiniflare(opts = {}) {
  const dir = ensureTools(opts);
  const req = createRequire(path.join(dir, 'package.json'));
  return import(req.resolve('miniflare'));
}
