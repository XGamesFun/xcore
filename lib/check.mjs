// The page check: a game made anywhere, checked as xgames.fun hosts it. `xcore check` and publish run it for a brought
// game (gamesfun.json → page, ./publish/page.mjs: `xcore adopt`); the kit runs it for a copy of one of its starts
// that is a page of its own, adding that copy's own two checks (`start`, below).
//
//   A brought game                                            A copy of a start (the kit's `start` hook)
//   1  it builds (its gamesfun.json page.build; skipped with   1  the start's own files kept
//      --no-build)                                             2  kit copies unedited
//   2  it fits the hosting: what publish would refuse (index.html at the root, .env files, links, secrets,
//      backend.json, the host's own paths) and what breaks once hosted (limits, paths from the root, scripts, styles,
//      fonts or frames from other sites): ./publish/adopt.mjs
//   3  the page starts: its published files served under a folder (as xgames.fun Studio's preview serves them) with the
//      play host's page policy (./publish/hosting.mjs), in Chrome at a phone's size and a desktop's, and at a phone's
//      size inside a stand-in for the play page's frame (its sandbox and allow, ./play-policy.mjs), opened from a link
//      with a query string, as players meet it: no error thrown, nothing in the console's errors, none of its own files
//      missing, it shows something, and (framed) no pop-up, form submit or top-level navigation the frame blocks
//   4  it stays inside its origins: every request the page made is one the hosted page may make (its own files, the
//      host's own paths, backend.json's origins); a script, style, font or frame from another site, or a connection to
//      an origin backend.json does not list, fails it
//
// What it does not check: that the game plays as it should. The person who brought a game knows its own tests.
// The record goes in <game>/evidence/verify-N/record.json, as the kit's verify writes its own.
// The callbacks given to page.addInitScript and page.evaluate run in the browser, not in Node.
/* global window, document, getComputedStyle, innerHeight, innerWidth, addEventListener, HTMLFormElement, Image */
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, normalize, relative, resolve, sep } from 'node:path';
import { answerMs, answerOf, launchBrowser, PAGE_STOPPED, PageStopped } from './browser.mjs';
import { buildFailure, pageFile, pageRoots, runBuild } from './publish/page.mjs';
import { backendOrigins, BACKEND_FILE } from './publish/scan.mjs';
import { hostedRefusal, isHostPath, mimeFor, pageHeaders } from './publish/hosting.mjs';
import { readServerConfig } from './server/contract.mjs';
import { leftOutOfPublish, uploadWords } from './publish/tree.mjs';
import { CMD } from './command.mjs';
import { CLIENT_FILE, CLIENT_TAG, staleClient } from './add.mjs';
import { ECONOMY_FILES, isObject, noEconomy } from './economy.mjs';
import { ownOrigins } from './publish/client.mjs';
import { PLAY_FRAME_ALLOW, PLAY_FRAME_SANDBOX } from './play-policy.mjs';
import { readOwnJson } from './util.mjs';
import { madeByKit } from './games.mjs';

// framed: the game inside the play page's frame, opened from a shared link (a post, a business card) with a query string
const VIEWS = [
  { name: 'phone', width: 393, height: 660 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'framed', width: 393, height: 660, framed: true },
];
/** How a failure seen only in the framed view is named. */
const FRAMED = "inside the play page's frame (as players meet it)";
/** The query string the framed view opens the game with, as a shared link carries one. */
const SHARED_QUERY = '?from=check';
const SETTLE_MS = Number(process.env.GF_PAGE_SETTLE_MS ?? 5000);
/** Where the page is served on the check's own origin: under a folder, as xgames.fun Studio's preview and `xcore dev` serve it. */
export const MOUNT = '/game/';
/** Where the check's own server takes Chrome's policy-violation reports (outside MOUNT: never a file of the game). */
const REPORTS = '/__gf/csp-report';
/**
 * The check's stand-in for the play page (outside MOUNT): it frames the game as xgames.fun's play page does. Opened at
 * http://localhost:<port>, another site than the game's http://127.0.0.1:<port>, so the game is a cross-site frame
 * there too.
 */
