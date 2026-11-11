// The preview picture's check (lib/card.mjs), on tiny real JPEG and PNG files made in ./pictures.mjs: what xgames.fun
// cannot draw stops publish, what it draws worse than it could is a warning, and where `xcore card` writes. What the
// commands do with it is tests/card-publish.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { adopt } from '../lib/publish/adopt.mjs';
import {
  CARD_MAX_BYTES,
  cardFix,
  cardSetting,
  cardTarget,
  cardVerdict,
  drawable,
  imageFacts,
  pngDamage,
  previewPicture,
  typedPath,
} from '../lib/card.mjs';
import { preflight } from '../lib/publish/index.mjs';
import { buildTree } from '../lib/publish/tree.mjs';
import { fixture, tempDir } from './helpers.mjs';
import { jpeg, png } from './pictures.mjs';

test('width, height, kind and whether the file is whole come from its own bytes', () => {
  assert.deepEqual(imageFacts(png(960, 960)), { format: 'png', width: 960, height: 960, complete: true, frame: null });
  assert.deepEqual(imageFacts(jpeg(1200, 1000)), {
    format: 'jpeg',
    width: 1200,
    height: 1000,
    complete: true,
    frame: 0xc0,
  });
  const progressive = imageFacts(jpeg(800, 640, { frame: 0xc2, exif: 20_000 }));
  assert.deepEqual([progressive.width, progressive.height, progressive.frame], [800, 640, 0xc2]);
  assert.equal(imageFacts(png(960, 960, { cut: 12 })).complete, false, 'no IEND chunk');
  assert.equal(imageFacts(jpeg(960, 960, { cut: 2 })).complete, false, 'no end marker');
  assert.equal(imageFacts(png(960, 960).subarray(0, 60)).complete, false);
  assert.equal(imageFacts(Buffer.from('GIF89a........')).format, null);
  assert.equal(imageFacts(new Uint8Array(jpeg(700, 700))).width, 700);
});

test('stop for what xgames.fun cannot draw; warn for what it draws worse than it could; ok', () => {
  const v = (file, data, bytes = data.length) => cardVerdict({ path: file, bytes, head: data });
  const cases = [
    // [file, bytes, status, why, fix]
    ['assets/card.jpg', jpeg(960, 960), 'ok'],
    ['assets/card.png', png(1000, 800), 'ok', null, null, '1.25 times is square enough'],
    ['assets/card.jpg', jpeg(960, 960, { frame: 0xc2 }), 'ok', null, null, 'a progressive JPEG draws'],
    ['assets/card.jpg', jpeg(960, 960, { frame: 0xc1 }), 'ok'],
    ['assets/card.jpg', png(960, 960), 'unusable', /it is a PNG named card\.jpg: .*cannot draw it/, 'rename'],
    ['assets/card.png', jpeg(960, 960), 'unusable', /it is a JPEG named card\.png/, 'rename'],
    [
      'assets/card.jpg',
      jpeg(960, 960, { frame: 0xc3 }),
      'unusable',
      /this kind of JPEG \(lossless\) cannot be drawn/,
      'remake',
    ],
    [
      'assets/card.jpg',
      jpeg(960, 960, { frame: 0xc9 }),
      'unusable',
      /this kind of JPEG \(arithmetic-coded\)/,
      'remake',
    ],
    [
      'assets/card.png',
      png(960, 960, { cut: 12 }),
      'unusable',
      /the file is cut short: its IEND chunk is missing/,
      'remake',
    ],
    ['assets/card.png', png(960, 960).subarray(0, 60), 'unusable', /cut short/, 'remake'],
    [
      'assets/card.png',
      png(960, 960, { damage: 'crc' }),
      'unusable',
      /damaged: its IDAT chunk's checksum is wrong, so it draws blank/,
      'remake',
    ],
    [
      'assets/card.png',
      png(960, 960, { damage: 'data' }),
      'unusable',
      /damaged: its image data does not unpack/,
      'remake',
    ],
    ['assets/card.jpg', jpeg(960, 960, { cut: 2 }), 'unusable', /cut short: its end marker is missing/, 'remake'],
    ['assets/card.jpg', Buffer.from('<svg/>'), 'unusable', /not really a JPEG: its first bytes are neither/, 'remake'],
    ['assets/card.png', Buffer.from('RIFF....WEBPVP8 '), 'unusable', /not really a PNG/, 'remake'],
    [
      'assets/card.jpg',
      jpeg(1920, 1080),
      'warn',
      /1920×1080, far from square: .*crops it to its middle 1080×1080, so its left and right are cut off/,
      'recrop',
    ],
    ['assets/card.png', png(700, 1000), 'warn', /its top and bottom are cut off/, 'recrop'],
    [
      'assets/card.png',
      png(300, 300),
      'warn',
      /300×300, under 600 px a side: .*scales it up to 960×960, so it looks blurry/,
      'bigger',
    ],
    ['assets/card.jpg', jpeg(300, 900), 'warn', /blurry and far from square/, 'bigger'],
  ];
  for (const [file, data, status, why, fix, said] of cases) {
    const r = v(file, data);
    const name = `${file} ${said ?? why ?? status}`;
    assert.equal(r.status, status, `${name}: ${r.why}`);
    if (why) assert.match(r.why, why, name);
    if (fix) assert.equal(r.fix, fix, name);
    assert.equal(drawable(r), status !== 'unusable', name);
  }
  assert.equal(v('assets/card.jpg', png(960, 960)).rename, 'assets/card.png');
  assert.equal(v('assets/card.png', jpeg(960, 960)).rename, 'assets/card.jpg');

  const big = cardVerdict({ path: 'assets/card.jpg', bytes: CARD_MAX_BYTES + 1, head: null });
  assert.equal(big.status, 'unusable');
  assert.match(big.why, /1,500,001 bytes.*ignores a picture over 1,500,000 bytes/);
  assert.equal(cardVerdict({ path: 'assets/card.jpg', bytes: CARD_MAX_BYTES, head: jpeg(960, 960) }).status, 'ok');
});

