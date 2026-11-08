// gamesfun.js's lifecycles in real Chrome: a local room that refuses a join settles and lets its channel go; one sign-in
// at a time, that a second click shares and a sign-out ends (a late answer from games.fun signs nobody back in); and an
// older game's economy in loot.json, read when there is no xsolana.json.
// functions handed to Chrome run in the page: its window, GamesFun and what the page keeps
/* global window, GamesFun, codes, channels, room, joins */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { findChrome, playwrightChromium, ensureBrowser } from '../lib/browser.mjs';
import { ROOT } from './helpers.mjs';

const browserHere = findChrome() ?? ((await playwrightChromium()).installed ? true : null);
const skip = browserHere ? false : 'no Chrome, Edge or Chromium here';
const CLIENT = readFileSync(path.join(ROOT, 'lib', 'client', 'gamesfun.js'), 'utf8');
const GAME = `<!doctype html><html><head><script src="./gamesfun.js"></script></head><body>
<script>window.codes = []; GamesFun.onCode(c => codes.push(c));</script></body></html>`;
// loot's page client, in miniature: no wallet in this browser
const WALLETS = 'export const PAGE_RPC = "/rpc"; export async function solanaWallets() { return []; }';

/** A game's host and a stand-in games.fun. `files` answers the game's own files (name → [status, body]). */
function standIn(files = {}) {
  const s = { requests: [], status: [], approved: false, hold: null, seen: [] };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const body = await new Promise(r => {
      let b = '';
      req.on('data', c => (b += c));
      req.on('end', () => r(b ? JSON.parse(b) : {}));
    });
    const send = (status, data, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };
    s.seen.push(`${req.method} ${url.pathname}`);
    const port = req.headers.host.split(':')[1];
    if (String(req.headers.host).startsWith('xgames.test')) return send(200, '<p>sign in here</p>', 'text/html');
    if (url.pathname === '/') return send(200, GAME, 'text/html');
    if (url.pathname === '/gamesfun.js') return send(200, CLIENT, 'text/javascript');
    if (url.pathname === '/gf/loot/play/index.js')
      return send(200, 'export const solanaApp = null;', 'text/javascript');
    if (url.pathname === '/gf/loot/wallets.js') return send(200, WALLETS, 'text/javascript');
    const file = files[url.pathname.slice(1)];
    if (file) return send(file[0], file[1], 'text/plain');
    if (url.pathname === '/player/v1/request') {
      s.requests.push(body);
      const n = s.requests.length;
      return send(200, {
        id: `r${n}`,
        secret: `s${n}`,
        code: `CODE-000${n}`,
        expires: Date.now() + 900e3,
        url: `http://xgames.test:${port}/go/CODE-000${n}`,
        site: `xgames.test:${port}`,
      });
    }
    if (url.pathname === '/player/v1/request/status') {
      s.status.push(body.id);
      // a status answer held back until the test lets it go (one already on its way when the player signs out)
      if (s.hold) await s.hold.promise;
      if (!s.approved) return send(200, { state: 'waiting' });
      return send(200, {
        state: 'signed-in',
        player: { wallet: '', level: 3, x: { id: '42', handle: 'own_fan' }, by: 'x' },
        token: 'tok-own',
        expires: Date.now() + 3600e3,
      });
    }
    if (url.pathname === '/platform/v1/me') {
      return req.headers.authorization === 'Bearer tok-own'
        ? send(200, { ok: true, player: { id: 'x:42', name: '@own_fan', level: 3, wallet: '', x: null } })
        : send(401, { ok: false, why: 'Sign in first.' });
    }
    return send(404, { ok: false, why: 'not here' });
  });
  return new Promise(r =>
    server.listen(0, '127.0.0.1', () => r({ s, port: server.address().port, close: () => server.close() })),
  );
}

