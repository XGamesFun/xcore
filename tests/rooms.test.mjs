// The multiplayer rooms xcore puts in server/ (lib/client/server/rooms.js), run here against stand-ins for a Durable
// Object's hibernatable WebSockets: who is host, who a message reaches, bytes' header, lock, full, sign-in, the rate,
// and the host leaving. (In workerd itself, and under Godot's high-level multiplayer, it is run outside this suite.)
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
const { GameRoom, ROOM, reach, roomCode } = await import('../lib/client/server/rooms.js');

class Socket {
  constructor() {
    this.sent = [];
    this.attachment = null;
    this.closed = null;
  }
  send(m) {
    this.sent.push(typeof m === 'string' ? JSON.parse(m) : new Uint8Array(m));
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
  last(t) {
    return this.sent.filter(m => m.t === t).at(-1);
  }
}

function room(env = {}) {
  const store = new Map();
  const ctx = {
    sockets: [],
    getWebSockets() {
      return this.sockets.filter(s => !s.closed);
    },
    setWebSocketAutoResponse() {},
    storage: { get: async k => store.get(k), put: async (k, v) => store.set(k, v), delete: async k => store.delete(k) },
  };
  const r = new GameRoom(ctx, {
    GF: { verifyPlayer: async t => (t === 'good' ? { ok: true, sub: 'x:42', x: { handle: 'fan' } } : { ok: false }) },
    ...env,
  });
  const join = async (hello = {}) => {
    const ws = new Socket();
    ctx.sockets.push(ws);
    ws.serializeAttachment({ code: 'K7MXQ2', at: Date.now() });
    await r.webSocketMessage(ws, JSON.stringify({ t: 'hello', ...hello }));
    return ws;
  };
  const leave = async ws => {
    ws.closed = { code: 1000 };
    ctx.sockets = ctx.sockets.filter(s => s !== ws);
    await r.webSocketClose(ws);
  };
  return { r, join, leave };
}

test('the first in is the host (id 1); the next get ids of their own and the room says who is there', async () => {
  const { join } = room();
  const host = await join({ name: 'Ada' });
  assert.deepEqual(host.last('welcome'), { t: 'welcome', id: 1, host: 1, code: 'K7MXQ2', peers: [] });
  const b = await join({ name: 'Bo<b>' });
  const w = b.last('welcome');
  assert.ok(w.id > 1 && w.id < 2 ** 31, String(w.id));
  assert.equal(w.host, 1);
  assert.deepEqual(w.peers, [{ id: 1, name: 'Ada', player: null }]);
  assert.deepEqual(
    host.last('join'),
    { t: 'join', peer: { id: w.id, name: 'Bob', player: null } },
    'no angle brackets',
  );
  const signed = await join({ token: 'good' });
  assert.deepEqual(signed.last('welcome').peers.length, 2);
  assert.deepEqual(host.last('join').peer.player, { id: 'x:42', x: 'fan', wallet: null });
  assert.equal(host.last('join').peer.name, 'fan', "a signed-in player's X handle is their name");
});

test('who a message reaches: one player, everyone else, everyone but one; bytes carry their sender in place of the target', async () => {
  const { r, join } = room();
  const a = await join(),
    b = await join(),
    c = await join();
  const [ib, ic] = [b.last('welcome').id, c.last('welcome').id];
  await r.webSocketMessage(a, JSON.stringify({ t: 'msg', to: 0, d: { hi: 1 } }));
  assert.deepEqual(
    [b.last('msg'), c.last('msg')],
    [
      { t: 'msg', from: 1, d: { hi: 1 } },
      { t: 'msg', from: 1, d: { hi: 1 } },
    ],
  );
  assert.equal(a.last('msg'), undefined, 'never back to the sender');
  await r.webSocketMessage(b, JSON.stringify({ t: 'msg', to: 1, d: 'to the host' }));
  assert.equal(a.last('msg').d, 'to the host');
  assert.deepEqual(c.last('msg').d, { hi: 1 }, 'a message to the host reaches no one else');
  await r.webSocketMessage(a, JSON.stringify({ t: 'msg', to: -ib, d: 'not to b' }));
  assert.equal(c.last('msg').d, 'not to b');
  assert.notEqual(b.last('msg').d, 'not to b');
  const bytes = new Uint8Array(4 + 3);
  new DataView(bytes.buffer).setInt32(0, ic, true);
  bytes.set([7, 8, 9], 4);
  await r.webSocketMessage(b, bytes.buffer);
  const got = c.sent.filter(m => m instanceof Uint8Array).at(-1);
  assert.equal(new DataView(got.buffer).getInt32(0, true), ib, 'the sender, in place of the target');
  assert.deepEqual([...got.slice(4)], [7, 8, 9]);
  assert.equal(a.sent.filter(m => m instanceof Uint8Array).length, 0);
  assert.deepEqual(
    reach([{ seat: { id: 1 } }, { seat: { id: 2 } }, { seat: { id: 3 } }], 1, -2).map(p => p.seat.id),
    [3],
  );
});

test('lock, full, sign-in only, the rate: each refused in words', async () => {
  const { r, join } = room();
  const host = await join(),
    b = await join();
  await r.webSocketMessage(b, JSON.stringify({ t: 'lock' }));
  assert.equal(b.last('error').code, 'not-host');
  await r.webSocketMessage(host, JSON.stringify({ t: 'lock' }));
  assert.deepEqual((await join()).closed, { code: 4003, reason: 'The room is closed.' });
  await r.webSocketMessage(host, JSON.stringify({ t: 'lock', on: false }));
  assert.ok((await join()).last('welcome'));
  const saved = { ...ROOM };
  try {
    ROOM.maxPlayers = 3;
    assert.deepEqual((await join()).closed, { code: 4003, reason: 'The room is full.' });
    ROOM.maxPlayers = 16;
    ROOM.signedIn = true;
    assert.deepEqual((await join()).closed, { code: 4001, reason: 'Sign in to join this room.' });
    assert.ok((await join({ token: 'good' })).last('welcome'));
    ROOM.signedIn = false;
    const chatty = await join();
    ROOM.perSecond = 3;
    for (let i = 0; i < 6; i++) await r.webSocketMessage(chatty, JSON.stringify({ t: 'msg', to: 1, d: i }));
    assert.equal(host.sent.filter(m => m.t === 'msg').length, 3);
    assert.equal(chatty.sent.filter(m => m.code === 'rate').length, 1, 'told once');
    ROOM.messageBytes = 10;
    await r.webSocketMessage(b, JSON.stringify({ t: 'msg', to: 1, d: 'x'.repeat(200) }));
    assert.equal(b.last('error').code, 'too-big');
  } finally {
    Object.assign(ROOM, saved);
  }
  const quiet = await join();
  quiet.sent = [];
  const stranger = new Socket();
  stranger.serializeAttachment({ code: 'K7MXQ2' });
  await r.webSocketMessage(stranger, JSON.stringify({ t: 'msg', d: 1 }));
  assert.deepEqual(stranger.closed, { code: 4000, reason: 'Say hello first.' });
});

test('the host leaves: everyone is told, and the player who joined next is the host', async () => {
  const { join, leave } = room();
  const host = await join(),
    b = await join(),
    c = await join();
  const ib = b.last('welcome').id;
  await leave(host);
  assert.deepEqual(b.sent.filter(m => m.t === 'leave' || m.t === 'host').slice(-2), [
    { t: 'leave', id: 1 },
    { t: 'host', id: ib },
  ]);
  assert.equal(c.last('host').id, ib);
  await leave(c);
  assert.equal(b.sent.filter(m => m.t === 'host').length, 1, 'a player who is not the host leaving moves nothing');
  await leave(b);
  const again = await join();
  assert.equal(again.last('welcome').id, 1, 'an empty room starts again at 1');
  assert.equal(roomCode(' k7mxq2 '), 'K7MXQ2');
  assert.equal(roomCode('K7-MX'), null);
});

test('a batch (a frame of packets as one message): each player gets its own share, in order, from its sender', async () => {
  const { r, join } = room();
  const a = await join(),
    b = await join(),
    c = await join();
  const [ib, ic] = [b.last('welcome').id, c.last('welcome').id];
  // [BATCH][to, length, bytes]…: one to b, one to everyone, one to everyone but b
  const records = [
    [ib, [1]],
    [0, [2, 2]],
    [-ib, [3]],
  ];
  const bytes = new Uint8Array(4 + records.reduce((n, [, d]) => n + 8 + d.length, 0));
  const dv = new DataView(bytes.buffer);
  dv.setInt32(0, -2147483648, true);
  let at = 4;
  for (const [to, d] of records) {
    dv.setInt32(at, to, true);
    dv.setUint32(at + 4, d.length, true);
    bytes.set(d, at + 8);
    at += 8 + d.length;
  }
  await r.webSocketMessage(a, bytes.buffer);
  const share = ws => {
    const got = ws.sent.filter(m => m instanceof Uint8Array);
    assert.equal(got.length, 1, 'one message a player');
    const v = new DataView(got[0].buffer);
    assert.equal(v.getInt32(0, true), -2147483648);
    const out = [];
    for (let i = 4; i < got[0].length;) {
      const len = v.getUint32(i + 4, true);
      out.push([v.getInt32(i, true), [...got[0].slice(i + 8, i + 8 + len)]]);
      i += 8 + len;
    }
    return out;
  };
  assert.deepEqual(share(b), [
    [1, [1]],
    [1, [2, 2]],
  ]);
  assert.deepEqual(share(c), [
    [1, [2, 2]],
    [1, [3]],
  ]);
  assert.equal(a.sent.filter(m => m instanceof Uint8Array).length, 0);
  await r.webSocketMessage(a, bytes.buffer.slice(0, bytes.length - 1));
  assert.equal(a.last('error').code, 'bad', 'a batch cut short is refused');

  await r.webSocketMessage(
    b,
    JSON.stringify({
      t: 'msgs',
      m: [
        { to: 1, d: 'x' },
        { to: 0, d: { y: 1 } },
      ],
    }),
  );
  assert.deepEqual(a.last('msgs'), { t: 'msgs', from: ib, d: ['x', { y: 1 }] });
  assert.deepEqual(c.last('msgs'), { t: 'msgs', from: ib, d: [{ y: 1 }] });
  assert.equal(ic > 1, true);
});

test('a Host button opens a room of its own, a Join button joins one that is there', async () => {
  const { join } = room();
  assert.deepEqual((await join({ host: false })).closed, { code: 4004, reason: 'No one is in this room.' });
  const host = await join({ host: true });
  assert.equal(host.last('welcome').id, 1);
  assert.deepEqual((await join({ host: true })).closed, {
    code: 4009,
    reason: 'Someone is in this room already: choose another code.',
  });
  assert.ok((await join({ host: false })).last('welcome').id > 1);
});
