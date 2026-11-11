// gamesfun.js's own sign-in in real Chrome, against a stand-in xgames.fun that remembers a browser by a cookie, as
// xgames.fun does: a returning player signed in with no click (as the page loads, after a reload, before the token's
// hour ends), the token kept for the tab, Sign out that sticks, the panel where no window opens, and the sign-in
// client xgames.fun serves at one address on the game's own host. And what a hostile page gets of each: nothing.
// Chrome resolves *.xgames.test to this machine, so the game sits at <slug>-play.<site> as a published game does:
// another origin than the site's, on the same site, which is what the cookie's rules turn on.
// functions handed to Chrome run in the page: its window, GamesFun and what the page keeps
/* global window, document, location, PageTransitionEvent, GamesFun, codes, changes */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { findChrome, playwrightChromium, ensureBrowser } from '../lib/browser.mjs';
import { SIGNIN_FILE, SIGNIN_PATH } from '../lib/signin-client.mjs';
import { ROOT } from './helpers.mjs';

const browserHere = findChrome() ?? ((await playwrightChromium()).installed ? true : null);
const skip = browserHere ? false : 'no Chrome, Edge or Chromium here';
const CLIENT = readFileSync(path.join(ROOT, 'lib', 'client', 'gamesfun.js'), 'utf8');
const SHARED = readFileSync(SIGNIN_FILE, 'utf8');

const GAME = `<!doctype html><html><head><script src="./gamesfun.js"></script></head><body>
<button id="in" onclick="window.signedIn = GamesFun.signIn()">Sign in</button>
<script>window.codes = []; GamesFun.onCode(c => codes.push(c)); window.changes = []; GamesFun.onChange(p => changes.push(p));
GamesFun.ready.then(() => { window.readyAt = performance.now(); window.clientAtReady = GamesFun.signInClient ?? null; });
if (location.search === '?auto') setTimeout(() => GamesFun.signIn({ how: 'google' }), 300);</script>
</body></html>`;
// the same game with no inline script, for a page whose policy takes scripts from its own origin only
const STRICT = `<!doctype html><html><head><script src="./gamesfun.js"></script><script src="./game.js"></script></head><body>
<button id="in">Sign in</button></body></html>`;
const STRICT_JS = `window.codes = []; GamesFun.onCode(c => codes.push(c)); window.changes = []; GamesFun.onChange(p => changes.push(p));
window.blocked = []; document.addEventListener('securitypolicyviolation', e => blocked.push(e.violatedDirective + ' ' + e.blockedURI));
document.addEventListener('DOMContentLoaded', () => { document.getElementById('in').onclick = () => { window.signedIn = GamesFun.signIn(); }; });`;

/**
 * xgames.fun in miniature. The site (xgames.test) remembers a browser by the cookie gf_player (HttpOnly, SameSite=Lax)
 * and answers the question a game's page asks with no click, GET /api/player/v1/session?slug=, only to that game's own
 * host (CORS for that origin, with credentials) and only for a game the player signed in to by a click (`clicked`) and
 * did not sign out of (POST …/session/forget). The game's host answers the sign-in request, the platform's /me, and
 * the sign-in client's address (`shared`: 'real', 'none', or the text to serve; `sharedType`, `sharedWait`).
 */
