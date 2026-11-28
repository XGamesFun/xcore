// `xcore dev` (lib/dev/): the page as the play host serves it with its marker, the platform's sign-in, saves and scores,
// the economy's RPC forwarded (and what xgames.fun's relay would refuse, said), the game's server under workerd when
// Miniflare is here (GAMESFUN_SERVER_DEPS), and gamesfun.js in Chrome using all of it, GamesFun.loot included.
/* global GamesFun -- the page's, inside page.evaluate */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { markPage, relayRefuses, startDev, DEV_MARK } from '../lib/dev/index.mjs';
import { createPlatformStore } from '../lib/dev/platform.mjs';
import { findChrome, playwrightChromium, ensureBrowser } from '../lib/browser.mjs';
import { BIN, ROOT, run, tempDir } from './helpers.mjs';
import { listenRefusal } from '../commands/dev.mjs';
import { addRpc } from '../lib/add.mjs';
import { lootProgram } from '../lib/economy.mjs';

const browserHere = findChrome() ?? ((await playwrightChromium()).installed ? true : null);
const noChrome = browserHere ? false : 'no Chrome, Edge or Chromium here';
const noMiniflare = process.env.GAMESFUN_SERVER_DEPS
  ? false
  : 'GAMESFUN_SERVER_DEPS (a folder with miniflare) is not set';
// loot's address, as the installed tools have it
const LOOT = lootProgram();

test('the marker goes first in <head>, once, and into a page without one', () => {
  assert.equal(
    markPage('<!doctype html><html><head><title>x</title></head>'),
    `<!doctype html><html><head>${DEV_MARK}<title>x</title></head>`,
  );
  assert.equal(
    markPage('<HEAD lang="en"><script src=a.js></script>'),
    `<HEAD lang="en">${DEV_MARK}<script src=a.js></script>`,
  );
  assert.equal(markPage('<!DOCTYPE html><canvas></canvas>'), `<!DOCTYPE html>${DEV_MARK}<canvas></canvas>`);
  assert.equal(markPage('<p>hi</p>'), `${DEV_MARK}<p>hi</p>`);
  const once = markPage('<head></head>');
  assert.equal(markPage(once), once);
});

test("what xgames.fun's shared relay refuses, said in words (and what it takes, passed)", () => {
  assert.equal(relayRefuses({ jsonrpc: '2.0', id: 1, method: 'getSlot' }), null);
  assert.equal(relayRefuses({ method: 'getProgramAccounts', params: [LOOT, { filters: [{ memcmp: {} }] }] }), null);
  assert.match(relayRefuses([{ method: 'getSlot' }]), /batch/);
  assert.match(relayRefuses({ method: 'requestAirdrop', params: [] }), /requestAirdrop/);
  assert.match(relayRefuses({ method: 'getProgramAccounts', params: [LOOT, {}] }), /with a filter/);
  assert.match(
    relayRefuses({
      method: 'getProgramAccounts',
      params: ['CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d', { filters: [{}] }],
    }),
    /CoREENxT/,
  );
  // loot's page client's own scans: a wallet's Core NFTs in a collection, a wallet's lookup tables
  const wallet = '6mZxBNKfSK3hVuWAxiVfgrrFrgqZvPRVNUCpER3hPhaJ';
  const core = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
  const owned = [{ memcmp: { offset: 0, bytes: '2' } }, { memcmp: { offset: 1, bytes: wallet } }];
  assert.equal(relayRefuses({ method: 'getProgramAccounts', params: [core, { filters: owned }] }), null);
  const tables = [{ memcmp: { offset: 22, bytes: wallet } }];
  const alt = 'AddressLookupTab1e1111111111111111111111111';
  assert.equal(relayRefuses({ method: 'getProgramAccounts', params: [alt, { filters: tables }] }), null);
  assert.match(
    relayRefuses({
      method: 'getProgramAccounts',
      params: [alt, { filters: [{ memcmp: { offset: 1, bytes: wallet } }] }],
    }),
    /AddressL/,
  );
});

