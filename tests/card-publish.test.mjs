// What a person or an agent sees about the game's preview picture: publish stopping (before anything is uploaded) for
// a picture xgames.fun cannot draw, going on with a warning for one it draws worse than it could, --no-card,
// gamesfun.json "card": false, --draft, --check and --json; a kit's own publish command; and `xcore card` (its refusals
// need no browser; the pictures it takes do, and are skipped where there is none).
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, symlink, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { adopt } from '../lib/publish/adopt.mjs';
import { findChrome, playwrightChromium } from '../lib/browser.mjs';
import { preflight, publishGame } from '../lib/publish/index.mjs';
import { buildTree } from '../lib/publish/tree.mjs';
import { runBuild } from '../lib/publish/page.mjs';
import { fixture, passing, ROOT, run, runAsync, signIn, standIn, tempDir } from './helpers.mjs';
import { jpeg, png } from './pictures.mjs';

const browser = findChrome() ?? ((await playwrightChromium()).installed ? true : null);
const noBrowser = browser ? false : 'no Chrome, Edge or Chromium here';

async function signedIn(t) {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  await signIn(g, env);
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  return { tmp, g, env, dir };
}
const putCard = async (dir, name, data) => {
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  await writeFile(path.join(dir, 'assets', name), data);
};

// ---- publish --------------------------------------------------------------------------------------------------------

test('publish stops before anything goes up for a picture xgames.fun cannot draw; --no-card, "card": false and --draft go on', async t => {
  const { g, env, dir } = await signedIn(t);
  const publish = (more = {}) => publishGame(dir, { origin: g.origin, env, check: passing, card: true, ...more });
  await assert.rejects(publish(), e => {
    assert.equal(e.code, 'card');
    assert.equal(e.card.status, 'missing');
    assert.match(e.next, / card \S+$/);
    assert.match(e.message, /^Nothing was published: this game has no preview picture/);
    assert.match(e.message, /what a link to the game shows when it is shared/);
    assert.match(e.message, /Make one: +\S.* card \S+ +\(a picture of the game as it plays; --from <picture>/);
    assert.match(e.message, /Or go without: .* publish \S+ --no-card/);
    return true;
  });
  assert.equal(g.state.published, undefined, 'nothing was sent');
  assert.ok(!g.state.calls.some(c => c.startsWith('POST /api/kit/publish')), g.state.calls.join('\n'));

  const stops = [
    [
      'card.jpg',
      png(960, 960),
      /cannot be drawn: it is a PNG named card\.jpg[\s\S]*Fix it: +rename \S+assets\/card\.jpg to \S+assets\/card\.png/,
    ],
    [
      'card.jpg',
      jpeg(960, 960, { frame: 0xc3 }),
      /this kind of JPEG \(lossless\) cannot be drawn[\s\S]*Fix it: .* card \S+ --from \S+card\.jpg --force/,
    ],
    ['card.jpg', jpeg(960, 960, { cut: 2 }), /the file is cut short/],
    ['card.jpg', Buffer.alloc(1_500_001, 0xff), /1,500,001 bytes/],
  ];
  for (const [name, data, words] of stops) {
    await putCard(dir, name, data);
    await assert.rejects(publish(), e => e.code === 'card' && words.test(e.message), String(words));
  }
  assert.equal(g.state.published, undefined, 'still nothing was sent');
  // a draft is never asked
  assert.equal((await publish({ draft: true })).draft, true);
  // --no-card
  const without = await publish({ card: false });
  assert.equal(without.url, 'http://x/play/dot-catch');
  assert.equal(without.card.status, 'unusable');
  // gamesfun.json "card": false: not asked again
  const cfg = JSON.parse(await readFile(path.join(dir, 'gamesfun.json'), 'utf8'));
  await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify({ ...cfg, card: false }));
  assert.ok((await publish()).url);
  await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify(cfg));
  await putCard(dir, 'card.jpg', jpeg(960, 960));
  const good = await publish();
  assert.equal(good.card.status, 'ok');
  assert.ok(g.state.tree.files.some(f => f.path === 'assets/card.jpg'));
});

