// A second audit of xcore (2026-11-22): a banned player is refused by every server part, rooms never pass a wallet on,
// the voucher key follows the grants PAY.check pays however it names them, add vouchers keeps the owner's own code,
// review counts only storage as state, a linked folder from outside the game is not published, and the server's RPC
// URL waits for the publish that lets it call its origin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { addVouchers, keepSettings, newVoucherKey, seedAddress } from '../lib/add.mjs';
import { buildTree } from '../lib/publish/tree.mjs';
import { paysFromRequest } from '../lib/review.mjs';
import { pointGrantsAt } from '../lib/voucher-key.mjs';
import { fixture, runAsync, signIn, standIn, tempDir } from './helpers.mjs';

register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(s, c, next) { if (s === 'cloudflare:workers') return { url: 'data:text/javascript,' + encodeURIComponent('export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }'), shortCircuit: true }; return next(s, c); }`,
    ),
);
// vouchers.js imports its economy file as JSON with no attribute, as wrangler bundles it
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
globalThis.WebSocketRequestResponsePair ??= class {};

const BANNED = {
  ok: true,
  sub: 'x:9',
  wallet: null,
  x: { id: '9', handle: 'cheat' },
  banned: { kind: 'ban', until: null },
};
const HIDDEN = { ...BANNED, banned: { kind: 'hide', until: null } };
const bearer = { authorization: 'Bearer t' };

test('a player the creator banned is refused by vouchers, the database, gf-db and rooms; one only hidden is not', async t => {
  // vouchers.js as add vouchers writes it, beside its economy and signer
  const g = await voucherGame(t, { grants: [{ key: 'clear', id: 1 }] });
  const { handleVouchers } = await import(pathToFileURL(path.join(g.dir, 'server', 'vouchers.js')).href);
  const pay = await handleVouchers(
    new Request('https://g/api/vouchers/pay', { method: 'POST', headers: bearer, body: '{}' }),
    { GF: { verifyPlayer: async () => BANNED } },
  );
  assert.deepEqual([pay.status, (await pay.json()).code], [403, 'banned']);

  const { routeDatabase } = await import('../lib/client/server/database.js');
  const db = await routeDatabase(
    new Request('https://g/api/db/scores/main', { method: 'PUT', headers: bearer, body: '{"value":{"best":1}}' }),
    { GF: { verifyPlayer: async () => BANNED } },
    () => assert.fail('nothing is stored for a banned player'),
  );
  assert.equal(db.status, 403);

  const { withPlayer } = await import('../lib/client/server/gf-db.js');
  const req = new Request('https://g/api/x', { headers: bearer });
  assert.equal(await withPlayer(req, { GF: { verifyPlayer: async () => BANNED } }), null);
  assert.equal(await withPlayer(req, { GF: { verifyPlayer: async () => HIDDEN } }), 'x:9');

  const { GameRoom } = await import('../lib/client/server/rooms.js');
  const store = new Map();
  const ctx = {
    sockets: [],
    getWebSockets() {
      return this.sockets.filter(s => !s.closed);
    },
    setWebSocketAutoResponse() {},
    storage: { get: async k => store.get(k), put: async (k, v) => store.set(k, v), delete: async k => store.delete(k) },
  };
  const players = { ban: BANNED, ok: { ok: true, sub: 'g:1', wallet: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin' } };
  const r = new GameRoom(ctx, { GF: { verifyPlayer: async t => players[t] ?? { ok: false } } });
  const join = async token => {
    const ws = {
      sent: [],
      closed: null,
      a: null,
      send(m) {
        this.sent.push(JSON.parse(m));
      },
      serializeAttachment(a) {
        this.a = structuredClone(a);
      },
      deserializeAttachment() {
        return this.a;
      },
      close(code, reason) {
        this.closed = { code, reason };
      },
    };
    ctx.sockets.push(ws);
    ws.serializeAttachment({ code: 'K7MXQ2', at: Date.now() });
    await r.webSocketMessage(ws, JSON.stringify({ t: 'hello', token }));
    return ws;
  };
  const banned = await join('ban');
  assert.equal(banned.closed?.code, 4003);
  const host = await join('ok');
  await join(undefined);
  const told = host.sent.find(m => m.t === 'welcome');
  assert.ok(told, JSON.stringify(host.sent));
  assert.ok(!JSON.stringify(host.sent).includes('9xQeWvG8'), 'no wallet goes to the room');
});

const PAY_VIA_VARIABLE = `async check({ body }) {
    const grant = body.boss ? 'boss' : "clear";
    return { grant, round: body.runId, amount: 'grant' };
  },`;

async function voucherGame(t, economy, { check } = {}) {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await writeFile(path.join(dir, 'xsolana.json'), JSON.stringify(economy));
  const r = await addVouchers(dir);
  if (check) {
    const f = path.join(dir, 'server', 'vouchers.js');
    const text = await readFile(f, 'utf8');
    const out = text.replace(/async check\(\) \{\r?\n {4}return \{ why: [^\r\n]*\r?\n {2}\},/, check);
    assert.notEqual(out, text, 'the template check was replaced');
    await writeFile(f, out);
  }
  const read = async () => JSON.parse(await readFile(path.join(dir, 'xsolana.json'), 'utf8'));
  return { dir, test: r.address, read };
}

test('the live key reaches every grant PAY.check names as a string, and says so when none is named', async t => {
  const g = await voucherGame(
    t,
    {
      grants: [
        { key: 'clear', id: 1 },
        { key: 'boss', id: 2 },
        { key: 'other', id: 3 },
      ],
    },
    { check: PAY_VIA_VARIABLE },
  );
  const live = (await newVoucherKey()).address;
  const r = await pointGrantsAt(g.dir, live);
  const e = await g.read();
  assert.deepEqual(
    e.grants.map(x => x.vouchers ?? null),
    [[live], [live], null],
  );
  assert.equal(r.left.length, 0, r.left.join('\n'));

  const none = await voucherGame(t, { grants: [{ key: 'clear', id: 1 }] });
  const r2 = await pointGrantsAt(none.dir, live);
  assert.ok(r2.left.some(l => /No grant in xsolana\.json takes vouchers from/.test(l) && l.includes('"clear"')));
});

test('add vouchers on devnet puts the test key in the grants the server pays, and later the live key made before', async t => {
  const g = await voucherGame(t, { grants: [{ key: 'clear', id: 1 }] }, { check: PAY_VIA_VARIABLE });
  const live = (await newVoucherKey()).address;
  await pointGrantsAt(g.dir, live);
  // a grant added after the live key was made: add vouchers points it at both, no new key
  const e = await g.read();
  e.grants.push({ key: 'boss', id: 2 });
  await writeFile(path.join(g.dir, 'xsolana.json'), JSON.stringify(e));
  const r = await addVouchers(g.dir);
  const after = await g.read();
  assert.deepEqual(after.grants[1].vouchers, [live, g.test]);
  assert.ok(after.grants[0].vouchers.includes(g.test));
  assert.ok(r.written.some(l => /pointed the live voucher key/.test(l)));

  // mainnet: never the test key
  const m = await voucherGame(
    t,
    { network: 'mainnet', grants: [{ key: 'clear', id: 1 }] },
    { check: PAY_VIA_VARIABLE },
  );
  await addVouchers(m.dir);
  assert.equal((await m.read()).grants[0].vouchers, undefined);
});

test('add vouchers run again keeps what the owner wrote beside PAY, and a setting’s whole default', async t => {
  const g = await voucherGame(t, { grants: [{ key: 'clear', id: 1 }] });
  const f = path.join(g.dir, 'server', 'vouchers.js');
  await writeFile(
    f,
    (await readFile(f, 'utf8')) +
      '\n// my own scoring\nfunction scoreOf(body) {\n  return Number(body.score ?? 0);\n}\nconst BONUS = 2;\n',
  );
  for (let i = 0; i < 2; i++) await addVouchers(g.dir);
  const out = await readFile(f, 'utf8');
  assert.equal(out.match(/function scoreOf/g)?.length, 1);
  assert.equal(out.match(/const BONUS = 2/g)?.length, 1);

  const before = "export const RPC = {\n  scanPrograms: ['mine'],\n};\n";
  const now = "export const RPC = {\n  scanPrograms: ['9cwq'],\n  loot: ['xgamesVs', 'xgames8C'],\n};\n";
  assert.match(keepSettings(before, now, ['RPC']), /loot: \['xgamesVs', 'xgames8C'\]/);
});

test('review: a setting read from env is no state; storage through env is', () => {
  const check = body => paysFromRequest({ body });
  assert.equal(check("return body.score > Number(env.MIN_SCORE) ? { grant: 'clear' } : { why: 'low' };"), true);
  assert.equal(check("const r = await env.DB.prepare('x').first();\n return { grant: 'clear' };"), false);
  assert.equal(check("return seen(env) && { grant: 'clear' };"), false);
});

test('a published folder linked from outside the game is refused; one linked inside it is published', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const outside = path.join(tmp.dir, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'index.html'), '<!doctype html>');
  const game = path.join(tmp.dir, 'game');
  await mkdir(path.join(game, 'build'), { recursive: true });
  await writeFile(path.join(game, 'build', 'index.html'), '<!doctype html>');
  await writeFile(path.join(game, 'gamesfun.json'), JSON.stringify({ page: { out: 'dist' } }));
  await symlink(outside, path.join(game, 'dist'));
  const out = await buildTree(game);
  assert.ok(out.refused.some(r => r.path === 'dist' && /outside the game/.test(r.why)));
  assert.ok(!out.tree.files.some(f => f.path === 'index.html'));
  await writeFile(path.join(game, 'gamesfun.json'), JSON.stringify({ page: { out: 'inside' } }));
  await symlink(path.join(game, 'build'), path.join(game, 'inside'));
  const ok = await buildTree(game);
  assert.ok(
    ok.tree.files.some(f => f.path === 'index.html'),
    JSON.stringify(ok.refused),
  );
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