function standIn({ shared = 'real', sharedType = 'text/javascript', sharedWait = 0, csp = false, ttl = 3600e3 } = {}) {
  const s = {
    requests: [],
    status: [],
    sessions: [],
    forgets: [],
    seen: [],
    approved: false,
    clicked: new Set(),
    valid: new Set(['tok-own']),
    issued: 0,
    ttl,
    forgetStatus: 200,
    begins: [],
    x: 'yes',
  };
  const server = createServer(async (req, res) => {
    const host = String(req.headers.host).split(':')[0],
      port = String(req.headers.host).split(':')[1];
    const url = new URL(req.url, 'http://x');
    const raw = await new Promise(r => {
      let b = '';
      req.on('data', c => (b += c));
      req.on('end', () => r(b));
    });
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {}
    const send = (status, data, type = 'application/json', headers = {}) => {
      res.writeHead(status, { 'content-type': type, ...headers });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    s.seen.push(`${req.method} ${host}${url.pathname}`);
    const origin = req.headers.origin ?? '';
    const cookie = /(?:^|;\s*)gf_player=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? null;
    if (host === 'xgames.test' || host === 'localhost') {
      // the site: its sign-in page, and what it says to a game's page
      const slug = url.pathname === '/api/player/v1/session' ? (url.searchParams.get('slug') ?? '') : (body.slug ?? '');
      // only the game's own host may ask, and only for itself (a preflight names no game: any game's host passes it)
      const own = origin === `http://${slug}-play.xgames.test:${port}`;
      const asks = req.method === 'OPTIONS' ? /^http:\/\/[a-z]+-play\.xgames\.test:\d+$/.test(origin) : own;
      const cors = asks
        ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' }
        : {};
      if (url.pathname === '/api/player/v1/session' && req.method === 'GET') {
        s.sessions.push({ origin, cookie, slug });
        if (!own || !cookie || !s.clicked.has(slug)) return send(200, { player: null }, 'application/json', cors);
        const t = `tok-s${++s.issued}`;
        s.valid.add(t);
        return send(
          200,
          {
            player: {
              wallet: null,
              level: 3,
              x: { id: '42', handle: 'own_fan' },
              google: null,
              name: 'own_fan',
              by: 'x',
            },
            token: t,
            expires: Date.now() + s.ttl,
          },
          'application/json',
          cors,
        );
      }
      if (url.pathname === '/api/player/v1/session/forget') {
        if (req.method === 'OPTIONS')
          return send(204, '', 'text/plain', {
            ...cors,
            'access-control-allow-methods': 'POST',
            'access-control-allow-headers': 'content-type',
          });
        s.forgets.push({ origin, cookie, body, type: req.headers['content-type'] });
        if (s.forgetStatus !== 200) return send(s.forgetStatus, { error: 'no' });
        if (own && cookie) s.clicked.delete(slug);
        return send(200, { ok: true }, 'application/json', cors);
      }
      if (url.pathname.startsWith('/go')) return send(200, '<p>sign in here</p>', 'text/html');
      // a sign-in that takes the game's tab to X and back: X's own screen, in miniature (`s.x`): the player says
      // yes ('yes': signed in here, and back), says no ('no': back, with the site's word in the address), or the
      // phone hands the login to X's app and this tab is left where it was ('app': no page comes)
      const begin = /^\/api\/player\/v1\/(x|google)\/begin$/.exec(url.pathname);
      if (begin) {
        const to = url.searchParams.get('back') ?? '';
        s.begins.push({
          with: begin[1],
          slug: url.searchParams.get('slug'),
          back: to,
          // what a browser says of a move to another page, where it says it (to a host it trusts: https, localhost)
          fetch: [req.headers['sec-fetch-dest'], req.headers['sec-fetch-user']].filter(Boolean).join(' '),
          cookie,
        });
        if (s.x === 'app') return send(204, '', 'text/plain');
        if (s.x === 'yes') s.clicked.add(url.searchParams.get('slug'));
        res.writeHead(302, { location: s.x === 'yes' ? to : `${to.replace(/#.*$/, '')}#gf-signin=cancelled` });
        return res.end();
      }
      return send(404, {});
    }
    // a post on X, and a site that embeds the game: another site frames it
    if (host === 'x.test' || host === 'evil.test')
      return send(200, `<iframe id="g" src="http://moth-play.xgames.test:${port}/"></iframe>`, 'text/html');
    // the game's own host: <slug>-play.xgames.test, its own domain play.mygame.test, or the host games share
    const slug = /^([a-z]+)-play\.xgames\.test$/.exec(host)?.[1] ?? 'moth';
    const policy = csp
      ? {
          'content-security-policy': `default-src 'self'; script-src 'self'; connect-src 'self' http://xgames.test:${port}`,
        }
      : {};
    if (url.pathname === SIGNIN_PATH) {
      if (sharedWait) await new Promise(r => setTimeout(r, sharedWait));
      if (shared === 'none') return send(404, { ok: false, code: 'unknown' });
      return send(200, shared === 'real' ? SHARED : shared, sharedType);
    }
    if (url.pathname === '/platform/v1/site')
      return host === 'play.mygame.test'
        ? send(200, {
            gamesfun: 'site',
            slug: 'moth',
            site: `http://xgames.test:${port}`,
            origin: `http://${req.headers.host}`,
          })
        : send(404, { ok: false });
    if (url.pathname === '/' || url.pathname === '/p/moth/') return send(200, csp ? STRICT : GAME, 'text/html', policy);
    if (url.pathname.endsWith('/gamesfun.js')) return send(200, CLIENT, 'text/javascript');
    if (url.pathname === '/game.js') return send(200, STRICT_JS, 'text/javascript');
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
      if (!/^r\d+$/.test(body.id ?? '') || body.secret !== `s${body.id.slice(1)}`)
        return send(200, { state: 'expired' });
      if (!s.approved) return send(200, { state: 'waiting' });
      // the player signed in on the site, by their own click in this game: the site remembers that too
      s.clicked.add(slug);
      return send(200, {
        state: 'signed-in',
        player: { wallet: '', level: 3, x: { id: '42', handle: 'own_fan' }, by: 'x' },
        token: 'tok-own',
        expires: Date.now() + s.ttl,
      });
    }
    if (url.pathname === '/platform/v1/me')
      return s.valid.has(token)
        ? send(200, {
            ok: true,
            player: { id: 'x:42', name: '@own_fan', level: 3, wallet: '', x: { handle: 'own_fan' } },
          })
        : send(401, { ok: false, code: 'bad', why: 'Sign in first.' });
    return send(404, { ok: false, why: 'not here' });
  });
  return new Promise(r =>
    server.listen(0, '127.0.0.1', () => r({ s, port: server.address().port, close: () => server.close() })),
  );
}

let launched = null;
function chrome() {
  launched ??= (async () => {
    const { chromium } = await import('playwright-core');
    const found = await ensureBrowser({});
    return chromium.launch({
      executablePath: found.path,
      args: [
        '--host-resolver-rules=MAP *.xgames.test 127.0.0.1, MAP xgames.test 127.0.0.1, MAP *.mygame.test 127.0.0.1, MAP evil.test 127.0.0.1, MAP x.test 127.0.0.1',
      ],
    });
  })();
  return launched;
}
after(async () => (await launched)?.close());

/** A browser of its own (cookies, storage) and a stand-in. `remembered`: xgames.fun's cookie is in it already. */
async function world(t, options = {}, { remembered = true, noWindow = false } = {}) {
  const g = await standIn(options);
  t.after(g.close);
  const ctx = await (await chrome()).newContext();
  t.after(() => ctx.close());
  if (remembered)
    await ctx.addCookies([
      { name: 'gf_player', value: 'p1', domain: 'xgames.test', path: '/', httpOnly: true, sameSite: 'Lax' },
    ]);
  if (noWindow)
    await ctx.addInitScript(() => {
      window.open = () => null;
    });
  const own = `http://moth-play.xgames.test:${g.port}/`;
  const open = async (url = own) => {
    const page = await ctx.newPage();
    await page.goto(url);
    return page;
  };
  return { g, s: g.s, ctx, own, open };
}
/** A click on the game's Sign in, answered on xgames.fun in the window it opens. → the player */
async function clickSignIn(page, s) {
  const popup = page.waitForEvent('popup');
  await page.click('#in');
  const win = await popup;
  s.approved = true;
  const player = await page.evaluate(() => window.signedIn);
  s.approved = false;
  return { player, win };
}
const within = (ms, p) => `Promise.race([${p}, new Promise(r => setTimeout(() => r('still waiting'), ${ms}))])`;
const state = page => page.evaluate(() => ({ id: GamesFun.player?.id ?? null, token: GamesFun.token }));
const tabs = ctx => ctx.pages().length;

