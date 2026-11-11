// A game's preview picture: what a link to it shows when it is shared (a post on X, a chat). xgames.fun draws a
// 960×960 card for every game's link: the game's own picture as the background (scaled to cover the square), with
// "XGames.fun" and the game's title over its top left and a "Tap to play" button over its bottom left. The picture is
// assets/card.jpg (else assets/card.png) among the game's published files, used only when it is at most 1,500,000
// bytes; without one the card is a plain dark gradient with the title.
//
//   cardVerdict   pure: one candidate's facts (its path, its size, its first bytes) → ok | unusable, with the reason
//   previewPicture        the published files (./publish/tree.mjs buildTree's, so a file left out of the upload never
//                         counts) → ok | missing | unusable
//   cardSetting   gamesfun.json → "card": false says the game goes without one (publish then does not ask)
//   makeCard      `xcore card`: a screenshot of the game, or a picture the person has, as assets/card.jpg
// Width and height come from the file's own header (a JPEG's SOF marker, a PNG's IHDR): no image library.
// The callback given to page.evaluate runs in the browser, not in Node.
/* global document */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_FILE } from './publish/page.mjs';

/** The files xgames.fun takes the picture from, the first one there wins. */
export const CARD_FILES = Object.freeze(['assets/card.jpg', 'assets/card.png']);
/** The file `xcore card` writes. */
export const CARD_FILE = CARD_FILES[0];
/** xgames.fun ignores a bigger picture. */
export const CARD_MAX_BYTES = 1_500_000;
/** The card's side, as xgames.fun draws it. */
export const CARD_SIZE = 960;
/** A side under this is blurred when it is scaled up to the card. */
export const CARD_MIN_SIDE = 600;
/** The longer side over the shorter: past this the square crops off too much. */
export const CARD_MAX_RATIO = 1.25;

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * What a picture is, from its own first bytes (never its name). → {format: 'jpeg' | 'png' | null, width, height}
 * (width and height null when the header does not say them).
 */
export function imageFacts(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length >= 24 && PNG_SIGNATURE.every((x, i) => b[i] === x)) {
    // the first chunk is IHDR: length (4), "IHDR", width (4), height (4)
    if (b.toString('latin1', 12, 16) !== 'IHDR') return { format: 'png', width: null, height: null };
    return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 3 < b.length) {
      if (b[i] !== 0xff) return { format: 'jpeg', width: null, height: null };
      while (b[i] === 0xff && i < b.length) i++; // fill bytes before a marker
      const marker = b[i++];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // no length
      if (marker === 0xd9 || marker === 0xda) break; // the end, or the image data: no frame header before it
      if (i + 1 >= b.length) break;
      const length = b.readUInt16BE(i);
      if (SOF.has(marker)) {
        if (i + 6 >= b.length) break;
        return { format: 'jpeg', width: b.readUInt16BE(i + 5), height: b.readUInt16BE(i + 3) };
      }
      i += length;
    }
    return { format: 'jpeg', width: null, height: null };
  }
  return { format: null, width: null, height: null };
}

const n = x => x.toLocaleString('en-US');
const mb = x => `${(x / 1_000_000).toFixed(1)} MB`;

/**
 * Pure: one candidate picture as the card would use it. `head`: its bytes (all of them, or enough to hold its header;
 * not needed when `bytes` is over the limit). → {status: 'ok', path, bytes, format, width, height} or {status:
 * 'unusable', path, bytes, why, format?, width?, height?}
 */
export function cardVerdict({ path: file, bytes, head }) {
  const unusable = (why, facts = {}) => ({ status: 'unusable', path: file, bytes, why, ...facts });
  if (bytes > CARD_MAX_BYTES)
    return unusable(
      `it is ${mb(bytes)} (${n(bytes)} bytes), and xgames.fun ignores a picture over ${n(CARD_MAX_BYTES)} bytes`,
    );
  const facts = imageFacts(head ?? new Uint8Array());
  const want = file.endsWith('.png') ? 'PNG' : 'JPEG';
  if (!facts.format)
    return unusable(`it is not really a ${want}: its first bytes are neither a JPEG's nor a PNG's, whatever its name`);
  if (!facts.width || !facts.height)
    return unusable(`its width and height could not be read from its ${facts.format.toUpperCase()} header`, facts);
  const { width, height } = facts;
  if (Math.min(width, height) < CARD_MIN_SIDE)
    return unusable(
      `it is ${width}×${height}: each side needs at least ${CARD_MIN_SIDE} px (the card is drawn at ${CARD_SIZE}×${CARD_SIZE}, and a smaller picture is blurred)`,
      facts,
    );
  if (Math.max(width, height) > CARD_MAX_RATIO * Math.min(width, height))
    return unusable(
      `it is ${width}×${height}, far from square: the card is a square, so its longer side may be at most ${CARD_MAX_RATIO} times the shorter (a ${CARD_SIZE}×${CARD_SIZE} picture fits)`,
      facts,
    );
  return { status: 'ok', path: file, bytes, ...facts };
}

