// The tests that drive a browser skip themselves on a machine with none. Held here: each says so with the one reason
// tests/browser-skips.mjs counts, every test that starts a browser carries its file's guard (an unguarded one would
// download Chromium in the middle of `npm test`), and the run's last line says how many did not run and what to do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import browserSkips, { browserSkipsLine, NO_BROWSER } from './browser-skips.mjs';
import { ROOT } from './helpers.mjs';

const files = readdirSync(path.join(ROOT, 'tests'))
  .filter(f => f.endsWith('.test.mjs'))
  .map(f => ({ name: f, text: readFileSync(path.join(ROOT, 'tests', f), 'utf8') }));
/** A test file's guard: `const skip = browserHere ? false : '<reason>';` → {name (skip, noChrome…), reason} or null */
const guardOf = text => {
  const m = /^const (\w+) = \w+ \? false : '([^']*(?:Chrome|browser)[^']*)';$/m.exec(text);
  return m ? { name: m[1], reason: m[2] } : null;
};
/** What starts a browser in a test: the launch itself, the helper a file wraps it in, the page check. */
const STARTS_A_BROWSER = /\bensureBrowser\(|\.launch\(|\bawait chrome\(|\bpageVerify\(/;

test('a run with no browser ends with one line: how many browser tests did not run, and how to get one', async () => {
  const skipped = (name, skip) => ({ type: 'test:pass', data: { name, skip } });
  const run = async events => {
    let out = '';
    for await (const text of browserSkips(events)) out += text;
    return out;
  };
  const line = await run([
    skipped('the page check', NO_BROWSER),
    { type: 'test:pass', data: { name: 'a test that ran' } },
    skipped('the game’s server', 'GAMESFUN_SERVER_DEPS (a folder with miniflare) is not set'),
    skipped('gamesfun.js in Chrome', NO_BROWSER),
    { type: 'test:fail', data: { name: 'a test that failed' } },
  ]);
  assert.equal(
    line,
    "\n2 browser tests did not run: no Chrome, Edge or Chromium here. To run them, install Google Chrome or Chromium (or set CHROME_PATH to one), or get Playwright's own: npx playwright-core install chromium\n",
  );
  assert.match(browserSkipsLine(1), /^\n1 browser test did not run: .* To run it, install/);
  assert.equal(await run([{ type: 'test:pass', data: { name: 'ran' } }]), '', 'nothing to say when they all ran');
});

test('every browser guard gives the reason the last line counts', () => {
  const guarded = files.filter(f => guardOf(f.text));
  assert.ok(guarded.length >= 8, `${guarded.length} test files have a browser guard`);
  for (const f of guarded) assert.equal(guardOf(f.text).reason, NO_BROWSER, f.name);
});

test('every test that starts a browser is skipped where there is none', () => {
  const unguarded = [];
  for (const f of files) {
    if (!STARTS_A_BROWSER.test(f.text)) continue;
    const guard = guardOf(f.text);
    assert.ok(guard, `${f.name} starts a browser and has no guard`);
    // each test, from its opening line to the line that closes it
    for (const part of f.text.split(/^(?=test\()/m).filter(part => part.startsWith('test('))) {
      const body = part.slice(0, part.search(/^\}?\);$/m));
      if (!STARTS_A_BROWSER.test(body)) continue;
      const [, , name, options] = /^test\(\s*(['"`])([\s\S]*?)\1([\s\S]*?)(?:\basync\b|\(\)\s*=>|\bt\s*=>)/.exec(body);
      if (!new RegExp(`\\b${guard.name}\\b`).test(options)) unguarded.push(`${f.name}: ${name}`);
    }
  }
  assert.deepEqual(unguarded, []);
});
