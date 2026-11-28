// What the page check says is what it saw: an error the first-session walk met is printed and warned of, a canvas
// drawn in one flat colour is nothing on screen, a page that leaves for another site is said as that, focus taken as it
// loads is a note (Godot's export does it), an export older than its project is a warning (and no pass for publish),
// and Ctrl-C is a check stopped, not a page that failed. Skipped where there is no Chrome, Edge or Chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findChrome, playwrightChromium } from '../lib/browser.mjs';
import { pageVerify } from '../lib/check.mjs';
import { BIN, run, tempDir } from './helpers.mjs';

const browser = findChrome() ?? ((await playwrightChromium()).installed ? true : null);
const skip = browser ? false : 'no Chrome, Edge or Chromium here';

/** A game of one page: `body` in its index.html, brought as plain static files. → its folder */
async function page(tmp, name, body, head = '') {
  const dir = path.join(tmp.dir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}</title><link rel="icon" href="data:,">${head}</head><body style="margin:0;background:#222">${body}</body></html>`,
  );
  await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify({ page: { out: '.' } }, null, 2));
  return dir;
}
const three = r => r.checks.find(c => c.n === 3);

test(
  'an error the first-session walk meets is printed by default, and the verdict line carries a warning',
  { skip, timeout: 180_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await page(
      tmp,
      'throws-on-tap',
      `<canvas id="c" width="300" height="200" style="width:100%;height:100vh"></canvas>
<script>const c = document.getElementById('c'), g = c.getContext('2d'); g.fillStyle = '#4a4'; g.fillRect(20, 20, 120, 80);
c.addEventListener('pointerdown', () => { throw new Error('tap broke'); });</script>`,
    );
    const c = run(['check', dir]);
    assert.equal(c.status, 0, c.stdout + c.stderr);
    assert.match(c.stdout, /^ {2}error during the walk, at tap 1: thrown: tap broke$/m);
    assert.match(c.stdout, /^warning: 1 error showed up during the first-session walk \(first: thrown: tap broke\)/m);
    assert.match(c.stdout, /^check: PASS, 3 passed, 1 skipped, 1 warning · evidence /m);
  },
);

test(
  'a canvas drawn in one flat colour (or never) is nothing on screen; one with a drawing, 2D or WebGL, shows something',
  { skip, timeout: 240_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const blank = await page(tmp, 'blank', '<canvas width="300" height="200"></canvas>');
    let r = await pageVerify(blank, { quick: true, out: path.join(tmp.dir, 'blank-out') });
    assert.equal(three(r).ok, false);
    assert.match(
      three(r).detail,
      /nothing on screen after \d+ s \(its canvas is in one flat colour: never drawn, or drawn blank\)/,
    );
    // WebGL, drawn without preserveDrawingBuffer: read from Chrome's picture of it, not from its own pixels
    const gl = await page(
      tmp,
      'webgl',
      `<canvas id="c" width="300" height="200"></canvas>
<script>const gl = document.getElementById('c').getContext('webgl');
gl.clearColor(0.1, 0.1, 0.3, 1); gl.clear(gl.COLOR_BUFFER_BIT);
gl.enable(gl.SCISSOR_TEST); gl.scissor(40, 40, 100, 60); gl.clearColor(0.9, 0.7, 0.1, 1); gl.clear(gl.COLOR_BUFFER_BIT);</script>`,
    );
    r = await pageVerify(gl, { quick: true, out: path.join(tmp.dir, 'gl-out') });
    assert.equal(three(r).ok, true, three(r).detail);
    assert.match(three(r).detail, /^no errors in its first \d+ s, nothing missing, something on screen/);
  },
);

test(
  'a page that leaves for another site is said as that, not as a router; focus taken as it loads is a note, with the Godot setting',
  { skip, timeout: 240_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const away = await page(
      tmp,
      'away',
      '<p>Loading</p><script>setTimeout(() => { location.href = "about:blank"; }, 300);</script>',
    );
    let r = await pageVerify(away, { quick: true, out: path.join(tmp.dir, 'away-out') });
    assert.equal(three(r).ok, false);
    assert.match(three(r).detail, /the page navigated away, to about:blank, as it loaded/);
    assert.doesNotMatch(three(r).detail, /router|hash routing/);
    // a Godot export focuses its canvas on start: the frame refuses it until the first tap, and the game plays on
    const focus = await page(
      tmp,
      'focus',
      `<canvas id="c" tabindex="0" width="300" height="200"></canvas>
<script>const c = document.getElementById('c'), g = c.getContext('2d'); g.fillStyle = '#4a4'; g.fillRect(20, 20, 120, 80); c.focus();</script>`,
      '<script>const GODOT_CONFIG = {"focusCanvas":true};</script>',
    );
    r = await pageVerify(focus, { quick: true, out: path.join(tmp.dir, 'focus-out') });
    assert.equal(r.pass, true, JSON.stringify(r.checks));
    // (Chrome says it in the console from version 158 on; an older one says nothing, and the check passes either way)
    const note = r.notes.find(n => /focus-without-user-activation/.test(n));
    if (note) assert.match(note, /set html\/focus_canvas_on_start to false in the Web export preset/);
  },
);

test(
  "an engine's export older than its project: a warning beside the verdict, and under publish's gate a failure (no pass to remember)",
  { skip, timeout: 240_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = path.join(tmp.dir, 'godot');
    const web = path.join(dir, 'build', 'web');
    await mkdir(web, { recursive: true });
    await writeFile(path.join(dir, 'project.godot'), '[application]\nconfig/name="Old export"\n');
    await writeFile(
      path.join(web, 'index.html'),
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>g</title><link rel="icon" href="data:,"></head><body><p>A game</p></body></html>',
    );
    await writeFile(path.join(web, 'index.pck'), 'pck');
    await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify({ page: { out: 'build/web' } }, null, 2));
    // the export was made an hour before the project last changed
    const hourAgo = new Date(Date.now() - 3600_000);
    await utimes(path.join(web, 'index.pck'), hourAgo, hourAgo);
    const before = new Date(Date.now() - 7200_000);
    await utimes(path.join(dir, 'gamesfun.json'), before, before);
    let r = await pageVerify(dir, { out: path.join(tmp.dir, 'out'), walk: false });
    assert.equal(r.pass, true, JSON.stringify(r.checks));
    assert.deepEqual(r.warnings, [
      "the engine's web export in build/web is older than the project (project.godot changed after it was exported): what is checked, and what publish would send, is the old game. Export again, then check",
    ]);
    r = await pageVerify(dir, { quick: true, out: path.join(tmp.dir, 'quick') });
    assert.equal(r.pass, false);
    assert.deepEqual(
      [r.checks[0].ok, r.checks[0].detail],
      [
        false,
        "the engine's web export in build/web is older than the project (project.godot changed after it was exported): export again, then publish",
      ],
    );
    // exported again: nothing to say
    await utimes(path.join(web, 'index.pck'), new Date(), new Date());
    r = await pageVerify(dir, { quick: true, out: path.join(tmp.dir, 'again') });
    assert.equal(r.pass, true, JSON.stringify(r.checks));
    assert.equal(r.warnings, undefined);
  },
);

test(
  'Ctrl-C during a check: "stopped", nothing recorded, no FAIL line for a page that did not fail',
  { skip, timeout: 120_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await page(tmp, 'slow', '<p>A game</p>');
    const child = spawn(process.execPath, [BIN, 'check', dir], {
      detached: true,
      env: { ...process.env, GAMESFUN_KIT: '', GF_PAGE_SETTLE_MS: '20000' },
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', c => (stdout += c));
    child.stderr.on('data', c => (stderr += c));
    const done = new Promise(resolve => child.on('close', code => resolve(code)));
    // once the record's folder is made and Chrome is on the page, as a person's Ctrl-C reaches the whole group
    const verify = path.join(dir, 'evidence', 'verify-1');
    for (let i = 0; i < 200 && !(existsSync(verify) && /PASS 2 /.test(stdout)); i++)
      await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 2000));
    assert.ok(existsSync(verify) && /PASS 2 /.test(stdout), stdout + stderr);
    process.kill(-child.pid, 'SIGINT');
    const code = await done;
    assert.equal(code, 130, stdout + stderr);
    assert.match(stderr, /check: stopped \(Ctrl-C\), nothing recorded\./);
    assert.doesNotMatch(stdout, /FAIL|Chrome could not run the page/);
    assert.equal(existsSync(verify), false, 'the half-made record is gone');
  },
);
