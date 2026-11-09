// Live operations (xgames.fun/console's Live tab) on the game's side: gamesfun.js's gf.live (get, refresh, onChange,
// the default banner and its off switches, a pause that starts while the game is open) in real Chrome against a
// stand-in play edge; and `xcore dev` answering /platform/v1/live from .gamesfun/live.json, with maintenance's holding
// page and 503 'maintenance', as xgames.fun's play edge does.
/* global GamesFun, document -- the page's, inside page.evaluate */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { startDev } from '../lib/dev/index.mjs';
import { parseLiveFile, LIVE_EMPTY, LIVE_CONFIG_BYTES, MAINTENANCE_DEFAULT } from '../lib/dev/live.mjs';
import { findChrome, playwrightChromium, ensureBrowser } from '../lib/browser.mjs';
import { ROOT, tempDir } from './helpers.mjs';

const browserHere = findChrome() ?? ((await playwrightChromium()).installed ? true : null);
const skip = browserHere ? false : 'no Chrome, Edge or Chromium here';
const CLIENT = await readFile(path.join(ROOT, 'lib', 'client', 'gamesfun.js'), 'utf8');
const T = Date.parse('2026-11-09T12:00:00Z');

test('the live file: the hosted rules (the window, the caps, the levels), times as ms or ISO, problems said', () => {
  assert.deepEqual(parseLiveFile(null, T), { live: LIVE_EMPTY, problems: [] });
  const { live, problems } = parseLiveFile(
    {
      announcement: { text: ' Double XP ', level: 'warning', startsAt: '2026-11-09T11:00:00Z', endsAt: T + 1000 },
      config: { difficulty: 'hard' },
      maintenance: true,
    },
    T,
  );
  assert.deepEqual(problems, []);
  assert.equal(live.announcement.text, 'Double XP');
  assert.equal(live.announcement.level, 'warning');
  assert.equal(live.announcement.startsAt, Date.parse('2026-11-09T11:00:00Z'));
  assert.match(live.announcement.id, /^[0-9a-f]{12}$/);
  assert.deepEqual([live.config, live.version], [{ difficulty: 'hard' }, 1]);
  assert.deepEqual(live.maintenance, { message: MAINTENANCE_DEFAULT, since: null });
  assert.equal(parseLiveFile({ announcement: { text: 'later', startsAt: T + 1 } }, T).live.announcement, null);
  assert.equal(parseLiveFile({ announcement: { text: 'over', endsAt: T } }, T).live.announcement, null);
  const bad = parseLiveFile(
    { announcement: { text: 'x'.repeat(300), level: 'red' }, config: { big: 'x'.repeat(LIVE_CONFIG_BYTES) } },
    T,
  );
  assert.equal(bad.live.announcement.text.length, 280);
  assert.deepEqual(bad.live.config, {});
  assert.equal(bad.problems.length, 3, bad.problems.join(' | '));
  assert.match(parseLiveFile({ config: [1] }, T).problems[0], /a JSON object/);
  assert.match(parseLiveFile([], T).problems[0], /a JSON object/);
});

async function http(url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, text, json, headers: r.headers };
}

