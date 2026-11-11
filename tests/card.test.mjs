// The preview picture, what a shared link to a game shows: the check of assets/card.jpg (each outcome, from tiny real
// JPEG and PNG files made here), publish stopping without one (and --no-card, gamesfun.json "card": false, --draft,
// --check, a caller with its own check), and `xcore card` in a browser (skipped where there is none).
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { adopt } from '../lib/publish/adopt.mjs';
import { findChrome, playwrightChromium } from '../lib/browser.mjs';
import {
  CARD_MAX_BYTES,
  cardSetting,
  cardTarget,
  cardVerdict,
  imageFacts,
  makeCard,
  previewPicture,
} from '../lib/card.mjs';
import { cardRefusal, preflight, publishGame } from '../lib/publish/index.mjs';
import { buildTree } from '../lib/publish/tree.mjs';
import { pageRoots, runBuild } from '../lib/publish/page.mjs';
import { fixture, passing, ROOT, run, runAsync, signIn, standIn, tempDir } from './helpers.mjs';

// ---- tiny real pictures ---------------------------------------------------------------------------------------------

const chunk = (type, data) => {
  const len = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])));
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, crc]);
};
/** A real PNG of one colour, width × height (8-bit RGB). */
function png(width, height, [r, g, b] = [40, 90, 200]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const segment = (marker, body) => {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, body]);
};
/**
 * A JPEG's structure, width × height, as a camera or an editor writes it: SOI, JFIF, an optional EXIF block (`exif`
 * bytes) before the frame header, the quantisation and Huffman tables, the frame header (SOF0, or SOF2 for a
 * progressive one), the scan, EOI.
 */
function jpeg(width, height, { progressive = false, exif = 0 } = {}) {
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 3;
  sof.set([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], 6);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    ...(exif ? [segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.alloc(exif, 0xff)]))] : []),
    segment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),
    segment(progressive ? 0xc2 : 0xc0, sof),
    segment(0xc4, Buffer.concat([Buffer.from([0]), Buffer.from([0, 1]), Buffer.alloc(14), Buffer.from([0])])),
    segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

const browser = findChrome() ?? ((await playwrightChromium()).installed ? true : null);
const noBrowser = browser ? false : 'no Chrome, Edge or Chromium here';

// ---- the check ------------------------------------------------------------------------------------------------------

test('width and height come from the file’s own header: a PNG’s IHDR, a JPEG’s frame header past its other blocks', () => {
  assert.deepEqual(imageFacts(png(960, 960)), { format: 'png', width: 960, height: 960 });
  assert.deepEqual(imageFacts(jpeg(1200, 1000)), { format: 'jpeg', width: 1200, height: 1000 });
  assert.deepEqual(imageFacts(jpeg(800, 640, { progressive: true, exif: 20_000 })), {
    format: 'jpeg',
    width: 800,
    height: 640,
  });
  assert.deepEqual(imageFacts(Buffer.from('GIF89a........')), { format: null, width: null, height: null });
  assert.deepEqual(imageFacts(new Uint8Array(jpeg(700, 700))), { format: 'jpeg', width: 700, height: 700 });
});