test(
  'a player who signed in to the game before is signed in with no click: after a reload, and in a new tab',
  { skip, timeout: 60_000 },
  async t => {
    const { s, ctx, open, g } = await world(t);
    const page = await open();
    // a first visit: xgames.fun is asked, says nobody (the player never clicked Sign in here), and nothing waits on it
    assert.equal(await page.evaluate(() => GamesFun.ready), null);
    await page.waitForFunction(() => GamesFun.signInClient);
    while (!s.sessions.length) await page.waitForTimeout(20);
    assert.deepEqual(s.sessions, [{ origin: `http://moth-play.xgames.test:${g.port}`, cookie: 'p1', slug: 'moth' }]);
    assert.deepEqual(await state(page), { id: null, token: '' });

    const { player } = await clickSignIn(page, s);
    assert.equal(player.id, 'x:42');
    assert.equal(tabs(ctx), 1, 'the window closed');

    // a reload: the tab kept the token, so the player is there when gf.ready answers, and nobody was asked
    const asked = s.sessions.length;
    await page.reload();
    assert.equal((await page.evaluate(() => GamesFun.ready)).id, 'x:42');
    assert.deepEqual(await state(page), { id: 'x:42', token: 'tok-own' });
    assert.equal((await page.evaluate(() => changes))[0].id, 'x:42', 'said to gf.onChange, as a click is');
    assert.equal(s.sessions.length, asked, 'the kept token needed no question');

    // a new tab keeps nothing: xgames.fun is asked, with its cookie, and answers with a token for this game
    const tab = await open();
    assert.equal((await tab.evaluate(() => GamesFun.ready)).id, 'x:42', 'gf.ready waited for it');
    assert.deepEqual(await state(tab), { id: 'x:42', token: 'tok-s1' });
    assert.equal((await tab.evaluate(() => changes)).length, 1);
    assert.deepEqual(s.sessions.at(-1), {
      origin: `http://moth-play.xgames.test:${g.port}`,
      cookie: 'p1',
      slug: 'moth',
    });
    assert.equal(tabs(ctx), 2, 'no window opened');
    assert.deepEqual(s.requests, [{ slug: 'moth', with: 'x' }], 'and no sign-in request but the one click');
    assert.deepEqual(await tab.evaluate(() => GamesFun.signInClient), { version: '1.0.0', shared: true });
  },
);

test(
  "a first visit waits for nothing: gf.ready answers before xgames.fun's client or its answer comes",
  { skip, timeout: 60_000 },
  async t => {
    // the client's address answers after 3 s: the page starts with the client it carries, a second in
    const { s, open } = await world(t, { sharedWait: 3000 });
    const page = await open();
    assert.equal(await page.evaluate(() => GamesFun.ready), null);
    assert.ok((await page.evaluate(() => window.readyAt)) < 800, 'gf.ready did not wait for the address');
    assert.equal(await page.evaluate(() => window.clientAtReady), null, 'no client was chosen yet');
    // a click cannot wait either: the carried client answers it
    const { player } = await clickSignIn(page, s);
    assert.equal(player.id, 'x:42');
    assert.deepEqual(await page.evaluate(() => GamesFun.signInClient), { version: '1.0.0', shared: false });
    await page.waitForTimeout(3200);
    assert.equal((await page.evaluate(() => GamesFun.signInClient)).shared, false, 'chosen once a page');
    assert.equal(s.seen.filter(l => l.endsWith(SIGNIN_PATH)).length, 1, 'asked for once');
  },
);

test(
  "the token is renewed before its hour ends, with no click; where xgames.fun can't be asked it ends with the token",
  { skip, timeout: 60_000 },
  async t => {
    // a token that ends 5 minutes and 10.5 seconds from now is renewed in 10.5 s (five minutes before its end)
    const { s, ctx, open, g } = await world(t, { ttl: 300e3 + 10_500 });
    const page = await open();
    await clickSignIn(page, s);
    const first = await page.evaluate(() => GamesFun.expires);
    s.ttl = 3600e3;
    await page.waitForFunction(() => GamesFun.token === 'tok-s1', null, { timeout: 20_000 });
    assert.equal(await page.evaluate(() => GamesFun.player.id), 'x:42');
    assert.ok((await page.evaluate(() => GamesFun.expires)) > first + 3000e3, 'a new hour');
    assert.equal((await page.evaluate(() => changes)).at(-1).id, 'x:42', 'the game hears of the new token');
    assert.equal(
      await page.evaluate(() => JSON.parse(sessionStorage.getItem('gamesfun:moth:signin')).s.token),
      'tok-s1',
    );
    assert.equal(tabs(ctx), 1, 'no window');

    // the game's own domain is another site: xgames.fun's cookie is not sent from there, so nobody is asked, and the
    // sign-in ends when its token does
    s.ttl = 2500;
    const asked = s.sessions.length;
    const domain = await open(`http://play.mygame.test:${g.port}/`);
    assert.equal(await domain.evaluate(() => GamesFun.ready), null);
    await clickSignIn(domain, s);
    assert.equal((await state(domain)).token, 'tok-own');
    await domain.waitForFunction(() => GamesFun.player === null, null, { timeout: 10_000 });
    assert.deepEqual(await state(domain), { id: null, token: '' });
    assert.equal((await domain.evaluate(() => changes)).at(-1), null);
    assert.equal(await domain.evaluate(() => sessionStorage.getItem('gamesfun:moth:signin')), null);
    assert.equal(s.sessions.length, asked, 'no question from another site');
  },
);