test('a picture xgames.fun draws but crops or blurs goes up, with a warning that says what happens and the fix', async t => {
  const { g, env, dir } = await signedIn(t);
  for (const [data, words] of [
    [
      jpeg(1920, 1080),
      /^Worth fixing: its preview picture assets\/card\.jpg goes up, but it is 1920×1080, far from square: xgames\.fun crops it to its middle 1080×1080, so its left and right are cut off\. Fix: .* card \S+ --from \S+assets\/card\.jpg --force/,
    ],
    [
      jpeg(300, 300),
      /it is 300×300, under 600 px a side: .*so it looks blurry\. Fix: .* card \S+ --from <a picture at least 600 px/,
    ],
  ]) {
    await putCard(dir, 'card.jpg', data);
    const said = [];
    const r = await publishGame(dir, {
      origin: g.origin,
      env,
      check: passing,
      card: true,
      progress: l => said.push(l),
    });
    assert.ok(r.url);
    const line = said.find(l => /preview picture/.test(l));
    assert.match(line ?? '', words, said.join('\n'));
    assert.ok(said.indexOf(line) < said.findIndex(l => /^Uploading/.test(l)), 'said before the upload');
  }
});

test('a caller with its own check (the kit, which makes its own card) is not asked, unless it says card: true', async t => {
  const { g, env, dir } = await signedIn(t);
  const r = await publishGame(dir, { origin: g.origin, env, check: passing });
  assert.ok(r.url);
  assert.deepEqual(r.card, { status: 'missing' });
  await assert.rejects(publishGame(dir, { origin: g.origin, env, check: passing, card: true }), e => e.code === 'card');
});

test('the shared publishCommand with the picture check turned off publishes without asking or saying a plain card', async t => {
  const { tmp, g, env, dir } = await signedIn(t);
  const script = path.join(tmp.dir, 'kit-publish.mjs');
  await writeFile(
    script,
    `import { publishCommand } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'commands', 'publish.mjs')).href)};
const passing = async () => ({ pass: true, quick: true, passed: 6, ran: 6, failed: [], started: new Date().toISOString(), run: 'k' });
process.exitCode = await publishCommand({ check: passing, card: false, label: 'a kit 1.0' }).run(process.argv.slice(2));
`,
  );
  const kit = args =>
    new Promise(resolve => {
      const child = spawn(process.execPath, [script, ...args], {
        env: { ...process.env, ...env, GAMESFUN_STUDIO: g.origin, GAMESFUN_KIT: '' },
      });
      let stdout = '',
        stderr = '';
      child.stdout.on('data', c => (stdout += c));
      child.stderr.on('data', c => (stderr += c));
      child.on('close', status => resolve({ status, stdout, stderr }));
    });
  const r = await kit([dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Published .*http:\/\/x\/play\/dot-catch/);
  assert.doesNotMatch(r.stdout + r.stderr, /preview picture|plain card/);
  assert.equal(g.state.verify.kit, 'a kit 1.0');
  const j = await kit([dir, '--no-card', '--json']);
  assert.equal(j.status, 0, j.stderr);
  assert.equal(JSON.parse(j.stdout).card.status, 'missing');
});

test('xcore publish as a person or an agent runs it: the refusal with its verdict in --json, --no-card, --check, the card line', async t => {
  const { g, env, dir } = await signedIn(t);
  const cli = { env: { ...env, GAMESFUN_STUDIO: g.origin } };
  // the page check passed on these files before (so this test needs no Chrome): publish reuses that pass
  const remember = async () => {
    await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
    const report = { pass: true, quick: true, passed: 4, ran: 4, failed: [], at: new Date().toISOString(), run: 'v' };
    await writeFile(
      path.join(dir, '.gamesfun', 'gate.json'),
      JSON.stringify({ fingerprint: (await buildTree(dir)).fingerprint, report }),
    );
  };
  await remember();
  const refused = await runAsync(['publish', dir, '--json'], cli);
  assert.equal(refused.status, 1, refused.stderr);
  const j = JSON.parse(refused.stdout);
  assert.equal(j.ok, false);
  assert.equal(j.code, 'card');
  assert.match(j.next, / card \S+$/);
  assert.deepEqual(j.card, { status: 'missing', why: null, path: null, bytes: null, width: null, height: null });
  assert.match(refused.stderr, /Make one: .* card [\s\S]*Or go without: .* publish .* --no-card/);

  const check = JSON.parse(run(['publish', dir, '--check', '--json'], cli).stdout);
  assert.equal(check.ok, true, 'a warning in --check, never a refusal');
  assert.equal(check.card.status, 'missing');
  assert.equal(check.cardWarnings.length, 1);
  assert.match(check.cardWarnings[0], /^none .*Fix: .* card /);
  assert.match(run(['publish', dir, '--check'], cli).stdout, /warning: preview picture: none .*Publish stops for it/);

  await putCard(dir, 'card.jpg', png(960, 960));
  await remember();
  const mismatch = JSON.parse((await runAsync(['publish', dir, '--json'], cli)).stdout);
  assert.equal(mismatch.code, 'card');
  assert.deepEqual(mismatch.card, {
    status: 'unusable',
    why: 'it is a PNG named card.jpg: xgames.fun reads it as a JPEG by its name, and cannot draw it',
    path: 'assets/card.jpg',
    bytes: png(960, 960).length,
    width: 960,
    height: 960,
  });
  assert.equal(mismatch.next, undefined, 'renaming it is not a command');

  const plain = await runAsync(['publish', dir, '--no-card'], cli);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /its link shows a plain card \(a gradient with the title\)/);
  assert.equal((await runAsync(['publish', dir, '--draft'], cli)).status, 0);
  assert.equal(g.state.verify.pass, true);

  await putCard(dir, 'card.jpg', jpeg(1600, 900));
  await remember();
  const wide = await runAsync(['publish', dir], cli);
  assert.equal(wide.status, 0, wide.stderr);
  assert.match(wide.stderr, /Worth fixing: its preview picture .*far from square/);
  assert.ok(
    wide.stdout.includes(`its link's card: ${g.origin}/play/dot-catch/card.png (a link shared before`),
    wide.stdout,
  );
  const wideCheck = JSON.parse(run(['publish', dir, '--check', '--json'], cli).stdout);
  assert.equal(wideCheck.ok, true);
  assert.equal(wideCheck.card.status, 'warn');
  assert.match(wideCheck.cardWarnings[0], /far from square.*Fix: .* --from \S+card\.jpg --force/);
});

