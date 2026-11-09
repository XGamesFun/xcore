// gamesfun.js (lib/client/gamesfun.js) in real Chrome, against a stand-in xgames.fun: the game on its own link (a
// sign-in request answered on xgames.fun, by window or by code), inside xgames.fun's play page (the page above hands it
// a token), inside a post on X (a frame nobody answers), and on this machine (a local player). Chrome resolves
// *.xgames.test to this machine, so the page sits at <slug>-play.<site> as a published game does.
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
<button id="in" onclick="window.signedIn = GamesFun.signIn()">Sign in</button>
<script>window.codes = []; GamesFun.onCode(c => codes.push(c)); window.changes = []; GamesFun.onChange(p => changes.push(p));</script>
</body></html>`;

/** xgames.fun, in miniature: the play host's sign-in request, the platform's page calls, a game server's api/db. */
function standIn() {
  const s = { requests: [], approved: false, saves: {}, boards: {}, docs: [], seen: [], queries: [] };
  const players = { 'tok-own': 'x:42', 'tok-page': 'x:43' };
  const server = createServer(async (req, res) => {
    const host = String(req.headers.host).split(':')[0];
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
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    const who = players[token];
    s.seen.push(`${req.method} ${host}${url.pathname}${token ? ` (${token})` : ''}`);
    if (host === 'xgames.test') {
      // the Studio: the sign-in window's page, and the play page that frames the game
      const port = req.headers.host.split(':')[1];
      if (url.pathname.startsWith('/go')) return send(200, '<p>sign in here</p>', 'text/html');
      if (url.pathname === '/play/moth')
        return send(
          200,
          `<iframe id="g" src="http://moth-play.xgames.test:${port}/"></iframe><script>
          window.asked = [];
          addEventListener('message', e => {
            if (e.data?.type === 'gf:host-ready') e.source.postMessage({ type: 'gf:host', v: 1, auth: true }, '*');
            if (e.data?.type === 'gf:auth-signin') { asked.push(e.data);
              e.source.postMessage({ type: 'gf:auth', v: 1, level: 3, wallet: '', x: { handle: 'page_fan' }, token: 'tok-page', expires: Date.now() + 3600e3, status: 'signed-in' }, '*'); }
          });</script>`,
          'text/html',
        );
      if (url.pathname === '/xpost')
        return send(200, `<iframe id="g" src="http://moth-play.xgames.test:${port}/"></iframe>`, 'text/html');
      return send(404, {});
    }
    // a site of the creator's own that embeds the game (xcore embed), and tries to hand it a sign-in: it may not
    if (host === 'evil.test' && url.pathname === '/frame') {
      const port = req.headers.host.split(':')[1];
      return send(
        200,
        `<iframe id="g" src="http://moth-play.xgames.test:${port}/"></iframe><script>
        addEventListener('message', e => {
          if (e.data?.type === 'gf:host-ready') {
            e.source.postMessage({ type: 'gf:host', v: 1, auth: true }, '*');
            e.source.postMessage({ type: 'gf:auth', v: 1, level: 3, wallet: '', x: { handle: 'evil' }, token: 'tok-page', expires: Date.now() + 3600e3, status: 'signed-in' }, '*');
          }
        });</script>`,
        'text/html',
      );
    }
    // the play edge says which game a host is (a custom domain: play.mygame.test; the edge answers this itself)
    if (url.pathname === '/platform/v1/site') {
      const port = req.headers.host.split(':')[1];
      if (host === 'play.mygame.test' || host === 'moth-play.xgames.test')
        return send(200, {
          gamesfun: 'site',
          slug: 'moth',
          site: `http://xgames.test:${port}`,
          origin: `http://${req.headers.host}`,
        });
      return send(404, { ok: false, why: 'not a game host' });
    }
    // the game's own origin (moth-play.xgames.test, or its domain play.mygame.test), or this machine (127.0.0.1)
    if (url.pathname === '/') return send(200, GAME, 'text/html');
    if (url.pathname === '/gamesfun.js') return send(200, CLIENT, 'text/javascript');
    if (url.pathname === '/player/v1/request') {
      s.requests.push(body);
      const port = req.headers.host.split(':')[1];
      return send(200, {
        id: 'r1',
        secret: 's1',
        code: 'ABCD-EFGH',
        expires: Date.now() + 900e3,
        url: `http://xgames.test:${port}/go/ABCD-EFGH`,
        site: `xgames.test:${port}`,
      });
    }
    if (url.pathname === '/player/v1/request/status') {
      if (body.id !== 'r1' || body.secret !== 's1') return send(200, { state: 'expired' });
      if (!s.approved) return send(200, { state: 'waiting' });
      return send(200, {
        state: 'signed-in',
        player: { wallet: '', level: 3, x: { id: '42', handle: 'own_fan' }, by: 'x' },
        token: 'tok-own',
        expires: Date.now() + 3600e3,
      });
    }
    if (url.pathname === '/platform/v1/me')
      return who
        ? send(200, {
            ok: true,
            player: { id: who, name: '@fan', level: 3, wallet: '', x: { handle: 'fan' }, dev: false },
          })
        : send(401, { ok: false, code: 'bad', why: 'Sign in first: No token.' });
    const save = /^\/platform\/v1\/saves\/([\w-]+)$/.exec(url.pathname);
    if (save) {
      if (!who) return send(401, { ok: false, code: 'bad', why: 'Sign in first.' });
      if (req.method === 'PUT') {
        s.saves[`${who}/${save[1]}`] = body.value;
        return send(200, { ok: true, bytes: JSON.stringify(body.value).length });
      }
      const v = s.saves[`${who}/${save[1]}`];
      return v === undefined
        ? send(404, { ok: false, code: 'unknown', why: 'No such save.' })
        : send(200, { ok: true, value: v });
    }
    const board = /^\/platform\/v1\/scores\/([\w-]+)$/.exec(url.pathname);
    if (board && req.method === 'POST') {
      (s.boards[board[1]] ??= []).push({ player: who, score: body.score });
      return send(200, { ok: true, improved: true, best: body.score, rank: 1 });
    }
    if (board)
      return send(200, {
        ok: true,
        order: 'high',
        entries: (s.boards[board[1]] ?? []).map((e, i) => ({ rank: i + 1, ...e })),
      });
    if (url.pathname === '/api/db/levels' && req.method === 'POST') {
      if (!who) return send(401, { ok: false, code: 'player', why: 'Sign in first.' });
      const item = { id: `d${s.docs.length + 1}`, owner: who, value: body.value, updatedAt: 1 };
      s.docs.push(item);
      return send(200, { ok: true, item });
    }
    if (url.pathname === '/api/db/levels') {
      s.queries.push(url.search);
      const first = !url.searchParams.get('after');
      return send(200, { ok: true, items: first ? s.docs : [], more: first, after: first ? 'page2' : null });
    }
    const doc = /^\/api\/db\/levels\/([^/]+)$/.exec(url.pathname);
    if (doc && req.method === 'GET') {
      s.queries.push(url.search);
      const item = s.docs.find(d => d.id === doc[1] && d.owner === (url.searchParams.get('owner') ?? who));
      // by id alone, another player's document: the database says to name its owner
      if (!item && !url.searchParams.has('owner') && s.docs.some(d => d.id === doc[1]))
        return send(400, { ok: false, code: 'owner', why: `levels/${doc[1]} is not in your own space: name {owner}.` });
      return item ? send(200, { ok: true, item }) : send(404, { ok: false, code: 'unknown', why: 'No such document.' });
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
    args: [
      '--host-resolver-rules=MAP *.xgames.test 127.0.0.1, MAP xgames.test 127.0.0.1, MAP *.mygame.test 127.0.0.1, MAP evil.test 127.0.0.1',
    ],
  });
}

