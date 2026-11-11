// gamesfun.js's wallet-app calls (canOpenWallet, onCanOpenWallet, walletNeeded, openWallet), with the file loaded in a
// fake window (node:vm): the page above is an object that keeps what it was sent, so a test can tell that a message
// went out inside the call itself, before it returned, as a tap needs. The real thing, in Chrome inside a stand-in
// play page, is in client.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT } from './helpers.mjs';

const CLIENT = readFileSync(path.join(ROOT, 'lib', 'client', 'gamesfun.js'), 'utf8');
const SITE = 'https://xgames.test';
/** What came out of the fake window, as plain data of this realm. */
const plain = v => JSON.parse(JSON.stringify(v));

/**
 * The client in a fake window at moth-play.xgames.test. framed: a page above (it keeps what it is sent in `sent`);
 * else the game is its own page. Timers wait until `tick()` runs them. → {gf, sent, parent, from(data, {source,
 * origin}), tick()}
 */
function load({ framed = true } = {}) {
  const sent = [],
    listeners = [],
    timers = [];
  const loc = {
    host: 'moth-play.xgames.test',
    hostname: 'moth-play.xgames.test',
    pathname: '/',
    protocol: 'https:',
    origin: 'https://moth-play.xgames.test',
    href: 'https://moth-play.xgames.test/',
  };
  const win = {
    location: loc,
    URL,
    console,
    setTimeout: fn => timers.push(fn),
    clearTimeout() {},
    addEventListener: (type, fn) => type === 'message' && listeners.push(fn),
  };
  const ctx = vm.createContext(win);
  const parent = framed
    ? { postMessage: (data, target) => sent.push(plain({ data, target })) }
    : vm.runInContext('this', ctx);
  win.parent = parent;
  vm.runInContext(CLIENT, ctx);
  return {
    gf: win.GamesFun,
    sent: () => sent.map(m => m.data).filter(d => d.type !== 'gf:host-ready'),
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

test('walletNeeded with no play page above: nothing sent, and the answer says why', async () => {
  const alone = load({ framed: false });
  const r = await settle(alone.gf.walletNeeded());
  assert.equal(r.data, null);
  assert.equal(r.code, 'no-page');
  assert.match(r.error, /No xgames\.fun play page/);

  // framed, but nobody answers (a post on X): once the wait for a page is over
  const x = load();
  const p = x.gf.walletNeeded();
  x.tick();
  assert.equal((await settle(p)).code, 'no-page');
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
});

test('openWallet refuses a bad app, view or href, and sends nothing', async () => {
  const w = load();
  w.from(host({ openWallet: true }));
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
  for (const args of bad) {
    const r = await settle(w.gf.openWallet(...args));
    assert.equal(r.code, 'invalid', JSON.stringify(args));
    assert.equal(r.data, null);
    assert.equal(typeof r.error, 'string');
  }
  assert.deepEqual(w.sent(), [], 'nothing sent for any of them');
});

test("openWallet: 'no-page' with no play page above, 'not-offered' when the page does not open wallets", async () => {
  const alone = load({ framed: false });
  const r = await settle(alone.gf.openWallet('phantom'));
  assert.deepEqual([r.data, r.code], [null, 'no-page']);

  const w = load();
  assert.equal((await settle(w.gf.openWallet())).code, 'no-page', 'before the page answered');
  w.from(host());
  assert.equal((await settle(w.gf.openWallet())).code, 'not-offered', 'an older page that does not say');
  w.from(host({ openWallet: false }));
  const no = await settle(w.gf.openWallet('solflare'));
  assert.deepEqual([no.data, no.code], [null, 'not-offered']);
  assert.match(no.error, /does not open a wallet app/);
  assert.deepEqual(w.sent(), [], 'nothing sent');
  // a bad argument is said first, wherever the game is
  assert.equal((await settle(alone.gf.openWallet('metamask'))).code, 'invalid');
});

test('the version is 1.7.0', () => {
  assert.equal(load({ framed: false }).gf.version, '1.7.0');
});
