// The page check in real Chrome: a clean static game passes all four; a page that calls a site backend.json does not
// list fails "it stays inside its origins". Skipped where there is no Chrome, Edge or Chromium (and no Playwright one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adopt } from '../lib/publish/adopt.mjs';
import { findChrome, playwrightChromium, playwrightCli } from '../lib/browser.mjs';
import { FRAME_BLOCKS, pageVerify } from '../lib/check.mjs';
import { PLAY_FRAME_ALLOW, PLAY_FRAME_SANDBOX } from '../lib/play-policy.mjs';
import { hostedRefusal } from '../lib/publish/hosting.mjs';
import { buildTree } from '../lib/publish/tree.mjs';
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

test('the play frame the check builds is the one docs/HOSTING.md names', () => {
  // its section "Inside the play page", up to the next heading
  const section = readFileSync(path.join(ROOT, 'docs', 'HOSTING.md'), 'utf8')
    .split(/\n(?=#)/)
    .find(part => part.startsWith('### Inside the play page\n'));
  assert.ok(section, 'docs/HOSTING.md has its section "Inside the play page"');
  const text = section.replace(/\s+/g, ' ');
  assert.ok(text.includes(`sandbox="${PLAY_FRAME_SANDBOX}"`), section);
  assert.ok(text.includes(`allow="${PLAY_FRAME_ALLOW}"`), section);
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
    assert.match(three.detail, /docs\/HOSTING\.md, "Inside the play page"/);
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
      r.notes.some(n => /It calls its own server \(api\/room, api\/visits\)/.test(n)),
      r.notes.join('\n'),
    );
    // where it does answer on this machine is the command the person has, by name
    assert.ok(
      r.notes.some(n => /answers there once published \(and under .*xcore(\.mjs)? dev, which runs it\)/.test(n)),
      r.notes.join('\n'),
    );
    assert.doesNotMatch(r.notes.join('\n'), /the kit/);
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
    assert.match(three.detail, /moved itself out of its folder, to \/ .*hash routing/);
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
    assert.match(three.detail, /not under a folder; see docs\/HOSTING\.md, "A game of several pages"/);
    assert.doesNotMatch(three.detail, /the kit/);
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
    assert.equal(w.tell[0], 'The game screen changed on tap 1, with no sign-in or wallet.');
    assert.ok(w.tell.length >= 2 && w.tell.length <= 4, w.tell.join('\n'));
    for (const shot of w.screenshots) assert.ok(existsSync(path.join(out, shot)), shot);
    assert.deepEqual(JSON.parse(await readFile(path.join(out, 'record.json'), 'utf8')).firstSession.tell, w.tell);
    const at = lines.indexOf('First session (as a first-time player on a phone, in the play frame):');
    assert.ok(at > 0, lines.join('\n'));
    assert.ok(lines.slice(at).includes('  In short:'), lines.slice(at).join('\n'));
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
    // (tapped on the game's own Sign in: the sign-in, never counted as play)
    assert.deepEqual(w.firstSignIn, { step: 1, provider: 'X', control: true }, JSON.stringify(w.steps));
    assert.deepEqual(w.steps[0].asked, [{ kind: 'signin', detail: 'X' }]);
    assert.equal(w.steps[0].playing, false);
    assert.equal(w.firstWallet, null);
    assert.ok(
      w.tell.includes(
        'At tap 1 the walk tapped “Sign in”, a sign-in with X; no wallet was asked for in the first 1 tap.',
      ),
      w.tell.join('\n'),
    );
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
    // this one has an economy: a first reward is something its walk can stop short of
    await writeFile(path.join(dir, 'xsolana.json'), JSON.stringify({ name: 'First visit', grants: [] }));
    const w = (await pageVerify(dir, { out: path.join(tmp.dir, 'out') })).firstSession;
    assert.equal(w.journey, 'declared in gamesfun.json');
    assert.equal(w.shortOfReward, true);
    assert.ok(
      w.tell.some(l =>
        /^Before any wallet prompt, the walk stopped at the end of the declared journey, so it did not reach a first reward/.test(
          l,
        ),
      ),
      w.tell.join('\n'),
    );
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
    // a game with no economy has no reward to reach: where the walk stopped is said, and nothing of wallets or SOL
    assert.equal(m.shortOfReward, false);
    assert.ok(
      m.tell.includes(
        "The walk stopped at the declared journey's tap 2 (#claim), which was not on the page, so what follows it was not seen.",
      ),
      m.tell.join('\n'),
    );
    assert.doesNotMatch(m.tell.join('\n'), /first reward|SOL for its fee/);
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

// ---- a page that stops answering -----------------------------------------------------------------------------------

/** Run `fn` with a short wait for a page's answer (GF_PAGE_ANSWER_MS), so a page that never answers costs seconds. */
async function quickToGiveUp(fn) {
  const was = process.env.GF_PAGE_ANSWER_MS;
  process.env.GF_PAGE_ANSWER_MS = '5000';
  try {
    return await fn();
  } finally {
    if (was === undefined) delete process.env.GF_PAGE_ANSWER_MS;
    else process.env.GF_PAGE_ANSWER_MS = was;
  }
}

test(
  'a page whose script never yields fails "the page starts" in words, at the first view: the check does not wait on it',
  { skip, timeout: 120_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    // a loop with no end, a moment after the page has loaded
    const dir = await pageWith(tmp, 'setTimeout(() => { for (;;) {} }, 300);');
    const out = path.join(tmp.dir, 'out');
    const lines = [];
    const began = Date.now();
    const r = await quickToGiveUp(() => pageVerify(dir, { out, log: l => lines.push(l) }));
    assert.ok(Date.now() - began < 60_000, `it answered in ${Date.now() - began} ms`);
    assert.equal(r.pass, false);
    const three = r.checks.find(c => c.n === 3);
    assert.equal(three.ok, false);
    assert.match(three.detail, /^phone: the page stopped answering: a script of its own keeps the browser busy/);
    assert.doesNotMatch(three.detail, /desktop|nothing on screen|Chrome could not run/);
    assert.deepEqual(
      [r.checks.find(c => c.n === 4).ok, r.checks.find(c => c.n === 4).detail],
      [null, 'not run: the page stopped answering'],
    );
    assert.equal(r.firstSession, undefined, 'a page that stopped answering is not walked');
    assert.ok(!lines.some(l => l.startsWith('First session')));
  },
);

test(
  'first session: a tap that leaves the page in a loop with no end is said, with the tap, and the walk ends there',
  { skip, timeout: 180_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await firstVisit(
      tmp,
      `<button id="play" style="font-size:32px">Play</button>
<script>${$('play')}.onclick = () => { for (;;) {} };</script>`,
    );
    const lines = [];
    const r = await quickToGiveUp(() => pageVerify(dir, { out: path.join(tmp.dir, 'out'), log: l => lines.push(l) }));
    const w = r.firstSession;
    assert.equal(r.pass, true, 'the walk never fails the check');
    assert.equal(w.froze, 1);
    assert.equal(w.taps, 1);
    assert.deepEqual(
      [w.steps[0].tapped, w.steps[0].froze, w.steps[0].screen],
      ['“Play” (button)', true, null],
      JSON.stringify(w.steps),
    );
    assert.equal(w.stopped, 'a page that stopped answering after the tap on “Play” (button)');
    assert.ok(
      w.tell.some(l =>
        /^After tap 1 \(“Play”\) the page stopped answering \(.*\), and the walk ended there\.$/.test(l),
      ),
      w.tell.join('\n'),
    );
    assert.ok(lines.includes('  1. tapped “Play” (button) → the page stopped answering'), lines.join('\n'));
  },
);

test('the check and the dev host leave out what publish leaves out, so a page that loads it fails there too', async t => {
  const { servePage } = await import('../lib/check.mjs');
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const files = {
    'node_modules/three/three.js': 'export {};',
    'README.md': 'notes',
    'index.html': '<!doctype html><title>x</title>',
    'levels/README.md': 'a level’s notes, published',
    // hidden files and folders, at the top and below it: the server's secrets on this machine among them
    '.dev.vars': 'VOUCHER_SEED=not-for-a-browser',
    '.git/config': '[core]',
    '.gamesfun/publish.json': '{}',
    'levels/.draft.json': '{}',
    'levels/.cache/1.json': '{}',
  };
  for (const [p, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(tmp.dir, p)), { recursive: true });
    await writeFile(path.join(tmp.dir, p), text);
  }
  const site = await servePage(tmp.dir);
  t.after(site.close);
  const published = (await buildTree(tmp.dir)).tree.files.map(f => f.path);
  const players = ['index.html', 'levels/README.md'];
  for (const p of Object.keys(files)) {
    assert.equal(published.includes(p), players.includes(p), `published: ${p}`);
    assert.equal((await fetch(`${site.url}${p}`)).status, players.includes(p) ? 200 : 404, `served: ${p}`);
  }
});

test('every file of a game goes out with the play host’s headers: its type by its name, and never second-guessed', async t => {
  const { servePage } = await import('../lib/check.mjs');
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  for (const [p, text] of [
    ['index.html', '<!doctype html><title>x</title>'],
    ['game.js', 'export {};'],
    ['art/hero.png', 'PNG'],
    ['src/main.ts', 'export {};'],
    ['data/level.bin', 'bytes'],
  ]) {
    await mkdir(path.dirname(path.join(tmp.dir, p)), { recursive: true });
    await writeFile(path.join(tmp.dir, p), text);
  }
  const site = await servePage(tmp.dir);
  t.after(site.close);
  for (const [p, type] of [
    ['index.html', 'text/html; charset=utf-8'],
    ['game.js', 'text/javascript; charset=utf-8'],
    ['art/hero.png', 'image/png'],
    // no type of its own: bytes, which nosniff keeps a browser from running as a script or a style
    ['src/main.ts', 'application/octet-stream'],
    ['data/level.bin', 'application/octet-stream'],
  ]) {
    const r = await fetch(`${site.url}${p}`);
    const sent = name => r.headers.get(name);
    assert.equal(r.status, 200, p);
    assert.equal(sent('content-type'), type, p);
    assert.equal(sent('x-content-type-options'), 'nosniff', p);
    assert.equal(sent('referrer-policy'), 'no-referrer', p);
    assert.equal(sent('cross-origin-resource-policy'), 'same-origin', p);
    assert.equal(sent('permissions-policy'), 'camera=(), microphone=(), geolocation=(), payment=(), usb=()', p);
    const policy = sent('content-security-policy').split('; ');
    for (const rule of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"])
      assert.ok(policy.includes(rule), `${p}: ${rule}`);
  }
});

test('what a page may load from another site: nothing it runs, pictures and sounds from a declared https origin, calls to a declared one', () => {
  const backend = ['https://api.example.com', 'wss://rooms.example.com'];
  const refused = (origin, kind) => hostedRefusal(origin, kind, { backend });
  // what a browser runs or frames comes from the game's own files, declared or not
  for (const kind of ['script', 'stylesheet', 'font', 'document', 'frame', 'iframe', 'object', 'manifest'])
    for (const origin of ['https://api.example.com', 'https://cdn.example.net'])
      assert.match(refused(origin, kind), /from its own files only; put a copy in the game$/, `${kind} ${origin}`);
  // a picture or a sound: only from an origin backend.json lists, and only over https
  for (const [kind, what] of [
    ['image', 'a picture'],
    ['img', 'a picture'],
    ['media', 'a sound or video'],
  ]) {
    assert.equal(refused('https://api.example.com', kind), null, kind);
    for (const origin of ['https://cdn.example.net', 'wss://rooms.example.com', 'http://api.example.com'])
      assert.equal(refused(origin, kind), `${what} from ${origin}, not in backend.json origins`, kind);
  }
  // a call (fetch, a socket): only to an origin backend.json lists
  for (const kind of ['fetch', 'xhr', 'websocket']) {
    for (const origin of backend) assert.equal(refused(origin, kind), null, `${kind} ${origin}`);
    assert.equal(
      refused('https://cdn.example.net', kind),
      'a connection to https://cdn.example.net, not in backend.json origins',
      kind,
    );
  }
  assert.equal(
    hostedRefusal('https://api.example.com', 'image'),
    'a picture from https://api.example.com, not in backend.json origins',
    'with no origin declared',
  );
});