test(
  'Sign out sticks: the next load signs nobody in by itself, in this tab or a new one, until a click on Sign in',
  { skip, timeout: 60_000 },
  async t => {
    const { s, open, g } = await world(t);
    const page = await open();
    await clickSignIn(page, s);
    await page.evaluate(() => GamesFun.signOut());
    assert.deepEqual(await state(page), { id: null, token: '' });
    while (!s.forgets.length) await page.waitForTimeout(20);
    assert.deepEqual(s.forgets, [
      {
        origin: `http://moth-play.xgames.test:${g.port}`,
        cookie: 'p1',
        body: { slug: 'moth' },
        type: 'application/json',
      },
    ]);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('gamesfun:moth:signin')), null, 'the token is gone');

    const asked = s.sessions.length;
    await page.reload();
    assert.equal(await page.evaluate(() => GamesFun.ready), null);
    const tab = await open();
    assert.equal(await tab.evaluate(() => GamesFun.ready), null);
    await tab.waitForTimeout(300);
    assert.equal(s.sessions.length, asked, 'xgames.fun is not even asked');

    // a click signs in again, and from then on the next load does too
    assert.equal((await clickSignIn(tab, s)).player.id, 'x:42');
    await tab.reload();
    assert.equal((await tab.evaluate(() => GamesFun.ready)).id, 'x:42');
    const other = await open();
    assert.equal((await other.evaluate(() => GamesFun.ready)).id, 'x:42');
  },
);

test(
  'Sign out sticks in this browser even when xgames.fun never hears of it; a tab left signed in follows',
  { skip, timeout: 60_000 },
  async t => {
    const { s, open } = await world(t);
    s.forgetStatus = 500; // xgames.fun does not take it (down, or older than this client)
    const page = await open();
    await clickSignIn(page, s);
    const tab = await open();
    assert.equal((await tab.evaluate(() => GamesFun.ready)).id, 'x:42');
    await page.evaluate(() => GamesFun.signOut());
    while (!s.forgets.length) await page.waitForTimeout(20);
    assert.ok(s.clicked.has('moth'), 'xgames.fun would still answer');
    const asked = s.sessions.length;
    await page.reload();
    assert.equal(await page.evaluate(() => GamesFun.ready), null);
    assert.equal(s.sessions.length, asked, 'but this browser does not ask');
    // the other tab of the game: signed out when it is next in view
    await tab.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.deepEqual(await state(tab), { id: null, token: '' });
    assert.equal((await tab.evaluate(() => changes)).at(-1), null);
  },
);

test(
  "what another game's page gets: no answer from xgames.fun for this game, and nothing this game's tab kept",
  { skip, timeout: 60_000 },
  async t => {
    const { s, open, g } = await world(t);
    const page = await open();
    await clickSignIn(page, s);
    // another game, on the same site: its own page asks only for itself…
    const evil = await open(`http://evil-play.xgames.test:${g.port}/`);
    assert.equal(await evil.evaluate(() => GamesFun.ready), null);
    await evil.waitForFunction(() => GamesFun.signInClient);
    await evil.waitForTimeout(300);
    assert.deepEqual(
      s.sessions.filter(q => q.origin.includes('evil-play')).map(q => q.slug),
      ['evil'],
      'its own name, from its own host',
    );
    // …and when its code asks for this game, with the player's cookie, the browser hands it no answer
    const stolen = await evil.evaluate(
      site =>
        fetch(`${site}/api/player/v1/session?slug=moth`, { credentials: 'include' }).then(
          r => r.json(),
          () => 'no answer',
        ),
      `http://xgames.test:${g.port}`,
    );
    assert.equal(stolen, 'no answer');
    // nor can it make xgames.fun forget this game for the player
    await evil.evaluate(
      site =>
        fetch(`${site}/api/player/v1/session/forget`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: '{"slug":"moth"}',
        }).catch(() => null),
      `http://xgames.test:${g.port}`,
    );
    assert.ok(s.clicked.has('moth'));
    // what this game's tab kept is its own origin's: another game's page reads none of it
    assert.deepEqual(await evil.evaluate(() => [sessionStorage.length, localStorage.getItem('gamesfun:moth:signed')]), [
      0,
      null,
    ]);
    assert.equal(await page.evaluate(() => localStorage.getItem('gamesfun:moth:signed')), '"in"');
  },
);