test("the platform's store: its own tokens only, for this game, and the hosted limits", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  let now = Date.now();
  const s = createPlatformStore({ dir: tmp.dir, slug: 'moth', now: () => now });
  const other = createPlatformStore({ dir: tmp.dir, slug: 'moth' });
  const { token, player } = s.devToken({ name: 'Ana <b>', id: 'abcdef12' });
  assert.equal(player.id, 'dev:abcdef12');
  assert.equal(player.name, 'Ana b');
  assert.equal(s.verifyPlayer(token).sub, 'dev:abcdef12');
  assert.equal(s.verifyPlayer(token).banned, null, 'no bans in xcore dev; the field is there, as hosted');
  assert.equal(other.verifyPlayer(token).code, 'key', 'another dev host (another key) refuses it');
  assert.equal(s.verifyPlayer(token.slice(0, -2) + 'xx').code, 'key');
  assert.equal(
    s.verifyPlayer('eyJhbGciOiJFZERTQSJ9.e30.sig').code,
    'bad',
    'an xgames.fun token is checked only when hosted',
  );
  assert.equal((await s.run('saves.put', [player.id, 'main', { level: 3 }])).ok, true);
  assert.deepEqual((await s.run('saves.get', [player.id, 'main'])).value, { level: 3 });
  assert.equal((await s.run('saves.put', [player.id, 'big', 'x'.repeat(70 * 1024)])).code, 'too-big');
  assert.equal((await s.run('saves.put', [player.id, 'bad key!', 1])).code, 'key');
  assert.equal((await s.run('scores.submit', ['best', player.id, 10, { name: 'Ana' }])).rank, 1);
  assert.equal((await s.run('scores.submit', ['best', player.id, 20])).code, 'rate', 'one score a second a player');
  now += 2000;
  assert.equal((await s.run('scores.submit', ['best', player.id, 20])).best, 20);
  assert.deepEqual(await s.run('scores.setup', ['ranked', { writer: 'server' }]), {
    ok: true,
    board: 'ranked',
    order: 'high',
    writer: 'server',
    removed: 0,
  });
  assert.equal((await s.pageSubmit('ranked', player.id, 9e9, { name: 'x' })).code, 'server-only');
  assert.equal((await s.pageSubmit('best', player.id, 1, { name: 'x', writer: 'server' })).code, 'rate');
  assert.equal((await s.run('scores.top', ['best'])).writer, 'any', 'a page never sets a rule');
  assert.equal((await s.run('scores.submit', ['ranked', player.id, 5])).ok, true, 'the server writes it');
  assert.equal((await s.run('scores.setup', ['ranked', { writer: 'nobody' }])).code, 'writer');
  assert.equal((await s.run('loot.report', [{ round: 'nope' }])).ok, false);
  assert.equal((await s.run('nope', [])).code, 'unknown');
  now += 2 * 3600e3;
  assert.equal(s.verifyPlayer(token).code, 'expired');
  await s.flush();
  const kept = JSON.parse(await readFile(s.file, 'utf8'));
  assert.deepEqual(kept.saves['dev:abcdef12'].main.value, { level: 3 }, 'kept in .gamesfun/dev-platform.json');
});

test("the platform's boards: the page's scores go when the server takes a board; patterns; drop", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  let now = Date.now();
  const s = createPlatformStore({ dir: tmp.dir, slug: 'moth', now: () => now });
  const tick = () => (now += 1001);
  assert.equal((await s.pageSubmit('daily-1105', 'dev:p1', 1e9)).ok, true, 'the page got there first');
  assert.equal((await s.run('scores.submit', ['daily-1105', 'dev:p2', 300])).ok, true);
  assert.deepEqual(await s.run('scores.setup', ['daily-1105', { writer: 'server' }]), {
    ok: true,
    board: 'daily-1105',
    order: 'high',
    writer: 'server',
    removed: 2,
  });
  assert.deepEqual((await s.run('scores.top', ['daily-1105'])).entries, []);
  tick();
  assert.equal((await s.pageSubmit('daily-1106', 'dev:p1', 1e9)).ok, true);
  assert.deepEqual(await s.run('scores.setup', ['daily-*', { writer: 'server' }]), {
    ok: true,
    board: 'daily-*',
    writer: 'server',
    removed: 1,
  });
  tick();
  assert.equal((await s.pageSubmit('daily-1201', 'dev:p1', 1e9)).code, 'server-only', 'a board to come');
  assert.equal((await s.run('scores.top', ['daily-1201'])).writer, 'server');
  assert.equal((await s.run('scores.submit', ['daily-1201', 'dev:p2', 120])).ok, true);
  assert.equal((await s.run('scores.setup', ['*', { writer: 'server' }])).ok, true);
  assert.equal((await s.run('scores.setup', ['open-*', { writer: 'any' }])).ok, true);
  assert.equal((await s.pageSubmit('open-1', 'dev:p1', 5)).ok, true, 'the longer pattern wins');
  assert.equal((await s.pageSubmit('anything', 'dev:p3', 5)).code, 'server-only');
  assert.equal((await s.run('scores.setup', ['bad*name', { writer: 'server' }])).code, 'board');
  assert.deepEqual(await s.run('scores.drop', ['daily-1201']), { ok: true, dropped: true, removed: 1 });
  assert.deepEqual(await s.run('scores.drop', ['daily-1201']), { ok: true, dropped: false, removed: 0 });
});

