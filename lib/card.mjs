// A game's preview picture: what a link to it shows when it is shared (a post on X, a chat). xgames.fun draws a
// 960×960 card for every game's link: the game's own picture as the background (scaled to cover the square, so a
// picture that is not square loses its edges), with "XGames.fun" and the game's title drawn large across the top band
// and a "Tap to play" button at the bottom left. The picture is assets/card.jpg (else assets/card.png) among the game's
// published files, used only when it is at most 1,500,000 bytes; without one the card is a plain dark gradient.
//
// xgames.fun reads the file by its name (card.jpg as a JPEG, card.png as a PNG) and draws only a baseline, extended or
// progressive JPEG (frame markers C0, C1, C2). So a picture is, in order:
//   stop   missing; over 1,500,000 bytes; neither a JPEG nor a PNG; a PNG named .jpg or a JPEG named .png; cut short
//          (no PNG IEND chunk, no JPEG end marker); no width and height in its header; another kind of JPEG
//   warn   it draws, but a side under 600 px looks blurry, and far from square (the longer side over 1.25 times the
//          shorter) is cropped to its middle
//   ok
//
//   cardVerdict    pure: one candidate's facts (its path, its size, its bytes) → ok | warn | unusable, with why
//   previewPicture the published files (./publish/tree.mjs buildTree's, so a file left out of the upload never
//                  counts) → ok | warn | missing | unusable
//   cardFix        the command or step that fixes it, for the game's folder
//   cardSetting    gamesfun.json → "card": false says the game goes without one (publish then does not ask)
//   makeCard       `xcore card`: a screenshot of the game, or a picture the person has, as assets/card.jpg
// Width and height come from the file's own header (a JPEG's SOF marker, a PNG's IHDR): no image library.
// The callback given to page.evaluate runs in the browser, not in Node.
/* global document */
import { existsSync, readFileSync } from 'node:fs';
import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import { CONFIG_FILE, pageRoots } from './publish/page.mjs';
import { CMD } from './command.mjs';
import { shown } from './games.mjs';

/** The files xgames.fun takes the picture from, the first one there wins. */
export const CARD_FILES = Object.freeze(['assets/card.jpg', 'assets/card.png']);
/** The file `xcore card` writes. */
export const CARD_FILE = CARD_FILES[0];
/** xgames.fun ignores a bigger picture. */
export const CARD_MAX_BYTES = 1_500_000;
/** The card's side, as xgames.fun draws it. */
export const CARD_SIZE = 960;
/** A side under this is blurry when it is scaled up to the card. */
export const CARD_MIN_SIDE = 600;
/** The longer side over the shorter: past this the square crops off a lot. */
export const CARD_MAX_RATIO = 1.25;
/** The biggest picture `xcore card --from` reads. */
export const FROM_MAX_BYTES = 40 * 1024 * 1024;
/** Where the card draws over the picture: what matters belongs elsewhere. */
export const CARD_CLEAR = 'keep the subject clear of the top third (the title) and the bottom left (the button)';

/** A JPEG frame header (SOFn): its marker → kind. */
const SOF = new Map([
  [0xc0, 'baseline'],
  [0xc1, 'extended'],
  [0xc2, 'progressive'],
  [0xc3, 'lossless'],
  [0xc5, 'differential'],
  [0xc6, 'differential progressive'],
  [0xc7, 'differential lossless'],
  [0xc9, 'arithmetic-coded'],
  [0xca, 'arithmetic-coded progressive'],
  [0xcb, 'arithmetic-coded lossless'],
  [0xcd, 'differential arithmetic-coded'],
  [0xce, 'differential arithmetic-coded progressive'],
  [0xcf, 'differential arithmetic-coded lossless'],
]);
/** The JPEGs xgames.fun draws. */
const DRAWN_SOF = new Set([0xc0, 0xc1, 0xc2]);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const EOI = Buffer.from([0xff, 0xd9]);

