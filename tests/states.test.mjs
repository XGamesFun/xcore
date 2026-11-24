// The lifecycles the commands report, each named in one place: the sign-in (signInState: signed-out, signed-in,
// expired, unreadable), why a logout did not revoke, and where a folder's game stands (linkState). And what keeps a
// sign-in the person's own: the callback takes only the sign-in this command started, and a token kept in a file is
// readable by its owner alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { credentialsFile, loadSecret, saveSecret, secretName } from '../lib/credentials.mjs';
import { credentialKey, login, logout, signInState } from '../lib/publish/client.mjs';
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
  assert.ok(!g.state.calls.includes('DELETE /api/kit/token'), 'xgames.fun was never asked');
  assert.equal((await signInState(g.origin, { env })).state, 'signed-out');
});

test('logout of a token xgames.fun already ended says so', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  await signIn(g, env);
  g.state.tokens.clear(); // revoked from xgames.fun's side
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
      key = 'xgames.fun https://example.test';
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

test('the sign-in callback takes only the sign-in started here: another state, or none, is refused and nothing is signed in', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  const strangers = [];
  const r = await login({
    origin: g.origin,
    env,
    open: async url => {
      const u = new URL(url),
        callback = `http://127.0.0.1:${u.searchParams.get('port')}/callback`,
        code = 'c'.repeat(43);
      g.state.codes.set(code, u.searchParams.get('challenge'));
      // a page that knows the port sends a code of its own: with a guessed state, with none, and with a cancel
      for (const query of ['code=theirs&state=guessed', 'code=theirs', 'error=denied&state=guessed']) {
        const res = await fetch(`${callback}?${query}`);
        strangers.push([res.status, await res.text()]);
      }
      assert.ok(!g.state.calls.includes('POST /api/kit/token'), 'no code was sent to xgames.fun for them');
      assert.equal((await signInState(g.origin, { env })).state, 'signed-out');
      await fetch(`${callback}?code=${code}&state=${u.searchParams.get('state')}`);
    },
  });
  assert.deepEqual(strangers, Array(3).fill([400, 'This sign-in was not started here.']));
  assert.equal(r.email, 'alice@example.com', 'the person’s own approval still signs in');
  assert.equal(g.state.calls.filter(c => c === 'POST /api/kit/token').length, 1);
  assert.equal((await signInState(g.origin, { env })).state, 'signed-in');
});

test(
  'a sign-in kept in a file is its owner’s alone: the token 0600 in 0700 folders, the record 0600, whatever the umask',
  { skip: process.platform === 'win32' ? 'Windows keeps no mode bits: the user profile protects the file' : false },
  async t => {
    const tmp = await tempDir();
    const umask = process.umask(0); // nothing taken off: the modes below are the ones the store asks for
    t.after(async () => {
      process.umask(umask);
      await tmp.cleanup();
    });
    const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_SECRET_STORE: 'file' },
      key = 'xgames.fun https://example.test';
    const secrets = path.join(env.GAMESFUN_CONFIG_DIR, 'secrets'),
      token = path.join(secrets, `${secretName(key)}.secret`);
    const modes = async () =>
      Object.fromEntries(
        await Promise.all(
          Object.entries({ token, secrets, config: env.GAMESFUN_CONFIG_DIR, record: credentialsFile({ env }) }).map(
            async ([name, file]) => [name, ((await stat(file)).mode & 0o777).toString(8)],
          ),
        ),
      );
    const closed = { token: '600', secrets: '700', config: '700', record: '600' };
    assert.equal((await saveSecret(key, 'TOKEN-A', { email: 'a@x' }, { env })).store, 'file');
    assert.equal(await readFile(token, 'utf8'), 'TOKEN-A');
    assert.deepEqual(await modes(), closed);
    // opened to others since (a copy, a chmod): the next save closes the token, its folder and the record again
    for (const file of [token, secrets, credentialsFile({ env })]) await chmod(file, 0o755);
    await saveSecret(key, 'TOKEN-B', { email: 'a@x' }, { env });
    assert.equal(await readFile(token, 'utf8'), 'TOKEN-B');
    assert.deepEqual(await modes(), closed);
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