/** A plain game folder: index.html with gamesfun.js, an economy (xsolana.json) and a stand-in of loot's page client. */
async function game(dir, { live = true } = {}) {
  await mkdir(path.join(dir, 'gf', 'loot', 'play'), { recursive: true });
  await writeFile(
    path.join(dir, 'index.html'),
    '<!doctype html><html><head><script src="./gamesfun.js"></script></head><body><p>moth</p></body></html>',
  );
  await writeFile(path.join(dir, 'gamesfun.js'), await readFile(path.join(ROOT, 'lib', 'client', 'gamesfun.js')));
  await writeFile(
    path.join(dir, 'xsolana.json'),
    JSON.stringify({
      name: 'moth',
      ...(live ? { live: { project: 'ProjectAddress1111111111111111111111111111' } } : {}),
    }),
  );
  // the page client's shape (solanaApp, walletStandardSigner; solanaWallets, connectWallet, PAGE_RPC): enough to see
  // what GamesFun.loot gives it and hands back
  await writeFile(
    path.join(dir, 'gf', 'loot', 'play', 'index.js'),
    `export const walletStandardSigner = (w, a) => ({ address: a.address, signTransaction: async x => x });
     export function solanaApp({ spec, rpcUrl, wallet }) {
       return {
         async shop() { return [{ key: 'sword', priceUnits: 1500000000n, bytes: new Uint8Array([1, 2]) }]; },
         async buy(key, { listing }) { return { key, paidAtMost: String(BigInt(listing.priceUnits)), rpcUrl, by: wallet.address }; },
         async fail() { throw new Error('the network refused this'); },
       };
     }`,
  );
  await writeFile(
    path.join(dir, 'gf', 'loot', 'wallets.js'),
    `export const PAGE_RPC = new URL('/loot/v1/rpc', location.href).href;
     export async function solanaWallets() { return [{ name: 'Stub Wallet', features: {} }]; }
     export async function connectWallet(w) { return { address: 'PlayerAddress11111111111111111111111111111' }; }`,
  );
  return dir;
}

async function http(url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, text, json, headers: Object.fromEntries(r.headers) };
}

test('xcore dev refuses a backend.json or an economy file that is not valid JSON, by name, before anything starts', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(path.join(tmp.dir, 'moth'));
  const start = () => startDev(dir, { port: 0, log: () => {} });
  await writeFile(path.join(dir, 'backend.json'), '{ "origins": [');
  await assert.rejects(start(), /^Error: backend\.json is not valid JSON \(.+\); fix it first$/);
  await writeFile(path.join(dir, 'backend.json'), '{ "version": 1, "origins": [] }');
  await writeFile(path.join(dir, 'xsolana.json'), '{ "name": ');
  await assert.rejects(start(), /^Error: xsolana\.json is not valid JSON \(.+\); fix it first$/);
  assert.ok(!existsSync(path.join(dir, '.gamesfun')), 'no store, no server: nothing was started');
});