/**
 * What a picture is, from its own bytes (never its name). → {format: 'jpeg' | 'png' | null, width, height, complete,
 * frame} (width and height null when the header does not say them; complete: its end is there, a PNG's IEND chunk or
 * a JPEG's end marker after its image data; frame: a JPEG's SOF marker).
 */
export function imageFacts(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const none = { format: null, width: null, height: null, complete: false, frame: null };
  if (b.length >= 8 && PNG_SIGNATURE.every((x, i) => b[i] === x)) {
    const complete = b.length >= 45 && b.indexOf('IEND', 33, 'latin1') !== -1;
    // the first chunk is IHDR: length (4), "IHDR", width (4), height (4)
    if (b.length < 24 || b.toString('latin1', 12, 16) !== 'IHDR')
      return { ...none, format: 'png', complete: complete && b.length >= 24 };
    return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20), complete, frame: null };
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    const out = { ...none, format: 'jpeg' };
    let i = 2;
    while (i + 3 < b.length) {
      if (b[i] !== 0xff) break;
      while (b[i] === 0xff && i < b.length) i++; // fill bytes before a marker
      const marker = b[i++];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // no length
      if (marker === 0xd9) break;
      if (marker === 0xda) {
        // the image data: the file is whole when its end marker follows (inside the data FF is never followed by D9)
        out.complete = b.indexOf(EOI, i) !== -1;
        break;
      }
      if (i + 1 >= b.length) break;
      const length = b.readUInt16BE(i);
      if (SOF.has(marker) && out.frame === null && i + 6 < b.length) {
        out.frame = marker;
        out.height = b.readUInt16BE(i + 3);
        out.width = b.readUInt16BE(i + 5);
      }
      i += length;
    }
    return out;
  }
  return none;
}

/** A PNG's colour types → channels. */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** The image data a PNG may unpack to here, to check it (a bigger one is taken on its header alone). */
const PNG_CHECK_BYTES = 64 * 1024 * 1024;

/**
 * Is a PNG's image data damaged: a chunk whose checksum is wrong, image data that does not unpack, or too little of it
 * for its width and height? (A JPEG's data has no such cheap check: only its end marker is checked.) → why, or null
 */
export function pngDamage(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const data = [];
  let header = null;
  for (let i = 8; ;) {
    if (i + 12 > b.length) return 'it ends inside a chunk';
    const length = b.readUInt32BE(i),
      type = b.toString('latin1', i + 4, i + 8);
    if (i + 12 + length > b.length) return `its ${type} chunk is cut short`;
    if (crc32(b.subarray(i + 4, i + 8 + length)) !== b.readUInt32BE(i + 8 + length))
      return `its ${type} chunk's checksum is wrong`;
    if (type === 'IHDR') header = b.subarray(i + 8, i + 8 + length);
    if (type === 'IDAT') data.push(b.subarray(i + 8, i + 8 + length));
    if (type === 'IEND') break;
    i += 12 + length;
  }
  if (!header || header.length < 13 || !data.length) return 'it has no image data';
  const [width, height, depth, color, interlace] = [
    header.readUInt32BE(0),
    header.readUInt32BE(4),
    header[8],
    header[9],
    header[12],
  ];
  const row = Math.ceil((width * (CHANNELS[color] ?? 4) * depth) / 8) + 1;
  const want = height * row;
  if (want > PNG_CHECK_BYTES) return null;
  let pixels;
  try {
    pixels = inflateSync(Buffer.concat(data), { maxOutputLength: want + 1024 * 1024 });
  } catch {
    return 'its image data does not unpack';
  }
  // an interlaced PNG unpacks to more rows than this; a plain one to exactly these, each starting with its filter (0–4)
  if (interlace === 0) {
    if (pixels.length < want) return 'its image data is short of its width and height';
    for (let y = 0; y < height; y++) if (pixels[y * row] > 4) return 'its image data is not a PNG image';
  } else if (pixels.length < height) return 'its image data is short of its width and height';
  return null;
}