test('each outcome: ok, too big, not really a JPEG or PNG, too small, far from square', () => {
  const v = (file, data, bytes = data.length) => cardVerdict({ path: file, bytes, head: data });
  const ok = v('assets/card.jpg', jpeg(960, 960));
  assert.equal(ok.status, 'ok');
  assert.deepEqual([ok.path, ok.width, ok.height, ok.format], ['assets/card.jpg', 960, 960, 'jpeg']);
  assert.equal(v('assets/card.png', png(1000, 800)).status, 'ok', '1.25 times is still square enough');
  assert.equal(v('assets/card.jpg', png(960, 960)).status, 'ok', 'a PNG named .jpg is still a picture');

  const big = cardVerdict({ path: 'assets/card.jpg', bytes: CARD_MAX_BYTES + 1, head: null });
  assert.equal(big.status, 'unusable');
  assert.match(big.why, /1,500,001 bytes.*ignores a picture over 1,500,000 bytes/);
  assert.equal(cardVerdict({ path: 'assets/card.jpg', bytes: CARD_MAX_BYTES, head: jpeg(960, 960) }).status, 'ok');

  const fake = v('assets/card.jpg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
  assert.equal(fake.status, 'unusable');
  assert.match(fake.why, /not really a JPEG: its first bytes are neither a JPEG's nor a PNG's, whatever its name/);
  assert.match(v('assets/card.png', Buffer.from('RIFF....WEBPVP8 ')).why, /not really a PNG/);

  const small = v('assets/card.png', png(500, 500));
  assert.equal(small.status, 'unusable');
  assert.match(small.why, /500×500: each side needs at least 600 px/);
  assert.match(v('assets/card.jpg', jpeg(960, 599)).why, /960×599/);

  const wide = v('assets/card.jpg', jpeg(1600, 900));
  assert.equal(wide.status, 'unusable');
  assert.match(wide.why, /1600×900, far from square.*at most 1\.25 times the shorter/);
  assert.match(v('assets/card.png', png(700, 1000)).why, /far from square/);
});

test('only the files that go up count, and assets/card.jpg wins over assets/card.png', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  const card = async () => (await preflight(dir)).card;
  assert.deepEqual(await card(), { status: 'missing' });
  await mkdir(path.join(dir, 'assets'));
  await writeFile(path.join(dir, 'assets', 'card.png'), png(960, 960));
  assert.deepEqual(await card(), {
    status: 'ok',
    path: 'assets/card.png',
    bytes: png(960, 960).length,
    format: 'png',
    width: 960,
    height: 960,
  });
  // a card.jpg beside it is the one used, even when it is the bad one
  await writeFile(path.join(dir, 'assets', 'card.jpg'), jpeg(1920, 1080));
  const both = await card();
  assert.equal(both.status, 'unusable');
  assert.equal(both.path, 'assets/card.jpg');

  // a brought game's published folder is page.out: a picture outside it never goes up
  const game = path.join(tmp.dir, 'built');
  await mkdir(path.join(game, 'web'), { recursive: true });
  await mkdir(path.join(game, 'assets'));
  await writeFile(path.join(game, 'web', 'index.html'), '<title>Built</title><p>hi</p>');
  await writeFile(path.join(game, 'assets', 'card.jpg'), jpeg(960, 960));
  await writeFile(path.join(game, 'gamesfun.json'), JSON.stringify({ page: { out: 'web' } }));
  assert.deepEqual((await preflight(game)).card, { status: 'missing' });
  await mkdir(path.join(game, 'web', 'assets'));
  await writeFile(path.join(game, 'web', 'assets', 'card.jpg'), jpeg(960, 960));
  assert.equal((await preflight(game)).card.status, 'ok');

  // the same list publish sends: previewPicture reads only the tree's files
  const built = await buildTree(game);
  const read = [];
  const r = await previewPicture(built.tree.files, async p => {
    read.push(p);
    return readFile(path.join(game, 'web', ...p.split('/')));
  });
  assert.equal(r.status, 'ok');
  assert.deepEqual(read, ['assets/card.jpg']);
  // a picture over the limit is not read at all
  assert.equal(
    (
      await previewPicture([{ path: 'assets/card.jpg', bytes: CARD_MAX_BYTES + 5 }], () => {
        throw new Error('read');
      })
    ).status,
    'unusable',
  );
});

test('gamesfun.json "card": false says the game goes without one; any other value is a problem publish refuses', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  assert.deepEqual(cardSetting(dir), { value: true, problem: null });
  const cfg = JSON.parse(await readFile(path.join(dir, 'gamesfun.json'), 'utf8'));
  await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify({ ...cfg, card: false }));
  assert.deepEqual(cardSetting(dir), { value: false, problem: null });
  assert.equal((await preflight(dir)).cardSetting, false);
  await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify({ ...cfg, card: 'no' }));
  const pre = await preflight(dir);
  assert.ok(
    pre.problems.some(p => /gamesfun\.json "card" is false .* or left out; it is "no"/.test(p)),
    pre.problems.join('\n'),
  );
});

test('where xcore card writes: the published folder, else the folder a build copies as it is', () => {
  const at = (...p) => path.join('/g', ...p);
  const plain = { dir: at(), build: null, out: at(), static: at(), overlay: null };
  assert.deepEqual(cardTarget(plain), { folder: at(), file: at('assets', 'card.jpg'), how: 'out' });
  const vite = { dir: at(), build: 'npm run build', out: at('dist'), static: at('public'), overlay: null };
  assert.deepEqual(cardTarget(vite), { folder: at('public'), file: at('public', 'assets', 'card.jpg'), how: 'static' });
  const engine = { dir: at(), build: null, out: at('export'), static: at('gamesfun'), overlay: at('gamesfun') };
  assert.equal(cardTarget(engine).how, 'overlay');
  assert.equal(cardTarget(engine).file, at('gamesfun', 'assets', 'card.jpg'));
  const bare = { dir: at(), build: 'make', out: at('out'), static: null, overlay: null };
  assert.deepEqual(cardTarget(bare), { folder: at('out'), file: at('out', 'assets', 'card.jpg'), how: 'out-rebuilt' });
});