async function chrome() {
  const { chromium } = await import('playwright-core');
  const found = await ensureBrowser({});
  return chromium.launch({
    executablePath: found.path,
    args: ['--host-resolver-rules=MAP *.xgames.test 127.0.0.1, MAP xgames.test 127.0.0.1'],
  });
}

/** `p`'s answer, or 'still waiting' after `ms`. */
const within = (ms, p) => `Promise.race([${p}, new Promise(r => setTimeout(() => r('still waiting'), ${ms}))])`;

/** A page of the game on its own link, with the sign-in window blocked (the code is said instead). */
async function ownLink(t, files) {
  const g = await standIn(files);
  t.after(g.close);
  const browser = await chrome();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await page.goto(`http://moth-play.xgames.test:${g.port}/`);
  return { g, page, browser };
}

test(
  'a local room that refuses a join answers 4004 or 4009, and closes its channel',
  { skip, timeout: 60_000 },
  async t => {
    const g = await standIn();
    t.after(g.close);
    const browser = await chrome();
    t.after(() => browser.close());
    const ctx = await browser.newContext();
    // every BroadcastChannel the page opens, and whether it was closed
    await ctx.addInitScript(() => {
      const Real = BroadcastChannel;
      window.channels = [];
      window.BroadcastChannel = class extends Real {
        constructor(name) {
          super(name);
          this.closed = false;
          channels.push(this);
        }
        close() {
          this.closed = true;
          super.close();
        }
      };
    });
    const [a, b] = [await ctx.newPage(), await ctx.newPage()];
    for (const p of [a, b]) await p.goto(`http://127.0.0.1:${g.port}/`);

    const empty = await a.evaluate(within(3000, "GamesFun.rooms.join('EMPTY1', { host: false })"));
    assert.deepEqual(empty, { data: null, error: 'No one is in this room.', status: 4004 });
    assert.deepEqual(await a.evaluate(() => channels.map(c => c.closed)), [true], "the refused join's channel closed");

    assert.equal(
      await a.evaluate(async () => {
        window.room = (await GamesFun.rooms.join('TAKEN1', { host: true })).data;
        window.joins = [];
        room.on('join', p => joins.push(p));
        return room.isHost;
      }),
      true,
    );
    const taken = await b.evaluate(within(3000, "GamesFun.rooms.join('TAKEN1', { host: true })"));
    assert.deepEqual(taken, {
      data: null,
      error: 'Someone is in this room already: choose another code.',
      status: 4009,
    });
    assert.deepEqual(await b.evaluate(() => channels.map(c => c.closed)), [true]);
    await a.waitForTimeout(300);
    assert.deepEqual(await a.evaluate(() => [joins, room.peers]), [[], {}], 'the host heard no one join');
  },
);

test(
  'a second sign-in click while one is pending shares it: one request, both answered',
  { skip, timeout: 60_000 },
  async t => {
    const { g, page } = await ownLink(t);
    await page.evaluate(() => {
      window.first = GamesFun.signIn();
      window.second = GamesFun.signIn();
      window.same = window.first === window.second;
    });
    await page.waitForFunction(() => codes.length > 0);
    g.s.approved = true;
    const [first, second] = await page.evaluate(within(8000, 'Promise.all([window.first, window.second])'));
    assert.equal(first?.id, 'x:42', 'the first click is answered');
    assert.equal(second?.id, 'x:42');
    assert.equal(await page.evaluate(() => window.same), true, 'the same promise');
    assert.equal(g.s.requests.length, 1, 'one request on games.fun');
    assert.equal(await page.evaluate(() => GamesFun.code), null);
  },
);