test(
  'framed by another site: xgames.fun is not asked; in a post on X a reload keeps the sign-in until the token ends',
  { skip, timeout: 60_000 },
  async t => {
    const { s, ctx, open, g } = await world(t);
    s.clicked.add('moth'); // xgames.fun would sign this browser in on the game's own link
    const framing = await open(`http://evil.test:${g.port}/`);
    const inside = await (await framing.waitForSelector('#g')).contentFrame();
    await inside.waitForFunction(() => window.GamesFun);
    assert.equal(await inside.evaluate(() => GamesFun.ready), null, 'the framing page gets a signed-out game');
    await inside.waitForTimeout(300);
    assert.equal(s.sessions.length, 0, 'nobody asked');
    await framing.close();

    // a post on X: the player signs in by a click, in the window; a reload of the post keeps it
    const post = await open(`http://x.test:${g.port}/`);
    let frame = await (await post.waitForSelector('#g')).contentFrame();
    await frame.waitForFunction(() => window.GamesFun);
    await frame.evaluate(() => GamesFun.ready);
    const popup = post.waitForEvent('popup');
    await frame.click('#in');
    await popup;
    s.approved = true;
    assert.equal((await frame.evaluate(() => window.signedIn)).id, 'x:42');
    s.approved = false;
    await post.reload();
    frame = await (await post.waitForSelector('#g')).contentFrame();
    await frame.waitForFunction(() => window.GamesFun);
    assert.equal((await frame.evaluate(() => GamesFun.ready)).id, 'x:42');
    assert.equal(await frame.evaluate(() => GamesFun.token), 'tok-own');
    assert.equal(s.sessions.length, 0, 'still nobody asked');
    assert.equal(tabs(ctx), 1, 'no window');
    // X's page reads nothing of the frame: it is another origin's
    assert.equal(await post.evaluate(() => sessionStorage.length + localStorage.length), 0);
  },
);

test(
  'on a host that games share (/p/<slug>/): nothing is kept, nothing is loaded from it, nobody is asked',
  { skip, timeout: 60_000 },
  async t => {
    const { s, open, g } = await world(t);
    s.clicked.add('moth');
    const page = await open(`http://play.xgames.test:${g.port}/p/moth/`);
    assert.equal(await page.evaluate(() => GamesFun.slug), 'moth');
    assert.equal(await page.evaluate(() => GamesFun.ready), null);
    assert.equal((await clickSignIn(page, s)).player.id, 'x:42');
    assert.deepEqual(await page.evaluate(() => GamesFun.signInClient), { version: '1.0.0', shared: false });
    assert.deepEqual(
      await page.evaluate(() => [sessionStorage.length, localStorage.length]),
      [0, 0],
      "another game's page on this origin finds nothing",
    );
    assert.ok(!s.seen.some(l => l.endsWith(SIGNIN_PATH)), 'no code is loaded from a host games share');
    await page.reload();
    assert.equal(await page.evaluate(() => GamesFun.ready), null, 'as before: a reload is signed out');
    await page.waitForTimeout(300);
    assert.equal(s.sessions.length, 0);
  },
);

test(
  'a kept token the platform no longer takes is not kept: xgames.fun is asked instead, or the player is signed out',
  { skip, timeout: 60_000 },
  async t => {
    const { s, open, g } = await world(t);
    const page = await open();
    await clickSignIn(page, s);
    s.valid.delete('tok-own'); // its key was replaced
    await page.reload();
    await page.waitForFunction(() => GamesFun.token === 'tok-s1');
    assert.equal((await state(page)).id, 'x:42');

    const domain = await open(`http://play.mygame.test:${g.port}/`);
    s.valid.add('tok-own');
    await clickSignIn(domain, s);
    s.valid.delete('tok-own');
    await domain.reload();
    await domain.waitForFunction(() => window.GamesFun && GamesFun.signInClient && GamesFun.player === null);
    assert.equal(await domain.evaluate(() => sessionStorage.getItem('gamesfun:moth:signin')), null);
  },
);

test(
  "two tabs of the game renew at once: each asks for itself and has its own token, and neither ends the other's",
  { skip, timeout: 60_000 },
  async t => {
    const { s, open } = await world(t, { ttl: 300e3 + 10_500 });
    const a = await open();
    await clickSignIn(a, s);
    const b = await open();
    await b.evaluate(() => GamesFun.ready);
    s.ttl = 3600e3;
    await a.waitForFunction(() => GamesFun.expires > Date.now() + 3000e3, null, { timeout: 20_000 });
    await b.waitForFunction(() => GamesFun.expires > Date.now() + 3000e3, null, { timeout: 20_000 });
    const [ta, tb] = [(await state(a)).token, (await state(b)).token];
    assert.notEqual(ta, tb);
    assert.ok(s.valid.has(ta) && s.valid.has(tb), 'both good');
    assert.deepEqual([(await state(a)).id, (await state(b)).id], ['x:42', 'x:42']);
    assert.equal(await a.evaluate(() => localStorage.getItem('gamesfun:moth:signed')), '"in"');
  },
);

// ---- the sign-in client xgames.fun serves -----------------------------------------------------------------------
const VARIANTS = {
  'no such address (a host that is not xgames.fun, an older one)': { shared: 'none' },
  'an answer that is no module (a page)': { shared: '<!doctype html><p>not found</p>', sharedType: 'text/html' },
  'a module for another version of what the game hands it': {
    shared: SHARED.replace('export const v = 1;', 'export const v = 2;'),
  },
  'a module that fails as it starts': {
    shared: 'export const v = 1; export default function () { throw new Error("no"); }',
  },
  'a module that answers no client': { shared: 'export const v = 1; export default function () { return {}; }' },
};
for (const [name, options] of Object.entries(VARIANTS))
  test(
    `the client's address answers ${name}: the carried client runs, the same`,
    { skip, timeout: 60_000 },
    async t => {
      const { s, open } = await world(t, options);
      const page = await open();
      assert.equal(await page.evaluate(() => GamesFun.ready), null);
      await page.waitForFunction(() => GamesFun.signInClient);
      assert.deepEqual(await page.evaluate(() => GamesFun.signInClient), { version: '1.0.0', shared: false });
      assert.equal((await clickSignIn(page, s)).player.id, 'x:42');
      const tab = await open();
      assert.equal(
        (await tab.evaluate(() => GamesFun.ready)).id,
        'x:42',
        'no click in a new tab, as with the served one',
      );
      assert.equal(s.seen.filter(l => l.endsWith(SIGNIN_PATH)).length, 2, 'asked once a page');
    },
  );

