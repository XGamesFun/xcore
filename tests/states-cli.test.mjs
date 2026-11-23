// The command line's states, said the same way to a person and to a script: which program answers a command (the kit
// or this package), where an adopt leaves the game, what a re-adopt keeps, a refusal before anything is written, and a
// failure under --json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { kitsTurn } from '../bin/xcore.mjs';
import { addDatabase } from '../lib/add.mjs';
import { adopt, adoptNext } from '../lib/publish/adopt.mjs';
import { readPage } from '../lib/publish/page.mjs';
import { fixture, run, tempDir } from './helpers.mjs';

test("a flag's value is never taken for the game's folder", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const kg = path.join(tmp.dir, 'kg');
  await mkdir(kg);
  await writeFile(path.join(kg, 'gf-three.json'), '{}');
  assert.equal(kitsTurn('check', [kg]), true);
  assert.equal(kitsTurn('check', ['--port', '4000', kg]), true);
  assert.equal(kitsTurn('check', ['--out', 'ev', kg]), true);
  assert.equal(kitsTurn('publish', ['--title', 'My game', kg]), true);
  assert.equal(kitsTurn('check', ['--port=4000', kg]), true);
  assert.equal(kitsTurn('check', ['--port', '4000', tmp.dir]), false, 'a folder the kit did not make is ours');
  // every flag these commands' usage gives a value to (--port <n>, --plan <name>, …): its value is not the folder
  for (const name of ['check', 'publish', 'dev']) {
    const { default: command } = await import(`../commands/${name}.mjs`);
    const flags = [...command.usage.split('\n\n')[0].matchAll(/--([a-z-]+) <[^>]+>/g)].map(m => m[1]);
    assert.ok(flags.length > 0, name);
    for (const flag of flags)
      assert.equal(kitsTurn(name, [`--${flag}`, 'value', kg]), true, `${name} --${flag} value <a kit game>`);
  }
  const { default: backend } = await import('../commands/backend.mjs');
  for (const [, flag] of backend.usage.split('\n\n')[0].matchAll(/--([a-z-]+) <[^>]+>/g))
    assert.equal(kitsTurn('backend', [`--${flag}`, 'value', 'use', 'custom']), false, `backend --${flag} is ours`);
});

test('an adopt ends refused, fix or ready, the same in words and in --json', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  const r = await adopt(dir);
  assert.equal(adoptNext(r).state, 'ready');
  assert.match(adoptNext(r, { shown: () => 'game' }).next, / check game$/);
  assert.equal(adoptNext({ ...r, fix: [{ what: 'x', fix: 'y' }] }).state, 'fix');
  assert.equal(adoptNext({ ...r, refused: [{ what: 'x', fix: 'y' }] }).next, null);

  const out = run(['adopt', dir, '--json']);
  const j = JSON.parse(out.stdout);
  assert.equal(j.state, 'ready');
  assert.match(j.next, / check /);
});

test('re-adopting with one flag keeps the rest of the record', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  // a custom build that makes site/ from the fixture's files
  await writeFile(
    path.join(dir, 'make.mjs'),
    "import { cpSync, mkdirSync } from 'node:fs';\nmkdirSync('site', { recursive: true });\n" +
      "for (const f of ['index.html', 'game.js', 'style.css', 'icon.svg']) cpSync(f, 'site/' + f);\n",
  );
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  const first = await adopt(dir, { build: 'node make.mjs', out: 'site' });
  assert.deepEqual(first.refused, [], JSON.stringify(first.refused));
  assert.equal(readPage(dir).build, 'node make.mjs');

  const again = await adopt(dir, { static: 'assets' });
  assert.deepEqual(again.refused, [], JSON.stringify(again.refused));
  const page = readPage(dir);
  assert.equal(page.build, 'node make.mjs', 'the build is kept');
  assert.equal(page.out, 'site', 'and so is its output folder');
  assert.equal(page.static, 'assets');
  assert.deepEqual(again.kept, ['build (node make.mjs)', 'out (site)']);
});

test('add refuses a broken gamesfun.json before writing anything', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await writeFile(path.join(dir, 'gamesfun.json'), '{ not json');
  await assert.rejects(addDatabase(dir), /not valid JSON/);
  assert.equal(existsSync(path.join(dir, 'server')), false, 'no server/ was written');
  assert.equal(await readFile(path.join(dir, 'gamesfun.json'), 'utf8'), '{ not json');
});

test('a failure under --json is said on stdout too', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_STUDIO: 'http://127.0.0.1:9' };
  const r = run(['publish', dir, '--json'], { env });
  assert.equal(r.status, 1);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, false);
  assert.equal(j.code, 'login');
  assert.equal(j.state, 'signed-out');
  assert.match(j.next, / login$/);
  assert.match(r.stderr, /Not signed in/, 'and on stderr as before');

  const bad = run(['publish', dir, '--bogus', '--json'], { env });
  assert.equal(bad.status, 2);
  assert.equal(JSON.parse(bad.stdout).code, 'usage');

  // a report that says no is a failure in the same shape: adopt's of a folder it cannot host
  const none = run(['adopt', path.join(tmp.dir, 'nowhere'), '--json']);
  assert.equal(none.status, 1);
  const refused = JSON.parse(none.stdout);
  assert.deepEqual([refused.ok, refused.code, refused.state], [false, 'refused', 'refused']);
  assert.match(refused.error, /^cannot be hosted as it is: .*nowhere: no such folder$/);
  assert.equal(refused.refused.length, 1, 'its report is there too');
  // and the page check's, when a check fails (here before Chrome is needed: the page is gone)
  await rm(path.join(dir, 'index.html'));
  const failed = run(['check', dir, '--json'], { env });
  assert.equal(failed.status, 1);
  const record = JSON.parse(failed.stdout);
  assert.deepEqual([record.ok, record.code, record.pass], [false, 'check', false]);
  assert.equal(record.error, 'the page check failed: 2 it fits the hosting; 3 the page starts');
  assert.equal(record.checks.length, 4, 'its record is there too');
});
