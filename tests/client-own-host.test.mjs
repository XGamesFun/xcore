// gamesfun.js on the game's own host (<slug>-play.<site>), with the file loaded in a fake window (node:vm): every
// request it makes is kept and answered here, the tab's location keeps where it was sent, and the timers wait until a
// test runs them. So a test can tell exactly what is asked of xgames.fun and when: the question with no tap as the page
// loads (GET <site>/api/player/v1/session?slug=), the tab sent to <site>/api/player/v1/x/begin inside the tap itself,
// #gf-signin= read and taken out of the address, Sign out told to xgames.fun (POST …/session/forget), and nothing of
// the kind inside xgames.fun's play page. The same in real Chrome, against a stand-in xgames.fun, is in
// client-signin.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT } from './helpers.mjs';

const CLIENT = readFileSync(path.join(ROOT, 'lib', 'client', 'gamesfun.js'), 'utf8');
const SITE = 'https://xgames.test';
const OWN = 'https://moth-play.xgames.test/';
const SESSION = `${SITE}/api/player/v1/session?slug=moth`;
const FORGET = `${SITE}/api/player/v1/session/forget`;
const NAMED = {
  player: { wallet: null, level: 3, x: { id: '42', handle: 'own_fan' }, google: null, name: 'own_fan', by: 'x' },
  token: 'tok-s1',
};
const ME = { ok: true, player: { id: 'x:42', name: '@own_fan', level: 3, wallet: '', x: { handle: 'own_fan' } } };
/** What came out of the fake window, as plain data of this realm. */
const plain = v => JSON.parse(JSON.stringify(v));
const moment = () => new Promise(r => setTimeout(r, 20));

/** A storage in the shape of the browser's (sessionStorage, localStorage), from `seed`. */
function storage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    get length() {
      return m.size;
    },
    map: m,
  };
}

/**
 * The client in a fake window at `href`. `session`: what xgames.fun answers the question ({status, body, headers}, or
 * a body); `framed`: a page above (it keeps what it is sent), else the game is the top window; `referrer`: the framing
 * page's address as the frame sees it. → {gf, fetched, went, replaced, sent, from, tick, show, changes, tab, browser}
 */
