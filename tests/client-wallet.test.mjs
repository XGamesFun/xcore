// gamesfun.js's wallet-app calls (canOpenWallet, onCanOpenWallet, walletNeeded, openWallet), with the file loaded in a
// fake window (node:vm): the page above is an object that keeps what it was sent, and the tab's location keeps where
// it was sent, so a test can tell that a message went out (or the tab moved) inside the call itself, before it
// returned, as a tap needs. On the game's own host, loot's page client (gf/loot/wallets.js) is a small module in a
// temporary folder that answers the wallets a test says. The real thing, in Chrome inside a stand-in play page, is in
// client.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { ROOT, tempDir } from './helpers.mjs';

const CLIENT = readFileSync(path.join(ROOT, 'lib', 'client', 'gamesfun.js'), 'utf8');
const SITE = 'https://xgames.test';
/** What came out of the fake window, as plain data of this realm. */
const plain = v => JSON.parse(JSON.stringify(v));

// what each fake gf/loot/wallets.js answers, by its number, and the waits it was asked for
globalThis.walletsFor = {};
let made = 0;
/**
 * A folder for the client with gf/loot/wallets.js beside it, answering `wallets` (a list a test may change), or with
 * no such file (`wallets: null`: a game without an economy). → {script: the client's file: URL, wallets}
 */
async function lootFolder(t, wallets) {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const n = ++made;
  globalThis.walletsFor[n] = { list: wallets, asked: [] };
  if (wallets !== null) {
    await mkdir(path.join(tmp.dir, 'gf', 'loot'), { recursive: true });
    await writeFile(
      path.join(tmp.dir, 'gf', 'loot', 'wallets.js'),
      `export async function solanaWallets({ waitMs } = {}) {
        const w = globalThis.walletsFor[${n}]; w.asked.push(waitMs); return w.list; }`,
    );
  }
  return { script: pathToFileURL(path.join(tmp.dir, 'gamesfun.js')).href, wallets: globalThis.walletsFor[n] };
}

/**
 * The client in a fake window at `href` (moth-play.xgames.test). framed: a page above (it keeps what it is sent in
 * `sent`); else the game is the top window. script: the client's own address (where gf/loot/ is looked for). Timers
 * wait until `tick()` runs them. → {gf, sent, went, parent, from(data, {source, origin}), tick()}
 */