test(
  'on its own link: a window on xgames.fun signs the player in, then saves, scores and the database go signed in',
  { skip, timeout: 60_000 },
  async t => {
    const g = await standIn();
    t.after(g.close);
    const browser = await chrome();
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`http://moth-play.xgames.test:${g.port}/`);
    assert.equal(await page.evaluate(() => GamesFun.slug), 'moth');
    assert.equal(await page.evaluate(() => GamesFun.local), false);
    assert.equal(await page.evaluate(() => GamesFun.ready), null, 'nobody signed in yet');
    const popup = page.waitForEvent('popup');
    await page.click('#in');
    const win = await popup;
    await win.waitForURL(/\/go\/ABCD-EFGH\?with=x$/);
    assert.deepEqual(g.s.requests, [{ slug: 'moth', with: 'x' }]);
    const code = await page.evaluate(() => codes[0]);
    assert.equal(code.code, 'ABCD-EFGH');
    assert.equal(code.window, true);
    g.s.approved = true; // the player signed in on xgames.fun
    const player = await page.evaluate(() => window.signedIn);
    assert.equal(player.id, 'x:42', "the platform's id for the player");
    assert.equal(await page.evaluate(() => GamesFun.token), 'tok-own');
    assert.ok(win.isClosed(), 'the window closes once signed in');

    assert.equal((await page.evaluate(() => GamesFun.saves.put('main', { level: 3 }))).error, null);
    assert.deepEqual((await page.evaluate(() => GamesFun.saves.get('main'))).data, { level: 3 });
    assert.deepEqual(await page.evaluate(() => GamesFun.saves.get('none')), { data: null, error: null, status: 404 });
    assert.equal((await page.evaluate(() => GamesFun.scores.submit('best', 1200))).data.best, 1200);
    assert.equal((await page.evaluate(() => GamesFun.scores.top('best'))).data[0].score, 1200);
    assert.equal((await page.evaluate(() => GamesFun.db.add('levels', { name: 'Moon' }))).data.owner, 'x:42');
    const first = await page.evaluate(() => GamesFun.db.list('levels'));
    assert.deepEqual([first.data.length, first.after, first.more], [1, 'page2', true], "the next page's place");
    const second = await page.evaluate(() => GamesFun.db.list('levels', { after: 'page2', limit: 10 }));
    assert.deepEqual([second.data, second.after, second.more], [[], null, false]);
    assert.equal(
      (await page.evaluate(() => GamesFun.db.get('levels', 'd1', { owner: 'x:42' }))).data.value.name,
      'Moon',
    );
    assert.equal((await page.evaluate(() => GamesFun.db.get('levels', 'd1', { owner: 'x:7' }))).data, null);
    assert.deepEqual(g.s.queries, ['', '?limit=10&after=page2', '?owner=x%3A42', '?owner=x%3A7']);
    // offset is gone: refused before anything is sent, so a loop that paged with it stops
    const offset = await page.evaluate(() => GamesFun.db.list('levels', { offset: 50 }));
    assert.deepEqual([offset.data, offset.code, offset.status], [null, 'offset', 0]);
    assert.match(offset.error, /no offset any more: pass the last answer's after/);
    assert.equal(g.s.queries.length, 4, 'not sent');
    // another player's document by id alone: null as a missing one, its why kept and said once in the console
    g.s.docs.push({ id: 'd9', owner: 'x:7', value: { name: 'Theirs' }, updatedAt: 1 });
    const warned = [];
    page.on('console', m => m.type() === 'warning' && warned.push(m.text()));
    const theirs = await page.evaluate(() => GamesFun.db.get('levels', 'd9'));
    assert.deepEqual([theirs.data, theirs.error, theirs.status, theirs.code], [null, null, 404, 'owner']);
    assert.match(theirs.why, /name \{owner\}/);
    await page.evaluate(() => GamesFun.db.get('levels', 'd9'));
    await page.waitForTimeout(100);
    assert.equal(warned.filter(w => /gf\.db\.get: levels\/d9 is not in your own space/.test(w)).length, 1);
    assert.equal((await page.evaluate(() => GamesFun.saves.get('bad key!'))).status, 0);
    assert.ok(g.s.seen.includes('PUT moth-play.xgames.test/platform/v1/saves/main (tok-own)'), g.s.seen.join('\n'));
    await page.evaluate(() => GamesFun.signOut());
    assert.equal(
      (await page.evaluate(() => GamesFun.saves.get('main'))).status,
      401,
      'signed out: refused here, not sent',
    );
    assert.equal(await page.evaluate(() => changes.at(-1)), null);
  },
);

