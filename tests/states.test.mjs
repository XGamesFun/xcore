// The lifecycles the commands report, each named in one place: the sign-in (signInState: signed-out, signed-in,
// expired, unreadable), why a logout did not revoke, and where a folder's game stands (linkState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { credentialsFile, loadSecret, saveSecret, secretName } from '../lib/credentials.mjs';
import { credentialKey, logout, signInState } from '../lib/publish/client.mjs';
import { linkState, publishGame } from '../lib/publish/index.mjs';
import { fixture, passing, run, signIn, standIn, tempDir } from './helpers.mjs';

async function setExpiry(env, origin, when) {
  const file = credentialsFile({ env });
  const all = JSON.parse(await readFile(file, 'utf8'));
  all.entries[credentialKey(origin)].expiresAt = when;
  await writeFile(file, JSON.stringify(all));
}

test('the sign-in goes signed-out → signed-in → expired, and an expired one is refused in its own words', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  assert.equal((await signInState(g.origin, { env })).state, 'signed-out');
  await signIn(g, env);
  const on = await signInState(g.origin, { env });
  assert.equal(on.state, 'signed-in');
  assert.equal(on.email, 'alice@example.com');

  await setExpiry(env, g.origin, '2026-01-01T00:00:00.000Z');
  const off = await signInState(g.origin, { env });
  assert.equal(off.state, 'expired');
  assert.equal(off.token, undefined, 'an expired sign-in hands out no token');
  const dir = await fixture(tmp, 'static');
  await assert.rejects(publishGame(dir, { origin: g.origin, env, check: passing }), e => {
    assert.equal(e.code, 'login');
    assert.equal(e.state, 'expired');
    assert.match(e.message, /ended on 2026-01-01/);
    return true;
  });

  const status = run(['login', '--status', '--json'], { env: { ...env, GAMESFUN_STUDIO: g.origin } });
  assert.equal(status.status, 0, status.stderr);
  const out = JSON.parse(status.stdout);
  assert.equal(out.state, 'expired');
  assert.equal(out.signedIn, false);
  assert.equal(out.email, 'alice@example.com');
  assert.ok(!('token' in out), 'never prints the token');
});

test('a record whose token cannot be read is unreadable, and logout says it was not revoked', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  await signIn(g, env);
  await rm(path.join(env.GAMESFUN_CONFIG_DIR, 'secrets'), { recursive: true, force: true });
  assert.equal((await signInState(g.origin, { env })).state, 'unreadable');
  assert.deepEqual(await logout(g.origin, { env }), { revoked: false, forgot: true, why: 'unreadable' });
  assert.ok(!g.state.calls.includes('DELETE /api/kit/token'), 'games.fun was never asked');
  assert.equal((await signInState(g.origin, { env })).state, 'signed-out');
});

test('logout of a token games.fun already ended says so', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  await signIn(g, env);
  g.state.tokens.clear(); // revoked from games.fun's side
  assert.deepEqual(await logout(g.origin, { env }), { revoked: false, forgot: true, why: 'ended' });
});

test(
  'a sign-in saved to the file is read from the file, never shadowed by an older keyring token',
  { skip: process.platform === 'win32' ? 'a fake secret-tool needs a shell' : false },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const keys = path.join(tmp.dir, 'keyring'),
      bin = path.join(tmp.dir, 'bin');
    await mkdir(keys, { recursive: true });
    await mkdir(bin, { recursive: true });
    // a Secret Service stand-in: one file per account
    await writeFile(
      path.join(bin, 'secret-tool'),
      `#!/bin/sh\ncmd="$1"; for a; do name="$a"; done; f="${keys}/$name"\n` +
        `case "$cmd" in store) cat > "$f";; lookup) [ -f "$f" ] && cat "$f" || exit 1;; clear) rm -f "$f";; esac\n`,
    );
    await chmod(path.join(bin, 'secret-tool'), 0o755);
    const config = path.join(tmp.dir, 'config'),
      key = 'games.fun https://example.test';
    const desktop = { GAMESFUN_CONFIG_DIR: config, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/x', PATH: bin };
    const ssh = { GAMESFUN_CONFIG_DIR: config, PATH: bin }; // no session bus: the file store
    assert.equal(
      (await saveSecret(key, 'TOKEN-A', { email: 'a@x' }, { env: desktop, platform: 'linux' })).store,
      'secret-service',
    );
    assert.equal((await saveSecret(key, 'TOKEN-B', { email: 'b@x' }, { env: ssh, platform: 'linux' })).store, 'file');
    await readFile(path.join(keys, secretName(key)), 'utf8'); // the old token is still in the keyring
    const back = await loadSecret(key, { env: desktop, platform: 'linux' });
    assert.equal(back.secret, 'TOKEN-B', 'the token the record names, not the keyring’s older one');
    assert.equal(back.meta.email, 'b@x');
  },
);

test('a game’s link state', () => {
  assert.equal(linkState(null), 'never');
  assert.equal(linkState({ projectId: 'g1', slug: null }), 'started');
  assert.equal(linkState({ projectId: 'g1', url: null, lastVersion: 1, draft: true }), 'draft');
  assert.equal(
    linkState({ projectId: 'g1', url: 'https://x/play/a', lastVersion: 2, draft: true }),
    'draft-over-public',
  );
  assert.equal(linkState({ projectId: 'g1', url: 'https://x/play/a', lastVersion: 2, draft: false }), 'public');
});