const PLAY_PAGE = '/__gf/play';
const playPage = src =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>play</title><link rel="icon" href="data:,"><style>html,body{margin:0;height:100%;background:#111}iframe{display:block;border:0;width:100%;height:100%}</style></head><body><iframe name="game" src="${src}" sandbox="${PLAY_FRAME_SANDBOX}" allow="${PLAY_FRAME_ALLOW}"></iframe></body></html>`;

/**
 * The published files as static files under MOUNT, with the play host's headers (its page policy for these backend
 * origins, its permissions, nosniff, its types), and a stand-in for the play page that frames them (PLAY_PAGE).
 * → {url (the page's), origin, framedUrl (the play page's), framedOrigin, server (Node's), close}
 * `xcore dev` (./dev/index.mjs) adds: `route(req, res, url)`, tried first (→ true when it answered: the game's server,
 * the platform, the RPC); `html(text)`, applied to each .html file served; `port` (default: any free one); `files`: the
 * origin of the game's files (its files domain here), which the page may load pictures, sounds and fonts from.
 */
export function servePage(
  dir,
  { backend = [], server = false, route = null, html = null, port = 0, overlay = null, files = [] } = {},
) {
  const root = resolve(dir);
  const over = overlay ? resolve(overlay) : null;
  // the play host's policy, plus a report address on this check's own server: Chrome reports every violation there,
  // a Web Worker's too, which no page event shows (a worker gets its policy from its own script's headers)
  // framed by the play page's stand-in, as the play host lets the play page frame the game: set once it listens
  let headers;
  const reports = [];
  const srv = createServer(async (req, res) => {
    if (req.url === PLAY_PAGE && req.method === 'GET') {
      const src = `http://127.0.0.1:${srv.address().port}${MOUNT}${SHARED_QUERY}`;
      res
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        .end(playPage(src));
      return;
    }
    if (req.url === REPORTS && req.method === 'POST') {
      let body = '';
      for await (const c of req) body += c;
      try {
        const r = JSON.parse(body)['csp-report'] ?? {};
        reports.push({
          uri: String(r['blocked-uri'] ?? ''),
          directive: String(r['effective-directive'] ?? r['violated-directive'] ?? '').split(' ')[0],
          from: String(r['source-file'] ?? r['document-uri'] ?? ''),
        });
      } catch {}
      res.writeHead(204).end();
      return;
    }
    if (route) {
      try {
        if (await route(req, res, new URL(req.url, 'http://x'))) return;
      } catch (e) {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'dev', message: String(e?.message ?? e) }));
        return;
      }
    }
    let p;
    try {
      p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (!p.startsWith(MOUNT)) {
      // the host's own paths answer once published (not here); anything else from the root is outside the game
      res
        .writeHead(404, { 'content-type': 'application/json', 'x-gf-host-path': isHostPath(p, { server }) ? '1' : '0' })
        .end(JSON.stringify({ error: 'not served here' }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    let rel = p.slice(MOUNT.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    let file = normalize(join(root, rel));
    // what publish leaves out is not served here either: a page that loads it fails here as it would live
    const hidden = leftOutOfPublish(rel);
    // a file the overlay has (an engine's export with xcore's files beside it, gamesfun.json page.static) is its
    if (over && !hidden) {
      const o = normalize(join(over, rel));
      if (o.startsWith(over + sep) && (await stat(o).catch(() => null))?.isFile()) file = o;
    }
    if (!(file.startsWith(root + sep) || (over && file.startsWith(over + sep))) || hidden) {
      res.writeHead(404).end();
      return;
    }
    try {
      const s = await stat(file);
      if (s.isDirectory()) {
        res.writeHead(308, { location: `${MOUNT}${rel}/` }).end();
        return;
      }
      if (!s.isFile()) {
        res.writeHead(404).end();
        return;
      }
      // one byte range, as the play host answers it (a video or a sound seeks with one)
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      const type = { ...headers, 'content-type': mimeFor(rel), 'accept-ranges': 'bytes' };
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, s.size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), s.size - 1) : s.size - 1;
        if (start >= s.size || start > end) {
          res.writeHead(416, { ...type, 'content-range': `bytes */${s.size}` }).end();
          return;
        }
        res.writeHead(206, {
          ...type,
          'content-range': `bytes ${start}-${end}/${s.size}`,
          'content-length': end - start + 1,
        });
        res.end(req.method === 'HEAD' ? undefined : (await readFile(file)).subarray(start, end + 1));
        return;
      }
      let bytes = await readFile(file);
      if (html && /\.html?$/i.test(rel)) bytes = Buffer.from(html(bytes.toString('utf8')));
      res.writeHead(200, type).end(req.method === 'HEAD' ? undefined : bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ok, fail) =>
    srv.once('error', fail).listen(port, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${srv.address().port}`;
      const framedOrigin = `http://localhost:${srv.address().port}`;
      const base = pageHeaders(backend, null, files, framedOrigin);
      headers = {
        ...base,
        'content-security-policy': `${base['content-security-policy']}; report-uri ${REPORTS}`,
        'cache-control': 'no-store',
      };
      ok({
        origin,
        url: `${origin}${MOUNT}`,
        framedOrigin,
        framedUrl: `${framedOrigin}${PLAY_PAGE}`,
        reports,
        root,
        server: srv,
        close: () =>
          new Promise(r => {
            srv.closeAllConnections?.();
            srv.close(r);
          }),
      });
    }),
  );
}

/**
 * gamesfun.js published but not loaded by the published index.html: a build that writes index.html from a template
 * drops a tag added to the file it writes (xcore add signin adds it to index.html). → [problem]
 */
export function unloadedClient(files, roots) {
  if (!files.some(f => f.path === 'gamesfun.js') || !files.some(f => f.path === 'index.html')) return [];
  let html;
  try {
    html = readFileSync(pageFile(roots, 'index.html'), 'utf8');
  } catch {
    return [];
  }
  if (CLIENT_TAG.test(html)) return [];
  return [
    `index.html does not load gamesfun.js, which is published beside it${roots.build ? ` (${roots.build} writes index.html: put <script src="./gamesfun.js"></script> first in <head> of the file it is made from, such as its template)` : ' (put <script src="./gamesfun.js"></script> first in its <head>)'}`,
  ];
}

/**
 * The files `loot add`, `backend use` and `add signin` put in the folder a build copies as it is (gamesfun.json
 * page.static) that the build did not copy into what is published (an engine's export run by a build command of the
 * person's own, which lays no overlay). → [problem]
 */
export function uncopiedStatic(files, roots) {
  if (!roots.build || !roots.static || resolve(roots.static) === resolve(roots.out)) return [];
  const published = new Set(files.map(f => f.path));
  const at = relative(roots.dir, roots.static).split(sep).join('/');
  const want = [...ECONOMY_FILES, 'gf/loot/release.json', BACKEND_FILE, CLIENT_FILE].filter(f =>
    existsSync(join(roots.static, ...f.split('/'))),
  );
  const missing = want.filter(f => !published.has(f));
  if (!missing.length) return [];
  return [
    `${missing.map(f => `${at}/${f}`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} not in what is published: ${roots.build} must copy ${at}/ into ${relative(roots.dir, roots.out).split(sep).join('/') || '.'} as it is (Vite does for public/; an engine's export run by a script of your own does not)`,
  ];
}

/**
 * The errors the first-session walk met that a player meets too: not the frame refusing focus taken as the page loads
 * (a note of check 3's, and the first tap gives it).
 */
export const walkErrors = first =>
  (first?.errors ?? []).filter(e => !/Permissions policy violation: focus-without-user-activation\b/.test(e.text));

/** Is the page in `out` a Godot Web export (its index.html starts the engine with GODOT_CONFIG, or an index.pck)? */
function godotExport(out) {
  if (existsSync(join(out, 'index.pck'))) return true;
  try {
    return /\bGODOT_CONFIG\b/.test(readFileSync(join(out, 'index.html'), 'utf8'));
  } catch {
    return false;
  }
}

/**
 * A Godot project's file changed after its Web export was made (the export's index.pck is older): the newest one, as a
 * path from the project, or null. Scenes, scripts, resources and the project's settings; never xcore's folders.
 */
export async function staleExport(game, out) {
  return (await newerThanExport(game, out))?.rel ?? null;
}

/**
 * How long after the export a change to the project fails publish's gate on its time alone. A clone, a copy or an
 * unzip writes every file within seconds of the others, the export among them, so a gap that small says nothing.
 */
export const STALE_GATE_MS = 10 * 60_000;

/** What project.godot autoloads: [{name, path}], each path from the project (`addons/gamesfun/gamesfun.gd`). */
function autoloads(project) {
  const section = /^\[autoload\][^\n]*\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(project)?.[1] ?? '';
  return [...section.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*"\*?res:\/\/([^"]+)"/gm)].map(m => ({
    name: m[1],
    path: m[2],
  }));
}

