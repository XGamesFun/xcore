// `xcore data export`: a published game's saves and leaderboards, through the owner's route, every page, into one file
// of the game's own (.gamesfun/exports/, kept out of git).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runAsync, signIn, standIn, tempDir } from './helpers.mjs';

test('xcore data export reads every page of saves and of each board into .gamesfun/exports/', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = {
    GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'),
    GAMESFUN_CREDENTIALS: 'file',
    GAMESFUN_STUDIO: g.origin,
    GAMESFUN_NO_UPDATE_CHECK: '1',
  };
  await signIn(g, env);
  const dir = path.join(tmp.dir, 'moth');
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>moth</title>');
  await writeFile(path.join(dir, '.gamesfun', 'publish.json'), JSON.stringify({ [g.origin]: { projectId: 'g1' } }));
  const seen = [];
  g.state.handle = (method, url, json, { authed }) => {
    if (!url.startsWith('/api/kit/games/g1/data')) return null;
    if (!authed) return [401, { error: 'Sign in first.' }];
    const q = new URL(url, g.origin).searchParams;
    seen.push(`${q.get('part')}${q.get('board') ? `:${q.get('board')}` : ''}@${q.get('after') ?? ''}`);
    if (q.get('part') === 'saves')
      return q.get('after')
        ? [
            200,
            {
              ok: true,
              saves: [{ pid: 'bbbb', key: 'main', value: '{"level":2}', bytes: 11, updatedAt: 2 }],
              after: null,
            },
          ]
        : [
            200,
            {
              ok: true,
              saves: [{ pid: 'aaaa', key: 'main', value: '{"level":1}', bytes: 11, updatedAt: 1 }],
              after: '["a","main"]',
            },
          ];
    if (q.get('part') === 'boards') return [200, { ok: true, boards: [{ board: 'best', order: 'high', entries: 2 }] }];
    if (q.get('part') === 'board')
      return [
        200,
        {
          ok: true,
          board: 'best',
          order: 'high',
          entries: [
            { pid: 'aaaa', score: 9, name: 'Ana', at: 1 },
            { pid: 'bbbb', score: 3, name: 'Bo', at: 2, hidden: true },
          ],
          after: null,
        },
      ];
    return [404, { error: 'no' }];
  };
  const r = await runAsync(['data', 'export', '--json'], { env, cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.saves, 2);
  assert.deepEqual(out.boards, [{ board: 'best', entries: 2 }]);
  assert.match(
    out.file,
    /^\.gamesfun[\\/]exports[\\/]data-.+\.json$/,
    "a path from the game folder, in the system's own separators",
  );
  assert.deepEqual(seen, ['saves@', 'saves@["a","main"]', 'boards@', 'board:best@']);
  const file = JSON.parse(await readFile(path.join(dir, out.file), 'utf8'));
  assert.equal(file.gamesfun, 'data-export-v1');
  assert.deepEqual(
    file.saves.map(s => s.value),
    [{ level: 1 }, { level: 2 }],
    "a save's JSON, parsed",
  );
  assert.equal(file.boards[0].entries[1].hidden, true);
  if (process.platform !== 'win32') assert.equal((await stat(path.join(dir, out.file))).mode & 0o777, 0o600);
  // --out among the game's published files: refused before anything is fetched, so players' data never goes up
  const asked = seen.length;
  const inside = await runAsync(['data', 'export', '--out', 'players.json'], { env, cwd: dir });
  assert.equal(inside.status, 1);
  assert.match(inside.stderr, /is among the game's published files \(players\.json\)/);
  assert.equal(seen.length, asked, 'nothing was fetched');
  assert.equal(existsSync(path.join(dir, 'players.json')), false);
  // an existing --out file: refused without --force; with it, written over and made this user's only
  const there = path.join(tmp.dir, 'there.json');
  await writeFile(there, 'old', { mode: 0o644 });
  const kept = await runAsync(['data', 'export', '--out', there], { env, cwd: dir });
  assert.equal(kept.status, 1);
  assert.match(kept.stderr, /is there already: --force writes over it/);
  assert.equal(await readFile(there, 'utf8'), 'old');
  const forced = await runAsync(['data', 'export', '--out', there, '--force'], { env, cwd: dir });
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(JSON.parse(await readFile(there, 'utf8')).gamesfun, 'data-export-v1');
  if (process.platform !== 'win32') assert.equal((await stat(there)).mode & 0o777, 0o600);
  // a data export put among the published files by hand anyway is refused by publish, as is any .sql file
  await writeFile(path.join(dir, 'copy.json'), await readFile(there));
  await writeFile(path.join(dir, 'backup.sql'), 'INSERT INTO players VALUES (1);\n');
  const { preflight } = await import('../lib/publish/index.mjs');
  const problems = (await preflight(dir, { origin: g.origin })).problems.join('\n');
  assert.match(problems, /^copy\.json: a players' data export/m);
  assert.match(problems, /^backup\.sql: a SQL file, such as a database export/m);
  // an older xgames.fun with no such route: said in words
  g.state.handle = (method, url) => (url.startsWith('/api/kit/games/g1/data') ? [404, { error: 'not found' }] : null);
  const old = await runAsync(['data', 'export'], { env, cwd: dir });
  assert.equal(old.status, 1);
  assert.match(old.stderr, /does not export saves and leaderboards yet/);
});
