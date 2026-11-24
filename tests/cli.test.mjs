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
  assert.match(connect.stderr, /game-making kit[\s\S]*not released yet[\s\S]*Usage: xcore backend use custom/);
  const create = run(['create', 'x'], { cwd: away.dir });
  assert.equal(create.status, 1);
  assert.match(create.stderr, /"create" is a command of the game-making kit[\s\S]*not released yet/);
  // a typo is told the nearest command of ours, and is not blamed on the kit
  const typo = run(['pubish', '.'], { cwd: away.dir });
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /"pubish" is not an xcore command\. Did you mean "publish"\?/);
  assert.doesNotMatch(typo.stderr, /is a command of the game-making kit|not available here/);
  // nothing it prints names a package npm does not have
  for (const r of [connect, create]) assert.doesNotMatch(r.stderr, /@xgamesfun\/kit/);
  const unknown = run(['frobnicate'], { cwd: away.dir });
  assert.match(unknown.stderr, /"frobnicate" is not an xcore command\.\n/);
  assert.doesNotMatch(unknown.stderr, /Did you mean|is a command of the game-making kit|not available here/);
  // --json: the same failures as JSON on stdout, with a code
  const asJson = args => JSON.parse(run([...args, '--json'], { cwd: away.dir }).stdout);
  assert.deepEqual(
    [asJson(['create', 'x']).ok, asJson(['create', 'x']).code, asJson(['pubish']).code],
    [false, 'no-kit', 'unknown-command'],
  );
  assert.match(asJson(['create', 'x']).error, /^"create" is a command of the game-making kit\. .*not released yet/);
  assert.equal(
    run(['--version'], { cwd: away.dir }).stdout.trim(),
    JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../package.json', import.meta.url), 'utf8'))
      .version,
  );
});

test('a usage mistake is answered one way by every command: its words on stderr, nothing on stdout, exit code 2', async t => {
  const away = await tempDir();
  t.after(away.cleanup);
  for (const [args, said] of [
    [[], /^Usage: xcore <command> \[options\]/], // no command
    [['--frob'], /^No command before --frob: xcore <command> \[options\]\.\n\nUsage: xcore <command>/],
    [['frobnicate'], /^"frobnicate" is not an xcore command\./], // no such command
    [['add'], /^Say what to add: signin, [\s\S]*\n\nUsage: xcore add /], // no subcommand: what was wrong, then usage
    [['loot'], /^Name a command: add, [\s\S]*\n\nUsage: xcore loot /],
    [['db'], /^Name a command: info, [\s\S]*\n\nUsage: xcore db /],
    [
      ['add', 'bogus'],
      /^"bogus" is not something xcore can add\. [\s\S]*\n\nUsage: xcore add [\s\S]*Run `xcore add --help` for the options\.\n$/,
    ], // no such subcommand
    [['adopt', '.', '--frob'], /^Unknown option '--frob'/], // no such flag
    [['dev', '.', '--port', 'eighty'], /^--port takes a port number/], // a value that is none
  ]) {
    const r = run(args, { cwd: away.dir });
    assert.equal(r.status, 2, `${args.join(' ')}: exit code`);
    assert.equal(r.stdout, '', `${args.join(' ')}: nothing on stdout`);
    assert.match(r.stderr, said, args.join(' '));
    // asked for JSON, the same mistake is also said on stdout, in the one shape
    const j = run([...args, '--json'], { cwd: away.dir });
    assert.equal(j.status, 2, `${args.join(' ')} --json: exit code`);
    const out = JSON.parse(j.stdout);
    assert.deepEqual(
      [out.ok, typeof out.error, out.code],
      [false, 'string', args[0] === 'frobnicate' ? 'unknown-command' : 'usage'],
      `${args.join(' ')} --json`,
    );
  }
  // help that was asked for is no mistake: on stdout, exit code 0
  for (const args of [['--help'], ['loot', '--help'], ['add', '--help']]) {
    const r = run(args, { cwd: away.dir });
    assert.deepEqual([r.status, r.stderr, /^Usage: xcore /.test(r.stdout)], [0, '', true], args.join(' '));
  }
  // a refusal is not a usage mistake: exit code 1, and under --json always { ok: false, error, code }
  for (const [args, code] of [
    [['check', 'nowhere'], 'no-folder'],
    [['dev', '.'], 'not-a-game'],
    [['create', 'x'], 'no-kit'],
    [['backend', 'use', 'custom', '.', '--url', 'https://api.game.example'], 'not-a-game'],
  ]) {
    const j = run([...args, '--json'], { cwd: away.dir });
    assert.equal(j.status, 1, args.join(' '));
    const out = JSON.parse(j.stdout);
    assert.deepEqual([out.ok, typeof out.error, out.code], [false, 'string', code], args.join(' '));
  }
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
  // connect: the kit's own where there is a kit (this package's where there is none: tests/connect.test.mjs)
  assert.equal(run(['connect', '--dry-run'], { cwd: tmp.dir, env }).stdout.trim(), 'kit:["connect","--dry-run"]');
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
  assert.equal(at('/home/a/my-game/node_modules/@xgamesfun/xcore'), 'npx @xgamesfun/xcore', 'installed in the project');
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
  for (const root of [
    '/home/a/my-game/node_modules/@xgamesfun/xcore',
    '/home/a/.npm/_npx/1a2b/node_modules/@xgamesfun/xcore',
  ])
    assert.doesNotMatch(at(root), /^npx (-y )?xcore\b/, 'never the unscoped package');
});