/** Which of `needles` the file holds, read a piece at a time. → Set */
async function fileHolds(file, needles) {
  const found = new Set();
  const keep = Math.max(...needles.map(n => Buffer.byteLength(n))) - 1;
  let tail = '';
  for await (const chunk of createReadStream(file, { highWaterMark: 4 << 20 })) {
    const text = tail + chunk.toString('latin1');
    for (const n of needles) if (!found.has(n) && text.includes(n)) found.add(n);
    if (found.size === needles.length) break;
    tail = text.slice(-keep);
  }
  return found;
}

/**
 * The autoloads of project.godot that a Godot Web export has no file for (`GamesFun`, added after the export was
 * made): [{name, path}]. [] when they are all there, or when the export's list of files cannot be read (an
 * encrypted one has no plain project.binary in it).
 */
export async function missingAutoloads(game, out) {
  let wanted;
  try {
    wanted = autoloads(await readFile(join(game, 'project.godot'), 'utf8'));
  } catch {
    return [];
  }
  const pck = join(out, 'index.pck');
  if (!wanted.length || !existsSync(pck)) return [];
  const found = await fileHolds(pck, ['project.binary', ...wanted.map(w => w.path)]).catch(() => null);
  if (!found?.has('project.binary')) return [];
  return wanted.filter(w => !found.has(w.path));
}

/** The newest of a Godot project's files changed after its Web export: {rel, after (ms after the export)}, or null. */
async function newerThanExport(game, out) {
  if (!existsSync(join(game, 'project.godot'))) return null;
  let made;
  try {
    made = (await stat(join(out, 'index.pck'))).mtimeMs;
  } catch {
    return null;
  }
  const SKIP = new Set([
    '.godot',
    '.git',
    '.work',
    'build',
    'evidence',
    'gamesfun',
    'node_modules',
    'server',
    'addons',
  ]);
  const SOURCE = /\.(gd|tscn|tres|scn|res|gdshader|cfg|godot|png|webp|jpg|ogg|wav|mp3|glb|gltf|obj|ttf|otf|json)$/i;
  let newest = null;
  const walk = async (dir, depth) => {
    if (depth > 6) return;
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.') && e.name !== '.gdignore') continue;
      const full = join(dir, e.name);
      if (full === out || (depth === 0 && SKIP.has(e.name))) continue;
      if (e.isDirectory()) {
        if (!existsSync(join(full, '.gdignore'))) await walk(full, depth + 1);
      } else if (SOURCE.test(e.name) && e.name !== 'export_presets.cfg') {
        const t = (await stat(full)).mtimeMs;
        if (t > made + 1000 && (!newest || t > newest.t))
          newest = { t, rel: relative(game, full).split(sep).join('/') };
      }
    }
  };
  await walk(game, 0);
  return newest ? { rel: newest.rel, after: newest.t - made } : null;
}

export const EVIDENCE_GITIGNORE = `# xcore check's screenshots and records: never published, and kept out of git. Delete this file to commit them.
*
`;

async function nextOut(dir) {
  const root = join(dir, 'evidence');
  let n = 0;
  try {
    for (const e of await readdir(root)) {
      const m = /^verify-(\d+)$/.exec(e);
      if (m) n = Math.max(n, Number(m[1]));
    }
  } catch {}
  return join(root, `verify-${n + 1}`);
}

/** Kinds of request backend.json can allow (connect-src, img-src, media-src); every other kind stays refused. */
const DECLARABLE = new Set(['connect', 'image', 'media']);
/** Is this path from the root one of the game's own pages (a folder with index.html, or a .html file) under `root`? */
function isOwnPage(root, urlPath) {
  const rel = urlPath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!rel || rel.split('/').some(x => x === '..' || x.startsWith('.'))) return false;
  return existsSync(join(root, rel, 'index.html')) || existsSync(join(root, `${rel}.html`));
}

/** A tab icon: asked for from the root, it shows at the game's own link and not under a folder; a note, not a failure. */
const ICON = /(^|\/)(favicon[^/]*|apple-touch-icon[^/]*)$/i;
const DIRECTIVE_KIND = {
  'script-src': 'script',
  'script-src-elem': 'script',
  'style-src': 'stylesheet',
  'style-src-elem': 'stylesheet',
  'font-src': 'font',
  'frame-src': 'frame',
  'child-src': 'frame',
  'img-src': 'image',
  'media-src': 'media',
  'connect-src': 'connect',
  'worker-src': 'script',
  'object-src': 'object',
  'manifest-src': 'manifest',
  'base-uri': 'base',
  'form-action': 'form',
};

/** Console errors an engine prints on every host, which say nothing about the game: Emscripten's (Unity, Godot). */
const ENGINE_NOISE = [
  /^Looks like you are rendering without using requestAnimationFrame/,
  /FS\.syncfs operations in flight at once/,
];
/** The engine's own telemetry: refused by the hosted page, and the game plays on without it. → its name, or null */
export const engineTelemetry = origin =>
  /^https:\/\/([a-z0-9-]+\.)*cloud\.unity3d\.com$/i.test(origin) ? "Unity's own analytics (Unity Services)" : null;

/** What the play page's frame blocks (docs/HOSTING.md, "Inside the play page"), as the framed view words an attempt at it. */
const SEE_ROW = 'docs/HOSTING.md, "Inside the play page"';
export const FRAME_BLOCKS = Object.freeze({
  popup: `it opens a pop-up (window.open) as it loads, and the play page's frame blocks pop-ups (its sandbox has no allow-popups): nothing opens there (${SEE_ROW})`,
  form: `it submits a form as it loads, and the play page's frame blocks form submits (its sandbox has no allow-forms): nothing is sent there (${SEE_ROW})`,
  top: `it navigates the top window (top.location) as it loads, and the play page's frame blocks that (its sandbox has no allow-top-navigation): the assignment throws there (${SEE_ROW})`,
});
/** Chrome's own words, in the console, when the sandbox blocks one of them (a call the game wraps in try still logs). */
export const BLOCKED_SAYS = [
  ['popup', /^Blocked opening .* in a new window because the request was made in a sandboxed frame/],
  ['form', /^Blocked form submission .*sandboxed/],
  ['top', /^Unsafe attempt to initiate navigation .*sandboxed/],
];
/** The SecurityError a top.location assignment throws in a sandboxed frame. */
export const TOP_THROWS = /does not have permission to navigate the target frame/;