test('a port xcore dev cannot take is said by the number the person gave, with why: never a port they did not type', () => {
  const refused = (code, port) =>
    Object.assign(new Error(`listen ${code}: permission denied 127.0.0.1:${port}`), { code, syscall: 'listen', port });
  // --port 80: the files' port, 81, is the one the system refuses first
  const files = listenRefusal(refused('EACCES', 81), 80).message;
  assert.match(files, / dev cannot listen on port 81, the one after 80, which it takes for the game's files: /);
  assert.match(files, /only an administrator use a port under 1024\. Pick another with --port <n>/);
  assert.doesNotMatch(files, /EACCES|127\.0\.0\.1/);
  assert.match(listenRefusal(refused('EACCES', 1023), 1023).message, / dev cannot listen on port 1023: this system/);
  assert.equal(
    listenRefusal(refused('EADDRINUSE', 8787), 8787).message,
    'port 8787 is in use: pick another with --port <n>',
  );
  assert.match(
    listenRefusal(refused('EADDRNOTAVAIL', 9000), 9000).message,
    /port 9000: the system answered EADDRNOTAVAIL/,
  );
  assert.equal(listenRefusal(new Error('the build failed'), 8787), null, 'any other error goes on as it is');
  const unreadable = Object.assign(new Error('EACCES: permission denied, open'), { code: 'EACCES', syscall: 'open' });
  assert.equal(listenRefusal(unreadable, 8787), null, 'a file it may not read is no port');
  // the last port has no next one for the files: refused as a usage mistake, in words
  const last = run(['dev', '.', '--port', '65535']);
  assert.equal(last.status, 2);
  assert.match(last.stderr, /^--port takes a port number \(0–65534: the next one is taken for the game's files\)/);
});

test('xcore dev serves the game marked, the platform, the RPC forward, and no server where there is none', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(path.join(tmp.dir, 'moth'));
  const logs = [],
    sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, body: JSON.parse(Buffer.from(init.body).toString('utf8')) });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 42 }), { status: 200 });
  };
  const dev = await startDev(dir, {
    port: 0,
    log: m => logs.push(m),
    fetchImpl,
    env: { XSOLANA_RPC_URL: 'https://devnet.rpc.example/key-abc' },
  });
  t.after(() => dev.close());
  const page = await http(dev.url);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(`<head>${DEV_MARK}`), 'the page carries the marker');
  assert.ok(!(await http(`${dev.url}gamesfun.js`)).text.includes(DEV_MARK), 'only HTML is marked');
  assert.match(dev.rpc, /your own devnet RPC/);
  assert.ok(!dev.rpc.includes('key-abc'), 'its own RPC URL is never shown');

  const rpc = await http(`${dev.origin}/loot/v1/rpc`, {
    method: 'POST',
    body: '{"jsonrpc":"2.0","id":1,"method":"getSlot"}',
  });
  assert.equal(rpc.json.result, 42);
  assert.equal(sent[0].url, 'https://devnet.rpc.example/key-abc');
  await http(`${dev.origin}/loot/v1/rpc`, {
    method: 'POST',
    body: '{"jsonrpc":"2.0","id":2,"method":"requestAirdrop","params":[]}',
  });
  await http(`${dev.origin}/loot/v1/rpc`, {
    method: 'POST',
    body: '{"jsonrpc":"2.0","id":3,"method":"requestAirdrop","params":[]}',
  });
  assert.equal(logs.filter(l => /relay would refuse requestAirdrop/.test(l)).length, 1, 'said once');

  const tok = await http(`${dev.origin}/platform/v1/dev/token`, { method: 'POST', body: '{"name":"Ana"}' });
  const auth = { authorization: `Bearer ${tok.json.token}` };
  assert.equal((await http(`${dev.origin}/platform/v1/me`, { headers: auth })).json.player.name, 'Ana');
  assert.equal((await http(`${dev.origin}/platform/v1/me`)).status, 401);
  // a name that is not this machine (a page elsewhere pointing its own name at 127.0.0.1) is refused
  const rebound = await new Promise((resolve, reject) => {
    const u = new URL(`${dev.origin}/platform/v1/dev/token`);
    const req = httpRequest(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { host: 'evil.example' } },
      res => (res.resume(), resolve(res.statusCode)),
    );
    req.on('error', reject);
    req.end('{"name":"Eve"}');
  });
  assert.equal(rebound, 403, 'the dev host answers only localhost');
  // a socket the same: an upgrade under a name that is not this machine's is refused, before the game's server sees it
  const upgrade = host =>
    new Promise((resolve, reject) => {
      const u = new URL(`${dev.url}api/rooms`);
      const req = httpRequest(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname,
          headers: {
            ...(host ? { host } : {}),
            connection: 'Upgrade',
            upgrade: 'websocket',
            'sec-websocket-version': '13',
            'sec-websocket-key': Buffer.alloc(16, 7).toString('base64'),
          },
        },
        res => (res.resume(), resolve(res.statusCode)),
      );
      req.on('upgrade', (res, socket) => (socket.destroy(), resolve(res.statusCode)));
      req.on('error', reject);
      req.end();
    });
  assert.equal(await upgrade('evil.example'), 403, 'nor a socket');
  assert.equal(await upgrade(`evil.example:${new URL(dev.origin).port}`), 403, 'whatever port it names');
  assert.equal(await upgrade(null), 404, 'this machine’s own is read: this game has no server to take it');
  assert.equal(page.headers['x-content-type-options'], 'nosniff', 'the page goes out with the play host’s headers');
  const put = await http(`${dev.origin}/platform/v1/saves/main`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: '{"value":{"level":2}}',
  });
  assert.equal(put.json.ok, true);
  const untyped = await http(`${dev.origin}/platform/v1/saves/main`, { method: 'PUT', headers: auth, body: '{}' });
  assert.deepEqual([untyped.status, untyped.json.code], [415, 'failed'], 'a body is JSON, said so, as hosted');
  assert.deepEqual((await http(`${dev.origin}/platform/v1/saves/main`, { headers: auth })).json.value, { level: 2 });
  const none = await http(`${dev.url}api/rooms`);
  assert.equal(none.status, 404);
  assert.match(none.json.message, /no server/);
  assert.equal((await http(`${dev.origin}/elsewhere.js`)).status, 404, 'from the root, outside the game: as hosted');
});