test(
  "xgames.fun's client is the one that runs when its address answers, under a policy of 'self' scripts only",
  { skip, timeout: 60_000 },
  async t => {
    // a later version of the client, served at the address: the game was not published again
    const later = SHARED.replace("var VERSION = '1.0.0';", "var VERSION = '9.9.9';");
    assert.notEqual(later, SHARED);
    const { s, open, g } = await world(t, { shared: later, csp: true });
    const page = await open();
    assert.equal(await page.evaluate(() => GamesFun.ready), null);
    await page.waitForFunction(() => GamesFun.signInClient);
    assert.deepEqual(await page.evaluate(() => GamesFun.signInClient), { version: '9.9.9', shared: true });
    assert.equal((await clickSignIn(page, s)).player.id, 'x:42');
    const tab = await open();
    assert.equal((await tab.evaluate(() => GamesFun.ready)).id, 'x:42');
    assert.equal((await state(tab)).token, 'tok-s1');
    assert.deepEqual(await tab.evaluate(() => window.blocked), [], 'nothing the policy refused');
    assert.deepEqual(await page.evaluate(() => window.blocked), []);
    // asked of the game's own host, and of no other
    assert.deepEqual(
      [...new Set(s.seen.filter(l => l.endsWith(SIGNIN_PATH)))],
      [`GET moth-play.xgames.test${SIGNIN_PATH}`],
    );
    assert.equal(g.s.requests.length, 1);
  },
);

// ---- where no window opens: the panel ---------------------------------------------------------------------------
const panelOf = page =>
  page.evaluate(() => {
    const root = document.querySelector('[data-gamesfun="signin"]')?.shadowRoot;
    if (!root) return null;
    const a = root.querySelector('a'),
      words = root.querySelector('p');
    return {
      text: a.textContent,
      href: a.href,
      target: a.target,
      code: words.style.display === 'none' ? null : words.textContent,
    };
  });
const press = (page, text) =>
  page.evaluate(text => {
    const root = document.querySelector('[data-gamesfun="signin"]').shadowRoot;
    [...root.querySelectorAll('button')].find(b => b.textContent === text).click();
  }, text);

test(
  'no window opens (an app’s browser, a blocker): one link to tap, the code only when asked for, closed by itself',
  { skip, timeout: 60_000 },
  async t => {
    const { s, ctx, open, g } = await world(t, {}, { noWindow: true });
    const page = await open();
    await page.evaluate(() => GamesFun.ready);
    assert.equal(await panelOf(page), null, 'nothing before the click');
    assert.equal(s.requests.length, 0, 'and no request at page load');
    await page.click('#in');
    await page.waitForFunction(() => codes.length > 0);
    assert.deepEqual(await panelOf(page), {
      text: 'Sign in with X',
      href: `http://xgames.test:${g.port}/go/CODE-0001?with=x`,
      target: '_blank',
      code: null,
    });
    // the game is told a way to sign in is on screen: it shows no code of its own
    const said = await page.evaluate(() => codes[0]);
    assert.deepEqual([said.window, said.panel, said.code], [true, true, 'CODE-0001']);
    await press(page, 'Sign in on another device');
    assert.equal((await panelOf(page)).code, `On any device, go to xgames.test:${g.port}/go and enter CODE-0001`);

    // "Not now": the game hears null; the next click shows the same request, not a new one
    await press(page, 'Not now');
    assert.equal(await page.evaluate(within(1000, 'window.signedIn')), null);
    assert.equal(await panelOf(page), null);
    await page.click('#in');
    await page.waitForFunction(() => codes.length > 1);
    assert.equal((await panelOf(page)).href, `http://xgames.test:${g.port}/go/CODE-0001?with=x`);
    assert.equal(s.requests.length, 1, 'one request, however often the panel opens');

    // the link is a real one: the player's tap opens xgames.fun's page (no blocker stops a tap on a link)
    const opened = ctx.waitForEvent('page');
    await page.click('[data-gamesfun="signin"] a');
    const win = await opened;
    await win.waitForURL(/\/go\/CODE-0001\?with=x$/);
    assert.equal(await win.evaluate(() => !!window.opener), true, 'the page knows which page opened it');

    // answered there while the game was out of view: back in view it is asked at once (a look has just gone by, so
    // the next one is two seconds away), and the panel goes by itself
    const looks = s.status.length;
    while (s.status.length === looks) await page.waitForTimeout(20);
    s.approved = true;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.equal((await page.evaluate(within(1200, 'window.signedIn')))?.id, 'x:42', 'no wait for the next look');
    assert.equal(await panelOf(page), null, 'no Done, no Continue');
    assert.equal(await page.evaluate(() => GamesFun.code), null);
  },
);

test(
  'the panel is not drawn in a frame on another site, nor when the game turns it off: the game shows the code',
  { skip, timeout: 60_000 },
  async t => {
    const { s, ctx, g } = await world(t, {}, { noWindow: true });
    const post = await ctx.newPage();
    await post.goto(`http://x.test:${g.port}/`);
    const frame = await (await post.waitForSelector('#g')).contentFrame();
    await frame.waitForFunction(() => window.GamesFun);
    await frame.evaluate(async () => {
      await GamesFun.ready;
      window.signedIn = GamesFun.signIn();
    });
    await frame.waitForFunction(() => codes.length > 0);
    assert.deepEqual(await frame.evaluate(() => [codes[0].window, codes[0].panel]), [false, false], 'as it always was');
    assert.equal(await frame.evaluate(() => document.querySelector('[data-gamesfun="signin"]')), null);
    s.approved = true;
    assert.equal((await frame.evaluate(() => window.signedIn)).id, 'x:42');
    s.approved = false;
    s.clicked.clear();

    const off = await ctx.newPage();
    await off.addInitScript(() => {
      window.GAMESFUN_SIGNIN_PANEL = false;
    });
    await off.goto(`http://moth-play.xgames.test:${g.port}/`);
    await off.evaluate(() => GamesFun.ready);
    await off.click('#in');
    await off.waitForFunction(() => codes.length > 0);
    assert.deepEqual(await off.evaluate(() => [codes[0].window, codes[0].panel]), [false, false]);
    assert.equal(await off.evaluate(() => document.querySelector('[data-gamesfun="signin"]')), null);
  },
);

