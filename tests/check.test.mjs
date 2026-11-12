// The page check in real Chrome: a clean static game passes all four; a page that calls a site backend.json does not
// list fails "it stays inside its origins". Skipped where there is no Chrome, Edge or Chromium (and no Playwright one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adopt } from '../lib/publish/adopt.mjs';
import { findChrome, playwrightChromium, playwrightCli } from '../lib/browser.mjs';
import { FRAME_BLOCKS, pageVerify } from '../lib/check.mjs';
import { PLAY_FRAME_ALLOW, PLAY_FRAME_SANDBOX } from '../lib/play-policy.mjs';
import { fixture, ROOT, tempDir } from './helpers.mjs';

const browser = findChrome() ?? ((await playwrightChromium()).installed ? true : null);
const skip = browser ? false : 'no Chrome, Edge or Chromium here';

// runs everywhere: CI has Chrome, so the download a machine without one takes is never reached there
test("playwright-core's command line, which downloads Chromium where there is no Chrome, is found", () => {
  const cli = playwrightCli();
  assert.equal(path.basename(cli), 'cli.js');
  assert.ok(existsSync(cli), cli);
});

test(
  "a static game passes: it fits the hosting, starts clean at both sizes and inside the play page's frame, stays inside its origins",
  { skip, timeout: 180_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await fixture(tmp, 'static');
    await adopt(dir);
    const out = path.join(tmp.dir, 'out');
    const r = await pageVerify(dir, { out });
    assert.equal(r.kind, 'brought-page');
    assert.equal(r.pass, true, JSON.stringify(r.checks));
    assert.deepEqual(
      r.checks.map(c => [c.n, c.ok]),
      [
        [1, null],
        [2, true],
        [3, true],
        [4, true],
      ],
    );
    const three = r.checks.find(c => c.n === 3);
    assert.match(
      three.detail,
      /at 393x660 and 1280x800 and inside the play page's frame \(as players meet it\) at 393x660/,
    );
    assert.match(three.detail, /\?from=check/);
    for (const shot of ['phone.png', 'desktop.png', 'framed.png']) assert.ok(existsSync(path.join(out, shot)), shot);
  },
);

// ---- inside the play page's frame ----------------------------------------------------------------------------------

/** The static fixture, adopted, with `script` run as its page loads. → its folder */
async function pageWith(tmp, script, html = '') {
  const dir = await fixture(tmp, 'static');
  const index = path.join(dir, 'index.html');
  await writeFile(
    index,
    (await readFile(index, 'utf8')).replace('</body>', `${html}<script>${script}</script></body>`),
  );
  await adopt(dir);
  return dir;
}
const FRAMED = "inside the play page's frame (as players meet it)";

test('the play frame the check builds is the one README.md names', () => {
  const row = readFileSync(path.join(ROOT, 'README.md'), 'utf8')
    .split('\n')
    .find(l => l.includes('**Inside the play page**'));
  assert.ok(row.includes(`sandbox="${PLAY_FRAME_SANDBOX}"`), row);
  assert.ok(row.includes(`allow="${PLAY_FRAME_ALLOW}"`), row);
});

test(
  "a page that opens a pop-up as it loads fails only inside the play page's frame, which blocks pop-ups",
  { skip, timeout: 180_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await pageWith(tmp, "window.open('about:blank');");
    const r = await pageVerify(dir, { out: path.join(tmp.dir, 'out') });
    const three = r.checks.find(c => c.n === 3);
    assert.equal(three.ok, false, JSON.stringify(r.checks));
    assert.equal(three.detail, `${FRAMED}: ${FRAME_BLOCKS.popup}`);
    assert.match(three.detail, /README\.md.*"Inside the play page"/);
    assert.equal(r.checks.find(c => c.n === 4).ok, true, JSON.stringify(r.checks));
  },
);

test(
  "a page that submits a form as it loads fails: the play page's frame blocks form submits",
  { skip, timeout: 180_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await pageWith(
      tmp,
      "document.getElementById('f').submit();",
      '<form id="f" action="./"><input name="q" value="1"></form>',
    );
    const r = await pageVerify(dir, { out: path.join(tmp.dir, 'out') });
    assert.equal(r.pass, false);
    const three = r.checks.find(c => c.n === 3);
    assert.equal(three.ok, false, JSON.stringify(r.checks));
    assert.ok(three.detail.includes(`${FRAMED}: ${FRAME_BLOCKS.form}`), three.detail);
  },
);

