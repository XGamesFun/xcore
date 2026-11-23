// A room's seats while a hello waits on xgames.fun's sign-in check (lib/client/server/rooms.js): the room and the socket
// are read again after it, so two players hosting one code at once never both get seat 1, a room never passes
// ROOM.maxPlayers, one socket never takes two seats, and a socket that left takes none.
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

/** A room whose sign-in check answers only when `release()` is called (xgames.fun's, over the network). */
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
  /** A hello with a token, from a new socket or from `ws` again. */
  const hello = (m, ws = new Socket()) => {
    if (!ctx.sockets.includes(ws)) ctx.sockets.push(ws);
    return { ws, done: r.webSocketMessage(ws, JSON.stringify({ t: 'hello', token: 'tok', ...m })) };
  };
  const release = async () => {
    await new Promise(r => setTimeout(r, 0));
    for (const f of waiting.splice(0)) f();
  };
  /** The socket closes: gone from the room's sockets, and the room is told. */
  const leave = async ws => {
    ws.closed = { code: 1000 };
    ctx.sockets = ctx.sockets.filter(s => s !== ws);
    await r.webSocketClose(ws);
  };
  return { hello, release, leave };
}
/** A player already in the room (the host), to see what the room tells the others. */
async function seatedHost({ hello, release }) {
  const host = hello({});
  await release();
  await host.done;
  return host.ws;
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

test('one socket that says hello twice takes one seat: the room hears of one join, and of that one leaving', async () => {
  const room = slowRoom();
  const host = await seatedHost(room);
  const first = room.hello({ name: 'Bo' });
  const second = room.hello({ name: 'Bo' }, first.ws);
  await room.release();
  await Promise.all([first.done, second.done]);
  const joins = host.sent.filter(m => m.t === 'join').map(m => m.peer.id);
  assert.equal(joins.length, 1, 'one join');
  assert.equal(first.ws.sent.filter(m => m.t === 'welcome').length, 1, 'one welcome');
  assert.equal(first.ws.attachment.id, joins[0], 'the seat the room was told of');
  await room.leave(first.ws);
  assert.deepEqual(
    host.sent.filter(m => m.t === 'leave').map(m => m.id),
    joins,
    'everyone who joined has left',
  );
});

test('a socket that leaves while its hello waits takes no seat: the room hears of no join', async () => {
  const room = slowRoom();
  const host = await seatedHost(room);
  const gone = room.hello({ name: 'Bo' });
  await room.leave(gone.ws);
  await room.release();
  await gone.done;
  assert.deepEqual(
    host.sent.filter(m => m.t === 'join' || m.t === 'leave'),
    [],
    'nobody joined',
  );
  assert.ok(!gone.ws.attachment.id, 'no seat');
  assert.equal(gone.ws.sent.length, 0, 'nothing is sent to a socket that left');
});