test(
  'the player closed the sign-in window: the next click opens it again, on the same request',
  { skip, timeout: 60_000 },
  async t => {
    const { s, open } = await world(t);
    const page = await open();
    await page.evaluate(() => GamesFun.ready);
    let popup = page.waitForEvent('popup');
    await page.click('#in');
    let win = await popup;
    await win.waitForURL(/\/go\/CODE-0001\?with=x$/);
    await win.close();
    popup = page.waitForEvent('popup');
    await page.click('#in');
    win = await popup;
    await win.waitForURL(/\/go\/CODE-0001\?with=x$/);
    assert.equal(s.requests.length, 1, 'no second request');
    s.approved = true;
    assert.equal((await page.evaluate(() => window.signedIn)).id, 'x:42');
  },
);

test(
  'the sign-in page took over this tab and the player came back: the request they left is answered, with no click',
  { skip, timeout: 60_000 },
  async t => {
    // on the game's own domain, where xgames.fun cannot be asked: what signs the player in is the request itself
    const { s, open, g } = await world(t, {}, { noWindow: true });
    const page = await open(`http://play.mygame.test:${g.port}/`);
    await page.evaluate(() => GamesFun.ready);
    await page.click('#in');
    await page.waitForFunction(() => codes.length > 0);
    // the link opened in this very tab (an app's browser with one view), the player signed in there and came back
    await page.goto(`http://xgames.test:${g.port}/go/CODE-0001?with=x`);
    s.approved = true;
    await page.goBack();
    await page.waitForFunction(() => window.GamesFun && GamesFun.player);
    assert.equal(await page.evaluate(() => GamesFun.player.id), 'x:42');
    assert.equal(s.requests.length, 1);
    assert.equal(s.sessions.length, 0);
  },
);

// ---- a phone: the tap takes the tab to X and back ----------------------------------------------------------------
/** A phone's browser (a finger for a pointer, no hover), with xgames.fun's cookie when `remembered`. */
async function phone(t, options = {}, { remembered = true } = {}) {
  const { devices } = await import('playwright-core');
  const g = await standIn(options);
  t.after(g.close);
  const ctx = await (await chrome()).newContext({ ...devices['Pixel 7'] });
  t.after(() => ctx.close());
  if (remembered)
    await ctx.addCookies([
      { name: 'gf_player', value: 'p1', domain: 'xgames.test', path: '/', httpOnly: true, sameSite: 'Lax' },
    ]);
  const own = `http://moth-play.xgames.test:${g.port}/`;
  const open = async (url = own) => {
    const page = await ctx.newPage();
    await page.goto(url);
    await page.evaluate(() => {
      window.sameDocument = true;
    });
    return page;
  };
  return { g, s: g.s, ctx, own, open };
}

test(
  'on a phone, on the game’s own link: one tap, X, and the game again, signed in. No window, no request, no code',
  { skip, timeout: 60_000 },
  async t => {
    const { s, ctx, open, own } = await phone(t);
    const page = await open(`${own}?room=AB12`);
    assert.equal(await page.evaluate(() => GamesFun.ready), null);
    await page.tap('#in');
    await page.waitForFunction(() => !window.sameDocument && window.GamesFun && GamesFun.player);
    // the game started again, at the address it left, and the player is there when gf.ready answers
    assert.equal(page.url(), `${own}?room=AB12`);
    assert.equal((await page.evaluate(() => GamesFun.ready)).id, 'x:42');
    assert.equal((await page.evaluate(() => changes))[0].id, 'x:42');
    assert.deepEqual(s.begins, [{ with: 'x', slug: 'moth', back: `${own}?room=AB12`, fetch: '', cookie: 'p1' }]);
    assert.equal(s.requests.length, 0, 'no sign-in request');
    assert.equal(tabs(ctx), 1, 'no second tab');
    assert.equal(await page.evaluate(() => codes.length), 0, 'no code');
    assert.equal(await page.evaluate(() => document.querySelector('[data-gamesfun="signin"]')), null, 'no panel');
    assert.equal(await page.evaluate(() => GamesFun.signInEnded), null);
    // Sign out there, then Sign in again: the tap is the player's own, so it counts though they signed out before
    await page.evaluate(() => GamesFun.signOut());
    await page.evaluate(() => {
      window.sameDocument = true;
    });
    await page.tap('#in');
    await page.waitForFunction(() => !window.sameDocument && window.GamesFun && GamesFun.player);
    assert.equal(s.begins.length, 2);
  },
);