/**
 * The game's preview picture among the files that go up. `files`: the tree's [{path, bytes}]; `read(path)` → the
 * file's bytes. assets/card.jpg wins over assets/card.png, as on xgames.fun. → a cardVerdict, or {status: 'missing'}
 */
export async function previewPicture(files, read) {
  const found = CARD_FILES.map(p => files.find(f => f.path === p)).find(Boolean);
  if (!found) return { status: 'missing' };
  const head = found.bytes > CARD_MAX_BYTES ? null : await read(found.path);
  return cardVerdict({ path: found.path, bytes: found.bytes, head });
}

/** The preview picture in a built tree (./publish/tree.mjs buildTree). */
export async function treePicture(built) {
  const { sourceBytes } = await import('./publish/tree.mjs');
  return previewPicture(built.tree.files, async p => {
    const f = built.tree.files.find(x => x.path === p);
    return sourceBytes(built.sources.get(f.sha256));
  });
}

/**
 * gamesfun.json → "card": false when the game goes without a preview picture on purpose (publish does not ask);
 * true or left out, the default. → {value: true | false, problem: string | null}
 */
export function cardSetting(dir) {
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(path.join(dir, CONFIG_FILE), 'utf8'));
  } catch {
    return { value: true, problem: null }; // none, or not JSON: said by what reads its other parts
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg) || cfg.card === undefined || cfg.card === true)
    return { value: true, problem: null };
  if (cfg.card === false) return { value: false, problem: null };
  return {
    value: true,
    problem: `${CONFIG_FILE} "card" is false (publish without a preview picture, and do not ask) or left out; it is ${JSON.stringify(cfg.card)}`,
  };
}

/** A picture's state in a line (`xcore check`, `publish --check`). */
export function cardLine(card, { off = false } = {}) {
  if (card.status === 'ok')
    return `${card.path}, ${card.width}×${card.height}, ${(card.bytes / 1000).toFixed(0)} KB: a link to the game shows it`;
  const plain = 'a link to the game shows a plain card (a gradient with its title)';
  if (card.status === 'missing')
    return `none (no ${CARD_FILES.join(' or ')} in the published files): ${plain}${off ? '; gamesfun.json "card": false says that is wanted' : ''}`;
  return `${card.path} cannot be used: ${card.why}; ${plain}`;
}

// ---- xcore card ----------------------------------------------------------------------------------------------------

/**
 * Where `xcore card` writes, so the file is among the published ones: the published folder itself, or for a brought
 * game the folder the build copies as it is (gamesfun.json page.static; with no build, the folder laid over the
 * published one). → {file (absolute), folder (absolute), how: 'out' | 'static' | 'overlay' | 'out-rebuilt'}
 */
export function cardTarget(roots) {
  if (roots.build && roots.static && path.resolve(roots.static) !== path.resolve(roots.out))
    return { folder: roots.static, file: path.join(roots.static, ...CARD_FILE.split('/')), how: 'static' };
  if (roots.overlay)
    return { folder: roots.overlay, file: path.join(roots.overlay, ...CARD_FILE.split('/')), how: 'overlay' };
  // a build with no folder it copies as it is: the file goes in its output, which the next build may remove
  return {
    folder: roots.out,
    file: path.join(roots.out, ...CARD_FILE.split('/')),
    how: roots.build ? 'out-rebuilt' : 'out',
  };
}

const TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
};

/** A JPEG screenshot of the page's 960×960, its quality lowered until it fits xgames.fun's limit. → Buffer */
async function shoot(page) {
  for (let quality = 90; ; quality -= 10) {
    const data = await page.screenshot({
      type: 'jpeg',
      quality,
      clip: { x: 0, y: 0, width: CARD_SIZE, height: CARD_SIZE },
    });
    if (data.length <= CARD_MAX_BYTES || quality <= 30) return data;
  }
}

/**
 * Make the game's preview picture. dir: the game's folder. Options: from (a picture's path: scaled to cover and
 * centre-cropped), wait (seconds after the page loads, default 4), tap (tap the middle once first), path (another page
 * of the game, with its query), force (replace an existing one), launch (another browser launcher), log(line).
 * A brought game with a build is built first (unless noBuild), as the page check does. → {file, target, bytes, width,
 * height, from, source, replaced, also}
 */