test('a PNG’s image data is checked: its checksums, that it unpacks, and that there is enough of it', () => {
  assert.equal(pngDamage(png(960, 960)), null);
  assert.equal(pngDamage(png(700, 900, { color: [1, 2, 3] })), null);
  assert.match(pngDamage(png(960, 960, { damage: 'crc' })), /checksum is wrong/);
  assert.match(pngDamage(png(960, 960, { damage: 'data' })), /does not unpack/);
  // a whole file whose header says more rows than its data holds
  const tall = Buffer.from(png(960, 600));
  tall.writeUInt32BE(960, 20); // its height, in IHDR
  tall.writeUInt32BE(crc32(tall.subarray(12, 29)), 29); // and IHDR's checksum, so only the data is short
  assert.match(pngDamage(tall), /short of its width and height/);
});

test('a path in a command to paste is quoted only when the shell needs it, and as that system’s shell reads it', () => {
  assert.equal(typedPath('games/dot-catch', { platform: 'linux' }), 'games/dot-catch');
  assert.equal(typedPath('my game', { platform: 'linux' }), "'my game'");
  assert.equal(typedPath("it's", { platform: 'darwin' }), `'it'\\''s'`);
  assert.equal(typedPath('C:\\Users\\me\\dot-catch', { platform: 'win32' }), 'C:\\Users\\me\\dot-catch');
  assert.equal(typedPath('C:\\Users\\me\\my game', { platform: 'win32' }), '"C:\\Users\\me\\my game"');
});

test('what fixes it, for the game’s folder', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  const v = (file, data) => cardVerdict({ path: file, bytes: data.length, head: data });
  assert.match(cardFix({ status: 'missing' }, dir).command, / card \S+static$/);
  const recrop = cardFix(v('assets/card.jpg', jpeg(1920, 1080)), dir);
  assert.match(recrop.command, / card \S+static --from \S+static[\\/]assets[\\/]card\.jpg --force$/);
  const rename = cardFix(v('assets/card.jpg', png(960, 960)), dir);
  assert.match(rename.command, /^(mv|move) \S+card\.jpg \S+card\.png$/);
  assert.match(rename.line, /^rename \S+static[\\/]assets[\\/]card\.jpg to \S+static[\\/]assets[\\/]card\.png$/);
  assert.match(
    cardFix(v('assets/card.jpg', jpeg(960, 960, { frame: 0xc3 })), dir).command,
    / --from .*card\.jpg --force$/,
  );
  assert.equal(cardFix(v('assets/card.jpg', jpeg(960, 960)), dir), null);
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
  await writeFile(path.join(dir, 'assets', 'card.jpg'), png(960, 960));
  const both = await card();
  assert.equal(both.status, 'unusable', 'card.jpg is the one used, even when it is the bad one');
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

  const built = await buildTree(game);
  const read = [];
  const r = await previewPicture(built.tree.files, async p => {
    read.push(p);
    return readFile(path.join(game, 'web', ...p.split('/')));
  });
  assert.equal(r.status, 'ok');
  assert.deepEqual(read, ['assets/card.jpg']);
  const over = await previewPicture([{ path: 'assets/card.jpg', bytes: CARD_MAX_BYTES + 5 }], () => {
    throw new Error('a picture over the limit is not read');
  });
  assert.equal(over.status, 'unusable');
});

test('gamesfun.json "card": false says the game goes without one; any other value is a problem', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  assert.deepEqual(cardSetting(dir), { value: true, problem: null });
  const cfg = JSON.parse(await readFile(path.join(dir, 'gamesfun.json'), 'utf8'));
  await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify({ ...cfg, card: false }));
  assert.deepEqual(cardSetting(dir), { value: false, problem: null });
  await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify({ ...cfg, card: 'no' }));
  assert.match(cardSetting(dir).problem, /"card" is false .* or left out; it is "no"/);
});

test('where xcore card writes: the published folder, the folder a build copies as it is, or nowhere', () => {
  const at = (...p) => path.join('/g', ...p);
  assert.deepEqual(cardTarget({ dir: at(), build: null, out: at(), static: at(), overlay: null }), {
    folder: at(),
    file: at('assets', 'card.jpg'),
    how: 'out',
  });
  const vite = { dir: at(), build: 'npm run build', out: at('dist'), static: at('public'), overlay: null };
  assert.deepEqual(cardTarget(vite), { folder: at('public'), file: at('public', 'assets', 'card.jpg'), how: 'static' });
  const engine = { dir: at(), build: null, out: at('export'), static: at('gamesfun'), overlay: at('gamesfun') };
  assert.equal(cardTarget(engine).how, 'overlay');
  assert.equal(cardTarget({ dir: at(), build: 'make', out: at('out'), static: null, overlay: null }).how, 'no-static');
});
