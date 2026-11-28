// What sign-in and sign-out say and keep: a login that replaces another revokes it, the browser tab says signed in
// only once the token is kept, a logout that could not revoke keeps the token (or forgets it with --forget), a
// credentials.json that does not read is said as that and never written over, and login --status asks xgames.fun once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { credentialsFile, saveSecret } from '../lib/credentials.mjs';
import { credentialKey, login, logout, savedLogin, signInState } from '../lib/publish/client.mjs';
import { currentReach, loginWords } from '../lib/login-reach.mjs';
import { runAsync, signIn, standIn, tempDir } from './helpers.mjs';

async function setup(t) {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  return { tmp, g, env, cli: { env: { ...env, GAMESFUN_STUDIO: g.origin } } };
}

/** A sign-in whose "browser" approves at once and reads what the tab shows. → {r, page} */
async function signInReading(g, env, { failExchange = false } = {}) {
  let page = null;
  const r = await login({
    origin: g.origin,
    env,
    open: async url => {
      const u = new URL(url),
        code = 'c'.repeat(43);
      if (!failExchange) g.state.codes.set(code, u.searchParams.get('challenge'));
      const res = await fetch(
        `http://127.0.0.1:${u.searchParams.get('port')}/callback?code=${code}&state=${u.searchParams.get('state')}`,
      );
      page = await res.text();
    },
  }).catch(e => e);
  // the tab is answered after login() settles; give its fetch a moment to read
  for (let i = 0; i < 50 && page === null; i++) await new Promise(res => setTimeout(res, 20));
  return { r, page };
}

test('the browser tab says signed in only once the token is kept; a failed exchange says not connected', async t => {
  const { g, env } = await setup(t);
  const bad = await signInReading(g, env, { failExchange: true });
  assert.ok(bad.r instanceof Error);
  assert.match(bad.page, /Not connected/);
  assert.doesNotMatch(bad.page, /signed in<\/h1>/);
  const good = await signInReading(g, env);
  assert.equal(good.r.email, 'alice@example.com');
  assert.match(good.page, /The kit is signed in/);
});

test('signing in again revokes the token it replaces at xgames.fun', async t => {
  const { g, env } = await setup(t);
  // a token this computer kept from an earlier sign-in, live at xgames.fun
  const old = 'gfk_' + 'b'.repeat(43);
  g.state.tokens.add(old);
  await saveSecret(
    credentialKey(g.origin),
    old,
    { studio: g.origin, email: 'alice@example.com', expiresAt: new Date(Date.now() + 1e9).toISOString() },
    { env },
  );
  const r = await signIn(g, env);
  assert.deepEqual(r.replaced, { revoked: true });
  assert.equal(g.state.tokens.has(old), false, 'the old token no longer works');
  assert.equal((await savedLogin(g.origin, { env })).token, 'gfk_' + 'a'.repeat(43));
  assert.match(loginWords({ ...r, studio: g.origin }), /The sign-in it replaces on this computer is revoked\./);
  assert.match(
    loginWords({ ...r, studio: g.origin, replaced: { revoked: false, why: 'Could not reach xgames.fun.' } }),
    /could not be revoked \(Could not reach xgames\.fun\): it ends by itself when it expires, or revoke it at http:\/\/127\.0\.0\.1:\d+\/console\?tab=sign-ins\./,
  );
  // the same token again (nothing to replace): no revoke
  g.state.calls.length = 0;
  assert.equal((await signIn(g, env)).replaced, undefined);
  assert.ok(!g.state.calls.includes('DELETE /api/kit/token'));
});