export async function makeCard(
  dir,
  {
    from = null,
    wait = 4,
    tap = false,
    path: pagePath = '',
    force = false,
    noBuild = false,
    launch = null,
    log = () => {},
  } = {},
) {
  const { pageRoots, pageFile, runBuild, buildFailure } = await import('./publish/page.mjs');
  const roots = pageRoots(dir);
  const target = cardTarget(roots);
  if (existsSync(target.file) && !force)
    throw Object.assign(
      new Error(
        `${path.relative(roots.dir, target.file).split(path.sep).join('/')} is already there: look at it, and run again with --force to replace it.`,
      ),
      { code: 'exists' },
    );
  let source = null;
  if (from) {
    source = path.resolve(from);
    if (!(await stat(source).catch(() => null))?.isFile()) throw new Error(`${from}: no such picture.`);
  } else if (roots.build && !noBuild) {
    log(`Building it (${roots.build})…`);
    const b = await runBuild(roots.dir, { onLine: l => log(`  ${l}`) });
    if (b.code !== 0)
      throw Object.assign(
        new Error(
          `Its build (${roots.build}) failed with exit code ${b.code}${buildFailure(b) ? ` (${buildFailure(b)})` : ''}: no picture was made.`,
        ),
        { code: 'build' },
      );
  }
  if (!from && !existsSync(path.join(roots.out, 'index.html')))
    throw new Error(
      `${path.relative(roots.dir, roots.out) || 'The game'} has no index.html${roots.build ? ' (build it first)' : ''}: nothing to take a picture of. Use --from <picture> to make it from one you have.`,
    );

  const { launchBrowser } = await import('./browser.mjs');
  const browser = await (launch ?? launchBrowser)();
  let data, site;
  try {
    const page = await browser.newPage({ viewport: { width: CARD_SIZE, height: CARD_SIZE }, deviceScaleFactor: 1 });
    if (from) {
      const bytes = await readFile(source);
      const type = TYPES[path.extname(source).toLowerCase()] ?? 'application/octet-stream';
      await page.setContent(
        `<!doctype html><html><body style="margin:0;background:#000;overflow:hidden"><img id="pic" alt="" style="display:block;width:${CARD_SIZE}px;height:${CARD_SIZE}px;object-fit:cover;object-position:center"></body></html>`,
      );
      const size = await page.evaluate(
        async ([b64, mime]) => {
          const img = document.getElementById('pic');
          img.src = `data:${mime};base64,${b64}`;
          try {
            await img.decode();
          } catch {
            return null;
          }
          return { width: img.naturalWidth, height: img.naturalHeight };
        },
        [bytes.toString('base64'), type],
      );
      if (!size?.width)
        throw new Error(`${from}: not a picture this browser can read (a JPEG, PNG, WebP, GIF or AVIF).`);
      if (Math.min(size.width, size.height) < CARD_MIN_SIDE)
        log(
          `Worth a better one: ${path.basename(source)} is ${size.width}×${size.height}, so it is scaled up to ${CARD_SIZE}×${CARD_SIZE} and looks soft.`,
        );
    } else {
      const { servePage } = await import('./check.mjs');
      const { backendOrigins, BACKEND_FILE } = await import('./publish/scan.mjs');
      const { ownOrigins } = await import('./publish/client.mjs');
      const { readServerConfig } = await import('./server/contract.mjs');
      let config = null;
      try {
        config = JSON.parse(readFileSync(pageFile(roots, BACKEND_FILE), 'utf8'));
      } catch {}
      const backend = backendOrigins(config, { own: ownOrigins() }).origins;
      site = await servePage(roots.out, {
        backend,
        server: (await readServerConfig(roots.dir)).has,
        overlay: roots.overlay,
      });
      const url = `${site.url}${String(pagePath ?? '').replace(/^\/+/, '')}`;
      log(`Opening ${url} at ${CARD_SIZE}×${CARD_SIZE}…`);
      await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
      if (tap) {
        await page.waitForTimeout(500);
        await page.mouse.click(CARD_SIZE / 2, CARD_SIZE / 2);
      }
      await page.waitForTimeout(Math.max(0, wait) * 1000);
    }
    data = await shoot(page);
  } finally {
    await browser.close().catch(() => {});
    await site?.close();
  }
  const replaced = existsSync(target.file);
  await mkdir(path.dirname(target.file), { recursive: true });
  await writeFile(target.file, data);
  const facts = imageFacts(data);
  // a card.png beside it no longer counts (card.jpg wins), and one in the published folder is the build's copy
  const also = CARD_FILES.slice(1)
    .map(p => path.join(target.folder, ...p.split('/')))
    .filter(existsSync);
  return {
    file: target.file,
    target,
    bytes: data.length,
    width: facts.width,
    height: facts.height,
    from: source,
    replaced,
    also,
  };
}
