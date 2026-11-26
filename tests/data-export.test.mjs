// `xcore data export`: a published game's saves and leaderboards, through the owner's route, every page, into one file
// of the game's own (.gamesfun/exports/, kept out of git).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  // an older xgames.fun with no such route: said in words
  g.state.handle = (method, url) => (url.startsWith('/api/kit/games/g1/data') ? [404, { error: 'not found' }] : null);
  const old = await runAsync(['data', 'export'], { env, cwd: dir });
  assert.equal(old.status, 1);
  assert.match(old.stderr, /does not export saves and leaderboards yet/);
});