test('xcore dev with no --port starts at 8787, or the first free pair after it: the page’s port, and the next for its files', async t => {
  const tmp = await tempDir();
  await writeFile(path.join(tmp.dir, 'index.html'), '<!doctype html><title>moth</title>');
  const child = spawn(process.execPath, [BIN, 'dev', tmp.dir, '--json'], {
    env: { ...process.env, GAMESFUN_KIT: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  t.after(async () => {
    child.kill();
    await closed;
    await tmp.cleanup();
  });
  let out = '',
    err = '';
  child.stderr.on('data', c => (err += c));
  const where = await new Promise((resolve, reject) => {
    child.stdout.on('data', c => {
      out += c;
      try {
        resolve(JSON.parse(out));
      } catch {}
    });
    closed.then(([code]) => reject(new Error(`xcore dev stopped (${code}): ${err}`)));
  });
  const page = Number(new URL(where.origin).port);
  assert.equal(Number(new URL(where.files).port), page + 1, 'its files on the next port');
  // another game in dev may hold 8787 on this machine: then it is the next pair, and the next, never an odd step
  assert.ok(page >= 8787 && page < 8787 + 20 && (page - 8787) % 2 === 0, `the page is on ${page}`);
  for (const doc of ['README.md', path.join('docs', 'COMMANDS.md')]) {
    const text = await readFile(path.join(ROOT, doc), 'utf8');
    assert.ok(text.includes('`http://127.0.0.1:8787/game/`'), `${doc} names the same port`);
  }
});

test(
  'gamesfun.js under xcore dev: a local sign-in a tab, kept over a reload; saves on the platform; GamesFun.loot',
  { skip: noChrome, timeout: 90_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await game(path.join(tmp.dir, 'moth'));
    const dev = await startDev(dir, { port: 0, log: () => {}, env: {} });
    t.after(() => dev.close());
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ executablePath: (await ensureBrowser({})).path });
    t.after(() => browser.close());
    const a = await browser.newPage(),
      b = await (await browser.newContext()).newPage();
    for (const p of [a, b]) await p.goto(dev.url);
    assert.deepEqual(await a.evaluate(() => [GamesFun.dev, GamesFun.local, GamesFun.player]), [true, true, null]);
    const ana = await a.evaluate(() => GamesFun.signIn({ name: 'Ana' }));
    const bo = await b.evaluate(() => GamesFun.signIn({ name: 'Bo' }));
    assert.equal(ana.name, 'Ana');
    assert.ok(ana.dev && ana.id.startsWith('dev:'));
    assert.notEqual(ana.id, bo.id, 'each tab its own player');
    assert.equal((await a.evaluate(() => GamesFun.saves.put('main', { level: 7 }))).error, null);
    assert.equal((await a.evaluate(() => GamesFun.scores.submit('best', 99))).data.rank, 1);
    assert.equal((await b.evaluate(() => GamesFun.scores.top('best'))).data[0].name, 'Ana', 'both read one board');
    await a.reload();
    assert.equal((await a.evaluate(() => GamesFun.ready)).id, ana.id, 'the same player after a reload');
    assert.deepEqual((await a.evaluate(() => GamesFun.saves.get('main'))).data, { level: 7 });

    // the economy, from any engine: JSON-safe answers, a listing handed back as it came
    const ready = await a.evaluate(() => GamesFun.loot.ready());
    assert.equal(ready.data.live, true);
    assert.deepEqual(ready.data.wallets, ['Stub Wallet']);
    assert.match((await a.evaluate(() => GamesFun.loot.call('shop'))).error, /Connect a wallet first/);
    // before a wallet: the kit's app reads
    assert.equal(await a.evaluate(async () => (await (await GamesFun.loot.app()).data.app.shop())[0].key), 'sword');
    const c = await a.evaluate(() => GamesFun.loot.connect());
    assert.equal(c.data.address, 'PlayerAddress11111111111111111111111111111');
    assert.equal(await a.evaluate(() => GamesFun.loot.address), c.data.address);
    // a web page: the solana kit's own app, its own answers (a bigint stays one), signing with the connected wallet
    const kit = await a.evaluate(async () => {
      const r = await GamesFun.loot.app();
      const s = await r.data.app.shop();
      const b = await r.data.app.buy('sword', { listing: s[0] });
      return {
        cluster: r.data.cluster,
        live: r.data.live,
        price: typeof s[0].priceUnits,
        by: b.by,
        kit: !!r.data.kit.solanaApp,
      };
    });
    assert.deepEqual(kit, { cluster: 'devnet', live: true, price: 'bigint', by: c.data.address, kit: true });
    const shop = await a.evaluate(() => GamesFun.loot.call('shop'));
    assert.deepEqual(shop.data[0], { key: 'sword', priceUnits: '1500000000', bytes: [1, 2] });
    const bought = await a.evaluate(
      l => GamesFun.loot.call('buy', 'sword', { listing: JSON.parse(l) }),
      JSON.stringify(shop.data[0]),
    );
    assert.equal(bought.data.paidAtMost, '1500000000');
    assert.equal(bought.data.rpcUrl, `${dev.origin}/loot/v1/rpc`, "the page's own RPC");
    assert.equal((await a.evaluate(() => GamesFun.loot.call('fail'))).error, 'the network refused this');
    for (const m of ['constructor', 'toString', '__proto__', 'Buy'])
      assert.match((await a.evaluate(n => GamesFun.loot.call(n), m)).error, /loot has no/, m);
    await a.evaluate(() => GamesFun.loot.disconnect());
    assert.equal(await a.evaluate(() => GamesFun.loot.address), '');
  },
);

test('GamesFun.loot says what is missing: no economy, not live yet', { skip: noChrome, timeout: 60_000 }, async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(path.join(tmp.dir, 'draft'), { live: false });
  const dev = await startDev(dir, { port: 0, log: () => {}, env: {} });
  t.after(() => dev.close());
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: (await ensureBrowser({})).path });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(dev.url);
  assert.equal((await page.evaluate(() => GamesFun.loot.ready())).data.live, false);
  await page.evaluate(() => GamesFun.loot.connect());
  assert.match((await page.evaluate(() => GamesFun.loot.call('shop'))).error, /not live yet/);
  await writeFile(path.join(dir, 'xsolana.json'), '');
  const page2 = await browser.newPage();
  await page2.goto(dev.url);
  assert.match((await page2.evaluate(() => GamesFun.loot.ready())).error, /xsolana.json is not JSON/);
  const { rm } = await import('node:fs/promises');
  await rm(path.join(dir, 'xsolana.json'));
  const page3 = await browser.newPage();
  await page3.goto(dev.url);
  assert.match((await page3.evaluate(() => GamesFun.loot.ready())).error, /no economy here/);
});