test(
  "a page that navigates the top window fails inside the play page's frame, caught or not, and is not counted as thrown",
  { skip, timeout: 180_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    // only where it is framed: at the top of its own tab, top.location is the page itself
    const dir = await pageWith(
      tmp,
      "if (window !== top) { try { top.location.href = './'; } catch {} setTimeout(() => { top.location = './'; }); }",
    );
    const r = await pageVerify(dir, { out: path.join(tmp.dir, 'out') });
    const three = r.checks.find(c => c.n === 3);
    assert.equal(three.detail, `${FRAMED}: ${FRAME_BLOCKS.top}`, JSON.stringify(r.checks));
  },
);

test(
  "a page that breaks when its link carries a query string fails inside the play page's frame: what the frame throws and logs is caught",
  { skip, timeout: 180_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await pageWith(
      tmp,
      "if (location.search) { console.error('logged in the frame: ' + location.search); throw new Error('x'); }",
    );
    const r = await pageVerify(dir, { out: path.join(tmp.dir, 'out') });
    const three = r.checks.find(c => c.n === 3);
    assert.equal(three.ok, false, JSON.stringify(r.checks));
    assert.ok(three.detail.includes(`${FRAMED}: thrown: x`), three.detail);
    assert.ok(three.detail.includes(`${FRAMED}: console: logged in the frame: ?from=check`), three.detail);
    assert.doesNotMatch(three.detail, /phone|desktop/);
  },
);

test(
  'a page calling an origin backend.json does not list fails check 4, naming it',
  { skip, timeout: 180_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await fixture(tmp, 'undeclared');
    await adopt(dir);
    const r = await pageVerify(dir, { out: path.join(tmp.dir, 'out') });
    const four = r.checks.find(c => c.n === 4);
    assert.equal(four.ok, false);
    assert.match(four.detail, /api\.scoreboard-example\.net/);
  },
);

test(
  'a game with its own server/: the page calling api/ passes, with a note that its server answers once published',
  { skip, timeout: 180_000 },
  async t => {
    const { mkdir, readFile, writeFile } = await import('node:fs/promises');
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await fixture(tmp, 'static');
    await mkdir(path.join(dir, 'server'));
    await writeFile(
      path.join(dir, 'server', 'index.js'),
      'export default { fetch: () => Response.json({ ok: true }) };\n',
    );
    const html = path.join(dir, 'index.html');
    await writeFile(
      html,
      (await readFile(html, 'utf8')).replace(
        '</body>',
        "<script>fetch('api/visits', { method: 'POST' }).catch(() => {}); const u = new URL('api/room', document.baseURI); u.protocol = u.protocol.replace('http', 'ws'); new WebSocket(u);</script></body>",
      ),
    );
    await adopt(dir);
    const r = await pageVerify(dir, { out: path.join(tmp.dir, 'out') });
    assert.equal(r.pass, true, JSON.stringify(r.checks));
    assert.ok(
      r.notes.some(n => /It calls its own server \(api\/visits, api\/room\)/.test(n)),
      r.notes.join('\n'),
    );
  },
);

test('the check serves byte ranges as the play host does (a video seeks)', async t => {
  const { servePage } = await import('../lib/check.mjs');
  const { writeFile } = await import('node:fs/promises');
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  await writeFile(path.join(tmp.dir, 'clip.mp4'), Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256)));
  const site = await servePage(tmp.dir);
  t.after(site.close);
  const part = await fetch(`${site.url}clip.mp4`, { headers: { range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 100-199/1000');
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())].slice(0, 3), [100, 101, 102]);
  const tail = await fetch(`${site.url}clip.mp4`, { headers: { range: 'bytes=-10' } });
  assert.equal(tail.headers.get('content-range'), 'bytes 990-999/1000');
  assert.equal((await fetch(`${site.url}clip.mp4`, { headers: { range: 'bytes=5000-' } })).status, 416);
  const whole = await fetch(`${site.url}clip.mp4`);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
});

test(
  "a Web Worker's request to a site backend.json does not list fails check 4, as the page's own would",
  { skip, timeout: 180_000 },
  async t => {
    const { readFile, writeFile } = await import('node:fs/promises');
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await fixture(tmp, 'static');
    await writeFile(path.join(dir, 'worker.js'), "fetch('https://api.ember-scores.net/v1/score').catch(() => {});\n");
    const html = path.join(dir, 'index.html');
    await writeFile(
      html,
      (await readFile(html, 'utf8')).replace('</body>', "<script>new Worker('worker.js');</script></body>"),
    );
    await adopt(dir);
    const r = await pageVerify(dir, { out: path.join(tmp.dir, 'out') });
    const four = r.checks.find(c => c.n === 4);
    assert.equal(four.ok, false, JSON.stringify(r.checks));
    assert.match(four.detail, /https:\/\/api\.ember-scores\.net/);
  },
);

