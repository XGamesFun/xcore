// A player the creator banned is refused by every part of a game's server that add writes (vouchers, the older
// database, gf-db and rooms), and one the creator only hid is not; a room never passes a player's wallet to the others.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { addVouchers } from '../lib/add.mjs';
import { fixture, tempDir } from './helpers.mjs';

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

/** A game with the economy `economy` and add vouchers' server. */
async function voucherGame(t, economy) {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await writeFile(path.join(dir, 'xsolana.json'), JSON.stringify(economy));
  await addVouchers(dir);
  return { dir };
}

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
