// `xcore dev` as xgames.fun's side of a game's own sign-in (lib/dev/signin.mjs): the sign-in client at its address,
// the question a page asks with no click, Sign out that sticks, and the round trip a phone's sign-in makes, with
// gamesfun.js in Chrome on top of them: what a developer sees here is what a player will.
/* global window, GamesFun -- the page's, inside page.evaluate */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { startDev } from '../lib/dev/index.mjs';
import { backHere } from '../lib/dev/signin.mjs';
import { SIGNIN_FILE, SIGNIN_PATH } from '../lib/signin-client.mjs';
import { findChrome, playwrightChromium, ensureBrowser } from '../lib/browser.mjs';
import { ROOT, tempDir } from './helpers.mjs';

const browserHere = findChrome() ?? ((await playwrightChromium()).installed ? true : null);
const noChrome = browserHere ? false : 'no Chrome, Edge or Chromium here';

/** A plain game folder: index.html with gamesfun.js and a Sign in button. */
async function game(dir) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'index.html'),
    `<!doctype html><html><head><script src="./gamesfun.js"></script></head><body>
     <button id="in" onclick="window.signedIn = GamesFun.signIn()">Sign in</button>
     <script>window.changes = []; GamesFun.onChange(p => changes.push(p));</script></body></html>`,
  );
  await writeFile(path.join(dir, 'gamesfun.js'), await readFile(path.join(ROOT, 'lib', 'client', 'gamesfun.js')));
  return dir;
}
/** A port that is free now, so xcore dev can start on it twice (the page's origin stays the same). */
const freePort = () =>
  new Promise(resolve => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
/** A click on Sign in: the tab goes to the dev host's stand-in for X and back, and the game starts again signed in. */
async function tap(page, how = 'click') {
  await page.evaluate(() => {
    window.sameDocument = true;
  });
  await page[how]('#in');
  await page.waitForFunction(() => !window.sameDocument && window.GamesFun && GamesFun.player);
  return page.evaluate(() => GamesFun.player);
}
const http = async (url, init) => {
  const r = await fetch(url, { redirect: 'manual', ...init });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, text, json, headers: r.headers };
};