test(
  'with no window (blocked, or a phone): the code to type at <site>/go is said, and the sign-in still lands',
  { skip, timeout: 60_000 },
  async t => {
    const g = await standIn();
    t.after(g.close);
    const browser = await chrome();
    t.after(() => browser.close());
    const page = await browser.newPage();
    // the browser blocks the window (a phone's app browser, a blocker): window.open answers null
    await page.addInitScript(() => {
      window.open = () => null;
    });
    await page.goto(`http://moth-play.xgames.test:${g.port}/`);
    await page.evaluate(() => {
      window.signedIn = GamesFun.signIn();
    });
    await page.waitForFunction(() => codes.length > 0);
    const code = await page.evaluate(() => codes[0]);
    assert.equal(code.window, false);
    assert.equal(code.site, `xgames.test:${g.port}`);
    g.s.approved = true;
    assert.equal((await page.evaluate(() => window.signedIn)).id, 'x:42');
  },
);

test(
  "inside xgames.fun's play page: the page above signs the player in and hands over its token",
  { skip, timeout: 60_000 },
  async t => {
    const g = await standIn();
    t.after(g.close);
    const browser = await chrome();
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`http://xgames.test:${g.port}/play/moth`);
    const frame = await (await page.waitForSelector('#g')).contentFrame();
    await frame.waitForFunction(() => window.GamesFun);
    const player = await frame.evaluate(async () => {
      await GamesFun.ready;
      return GamesFun.signIn();
    });
    assert.equal(player.id, 'x:43');
    assert.deepEqual(await page.evaluate(() => window.asked), [{ type: 'gf:auth-signin', with: 'x' }]);
    assert.equal(g.s.requests.length, 0, 'no request of its own');
    assert.equal((await frame.evaluate(() => GamesFun.saves.put('main', 1))).error, null);
    assert.ok(g.s.seen.includes('PUT moth-play.xgames.test/platform/v1/saves/main (tok-page)'));
  },
);