test('xcore dev: /platform/v1/live from .gamesfun/live.json, read again each time; maintenance pauses the page, api/ and platform', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = path.join(tmp.dir, 'moth');
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><html><head></head><body><p>moth</p></body></html>');
  await writeFile(path.join(dir, 'main.js'), 'go()');
  const file = path.join(dir, '.gamesfun', 'live.json');
  await writeFile(file, JSON.stringify({ config: { difficulty: 'hard' }, announcement: { text: 'Event tonight' } }));
  const logs = [];
  const dev = await startDev(dir, { port: 0, log: m => logs.push(m) });
  t.after(() => dev.close());
  assert.ok(
    logs.some(l => /^live: \.gamesfun\/live\.json, an announcement, config v1$/.test(l)),
    logs.join('\n'),
  );

  const live = await http(`${dev.origin}/platform/v1/live`);
  assert.equal(live.status, 200);
  assert.deepEqual(live.json.config, { difficulty: 'hard' });
  assert.equal(live.json.announcement.text, 'Event tonight');
  assert.equal(live.json.maintenance, null);
  assert.equal((await http(dev.url)).status, 200);

  await writeFile(file, JSON.stringify({ maintenance: { message: 'Back at <7pm>' } }));
  const page = await http(dev.url);
  assert.equal(page.status, 503, 'the holding page, at once: the file is read again');
  assert.match(page.text, /Back at &lt;7pm&gt;/);
  assert.equal(page.headers.get('retry-after'), '60');
  assert.equal((await http(`${dev.url}main.js`)).status, 200, 'its other files still load');
  const tok = await http(`${dev.origin}/platform/v1/dev/token`, { method: 'POST', body: '{"name":"Ana"}' });
  assert.ok(tok.json.token, 'the local sign-in still works');
  const me = await http(`${dev.origin}/platform/v1/me`, { headers: { authorization: `Bearer ${tok.json.token}` } });
  assert.deepEqual([me.status, me.json], [503, { ok: false, code: 'maintenance', why: 'Back at <7pm>', since: null }]);
  assert.equal((await http(`${dev.url}api/rooms`)).json.code, 'maintenance');
  assert.deepEqual((await http(`${dev.origin}/platform/v1/live`)).json.maintenance, {
    message: 'Back at <7pm>',
    since: null,
  });

  await writeFile(file, '{not json');
  assert.equal((await http(dev.url)).status, 200, 'a broken file is nothing live');
  assert.ok(logs.some(l => /^live: \.gamesfun\/live\.json is not JSON/.test(l)));
});

/** A play edge in miniature: the game, gamesfun.js, /platform/v1/live (`s.live`) and a save that can be paused. */
function edge() {
  const s = {
    live: { ok: true, announcement: null, config: {}, version: 0, maintenance: null },
    asked: 0,
    paused: null,
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    if (url.pathname === '/' || url.pathname === '/off.html') {
      const attr = url.pathname === '/off.html' ? ' data-live-banner="off"' : '';
      return send(
        200,
        `<!doctype html><html><head><script src="./gamesfun.js"${attr}></script></head><body><canvas></canvas></body></html>`,
        'text/html',
      );
    }
    if (url.pathname === '/gamesfun.js') return send(200, CLIENT, 'text/javascript');
    if (url.pathname === '/platform/v1/live') {
      s.asked++;
      return s.live ? send(200, s.live) : send(404, { ok: false, code: 'unknown', why: 'No platform route.' });
    }
    if (url.pathname === '/platform/v1/scores/best')
      return s.paused
        ? send(503, { ok: false, code: 'maintenance', why: s.paused, since: T })
        : send(200, { ok: true, order: 'high', entries: [] });
    return send(404, { ok: false, why: 'not here' });
  });
  return new Promise(r =>
    server.listen(0, '127.0.0.1', () => r({ s, port: server.address().port, close: () => server.close() })),
  );
}
async function chrome() {
  const { chromium } = await import('playwright-core');
  const found = await ensureBrowser({});
  return chromium.launch({
    executablePath: found.path,
    args: ['--host-resolver-rules=MAP *.xgames.test 127.0.0.1'],
  });
}
const bannerText = page =>
  page.evaluate(() => {
    const b = document.querySelector('[data-gamesfun=live]');
    return b ? (b.shadowRoot ?? b).querySelector('span').textContent : null;
  });

