// gamesfun.js against what it talks to, with the file loaded in a fake window (node:vm): the names it takes (a save
// key, a board name, a collection, a document's id) are the ones xgames.fun and the game's database take, so a name
// that works on this machine works once published; the frames it sends a room are ones server/rooms.js takes, so a
// frame's messages all arrive; and a listener of the game's own that throws is said in the console, and the client
// goes on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { SAVE_KEY } from '../lib/server/contract.mjs';
import { ROOT } from './helpers.mjs';

register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(s, c, next) { if (s === 'cloudflare:workers') return { url: 'data:text/javascript,' + encodeURIComponent('export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }'), shortCircuit: true }; return next(s, c); }`,
    ),
);
globalThis.WebSocketRequestResponsePair ??= class {};
const { GameRoom, ROOM } = await import('../lib/client/server/rooms.js');

const CLIENT = readFileSync(path.join(ROOT, 'lib', 'client', 'gamesfun.js'), 'utf8');
const DATABASE = readFileSync(path.join(ROOT, 'lib', 'client', 'server', 'database.js'), 'utf8');
/** What came out of the fake window, as plain data of this realm. */
const plain = v => JSON.parse(JSON.stringify(v));
const moment = () => new Promise(r => setTimeout(r, 30));

/** A storage in the shape of the browser's. */
function storage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}

/**
 * The client in a fake window at `href`: this machine (localhost, where this browser's storage stands in) or a
 * published game's own link. Every request is kept and answered 404; what the client says to the console is kept; a
 * room's socket is the page's end of `socket` (a class), when one is given.
 * → {gf, fetched: [the addresses asked], said: [[level, ...what]]}
 */
function load({ href = 'http://localhost:5173/', socket } = {}) {
  const fetched = [],
    said = [];
  const u = new URL(href);
  const win = {
    location: {
      host: u.host,
      hostname: u.hostname,
      pathname: u.pathname,
      protocol: u.protocol,
      origin: u.origin,
      href: u.href,
      search: u.search,
      hash: u.hash,
    },
    URL,
    URLSearchParams,
    TextEncoder,
    Uint8Array,
    DataView,
    crypto: globalThis.crypto,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
    console: {
      log: (...a) => said.push(['log', ...a]),
      warn: (...a) => said.push(['warn', ...a]),
      error: (...a) => said.push(['error', ...a]),
    },
    GAMESFUN_LIVE_BANNER: false,
    localStorage: storage(),
    sessionStorage: storage(),
    history: { state: null, replaceState() {} },
    fetch: url => {
      fetched.push(String(url));
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false, why: 'not here' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
    addEventListener() {},
  };
  if (socket) win.WebSocket = socket;
  const ctx = vm.createContext(win);
  win.parent = vm.runInContext('this', ctx);
  vm.runInContext(CLIENT, ctx, { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
  return { gf: win.GamesFun, fetched, said };
}

// ---- names ----

/** `var NAME = /…/;` (or const) in a file's text, as a RegExp. */
function ruleIn(text, name) {
  const m = new RegExp(`^\\s*(?:var|const) ${name} = /(.+)/;$`, 'm').exec(text);
  assert.ok(m, `${name} is written as a pattern`);
  return new RegExp(m[1]);
}

test("the client's rule for a save key and a board name is the platform's, and for a collection and an id the database's", () => {
  assert.equal(ruleIn(CLIENT, 'SAVE_KEY').source, SAVE_KEY.source, 'gamesfun.js SAVE_KEY is contract.mjs SAVE_KEY');
  assert.equal(ruleIn(CLIENT, 'SEG').source, ruleIn(DATABASE, 'NAME').source, 'gamesfun.js SEG is database.js NAME');
});

test('on this machine a save key and a board name are held to what xgames.fun takes: 32 characters, a dot among them', async () => {
  const { gf } = load();
  await gf.signIn();
  const refused = r => r.data === null && r.status === 0 && /^not a (save key|board name) \(1 to 32 /.test(r.error);
  for (const key of ['main', 'main.v2', 'a'.repeat(32), '2026-11-23_run.1']) {
    assert.deepEqual(
      plain(await gf.saves.put(key, { level: 3 })),
      { data: { ok: true }, error: null, status: 200 },
      key,
    );
    assert.deepEqual(plain((await gf.saves.get(key)).data), { level: 3 }, key);
    assert.equal((await gf.scores.submit(key, 7)).error, null, key);
    assert.equal((await gf.scores.top(key)).data[0].score, 7, key);
    assert.equal((await gf.scores.mine(key)).data.score, 7, key);
    assert.equal((await gf.saves.delete(key)).error, null, key);
  }
  // 33 characters, a space, a slash, nothing; and the two names of dots alone, which no address can carry
  for (const key of ['a'.repeat(33), 'a'.repeat(64), 'my save', 'a/b', '', '.', '..']) {
    for (const answer of [
      await gf.saves.put(key, 1),
      await gf.saves.get(key),
      await gf.saves.delete(key),
      await gf.scores.submit(key, 1),
      await gf.scores.top(key),
      await gf.scores.mine(key),
    ])
      assert.ok(refused(answer), `${JSON.stringify(key)}: ${JSON.stringify(answer)}`);
  }
  assert.deepEqual(plain((await gf.saves.list()).data), [], 'nothing refused was kept');
});

test('a collection and a document id keep the database’s own rule: 64 characters, no dot', async () => {
  const { gf } = load();
  await gf.signIn();
  const long = 'a'.repeat(64);
  assert.equal((await gf.db.put(long, long, { n: 1 })).error, null);
  assert.deepEqual(plain((await gf.db.get(long, long)).data.value), { n: 1 });
  for (const [c, id] of [
    ['a'.repeat(65), 'main'],
    ['levels', 'a'.repeat(65)],
    ['levels', 'main.v2'],
    ['my.levels', 'main'],
  ]) {
    const r = await gf.db.put(c, id, 1);
    assert.equal(r.status, 0, `${c}/${id}`);
    assert.match(r.error, /^not a collection or id \(letters, digits, - and _, at most 64\)$/);
  }
});

test('published, a name goes into the address as it is, and a name xgames.fun would refuse is never sent', async () => {
  const { gf, fetched } = load({ href: 'https://moth-play.xgames.test/' });
  await gf.scores.top('daily.2026-11-23');
  assert.deepEqual(
    fetched.filter(f => f.includes('/scores/')),
    ['/platform/v1/scores/daily.2026-11-23?limit=10&offset=0'],
  );
  const before = fetched.length;
  for (const board of ['a'.repeat(33), '.', '..']) assert.equal((await gf.scores.top(board)).status, 0, board);
  assert.equal(fetched.length, before, 'nothing asked');
});

// ---- a room's frames ----

/** server/rooms.js's room with two players' sockets seated: what `a` is sent, and what it sends `b`. */
async function seatedPair() {
  class Seat {
    constructor() {
      this.sent = [];
      this.attachment = { code: 'ROOM42', at: Date.now() };
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
    close() {}
  }
  const sockets = [new Seat(), new Seat()];
  const room = new GameRoom(
    {
      getWebSockets: () => sockets,
      setWebSocketAutoResponse() {},
      storage: { get: async () => undefined, put: async () => {}, delete: async () => {} },
    },
    { GF: {} },
  );
  for (const ws of sockets) await room.webSocketMessage(ws, JSON.stringify({ t: 'hello' }));
  const [a, b] = sockets;
  a.sent.length = b.sent.length = 0;
  return { server: room, a, b, to: b.attachment.id };
}

/**
 * The page of player `a`, joined to a room: every frame the client sends goes to server/rooms.js as `a`'s, so `b`
 * gets what the room passes on. → {room: the client's room, wire: [bytes of each frame sent], a, b, said}
 */
async function joined() {
  const pair = await seatedPair();
  const wire = [];
  let page = null;
  class Socket {
    constructor() {
      this.readyState = 0;
      page = this;
      setTimeout(() => {
        this.readyState = 1;
        this.onopen();
      }, 0);
    }
    send(m) {
      if (typeof m === 'string' && m.startsWith('{"t":"hello"'))
        return setTimeout(
          () => this.onmessage({ data: JSON.stringify({ t: 'welcome', id: 1, host: 1, code: 'ROOM42', peers: [] }) }),
          0,
        );
      wire.push(typeof m === 'string' ? Buffer.byteLength(m) : m.byteLength);
      pair.server.webSocketMessage(pair.a, m);
    }
    close() {}
  }
  const { gf, said } = load({ href: 'https://moth-play.xgames.test/', socket: Socket });
  const { data: room } = await gf.rooms.join('ROOM42');
  assert.ok(room, 'joined');
  return { room, wire, said, ...pair, deliver: m => page.onmessage({ data: JSON.stringify(m) }) };
}
const messages = seat =>
  seat.sent.flatMap(m => (m.t === 'msg' ? [m.d] : m.t === 'msgs' ? m.d : m.t === 'error' ? [{ refused: m.code }] : []));

test('large room messages sent in one frame all arrive: each frame the client sends is one the room takes', async () => {
  const { room, wire, a, b, to } = await joined();
  const big = n => ({ state: 'x'.repeat(40_000), n });
  room.send(big(1));
  room.send(big(2));
  room.send(big(3), to);
  await moment();
  assert.deepEqual(
    messages(b).map(m => m.n ?? m),
    [1, 2, 3],
    'all three, in order',
  );
  assert.deepEqual(messages(a), [], 'the room refused nothing');
  assert.ok(
    wire.every(n => n <= ROOM.messageBytes),
    `frames of ${wire.join(', ')} bytes`,
  );
  assert.equal(wire.length, 3, 'two of 40 KB never share a frame');
});

test('a message is counted by its bytes on the wire, not its characters', async () => {
  const { room, wire, a, b } = await joined();
  // 15,000 characters of 3 bytes each: 45 KB a message
  const wide = n => ({ text: '€'.repeat(15_000), n });
  room.send(wide(1));
  room.send(wide(2));
  await moment();
  assert.deepEqual(
    messages(b).map(m => m.n ?? m),
    [1, 2],
  );
  assert.deepEqual(messages(a), []);
  assert.equal(wire.length, 2);
});

test('small room messages of one frame still go as one, and a message is what it was when it was sent', async () => {
  const { room, wire, b, to } = await joined();
  const scratch = { x: 0 };
  for (let i = 1; i <= 50; i++) {
    scratch.x = i;
    room.send(scratch, i % 2 ? 0 : to);
  }
  room.send(undefined);
  room.send('text');
  await moment();
  assert.equal(wire.length, 1, 'one frame');
  assert.deepEqual(messages(b), [...Array.from({ length: 50 }, (_, i) => ({ x: i + 1 })), null, 'text']);
});

test('a room message that cannot be JSON is said in the console and left out; the rest of the frame goes', async () => {
  const { room, said, b } = await joined();
  const loop = {};
  loop.self = loop;
  room.send({ n: 1 });
  assert.doesNotThrow(() => room.send(loop));
  room.send({ n: 2 });
  await moment();
  assert.deepEqual(messages(b), [{ n: 1 }, { n: 2 }]);
  const errors = said.filter(s => s[0] === 'error');
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][1]), /^room\.send: this message cannot be sent as JSON, so it was left out$/);
  assert.match(String(errors[0][2].message), /circular/);
});

// ---- a game's own listeners ----

test('a listener of the game’s own that throws is said in the console; the other listeners and the call go on', async () => {
  const { gf, said } = load();
  const seen = [];
  // a mistake in the game's own code: the player has no such field
  gf.onChange(p => p.profile.name);
  gf.onChange(p => seen.push(p && p.id));
  const player = await gf.signIn();
  assert.equal(player.id, 'local:player', 'the sign-in answers');
  assert.deepEqual(seen, ['local:player'], 'the listener after it ran');
  const errors = said.filter(s => s[0] === 'error');
  assert.equal(errors.length, 1, JSON.stringify(said));
  assert.equal(errors[0][1], "gf.onChange: a listener of the game's own threw this error");
  assert.match(String(errors[0][2].message), /reading 'name'/, 'with the error itself');
});

test('a room listener that throws is said in the console too, and the next message still arrives', async () => {
  const { room, said, deliver } = await joined();
  const got = [];
  room.on('message', () => {
    throw new RangeError('boom');
  });
  room.on('message', (from, d) => got.push([from, d]));
  deliver({ t: 'msg', from: 2, d: 'one' });
  deliver({ t: 'msgs', from: 2, d: ['two'] });
  assert.deepEqual(got, [
    [2, 'one'],
    [2, 'two'],
  ]);
  const errors = said.filter(s => s[0] === 'error');
  assert.equal(errors.length, 2);
  assert.equal(errors[0][1], "room.on('message'): a listener of the game's own threw this error");
  assert.match(String(errors[0][2].message), /boom/);
});