// ---- xcore card: its refusals (no browser needed) -------------------------------------------------------------------

test('xcore card never takes over from a picture that is there, and says which wins with --force', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  await putCard(dir, 'card.png', png(960, 960));
  const r = run(['card', dir, '--json']);
  assert.equal(r.status, 1);
  assert.match(
    r.stderr,
    /assets\/card\.png is already there, and xgames\.fun can draw it: look at it\. With --force, .* writes assets\/card\.jpg, which then wins over it/,
  );
  assert.match(JSON.parse(r.stdout).next, /--force$/);
  assert.equal(existsSync(path.join(dir, 'assets', 'card.jpg')), false);
  await putCard(dir, 'card.jpg', jpeg(960, 960));
  assert.match(run(['card', dir]).stderr, /assets\/card\.jpg is already there: look at it, and run again with --force/);
});

test('xcore card refuses a build with no folder it copies as it is, a link out of the game, and a huge --from', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  // a build and no page.static: the next build would remove the picture
  const built = path.join(tmp.dir, 'built');
  await mkdir(path.join(built, 'public'), { recursive: true });
  await writeFile(path.join(built, 'index.html'), '<title>B</title>');
  await writeFile(path.join(built, 'gamesfun.json'), JSON.stringify({ page: { build: 'node make.mjs', out: 'out' } }));
  const b = run(['card', built]);
  assert.equal(b.status, 1);
  assert.match(
    b.stderr,
    /node make\.mjs makes out\/ again on every build .*gone at the next build\. Put it where your build copies static files from, so it ends up at out\/assets\/card\.jpg \(public\/ here, most likely/,
  );
  assert.equal(existsSync(path.join(built, 'out')), false, 'nothing built, nothing written');

  // assets/ is a link to a folder outside the game
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  const away = path.join(tmp.dir, 'away');
  await mkdir(away);
  await symlink(away, path.join(dir, 'assets'), 'dir');
  const l = run(['card', dir]);
  assert.equal(l.status, 1);
  assert.match(l.stderr, /assets\/card\.jpg leads outside the game's folder \(a link\): nothing was written/);
  assert.equal(existsSync(path.join(away, 'card.jpg')), false);

  // an 81 MB picture
  const plain = await fixture(tmp, 'undeclared');
  const huge = path.join(tmp.dir, 'huge.png');
  await writeFile(huge, png(10, 10));
  await truncate(huge, 81 * 1024 * 1024);
  const h = run(['card', plain, '--from', huge]);
  assert.equal(h.status, 1);
  assert.match(h.stderr, /huge\.png is 84\.9 MB; .* card reads a picture of at most 40 MB/);
});

// ---- xcore card, in a browser ---------------------------------------------------------------------------------------

test(
  'xcore card --from: a picture you have, scaled to cover and cropped to 960×960; --force re-crops one in place',
  { skip: noBrowser, timeout: 120_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await fixture(tmp, 'static');
    await adopt(dir);
    const art = path.join(tmp.dir, 'key-art.png');
    await writeFile(art, png(1600, 900, { color: [200, 60, 40] }));
    const r = run(['card', dir, '--from', art]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Wrote .*assets\/card\.jpg: 960×960, \d+ KB, from /);
    assert.match(r.stdout, /keep the subject clear of the top third \(the title\) and the bottom left \(the button\)/);
    assert.match(r.stdout, /Open .*card\.jpg and look at it/);
    assert.equal((await preflight(dir)).card.status, 'ok');

    // the fix publish names, in place: a wide picture (here a PNG named card.jpg, which xgames.fun cannot draw either)
    // made again from itself, as a 960×960 JPEG
    const card = path.join(dir, 'assets', 'card.jpg');
    await writeFile(card, await readFile(art));
    assert.equal((await preflight(dir)).card.status, 'unusable');
    const fix = run(['card', dir, '--from', card, '--force', '--json']);
    assert.equal(fix.status, 0, fix.stderr);
    const out = JSON.parse(fix.stdout);
    assert.equal(out.card.status, 'ok');
    assert.equal(out.replaced, true);
    assert.equal(out.over, null);
    assert.equal((await preflight(dir)).card.status, 'ok');
    // a card.png beside it: --force says the new card.jpg wins
    await writeFile(path.join(dir, 'assets', 'card.png'), png(1600, 900));
    assert.match(run(['card', dir, '--from', art, '--force']).stdout, /assets\/card\.jpg now wins over .*card\.png/);

    const bad = path.join(tmp.dir, 'notes.png');
    await writeFile(bad, 'not a picture');
    const no = run(['card', dir, '--from', bad, '--force']);
    assert.equal(no.status, 1);
    assert.match(no.stderr, /not a picture this browser can read/);
  },
);

test(
  'xcore card: a picture of the game as it plays; a page that answers an error makes none; one that throws is said',
  { skip: noBrowser, timeout: 180_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await fixture(tmp, 'static');
    await adopt(dir);
    for (const p of ['../../etc/hosts', 'nothing-here.html']) {
      const r = run(['card', dir, '--path', p, '--wait', '0']);
      assert.equal(r.status, 1, p);
      assert.match(
        r.stderr,
        /(leads outside the game|answered 404 \(no such file in the game\)): no picture was written/,
        p,
      );
      assert.equal(existsSync(path.join(dir, 'assets', 'card.jpg')), false, p);
    }
    const ok = run(['card', dir, '--wait', '0.5', '--tap']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Wrote .*assets\/card\.jpg: 960×960/);

    await writeFile(
      path.join(dir, 'broken.html'),
      '<title>x</title><body style="background:#fff"><script>throw new Error("boom at start")</script></body>',
    );
    const thrown = run(['card', dir, '--path', 'broken.html', '--wait', '0', '--force']);
    assert.equal(thrown.status, 0, 'kept with --force');
    assert.match(
      thrown.stdout,
      /The page had errors before the picture was taken.*thrown: .*boom at start[\s\S]*Kept, as --force says/,
    );
    const json = JSON.parse(
      run(['card', dir, '--path', 'broken.html?again', '--wait', '0', '--force', '--json']).stdout,
    );
    assert.ok(json.errors.some(e => /boom at start/.test(e)));

    // a game with a build: in the folder its build copies as it is, carried into what is published
    const vite = await fixture(tmp, 'vite-like');
    await adopt(vite);
    const v = run(['card', vite, '--wait', '0.5']);
    assert.equal(v.status, 0, v.stderr);
    assert.match(v.stdout, /It is in public\/, the folder .* copies as it is: the build carries it into dist\//);
    assert.equal((await runBuild(vite)).code, 0);
    assert.equal((await preflight(vite)).card.status, 'ok');
  },
);

test(
  'a page that throws makes a picture but fails the command without --force',
  { skip: noBrowser, timeout: 120_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = path.join(tmp.dir, 'throws');
    await mkdir(dir);
    await writeFile(path.join(dir, 'index.html'), '<title>x</title><script>throw new Error("boom")</script>');
    const r = run(['card', dir, '--wait', '0']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /The page had errors .*boom[\s\S]*keep it with --force/);
    assert.ok(existsSync(path.join(dir, 'assets', 'card.jpg')), 'the picture is written, to look at');
  },
);

test(
  'xcore check reports the picture: missing and blurry are warnings, never a failed check',
  { skip: noBrowser, timeout: 180_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await fixture(tmp, 'static');
    await adopt(dir);
    const r = run(['check', dir, '--out', path.join(tmp.dir, 'out')]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^warning: preview picture: none .*Fix: .* card .*Publish stops for it/m);
    assert.match(r.stdout, /check: PASS 3\/3/);
    await putCard(dir, 'card.png', png(300, 300));
    const w = run(['check', dir, '--out', path.join(tmp.dir, 'out2')]);
    assert.equal(w.status, 0, w.stdout + w.stderr);
    assert.match(
      w.stdout,
      /^warning: preview picture: assets\/card\.png goes up, but it is 300×300, .*blurry\. Fix: /m,
    );
  },
);