test('a logout xgames.fun did not answer keeps the token to try again; --forget drops it, naming where to revoke it', async t => {
  const { g, env, cli } = await setup(t);
  await signIn(g, env);
  g.state.handle = (method, url) => (method === 'DELETE' && url === '/api/kit/token' ? [500, { error: 'down' }] : null);
  assert.deepEqual(await logout(g.origin, { env }), { revoked: false, forgot: false, why: 'offline', status: 500 });
  assert.equal((await signInState(g.origin, { env })).state, 'signed-in', 'still signed in: it can be tried again');
  const kept = await runAsync(['logout'], cli);
  assert.equal(kept.status, 1);
  assert.match(
    kept.stdout,
    /^Not signed out: .* answered with a server error \(500\), so the token could not be revoked\. It is kept on this computer so you can try again: .*logout\. To forget it here anyway: .*logout --forget .*\/console\?tab=sign-ins/,
  );
  const forgot = await runAsync(['logout', '--forget', '--json'], cli);
  assert.equal(forgot.status, 0, forgot.stderr);
  assert.deepEqual(JSON.parse(forgot.stdout), {
    studio: g.origin,
    revoked: false,
    forgot: true,
    why: 'offline',
    status: 500,
  });
  assert.equal((await signInState(g.origin, { env })).state, 'signed-out');
  // xgames.fun answering again: a plain logout revokes, as before
  g.state.handle = null;
  await signIn(g, env);
  // no answer at all: no status to give
  const down = () => Promise.reject(new TypeError('fetch failed'));
  assert.deepEqual(await logout(g.origin, { env, fetchImpl: down }), { revoked: false, forgot: false, why: 'offline' });
  assert.deepEqual(await logout(g.origin, { env }), { revoked: true, forgot: true });
});

test('a credentials.json that does not read is said as that, with its path, and a sign-in never writes over it', async t => {
  const { g, env, cli } = await setup(t);
  await signIn(g, env);
  const file = credentialsFile({ env });
  const broken = '{"version":1,"entries":{"games.fun https://other.example":{"email":"a@b"';
  await writeFile(file, broken);
  const st = await signInState(g.origin, { env });
  assert.equal(st.state, 'unreadable');
  assert.equal(st.record, file);
  assert.match(st.words, /does not read \(it is not valid JSON/);
  const status = await runAsync(['login', '--status'], cli);
  assert.doesNotMatch(status.stdout + status.stderr, /Not signed in/);
  assert.match(status.stdout + status.stderr, /credentials\.json does not read/);
  await assert.rejects(signIn(g, env), e => e.code === 'credentials-unreadable');
  assert.equal(await readFile(file, 'utf8'), broken, 'left as it was');
});

test('login --status asks xgames.fun once: confirmed, ended there, or not confirmed', async t => {
  const { g, env, cli } = await setup(t);
  await signIn(g, env);
  let j = JSON.parse((await runAsync(['login', '--status', '--json'], cli)).stdout);
  assert.deepEqual([j.signedIn, j.confirmed, j.studioSays], [true, true, 'ok']);
  // revoked elsewhere (the console): xgames.fun says so, and the way on is a sign-in
  g.state.tokens.clear();
  j = JSON.parse((await runAsync(['login', '--status', '--json'], cli)).stdout);
  assert.deepEqual([j.signedIn, j.confirmed, j.studioSays], [false, false, 'ended']);
  assert.match(j.next, / login$/);
  const words = await runAsync(['login', '--status'], cli);
  assert.match(words.stdout, /But xgames\.fun says this sign-in has ended/);
  // xgames.fun not answering: not confirmed, said so
  await g.close();
  j = JSON.parse((await runAsync(['login', '--status', '--json'], cli)).stdout);
  assert.deepEqual([j.confirmed, j.studioSays], [false, 'unreachable']);
});

test('a whole-account sign-in’s reach is not said to be checked when nothing was asked', async t => {
  const { g, env } = await setup(t);
  g.state.reach = { scope: 'account' };
  const { loginWithReach } = await import('../lib/login-reach.mjs');
  await loginWithReach({
    origin: g.origin,
    env,
    open: async url => {
      const u = new URL(url),
        code = 'c'.repeat(43);
      g.state.codes.set(code, u.searchParams.get('challenge'));
      await fetch(
        `http://127.0.0.1:${u.searchParams.get('port')}/callback?code=${code}&state=${u.searchParams.get('state')}`,
      );
    },
  });
  const calls = g.state.calls.length;
  const reach = await currentReach(g.origin, { env });
  assert.deepEqual([reach.scope, reach.checked], ['account', false]);
  assert.equal(g.state.calls.length, calls, 'no request made');
});