test(
  'on its own domain (play.mygame.test): the edge says which game and where xgames.fun is; sign-in goes there',
  { skip, timeout: 60_000 },
  async t => {
    const g = await standIn();
    t.after(g.close);
    const browser = await chrome();
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`http://play.mygame.test:${g.port}/`);
    assert.equal(await page.evaluate(() => GamesFun.ready), null);
    assert.equal(await page.evaluate(() => GamesFun.slug), 'moth', 'from /platform/v1/site');
    assert.ok(g.s.seen.includes('GET play.mygame.test/platform/v1/site'), g.s.seen.join('\n'));
    const popup = page.waitForEvent('popup');
    await page.click('#in');
    const win = await popup;
    // xgames.fun's own sign-in page, not mygame.test's (a host starting with play. is not xgames.fun's play host here)
    await win.waitForURL(new RegExp(`^http://xgames\\.test:${g.port}/go/ABCD-EFGH\\?with=x$`));
    assert.deepEqual(g.s.requests, [{ slug: 'moth', with: 'x' }]);
    g.s.approved = true;
    assert.equal((await page.evaluate(() => window.signedIn)).id, 'x:42');
    assert.ok(g.s.seen.includes('GET play.mygame.test/platform/v1/me (tok-own)'), 'the platform on its own domain');

    // a game's own link asks nothing: the host says the slug
    const own = await browser.newPage();
    await own.goto(`http://moth-play.xgames.test:${g.port}/`);
    await own.evaluate(() => GamesFun.ready);
    assert.ok(!g.s.seen.includes('GET moth-play.xgames.test/platform/v1/site'));
  },
);

