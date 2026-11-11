// The sign-in client xgames.fun serves (lib/client/signin-v1.js) is the function gamesfun.js carries, and nothing
// else: made from it by lib/signin-client.mjs, held equal here, so the copy a game carries and the one its host serves
// can only differ by being of different versions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIGNIN_FILE, SIGNIN_PATH, SIGNIN_SOURCE, signinModule, signinModuleState } from '../lib/signin-client.mjs';

test('lib/client/signin-v1.js is what gamesfun.js makes (node lib/signin-client.mjs --write)', () => {
  const state = signinModuleState();
  assert.ok(state.same, 'lib/client/signin-v1.js is stale: node lib/signin-client.mjs --write');
});

test('the module is the carried function, whole, and exports the version in its address', async () => {
  const client = readFileSync(SIGNIN_SOURCE, 'utf8'),
    made = readFileSync(SIGNIN_FILE, 'utf8');
  assert.equal(SIGNIN_PATH, '/platform/v1/signin/v1.js');
  assert.ok(client.includes(`var SIGNIN_URL = '${SIGNIN_PATH}';`), 'the address gamesfun.js asks is the one served');
  // every line of the function, as gamesfun.js has it (two spaces further in there)
  const carried = client.slice(
    client.indexOf('/* signin-client:start */\n') + '/* signin-client:start */\n'.length,
    client.indexOf('  /* signin-client:end */'),
  );
  const fn = made.slice(made.indexOf('function signin(host) {'), made.indexOf('\n/** The version of'));
  assert.equal(fn.trimEnd(), carried.replace(/^ {2}/gm, '').trimEnd());
  const m = await import('../lib/client/signin-v1.js');
  assert.equal(m.v, 1);
  assert.equal(typeof m.default, 'function');
  // it touches nothing of the page it is given no name for: no eval, no script it loads, no address but the site's,
  // its own host's and the one it is handed
  assert.ok(!/\beval\(|new Function\(|import\(|document\.write|innerHTML/.test(fn));
});

test('the marks must be there, once each, around function signin(host)', () => {
  assert.throws(() => signinModule('var x = 1;'), /marks are not there/);
  assert.throws(
    () => signinModule('/* signin-client:start */\n  var x = 1;\n  /* signin-client:end */'),
    /no function signin/,
  );
  assert.throws(
    () => signinModule('/* signin-client:start */\nfunction signin(host) {}\n  /* signin-client:end */'),
    /not indented/,
  );
});

/** The client with a page's own names stood in (no browser): `where` it is, what it keeps, what it was told. */
function client({
  where = 'edge',
  framed = false,
  stay = false,
  href = 'https://moth-play.xgames.fun/gf/mp/?room=AB12',
} = {}) {
  const kept = { value: null },
    moved = [];
  globalThis.location = { href, assign: u => moved.push(u) };
  const state = { player: null, token: '', expires: 0 };
  const host = {
    v: 1,
    slug: 'moth',
    site: 'https://xgames.fun',
    where,
    framed,
    panel: false,
    stay,
    returned: null,
    // gamesfun.js hands over this page's address with no fragment
    back: () => href.replace(/#.*$/, ''),
    tab: null,
    ask: null,
    state: () => state,
    set: (player, token, expires) => Object.assign(state, { player, token, expires }),
    code: () => {},
    mark: () => null,
    kept: v => (v === undefined ? kept.value : ((kept.value = v), null)),
  };
  return { kept, moved, host };
}

test("a page that draws the provider's button itself gets the address of a real link, only where a sign-in takes the tab to X", async t => {
  const { default: signin } = await import('../lib/client/signin-v1.js');
  const saved = { location: globalThis.location };
  t.after(() => Object.assign(globalThis, saved));
  const begin =
    'https://xgames.fun/api/player/v1/x/begin?slug=moth&back=https%3A%2F%2Fmoth-play.xgames.fun%2Fgf%2Fmp%2F%3Froom%3DAB12';
  // the top window of the game's own link (a phone or a computer): the link, for X and for Google
  let c = client();
  let d = signin(c.host);
  assert.equal(d.link({ how: 'x' }), begin);
  assert.equal(d.link({ how: 'google' }), begin.replace('/x/begin', '/google/begin'));
  assert.equal(c.kept.value, null, 'asking for the address begins nothing');
  // the link's own click tells the client; the client moves nothing (the tap on the link does) and remembers the tap
  d.signIn({ how: 'x', link: true });
  assert.deepEqual(c.moved, []);
  assert.ok(c.kept.value.b.at > Date.now() - 1000);
  d.signOut(); // (the sign-in would wait ten minutes for its answer: ended here)
  assert.equal(c.kept.value, null);
  // the address it comes back to has no fragment at all (a word left by a sign-in that came back with nobody, the
  // game's own)
  for (const hash of ['#gf-signin=cancelled', '#lobby'])
    assert.match(
      signin(client({ href: `https://moth-play.xgames.fun/${hash}` }).host).link({}),
      /&back=https%3A%2F%2Fmoth-play\.xgames\.fun%2F$/,
    );
  // without a link, the same sign-in moves the tab itself, from inside the click
  c = client();
  d = signin(c.host);
  d.signIn({ how: 'google' });
  assert.deepEqual(c.moved, [begin.replace('/x/begin', '/google/begin')]);
  d.signOut();
  // nowhere else: a frame, the game's own domain, a host games share, a page that stays
  for (const [name, options, opts] of [
    ['a frame', { framed: true }, {}],
    ["the game's own domain", { where: 'domain' }, {}],
    ['a host games share', { where: 'path' }, {}],
    ['a page that stays', { stay: true }, {}],
    ['a call that stays', {}, { stay: true }],
  ])
    assert.equal(signin(client(options).host).link(opts), '', name);
});