/**
 * Run in the game's frame as it loads (page.addInitScript, with TOP_THROWS.source): every attempt at what the play
 * page's frame blocks goes in window.__gfBlocked (the play page's own frame runs this too, and records nothing).
 */
export function watchFrameBlocks(throws) {
  if (window === window.top) return;
  const tried = (window.__gfBlocked = []);
  const note = what => tried.includes(what) || tried.push(what);
  const open = window.open;
  window.open = function (...a) {
    note('popup');
    return open.apply(this, a);
  };
  for (const m of ['submit', 'requestSubmit']) {
    const was = HTMLFormElement.prototype[m];
    if (typeof was === 'function')
      HTMLFormElement.prototype[m] = function (...a) {
        note('form');
        return was.apply(this, a);
      };
  }
  addEventListener('submit', () => note('form'), true);
  // top.location = …: a SecurityError thrown in the frame (when the game catches it, Chrome's console line says it)
  const top = e => new RegExp(throws).test(String(e?.message ?? e)) && note('top');
  addEventListener('error', e => top(e.error ?? e));
  addEventListener('unhandledrejection', e => top(e.reason));
}

/**
 * One view of the page: at the top of its tab, or (view.framed) inside the play page's stand-in, where every judgment
 * is made on the game's frame. → {errors, missing, rootPaths, refused: [{origin, kind, why}], reached: [origin],
 * blocked: [popup|form|top], shows, shot, stopped}. `stopped`: the page gave no answer to a question in time (a script
 * that never yields); its errors say so, and nothing asked after that was read.
 */