test(
  "xcore dev runs the game's server: env.GF checks the page's sign-in, saves reach the page, a change reloads it",
  { skip: noMiniflare, timeout: 120_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await game(path.join(tmp.dir, 'srv'));
    await mkdir(path.join(dir, 'server'));
    const source = v => `import { DurableObject } from 'cloudflare:workers';
      import { RULE } from '../rules.js';
      export class Counter extends DurableObject {
        async fetch() { const n = ((await this.ctx.storage.get('n')) ?? 0) + 1; await this.ctx.storage.put('n', n); return Response.json({ n }); }
      }
      export default { async fetch(req, env) {
        const u = new URL(req.url);
        if (u.pathname === '/api/count') return env.COUNTER.get(env.COUNTER.idFromName('a')).fetch(req);
        if (u.pathname === '/api/rule') return Response.json({ rule: RULE });
        const who = await env.GF.verifyPlayer((req.headers.get('authorization') ?? '').slice(7));
        if (!who.ok) return Response.json(who, { status: 401 });
        await env.GF.saves.put(who.sub, 'fromServer', { v: ${v} });
        return Response.json({ v: ${v}, sub: who.sub, game: env.GF_GAME_ID });
      } };`;
    await writeFile(path.join(dir, 'rules.js'), "export const RULE = 'a';\n"); // shared with the page
    await writeFile(path.join(dir, 'server', 'index.js'), source(1));
    await writeFile(
      path.join(dir, 'gamesfun.json'),
      JSON.stringify({ server: { main: 'server/index.js', objects: [{ class: 'Counter', binding: 'COUNTER' }] } }),
    );
    const dev = await startDev(dir, { port: 0, log: () => {}, env: process.env });
    t.after(() => dev.close());
    assert.equal(dev.server.running, true, JSON.stringify(dev.server));
    const tok = (await http(`${dev.origin}/platform/v1/dev/token`, { method: 'POST', body: '{"name":"Ana"}' })).json;
    const auth = { authorization: `Bearer ${tok.token}`, 'x-gf-owner': 'forged' };
    const r = await http(`${dev.url}api/me`, { headers: auth });
    assert.deepEqual(r.json, { v: 1, sub: tok.player.id, game: 'dev-srv' });
    assert.equal((await http(`${dev.url}api/me`)).status, 401);
    const save = await http(`${dev.origin}/platform/v1/saves/fromServer`, { headers: auth });
    assert.deepEqual(save.json.value, { v: 1 }, 'what the server saved, the page reads');
    assert.equal((await http(`${dev.url}api/count`)).json.n, 1);
    assert.equal((await http(`${dev.url}api/count`)).json.n, 2);
    await writeFile(path.join(dir, 'server', 'index.js'), source(2));
    await new Promise(r => setTimeout(r, 1500));
    assert.equal((await http(`${dev.url}api/me`, { headers: auth })).json.v, 2, 'reloaded after the change');
    assert.equal((await http(`${dev.url}api/count`)).json.n, 3, 'its storage kept over the reload');
    assert.equal((await http(`${dev.url}api/rule`)).json.rule, 'a');
    await writeFile(path.join(dir, 'rules.js'), "export const RULE = 'b';\n");
    await new Promise(r => setTimeout(r, 1500));
    assert.equal(
      (await http(`${dev.url}api/rule`)).json.rule,
      'b',
      'a file it imports from outside server/ reloads it',
    );
  },
);

