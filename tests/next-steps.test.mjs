// The next steps a command prints, followed from the folder it ran in: each names the game's folder as the person typed
// it, and fits the game it is printed for (a web game, a Godot or Unity project, a game with xcore's stock server).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture, ROOT, run, tempDir } from './helpers.mjs';

const GRANT = JSON.parse(await readFile(path.join(ROOT, 'tests', 'fixtures', 'grant-0.29.0.json'), 'utf8'));

/** A web game in tmp/nx, run from tmp (the folder above it). */
async function webGame(t) {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  await fixture(tmp, 'static');
  const { rename } = await import('node:fs/promises');
  await rename(path.join(tmp.dir, 'static'), path.join(tmp.dir, 'nx'));
  return tmp.dir;
}

test('add signin, multiplayer and database name the folder typed, and say guests save without a sign-in', async t => {
  const cwd = await webGame(t);
  const signin = run(['add', 'signin', 'nx'], { cwd });
  assert.equal(signin.status, 0, signin.stderr);
  assert.match(signin.stdout, / dev nx\n/);
  assert.doesNotMatch(signin.stdout, / dev \.(\s|,)/);
  assert.match(signin.stdout, /Guests save in their browser; signing in keeps saves with the account and posts scores/);
  assert.doesNotMatch(signin.stdout, /Sign in to save/);
  assert.match(signin.stdout, / add signin nx --verbose/);
  // a board the page writes takes any score: said where the leaderboard calls are
  const verbose = run(['add', 'signin', 'nx', '--verbose'], { cwd });
  assert.match(verbose.stdout, /A leaderboard the page writes takes any score a player sends from their browser/);
  assert.match(verbose.stdout, /writer: 'server'/);
  // the stock server: a database with no migrations of its own
  const db = run(['add', 'database', 'nx'], { cwd });
  assert.equal(db.status, 0, db.stderr);
  assert.match(db.stdout, / dev nx, and read it with /);
  assert.match(db.stdout, /publish creates the database on xgames\.fun, where xcore's stock server keeps/);
  assert.doesNotMatch(db.stdout, /applies the migrations/);
  const rooms = run(['add', 'multiplayer', 'nx'], { cwd });
  assert.equal(rooms.status, 0, rooms.stderr);
  assert.match(rooms.stdout, / dev nx, and open the game in two tabs/);
});

test('backend use custom and a not-published refusal name the folder typed', async t => {
  const cwd = await webGame(t);
  const r = run(['backend', 'use', 'custom', 'nx', '--url', 'https://api.example.com'], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Next: .* check nx, which fails/);
  const { notPublished } = await import('../lib/games.mjs');
  const e = notPublished(path.join(cwd, 'nx'), 'https://xgames.fun', ', then put its files', { cwd });
  assert.equal(e.code, 'not-published');
  assert.match(e.next, / publish nx$/);
  assert.match(
    e.message,
    /^this folder's game is not on https:\/\/xgames\.fun yet: publish it first \(.* publish nx\), then put its files$/,
  );
  assert.match(notPublished(cwd, 'https://xgames.fun', '', { cwd }).next, / publish$/);
});

test('a Godot project: multiplayer is tried in the editor, then its export; calls by their GDScript names', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const gd = path.join(tmp.dir, 'gd');
  await mkdir(gd);
  await writeFile(path.join(gd, 'project.godot'), 'config_version=5\n');
  const db = run(['add', 'database', 'gd'], { cwd: tmp.dir });
  assert.equal(db.status, 0, db.stderr);
  assert.match(db.stdout, /await GamesFun\.db_add\("levels", \{\.\.\.\}\), db_get, db_put, db_list, db_delete\./);
  assert.doesNotMatch(db.stdout, /\), get, put, list, delete/);
  const rooms = run(['add', 'multiplayer', 'gd'], { cwd: tmp.dir });
  assert.equal(rooms.status, 0, rooms.stderr);
  assert.match(rooms.stdout, /Debug → Customize Run Instances runs two, over a local ENet game/);
  assert.match(rooms.stdout, / adopt gd --out <the export folder>, and .* dev gd, and open the game in two tabs/);
  assert.doesNotMatch(rooms.stdout, / dev \.(\s|,)/);
  // adopted with its export folder: the export goes there, and adopt is not asked for again
  await writeFile(path.join(gd, 'gamesfun.json'), JSON.stringify({ page: { out: 'build/web' } }));
  const signin = run(['add', 'signin', 'gd'], { cwd: tmp.dir });
  assert.equal(signin.status, 0, signin.stderr);
  assert.match(
    signin.stdout,
    /Export for the Web with Thread Support off into build\/web \(the folder gamesfun\.json records\), then: .* check gd/,
  );
  assert.doesNotMatch(signin.stdout, / adopt /);
});

test('a Unity project: multiplayer is tried in its WebGL build, never with dev on the project as it is', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const u = path.join(tmp.dir, 'u');
  await mkdir(path.join(u, 'ProjectSettings'), { recursive: true });
  await mkdir(path.join(u, 'Assets'));
  await writeFile(path.join(u, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.0f1\n');
  const rooms = run(['add', 'multiplayer', 'u'], { cwd: tmp.dir });
  assert.equal(rooms.status, 0, rooms.stderr);
  assert.match(
    rooms.stdout,
    /Build for WebGL .*, then: .* adopt u --out <the build folder>, and .* dev u, and open the game in two tabs/,
  );
});

test('add vouchers: no "write PAY.check" once it names a grant, and the last step publishes again', async t => {
  const cwd = await webGame(t);
  const dir = path.join(cwd, 'nx');
  await writeFile(
    path.join(dir, 'xsolana.json'),
    JSON.stringify({ grants: [{ key: 'clear', name: 'Clear', id: GRANT.id }], live: { project: GRANT.project } }),
  );
  const first = run(['add', 'vouchers', 'nx'], { cwd });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Write PAY\.check in server\/vouchers\.js/);
  assert.match(first.stdout, / review nx\n/);
  assert.match(
    first.stdout,
    /loot approve, then .* publish nx again, so the page serves xsolana\.json as it went live/,
  );
  const file = path.join(dir, 'server', 'vouchers.js');
  await writeFile(
    file,
    (await readFile(file, 'utf8')).replace(
      /async check\(\) \{\r?\n {4}return \{ why: [^\r\n]*\r?\n {2}\},/,
      "async check({ body }) {\n    return { grant: 'clear', round: body.runId, amount: 1 };\n  },",
    ),
  );
  const again = run(['add', 'vouchers', 'nx'], { cwd });
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /Write PAY\.check in server\/vouchers\.js/);
});