test(
  'gf.live: get, the banner (closed once per announcement, off by attribute or call), onChange, and a pause while open',
  { skip, timeout: 60_000 },
  async t => {
    const g = await edge();
    t.after(g.close);
    const browser = await chrome();
    t.after(() => browser.close());
    g.s.live = {
      ok: true,
      announcement: { id: 'a1', text: 'Double XP <b>tonight</b>', level: 'info', startsAt: null, endsAt: null },
      config: { difficulty: 'hard' },
      version: 3,
      maintenance: null,
    };
    const page = await browser.newPage();
    await page.goto(`http://moth-play.xgames.test:${g.port}/`);
    await page.waitForFunction(() => document.querySelector('[data-gamesfun=live]'));
    assert.equal(await bannerText(page), 'Double XP <b>tonight</b>', 'text, never HTML');
    const got = await page.evaluate(() => GamesFun.live.get());
    assert.deepEqual(got, {
      data: {
        announcement: { id: 'a1', text: 'Double XP <b>tonight</b>', level: 'info', startsAt: null, endsAt: null },
        config: { difficulty: 'hard' },
        version: 3,
        maintenance: null,
      },
      error: null,
      status: 200,
    });
    assert.equal(g.s.asked, 1, 'get() under a minute after the banner asked: no second request');

    // closed: gone, and not shown again for this announcement after a reload; a new one shows
    await page.evaluate(() => {
      const b = document.querySelector('[data-gamesfun=live]');
      (b.shadowRoot ?? b).querySelector('button').click();
    });
    assert.equal(await bannerText(page), null);
    await page.reload();
    await page.evaluate(() => GamesFun.live.refresh());
    assert.equal(await bannerText(page), null, 'closed stays closed');
    g.s.live = {
      ...g.s.live,
      announcement: { ...g.s.live.announcement, id: 'a2', text: 'New event', level: 'warning' },
    };
    const seen = await page.evaluate(async () => {
      const changes = [];
      GamesFun.live.onChange(v => changes.push(v.announcement?.text));
      await GamesFun.live.refresh();
      return changes;
    });
    assert.deepEqual(seen, ['New event']);
    assert.equal(await bannerText(page), 'New event');

    // a pause that starts while the game is open: any call answering 'maintenance' shows it at once
    g.s.paused = 'Back at 7pm';
    const r = await page.evaluate(() => GamesFun.scores.top('best'));
    assert.equal(r.code, 'maintenance');
    assert.equal(await bannerText(page), 'Back at 7pm');
    assert.equal((await page.evaluate(() => GamesFun.live.value)).maintenance.message, 'Back at 7pm');

    // off: by the script's attribute (no request at all), or by a call
    const before = g.s.asked;
    const off = await browser.newPage();
    await off.goto(`http://moth-play.xgames.test:${g.port}/off.html`);
    await off.waitForTimeout(300);
    assert.equal(await bannerText(off), null);
    assert.equal(g.s.asked, before, 'nobody asked: nothing fetched');
    assert.deepEqual((await off.evaluate(() => GamesFun.live.get())).data.config, { difficulty: 'hard' });
    await off.evaluate(() => GamesFun.live.banner(false));
    assert.equal(await bannerText(off), null);
    await off.evaluate(() => GamesFun.live.banner(true));
    assert.equal(await bannerText(off), 'New event');

    // a host with no such route (an older one): nothing live, and not asked again
    g.s.live = null;
    const old = await browser.newPage();
    await old.goto(`http://moth-play.xgames.test:${g.port}/off.html`);
    const none = await old.evaluate(() => GamesFun.live.get());
    assert.deepEqual(none, {
      data: { announcement: null, config: {}, version: 0, maintenance: null },
      error: null,
      status: 404,
    });
    const asked = g.s.asked;
    await old.evaluate(() => GamesFun.live.get());
    assert.equal(g.s.asked, asked);

    // on this machine (a plain local server): nothing live, nothing asked
    const local = await browser.newPage();
    await local.goto(`http://127.0.0.1:${g.port}/`);
    assert.deepEqual((await local.evaluate(() => GamesFun.live.get())).data, {
      announcement: null,
      config: {},
      version: 0,
      maintenance: null,
    });
    assert.equal(g.s.asked, asked);
  },
);