test(
  "xcore dev: .dev.vars are the server's secrets (env.<NAME>), and a board the server owns refuses the page's score",
  { skip: noMiniflare, timeout: 120_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await game(path.join(tmp.dir, 'sec'));
    await mkdir(path.join(dir, 'server'));
    await writeFile(
      path.join(dir, 'server', 'index.js'),
      `export default { async fetch(req, env) {
        const u = new URL(req.url);
        if (u.pathname === '/api/env') return Response.json({ key: env.VOUCHER_KEY ?? null, low: env.lower ?? null, gf: env.GF_SLUG });
        const who = await env.GF.verifyPlayer((req.headers.get('authorization') ?? '').slice(7));
        if (u.pathname === '/api/setup') return Response.json(await env.GF.scores.setup('ranked', { writer: 'server' }));
        return Response.json(await env.GF.scores.submit('ranked', who.sub, 42, { name: 'server' }));
      } };`,
    );
    await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify({ server: { main: 'server/index.js' } }));
    await writeFile(path.join(dir, '.dev.vars'), 'VOUCHER_KEY="made-up-value"\nlower=1\nGF_SLUG=spoof\n');
    const dev = await startDev(dir, { port: 0, log: () => {}, env: process.env });
    t.after(() => dev.close());
    assert.equal(dev.server.running, true, JSON.stringify(dev.server));
    assert.deepEqual(dev.server.secrets, ['VOUCHER_KEY']);
    assert.ok(
      dev.server.warnings.some(w => /lower left out/.test(w)) &&
        dev.server.warnings.some(w => /GF_SLUG left out/.test(w)),
    );
    assert.deepEqual((await http(`${dev.url}api/env`)).json, { key: 'made-up-value', low: null, gf: 'sec' });
    await writeFile(path.join(dir, '.dev.vars'), 'VOUCHER_KEY=changed\n');
    await new Promise(r => setTimeout(r, 1500));
    assert.equal((await http(`${dev.url}api/env`)).json.key, 'changed', 'reloaded after .dev.vars changed');

    const tok = (await http(`${dev.origin}/platform/v1/dev/token`, { method: 'POST', body: '{"name":"Ana"}' })).json;
    const auth = { authorization: `Bearer ${tok.token}`, 'content-type': 'application/json' };
    assert.deepEqual((await http(`${dev.url}api/setup`, { headers: auth })).json, {
      ok: true,
      board: 'ranked',
      order: 'high',
      writer: 'server',
      removed: 0,
    });
    const cheat = await http(`${dev.origin}/platform/v1/scores/ranked`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ score: 1e9, writer: 'any' }),
    });
    assert.deepEqual([cheat.status, cheat.json.code], [403, 'server-only']);
    assert.equal((await http(`${dev.url}api/submit`, { headers: auth })).json.ok, true);
    const top = (await http(`${dev.origin}/platform/v1/scores/ranked`)).json;
    assert.equal(top.writer, 'server');
    assert.deepEqual(
      top.entries.map(e => e.score),
      [42],
    );
  },
);

