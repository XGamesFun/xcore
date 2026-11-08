// `xcore secret` (lib/publish/secrets.mjs, lib/server/secrets.mjs): games.fun's name and value rules checked first, the
// folder's own game and the saved sign-in, the routes and bodies games.fun takes, and the value never in an answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { saveSecret } from '../lib/credentials.mjs';
import { credentialKey } from '../lib/publish/client.mjs';
import { deleteSecret, listSecrets, setSecret } from '../lib/publish/secrets.mjs';
import { secretNameProblem, secretValueProblem, SECRET_LIMITS } from '../lib/server/secrets.mjs';
import { readDevVars } from '../lib/dev/server.mjs';
import { newVoucherKey, seedAddress } from '../lib/add.mjs';
import { run, tempDir } from './helpers.mjs';

const ORIGIN = 'https://studio.example';

test("names and values: games.fun's rules", () => {
  for (const ok of ['VOUCHER_KEY', 'A', 'K2']) assert.equal(secretNameProblem(ok), null);
  for (const bad of ['', 'lower', '_A', '9A', 'A-B', 'GF', 'GF_SLUG', 'A'.repeat(65)])
    assert.ok(secretNameProblem(bad), bad);
  assert.match(secretNameProblem('ROOMS', ['ROOMS']), /rooms/);
  assert.equal(secretValueProblem('x'), null);
  assert.ok(secretValueProblem(''));
  assert.ok(secretValueProblem('x'.repeat(SECRET_LIMITS.valueBytes + 1)));
});

test('set, list, delete: the folder’s game, the saved token, the routes; refused before any call when the rules say no', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  const dir = path.join(tmp.dir, 'game');
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  const calls = [],
    names = new Set();
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: u.pathname, auth: init.headers.authorization, body: init.body ?? null });
    const m = u.pathname.match(/^\/api\/kit\/games\/g-77\/secrets(?:\/([A-Z0-9_]+))?$/);
    if (!m) return new Response(JSON.stringify({ error: 'no' }), { status: 404 });
    if (init.method === 'PUT') names.add(m[1]);
    const removed = init.method === 'DELETE' && names.delete(m[1]);
    return Response.json({
      ok: true,
      game: 'g-77',
      ...(m[1] ? { name: m[1] } : {}),
      ...(init.method === 'DELETE' ? { removed } : {}),
      names: [...names].sort(),
    });
  };
  const opts = { origin: ORIGIN, env, fetchImpl };
  await assert.rejects(
    listSecrets(dir, opts),
    /not on https:\/\/studio.example yet: publish it with its server\/ first/,
  );
  await writeFile(path.join(dir, '.gamesfun', 'publish.json'), JSON.stringify({ [ORIGIN]: { projectId: 'g-77' } }));
  await assert.rejects(listSecrets(dir, opts), /not signed in/);
  await saveSecret(credentialKey(ORIGIN), 'gfk_test_token', { studio: ORIGIN, email: 'a@example.com' }, { env });

  const value = 'made-up-' + Date.now();
  const r = await setSecret(dir, 'VOUCHER_KEY', value, opts);
  assert.deepEqual(r, { ok: true, game: 'g-77', name: 'VOUCHER_KEY', names: ['VOUCHER_KEY'] });
  assert.deepEqual(calls.at(-1), {
    method: 'PUT',
    path: '/api/kit/games/g-77/secrets/VOUCHER_KEY',
    auth: 'Bearer gfk_test_token',
    body: JSON.stringify({ value }),
  });
  assert.deepEqual((await listSecrets(dir, opts)).names, ['VOUCHER_KEY']);
  assert.equal((await deleteSecret(dir, 'VOUCHER_KEY', opts)).removed, true);
  const before = calls.length;
  await assert.rejects(setSecret(dir, 'GF_SLUG', 'v', opts), /games.fun’s own/);
  await assert.rejects(setSecret(dir, 'OK', '', opts), /empty/);
  await assert.rejects(deleteSecret(dir, 'lower', opts), /A–Z/);
  assert.equal(calls.length, before, 'nothing was sent');
});

test(".dev.vars: the server's secrets on this machine, with games.fun's names only", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  assert.deepEqual(await readDevVars(tmp.dir), { secrets: {}, names: [], warnings: [] });
  await writeFile(
    path.join(tmp.dir, '.dev.vars'),
    '# a comment\nVOUCHER_KEY="a b"\nlower=1\nROOMS=x\nEMPTY=\nGF_X=1\n',
  );
  const v = await readDevVars(tmp.dir, [{ class: 'Room', binding: 'ROOMS' }]);
  assert.deepEqual(v.secrets, { VOUCHER_KEY: 'a b' });
  assert.deepEqual(v.names, ['VOUCHER_KEY']);
  assert.equal(v.warnings.length, 4);
});

test('set --from-dev-vars: the value xcore dev gives the server, refused before any call when .dev.vars has no such name', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  await writeFile(path.join(tmp.dir, 'index.html'), '<!doctype html><title>g</title>\n');
  await writeFile(path.join(tmp.dir, '.dev.vars'), 'VOUCHER_SEED=abc\n');
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config') };
  const missing = run(['secret', 'set', 'NOPE', tmp.dir, '--from-dev-vars'], { env });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /\.dev\.vars in .* has no NOPE/);
  const both = run(['secret', 'set', 'VOUCHER_SEED', tmp.dir, '--from-dev-vars', '--from-file', 'x'], { env });
  assert.match(both.stderr, /one of --from-file, --from-dev-vars and --new-key/);
  // found: it goes on to games.fun, which this folder is not on yet
  assert.match(run(['secret', 'set', 'VOUCHER_SEED', tmp.dir, '--from-dev-vars'], { env }).stderr, /not on .* yet/);
});

test('set --new-key: a key made here and sent only to games.fun, its address said; refused beside another source', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  await writeFile(path.join(tmp.dir, 'index.html'), '<!doctype html><title>g</title>\n');
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config') };
  const both = run(['secret', 'set', 'VOUCHER_SEED', tmp.dir, '--new-key', '--from-dev-vars'], { env });
  assert.equal(both.status, 2);
  assert.match(both.stderr, /one of --from-file, --from-dev-vars and --new-key/);
  const a = await newVoucherKey(),
    b = await newVoucherKey();
  assert.match(a.seed, /^[0-9a-f]{64}$/);
  assert.notEqual(a.seed, b.seed);
  assert.equal(a.address, await seedAddress(a.seed));
  // found: it goes on to games.fun, which this folder is not on yet (nothing is written here)
  assert.match(run(['secret', 'set', 'VOUCHER_SEED', tmp.dir, '--new-key'], { env }).stderr, /not on .* yet/);
});