async function look(browser, site, view, out, { backend, server = false }) {
  const framed = !!view.framed;
  const page = await browser.newPage({ viewport: { width: view.width, height: view.height } });
  // the game's frame: the page itself, or the play page's frame (by its name: the game may change its own URL)
  const game = () => (framed ? page.frame({ name: 'game' }) : page.mainFrame());
  // a page that answers one question too late is asked no more: each further one would wait as long
  let stopped = false;
  /** fn run in the game's frame → its answer, or `none` when there is no frame, it fails, or the page stopped answering */
  const inGame = async (fn, none) => {
    if (stopped) return none;
    try {
      return await answerOf(game()?.evaluate(fn) ?? Promise.resolve(none));
    } catch (e) {
      stopped = e instanceof PageStopped;
      return none;
    }
  };
  const blocked = new Set();
  let focused = false; // it took focus as it loaded, which the frame refuses until the first tap
  const errors = [],
    missing = [],
    rootPaths = [],
    refused = [],
    reached = new Set();
  const own = u => {
    try {
      return new URL(u).origin === site.origin;
    } catch {
      return false;
    }
  };
  const hostPath = r => r.headers()['x-gf-host-path'] === '1';
  // the browser's own reports of what the page policy refused (the hosted page gets the same answers)
  await page.addInitScript(() => {
    const seen = (window.__gfRefused = []);
    document.addEventListener('securitypolicyviolation', e =>
      seen.push({ uri: String(e.blockedURI || ''), directive: e.effectiveDirective || e.violatedDirective || '' }),
    );
  });
  // framed: every attempt, while it loads and settles, at what the play page's frame blocks (the play page's own frame
  // runs this too, and records nothing)
  if (framed) await page.addInitScript(watchFrameBlocks, TOP_THROWS.source);
  const ownPages = new Set(), // the game's own pages, linked from the root (a multi-page build's links)
    hostAsked = new Set(),
    serverAsked = new Set(),
    icons = new Set(),
    unreachable = new Set();
  // a child frame's errors and console lines reach the page's events (a cross-site frame's too: tests/check.test.mjs)
  page.on('pageerror', e => {
    const text = String(e.message ?? e);
    if (framed && TOP_THROWS.test(text)) return blocked.add('top');
    errors.push(`thrown: ${text.slice(0, 300)}`);
  });
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const text = m.text();
    const sandboxed = framed && BLOCKED_SAYS.find(([, re]) => re.test(text));
    if (sandboxed) return blocked.add(sandboxed[0]);
    // the stand-in play page's own lines are not the game's
    if (framed && (m.location()?.url ?? '').startsWith(`${site.framedOrigin}/`)) return;
    if (/Content Security Policy|^Refused to /i.test(text)) return; // counted in check 4, from the page's own reports
    if (ENGINE_NOISE.some(re => re.test(text))) return;
    // Godot prints its warnings, and the source line under each message, as errors: a warning does not stop a game
    if (/^WARNING: /.test(text) || /^\s+at: \S+ \([^)]*:\d+\)$/.test(text)) return;
    // a feature the play page's frame does not grant (its allow list): said once, in words, with what to do. Focus
    // taken as the page loads is no failure: the frame refuses it, and the player's first tap gives it.
    const device = /Permissions policy violation: ([\w-]+) is not allowed/.exec(text);
    if (device?.[1] === 'focus-without-user-activation') {
      focused = true;
      return;
    }
    if (device) {
      errors.push(
        `it asks for the ${device[1]}, which the play page's frame does not allow (it allows ${PLAY_FRAME_ALLOW}): give the player another way`,
      );
      return;
    }
    const at = m.location()?.url ?? '';
    if (/^Failed to load resource/.test(text) && own(at)) return; // counted from the responses: missing, a host path or a root path
    // a WebSocket to the game's own server (api/…): it answers once published, never in this check
    const socket = /WebSocket connection to '(wss?:\/\/[^']+)' failed/.exec(text);
    if (socket && server) {
      try {
        const p = new URL(socket[1]).pathname;
        if (p.startsWith(`${MOUNT}api/`)) {
          serverAsked.add(p.slice(MOUNT.length));
          return;
        }
      } catch {}
    }
    // the game's own backend not answering this machine is the backend's state, not the page's: said, not failed
    if (/^Failed to load resource/.test(text) && backend.some(o => at.startsWith(o))) {
      unreachable.add(`${new URL(at).origin} (${text.replace(/^Failed to load resource:\s*/, '').slice(0, 80)})`);
      return;
    }
    errors.push(`console: ${text.slice(0, 300)}`);
  });
  page.on('request', r => {
    try {
      const o = new URL(r.url()).origin;
      if (o !== site.origin && !(framed && o === site.framedOrigin) && /^(https?|wss?):/.test(r.url())) reached.add(o);
    } catch {}
  });
  page.on('websocket', ws => {
    try {
      const u = new URL(ws.url());
      if (u.host !== new URL(site.origin).host)
        reached.add(u.origin === 'null' ? `${u.protocol}//${u.host}` : u.origin);
    } catch {}
  });
  page.on('response', r => {
    if (r.status() < 400 || !own(r.url())) return;
    const p = new URL(r.url()).pathname;
    if (p.startsWith(MOUNT) && server && p.startsWith(`${MOUNT}api/`)) serverAsked.add(p.slice(MOUNT.length));
    else if (p.startsWith(MOUNT))
      missing.push(`${p.slice(MOUNT.length)} (${r.status()})`); // relative to the page, as it asked
    else if (hostPath(r)) hostAsked.add(p.split('/').slice(0, 3).join('/'));
    else if (ICON.test(p)) icons.add(p);
    else if (site.root && isOwnPage(site.root, p)) ownPages.add(p);
    else rootPaths.push(p);
  });
  let notLoaded = null;
  await page.goto(framed ? site.framedUrl : site.url, { waitUntil: 'load', timeout: 30000 }).catch(e => {
    notLoaded = `did not load: ${e.message.split('\n')[0]}`;
  });
  await page.waitForTimeout(SETTLE_MS);
  if (framed && !game()) errors.push("the play page's frame has no game in it");
  // something on screen: visible text, or a drawn canvas, or a visible picture. A canvas is looked at, not taken on
  // its size: one drawn in a single flat colour (or never drawn) shows nothing.
  const seen = await inGame(() => {
    const seen = el => {
      const r = el.getBoundingClientRect(),
        s = getComputedStyle(el);
      return (
        r.width > 4 &&
        r.height > 4 &&
        s.visibility !== 'hidden' &&
        s.display !== 'none' &&
        Number(s.opacity) > 0.05 &&
        r.bottom > 0 &&
        r.top < innerHeight
      );
    };
    const text = (document.body?.innerText ?? '').trim().length > 0;
    const pic = [...document.querySelectorAll('img, svg, video')].some(seen);
    // each canvas on screen, by the part of it in view
    const canvases = [...document.querySelectorAll('canvas')]
      .filter(c => seen(c) && c.width > 0 && c.height > 0)
      .map(c => {
        const r = c.getBoundingClientRect();
        const x = Math.max(0, r.left),
          y = Math.max(0, r.top);
        return { x, y, width: Math.min(innerWidth, r.right) - x, height: Math.min(innerHeight, r.bottom) - y };
      })
      .filter(r => r.width > 4 && r.height > 4)
      .sort((a, b) => b.width * b.height - a.width * a.height);
    return { text, pic, canvases };
  }, null);
  let shows = Boolean(seen && (seen.text || seen.pic));
  let flat = false;
  if (seen && !shows && seen.canvases.length && !stopped) {
    shows = await drawn(browser, page, seen.canvases[0]);
    flat = !shows;
  }
  // a router that reads the path moves the page out of its folder (history.replaceState to "/"): every relative URL
  // then resolves from the root, so what looks like "paths from the root" is that router
  let moved = null,
    left = null;
  try {
    const now = new URL(game().url());
    // another site altogether (location set to it): the game left, no router of its own did that
    if (now.origin !== site.origin) left = now.origin === 'null' ? now.href : now.origin;
    else if (!now.pathname.startsWith(MOUNT)) moved = now.pathname;
  } catch {}
  // the page's own events, and Chrome's reports to the check's server (a worker's violations arrive only there)
  await page.waitForTimeout(300);
  const reports = [...((await inGame(() => window.__gfRefused, [])) ?? []), ...(site.reports ?? []).splice(0)];
  for (const v of reports) {
    const kind = DIRECTIVE_KIND[v.directive] ?? 'connect';
    let origin = v.uri;
    try {
      origin = /^[a-z]+:\/\//i.test(v.uri) ? new URL(v.uri).origin : v.uri;
    } catch {}
    if (origin === 'null' && /^wss?:/i.test(v.uri)) {
      const u = new URL(v.uri);
      origin = `${u.protocol}//${u.host}`;
    }
    const why =
      kind === 'base'
        ? 'a <base> element: the hosted page refuses it'
        : kind === 'form'
          ? 'a form post: the hosted page sends none'
          : kind === 'object'
            ? 'an <object> or <embed>: the hosted page loads none'
            : ['inline', 'eval', 'self', ''].includes(origin)
              ? `${kind} (${v.directive})`
              : (hostedRefusal(origin, kind, { backend }) ?? `${kind} from ${origin} (${v.directive})`);
    if (!refused.some(x => x.why === why)) refused.push({ origin, kind, why });
  }
  if (framed) for (const b of (await inGame(() => window.__gfBlocked, [])) ?? []) blocked.add(b);
  const shot = join(out, `${view.name}.png`);
  // (a page that stopped answering gives no picture either)
  if (!stopped) await page.screenshot({ path: shot, timeout: answerMs() }).catch(() => {});
  await answerOf(page.close()).catch(() => {});
  // a page that stopped answering did not finish loading either: said once, as what happened
  if (stopped) errors.unshift(PAGE_STOPPED);
  else if (notLoaded) errors.unshift(notLoaded);
  return {
    stopped,
    errors,
    blocked: Object.keys(FRAME_BLOCKS).filter(k => blocked.has(k)),
    missing,
    rootPaths: [...new Set(rootPaths)],
    icons: [...icons],
    unreachable: [...unreachable],
    refused,
    reached: [...reached],
    hostAsked: [...hostAsked],
    ownPages: [...ownPages],
    moved,
    left,
    serverAsked: [...serverAsked],
    shows,
    flat,
    focused,
    shot,
  };
}

/**
 * Is anything drawn in the part of the page at `clip` (a canvas, in view): more than one colour in a picture of it?
 * The picture is Chrome's own (a WebGL canvas reads blank from its own pixels once drawn), looked at in a page of its
 * own, so nothing is added to the game's. → true, or false for a single flat colour; true when it can't be told.
 */