const n = x => x.toLocaleString('en-US');
const mb = x => `${(x / 1_000_000).toFixed(1)} MB`;
const NAMES = { jpeg: 'JPEG', png: 'PNG' };

/** Can xgames.fun draw it (ok, or ok with a warning)? */
export const drawable = card => card?.status === 'ok' || card?.status === 'warn';

/**
 * Pure: one candidate picture as the card would use it. `head`: its bytes (all of them: its end is checked too; not
 * needed when `bytes` is over the limit). → {status: 'ok' | 'warn' | 'unusable', path, bytes, why (warn, unusable),
 * fix ('remake' | 'rename' | 'recrop' | 'bigger'), rename (with fix 'rename': the name it should have), format, width,
 * height}
 */
export function cardVerdict({ path: file, bytes, head }) {
  const base = path.posix.basename(file);
  const stop = (why, fix, facts = {}) => ({ status: 'unusable', path: file, bytes, why, fix, ...facts });
  if (bytes > CARD_MAX_BYTES)
    return stop(
      `it is ${mb(bytes)} (${n(bytes)} bytes), and xgames.fun ignores a picture over ${n(CARD_MAX_BYTES)} bytes`,
      'remake',
    );
  const { complete, frame, ...facts } = imageFacts(head ?? new Uint8Array());
  const named = base.endsWith('.png') ? 'png' : 'jpeg';
  if (!facts.format)
    return stop(
      `it is not really a ${NAMES[named]}: its first bytes are neither a JPEG's nor a PNG's, whatever its name`,
      'remake',
    );
  if (facts.format !== named) {
    const rename = facts.format === 'png' ? CARD_FILES[1] : CARD_FILES[0];
    return {
      ...stop(
        `it is a ${NAMES[facts.format]} named ${base}: xgames.fun reads it as a ${NAMES[named]} by its name, and cannot draw it`,
        'rename',
        facts,
      ),
      rename,
    };
  }
  if (!complete)
    return stop(
      `the file is cut short: its ${facts.format === 'png' ? 'IEND chunk' : 'end marker'} is missing`,
      'remake',
      facts,
    );
  if (!facts.width || !facts.height)
    return stop(`its width and height could not be read from its ${NAMES[facts.format]} header`, 'remake', facts);
  const damage = facts.format === 'png' ? pngDamage(head) : null;
  if (damage) return stop(`it is damaged: ${damage}, so it draws blank`, 'remake', facts);
  if (facts.format === 'jpeg' && !DRAWN_SOF.has(frame))
    return stop(
      `this kind of JPEG (${SOF.get(frame) ?? 'an unknown kind'}) cannot be drawn: xgames.fun draws baseline and progressive JPEGs`,
      'remake',
      facts,
    );
  const { width, height } = facts;
  const short = Math.min(width, height);
  const warnings = [];
  let fix = null;
  if (short < CARD_MIN_SIDE) {
    warnings.push(
      `it is ${width}×${height}, under ${CARD_MIN_SIDE} px a side: xgames.fun scales it up to ${CARD_SIZE}×${CARD_SIZE}, so it looks blurry`,
    );
    fix = 'bigger';
  }
  if (Math.max(width, height) > CARD_MAX_RATIO * short) {
    warnings.push(
      `${warnings.length ? 'and' : `it is ${width}×${height},`} far from square: xgames.fun crops it to its middle ${short}×${short}, so its ${width > height ? 'left and right' : 'top and bottom'} are cut off`,
    );
    fix ??= 'recrop';
  }
  if (warnings.length) return { status: 'warn', path: file, bytes, why: warnings.join(' '), fix, ...facts };
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

/**
 * How this feature prints paths. The game's folder, and a file the person opens or passes back (--from), as shown()
 * gives them: relative to where the command runs when inside it, else absolute, with this system's separators. A
 * folder inside the game, relative to it, with "/" (as the page check and adopt name them). The file xgames.fun reads
 * is always assets/card.jpg (or assets/card.png). In a command to paste, a path is quoted only when the shell needs it:
 * on Windows in double quotes as it is (cmd and PowerShell take its backslashes as they are), elsewhere in single
 * quotes. → the path as typed
 */
export function typedPath(p, { platform = process.platform } = {}) {
  if (platform === 'win32') return /[\s"'$`&()^%;,]/.test(p) ? `"${p}"` : p;
  return /[^\w@%+=:,./~-]/.test(p) ? `'${p.replace(/'/g, `'\\''`)}'` : p;
}
const typed = p => typedPath(p);

/**
 * Where a published picture is kept in the game's own files (for a build, the folder it copies as it is), as the
 * person types it. → path
 */
export function cardSource(dir, published, roots) {
  const parts = published.split('/');
  const target = cardTarget(roots);
  const kept = [target.folder, roots.out].map(f => path.join(f, ...parts)).find(existsSync);
  return shown(kept ?? path.join(target.folder, ...parts));
}

/**
 * What fixes the game's picture: card is a verdict, dir the game's folder. → {line (what to run or do), command (the
 * command alone, or null when the fix is not one)} or null when nothing needs fixing
 */
export function cardFix(card, dir) {
  const roots = pageRoots(dir);
  const where = shown(dir);
  const at = where === '.' ? '' : ` ${typed(where)}`;
  const make = `${CMD} card${at}`;
  if (card.status === 'missing')
    return {
      line: `${make}   (a picture of the game as it plays; --from <picture> makes it from one you have)`,
      command: make,
    };
  if (!card.fix) return null;
  const kept = cardSource(dir, card.path, roots);
  const src = typed(kept);
  const from = `${make} --from ${src} --force`;
  switch (card.fix) {
    case 'rename': {
      const to = typed(path.join(path.dirname(kept), path.posix.basename(card.rename)));
      return {
        line: `rename ${src} to ${to}`,
        // move works in cmd and in PowerShell, mv in every other shell
        command: `${process.platform === 'win32' ? 'move' : 'mv'} ${src} ${to}`,
      };
    }
    case 'recrop':
      return { line: `${from}   (crops it to its middle here, so you can look at it)`, command: from };
    case 'bigger':
      return {
        line: `${make} --from <a picture at least ${CARD_MIN_SIDE} px a side> --force, or ${make} --force for a picture of the game`,
        command: `${make} --force`,
      };
    default:
      return {
        line: `${from}   (makes one xgames.fun can draw from it), or ${make} --force for a picture of the game`,
        command: from,
      };
  }
}

/**
 * A picture's state in words (`xcore check`, `publish --check`, publish's warning). → {level: 'ok' | 'warn' | 'stop' |
 * 'off', line, fix}
 */
export function cardReport(card, dir, { off = false } = {}) {
  const plain = 'a link to the game shows a plain card (a gradient with its title)';
  if (card.status === 'ok')
    return {
      level: 'ok',
      line: `${card.path}, ${card.width}×${card.height}, ${(card.bytes / 1000).toFixed(0)} KB: a link to the game shows it`,
      fix: null,
    };
  const fix = cardFix(card, dir);
  if (card.status === 'warn')
    return { level: 'warn', line: `${card.path} goes up, but ${card.why}. Fix: ${fix.line}`, fix };
  const what =
    card.status === 'missing'
      ? `none (no ${CARD_FILES.join(' or ')} in the published files): ${plain}`
      : `${card.path} cannot be drawn: ${card.why}; ${plain}`;
  if (off) return { level: 'off', line: `${what}; gamesfun.json "card": false says that is wanted`, fix: null };
  return { level: 'stop', line: `${what}. Fix: ${fix.line}`, fix };
}

/** The report's line as a command prints it: a warning when it is missing, cannot be drawn or looks worse than it could. */
export const cardPrinted = ({ level, line }) =>
  level === 'warn'
    ? `warning: preview picture: ${line}`
    : level === 'stop'
      ? `warning: preview picture: ${line}. Publish stops for it (or publish with --no-card).`
      : `preview picture: ${line}`;

/** The verdict as a command's JSON carries it. */
export const cardJson = card =>
  card
    ? {
        status: card.status,
        why: card.why ?? null,
        path: card.path ?? null,
        bytes: card.bytes ?? null,
        width: card.width ?? null,
        height: card.height ?? null,
      }
    : null;

// ---- xcore card ----------------------------------------------------------------------------------------------------

/**
 * Where `xcore card` writes, so the file is among the published ones: the published folder itself, or for a brought
 * game the folder the build copies as it is (gamesfun.json page.static; with no build, the folder laid over the
 * published one). A build with no such folder: 'no-static', nowhere it can write that the next build keeps.
 * → {file (absolute), folder (absolute), how: 'out' | 'static' | 'overlay' | 'no-static'}
 */
export function cardTarget(roots) {
  const at = folder => ({ folder, file: path.join(folder, ...CARD_FILE.split('/')) });
  if (roots.build && roots.static && path.resolve(roots.static) !== path.resolve(roots.out))
    return { ...at(roots.static), how: 'static' };
  if (roots.overlay) return { ...at(roots.overlay), how: 'overlay' };
  return { ...at(roots.out), how: roots.build ? 'no-static' : 'out' };
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

const refuse = (message, code) => Object.assign(new Error(message), { code });

/** Is `file` (or the nearest folder of it that exists) really inside `root`, followed through links, and no link itself? */
async function insideGame(file, root) {
  const realRoot = await realpath(root);
  let d = path.dirname(file);
  while (!existsSync(d) && path.dirname(d) !== d) d = path.dirname(d);
  const real = await realpath(d);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return false;
  return !(await lstat(file).catch(() => null))?.isSymbolicLink();
}

/**
 * Make the game's preview picture. dir: the game's folder. Options: from (a picture's path: scaled to cover and
 * centre-cropped), wait (seconds after the page loads, default 4), tap (tap the middle once first), path (another page
 * of the game, with its query), force (replace an existing one), launch (another browser launcher), log(line).
 * A brought game with a build is built first (unless noBuild), as the page check does. Throws (nothing written) when
 * the page does not answer 200 from the game. → {file, target, bytes, width, height, from, replaced, over (the
 * card.png it now wins over, or null), errors (what the page threw or logged as errors before the picture)}
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
  const rel = p => path.relative(roots.dir, p).split(path.sep).join('/') || '.';
  const target = cardTarget(roots);
  if (target.how === 'no-static')
    throw refuse(
      `${roots.build} makes ${rel(roots.out)}/ again on every build (and publish builds first), so a picture written there would be gone at the next build. ` +
        `Put it where your build copies static files from, so it ends up at ${rel(roots.out)}/${CARD_FILE}${existsSync(path.join(roots.dir, 'public')) ? ' (public/ here, most likely: public/' + CARD_FILE + ')' : ''}; ` +
        `then name that folder in ${CONFIG_FILE} ("page": {"static": "<folder>"}) and ${CMD} card writes it there.`,
      'no-static',
    );
  if (!(await insideGame(target.file, roots.dir)))
    throw refuse(
      `${rel(target.file)} leads outside the game's folder (a link): nothing was written. Make ${rel(path.dirname(target.file))}/ an ordinary folder.`,
      'outside',
    );
  if (!force) {
    if (existsSync(target.file))
      throw refuse(
        `${rel(target.file)} is already there: look at it, and run again with --force to replace it.`,
        'exists',
      );
    // a card.png xgames.fun can draw: a new card.jpg would take over from it without a word
    const png = path.join(target.folder, ...CARD_FILES[1].split('/'));
    if (existsSync(png)) {
      const data = await readFile(png);
      if (drawable(cardVerdict({ path: CARD_FILES[1], bytes: data.length, head: data })))
        throw refuse(
          `${rel(png)} is already there, and xgames.fun can draw it: look at it. With --force, ${CMD} card writes ${CARD_FILE}, which then wins over it.`,
          'exists',
        );
    }
  }
  let source = null;
  if (from) {
    source = path.resolve(from);
    const st = await stat(source).catch(() => null);
    if (!st?.isFile()) throw new Error(`${from}: no such picture.`);
    if (st.size > FROM_MAX_BYTES)
      throw refuse(
        `${from} is ${mb(st.size)}; ${CMD} card reads a picture of at most ${FROM_MAX_BYTES / 1024 / 1024} MB. Save a smaller copy (2000×2000 is plenty) and use that.`,
        'too-big',
      );
  } else if (roots.build && !noBuild) {
    log(`Building it (${roots.build})…`);
    const b = await runBuild(roots.dir, { onLine: l => log(`  ${l}`) });
    if (b.code !== 0)
      throw refuse(
        `Its build (${roots.build}) failed with exit code ${b.code}${buildFailure(b) ? ` (${buildFailure(b)})` : ''}: no picture was made.`,
        'build',
      );
  }
  if (!from && !existsSync(path.join(roots.out, 'index.html')))
    throw new Error(
      `${rel(roots.out)} has no index.html${roots.build ? ' (build it first)' : ''}: nothing to take a picture of. Use --from <picture> to make it from one you have.`,
    );

  const { launchBrowser } = await import('./browser.mjs');
  const browser = await (launch ?? launchBrowser)();
  const errors = [];
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
      const { servePage, MOUNT } = await import('./check.mjs');
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
      const url = new URL(String(pagePath ?? '').replace(/^\/+/, ''), site.url);
      if (url.origin !== site.origin || !url.pathname.startsWith(MOUNT))
        throw refuse(`--path ${pagePath} leads outside the game: no picture was written.`, 'page');
      page.on('pageerror', e =>
        errors.push(
          `thrown: ${String(e.message ?? e)
            .split('\n')[0]
            .slice(0, 200)}`,
        ),
      );
      page.on('console', m => {
        // a file that did not load is counted from its answer below (a tab icon asked for from the root is no error)
        if (m.type() === 'error' && !/^Failed to load resource/.test(m.text()))
          errors.push(`console: ${m.text().split('\n')[0].slice(0, 200)}`);
      });
      page.on('response', r => {
        const u = new URL(r.url());
        if (
          r.status() >= 400 &&
          u.origin === site.origin &&
          u.pathname.startsWith(MOUNT) &&
          !r.request().isNavigationRequest()
        )
          errors.push(`missing: ${u.pathname.slice(MOUNT.length)} (${r.status()})`);
      });
      log(`Opening ${url.href} at ${CARD_SIZE}×${CARD_SIZE}…`);
      // the page's own answer (the last of its redirects), also when Chrome refuses to show an error answer at all
      let status = null;
      page.on('response', r => {
        if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) status = r.status();
      });
      const answer = await page.goto(url.href, { waitUntil: 'load', timeout: 30_000 }).catch(e => ({ failed: e }));
      const landed = new URL(page.url());
      if (answer?.failed || status !== 200 || landed.origin !== site.origin || !landed.pathname.startsWith(MOUNT))
        throw refuse(
          `${url.pathname.slice(MOUNT.length) || 'the page'} answered ${status ?? `nothing (${String(answer?.failed?.message ?? '').split('\n')[0]})`}${status === 404 ? ' (no such file in the game)' : ''}: no picture was written.`,
          'page',
        );
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
  if (!(await insideGame(target.file, roots.dir)))
    throw refuse(`${rel(target.file)} leads outside the game's folder (a link): nothing was written.`, 'outside');
  await writeFile(target.file, data);
  const facts = imageFacts(data);
  const png = path.join(target.folder, ...CARD_FILES[1].split('/'));
  return {
    file: target.file,
    target,
    bytes: data.length,
    width: facts.width,
    height: facts.height,
    from: source,
    replaced,
    over: existsSync(png) ? png : null,
    errors: [...new Set(errors)],
  };
}