test(
  'embedded on another site: a sign-in that site hands over is ignored, and the game signs in by itself',
  { skip, timeout: 60_000 },
  async t => {
    const g = await standIn();
    t.after(g.close);
    const browser = await chrome();
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`http://evil.test:${g.port}/frame`);
    const frame = await (await page.waitForSelector('#g')).contentFrame();
    await frame.waitForFunction(() => window.GamesFun);
    await frame.evaluate(() => GamesFun.ready);
    await frame.waitForTimeout(1500);
    assert.equal(await frame.evaluate(() => GamesFun.token), '', "evil.test's token was not taken");
    assert.equal(await frame.evaluate(() => GamesFun.player), null);
    await frame.evaluate(() => {
      window.signedIn = GamesFun.signIn();
    });
    await frame.waitForFunction(() => codes.length > 0);
    assert.deepEqual(g.s.requests, [{ slug: 'moth', with: 'x' }], 'its own request on xgames.fun, not the page above');
    g.s.approved = true;
    assert.equal((await frame.evaluate(() => window.signedIn)).id, 'x:42');
  },
);

test('inside a post on X (a frame no page answers): it signs in by itself', { skip, timeout: 60_000 }, async t => {
  const g = await standIn();
  t.after(g.close);
  const browser = await chrome();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://xgames.test:${g.port}/xpost`);
  const frame = await (await page.waitForSelector('#g')).contentFrame();
  await frame.waitForFunction(() => window.GamesFun);
  await frame.evaluate(async () => {
    await GamesFun.ready;
    window.signedIn = GamesFun.signIn();
  });
  await frame.waitForFunction(() => codes.length > 0);
  g.s.approved = true;
  assert.equal((await frame.evaluate(() => window.signedIn)).id, 'x:42');
  assert.deepEqual(g.s.requests, [{ slug: 'moth', with: 'x' }]);
});

test(
  'on this machine: a local player, and saves, scores and the database in the browser',
  { skip, timeout: 60_000 },
  async t => {
    const g = await standIn();
    t.after(g.close);
    const browser = await chrome();
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${g.port}/`);
    const r = await page.evaluate(async () => {
      const gf = GamesFun;
      const before = await gf.ready;
      const player = await gf.signIn();
      await gf.saves.put('main', { level: 2 });
      await gf.scores.submit('best', 50);
      await gf.scores.submit('best', 40);
      const doc = (await gf.db.add('levels', { name: 'Moon' })).data;
      const other = await gf.db.put('levels', doc.id, { name: 'Moon 2' });
      for (let i = 0; i < 4; i++) await gf.db.put('runs', 'r' + i, i);
      const p1 = await gf.db.list('runs', { limit: 3 });
      const p2 = await gf.db.list('runs', { limit: 3, after: p1.after });
      await gf.db.put('runs', 'x', 1);
      const offset = await gf.db.list('runs', { offset: 3 });
      return {
        offset: [offset.data, offset.code],
        local: gf.local,
        before,
        player,
        save: (await gf.saves.get('main')).data,
        saves: (await gf.saves.list()).data,
        top: (await gf.scores.top('best')).data.map(e => e.score),
        mine: (await gf.scores.mine('best')).data.score,
        docs: (await gf.db.list('levels')).data.map(d => d.value.name),
        other: other.data.value.name,
        runs: [
          p1.data.length,
          p2.data.length,
          !!p1.after,
          p2.after,
          new Set(p1.data.concat(p2.data).map(d => d.id)).size,
        ],
        theServers: (await gf.db.get('runs', 'x', { owner: 'server' })).data,
      };
    });
    assert.deepEqual(r, {
      local: true,
      before: null,
      player: { id: 'local:player', name: 'Local player', level: 1, wallet: '', x: null, local: true },
      save: { level: 2 },
      saves: [{ key: 'main' }],
      top: [50],
      mine: 50,
      docs: ['Moon 2'],
      other: 'Moon 2',
      runs: [3, 1, true, null, 4],
      theServers: null,
      offset: [null, 'offset'],
    });
    await page.reload();
    assert.equal((await page.evaluate(() => GamesFun.ready)).id, 'local:player', 'still signed in after a reload');
    assert.ok(!g.s.seen.some(x => /platform|player\/v1|api\//.test(x)), 'nothing sent anywhere');
  },
);

test(
  "Unity's plugin (GamesFun.jslib as xcore add signin writes it): its calls answer GamesFun.cs by SendMessage",
  { skip, timeout: 60_000 },
  async t => {
    const { mkdir, writeFile, readFile } = await import('node:fs/promises');
    const { addSignin } = await import('../lib/add.mjs');
    const { tempDir } = await import('./helpers.mjs');
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    await mkdir(path.join(tmp.dir, 'ProjectSettings'), { recursive: true });
    await mkdir(path.join(tmp.dir, 'Assets'));
    await writeFile(path.join(tmp.dir, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.0.30f1\n');
    await addSignin(tmp.dir);
    const jslib = await readFile(path.join(tmp.dir, 'Assets/Plugins/GamesFun/GamesFun.jslib'), 'utf8');
    const g = await standIn();
    t.after(g.close);
    const browser = await chrome();
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${g.port}/`);
    // Unity's build: a page without gamesfun.js loaded; mergeInto, UTF8ToString (a pointer stands in as the string) and SendMessage
    await page.evaluate(() => delete window.GamesFun);
    await page.addScriptTag({
      content: `var LibraryManager = { library: {} }; function mergeInto(lib, o) { Object.assign(lib, o); }
      function UTF8ToString(s) { return s; } window.sent = []; function SendMessage(o, m, v) { sent.push([o, m, v]); }
      ${jslib}`,
    });
    const sent = await page.evaluate(async () => {
      const L = LibraryManager.library;
      L.GamesFunInit('GamesFun');
      L.GamesFunCall(1, 'signIn', '[{"how":"x"}]');
      await new Promise(r => setTimeout(r, 100));
      L.GamesFunCall(2, 'saves.put', '["main",{"level":3}]');
      await new Promise(r => setTimeout(r, 50));
      L.GamesFunCall(3, 'saves.get', '["main"]');
      L.GamesFunCall(4, 'nope.nothing', '[]');
      L.GamesFunCall(5, 'saves.get', 'not json');
      await new Promise(r => setTimeout(r, 100));
      return sent;
    });
    const results = Object.fromEntries(
      sent
        .filter(s => s[1] === 'OnGamesFunResult')
        .map(s => [s[2].split('|')[0], JSON.parse(s[2].slice(s[2].indexOf('|') + 1))]),
    );
    assert.equal(results[1].id, 'local:player');
    assert.deepEqual(results[2].error, null);
    assert.deepEqual(results[3].data, { level: 3 });
    assert.match(results[4].error, /no such call: nope\.nothing/);
    assert.match(results[5].error, /not JSON/);
    assert.ok(sent.every(s => s[0] === 'GamesFun'));
    assert.ok(
      sent.some(s => s[1] === 'OnGamesFunPlayer' && JSON.parse(s[2])?.id === 'local:player'),
      'the player is said too',
    );
  },
);