test(
  'a router that moves the page out of its folder is named as the cause, not as paths from the root',
  { skip, timeout: 180_000 },
  async t => {
    const { readFile, writeFile } = await import('node:fs/promises');
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await fixture(tmp, 'static');
    await writeFile(path.join(dir, 'levels.json'), '{"levels":3}');
    const html = path.join(dir, 'index.html');
    // what a path router with base './' does: it replaces the URL with "/", then fetches relatively
    await writeFile(
      html,
      (await readFile(html, 'utf8')).replace(
        '</body>',
        "<script>history.replaceState(null, '', '/'); fetch('./levels.json');</script></body>",
      ),
    );
    await adopt(dir);
    const r = await pageVerify(dir, { out: path.join(tmp.dir, 'out') });
    const three = r.checks.find(c => c.n === 3);
    assert.equal(three.ok, false);
    assert.match(three.detail, /moved itself out of its folder, to \/ .*hash router/);
    assert.doesNotMatch(three.detail, /asked for from the root/);
  },
);

test(
  "a link to one of the game's own pages from the root is named as such (a multi-page build's links)",
  { skip, timeout: 180_000 },
  async t => {
    const { mkdir, readFile, writeFile } = await import('node:fs/promises');
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await fixture(tmp, 'static');
    await mkdir(path.join(dir, 'level', '2'), { recursive: true });
    await writeFile(path.join(dir, 'level', '2', 'index.html'), '<!doctype html><title>Level 2</title><p>2</p>');
    const html = path.join(dir, 'index.html');
    // what Next.js <Link href="/level/2"> does: it prefetches the page from the root
    await writeFile(
      html,
      (await readFile(html, 'utf8')).replace('</body>', "<script>fetch('/level/2/');</script></body>"),
    );
    await adopt(dir);
    const r = await pageVerify(dir, { out: path.join(tmp.dir, 'out') });
    const three = r.checks.find(c => c.n === 3);
    assert.equal(three.ok, false);
    assert.match(three.detail, /the game's own pages are linked from the root \(\/level\/2\/\)/);
    assert.doesNotMatch(three.detail, /\/level\/2\/ asked for from the root/);
  },
);

test(
  'a file the page asks for by a variable that was not set ("undefined") is named as such',
  { skip, timeout: 180_000 },
  async t => {
    const { readFile, writeFile } = await import('node:fs/promises');
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await fixture(tmp, 'static');
    const html = path.join(dir, 'index.html');
    await writeFile(
      html,
      (await readFile(html, 'utf8')).replace(
        '</body>',
        '<script>const art = {}; new Image().src = art.hero;</script></body>',
      ),
    );
    await adopt(dir);
    const r = await pageVerify(dir, { out: path.join(tmp.dir, 'out') });
    const three = r.checks.find(c => c.n === 3);
    assert.equal(three.ok, false);
    assert.match(
      three.detail,
      /missing undefined \(404\): the page asked for a file named undefined, a path from a variable that was not set/,
    );
  },
);

test("an engine's telemetry is a note, not a refusal", async () => {
  const { engineTelemetry } = await import('../lib/check.mjs');
  assert.match(engineTelemetry('https://config.uca.cloud.unity3d.com'), /Unity/);
  assert.equal(engineTelemetry('https://evil.com'), null);
  assert.equal(engineTelemetry('https://cloud.unity3d.com.evil.com'), null);
});

test("a build that does not copy the folder it should (an engine's export run by a script) is named", async t => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { uncopiedStatic } = await import('../lib/check.mjs');
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = tmp.dir;
  await mkdir(path.join(dir, 'gamesfun', 'gf', 'loot'), { recursive: true });
  await writeFile(path.join(dir, 'gamesfun', 'xsolana.json'), '{}');
  await writeFile(path.join(dir, 'gamesfun', 'gf', 'loot', 'release.json'), '{}');
  const roots = { dir, build: 'npm run build', static: path.join(dir, 'gamesfun'), out: path.join(dir, 'build/web') };
  const exported = [{ path: 'index.html' }, { path: 'index.pck' }];
  const [problem] = uncopiedStatic(exported, roots);
  assert.match(problem, /gamesfun\/xsolana\.json, gamesfun\/gf\/loot\/release\.json are not in what is published/);
  assert.match(problem, /npm run build must copy gamesfun\/ into build\/web/);
  assert.deepEqual(
    uncopiedStatic([...exported, { path: 'xsolana.json' }, { path: 'gf/loot/release.json' }], roots),
    [],
  );
  assert.deepEqual(uncopiedStatic(exported, { ...roots, build: null }), [], 'no build: the overlay is laid over');
});

