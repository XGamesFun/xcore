// `xcore secret` (lib/publish/secrets.mjs, lib/server/secrets.mjs): xgames.fun's name and value rules checked first, the
// folder's own game and the saved sign-in, the routes and bodies xgames.fun takes, and the value never in an answer.
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { saveSecret } from '../lib/credentials.mjs';
import { credentialKey } from '../lib/publish/client.mjs';
import { deleteSecret, listSecrets, setSecret } from '../lib/publish/secrets.mjs';
import { secretNameProblem, secretValueProblem, SECRET_LIMITS } from '../lib/server/secrets.mjs';
import { readDevVars } from '../lib/dev/server.mjs';
import { newVoucherKey, seedAddress } from '../lib/add.mjs';
import { BIN, run, runAsync, signIn, standIn, tempDir } from './helpers.mjs';

const ORIGIN = 'https://studio.example';

test("names and values: xgames.fun's rules", () => {
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
  await assert.rejects(listSecrets(dir, opts), /not signed in/i);
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
  await assert.rejects(setSecret(dir, 'GF_SLUG', 'v', opts), /xgames.fun’s own/);
  await assert.rejects(setSecret(dir, 'OK', '', opts), /empty/);
  await assert.rejects(deleteSecret(dir, 'lower', opts), /A–Z/);
  assert.equal(calls.length, before, 'nothing was sent');
});

test(".dev.vars: the server's secrets on this machine, with xgames.fun's names only", async t => {
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
  // found: it goes on to xgames.fun, which this folder is not on yet
  assert.match(run(['secret', 'set', 'VOUCHER_SEED', tmp.dir, '--from-dev-vars'], { env }).stderr, /not on .* yet/);
});

test('set --new-key: a key made here and sent only to xgames.fun, its address said; refused beside another source', async t => {
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
  // found: it goes on to xgames.fun, which this folder is not on yet (nothing is written here)
  assert.match(run(['secret', 'set', 'VOUCHER_SEED', tmp.dir, '--new-key'], { env }).stderr, /not on .* yet/);
});