test(
  'rooms on this machine: two tabs share one, messages and bytes go between them, and the host passes on',
  { skip, timeout: 60_000 },
  async t => {
    const g = await standIn();
    t.after(g.close);
    const browser = await chrome();
    t.after(() => browser.close());
    const ctx = await browser.newContext();
    const [a, b] = [await ctx.newPage(), await ctx.newPage()];
    for (const p of [a, b]) await p.goto(`http://127.0.0.1:${g.port}/?room=k7mxq2`);
    const joinIn = page =>
      page.evaluate(async () => {
        window.log = [];
        const code = GamesFun.rooms.fromLink();
        const { data: room } = await GamesFun.rooms.join(code, { name: 'p' });
        window.room = room;
        for (const ev of ['message', 'join', 'leave', 'host'])
          room.on(ev, (x, y) =>
            log.push([
              ev,
              ev === 'message' ? [x === 1 ? 'host' : 'other', y] : ev === 'host' ? x === room.id : x.id ? 'someone' : x,
            ]),
          );
        room.on('bytes', (from, u8) => log.push(['bytes', [...u8]]));
        return { code, id: room.id, host: room.host, isHost: room.isHost, local: room.local };
      });
    const first = await joinIn(a);
    assert.deepEqual(first, { code: 'K7MXQ2', id: 1, host: 1, isHost: true, local: true });
    const second = await joinIn(b);
    assert.ok(second.id > 1 && !second.isHost && second.host === 1);
    await a.waitForFunction(() => log.some(e => e[0] === 'join'));
    await b.evaluate(() => room.send({ hi: 'host' }, 1));
    await b.evaluate(() => room.sendBytes(new Uint8Array([1, 2, 3]), 0));
    await a.waitForFunction(() => log.some(e => e[0] === 'bytes'));
    const seen = await a.evaluate(() => log);
    assert.deepEqual(
      seen.find(e => e[0] === 'message'),
      ['message', ['other', { hi: 'host' }]],
    );
    assert.deepEqual(
      seen.find(e => e[0] === 'bytes'),
      ['bytes', [1, 2, 3]],
    );
    await a.evaluate(() => room.leave());
    await b.waitForFunction(() => log.some(e => e[0] === 'host'));
    assert.equal(await b.evaluate(() => room.isHost), true, 'the player left is the host now');
    assert.equal(await b.evaluate(() => GamesFun.rooms.link('k7mxq2')), `http://127.0.0.1:${g.port}/?room=K7MXQ2`);
    assert.equal(
      (await b.evaluate(() => GamesFun.rooms.join('no!'))).error,
      'A room code is 4 to 8 letters and digits.',
    );
    assert.match(await b.evaluate(() => GamesFun.rooms.code()), /^[A-HJ-NP-Z2-9]{6}$/);
  },
);