test(
  "GamesFun.loot uses the game's own RPC (xcore add rpc) once its server has XSOLANA_RPC_URL, else the relay",
  { skip: noChrome || noMiniflare, timeout: 120_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await game(path.join(tmp.dir, 'own-rpc'));
    await addRpc(dir);
    const dev = await startDev(dir, { port: 0, log: () => {}, env: process.env });
    t.after(() => dev.close());
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ executablePath: (await ensureBrowser({})).path });
    t.after(() => browser.close());
    const bought = async () => {
      const page = await browser.newPage();
      await page.goto(dev.url);
      await page.evaluate(() => GamesFun.loot.connect());
      const shop = await page.evaluate(() => GamesFun.loot.call('shop'));
      const r = await page.evaluate(
        l => GamesFun.loot.call('buy', 'sword', { listing: JSON.parse(l) }),
        JSON.stringify(shop.data[0]),
      );
      await page.close();
      return r.data.rpcUrl;
    };
    assert.deepEqual((await http(`${dev.url}api/rpc`)).json, { gamesfun: 'rpc', own: false });
    assert.equal(await bought(), `${dev.origin}/loot/v1/rpc`, 'no XSOLANA_RPC_URL on the server: the relay');
    await writeFile(path.join(dir, '.dev.vars'), 'XSOLANA_RPC_URL=https://devnet.rpc.example.com/?api-key=made-up\n');
    for (let i = 0; i < 50 && !(await http(`${dev.url}api/rpc`)).json?.own; i++)
      await new Promise(r => setTimeout(r, 200));
    assert.deepEqual((await http(`${dev.url}api/rpc`)).json, { gamesfun: 'rpc', own: true });
    assert.equal(await bought(), `${dev.url}api/rpc`, "the game's own api/rpc");
  },
);

test('xcore dev names the address that frames the game as the play page does, in its summary and its --json', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = path.join(tmp.dir, 'g');
  await mkdir(dir);
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>g</title>');
  const started = async args => {
    const child = spawn(process.execPath, [BIN, 'dev', dir, '--port', '0', ...args], {
      env: { ...process.env, GAMESFUN_KIT: '' },
    });
    let out = '';
    child.stdout.on('data', c => (out += c));
    child.stderr.on('data', c => (out += c));
    for (let i = 0; i < 150 && !/is running at|"url"/.test(out); i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 300));
    child.kill('SIGINT');
    await once(child, 'close');
    return out;
  };
  const said = await started([]);
  assert.match(
    said,
    /is running at (http:\/\/\S+)\/game\/ {2}\(Ctrl\+C stops it\)\n {2}as xgames\.fun's play page frames it: http:\/\/\S+\/play\/\n/,
  );
  const json = JSON.parse((await started(['--json'])).match(/^\{[\s\S]*?\n\}$/m)[0]);
  assert.equal(json.play, `${json.origin}/play/`);
});