// ---- publish --------------------------------------------------------------------------------------------------------

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

test('publish stops before anything goes up without a usable picture; --no-card, "card": false and --draft go on', async t => {
  const { g, env, dir } = await signedIn(t);
  // this package's own check asks for it (card: true is what the command passes)
  await assert.rejects(publishGame(dir, { origin: g.origin, env, check: passing, card: true }), e => {
    assert.equal(e.code, 'card');
    assert.equal(e.card.status, 'missing');
    assert.match(e.next, / card /);
    assert.match(e.message, /^Nothing was published: this game has no preview picture/);
    assert.match(e.message, /what a link to the game shows when it is shared/);
    assert.match(e.message, /card\b.*--from <picture>/);
    assert.match(e.message, /publish .*--no-card/);
    return true;
  });
  assert.equal(g.state.published, undefined, 'nothing was sent');
  assert.ok(!g.state.calls.some(c => c.startsWith('POST /api/kit/publish')), g.state.calls.join('\n'));

  await mkdir(path.join(dir, 'assets'));
  await writeFile(path.join(dir, 'assets', 'card.jpg'), jpeg(1920, 1080));
  await assert.rejects(
    publishGame(dir, { origin: g.origin, env, check: passing, card: true }),
    e =>
      e.code === 'card' &&
      /its preview picture, assets\/card\.jpg, cannot be used: it is 1920×1080, far from square/.test(e.message),
  );
  // a draft is never asked
  const draft = await publishGame(dir, { origin: g.origin, env, check: passing, card: true, draft: true });
  assert.equal(draft.draft, true);
  // --no-card
  const without = await publishGame(dir, { origin: g.origin, env, check: passing, card: false });
  assert.equal(without.url, 'http://x/play/dot-catch');
  assert.equal(without.card.status, 'unusable');
  // gamesfun.json "card": false: not asked again
  const cfg = JSON.parse(await readFile(path.join(dir, 'gamesfun.json'), 'utf8'));
  await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify({ ...cfg, card: false }));
  assert.ok((await publishGame(dir, { origin: g.origin, env, check: passing, card: true })).url);
  await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify(cfg));
  // a good one
  await writeFile(path.join(dir, 'assets', 'card.jpg'), jpeg(960, 960));
  const good = await publishGame(dir, { origin: g.origin, env, check: passing, card: true });
  assert.equal(good.card.status, 'ok');
  assert.ok(g.state.tree.files.some(f => f.path === 'assets/card.jpg'));
});

test('a caller with its own check (the kit, which makes its own card) is not asked, unless it says card: true', async t => {
  const { g, env, dir } = await signedIn(t);
  const r = await publishGame(dir, { origin: g.origin, env, check: passing });
  assert.ok(r.url);
  assert.deepEqual(r.card, { status: 'missing' });
  // and asked when it says so
  await assert.rejects(publishGame(dir, { origin: g.origin, env, check: passing, card: true }), e => e.code === 'card');
});

test('the shared publishCommand with the picture check turned off publishes without asking or saying a plain card', async t => {
  const { tmp, g, env, dir } = await signedIn(t);
  // another kit's command: its own check, and card: false (it makes its own card)
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
  // its --no-card still parses, and --json carries what the check found
  const j = await kit([dir, '--no-card', '--json']);
  assert.equal(j.status, 0, j.stderr);
  assert.deepEqual(JSON.parse(j.stdout).card, { status: 'missing' });
});