function load({
  href = OWN,
  session = { player: null },
  framed = false,
  referrer = '',
  tab = {},
  browser = {},
  before = {},
} = {}) {
  const fetched = [],
    went = [],
    replaced = [],
    sent = [],
    opened = [],
    timers = [],
    listeners = [],
    docListeners = [];
  const u = new URL(href);
  const loc = {
    host: u.host,
    hostname: u.hostname,
    pathname: u.pathname,
    protocol: u.protocol,
    origin: u.origin,
    href: u.href,
    search: u.search,
    hash: u.hash,
    assign: to => went.push(String(to)),
  };
  const answer = (status, body, headers = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const respond = (url, init) => {
    if (url === SESSION) {
      const a = typeof session === 'function' ? session() : session;
      if (a && a.status) return answer(a.status, a.body ?? {}, a.headers);
      return answer(200, a && a.token ? { ...a, expires: Date.now() + 3600e3 } : a);
    }
    if (url === FORGET && init.method === 'POST') return answer(200, { ok: true });
    if (url === '/platform/v1/me') return answer(200, ME);
    if (url === '/player/v1/request' && init.method === 'POST')
      return answer(200, {
        id: 'r1',
        secret: 's1',
        code: 'CODE-0001',
        expires: Date.now() + 900e3,
        url: `${SITE}/go/CODE-0001`,
        site: 'xgames.test',
      });
    if (url === '/player/v1/request/status') return answer(200, { state: 'waiting' });
    return answer(404, { ok: false });
  };
  const doc = {
    readyState: 'complete',
    visibilityState: 'visible',
    referrer,
    currentScript: null,
    addEventListener: (type, fn) => docListeners.push([type, fn]),
  };
  const win = {
    location: loc,
    URL,
    Response,
    console,
    document: doc,
    GAMESFUN_LIVE_BANNER: false,
    sessionStorage: storage(tab),
    localStorage: storage(browser),
    history: {
      state: null,
      replaceState: (state, title, to) => {
        replaced.push(to);
        const next = new URL(to, loc.href);
        Object.assign(loc, { href: next.href, pathname: next.pathname, search: next.search, hash: next.hash });
      },
    },
    fetch: (url, init = {}) => {
      fetched.push({
        url: String(url),
        method: init.method ?? 'GET',
        credentials: init.credentials ?? null,
        body: init.body ?? null,
      });
      return Promise.resolve(respond(String(url), init));
    },
    open: to => {
      opened.push(String(to));
      return { closed: false, close() {}, location: { href: String(to) } };
    },
    setTimeout: fn => timers.push(fn),
    clearTimeout() {},
    addEventListener: (type, fn) => listeners.push([type, fn]),
    ...before,
  };
  const ctx = vm.createContext(win);
  // the page's clock: this machine's, moved on by advance()
  let ahead = 0;
  win.clock = () => Date.now() + ahead;
  vm.runInContext('Date.now = function () { return clock(); };', ctx);
  const parent = framed
    ? { postMessage: (data, target) => sent.push(plain({ data, target })) }
    : vm.runInContext('this', ctx);
  win.parent = parent;
  vm.runInContext(CLIENT, ctx, { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
  const gf = win.GamesFun;
  const changes = [];
  gf.onChange(p => changes.push(plain(p)));
  return {
    gf,
    fetched,
    went,
    replaced,
    opened,
    loc,
    changes,
    tab: win.sessionStorage.map,
    browser: win.localStorage.map,
    /** The requests to xgames.fun's own site (the question, Sign out), as "METHOD url". */
    toSite: () => fetched.filter(f => f.url.startsWith(SITE)).map(f => `${f.method} ${f.url}`),
    sent: () => sent.map(m => m.data).filter(d => d.type !== 'gf:host-ready'),
    /** A message to the game from the page above, at xgames.fun. */
    from(data) {
      for (const [type, fn] of listeners) if (type === 'message') fn({ source: parent, origin: SITE, data });
    },
    /** Runs every timer set so far (the waits a real page would sit out). */
    tick() {
      for (const fn of timers.splice(0)) fn();
    },
    /** The page's clock moves on `ms`. */
    advance(ms) {
      ahead += ms;
    },
    /** The page comes back into view. */
    show() {
      for (const [type, fn] of docListeners) if (type === 'visibilitychange') fn();
    },
  };
}
/** The page's own sign-in client has started (the question, where it is asked, is on its way or answered). */
async function settled(w) {
  for (let i = 0; i < 50 && !w.gf.signInClient; i++) await moment();
  await moment();
}

// ---- the question with no tap, as the page loads ----

test('on its own host, a load where xgames.fun names the player: signed in with no tap, there when gf.ready answers', async () => {
  const w = load({ session: NAMED });
  const player = plain(await w.gf.ready);
  assert.equal(player.id, 'x:42');
  assert.deepEqual(w.toSite(), [`GET ${SESSION}`], 'asked once, of xgames.fun, for this game');
  assert.equal(w.fetched.find(f => f.url === SESSION).credentials, 'include', "with xgames.fun's cookie");
  // the same state a sign-in gives: the platform's player, the token for the game's own server, and gf.onChange
  assert.deepEqual([w.gf.player.id, w.gf.token], ['x:42', 'tok-s1']);
  assert.ok(w.gf.expires > Date.now() + 3500e3);
  assert.deepEqual(
    w.changes.map(p => p?.id),
    ['x:42'],
  );
  assert.ok(
    w.fetched.some(f => f.url === '/platform/v1/me'),
    'the player as the platform knows them',
  );
  assert.deepEqual(w.went, [], 'no tap, nothing moved');
  assert.equal(JSON.parse(w.tab.get('gamesfun:moth:signin')).s.token, 'tok-s1', 'kept for this tab');
});

test('{player: null}: signed out, and nothing more is asked (not when back in view, not when the waits run out)', async () => {
  const w = load({ session: { player: null } });
  assert.equal(await w.gf.ready, null);
  await settled(w);
  assert.deepEqual(w.toSite(), [`GET ${SESSION}`]);
  for (let i = 0; i < 3; i++) {
    w.advance(60e3);
    w.show();
    w.tick();
    await moment();
  }
  assert.deepEqual(w.toSite(), [`GET ${SESSION}`], 'asked once');
  assert.deepEqual([w.gf.player, w.gf.token, w.changes], [null, '', []]);
});

test('a player who signed out here: the page asks xgames.fun nothing as it loads', async () => {
  const w = load({ session: NAMED, browser: { 'gamesfun:moth:signed': '"out"' } });
  assert.equal(await w.gf.ready, null);
  await settled(w);
  assert.deepEqual(w.toSite(), []);
});

test('xgames.fun says too many (429): not asked again until it allows, however often the page comes back', async () => {
  let n = 0;
  const w = load({
    session: () =>
      ++n === 1 ? { status: 429, body: { error: 'Too many.' }, headers: { 'retry-after': '120' } } : NAMED,
  });
  assert.equal(await w.gf.ready, null);
  await settled(w);
  const q = JSON.parse(w.tab.get('gamesfun:moth:signin')).q;
  assert.ok(q.until > Date.now() + 100e3 && q.until <= Date.now() + 120e3, 'for as long as Retry-After said');
  // a sign-in in another tab of this game: this one asks when back in view, once it may
  w.browser.set('gamesfun:moth:signed', '"in"');
  for (let i = 0; i < 3; i++) {
    w.advance(10e3);
    w.show();
    await moment();
  }
  assert.equal(n, 1, 'not within the two minutes');
  w.advance(100e3);
  w.show();
  for (let i = 0; i < 20 && !w.gf.player; i++) await moment();
  assert.equal(n, 2);
  assert.equal(w.gf.player.id, 'x:42');
  // and a reload of this tab, told the same, asks nothing while it holds
  const again = load({
    session: NAMED,
    tab: { 'gamesfun:moth:signin': JSON.stringify({ q: { until: Date.now() + 60e3, at: [] } }) },
  });
  assert.equal(await again.gf.ready, null);
  await settled(again);
  assert.deepEqual(again.toSite(), []);
});

test('never more than twelve questions an hour from a tab, without a tap', async () => {
  const hour = Array.from({ length: 12 }, (_, i) => Date.now() - 3000e3 + i * 1000);
  const w = load({ session: NAMED, tab: { 'gamesfun:moth:signin': JSON.stringify({ q: { until: 0, at: hour } }) } });
  assert.equal(await w.gf.ready, null);
  await settled(w);
  assert.deepEqual(w.toSite(), [], 'twelve this hour already (reloads of this tab)');
});

// ---- the tap: the tab goes to X and back ----

test('Sign in from the tap: this tab goes to exactly the begin address, inside the call, with no fragment in back', async () => {
  const href = 'https://moth-play.xgames.test/gf/mp/?room=AB12&n=1#lobby';
  const w = load({ href });
  await w.gf.ready;
  await settled(w);
  const back = encodeURIComponent('https://moth-play.xgames.test/gf/mp/?room=AB12&n=1');
  void w.gf.signIn();
  assert.deepEqual(w.went, [`${SITE}/api/player/v1/x/begin?slug=moth&back=${back}`], 'moved before signIn returned');
  assert.equal(back, 'https%3A%2F%2Fmoth-play.xgames.test%2Fgf%2Fmp%2F%3Froom%3DAB12%26n%3D1');
  assert.deepEqual(w.opened, [], 'no window');
  assert.ok(!w.fetched.some(f => f.url.startsWith('/player/v1/request')), 'no sign-in request');

  const g = load({ href });
  await g.gf.ready;
  void g.gf.signIn('google');
  assert.deepEqual(g.went, [`${SITE}/api/player/v1/google/begin?slug=moth&back=${back}`]);
  // the address for a game's own <a href> button: the same one, and taking it moves nothing
  const l = load({ href });
  await l.gf.ready;
  assert.equal(l.gf.signInLink('google'), `${SITE}/api/player/v1/google/begin?slug=moth&back=${back}`);
  assert.equal(l.gf.signInLink(), `${SITE}/api/player/v1/x/begin?slug=moth&back=${back}`);
  assert.deepEqual(l.went, []);
});

test('back from that sign-in: xgames.fun is asked (even after a Sign out here) and the player is signed in', async () => {
  const w = load({ session: NAMED, browser: { 'gamesfun:moth:signed': '"out"' } });
  await w.gf.ready;
  await settled(w);
  assert.deepEqual(w.toSite(), []);
  void w.gf.signIn();
  // the tab came back: the same tab (what it kept), a new page
  const back = load({ session: NAMED, tab: Object.fromEntries(w.tab), browser: Object.fromEntries(w.browser) });
  assert.equal(plain(await back.gf.ready).id, 'x:42');
  assert.deepEqual(back.toSite(), [`GET ${SESSION}`]);
  assert.equal(back.browser.get('gamesfun:moth:signed'), '"in"');
});

test('#gf-signin=failed: the game is told, the word is taken out of the address, and nobody is signed in', async () => {
  const w = load({ href: 'https://moth-play.xgames.test/?room=AB12#gf-signin=failed', session: { player: null } });
  assert.equal(w.gf.signInEnded, 'failed');
  assert.deepEqual(w.replaced, ['/?room=AB12']);
  assert.equal(w.loc.href, 'https://moth-play.xgames.test/?room=AB12');
  assert.equal(await w.gf.ready, null);
  const c = load({ href: `${OWN}#gf-signin=cancelled` });
  assert.deepEqual([c.gf.signInEnded, c.replaced], ['cancelled', ['/']]);
  // any other word is the game's own
  const other = load({ href: `${OWN}#gf-signin=later` });
  assert.deepEqual([other.gf.signInEnded, other.replaced], [null, []]);
});

// ---- Sign out ----

test("Sign out tells xgames.fun to forget this game here (the game's own Sign out), and sticks", async () => {
  const w = load({ session: NAMED });
  await w.gf.ready;
  await w.gf.signOut();
  assert.deepEqual([w.gf.player, w.gf.token], [null, '']);
  const forget = w.fetched.find(f => f.url === FORGET);
  assert.deepEqual([forget.method, forget.credentials, JSON.parse(forget.body)], ['POST', 'include', { slug: 'moth' }]);
  assert.equal(w.browser.get('gamesfun:moth:signed'), '"out"');
  assert.equal(w.changes.at(-1), null);
});

// ---- framed ----

test("framed by xgames.fun's play page: none of these requests is made", async () => {
  const w = load({ framed: true, session: NAMED });
  w.from({ type: 'gf:host', v: 1, auth: true });
  assert.equal(await w.gf.ready, null);
  w.tick();
  await moment();
  void w.gf.signIn();
  await w.gf.signOut();
  w.show();
  w.tick();
  await moment();
  assert.deepEqual(w.toSite(), [], 'no question, no forget');
  assert.deepEqual(w.went, [], 'the tab is not moved');
  assert.equal(w.gf.signInLink(), '');
  assert.deepEqual(
    w.sent().map(m => m.type),
    ['gf:auth-signin', 'gf:auth-signout'],
    'the page above signs in and out',
  );
});

test("framed by xgames.fun's page that has not answered yet: the game waits for it and asks nothing", async () => {
  const w = load({ framed: true, session: NAMED, referrer: `${SITE}/play/moth` });
  w.tick(); // a second and a half, and nobody answered
  assert.equal(await w.gf.ready, null);
  await moment();
  assert.deepEqual(w.toSite(), []);
  w.from({ type: 'gf:host', v: 1, auth: true });
  w.tick();
  await moment();
  assert.deepEqual(w.toSite(), []);
});

test('framed by another page (a post on X): asked with no tap; Sign in opens the window, the tab stays', async () => {
  const w = load({ framed: true, session: { player: null }, referrer: 'https://x.test/post/1' });
  w.tick(); // no play page answered: the game signs in by itself
  await settled(w);
  assert.deepEqual(w.toSite(), [`GET ${SESSION}`]);
  assert.equal(w.gf.signInLink(), '', 'no link: a frame cannot move the tab');
  void w.gf.signIn();
  assert.deepEqual(w.went, []);
  assert.deepEqual(w.opened, [`${SITE}/go`], 'the window on xgames.fun, from the tap');
});