// ---- the first session: a first-time player on a phone, in the play frame (../lib/journey.mjs) ----------------------

/**
 * The static fixture with `body` as its whole page, gamesfun.js loaded first (as xcore add signin leaves it), adopted;
 * `journey`: gamesfun.json's. → its folder
 */
async function firstVisit(tmp, body, { journey = null } = {}) {
  const { copyFile } = await import('node:fs/promises');
  const dir = await fixture(tmp, 'static');
  await copyFile(path.join(ROOT, 'lib', 'client', 'gamesfun.js'), path.join(dir, 'gamesfun.js'));
  await writeFile(
    path.join(dir, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>First visit</title><script src="./gamesfun.js"></script><link rel="stylesheet" href="style.css"></head><body>${body}</body></html>`,
  );
  await adopt(dir);
  if (journey) {
    const file = path.join(dir, 'gamesfun.json');
    await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), journey }, null, 2));
  }
  return dir;
}
const $ = id => `document.getElementById('${id}')`;

test(
  'first session: a Play button that starts the game at once is play reached in 1 tap, with no sign-in or wallet',
  { skip, timeout: 180_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await firstVisit(
      tmp,
      `<div id="menu"><h1>Rocket</h1><button id="play" style="font-size:32px">Play</button> <button id="opts">Settings</button></div>
<div id="game" hidden><p>Fuel: 10</p></div>
<script>${$('play')}.onclick = () => { ${$('menu')}.hidden = true; ${$('game')}.hidden = false; };</script>`,
    );
    const out = path.join(tmp.dir, 'out');
    const lines = [];
    const r = await pageVerify(dir, { out, log: l => lines.push(l) });
    const w = r.firstSession;
    assert.equal(r.pass, true, JSON.stringify(r.checks));
    assert.equal(w.steps[0].tapped, '“Play” (button)');
    assert.equal(w.steps[0].answered, true);
    assert.ok(!w.steps.some(s => /Settings/.test(s.tapped)), 'a settings button is never the walk’s choice');
    assert.equal(w.playReached, 1);
    assert.equal(w.firstSignIn, null);
    assert.equal(w.firstWallet, null);
    assert.equal(w.walletPrompts, 0);
    assert.equal(w.tell[0], 'A first-time player on a phone reaches play in 1 tap, with no sign-in or wallet.');
    assert.ok(w.tell.length >= 2 && w.tell.length <= 4, w.tell.join('\n'));
    for (const shot of w.screenshots) assert.ok(existsSync(path.join(out, shot)), shot);
    assert.deepEqual(JSON.parse(await readFile(path.join(out, 'record.json'), 'utf8')).firstSession.tell, w.tell);
    const at = lines.indexOf('First session (as a first-time player on a phone, in the play frame):');
    assert.ok(at > 0, lines.join('\n'));
    assert.ok(lines.slice(at).includes('  Tell the person:'), lines.slice(at).join('\n'));
  },
);

test(
  "first session: a first button that calls GamesFun.signIn() is a sign-in at tap 1, with X's",
  { skip, timeout: 180_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await firstVisit(
      tmp,
      `<button id="in">Sign in</button><div id="game" hidden><p>Welcome back</p></div>
<script>${$('in')}.onclick = async () => { await GamesFun.signIn(); ${$('in')}.remove(); ${$('game')}.hidden = false; };</script>`,
    );
    const r = await pageVerify(dir, { out: path.join(tmp.dir, 'out') });
    const w = r.firstSession;
    assert.deepEqual(w.firstSignIn, { step: 1, provider: 'X' }, JSON.stringify(w.steps));
    assert.deepEqual(w.steps[0].asked, [{ kind: 'signin', detail: 'X' }]);
    assert.equal(w.firstWallet, null);
    assert.equal(w.tell[0], 'A first-time player on a phone reaches play in 1 tap, after a sign-in with X (at tap 1).');
  },
);

test(
  "first session: a signing GamesFun.loot.call('buy') on the second tap needs a wallet and SOL at tap 2, 1 prompt",
  { skip, timeout: 180_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await firstVisit(
      tmp,
      `<div id="menu"><button id="play">Play</button></div>
<div id="shop" hidden><p>A sword: 0.01 SOL</p><button id="buy">Buy sword</button></div>
<script>
${$('play')}.onclick = () => { ${$('menu')}.hidden = true; ${$('shop')}.hidden = false; };
${$('buy')}.onclick = () => { GamesFun.loot.call('buy', 'sword', 1); GamesFun.loot.call('balances'); ${$('buy')}.disabled = true; };
</script>`,
    );
    const r = await pageVerify(dir, { out: path.join(tmp.dir, 'out') });
    const w = r.firstSession;
    assert.equal(w.playReached, 1, JSON.stringify(w.steps));
    assert.equal(w.steps[1].tapped, '“Buy sword” (button)');
    assert.deepEqual(w.firstWallet, { step: 2, call: "loot.call('buy')" });
    assert.deepEqual(w.firstSol, { step: 2, call: "loot.call('buy')", network: 'devnet' });
    assert.equal(w.walletPrompts, 1, 'a read (balances) is no prompt');
    assert.equal(w.firstSignIn, null);
    assert.match(w.tell[1], /^At tap 2 \(“Buy sword”\) the game asks a wallet to sign loot\.call\('buy'\)/);
    assert.match(w.tell[1], /devnet SOL \(from a faucet\).*must open the game in a wallet app \(1 wallet prompt/);
  },
);

test(
  'first session: a journey declared in gamesfun.json is followed, and a tap it names that is not there is said',
  { skip, timeout: 180_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const page = `<button id="start" style="font-size:40px">Start</button> <button id="shop">Shop</button><p id="said">Nothing yet</p>
<script>
${$('shop')}.onclick = () => { ${$('said')}.textContent = 'The shop is open'; };
${$('start')}.onclick = () => { ${$('said')}.textContent = 'Go!'; ${$('start')}.remove(); };
</script>`;
    const dir = await firstVisit(tmp, page, { journey: [{ tap: '#shop' }, { wait: 200 }, { tap: '#start' }] });
    const w = (await pageVerify(dir, { out: path.join(tmp.dir, 'out') })).firstSession;
    assert.equal(w.journey, 'declared in gamesfun.json');
    assert.deepEqual(
      w.steps.map(s => [s.selector, s.tapped, s.appeared]),
      [
        ['#shop', '“Shop” (button)', ['The shop is open']],
        ['#start', '“Start” (button)', ['Go!']],
      ],
    );
    assert.equal(w.stopped, 'the end of the declared journey');

    const tmp2 = await tempDir();
    t.after(tmp2.cleanup);
    const missing = await firstVisit(tmp2, page, { journey: [{ tap: '#shop' }, { tap: '#claim' }] });
    const m = (await pageVerify(missing, { out: path.join(tmp2.dir, 'out') })).firstSession;
    assert.equal(m.taps, 1);
    assert.equal(m.stopped, "the declared journey's tap 2 (#claim), which was not on the page");
    assert.ok(
      m.tell.includes(
        "Before any wallet prompt, the walk stopped at the declared journey's tap 2 (#claim), which was not on the page, so it did not reach a first reward: what claiming one asks (a sign-in, a wallet, SOL for its fee) was not seen.",
      ),
      m.tell.join('\n'),
    );
  },
);

test(
  'first session: what the walk meets (a thrown error, a pop-up the frame blocks, a wait) is said, and never fails the check',
  { skip, timeout: 180_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await firstVisit(
      tmp,
      `<button id="play">Play</button><p id="said"></p>
<script>${$('play')}.onclick = () => { ${$('said')}.textContent = 'Next free spin in 04:59'; window.open('about:blank'); throw new Error('the spin wheel is missing'); };</script>`,
    );
    const r = await pageVerify(dir, { out: path.join(tmp.dir, 'out') });
    const w = r.firstSession;
    assert.equal(r.pass, true, JSON.stringify(r.checks));
    assert.equal(r.checks.find(c => c.n === 3).ok, true);
    assert.deepEqual(w.blocked, [{ step: 1, what: 'popup' }]);
    assert.ok(
      w.errors.some(e => e.step === 1 && /the spin wheel is missing/.test(e.text)),
      JSON.stringify(w.errors),
    );
    assert.deepEqual(w.waits, [{ step: 1, text: 'Next free spin in 04:59' }]);
    assert.ok(
      w.tell.includes('Tapping “Play” tried to open a pop-up, which the play frame blocks: nothing opens for them.'),
      w.tell.join('\n'),
    );
  },
);