test(
  'on a phone: the player says no at X. The game is back as it was, told why, with nothing left in its address',
  { skip, timeout: 60_000 },
  async t => {
    const { s, open, own } = await phone(t);
    s.x = 'no';
    const page = await open();
    await page.evaluate(() => GamesFun.signOut());
    await page.tap('#in');
    await page.waitForFunction(() => !window.sameDocument && window.GamesFun);
    assert.equal(await page.evaluate(() => GamesFun.ready), null);
    assert.equal(await page.evaluate(() => GamesFun.signInEnded), 'cancelled');
    assert.equal(page.url(), own, 'the word is out of the address');
    assert.equal(await page.evaluate(() => document.querySelector('[data-gamesfun="signin"]')), null, 'no panel');
    // and it is over: a later load asks as any load does, never again on that tap's account
    s.clicked.add('moth');
    await page.evaluate(() => localStorage.setItem('gamesfun:moth:signed', '"out"'));
    const asked = s.sessions.length;
    await page.reload();
    assert.equal(await page.evaluate(() => GamesFun.ready), null);
    await page.waitForTimeout(300);
    assert.equal(s.sessions.length, asked);
    // any other word in the address is the game's own business
    await page.goto(`${own}#gf-signin=other`);
    assert.equal(await page.evaluate(() => [GamesFun.signInEnded, location.hash].join()), ',#gf-signin=other');
  },
);

test(
  "on a phone: X's app takes the login and answers in another browser. Back in the game's tab, it is signed in",
  { skip, timeout: 60_000 },
  async t => {
    const { s, ctx, open } = await phone(t);
    s.x = 'app';
    const page = await open();
    await page.evaluate(() => GamesFun.ready);
    await page.tap('#in');
    while (!s.begins.length) await page.waitForTimeout(20);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.sameDocument), true, 'the tab was left where it was');
    // the player looks back before X's app has answered (some seconds on): nobody yet, and the game hears so
    const asked = s.sessions.length;
    await page.waitForTimeout(5000);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.equal(await page.evaluate(within(1500, 'window.signedIn')), null);
    assert.equal(s.sessions.length, asked + 1);
    // asked no more often than every five seconds, however often the page comes into view
    for (let i = 0; i < 5; i++) await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(200);
    assert.equal(s.sessions.length, asked + 1);
    // X's app answers (in another browser, which says to go back to the game); the player comes back
    s.clicked.add('moth');
    await page.waitForTimeout(5000);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await page.waitForFunction(() => GamesFun.player);
    assert.equal(await page.evaluate(() => GamesFun.player.id), 'x:42');
    assert.equal(await page.evaluate(() => window.sameDocument), true, 'with no reload');
    assert.equal(tabs(ctx), 1);
    assert.equal(s.requests.length, 0);
  },
);

test(
  'the tab stays where a sign-in could not come back signed in: a computer, a frame, the game’s own domain, {stay: true}',
  { skip, timeout: 60_000 },
  async t => {
    // a computer: the window, and the game keeps running
    const desk = await world(t);
    const page = await desk.open();
    await page.evaluate(() => {
      window.sameDocument = true;
    });
    assert.equal((await clickSignIn(page, desk.s)).player.id, 'x:42');
    assert.equal(await page.evaluate(() => window.sameDocument), true);
    assert.equal(desk.s.begins.length, 0);

    const { s, ctx, open, g } = await phone(t);
    // a phone, on the game's own domain (another site: it could not ask xgames.fun on its way back): the window
    const domain = await open(`http://play.mygame.test:${g.port}/`);
    await domain.evaluate(() => GamesFun.ready);
    const popup = domain.waitForEvent('popup');
    await domain.tap('#in');
    await popup;
    s.approved = true;
    assert.equal((await domain.evaluate(() => window.signedIn)).id, 'x:42');
    s.approved = false;
    assert.equal(await domain.evaluate(() => window.sameDocument), true);
    // a phone, in a post on X: a frame cannot take the page away
    const post = await ctx.newPage();
    await post.goto(`http://x.test:${g.port}/`);
    const frame = await (await post.waitForSelector('#g')).contentFrame();
    await frame.waitForFunction(() => window.GamesFun);
    await frame.evaluate(() => GamesFun.ready);
    const framed = post.waitForEvent('popup');
    await frame.tap('#in');
    await framed;
    assert.equal(post.url(), `http://x.test:${g.port}/`);
    // a phone, and a game that asked to stay: the window
    const stay = await open();
    // (this browser signed in to the game a moment ago, on its own domain: xgames.fun answers this page with no tap)
    await stay.waitForFunction(() => GamesFun.player);
    await stay.evaluate(() => GamesFun.signOut());
    const kept = stay.waitForEvent('popup');
    await stay.evaluate(() => {
      document.getElementById('in').onclick = () => (window.signedIn = GamesFun.signIn({ stay: true }));
    });
    await stay.tap('#in');
    await kept;
    assert.equal(await stay.evaluate(() => window.sameDocument), true);
    assert.equal(s.begins.length, 0, 'nobody was taken to X');
  },
);

test(
  "the move to X is made inside the player's tap, so the browser says it is the player's own; a script's is not",
  { skip, timeout: 60_000 },
  async t => {
    // *.localhost is a host a browser trusts as it trusts https, so it says how a page was left (Sec-Fetch-User)
    const { devices } = await import('playwright-core');
    const g = await standIn();
    t.after(g.close);
    const ctx = await (await chrome()).newContext({ ...devices['Pixel 7'] });
    t.after(() => ctx.close());
    const own = `http://moth-play.localhost:${g.port}/`;
    const page = await ctx.newPage();
    await page.goto(own);
    await page.evaluate(() => GamesFun.ready);
    await page.tap('#in');
    while (!g.s.begins.length) await page.waitForTimeout(20);
    assert.deepEqual(g.s.begins[0], { with: 'x', slug: 'moth', back: own, fetch: 'document ?1', cookie: null });
    // called with no tap behind it (the game's own timer, as its page loads): the page is still left, and the browser
    // does not vouch for it
    g.s.x = 'app';
    const auto = await ctx.newPage();
    await auto.goto(`${own}?auto`);
    while (g.s.begins.length < 2) await auto.waitForTimeout(20);
    assert.deepEqual([g.s.begins[1].with, g.s.begins[1].fetch], ['google', 'document']);
  },
);
