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
