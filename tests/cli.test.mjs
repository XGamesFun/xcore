// The command: its own commands, and every other one handed to the kit (@xgamesfun/kit) when there is one, or words on
// how to get it when there is none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BIN, run, tempDir } from './helpers.mjs';

test('help lists its own commands; a kit command with no kit says how to get the kit', async t => {
  const away = await tempDir();
  t.after(away.cleanup);
  const h = run(['--help'], { cwd: away.dir });
  assert.equal(h.status, 0);
  for (const c of ['adopt', 'check', 'backend', 'loot', 'login', 'logout', 'publish'])
    assert.match(h.stdout, new RegExp(`^  ${c}\\s`, 'm'), c);
  // backend is ours for `use custom`: its help answers without the kit
  for (const args of [
    ['backend', '--help'],
    ['backend', 'use', '--help'],
  ]) {
    const r = run(args, { cwd: away.dir });
    assert.equal(r.status, 0, args.join(' '));
    assert.match(r.stdout, /Usage: xcore backend use custom/, args.join(' '));
  }
  const connect = run(['backend', 'connect', 'supabase'], { cwd: away.dir });
  assert.equal(connect.status, 1);
  assert.match(connect.stderr, /@xgamesfun\/kit[\s\S]*Usage: xcore backend use custom/);
  const create = run(['create', 'x'], { cwd: away.dir });
  assert.equal(create.status, 1);
  assert.match(create.stderr, /"create" is not a xgames\.fun command[\s\S]*@xgamesfun\/kit/);
  assert.equal(
    run(['--version'], { cwd: away.dir }).stdout.trim(),
    JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../package.json', import.meta.url), 'utf8'))
      .version,
  );
});

test('with a kit: its commands, publish and check of a game it made, and its backends go to it as they are', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  // a stand-in kit: its package name, and a command that says what it was given
  const kit = path.join(tmp.dir, 'kit');
  await mkdir(path.join(kit, 'bin'), { recursive: true });
  await writeFile(
    path.join(kit, 'package.json'),
    JSON.stringify({ name: '@xgamesfun/kit', bin: { 'gamesfun-kit': 'bin/kit.mjs' } }),
  );
  await writeFile(path.join(kit, 'bin', 'kit.mjs'), 'console.log("kit:" + JSON.stringify(process.argv.slice(2)));');
  const { findKit } = await import(pathToFileURL(BIN).href);
  assert.equal(findKit({ cwd: path.join(kit, 'games', 'x'), env: {}, here: tmp.dir }), kit, 'a kit above the folder');
  assert.equal(findKit({ cwd: tmp.dir, env: { GAMESFUN_KIT: kit }, here: tmp.dir }), kit, 'GAMESFUN_KIT');
  assert.equal(findKit({ cwd: tmp.dir, env: {}, here: tmp.dir }), null);
  const env = { GAMESFUN_KIT: kit };
  assert.equal(run(['create', 'games/x'], { cwd: tmp.dir, env }).stdout.trim(), 'kit:["create","games/x"]');
  assert.equal(
    run(['backend', 'connect', 'supabase'], { cwd: tmp.dir, env }).stdout.trim(),
    'kit:["backend","connect","supabase"]',
  );
  const made = path.join(tmp.dir, 'made');
  await mkdir(made);
  await writeFile(path.join(made, 'gf-three.json'), '{}');
  await writeFile(path.join(made, 'index.html'), '<title>x</title>');
  assert.equal(run(['publish', made], { cwd: tmp.dir, env }).stdout.trim(), `kit:${JSON.stringify(['publish', made])}`);
  assert.equal(
    run(['check', made], { cwd: tmp.dir, env }).stdout.trim(),
    `kit:${JSON.stringify(['verify', made])}`,
    'the kit checks its own game by verify',
  );
  // its own stay its own, kit or not
  assert.match(run(['adopt', '--help'], { cwd: tmp.dir, env }).stdout, /Usage: xcore adopt/);
});

test("the command it tells people to run is one that finds this package (`xcore` on npm is someone else's)", async () => {
  const { commandOf } = await import('../lib/command.mjs');
  const at = root => commandOf({ root, env: {} });
  assert.equal(
    at('/home/a/.npm/_npx/1a2b/node_modules/@xgamesfun/xcore'),
    'npx -y @xgamesfun/xcore',
    'run through npx',
  );
  assert.equal(at('/usr/local/lib/node_modules/@xgamesfun/xcore'), 'xcore', 'installed globally');
  assert.equal(
    at('C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\@xgamesfun\\xcore'.split('\\').join('/')),
    'xcore',
    'installed globally on Windows',
  );
  assert.equal(at('/home/a/my-game/node_modules/@xgamesfun/xcore'), 'npx xcore', 'installed in the project');
  assert.equal(
    commandOf({ root: '/home/a/xcore', env: {}, cwd: '/home/a/xcore' }),
    'node bin/xcore.mjs',
    'its own checkout',
  );
  assert.equal(
    commandOf({ root: '/home/a/xcore', env: {}, cwd: '/home/a/games/moth' }),
    `node ${path.join('..', '..', 'xcore', 'bin', 'xcore.mjs')}`,
    'its checkout, from a game beside it',
  );
  assert.equal(
    commandOf({ root: '/home/a/xcore', env: {}, cwd: '/tmp/x/y/z/w' }),
    `node ${path.join('/home/a/xcore', 'bin', 'xcore.mjs')}`,
    'its checkout, from far away',
  );
  assert.equal(commandOf({ root: '/x', env: { XCORE_COMMAND: 'xc' } }), 'xc');
});
