// A room's seats while a hello waits on games.fun's sign-in check (lib/client/server/rooms.js): the room is read again
// after it, so two players hosting one code at once never both get seat 1, and a room never passes ROOM.maxPlayers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(s, c, next) { if (s === 'cloudflare:workers') return { url: 'data:text/javascript,' + encodeURIComponent('export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }'), shortCircuit: true }; return next(s, c); }`,
    ),
);
globalThis.WebSocketRequestResponsePair ??= class {};
const { GameRoom, ROOM } = await import('../lib/client/server/rooms.js');

class Socket {
  constructor() {
    this.sent = [];
    this.attachment = { code: 'K7MXQ2', at: Date.now() };
    this.closed = null;
  }
  send(m) {
    this.sent.push(JSON.parse(m));
  }
  serializeAttachment(a) {
    this.attachment = structuredClone(a);
  }
  deserializeAttachment() {
    return this.attachment;
  }
  close(code, reason) {
    this.closed = { code, reason };
  }
}

/** A room whose sign-in check answers only when `release()` is called (games.fun's, over the network). */
function slowRoom() {
  const store = new Map();
  const waiting = [];
  const ctx = {
    sockets: [],
    getWebSockets() {
      return this.sockets.filter(s => !s.closed);
    },
    setWebSocketAutoResponse() {},
    storage: { get: async k => store.get(k), put: async (k, v) => store.set(k, v), delete: async k => store.delete(k) },
  };
  const r = new GameRoom(ctx, {
    GF: {
      verifyPlayer: () => new Promise(resolve => waiting.push(() => resolve({ ok: true, sub: 'x:1', x: null }))),
    },
  });
  const hello = m => {
    const ws = new Socket();
    ctx.sockets.push(ws);
    return { ws, done: r.webSocketMessage(ws, JSON.stringify({ t: 'hello', token: 'tok', ...m })) };
  };
  const release = async () => {
    await new Promise(r => setTimeout(r, 0));
    for (const f of waiting.splice(0)) f();
  };
  return { hello, release };
}

test('two players hosting one code at once: one is the host, the other is told the room is taken', async () => {
  const { hello, release } = slowRoom();
  const a = hello({ host: true }),
    b = hello({ host: true });
  await release();
  await Promise.all([a.done, b.done]);
  const welcomed = [a, b].filter(x => x.ws.sent.some(m => m.t === 'welcome'));
  assert.equal(welcomed.length, 1, 'one host');
  assert.equal(welcomed[0].ws.sent.find(m => m.t === 'welcome').id, 1);
  assert.equal([a, b].find(x => x !== welcomed[0]).ws.closed?.code, 4009);
});

test('players joining at once never pass maxPlayers', async t => {
  const max = ROOM.maxPlayers;
  ROOM.maxPlayers = 2;
  t.after(() => (ROOM.maxPlayers = max));
  const { hello, release } = slowRoom();
  const all = [hello({}), hello({}), hello({})];
  await release();
  await Promise.all(all.map(x => x.done));
  const seated = all.filter(x => x.ws.attachment?.id);
  assert.equal(seated.length, 2, 'two seats');
  assert.equal(all.filter(x => x.ws.closed?.code === 4003).length, 1, 'the third: the room is full');
  assert.deepEqual(
    seated.map(x => x.ws.attachment.id === 1).sort(),
    [false, true],
    'one host, id 1; the other an id of its own',
  );
});
