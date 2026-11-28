// `xcore dev`'s stand-in for xgames.fun's play page (lib/dev/play.mjs, at /play/): the game in the play page's frame,
// signed in by the page above as xgames.fun signs a player in there, so gf.ready, the first save read and a sign-in or
// sign-out from inside the frame are seen before publishing. And what dev says about a page it builds.
/* global window, GamesFun -- the page's, inside evaluate */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NOT_IMITATED, startDev } from '../lib/dev/index.mjs';
import { PLAY_PATH } from '../lib/dev/play.mjs';
import { PLAY_FRAME_SANDBOX } from '../lib/play-policy.mjs';
import { findChrome, playwrightChromium, ensureBrowser } from '../lib/browser.mjs';
import { ROOT, tempDir } from './helpers.mjs';

const browserHere = findChrome() ?? ((await playwrightChromium()).installed ? true : null);
const noChrome = browserHere ? false : 'no Chrome, Edge or Chromium here';

/** A game that reads its save as it boots, before gf.ready and once it answered. */
async function game(dir) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'index.html'),
    `<!doctype html><html><head><script src="./gamesfun.js"></script></head><body>
     <button id="in" onclick="window.signedIn = GamesFun.signIn()">Sign in</button>
     <script>window.changes = []; GamesFun.onChange(p => changes.push(p));
     window.boot = GamesFun.ready.then(async p => ({ ready: p && p.id, save: (await GamesFun.saves.get('main')).data }));</script>
     </body></html>`,
  );
  await writeFile(path.join(dir, 'gamesfun.js'), await readFile(path.join(ROOT, 'lib', 'client', 'gamesfun.js')));
  return dir;
}

test('the play page stand-in is served at /play/, framing /game/ in the play sandbox; dev says what it does not imitate', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const logs = [];
  const dev = await startDev(await game(path.join(tmp.dir, 'moth')), {
    port: 0,
    filesPort: 0,
    verbose: true,
    log: m => logs.push(m),
    env: {},
  });
  t.after(() => dev.close());
  assert.equal(dev.play, `${dev.origin}${PLAY_PATH}`);
  const r = await fetch(dev.play);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes(`sandbox="${PLAY_FRAME_SANDBOX}"`), 'the play frame sandbox');
  assert.ok(html.includes('frame.src = "/game/"'));
  assert.ok(
    logs.some(l => l.startsWith(`play: ${dev.play} frames the game`)),
    logs.join('\n'),
  );
  assert.match(NOT_IMITATED, /a room's CPU per message is not timed/);
  assert.ok(logs.includes(NOT_IMITATED));
});

test('dev builds a page once, and says so', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = path.join(tmp.dir, 'built');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'make.mjs'),
    "import { mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync('dist', { recursive: true });\nwriteFileSync('dist/index.html', '<!doctype html><title>g</title>');\n",
  );
  await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify({ page: { build: 'node make.mjs', out: 'dist' } }));
  const logs = [];
  const dev = await startDev(dir, { port: 0, filesPort: 0, log: m => logs.push(m), env: process.env });
  t.after(() => dev.close());
  assert.ok(
    logs.some(l =>
      /^build: built once, as dev started\. After a change to the page's source, restart xcore dev, or keep your own build running in watch mode: dev serves dist\/ as it is on disk$/.test(
        l,
      ),
    ),
    logs.join('\n'),
  );
});

test(
  "gamesfun.js in dev's play page: signed in by the page above, there when gf.ready answers after a reload, and out again",
  { skip: noChrome, timeout: 120_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dev = await startDev(await game(path.join(tmp.dir, 'moth')), {
      port: 0,
      filesPort: 0,
      log: () => {},
      env: {},
    });
    t.after(() => dev.close());
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ executablePath: (await ensureBrowser({})).path });
    t.after(() => browser.close());
    const page = await (await browser.newContext()).newPage();
    const frameOf = async () => {
      const f = await (await page.waitForSelector('#game')).contentFrame();
      await f.waitForFunction(() => window.boot);
      return f;
    };
    await page.goto(dev.play);
    let f = await frameOf();
    assert.deepEqual(await f.evaluate(() => window.boot), { ready: null, save: null }, 'nobody signed in');
    // Sign in from inside the game: the page above signs a dev player in and hands the game its token
    const player = await f.evaluate(() => GamesFun.signIn());
    assert.ok(player?.dev && /^dev:/.test(player.id), JSON.stringify(player));
    assert.equal((await f.evaluate(() => GamesFun.saves.put('main', { level: 7 }))).error, null);
    assert.deepEqual(await f.evaluate(() => GamesFun.saves.list()).then(r => r.data.map(k => k.key)), ['main']);
    // a reload of the play page: its player again, there when gf.ready answers, and the save read is the account's
    await page.reload();
    f = await frameOf();
    assert.deepEqual(await f.evaluate(() => window.boot), { ready: player.id, save: { level: 7 } });
    // Sign out on the page above: the game hears it
    await page.click('#out');
    await f.waitForFunction(() => GamesFun.player === null);
    assert.equal(await f.evaluate(() => GamesFun.token), '');
  },
);