test("xcore dev answers as xgames.fun's side of sign-in: the client's address, the question, Sign out, the round trip", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(path.join(tmp.dir, 'moth'));
  const dev = await startDev(dir, { port: 0, log: () => {}, env: {} });
  t.after(() => dev.close());

  // the sign-in client, byte for byte the file xgames.fun serves, as a script and never kept without asking
  const client = await http(`${dev.origin}${SIGNIN_PATH}`);
  assert.equal(client.status, 200);
  assert.equal(client.text, await readFile(SIGNIN_FILE, 'utf8'));
  assert.equal(client.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(client.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(client.headers.get('cache-control'), 'no-cache');
  assert.equal((await http(`${dev.origin}${SIGNIN_PATH}`, { method: 'POST' })).status, 405);

  // nobody is signed in until a click (the dev host's own sign-in); then the question answers, for that tab only
  const ask = tab => http(`${dev.origin}/api/player/v1/session?slug=moth&tab=${tab}`);
  assert.deepEqual((await ask('tabaaaaaa1')).json, { player: null });
  for (const named of ['constructor', 'tostring', 'valueof'])
    assert.deepEqual((await ask(named)).json, { player: null }, `a tab named ${named} is nobody`);
  await http(`${dev.origin}/platform/v1/dev/token`, { method: 'POST', body: '{"id":"tabaaaaaa1","name":"Ana"}' });
  const session = (await ask('tabaaaaaa1')).json;
  assert.deepEqual(session.player, { wallet: null, level: 1, x: null, google: null, name: 'Ana', by: 'dev' });
  assert.ok(session.expires > Date.now() + 3500e3);
  const who = await http(`${dev.origin}/platform/v1/me`, { headers: { authorization: `Bearer ${session.token}` } });
  assert.equal(who.json.player.id, 'dev:tabaaaaaa1', 'the same player');
  assert.deepEqual((await ask('tabbbbbbb2')).json, { player: null }, 'another tab is another player');
  assert.deepEqual(
    (await http(`${dev.origin}/api/player/v1/session?slug=other&tab=tabaaaaaa1`)).json,
    { player: null },
    'a page asks for its own game only',
  );

  // Sign out: forgotten, until the next click
  const forget = body =>
    http(`${dev.origin}/api/player/v1/session/forget`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.deepEqual((await forget({ slug: 'other', tab: 'tabaaaaaa1' })).json, { ok: true });
  assert.ok((await ask('tabaaaaaa1')).json.player, "another game's name forgets nothing");
  await forget({ slug: 'moth', tab: 'tabaaaaaa1' });
  assert.deepEqual((await ask('tabaaaaaa1')).json, { player: null });

  // the round trip to X: no X here, so the tab is signed in and sent straight back, to a page of this game only
  const back = `${dev.url}?level=2#top`;
  const begin = await http(
    `${dev.origin}/api/player/v1/x/begin?slug=moth&tab=tabaaaaaa1&back=${encodeURIComponent(back)}`,
  );
  assert.deepEqual([begin.status, begin.headers.get('location')], [302, back]);
  assert.equal((await ask('tabaaaaaa1')).json.player.name, 'Player taba');
  const host = new URL(dev.origin).host;
  for (const elsewhere of ['https://evil.example/game/', `${dev.origin}/platform/v1/me`, 'javascript:alert(1)', ''])
    assert.equal(
      (
        await http(
          `${dev.origin}/api/player/v1/google/begin?slug=moth&tab=tabcccccc3&back=${encodeURIComponent(elsewhere)}`,
        )
      ).status,
      400,
      elsewhere,
    );
  assert.deepEqual((await ask('tabcccccc3')).json, { player: null }, 'and nobody was signed in by it');
  assert.equal(backHere(`http://${host}/game/x`, host).pathname, '/game/x');
  assert.equal(backHere(`http://${host}.evil.example/game/`, host), null);
});

test(
  'gamesfun.js under xcore dev: signed in again with no click after a reload and after xcore dev starts again; Sign out sticks; each tab its own player',
  { skip: noChrome, timeout: 120_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await game(path.join(tmp.dir, 'moth'));
    const port = await freePort();
    let dev = await startDev(dir, { port, filesPort: 0, log: () => {}, env: {} });
    t.after(() => dev.close());
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ executablePath: (await ensureBrowser({})).path });
    t.after(() => browser.close());
    const ctx = await browser.newContext();
    const a = await ctx.newPage(),
      b = await ctx.newPage();
    for (const p of [a, b]) await p.goto(dev.url);
    assert.equal(await a.evaluate(() => GamesFun.ready), null, 'a first visit: nobody');
    await a.waitForFunction(() => GamesFun.signInClient);
    assert.deepEqual(await a.evaluate(() => GamesFun.signInClient), { version: '1.1.0', shared: true });

    // two tabs of one browser: two players, as before (each click goes round the dev host's stand-in for X)
    const ana = await tap(a),
      bo = await tap(b);
    assert.ok(ana.dev && bo.dev && ana.id !== bo.id);

    // a reload: the same player, there when gf.ready answers
    await a.reload();
    assert.equal((await a.evaluate(() => GamesFun.ready)).id, ana.id);
    const before = await a.evaluate(() => GamesFun.token);

    // xcore dev starts again: its tokens are new ones, so the tab's kept token is refused, and the page asks again
    await dev.close();
    dev = await startDev(dir, { port, filesPort: 0, log: () => {}, env: {} });
    await a.reload();
    await a.waitForFunction(was => GamesFun.token && GamesFun.token !== was, before);
    assert.equal(await a.evaluate(() => GamesFun.player.id), ana.id, 'the same player, with a new token');
    assert.equal((await a.evaluate(() => GamesFun.saves.put('main', 1))).error, null, 'a token this dev host takes');

    // Sign out sticks, for that tab: the other tab is another player and stays
    await a.evaluate(() => GamesFun.signOut());
    await a.reload();
    assert.equal(await a.evaluate(() => GamesFun.ready), null);
    await a.waitForTimeout(300);
    assert.equal(await a.evaluate(() => GamesFun.player), null);
    await b.reload();
    await b.waitForFunction(() => GamesFun.player);
    assert.equal(await b.evaluate(() => GamesFun.player.id), bo.id);

    // a click signs in again: the same tab's player
    assert.equal((await tap(a)).id, ana.id);
  },
);

test(
  'gamesfun.js under xcore dev: a sign-in takes the tab away and back, as on the game’s own link, and the game starts again',
  { skip: noChrome, timeout: 120_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await game(path.join(tmp.dir, 'moth'));
    const dev = await startDev(dir, { port: 0, log: () => {}, env: {} });
    t.after(() => dev.close());
    const { chromium, devices } = await import('playwright-core');
    const browser = await chromium.launch({ executablePath: (await ensureBrowser({})).path });
    t.after(() => browser.close());

    // on a computer, what Sign in does: back at the address it left, without its fragment
    const page = await browser.newPage();
    await page.goto(`${dev.url}?level=2#menu`);
    await tap(page);
    assert.deepEqual([new URL(page.url()).search, new URL(page.url()).hash], ['?level=2', ''], 'back at the address');
    assert.equal((await page.evaluate(() => GamesFun.ready)).id, await page.evaluate(() => GamesFun.player.id));
    assert.equal(await page.evaluate(() => GamesFun.signInEnded), null);

    // and on a phone
    const phone = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
    await phone.goto(dev.url);
    assert.ok((await tap(phone, 'tap')).id.startsWith('dev:'));
    // and a game that must not start again stays, signed in by the dev host with no window
    await phone.evaluate(() => GamesFun.signOut());
    await phone.evaluate(() => {
      window.sameDocument = true;
      window.signedIn = GamesFun.signIn({ stay: true });
    });
    assert.ok((await phone.evaluate(() => window.signedIn)).id.startsWith('dev:'));
    assert.equal(await phone.evaluate(() => window.sameDocument), true, 'the page was not left');
  },
);