test('replacing or deleting a live secret prints what changes (never a value) with a code, and acts only with --yes <code>; a new name is set at once', async t => {
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
  const dir = path.join(tmp.dir, 'game');
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>g</title>\n');
  await writeFile(path.join(dir, '.gamesfun', 'publish.json'), JSON.stringify({ [g.origin]: { projectId: 'g-9' } }));
  const names = new Map();
  const changes = [];
  g.state.handle = (method, url, json, { authed }) => {
    const m = url.match(/^\/api\/kit\/games\/g-9\/secrets(?:\/([A-Z0-9_]+))?$/);
    if (!m) return null;
    if (!authed) return [401, { error: 'Sign in first.' }];
    if (method === 'PUT') {
      names.set(m[1], json.value);
      changes.push(`PUT ${m[1]}`);
    }
    let removed;
    if (method === 'DELETE') {
      removed = names.delete(m[1]);
      changes.push(`DELETE ${m[1]}`);
    }
    return [
      200,
      {
        ok: true,
        game: 'g-9',
        ...(m[1] ? { name: m[1] } : {}),
        ...(removed === undefined ? {} : { removed }),
        names: [...names.keys()].sort(),
      },
    ];
  };
  const xc = args => runAsync(['secret', ...args], { env, cwd: dir });
  await writeFile(path.join(tmp.dir, 'one.txt'), 'first-value\n');
  await writeFile(path.join(tmp.dir, 'two.txt'), 'second-value\n');

  // a name the server does not have: set at once
  let r = await xc(['set', 'API_KEY', '--from-file', path.join(tmp.dir, 'one.txt')]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(changes, ['PUT API_KEY']);
  assert.equal(names.get('API_KEY'), 'first-value');

  // the same name again: what it replaces and a code, nothing sent, and never the value
  r = await xc(['set', 'API_KEY', '--from-file', path.join(tmp.dir, 'two.txt')]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /has API_KEY already\. This replaces its value with the file .*two\.txt/);
  assert.match(r.stdout, /gone for good/);
  assert.match(
    r.stdout,
    /Nothing was replaced\. To go on, run this again with the code:\n.* secret set API_KEY --from-file \S+two\.txt --yes [0-9a-f]{8}$/m,
  );
  assert.doesNotMatch(r.stdout + r.stderr, /first-value|second-value/);
  assert.deepEqual(changes, ['PUT API_KEY']);
  const code = r.stdout.match(/--yes ([0-9a-f]{8})/)[1];
  // --json: the same printout as data
  r = await xc(['set', 'API_KEY', '--from-file', path.join(tmp.dir, 'two.txt'), '--json']);
  const planned = JSON.parse(r.stdout);
  assert.equal(planned.planned, true);
  assert.notEqual(planned.code, code, 'each printout its own code');
  assert.equal(planned.plan.action, 'replace');
  assert.equal(planned.plan.name, 'API_KEY');
  assert.match(planned.confirm, new RegExp(`--yes ${planned.code}$`));
  assert.equal('next' in planned, false);
  assert.doesNotMatch(r.stdout, /second-value/);
  // a code for another change (another source) is refused
  r = await xc(['set', 'API_KEY', '--from-file', path.join(tmp.dir, 'one.txt'), '--yes', code]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /That code is not for this change/);
  assert.deepEqual(changes, ['PUT API_KEY']);
  r = await xc(['set', 'API_KEY', '--from-file', path.join(tmp.dir, 'two.txt'), '--yes', code]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(names.get('API_KEY'), 'second-value');
  // a piped value binds the code too, though it is never printed: a code printed for one value never sets another
  const piped = (input, args) =>
    new Promise(resolve => {
      const child = spawn(process.execPath, [BIN, 'secret', ...args], {
        cwd: dir,
        env: { ...process.env, GAMESFUN_KIT: '', ...env },
      });
      let stdout = '',
        stderr = '';
      child.stdout.on('data', c => (stdout += c));
      child.stderr.on('data', c => (stderr += c));
      child.stdin.end(input);
      child.on('close', status => resolve({ status, stdout, stderr }));
    });
  r = await piped('third-value\n', ['set', 'API_KEY']);
  assert.equal(r.status, 0, r.stderr);
  const pipedCode = r.stdout.match(/--yes ([0-9a-f]{8})/)[1];
  assert.doesNotMatch(r.stdout, /third-value/);
  r = await piped('another-value\n', ['set', 'API_KEY', '--yes', pipedCode]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /That code is not for this change/);
  assert.equal(names.get('API_KEY'), 'second-value');
  r = await piped('third-value\n', ['set', 'API_KEY', '--yes', pipedCode]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(names.get('API_KEY'), 'third-value');

  // a new voucher key over one the server has: says the old key is gone for good and what that breaks
  names.set('VOUCHER_SEED', 'a'.repeat(64));
  r = await xc(['set', 'VOUCHER_SEED', '--new-key']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /The key in VOUCHER_SEED now is gone for good/);
  assert.match(
    r.stdout,
    /are pointed at the new key in xsolana\.json as it is made; what the server signs with it is refused on chain until that change goes live/,
  );
  assert.match(r.stdout, /vouchers the old key signed that nobody redeemed yet stop paying/);
  assert.equal(names.get('VOUCHER_SEED'), 'a'.repeat(64), 'nothing replaced');
  const keyCode = r.stdout.match(/--yes ([0-9a-f]{8})/)[1];
  r = await xc(['set', 'VOUCHER_SEED', '--new-key', '--yes', keyCode, '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.match(names.get('VOUCHER_SEED'), /^[0-9a-f]{64}$/);
  assert.notEqual(names.get('VOUCHER_SEED'), 'a'.repeat(64));

  // delete: printed with a code first; a name that is not there needs no yes and sends nothing
  const before = changes.length;
  r = await xc(['delete', 'API_KEY']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /This deletes API_KEY from .*server on xgames\.fun \(game g-9\)/);
  assert.equal(changes.length, before);
  const del = r.stdout.match(/--yes ([0-9a-f]{8})/)[1];
  assert.notEqual(del, code);
  r = await xc(['delete', 'VOUCHER_SEED', '--yes', del]);
  assert.equal(r.status, 1, 'the code of another name');
  assert.equal(changes.length, before);
  r = await xc(['delete', 'API_KEY', '--yes', del]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Deleted API_KEY/);
  assert.deepEqual(changes.slice(before), ['DELETE API_KEY']);
  r = await xc(['delete', 'API_KEY']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /API_KEY was not set: nothing to delete/);
  assert.deepEqual(changes.slice(before), ['DELETE API_KEY']);
  // a bare --yes is a usage error, not a way past the printout
  r = await xc(['delete', 'VOUCHER_SEED', '--yes']);
  assert.equal(r.status, 2);
  assert.ok(names.has('VOUCHER_SEED'));
});

test('set VOUCHER_SEED --new-key points the grant the server pays at the new key, and says the approve', async t => {
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
  const dir = path.join(tmp.dir, 'game');
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>g</title>\n');
  await writeFile(path.join(dir, '.gamesfun', 'publish.json'), JSON.stringify({ [g.origin]: { projectId: 'g-9' } }));
  const other = await seedAddress('c4'.repeat(32));
  await writeFile(
    path.join(dir, 'xsolana.json'),
    JSON.stringify({ grants: [{ key: 'clear', id: 1, vouchers: [other], limits: { perPerson: 1 } }] }),
  );
  const names = new Map();
  g.state.handle = (method, url, json, { authed }) => {
    const m = url.match(/^\/api\/kit\/games\/g-9\/secrets(?:\/([A-Z0-9_]+))?$/);
    if (!m) return null;
    if (!authed) return [401, { error: 'Sign in first.' }];
    if (method === 'PUT') names.set(m[1], json.value);
    return [200, { ok: true, game: 'g-9', names: [...names.keys()].sort() }];
  };
  const r = await runAsync(['secret', 'set', 'VOUCHER_SEED', '--new-key'], { env, cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  const address = await seedAddress(names.get('VOUCHER_SEED'));
  const e = JSON.parse(await readFile(path.join(dir, 'xsolana.json'), 'utf8'));
  assert.deepEqual(e.grants[0].vouchers, [other, address]);
  assert.equal(e.keys.issuer, address);
  assert.match(r.stdout, /"clear" now takes vouchers from/);
  assert.match(r.stdout, / loot approve \(signed by the key file/);
  assert.match(r.stdout, /Left as it is: "clear" also takes vouchers from/);
});

test('secret set XSOLANA_RPC_URL waits for backend.json’s origin to be published; VOUCHER_SEED from .dev.vars points the grants', async t => {
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
  const dir = path.join(tmp.dir, 'game');
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>g</title>\n');
  await writeFile(path.join(dir, '.gamesfun', 'publish.json'), JSON.stringify({ [g.origin]: { projectId: 'g-9' } }));
  await writeFile(path.join(dir, 'xsolana.json'), JSON.stringify({ grants: [{ key: 'clear', id: 1, vouchers: [] }] }));
  const names = new Map();
  g.state.handle = (method, url, json, { authed }) => {
    const m = url.match(/^\/api\/kit\/games\/g-9\/secrets(?:\/([A-Z0-9_]+))?$/);
    if (!m) return null;
    if (!authed) return [401, { error: 'Sign in first.' }];
    if (method === 'PUT') names.set(m[1], json.value);
    return [200, { ok: true, game: 'g-9', names: [...names.keys()].sort() }];
  };
  const url = 'https://devnet.rpc.example.com/?api-key=k';
  await writeFile(path.join(dir, 'rpc.txt'), url);
  const xc = args => runAsync(['secret', 'set', ...args], { env, cwd: dir });
  let r = await xc(['XSOLANA_RPC_URL', '--from-file', 'rpc.txt']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Not set yet/);
  assert.equal(names.has('XSOLANA_RPC_URL'), false);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'backend.json'), 'utf8')).origins, [
    'https://devnet.rpc.example.com',
  ]);
  r = await xc(['XSOLANA_RPC_URL', '--from-file', 'rpc.txt']);
  assert.equal(names.get('XSOLANA_RPC_URL'), url, r.stdout + r.stderr);
  await writeFile(path.join(dir, 'bad.txt'), 'https://mainnet.rpc.example.com/');
  r = await xc(['XSOLANA_RPC_URL', '--from-file', 'bad.txt']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /mainnet RPC.*Nothing was set/);

  const seed = 'c5'.repeat(32);
  await writeFile(path.join(dir, '.dev.vars'), `VOUCHER_SEED=${seed}\n`);
  r = await xc(['VOUCHER_SEED', '--from-dev-vars']);
  assert.equal(r.status, 0, r.stderr);
  const address = await seedAddress(seed);
  assert.match(r.stdout, new RegExp(`Its address: ${address}`));
  assert.ok(existsSync(path.join(dir, '.gamesfun', 'vouchers.json')));
  assert.equal(JSON.parse(await readFile(path.join(dir, '.gamesfun', 'vouchers.json'), 'utf8')).liveKey, address);
});

test('an economy file that is not valid JSON refuses a new voucher key before the live one is replaced', async t => {
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
  const dir = path.join(tmp.dir, 'game');
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>g</title>\n');
  await writeFile(path.join(dir, '.gamesfun', 'publish.json'), JSON.stringify({ [g.origin]: { projectId: 'g-9' } }));
  // cut short: the file is there, and it does not parse
  await writeFile(path.join(dir, 'xsolana.json'), '{ "grants": [ { "key": "clear",');
  const puts = [];
  g.state.handle = (method, url, json, { authed }) => {
    if (!/^\/api\/kit\/games\/g-9\/secrets/.test(url)) return null;
    if (!authed) return [401, { error: 'Sign in first.' }];
    if (method === 'PUT') puts.push(url);
    return [200, { ok: true, game: 'g-9', names: ['VOUCHER_SEED'] }];
  };
  for (const args of [
    ['secret', 'set', 'VOUCHER_SEED', '--new-key'],
    ['secret', 'set', 'VOUCHER_SEED', '--new-key', '--yes', '00000000'],
  ]) {
    const r = await runAsync(args, { env, cwd: dir });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /^xcore: xsolana\.json is not valid JSON \(.+\); fix it first$/m);
  }
  assert.deepEqual(puts, [], 'the key the live server has is not replaced');
  assert.ok(!existsSync(path.join(dir, '.gamesfun', 'vouchers.json')), 'and no address is kept');
});