function load({ framed = true, href = 'https://moth-play.xgames.test/', script } = {}) {
  const sent = [],
    went = [],
    listeners = [],
    timers = [];
  const u = new URL(href);
  const loc = {
    host: u.host,
    hostname: u.hostname,
    pathname: u.pathname,
    protocol: u.protocol,
    origin: u.origin,
    href: u.href,
    assign: to => went.push(String(to)),
  };
  const win = {
    location: loc,
    URL,
    console,
    setTimeout: fn => timers.push(fn),
    clearTimeout() {},
    addEventListener: (type, fn) => type === 'message' && listeners.push(fn),
  };
  if (script) win.document = { currentScript: { src: script } };
  const ctx = vm.createContext(win);
  const parent = framed
    ? { postMessage: (data, target) => sent.push(plain({ data, target })) }
    : vm.runInContext('this', ctx);
  win.parent = parent;
  vm.runInContext(CLIENT, ctx, { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
  return {
    gf: win.GamesFun,
    sent: () => sent.map(m => m.data).filter(d => d.type !== 'gf:host-ready'),
    went,
    parent,
    /** A message to the game: from the page above at xgames.fun unless said otherwise. */
    from(data, { source = parent, origin = SITE } = {}) {
      for (const fn of listeners) fn({ source, origin, data });
    },
    tick() {
      for (const fn of timers.splice(0)) fn();
    },
  };
}
const host = (extra = {}) => ({ type: 'gf:host', v: 1, auth: true, ...extra });
/** The answer, without waiting longer than a moment. */
const settle = p => Promise.race([p, new Promise(r => setTimeout(() => r('still waiting'), 500))]).then(plain);
/** canOpenWallet's next value. */
const next = gf => new Promise(r => gf.onCanOpenWallet(r));
const moment = () => new Promise(r => setTimeout(r, 200));

// ---- inside xgames.fun's play page ----

test('canOpenWallet: null until the page says, then what it says, and every change is told', () => {
  const w = load();
  const seen = [];
  w.gf.onCanOpenWallet(v => seen.push(v));
  assert.equal(w.gf.canOpenWallet(), null, 'no page has answered');
  w.from(host());
  assert.equal(w.gf.canOpenWallet(), null, 'an older page says nothing about it');
  w.from(host({ openWallet: false }));
  assert.equal(w.gf.canOpenWallet(), false, "a developer's browser, or a wallet is here");
  w.from(host({ openWallet: true }));
  assert.equal(w.gf.canOpenWallet(), true, 'no wallet here: the page opens one');
  w.from(host({ openWallet: true }));
  w.from(host({ openWallet: false }));
  w.from(host({ openWallet: 'yes' }));
  assert.equal(w.gf.canOpenWallet(), null, 'not a boolean: not known');
  assert.deepEqual(seen, [false, true, false, null], 'each change once, nothing for the same value again');
  const off = w.gf.onCanOpenWallet(v => seen.push(`second ${v}`));
  off();
  w.from(host({ openWallet: true }));
  assert.equal(seen.at(-1), true, 'a listener taken off hears nothing');
});

test('a message from a window that is not the page above, or from another site, changes nothing', () => {
  const w = load();
  w.from(host({ openWallet: true }), { source: {} });
  assert.equal(w.gf.canOpenWallet(), null, 'another window');
  w.from(host({ openWallet: true }), { origin: 'https://evil.test' });
  assert.equal(w.gf.canOpenWallet(), null, 'the page above, but not at xgames.fun');
  w.from(host({ openWallet: false }));
  w.from(host({ openWallet: true }), { source: {} });
  assert.equal(w.gf.canOpenWallet(), false);
});

test('walletNeeded tells the page above once a page load, however often it is called', async () => {
  const w = load();
  w.from(host({ openWallet: true }));
  for (let i = 0; i < 3; i++)
    assert.deepEqual(await settle(w.gf.walletNeeded()), { data: { told: true }, error: null, status: 200 });
  assert.deepEqual(w.sent(), [{ type: 'gf:wallet-need', v: 1 }]);
  w.from(host({ openWallet: false }));
  await w.gf.walletNeeded();
  assert.equal(w.sent().length, 1, 'a later gf:host does not send it again');
});

test('walletNeeded before the page above answered: it goes when the page does', async () => {
  const w = load();
  const answer = w.gf.walletNeeded();
  assert.deepEqual(w.sent(), [], 'no page known yet: nothing sent');
  w.from(host({ openWallet: true }));
  assert.deepEqual(w.sent(), [{ type: 'gf:wallet-need', v: 1 }]);
  assert.deepEqual((await settle(answer)).data, { told: true });
  w.from(host({ openWallet: true }));
  assert.equal(w.sent().length, 1);
});

test('walletNeeded framed by something that is not the play page: nothing sent, and the answer says why', async () => {
  // framed, and nobody answers (a post on X's timeline frames the game inside X's site): once the wait is over
  const x = load();
  const p = x.gf.walletNeeded();
  x.tick();
  const r = await settle(p);
  assert.deepEqual([r.data, r.code], [null, 'no-page']);
  assert.match(r.error, /No xgames\.fun play page/);
  assert.deepEqual(x.sent(), []);
});

test('openWallet posts the exact message inside the call, before it returns', async () => {
  const w = load();
  w.from(host({ openWallet: true }));
  const cases = [
    [[], { type: 'gf:open-wallet', v: 1, app: 'phantom' }],
    [['solflare'], { type: 'gf:open-wallet', v: 1, app: 'solflare' }],
    [['browser', { view: 'wallet' }], { type: 'gf:open-wallet', v: 1, app: 'browser', view: 'wallet' }],
    [
      ['phantom', { view: 'claim', href: 'https://xgames.fun/play/moth?claim=7' }],
      { type: 'gf:open-wallet', v: 1, app: 'phantom', view: 'claim', href: 'https://xgames.fun/play/moth?claim=7' },
    ],
  ];
  for (const [args, msg] of cases) {
    const before = w.sent().length;
    const answer = w.gf.openWallet(...args);
    // checked right after the call, with no await between: the post happened inside it
    assert.deepEqual(w.sent().slice(before), [msg], JSON.stringify(args));
    assert.deepEqual(await settle(answer), { data: { asked: true }, error: null, status: 200 });
  }
  assert.deepEqual(w.went, [], 'the tab stays: the page above does the opening');
});

test('openWallet refuses a bad app, view or href, and sends nothing', async () => {
  const bad = [
    ['metamask'],
    [''],
    [null],
    ['Phantom'],
    ['phantom', 'claim'],
    ['phantom', null],
    ['phantom', { view: 'shop' }],
    ['phantom', { view: 'claim' }],
    ['phantom', { view: 'claim', href: '' }],
    ['phantom', { view: 'claim', href: 42 }],
    ['phantom', { href: 'https://xgames.fun/play/moth' }],
    ['phantom', { view: 'wallet', href: 'https://xgames.fun/play/moth' }],
  ];
  const w = load();
  w.from(host({ openWallet: true }));
  const own = load({ framed: false });
  for (const g of [w, own]) {
    for (const args of bad) {
      const r = await settle(g.gf.openWallet(...args));
      assert.equal(r.code, 'invalid', JSON.stringify(args));
      assert.equal(r.data, null);
      assert.equal(typeof r.error, 'string');
    }
    assert.deepEqual([g.sent(), g.went], [[], []], 'nothing sent, and the tab stays');
  }
});

test("openWallet: 'no-page' framed by something else, 'not-offered' when the play page does not open wallets", async () => {
  // framed by X's timeline (nobody answers), or by a site that is not xgames.fun: a frame cannot move the tab
  const x = load();
  x.from(host({ openWallet: true }), { origin: 'https://evil.test' });
  x.tick();
  await x.gf.ready;
  const r = await settle(x.gf.openWallet('phantom'));
  assert.deepEqual([r.data, r.code], [null, 'no-page']);
  assert.deepEqual([x.sent(), x.went], [[], []], 'nothing sent, and the tab stays');

  const w = load();
  assert.equal((await settle(w.gf.openWallet())).code, 'no-page', 'before the page answered');
  w.from(host());
  assert.equal((await settle(w.gf.openWallet())).code, 'not-offered', 'an older page that does not say');
  w.from(host({ openWallet: false }));
  const no = await settle(w.gf.openWallet('solflare'));
  assert.deepEqual([no.data, no.code], [null, 'not-offered']);
  assert.match(no.error, /does not open a wallet app/);
  assert.deepEqual([w.sent(), w.went], [[], []], 'nothing sent');
});

// ---- on the game's own host, the top window (a post's card on X opens it by itself) ----

/** xgames.fun's wallet page for moth, coming back to `back`. */
const walletPage = (app, back) => `${SITE}/wallet/open?slug=moth&app=${app}&back=${encodeURIComponent(back)}`;

test('on its own host, openWallet sends this tab to the wallet page inside the call, back to this page', async () => {
  const href = 'https://moth-play.xgames.test/?level=2&who=%C3%A9t%C3%A9&a=b+c#claim';
  const own = 'https://moth-play.xgames.test/?level=2&who=%C3%A9t%C3%A9&a=b+c';
  const cases = [
    [[], walletPage('phantom', own)],
    [['solflare', { view: 'wallet' }], walletPage('solflare', own)],
    // href on this same host: the way back (its fragment cut)
    [
      ['browser', { view: 'claim', href: '/?claim=7&x=%2F#top' }],
      walletPage('browser', 'https://moth-play.xgames.test/?claim=7&x=%2F'),
    ],
    // not on this game's own host: replaced by this page
    [['phantom', { view: 'claim', href: 'https://xgames.fun/play/moth?claim=7' }], walletPage('phantom', own)],
    [['phantom', { view: 'claim', href: 'https://other-play.xgames.test/?claim=7' }], walletPage('phantom', own)],
    [['phantom', { view: 'claim', href: 'javascript:alert(1)' }], walletPage('phantom', own)],
  ];
  for (const [args, to] of cases) {
    const w = load({ framed: false, href });
    const answer = w.gf.openWallet(...args);
    // checked right after the call, with no await between: the tab was sent inside it
    assert.deepEqual(w.went, [to], JSON.stringify(args));
    assert.deepEqual(await settle(answer), { data: { asked: true, left: true }, error: null, status: 200 });
    assert.deepEqual(w.sent(), []);
  }
  assert.equal(
    walletPage('phantom', own),
    'https://xgames.test/wallet/open?slug=moth&app=phantom&back=https%3A%2F%2Fmoth-play.xgames.test%2F%3Flevel%3D2%26who%3D%25C3%25A9t%25C3%25A9%26a%3Db%2Bc',
    'everything in back encoded',
  );
});

test("on the play host's path form (play.<site>/p/<slug>/), back stays inside this game's folder", () => {
  const w = load({ framed: false, href: 'https://play.xgames.test/p/moth/index.html?l=1' });
  w.gf.openWallet('phantom', { view: 'claim', href: 'https://play.xgames.test/p/other/?claim=1' });
  w.gf.openWallet('phantom', { view: 'claim', href: './?claim=2' });
  assert.deepEqual(w.went, [
    walletPage('phantom', 'https://play.xgames.test/p/moth/index.html?l=1'),
    walletPage('phantom', 'https://play.xgames.test/p/moth/?claim=2'),
  ]);
});

test('on its own host, walletNeeded has nobody to tell: told false, not an error', async () => {
  const w = load({ framed: false });
  assert.deepEqual(await settle(w.gf.walletNeeded()), { data: { told: false }, error: null, status: 200 });
  assert.deepEqual(w.sent(), []);
});

test(
  'on its own host, canOpenWallet is null until the look for a wallet settles, then true with none',
  { timeout: 10_000 },
  async t => {
    const { script, wallets } = await lootFolder(t, []);
    const w = load({ framed: false, script });
    const changed = next(w.gf);
    assert.equal(w.gf.canOpenWallet(), null, 'not settled yet');
    assert.equal(await changed, true);
    assert.equal(w.gf.canOpenWallet(), true);
    assert.deepEqual(wallets.asked, [400], "loot's page client asked, with gf.loot.ready()'s wait");
    // a wallet that registers late: looked at once more
    wallets.list = [{ name: 'Phantom' }];
    const late = next(w.gf);
    await moment(); // the second look is set once the first has answered
    w.tick();
    assert.equal(await late, false);
    assert.equal(w.gf.canOpenWallet(), false);
  },
);

test(
  'on its own host, canOpenWallet is false with a wallet here, and null with no loot page client',
  { timeout: 10_000 },
  async t => {
    const has = await lootFolder(t, [{ name: 'Solflare' }]);
    const w = load({ framed: false, script: has.script });
    const changed = next(w.gf);
    await w.gf.walletNeeded();
    assert.equal(await changed, false);
    assert.equal(w.gf.canOpenWallet(), false);

    const none = await lootFolder(t, null);
    const n = load({ framed: false, script: none.script });
    n.gf.canOpenWallet();
    await moment();
    assert.equal(n.gf.canOpenWallet(), null, 'nothing to ask: not known');

    // framed by something that is not the play page: not looked for at all
    const framed = await lootFolder(t, []);
    const f = load({ script: framed.script });
    f.gf.canOpenWallet();
    await moment();
    assert.deepEqual([f.gf.canOpenWallet(), framed.wallets.asked], [null, []]);
  },
);

test('the version is 1.8.0', () => {
  assert.equal(load({ framed: false }).gf.version, '1.8.0');
});