async function drawn(browser, page, clip) {
  let other = null;
  try {
    const png = await page.screenshot({ clip, timeout: answerMs() });
    other = await browser.newPage();
    return await answerOf(
      other.evaluate(
        async src => {
          const img = new Image();
          img.src = src;
          await img.decode();
          const w = Math.min(img.width, 160),
            h = Math.max(1, Math.round((img.height * w) / img.width));
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0, w, h);
          const d = g.getImageData(0, 0, w, h).data;
          for (let i = 4; i < d.length; i += 4)
            for (let k = 0; k < 3; k++) if (Math.abs(d[i + k] - d[k]) > 12) return true;
          return false;
        },
        `data:image/png;base64,${png.toString('base64')}`,
      ),
    );
  } catch {
    return true;
  } finally {
    await other?.close().catch(() => {});
  }
}

/**
 * A brought game: gamesfun.json names its page (xcore adopt), and it is no game of the kit's (no gf-three.json).
 * Throws, in words, on a gamesfun.json that is not valid JSON.
 */
export const isBroughtGame = dir => !!readOwnJson(join(dir, 'gamesfun.json'))?.page && !madeByKit(dir);

/**
 * Check `dir` as a page. start: the kit's hook for a copy of one of its starts that is a page of its own: { id,
 * kept(game) → [{n, name, ok, detail}] (checks 1 and 2), notes(game) → [line] }. launch: another browser launcher
 * (the kit's). port: where the page is served (default: any free one). onOut(dir): told where the record goes once that
 * folder is made. → the record ({kind, pass, checks, notes, warnings (when there are any), outDir, …})
 */
