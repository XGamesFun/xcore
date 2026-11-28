// Key custody beyond the names publish's scan knows: a seed written in the server's code, a secret of env a route
// answers or a log line prints, and key-shaped bytes in the page under no name (a 64-hex string, one split in two, 32
// or 64 numbers made into bytes, base64 under a seed's name).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { reviewGame } from '../lib/review.mjs';
import { exposedSecrets, keyShapes } from '../lib/review/keys.mjs';
import { ROOT, tempDir } from './helpers.mjs';

const SAMPLES = path.join(ROOT, 'tests', 'fixtures', 'review');
const INSTALLED = { ...process.env, GAMESFUN_SOLANA: '' };
const review = dir => reviewGame(dir, { env: INSTALLED });
const sample = async (tmp, as) => {
  const dir = path.join(tmp.dir, as);
  await cp(path.join(SAMPLES, 'bounded'), dir, { recursive: true });
  return dir;
};
const HEX = 'c3a1f0e29b7d4c58a6e1b2d3f4091827364554637281f0e1d2c3b4a596877869';
const custody = r => r.findings.filter(f => f.id === 'key-custody').map(f => `${f.severity} ${f.place} ${f.route}`);

test("a seed written in the server's code, and a route that answers the live key's seed: high, on the live key", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'c');
  const file = path.join(dir, 'server', 'vouchers.js');
  const own = await readFile(file, 'utf8');
  // the template's own key, with a seed written in for when VOUCHER_SEED is unset
  await writeFile(file, `${own}\nexport const signer = env => voucherKey(env.VOUCHER_SEED ?? '${HEX}');\n`);
  const line = own.split('\n').length + 1;
  let r = await review(dir);
  assert.equal(r.verdict, 'FAIL');
  assert.deepEqual(custody(r), [`high source server/vouchers.js:${line}`]);
  const live = r.custody.find(k => k.key === 'live');
  assert.deepEqual(
    live.places.map(p => p.kind),
    ['holder', 'source'],
  );
  // a debug route that answers the seed (and the RPC address with its key) to anyone
  await writeFile(file, own);
  await writeFile(
    path.join(dir, 'server', 'debug.js'),
    "export async function handleDebug(request, env) {\n  if (new URL(request.url).pathname !== '/api/debug') return null;\n  return Response.json({ seed: env.VOUCHER_SEED, rpc: env.XSOLANA_RPC_URL });\n}\n",
  );
  r = await review(dir);
  assert.deepEqual(custody(r), ['high answered server/debug.js:3', 'high answered server/debug.js:3']);
  assert.ok(r.custody.find(k => k.key === 'live').places.some(p => p.kind === 'answered'));
  assert.ok(r.custody.some(k => k.key === 'env:XSOLANA_RPC_URL'));
  assert.ok(r.tell.some(x => /is answered by a route \(server\/debug\.js:3\)/.test(x.text)));
});

test('a secret of env answered or logged, through a name it was given; one changed by a call on the way is not', () => {
  const names = code => exposedSecrets(code).map(e => `${e.how} ${e.name} ${e.line}`);
  assert.deepEqual(names('const s = env.VOUCHER_SEED;\nreturn new Response(JSON.stringify({ s }));'), [
    'answered VOUCHER_SEED 2',
  ]);
  assert.deepEqual(names("const { API_KEY: k } = env;\nconsole.log('key', k);"), ['logged API_KEY 2']);
  assert.deepEqual(names("return Response.json({ sig: await sign(env.VOUCHER_SEED, 'm') });"), []);
  assert.deepEqual(names('return Response.json({ id: env.GAME_ID, key: env.PUBLIC_KEY, n: env.MIN_SCORE });'), []);
  assert.deepEqual(names("console.log('set?', Boolean(env.VOUCHER_SEED));"), []);
  // a message that names the secret is no secret
  assert.deepEqual(names("return Response.json({ why: 'env.VOUCHER_SEED is not set' });"), []);
  // whether it is set, said and not given out; a fallback gives the value itself
  assert.deepEqual(
    names(
      "return Response.json({ seeded: !!env.VOUCHER_SEED, rpc: env.RPC_URL ? 'set' : 'unset', t: env.API_TOKEN !== undefined, k: typeof env.SECRET_KEY, n: undefined === env.DB_TOKEN });",
    ),
    [],
  );
  assert.deepEqual(names("const s = env.VOUCHER_SEED;\nconsole.log('seed', !s);"), []);
  assert.deepEqual(names("return Response.json({ rpc: env.RPC_URL ?? '', s: env.VOUCHER_SEED || 'none' });"), [
    'answered RPC_URL 1',
    'answered VOUCHER_SEED 1',
  ]);
  assert.deepEqual(names("return Response.json({ rpc: env.RPC_URL ? env.RPC_URL : 'unset' });"), ['answered RPC_URL 1']);
});

test('a health route that says whether its secrets are set is no secret answered: the review still passes', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'h');
  await writeFile(
    path.join(dir, 'server', 'health.js'),
    "export async function handleHealth(request, env) {\n  if (new URL(request.url).pathname !== '/api/health') return null;\n  return Response.json({ ok: true, seeded: !!env.VOUCHER_SEED, rpc: env.RPC_URL ? 'set' : 'unset' });\n}\n",
  );
  const r = await review(dir);
  assert.equal(r.verdict, 'PASS', JSON.stringify(r.findings.filter(f => f.severity === 'high')));
  assert.deepEqual(custody(r), []);
});

test('key-shaped bytes in the page under no name: medium; under a seed’s name, split or base64: high; a hash or an address: nothing', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'k');
  const bytes = Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256).join(', ');
  const cases = [
    [`const k = '${HEX}';`, ['medium page-maybe game.js:1']],
    [`const voucherSeed = '${HEX.slice(0, 32)}' + '${HEX.slice(32)}';`, ['high page game.js:1']],
    [`const bytes = new Uint8Array([${bytes}]);`, ['medium page-maybe game.js:1']],
    [`const signerSeed = '${Buffer.from(HEX, 'hex').toString('base64')}';`, ['high page game.js:1']],
    [`const assetHash = '${HEX}';`, []],
    [`const level = [${bytes}];`, []],
    ["const TREASURY = '24sDWzHodVNPzTuAt5wNqtrHzxNuaxQiCHLaUcDLrkUF';\nconst mapSeed = 42;", []],
  ];
  const own = await readFile(path.join(dir, 'game.js'), 'utf8');
  for (const [code, want] of cases) {
    await writeFile(path.join(dir, 'game.js'), `${code}\n${own}`);
    const r = await review(dir);
    assert.deepEqual(custody(r), want, code);
    assert.equal(r.verdict, want.some(w => w.startsWith('high')) ? 'FAIL' : 'PASS', code);
  }
  assert.deepEqual(
    keyShapes(`x = '${HEX}'`).map(k => k.named),
    [false],
  );
});

test('a seed publish’s scan names is one finding, not two', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'once');
  const own = await readFile(path.join(dir, 'game.js'), 'utf8');
  await writeFile(path.join(dir, 'game.js'), `const VOUCHER_SEED = '${HEX}';\n${own}`);
  assert.deepEqual(custody(await review(dir)), ['high page game.js:1']);
});
