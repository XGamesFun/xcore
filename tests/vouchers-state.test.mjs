// The voucher server's round lifecycle (lib/client/server/vouchers.js, as `xcore add vouchers` writes it): a round
// reserved whose signing failed, a voucher signed with an earlier key, and PAY.paid once a round, whatever the number of
// signatures. Set up as tests/add.test.mjs's voucher server test, with a Durable Object stand-in that takes one call at
// a time (as a real object's input gate does while it waits on its own storage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { addVouchers } from '../lib/add.mjs';
import { fixture, ROOT, tempDir } from './helpers.mjs';

register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(s, c, next) { if (s === 'cloudflare:workers') return { url: 'data:text/javascript,' + encodeURIComponent('export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }'), shortCircuit: true }; return next(s, c); }`,
    ),
);
register(
  'data:text/javascript,' +
    encodeURIComponent(
      `import { readFileSync } from 'node:fs'; import { fileURLToPath } from 'node:url';
       export async function load(u, c, next) {
         if (u.startsWith('file:') && u.endsWith('.json') && !c.importAttributes?.type)
           return { format: 'module', source: 'export default ' + readFileSync(fileURLToPath(u), 'utf8'), shortCircuit: true };
         return next(u, c);
       }`,
    ),
);

const LOOT = '9cwqM1TXytPnFZsLfmUyv2dg4uW6Ch9C6UJVPns7NFQ';
const GRANT = JSON.parse(await readFile(path.join(ROOT, 'tests', 'fixtures', 'grant-0.24.0.json'), 'utf8'));

/** The voucher server of a game whose grant "clear" is the fixture's, PAY.check paying body.amount for body.runId. */
async function voucherServer(t) {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await writeFile(
    path.join(dir, 'xsolana.json'),
    JSON.stringify({ grants: [{ key: 'clear', name: 'Clear', id: GRANT.id }], live: { project: GRANT.project } }),
  );
  const r = await addVouchers(dir);
  const file = path.join(dir, 'server', 'vouchers.js');
  await writeFile(
    file,
    (await readFile(file, 'utf8')).replace(
      /async check\(\) \{\r?\n {4}return \{ why: [^\r\n]*\r?\n {2}\},/,
      "async check({ body }) {\n    return { grant: 'clear', round: body.runId, amount: body.amount };\n  },\n  paid({ pays }) {\n    if (globalThis.__failPaid) { globalThis.__failPaid = false; throw new Error('the cap store is down'); }\n    globalThis.__paid.push(String(pays.round));\n  },",
    ),
  );
  globalThis.__paid = [];
  const mod = await import(pathToFileURL(file).href);
  const seed = /^VOUCHER_SEED=([0-9a-f]{64})$/m.exec(await readFile(path.join(dir, '.dev.vars'), 'utf8'))[1];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const { id } = JSON.parse(init.body);
    return Response.json({
      jsonrpc: '2.0',
      id,
      result: {
        context: { slot: 1 },
        value: [{ data: [GRANT.data, 'base64'], owner: LOOT, lamports: 1, executable: false, space: 304 }],
      },
    });
  };
  t.after(() => (globalThis.fetch = realFetch));
  const kept = new Map();
  const storage = {
    get: async k => (kept.has(k) ? structuredClone(kept.get(k)) : undefined),
    put: async (k, v) => {
      if (typeof k === 'object') for (const [kk, vv] of Object.entries(k)) kept.set(kk, structuredClone(vv));
      else kept.set(k, structuredClone(v));
    },
    delete: async k => [].concat(k).forEach(x => kept.delete(x)),
    list: async ({ prefix = '' } = {}) => new Map([...kept].filter(([k]) => k.startsWith(prefix))),
  };
  const object = new mod.GameVouchers({ storage }, {});
  // one call at a time, as a Durable Object's input gate holds others while it waits on its own storage
  let gate = Promise.resolve();
  const stub = new Proxy(object, {
    get(o, k) {
      const f = o[k];
      if (typeof f !== 'function') return f;
      return (...a) => {
        const p = gate.then(() => f.apply(o, a));
        gate = p.catch(() => {});
        return p;
      };
    },
  });
  const W1 = r.address,
    W2 = GRANT.project;
  const env = {
    VOUCHER_SEED: seed,
    XSOLANA_RPC_URL: 'https://devnet.rpc.example.com/',
    GF_GAME_ID: 'g-test',
    GAME_VOUCHERS: { idFromName: n => n, get: () => stub },
    GF: { verifyPlayer: async () => ({ ok: true, sub: 'p2', wallet: W2, x: null }) },
  };
  const pay = async body => {
    const res = await mod.handleVouchers(
      new Request('https://game.example/api/vouchers/pay', {
        method: 'POST',
        headers: { authorization: 'Bearer w' },
        body: JSON.stringify(body),
      }),
      env,
    );
    return res.json();
  };
  return { ...mod, env, kept, pay, W1, W2, seed };
}

test('a round reserved whose signing failed: its own wallet may sign it again, at a corrected amount; no other wallet', async t => {
  const { voucherFor, env, W1, W2 } = await voucherServer(t);
  // more than a u64: the signing throws, after the round was reserved for W2
  await assert.rejects(voucherFor(env, { grant: 'clear', wallet: W2, round: 'r1', amount: 2n ** 64n }));
  const other = await voucherFor(env, { grant: 'clear', wallet: W1, round: 'r1', amount: 5 });
  assert.equal(other.code, 'round-used', 'another wallet is still refused');
  const fixed = await voucherFor(env, { grant: 'clear', wallet: W2, round: 'r1', amount: 5 });
  assert.equal(fixed.ok, true, JSON.stringify(fixed));
  assert.equal(fixed.voucher.amount, '5');
  // signed now: the amount is fixed from here on
  assert.equal((await voucherFor(env, { grant: 'clear', wallet: W2, round: 'r1', amount: 6 })).code, 'round-used');
  const again = await voucherFor(env, { grant: 'clear', wallet: W2, round: 'r1', amount: 5 });
  assert.deepEqual([again.again, again.voucher.signature], [true, fixed.voucher.signature]);
});

test('a voucher signed with an earlier voucher key is signed again with the current one', async t => {
  const { voucherFor, env, W2 } = await voucherServer(t);
  const first = await voucherFor(env, { grant: 'clear', wallet: W2, round: 'k1', amount: 5 });
  assert.equal(first.ok, true);
  const rotated = { ...env, VOUCHER_SEED: randomBytes(32).toString('hex') };
  const next = await voucherFor(rotated, { grant: 'clear', wallet: W2, round: 'k1', amount: 5 });
  assert.equal(next.ok, true, JSON.stringify(next));
  assert.notEqual(next.voucher.publicKey, first.voucher.publicKey, 'signed with the key the grant names now');
  const again = await voucherFor(rotated, { grant: 'clear', wallet: W2, round: 'k1', amount: 5 });
  assert.deepEqual([again.again, again.voucher.signature], [true, next.voucher.signature]);
  assert.equal(
    (await voucherFor(rotated, { grant: 'clear', wallet: W2, round: 'k1', amount: 6 })).code,
    'round-used',
    'still one amount a round',
  );
});

test('PAY.paid runs once a round: not again for two asks at once, nor for a renewal; again after it threw', async t => {
  const { pay, VOUCHERS, kept } = await voucherServer(t);
  const both = await Promise.all([pay({ runId: 'c1', amount: 5 }), pay({ runId: 'c1', amount: 5 })]);
  assert.deepEqual(
    both.map(b => b.ok),
    [true, true],
  );
  assert.deepEqual(globalThis.__paid, ['c1'], 'two asks at once: counted once');
  const renewWithin = VOUCHERS.renewWithin;
  VOUCHERS.renewWithin = VOUCHERS.seconds + 10; // every voucher near its expiry: each ask signs anew
  t.after(() => (VOUCHERS.renewWithin = renewWithin));
  const renewed = await pay({ runId: 'c1', amount: 5 });
  assert.equal(renewed.ok, true);
  assert.equal(renewed.again, undefined, 'signed anew');
  assert.deepEqual(globalThis.__paid, ['c1'], 'a renewal: not counted again');
  VOUCHERS.renewWithin = renewWithin;

  globalThis.__failPaid = true;
  await assert.rejects(pay({ runId: 'c2', amount: 5 }), /the cap store is down/);
  assert.deepEqual(globalThis.__paid, ['c1']);
  const later = await pay({ runId: 'c2', amount: 5 });
  assert.deepEqual([later.ok, later.again], [true, true], 'the voucher it had');
  assert.deepEqual(globalThis.__paid, ['c1', 'c2'], 'paid ran on the later ask, the one before having thrown');
  await pay({ runId: 'c2', amount: 5 });
  assert.deepEqual(globalThis.__paid, ['c1', 'c2'], 'and only once');

  // a round signed before rounds were counted (no `counted`): its paid ran when it was signed, so it is not run again
  const key = [...kept.keys()][0]; // `${grant}:${round}`: the only records here are rounds
  const legacy = structuredClone(kept.get(key));
  delete legacy.counted;
  const legacyKey = key.replace(/:.*/, ':' + 'ab'.repeat(16));
  kept.set(legacyKey, { ...legacy, voucher: { ...legacy.voucher, round: 'ab'.repeat(16) } });
  const old = await pay({ runId: 'ab'.repeat(16), amount: 5 });
  assert.equal(old.ok, true, JSON.stringify(old));
  assert.deepEqual(globalThis.__paid, ['c1', 'c2'], 'a round signed before: not counted again');
});