export async function pageVerify(
  dir,
  {
    quick = false,
    out = null,
    noBuild = false,
    justBuilt = false,
    log = () => {},
    start = null,
    launch = null,
    port = 0,
    walk = !quick,
    onOut = () => {},
  } = {},
) {
  const game = resolve(dir),
    started = new Date();
  const brought = !start && isBroughtGame(game);
  const base = start;
  // the game's own server (server/ and gamesfun.json → server): it answers api/ once published, never in this check
  const hasServer = (await readServerConfig(game)).has;
  if (!brought && !base)
    throw new Error(`${dir}: not a page this checks (no gamesfun.json → page: run ${CMD} adopt first)`);
  const outDir = out ? resolve(out) : await nextOut(game);
  await mkdir(outDir, { recursive: true });
  // (where the record goes, as soon as it is made: a check stopped half way takes it away again)
  onOut(outDir);
  // in a Godot project, Godot imports every file under it into the game's own package: evidence/ is the check's, not
  // the game's (a .gdignore keeps Godot out of it)
  if (!out && existsSync(join(game, 'project.godot')) && !existsSync(join(game, 'evidence', '.gdignore')))
    await writeFile(join(game, 'evidence', '.gdignore'), '').catch(() => {});
  // never published (publish leaves evidence/ out), and kept out of git by a .gitignore of its own, as .gamesfun/ is;
  // one already there is left as it is
  if (!out && !existsSync(join(game, 'evidence', '.gitignore')))
    await writeFile(join(game, 'evidence', '.gitignore'), EVIDENCE_GITIGNORE, { flag: 'wx' }).catch(() => {});
  const checks = [],
    notes = [];
  const check = (n, name, ok, detail) => {
    checks.push({ n, name, gate: n <= 2 ? 'A' : 'B', ok, detail });
    log(`${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'} ${n} ${name}: ${detail}`);
  };
  const roots = pageRoots(game);
  let built = true;
  // its preview picture (../card.mjs), among the files that go up: reported, never a check of its own
  let card = null;
  // the fingerprint of the files that go up, as checked (./publish/tree.mjs filesFingerprint)
  let filesFingerprint = null;
  // the first-session walk (./journey.mjs): informs, never a check of its own; not in publish's quick gate
  let first = null;

  // what the person should know beside a verdict that does not fail for it (an export older than its project)
  const warnings = [];
  if (brought) {
    const exported = roots.out === game ? '.' : relative(game, roots.out).split(sep).join('/');
    const newer = !roots.build ? await newerThanExport(game, roots.out) : null;
    const stale = newer?.rel ?? null;
    const missing = !roots.build && newer ? await missingAutoloads(game, roots.out) : [];
    const lacks = missing.length
      ? `the engine's web export in ${exported} has nothing of ${missing.map(m => `${m.name} (${m.path})`).join(', ')}, which project.godot autoloads: it was exported before ${missing.length === 1 ? 'that was' : 'those were'} added`
      : null;
    if (lacks) warnings.push(`${lacks}. Export again, then check`);
    else if (stale)
      warnings.push(
        `the engine's web export in ${exported} is older than the project (${stale} changed after it was exported): what is checked, and what publish would send, is the old game. Export again, then check`,
      );
    // publish sends what it checks: an export that is plainly old (an autoload it lacks, or a change made well after
    // it) never passes there, so no pass is remembered for it. A gap of seconds, as a clone or a copy leaves, is a note.
    if (quick && (lacks || newer?.after > STALE_GATE_MS))
      check(
        1,
        'it builds',
        false,
        lacks
          ? `${lacks}: export again, then publish`
          : `the engine's web export in ${exported} is older than the project (${stale} changed after it was exported): export again, then publish`,
      );
    else if (!roots.build)
      check(
        1,
        'it builds',
        null,
        existsSync(join(game, 'project.godot')) || existsSync(join(game, 'ProjectSettings', 'ProjectVersion.txt'))
          ? `no build here: the engine's web export in ${exported} is checked as it was last exported (export again after a change)${stale ? `; ${stale} changed after it was exported` : ''}`
          : 'no build: plain static files',
      );
    else if (justBuilt) check(1, 'it builds', true, `${roots.build} passed, just before this check`);
    else if (noBuild) check(1, 'it builds', null, `not run (--no-build): the files built last are checked`);
    else {
      const b = await runBuild(game, { onLine: l => log(`  build: ${l}`) });
      built = b.code === 0;
      check(
        1,
        'it builds',
        built,
        built
          ? `${roots.build} passed in ${b.seconds} s`
          : `${roots.build} failed with exit code ${b.code}${buildFailure(b) ? `: ${buildFailure(b)}` : ''}`,
      );
    }
    if (built) {
      // loaded when used: ./publish/index.mjs loads this module too
      const { preflight } = await import('./publish/index.mjs');
      const { detectShape, scanPage } = await import('./publish/adopt.mjs');
      const pre = await preflight(game);
      filesFingerprint = pre.built.filesFingerprint;
      if (pre.linkName) notes.push(pre.linkName);
      const { cardJson } = await import('./card.mjs');
      card = {
        ...cardJson(pre.card),
        wanted: pre.cardSetting,
        level: pre.cardWords.level,
        line: pre.cardWords.line,
        missing: pre.cardWords.missing === true,
      };
      const scan = existsSync(roots.out)
        ? await scanPage(roots.out, {
            backend: pre.backend,
            prefix: relative(game, roots.out).split(sep).join('/') || '.',
            hasServer,
            framework: detectShape(game).framework,
            source: roots.build ? game : null,
          })
        : { fix: [] };
      const bad = [
        ...pre.problems,
        ...(pre.secrets ? [pre.secrets.replace(/^Nothing was published: /, '')] : []),
        ...(pre.names ? [pre.names] : []),
        ...scan.fix.map(f => `${f.what} (${f.fix})`),
        ...unloadedClient(pre.built.tree.files, roots),
        ...uncopiedStatic(pre.built.tree.files, roots),
      ];
      check(
        2,
        'it fits the hosting',
        bad.length === 0,
        bad.length
          ? bad.slice(0, 8).join('; ')
          : `${uploadWords({ files: pre.built.tree.files.length, bytes: pre.built.bytes, added: pre.built.added })}; nothing publish would refuse (${CMD} adopt lists what is worth a look)`,
      );
    } else check(2, 'it fits the hosting', null, 'not read: the build failed');
  } else for (const c of await base.kept(game)) check(c.n, c.name, c.ok, c.detail);

  // backend.json's origins are the page's policy here: under one that is not valid JSON no page is opened, since every
  // call to the game's own backend would then be refused for a reason that is not the game's
  let backend = [],
    backendProblem = null;
  try {
    backend = backendOrigins(readOwnJson(pageFile(roots, BACKEND_FILE)), { own: ownOrigins() }).origins;
  } catch (e) {
    backendProblem = e.message;
  }
  if (!built || !existsSync(join(roots.out, 'index.html'))) {
    const why = !built
      ? 'not run: the build failed'
      : `no index.html in ${relative(game, roots.out).split(sep).join('/') || 'the game'}${roots.build ? ' (build it first, or check it without --no-build)' : ''}`;
    check(3, 'the page starts', built ? false : null, why);
    check(4, 'it stays inside its origins', null, 'not run: the page did not start');
  } else if (backendProblem) {
    check(3, 'the page starts', false, `not opened: ${backendProblem}`);
    check(4, 'it stays inside its origins', null, `not run: ${BACKEND_FILE} could not be read`);
  } else {
    const site = await servePage(roots.out, { backend, server: hasServer, overlay: roots.overlay, port });
    let browser = null;
    try {
      browser = await (launch ?? launchBrowser)();
      // a page that stopped answering in one view is not opened in the next: each would wait as long for nothing
      const views = [];
      for (const v of VIEWS) {
        views.push({ ...v, ...(await look(browser, site, v, outDir, { backend, server: hasServer })) });
        if (views.at(-1).stopped) break;
      }
      const halted = views.some(v => v.stopped);
      // what each view found, then each finding once, with the views it was found in
      const found = views.map(v => [
        ...v.errors,
        ...v.blocked.map(b => FRAME_BLOCKS[b]),
        ...v.missing.map(m =>
          /^api\//.test(m) && !hasServer
            ? `missing ${m}: the page expects a server at api/, and xgames.fun answers api/ only from the game's own server/ (docs/SERVER.md); otherwise call a backend of your own (${CMD} backend use custom)`
            : /^(undefined|null|NaN) \(/.test(m)
              ? `missing ${m}: the page asked for a file named ${m.split(' ')[0]}, a path from a variable that was not set (a field missing from its data, or a load that failed before it)`
              : `missing ${m}`,
        ),
        // the page left for another site, or a router moved it to the root (its relative URLs then look like paths
        // from the root): say the cause
        ...(v.left
          ? [
              `the page navigated away, to ${v.left}, as it loaded: a player would be taken out of the game. Open another site only when the player taps a link for it`,
            ]
          : v.moved
            ? [
                `the page moved itself out of its folder, to ${v.moved} (a router that reads the path does that): use hash routing (docs/HOSTING.md, "Routing by path")`,
              ]
            : [
                ...v.rootPaths.map(
                  (p, i) => `${p} asked for from the root (${i ? 'the same fix' : 'use a relative path'})`,
                ),
                ...(v.ownPages.length
                  ? [
                      `the game's own pages are linked from the root (${v.ownPages.slice(0, 3).join(', ')}): they work at the published link, not under a folder; see docs/HOSTING.md, "A game of several pages"`,
                    ]
                  : []),
              ]),
        ...(v.shows || v.stopped || v.left
          ? []
          : [
              `nothing on screen after ${SETTLE_MS / 1000} s${v.flat ? ' (its canvas is in one flat colour: never drawn, or drawn blank)' : ''}`,
            ]),
      ]);
      const sizes = vs => vs.map(v => `${v.width}x${v.height}`).join(' and ');
      const where = new Map();
      views.forEach((v, i) => found[i].forEach(f => where.set(f, [...new Set([...(where.get(f) ?? []), v.name])])));
      const bad = [...where].map(
        ([f, at]) => `${at.length === 1 && at[0] === 'framed' ? FRAMED : at.join(', ')}: ${f}`,
      );
      check(
        3,
        'the page starts',
        bad.length === 0,
        bad.length
          ? bad.slice(0, 8).join('; ')
          : `no errors in its first ${SETTLE_MS / 1000} s, nothing missing, something on screen at ${sizes(views.filter(v => !v.framed))} and ${FRAMED} at ${sizes(views.filter(v => v.framed))} (opened from a link with ${SHARED_QUERY}, trying nothing the frame blocks), under the play host's page policy (screenshots in ${views.map(v => `${v.name}.png`).join(', ')})`,
      );
      if (views.some(v => v.focused))
        notes.push(
          `It takes focus as it loads (focus-without-user-activation), which the play page's frame does not allow: Chrome says so in the console, and the game gets focus with the player's first tap instead.${godotExport(roots.out) ? ' To stop the message, set html/focus_canvas_on_start to false in the Web export preset (Project → Export → Web), then export again.' : ''}`,
        );
      const all = [...new Map(views.flatMap(v => v.refused).map(r => [r.why, r])).values()];
      const telemetry = [...new Set(all.map(r => engineTelemetry(r.origin)).filter(Boolean))];
      const refused = all.filter(r => !engineTelemetry(r.origin));
      if (telemetry.length)
        notes.push(
          `${telemetry.join(', ')} tried to reach ${[...new Set(all.filter(r => engineTelemetry(r.origin)).map(r => r.origin))].join(', ')}: the hosted page refuses it and the game plays on. To stop the attempts, turn it off in Unity (Project Settings → Services, or remove the Analytics package).`,
        );
      const reached = [...new Set(views.flatMap(v => v.reached))];
      const asked = [...new Set(views.flatMap(v => v.hostAsked))];
      const unreachable = [...new Set(views.flatMap(v => v.unreachable))];
      if (unreachable.length)
        notes.push(
          `Its backend did not answer this machine: ${unreachable.join(', ')}. The page itself started; check that the backend is up and answers CORS for the game's origin.`,
        );
      const icons = [...new Set(views.flatMap(v => v.icons))];
      if (icons.length)
        notes.push(
          `Its tab icon is asked for from the root (${icons.join(', ')}): it shows at the game's own link, not in Studio's preview or under ${CMD} dev. A relative path shows it everywhere.`,
        );
      const serverAsked = [...new Set(views.flatMap(v => v.serverAsked))].sort();
      if (serverAsked.length)
        notes.push(
          `It calls its own server (${serverAsked.join(', ')}): server/ answers there once published (and under ${CMD} dev, which runs it), not in this check.`,
        );
      if (asked.length)
        notes.push(
          `It calls the play host's own paths (${asked.join(', ')}): they answer once published (and under ${CMD} dev), not in this check.`,
        );
      // what a page that stopped answering asked for is known only in part: no verdict on it
      if (halted) check(4, 'it stays inside its origins', null, 'not run: the page stopped answering');
      else
        check(
          4,
          'it stays inside its origins',
          refused.length === 0,
          refused.length
            ? refused
                .slice(0, 6)
                .map(r => r.why)
                .join('; ') +
                // only a connection, a picture or a sound can be opened up by backend.json; code and styles never are
                (refused.some(r => DECLARABLE.has(r.kind))
                  ? `. The hosted page connects to its own origin and backend.json's origins only (${CMD} backend use custom --url <origin> declares one)`
                  : '')
            : `every request was one the hosted page may make${reached.length ? ` (it made requests to ${reached.join(', ')}, in backend.json)` : ' (its own origin only)'}${backend.length ? `; backend.json: ${backend.join(', ')}` : ''}`,
        );
      // (a page that stopped answering is not walked: the walk would wait on it too)
      if (walk && !halted)
        try {
          const { firstSession, firstSessionLines } = await import('./journey.mjs');
          // an economy file that is not valid JSON stops the walk here, named: never walked as a game with no economy
          const economyAt = ECONOMY_FILES.map(f => pageFile(roots, f)).find(f => existsSync(f));
          const economy = economyAt ? readOwnJson(economyAt) : null;
          if (economyAt && !isObject(economy))
            throw new Error(noEconomy(relative(roots.dir, economyAt).split(sep).join('/')));
          // the economy check's own sentence on a first-time player's first action, for when the walk stops short
          let economyFirst = null;
          if (economyAt)
            try {
              const { economyTold } = await import('./review.mjs');
              economyFirst = economyTold(economyAt).tell.find(t => /\bfirst-time player\b/i.test(t)) ?? null;
            } catch {}
          first = await firstSession(browser, site, {
            out: outDir,
            journey: readOwnJson(join(game, 'gamesfun.json'))?.journey ?? null,
            network: economy ? (economy.network === 'mainnet' ? 'mainnet' : 'devnet') : null,
            economyFirst,
          });
          for (const l of firstSessionLines(first)) log(l);
        } catch (e) {
          first = { error: String(e?.message ?? e).split('\n')[0] };
          log(`first session: the walk could not run (${first.error}); it never fails the check`);
        }
    } catch (e) {
      check(3, 'the page starts', false, `Chrome could not run the page: ${e.message.split('\n')[0]}`);
      check(4, 'it stays inside its origins', null, 'not run: Chrome could not run the page');
    } finally {
      await browser?.close().catch(() => {});
      await site.close();
    }
  }

  // a note only: a folder whose copies can't be read (a gamesfun.json the checks above already name) gets none
  const stale = brought ? await staleClient(game).catch(() => []) : [];
  if (stale.length)
    notes.push(
      `${stale.join(', ')} ${stale.length === 1 ? 'is a copy' : 'are copies'} from an older xcore: ${CMD} add signin brings ${stale.length === 1 ? 'it' : 'them'} up to date (again with add database / add multiplayer, which keep their settings)`,
    );
  if (base) notes.push(...(await base.notes(game)));
  else
    notes.push(
      "A brought game's play is its own: these checks say it builds, fits the hosting, starts clean and stays inside its origins.",
    );
  // an error the walk met is the player's too: said beside the verdict (the walk itself never fails the check)
  const met = walkErrors(first);
  if (met.length)
    warnings.push(
      `${met.length === 1 ? '1 error' : `${met.length} errors`} showed up during the first-session walk (first: ${met[0].text.slice(0, 120)}): the walk never fails the check, but a player meets ${met.length === 1 ? 'it' : 'them'}`,
    );
  const ran = checks.filter(c => c.ok !== null);
  const record = {
    kind: brought ? 'brought-page' : 'template-page',
    ...(base ? { template: base.id } : {}),
    pass: ran.length > 0 && ran.every(c => c.ok),
    quick,
    started: started.toISOString(),
    seconds: Math.round((Date.now() - started.getTime()) / 100) / 10,
    checks,
    notes,
    ...(warnings.length ? { warnings } : {}),
    ...(card ? { card } : {}),
    // what the published files were when checked (after any build): publish keeps a passing run's screenshot for the
    // preview picture while they stay the same
    ...(filesFingerprint ? { filesFingerprint } : {}),
    ...(first ? { firstSession: first } : {}),
    outDir,
  };
  await writeFile(join(outDir, 'record.json'), JSON.stringify(record, null, 2) + '\n');
  return record;
}
