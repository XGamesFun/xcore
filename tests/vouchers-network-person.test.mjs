// The voucher server on its economy's cluster, and the person it names: a mainnet economy's grant is read (and signed
// for) at its mainnet address, through the relay's mainnet route; a person stays the same person when the voucher key is
// replaced, with nothing to set. Set up as tests/vouchers-state.test.mjs.
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

const GRANT = JSON.parse(await readFile(path.join(ROOT, 'tests', 'fixtures', 'grant-0.29.0.json'), 'utf8'));

/** The voucher server of a game whose grant "clear" is the fixture's, PAY.check paying body.amount for body.runId. */
async function voucherServer(t, { network, limits = {}, player } = {}) {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await writeFile(
    path.join(dir, 'xsolana.json'),
    JSON.stringify({
      ...(network ? { network } : {}),
      grants: [{ key: 'clear', name: 'Clear', id: GRANT.id, limits }],
      live: { project: GRANT.project },
    }),
  );
  await addVouchers(dir);
  const file = path.join(dir, 'server', 'vouchers.js');
  await writeFile(
    file,
    (await readFile(file, 'utf8')).replace(
      /async check\(\) \{\r?\n {4}return \{ why: [^\r\n]*\r?\n {2}\},/,
      "async check({ body }) {\n    return { grant: 'clear', round: body.runId, amount: body.amount };\n  },",
    ),
  );
  const mod = await import(pathToFileURL(file).href);
  const { lootProgram: program } = await import(pathToFileURL(path.join(dir, 'server/gf-loot/client/cluster.js')).href);
  const seed = /^VOUCHER_SEED=([0-9a-f]{64})$/m.exec(await readFile(path.join(dir, '.dev.vars'), 'utf8'))[1];
  const asked = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const { id, params } = JSON.parse(init.body);
    asked.push({ url: String(url), address: params?.[0]?.[0] });
    return Response.json({
      jsonrpc: '2.0',
      id,
      result: {
        context: { slot: 1 },
        value: [{ data: [GRANT.data, 'base64'], owner: program(), lamports: 1, executable: false, space: 318 }],
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
  const stub = new mod.GameVouchers({ storage }, {});
  const env = {
    VOUCHER_SEED: seed,
    GF_GAME_ID: 'g-test',
    GAME_VOUCHERS: { idFromName: n => n, get: () => stub },
    GF: { verifyPlayer: async () => player ?? { ok: true, sub: 'p2', wallet: GRANT.project, x: { id: '42' } } },
  };
  const pay = async (body, more = {}) => {
    const res = await mod.handleVouchers(
      new Request('https://game.example/api/vouchers/pay', {
        method: 'POST',
        headers: { authorization: 'Bearer w' },
        body: JSON.stringify(body),
      }),
      { ...env, ...more },
    );
    return res.json();
  };
  return { asked, pay, program, dir, seed };
}

test('a mainnet economy’s voucher server reads its grant on mainnet, through the relay’s mainnet route', async t => {
  const s = await voucherServer(t, { network: 'mainnet' });
  const r = await s.pay({ runId: 'run-1', amount: 'grant' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(s.program(), 'xgames8C758PyweWB9sDw8evvwsTVwyA2fGRUeAXVPy');
  const { pda } = await import(pathToFileURL(path.join(s.dir, 'server/gf-loot/client/index.js')).href);
  assert.deepEqual(s.asked, [
    { url: 'https://play.xgames.fun/loot/v1/rpc?cluster=mainnet', address: pda.grant(GRANT.project, GRANT.id) },
  ]);
  const devnet = await voucherServer(t);
  await devnet.pay({ runId: 'run-1', amount: 'grant' });
  assert.equal(devnet.asked[0].url, 'https://play.xgames.fun/loot/v1/rpc');
  assert.notEqual(devnet.asked[0].address, s.asked[0].address);
});

test('a person stays the same person when the voucher key is replaced, with nothing to set', async t => {
  const s = await voucherServer(t, { limits: { perPerson: 1 } });
  const a = await s.pay({ runId: 'run-1', amount: 'grant' });
  const b = await s.pay({ runId: 'run-2', amount: 'grant' }, { VOUCHER_SEED: randomBytes(32).toString('hex') });
  assert.ok(a.voucher.personHash);
  assert.notEqual(b.voucher.publicKey, a.voucher.publicKey, 'signed with the new key');
  assert.equal(b.voucher.personHash, a.voucher.personHash);
  // the key kept is the one every server derived from its voucher key: a server that has counted people under it
  // goes on counting them as they were
  const fresh = await voucherServer(t, { limits: { perPerson: 1 } });
  const c = await fresh.pay({ runId: 'run-1', amount: 'grant' }, { VOUCHER_SEED: s.seed });
  assert.equal(c.voucher.personHash, a.voucher.personHash);
});
