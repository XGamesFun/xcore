// `xcore login` on xgames.fun's approval page, where the developer ticks games or the whole account: the command says
// which the sign-in got, `--status` says it again, and a call refused because the sign-in was not given that game
// (xgames.fun's 'not-granted') says so plainly, with what to do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loginWithReach, loginWords, readReach } from '../lib/login-reach.mjs';
import { runAsync, standIn, tempDir } from './helpers.mjs';

/** The person's browser, approving at once (as tests/helpers.mjs signIn does). */
const approve = g => async url => {
  const u = new URL(url),
    code = 'c'.repeat(43);
  g.state.codes.set(code, u.searchParams.get('challenge'));
  await fetch(
    `http://127.0.0.1:${u.searchParams.get('port')}/callback?code=${code}&state=${u.searchParams.get('state')}`,
  );
};
const NOT_GRANTED =
  'This sign-in was given other games, not this one. Sign in again and choose it, or your whole account: npx -y @xgamesfun/xcore login';

async function setUp(t, reach) {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  g.state.reach = reach;
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  return { tmp, g, env, cli: { ...env, GAMESFUN_STUDIO: g.origin } };
}

test('xcore login says which games the sign-in reaches, by name, and --status says it again', async t => {
  const { g, env, cli } = await setUp(t, { scope: 'games', games: ['g1', 'g2'] });
  g.state.handle = (method, url) =>
    method === 'GET' && url === '/api/kit/plan'
      ? [
          200,
          {
            ok: true,
            games: [
              { id: 'g1', title: 'Moth Run', slug: 'moth-run' },
              { id: 'g2', title: 'Lantern', slug: null },
            ],
          },
        ]
      : null;
  const r = await loginWithReach({ origin: g.origin, env, open: approve(g) });
  assert.equal(r.scope, 'games');
  assert.deepEqual(
    r.games.map(x => x.title),
    ['Moth Run', 'Lantern'],
  );
  const words = loginWords(r);
  assert.match(words, /This sign-in reaches 2 of your games: Moth Run \(moth-run\), Lantern\./);
  assert.match(words, /A game you publish as new from here is added to it; for another, run .*login again and tick it/);
  assert.deepEqual((await readReach(g.origin, { env })).games, r.games);
  const status = await runAsync(['login', '--status'], { env: cli });
  assert.match(status.stdout, /Signed in to .* This sign-in reaches 2 of your games: Moth Run \(moth-run\), Lantern/);
  const json = JSON.parse((await runAsync(['login', '--status', '--json'], { env: cli })).stdout);
  assert.deepEqual([json.scope, json.games.map(x => x.id)], ['games', ['g1', 'g2']]);
  // signed out, it is forgotten with the token
  assert.equal((await runAsync(['logout'], { env: cli })).status, 0);
  assert.equal(await readReach(g.origin, { env }), null);
});

test('xcore login: the whole account, no game yet, and a host that does not say', async t => {
  const a = await setUp(t, { scope: 'account', games: null });
  const all = await loginWithReach({ origin: a.g.origin, env: a.env, open: approve(a.g) });
  assert.match(loginWords(all), /This sign-in reaches your whole account: every game, now and later\./);
  const n = await setUp(t, { scope: 'games', games: [] });
  const none = await loginWithReach({ origin: n.g.origin, env: n.env, open: approve(n.g) });
  assert.match(loginWords(none), /reaches none of your games yet: a game you publish as new from here is added/);
  const old = await setUp(t, undefined);
  const plain = await loginWithReach({ origin: old.g.origin, env: old.env, open: approve(old.g) });
  assert.equal(plain.scope, null);
  assert.doesNotMatch(loginWords(plain), /reaches/);
  assert.match(loginWords(plain), /^Signed in to .* as alice@example\.com\. The token is kept in/);
});

test('a call refused for a game the sign-in was not given says so, and what to do', async t => {
  const { tmp, g, env, cli } = await setUp(t, { scope: 'games', games: ['g2'] });
  g.state.handle = (method, url) =>
    url === '/api/kit/plan'
      ? [200, { ok: true, games: [{ id: 'g2', title: 'Lantern', slug: 'lantern' }] }]
      : url === '/api/kit/games/g1/plan'
        ? [403, { error: NOT_GRANTED, code: 'not-granted' }]
        : null;
  await loginWithReach({ origin: g.origin, env, open: approve(g) });
  const dir = path.join(tmp.dir, 'moth');
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>moth</title>');
  await writeFile(path.join(dir, '.gamesfun', 'publish.json'), JSON.stringify({ [g.origin]: { projectId: 'g1' } }));
  const r = await runAsync(['plan', '--json'], { cwd: dir, env: cli });
  assert.equal(r.status, 1);
  assert.match(
    r.stderr,
    /xgames\.fun refused this: your sign-in \(.*login\) was not given this game\. Run .*login again and tick this game on the approval page \(or choose your whole account\)\. This sign-in reaches: Lantern \(lantern\)\./,
  );
  const out = JSON.parse(r.stdout);
  assert.equal(out.code, 'not-granted');
  assert.match(out.next, / login$/);
});

test('what a sign-in reaches is read from xgames.fun when asked: a game published since shows; offline, the saved list, said so', async t => {
  const { tmp, g, env, cli } = await setUp(t, { scope: 'games', games: [] });
  let games = [];
  g.state.handle = (method, url) =>
    url === '/api/kit/plan'
      ? [200, { ok: true, games }]
      : url === '/api/kit/games/g9/plan'
        ? [403, { error: NOT_GRANTED, code: 'not-granted' }]
        : null;
  await loginWithReach({ origin: g.origin, env, open: approve(g) });
  // a first publish makes a new game, which xgames.fun adds to this sign-in: no new login
  games = [{ id: 'g1', title: 'Moth Run', slug: 'moth-run' }];
  const now = await runAsync(['login', '--status'], { env: cli });
  assert.match(now.stdout, /This sign-in reaches 1 of your games: Moth Run \(moth-run\)\./);
  assert.doesNotMatch(now.stdout, /none of your games|out of date/);
  assert.deepEqual(
    (await readReach(g.origin, { env })).games.map(x => x.id),
    ['g1'],
    'the saved copy is refreshed',
  );
  const json = JSON.parse((await runAsync(['login', '--status', '--json'], { env: cli })).stdout);
  assert.deepEqual([json.games.map(x => x.id), json.reachChecked], [['g1'], true]);
  assert.ok(!JSON.stringify(json).includes('gfk_'), 'no token printed');
  // a refusal names what the sign-in reaches now
  const dir = path.join(tmp.dir, 'other');
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>other</title>');
  await writeFile(path.join(dir, '.gamesfun', 'publish.json'), JSON.stringify({ [g.origin]: { projectId: 'g9' } }));
  const refused = await runAsync(['plan'], { cwd: dir, env: cli });
  assert.match(refused.stderr, /This sign-in reaches: Moth Run \(moth-run\)\./);
  // xgames.fun out of reach: the saved list, said to be possibly out of date
  await g.close();
  const offline = await runAsync(['login', '--status'], { env: cli });
  assert.equal(offline.status, 0);
  assert.match(offline.stdout, /This sign-in reaches 1 of your games: Moth Run \(moth-run\)\./);
  assert.match(
    offline.stdout,
    /xgames\.fun could not be asked just now, so this is the list saved .* and may be out of date/,
  );
});