test('xcore publish, as a person or an agent runs it: the refusal (in --json too), --no-card, the card line, --check', async t => {
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
  assert.match(j.next, / card /);
  assert.match(j.error, /^Nothing was published: this game has no preview picture/);
  assert.match(refused.stderr, /Make one: .* card .*\n.*Or go without: .* publish .* --no-card/);
  assert.equal(g.state.published, undefined);

  const plain = await runAsync(['publish', dir, '--no-card'], cli);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /Published .*http:\/\/x\/play\/dot-catch/);
  assert.match(plain.stdout, /its link shows a plain card \(a gradient with the title\)/);

  const check = run(['publish', dir, '--check'], cli);
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /preview picture: none .*Publish stops for it/);

  const draft = await runAsync(['publish', dir, '--draft'], cli);
  assert.equal(draft.status, 0, draft.stderr);

  await mkdir(path.join(dir, 'assets'));
  await writeFile(path.join(dir, 'assets', 'card.png'), png(960, 960));
  await remember();
  const good = await runAsync(['publish', dir], cli);
  assert.equal(good.status, 0, good.stderr);
  assert.ok(
    good.stdout.includes(
      `its link's card: ${g.origin}/play/dot-catch/card.png (a link shared before may keep its old card for a while`,
    ),
    good.stdout,
  );
  const ok = JSON.parse(run(['publish', dir, '--check', '--json'], cli).stdout);
  assert.equal(ok.card.status, 'ok');
  assert.equal(ok.card.width, 960);
});

test('the refusal’s words for an unusable picture name it and why', () => {
  const m = cardRefusal({ status: 'unusable', path: 'assets/card.png', why: 'it is 500×500: each side…' }, 'my game');
  assert.match(m, /^Nothing was published: its preview picture, assets\/card\.png, cannot be used: it is 500×500/);
  assert.match(m, / card "my game" /);
  assert.match(m, / publish "my game" --no-card/);
});

// ---- xcore card, in a browser ---------------------------------------------------------------------------------------

test(
  'xcore card --from: a picture you have, scaled to cover and cropped to 960×960; never replaced without --force',
  { skip: noBrowser, timeout: 120_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await fixture(tmp, 'static');
    await adopt(dir);
    const art = path.join(tmp.dir, 'key-art.png');
    await writeFile(art, png(1600, 900, [200, 60, 40]));
    const r = run(['card', dir, '--from', art]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Wrote .*assets\/card\.jpg: 960×960, \d+ KB, from /);
    assert.match(r.stdout, /top left .*bottom left.*middle/);
    assert.match(r.stdout, /Open .*card\.jpg and look at it/);
    const data = await readFile(path.join(dir, 'assets', 'card.jpg'));
    assert.deepEqual(imageFacts(data), { format: 'jpeg', width: 960, height: 960 });
    assert.equal((await preflight(dir)).card.status, 'ok');

    const again = run(['card', dir, '--from', art, '--json']);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already there: look at it, and run again with --force/);
    assert.match(JSON.parse(again.stdout).next, /--force$/);
    assert.ok((await readFile(path.join(dir, 'assets', 'card.jpg'))).equals(data), 'left as it was');
    const forced = run(['card', dir, '--from', art, '--force', '--json']);
    assert.equal(forced.status, 0, forced.stderr);
    assert.equal(JSON.parse(forced.stdout).replaced, true);
    // not a picture
    const bad = path.join(tmp.dir, 'notes.png');
    await writeFile(bad, 'not a picture');
    const no = run(['card', dir, '--from', bad, '--force']);
    assert.equal(no.status, 1);
    assert.match(no.stderr, /not a picture this browser can read/);
  },
);

test(
  'xcore card: a picture of the game as it plays; a game with a build gets it in the folder its build copies',
  { skip: noBrowser, timeout: 180_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await fixture(tmp, 'static');
    await adopt(dir);
    const made = await makeCard(dir, { wait: 0.5, tap: true });
    assert.equal(made.target.how, 'out');
    assert.deepEqual([made.width, made.height], [960, 960]);
    assert.ok(made.bytes <= CARD_MAX_BYTES);

    const vite = await fixture(tmp, 'vite-like');
    await adopt(vite);
    const r = run(['card', vite, '--wait', '0.5']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /It is in public\/, the folder .* copies as it is: the build carries it into dist\//);
    assert.ok(existsSync(path.join(vite, 'public', 'assets', 'card.jpg')));
    assert.equal((await runBuild(vite)).code, 0);
    assert.equal((await preflight(vite)).card.status, 'ok', 'the build carried it into what is published');
    assert.equal(pageRoots(vite).build, 'npm run build');
  },
);

test(
  'xcore check reports the picture: missing is a warning, never a failed check',
  { skip: noBrowser, timeout: 180_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await fixture(tmp, 'static');
    await adopt(dir);
    const r = run(['check', dir, '--out', path.join(tmp.dir, 'out')]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^warning: preview picture: none .*Publish asks for one: .* card /m);
    assert.match(r.stdout, /check: PASS 3\/3/);
  },
);