test(
  'signing out while a sign-in is pending answers it null, and the next click asks again',
  { skip, timeout: 60_000 },
  async t => {
    const { g, page } = await ownLink(t);
    await page.evaluate(() => {
      window.pending = GamesFun.signIn();
    });
    await page.waitForFunction(() => codes.length > 0);
    await page.evaluate(() => GamesFun.signOut());
    assert.equal(await page.evaluate(within(1000, 'window.pending')), null, 'answered null at once');
    assert.equal(await page.evaluate(() => GamesFun.code), null);
    // a later click is a new sign-in, not the one that ended
    await page.evaluate(() => {
      window.again = GamesFun.signIn();
    });
    await page.waitForFunction(() => codes.length > 1);
    g.s.approved = true;
    assert.equal((await page.evaluate(within(8000, 'window.again')))?.id, 'x:42');
    assert.equal(g.s.requests.length, 2);
  },
);

test(
  'signing out while the request itself is on its way: its answer is dropped',
  { skip, timeout: 60_000 },
  async t => {
    const { g, page } = await ownLink(t);
    await page.evaluate(() => {
      window.pending = GamesFun.signIn();
      GamesFun.signOut();
    });
    assert.equal(await page.evaluate(within(1000, 'window.pending')), null);
    await page.waitForTimeout(500);
    assert.equal(g.s.requests.length, 1);
    assert.deepEqual(await page.evaluate(() => [codes.length, GamesFun.code]), [0, null], 'no code said for it');
    await page.waitForTimeout(2500);
    assert.deepEqual(g.s.status, [], 'never asked about');
  },
);

test(
  'a status answer already on its way when the player signs out signs nobody back in',
  { skip, timeout: 60_000 },
  async t => {
    const { g, page } = await ownLink(t);
    let release;
    g.s.hold = { promise: new Promise(r => (release = r)) };
    await page.evaluate(() => {
      window.pending = GamesFun.signIn();
    });
    await page.waitForFunction(() => codes.length > 0);
    g.s.approved = true;
    // the poll has gone out and is waiting on games.fun
    while (!g.s.status.length) await page.waitForTimeout(50);
    await page.evaluate(() => GamesFun.signOut());
    release();
    await page.waitForTimeout(800);
    assert.deepEqual(await page.evaluate(() => [GamesFun.player, GamesFun.token]), [null, '']);
    assert.equal(await page.evaluate(within(500, 'window.pending')), null);
    assert.ok(!g.s.seen.includes('GET /platform/v1/me'), 'the late token was not taken');
  },
);

test(
  "an older game's economy in loot.json is read when there is no xsolana.json",
  { skip, timeout: 60_000 },
  async t => {
    const spec = { name: 'moth', live: { project: 'P1' } };
    const { g, page } = await ownLink(t, { 'loot.json': [200, JSON.stringify(spec)] });
    const r = await page.evaluate(() => GamesFun.loot.ready());
    assert.equal(r.error, null);
    assert.deepEqual(r.data, { live: true, project: 'P1', wallets: [], spec });
    assert.ok(g.s.seen.includes('GET /xsolana.json') && g.s.seen.includes('GET /loot.json'));
  },
);

test(
  'xsolana.json comes first, and an error other than a 404 is not passed over for loot.json',
  { skip, timeout: 60_000 },
  async t => {
    const both = await ownLink(t, {
      'xsolana.json': [200, JSON.stringify({ name: 'new' })],
      'loot.json': [200, JSON.stringify({ name: 'old' })],
    });
    assert.equal((await both.page.evaluate(() => GamesFun.loot.ready())).data.spec.name, 'new');
    assert.ok(!both.g.s.seen.includes('GET /loot.json'));

    const broken = await ownLink(t, {
      'xsolana.json': [500, 'oops'],
      'loot.json': [200, JSON.stringify({ name: 'old' })],
    });
    const r = await broken.page.evaluate(() => GamesFun.loot.ready());
    assert.equal(r.data, null);
    assert.match(r.error, /xsolana\.json/);
    assert.ok(!broken.g.s.seen.includes('GET /loot.json'));

    const none = await ownLink(t);
    const n = await none.page.evaluate(() => GamesFun.loot.ready());
    assert.match(n.error, /no economy here/);
  },
);
