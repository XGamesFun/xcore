// `xcore dev`'s own lifecycles: the platform store's first load (lib/dev/platform.mjs), shared by calls that come at
// once; the server tools' install lock (lib/dev/tools.mjs), which a stopped install must not leave held; and the dev
// host's close and failed start (lib/dev/index.mjs, lib/dev/server.mjs), which must leave no game server running.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createPlatformStore } from '../lib/dev/platform.mjs';
import { takeInstallLock } from '../lib/dev/tools.mjs';
import { tempDir } from './helpers.mjs';

test('the platform store: calls at once before the file is read share one load, so no write is lost', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const file = path.join(tmp.dir, '.gamesfun', 'dev-platform.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ saves: { 'dev:old': { main: { value: 1, updated: 1 } } } }));
  const s = createPlatformStore({ dir: tmp.dir, slug: 'moth' });
  const players = ['dev:aaaaaa', 'dev:bbbbbb', 'dev:cccccc'];
  const put = await Promise.all(players.map(p => s.run('saves.put', [p, 'main', { p }])));
  assert.deepEqual(
    put.map(r => r.ok),
    [true, true, true],
  );
  for (const p of players) assert.deepEqual((await s.run('saves.get', [p, 'main'])).value, { p }, p);
  assert.equal((await s.run('saves.get', ['dev:old', 'main'])).value, 1, 'what the file had');
  await s.flush();
  const kept = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(kept.saves).sort(), ['dev:aaaaaa', 'dev:bbbbbb', 'dev:cccccc', 'dev:old']);
});

/** A pid no process has now: a child's, once it has exited. */
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;

test('the install lock: one held by a process that is gone is taken at once, and its stage folders go', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const lock = path.join(tmp.dir, '.installing');
  mkdirSync(lock);
  writeFileSync(path.join(lock, 'pid'), `${deadPid()} ${os.hostname()}\n`);
  mkdirSync(path.join(tmp.dir, '.stage-999999', 'node_modules'), { recursive: true });
  const started = Date.now();
  const release = takeInstallLock(tmp.dir, { waitMs: 60_000 });
  assert.ok(Date.now() - started < 5000, 'not waited on');
  assert.equal((await readFile(path.join(lock, 'pid'), 'utf8')).split(' ')[0], String(process.pid), 'held by this one');
  assert.equal(existsSync(path.join(tmp.dir, '.stage-999999')), false, 'a stopped install’s stage folder: gone');
  release();
  assert.equal(existsSync(lock), false);
});

test('the install lock: one a live process holds is waited on, then named', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
  t.after(() => live.kill());
  mkdirSync(path.join(tmp.dir, '.installing'));
  writeFileSync(path.join(tmp.dir, '.installing', 'pid'), `${live.pid} ${os.hostname()}\n`);
  assert.throws(() => takeInstallLock(tmp.dir, { waitMs: 600 }), /another xcore is still installing/);
  // (however old its lock: a live holder on this machine is never taken over, as a slow install's would be)
  const longAgo = new Date(Date.now() - 3_600_000);
  utimesSync(path.join(tmp.dir, '.installing'), longAgo, longAgo);
  assert.throws(() => takeInstallLock(tmp.dir, { waitMs: 600 }), /another xcore is still installing/);
  // a lock from an xcore before this one (no pid in it), new: waited on too
  const old = await tempDir();
  t.after(old.cleanup);
  mkdirSync(path.join(old.dir, '.installing'));
  assert.throws(() => takeInstallLock(old.dir, { waitMs: 600 }), /another xcore is still installing/);
});

// the dev host with a game server: needs Miniflare (GAMESFUN_SERVER_DEPS, as tests/dev.test.mjs), and Linux's ps to
// see workerd
const noMiniflare = process.env.GAMESFUN_SERVER_DEPS
  ? process.platform === 'linux'
    ? false
    : 'counts workerd processes with Linux ps'
  : 'GAMESFUN_SERVER_DEPS (a folder with miniflare) is not set';
const workerds = () =>
  spawnSync('ps', ['-o', 'pid=,args=', '--ppid', String(process.pid)], { encoding: 'utf8' })
    .stdout.split('\n')
    .filter(l => /workerd/.test(l)).length;

async function serverGame(dir) {
  await mkdir(path.join(dir, 'server'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>x</title>');
  await writeFile(path.join(dir, 'server', 'index.js'), 'export default { fetch: () => new Response("1") };\n');
  await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify({ server: { main: 'server/index.js' } }));
  return dir;
}

test(
  'xcore dev: close() right after a change leaves no reload to run, and no server',
  { skip: noMiniflare, timeout: 120_000 },
  async t => {
    const { startDev } = await import('../lib/dev/index.mjs');
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await serverGame(path.join(tmp.dir, 'g'));
    const logs = [];
    const dev = await startDev(dir, { port: 0, log: m => logs.push(m), env: process.env });
    assert.equal(dev.server.running, true, JSON.stringify(dev.server));
    await writeFile(path.join(dir, 'server', 'index.js'), 'export default { fetch: () => new Response("2") };\n');
    await new Promise(r => setTimeout(r, 50)); // the watcher has seen it: a reload is due in 200 ms
    await dev.close();
    await new Promise(r => setTimeout(r, 1500));
    assert.equal(logs.filter(l => /reloaded/.test(l)).length, 0, logs.join('\n'));
    assert.equal(workerds(), 0, 'no workerd left running');
  },
);

test(
  'xcore dev: a port in use fails the start, and the server it started is stopped',
  { skip: noMiniflare, timeout: 120_000 },
  async t => {
    const { startDev } = await import('../lib/dev/index.mjs');
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await serverGame(path.join(tmp.dir, 'g'));
    const taken = createServer().listen(0, '127.0.0.1');
    await new Promise(r => taken.once('listening', r));
    t.after(() => taken.close());
    await assert.rejects(startDev(dir, { port: taken.address().port, log: () => {}, env: process.env }), {
      code: 'EADDRINUSE',
    });
    await new Promise(r => setTimeout(r, 500));
    assert.equal(workerds(), 0, 'no workerd left running');
  },
);