test(
  "Unity's room calls (GamesFunRoomJoin and the rest): the welcome, then each event, to GamesFun.cs",
  { skip, timeout: 60_000 },
  async t => {
    const { mkdir, writeFile, readFile } = await import('node:fs/promises');
    const { addSignin } = await import('../lib/add.mjs');
    const { tempDir } = await import('./helpers.mjs');
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    await mkdir(path.join(tmp.dir, 'ProjectSettings'), { recursive: true });
    await mkdir(path.join(tmp.dir, 'Assets'));
    await writeFile(path.join(tmp.dir, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.0.30f1\n');
    await addSignin(tmp.dir);
    const jslib = await readFile(path.join(tmp.dir, 'Assets/Plugins/GamesFun/GamesFun.jslib'), 'utf8');
    const g = await standIn();
    t.after(g.close);
    const browser = await chrome();
    t.after(() => browser.close());
    const ctx = await browser.newContext();
    const [unity, other] = [await ctx.newPage(), await ctx.newPage()];
    await unity.goto(`http://127.0.0.1:${g.port}/`);
    await other.goto(`http://127.0.0.1:${g.port}/`);
    await unity.evaluate(() => delete window.GamesFun);
    await unity.addScriptTag({
      content: `var LibraryManager = { library: {} }; function mergeInto(lib, o) { Object.assign(lib, o); }
      function UTF8ToString(s) { return s; } window.sent = []; function SendMessage(o, m, v) { sent.push([o, m, v]); }
      ${jslib}`,
    });
    await unity.evaluate(() => {
      LibraryManager.library.GamesFunInit('GamesFun');
      LibraryManager.library.GamesFunRoomJoin(7, 'ROOM42', '{"name":"unity"}');
    });
    await unity.waitForFunction(() => sent.some(s => s[1] === 'OnGamesFunResult'));
    const welcome = await unity.evaluate(() =>
      JSON.parse(sent.find(s => s[1] === 'OnGamesFunResult')[2].split('|')[1]),
    );
    assert.equal(welcome.id, 1);
    assert.equal(welcome.peers, '[]', 'the peers as JSON text, for JsonUtility');
    await other.evaluate(async () => {
      window.room = (await GamesFun.rooms.join('ROOM42')).data;
      room.send({ move: [1, 2] }, 1);
      room.sendBytes(new Uint8Array([9, 9]), 1);
    });
    await unity.waitForFunction(() => sent.filter(s => s[1] === 'OnGamesFunRoom').length >= 3);
    const events = await unity.evaluate(() => sent.filter(s => s[1] === 'OnGamesFunRoom').map(s => JSON.parse(s[2])));
    assert.deepEqual(
      events.map(e => e.t),
      ['join', 'message', 'bytes'],
    );
    assert.equal(events[1].data, '{"move":[1,2]}');
    assert.equal(events[2].data, 'CQk=', 'bytes as base64, for Convert.FromBase64String');
    assert.ok(events.every(e => e.h === welcome.handle));
    await other.evaluate(() => room.on('message', (from, d) => (window.got = [from, d])));
    await unity.evaluate(h => LibraryManager.library.GamesFunRoomSend(h, 0, '{"state":"go"}'), welcome.handle);
    await other.waitForFunction(() => window.got);
    assert.deepEqual(await other.evaluate(() => window.got), [1, { state: 'go' }]);
  },
);

test('a room online sends a frame of messages as one, and reads a batch back as one event each', async t => {
  const g = await standIn();
  t.after(g.close);
  const browser = await chrome();
  t.after(() => browser.close());
  const page = await browser.newPage();
  // a stand-in socket: what the page sends is kept, and the room's welcome answers its hello
  await page.addInitScript(() => {
    window.WebSocket = class {
      constructor(url) {
        this.url = url;
        this.sent = [];
        this.readyState = 0;
        window.ws = this;
        setTimeout(() => ((this.readyState = 1), this.onopen()));
      }
      send(m) {
        if (typeof m === 'string' && m.includes('"hello"'))
          return setTimeout(() =>
            this.onmessage({ data: JSON.stringify({ t: 'welcome', id: 1, host: 1, code: 'ROOM42', peers: [] }) }),
          );
        this.sent.push(typeof m === 'string' ? JSON.parse(m) : [...new Uint8Array(m)]);
      }
      close() {}
    };
  });
  await page.goto(`http://moth-play.xgames.test:${g.port}/`);
  const sent = await page.evaluate(async () => {
    window.room = (await GamesFun.rooms.join('ROOM42')).data;
    for (let i = 0; i < 30; i++) room.sendBytes(new Uint8Array([i]), 0);
    room.send({ a: 1 }, 2);
    room.send({ b: 2 });
    await new Promise(r => setTimeout(r, 50));
    return window.ws.sent.splice(0);
  });
  assert.equal(sent.length, 2, 'thirty packets and two messages: two sends, in order');
  const head = new DataView(new Uint8Array(sent[0]).buffer);
  assert.equal(head.getInt32(0, true), -2147483648);
  assert.equal(sent[0].length, 4 + 30 * 9);
  assert.deepEqual(sent[0].slice(4, 13), [0, 0, 0, 0, 1, 0, 0, 0, 0], 'to 0, 1 byte, 0');
  assert.deepEqual(sent[1], {
    t: 'msgs',
    m: [
      { to: 2, d: { a: 1 } },
      { to: 0, d: { b: 2 } },
    ],
  });
  // sends in the next few milliseconds wait for the same message (about 60 a second, whatever the screen's rate)
  const later = await page.evaluate(async () => {
    room.sendBytes(new Uint8Array([1]), 0);
    await null;
    room.sendBytes(new Uint8Array([2]), 0);
    await null;
    room.sendBytes(new Uint8Array([3]), 0);
    await new Promise(r => setTimeout(r, 60));
    return window.ws.sent.splice(0).map(m => m.length);
  });
  assert.deepEqual(later, [5, 4 + 2 * 9]);
  const got = await page.evaluate(() => {
    const out = [];
    room.on('bytes', (from, u8) => out.push([from, [...u8]]));
    room.on('message', (from, d) => out.push([from, d]));
    const b = new Uint8Array(4 + 9 + 10);
    const v = new DataView(b.buffer);
    v.setInt32(0, -2147483648, true);
    v.setInt32(4, 5, true);
    v.setUint32(8, 1, true);
    b[12] = 7;
    v.setInt32(13, 6, true);
    v.setUint32(17, 2, true);
    b.set([8, 9], 21);
    window.ws.onmessage({ data: b.buffer });
    window.ws.onmessage({ data: JSON.stringify({ t: 'msgs', from: 5, d: [1, { z: 2 }] }) });
    return out;
  });
  assert.deepEqual(got, [
    [5, [7]],
    [6, [8, 9]],
    [5, 1],
    [5, { z: 2 }],
  ]);
});
