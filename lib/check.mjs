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
//      play host's page policy (./publish/hosting.mjs), in Chrome at a phone's size and a desktop's: no error thrown,
//      nothing in the console's errors, none of its own files missing, and it shows something
//   4  it stays inside its origins: every request the page made is one the hosted page may make (its own files, the
//      host's own paths, backend.json's origins); a script, style, font or frame from another site, or a connection to
//      an origin backend.json does not list, fails it
//
// What it does not check: that the game plays as it should. The person who brought a game knows its own tests.
// The record goes in <game>/evidence/verify-N/record.json, as the kit's verify writes its own.
// The callbacks given to page.addInitScript and page.evaluate run in the browser, not in Node.
/* global window, document, getComputedStyle, innerHeight */
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, normalize, relative, resolve, sep } from 'node:path';
import { launchBrowser } from './browser.mjs';
import { buildFailure, pageFile, pageRoots, runBuild } from './publish/page.mjs';
import { backendOrigins, BACKEND_FILE } from './publish/scan.mjs';
import { hostedRefusal, isHostPath, mimeFor, pageHeaders } from './publish/hosting.mjs';
import { readServerConfig } from './server/contract.mjs';
import { CMD } from './command.mjs';
import { CLIENT_FILE, CLIENT_TAG } from './add.mjs';
import { ECONOMY_FILES } from './economy.mjs';
import { ownOrigins } from './publish/client.mjs';

const VIEWS = [
  { name: 'phone', width: 393, height: 660 },
  { name: 'desktop', width: 1280, height: 800 },
];
const SETTLE_MS = Number(process.env.GF_PAGE_SETTLE_MS ?? 5000);
/** Where the page is served on the check's own origin: under a folder, as xgames.fun Studio's preview and the kit's dev server serve it. */
export const MOUNT = '/game/';
/** Where the check's own server takes Chrome's policy-violation reports (outside MOUNT: never a file of the game). */
const REPORTS = '/__gf/csp-report';

const readJsonSync = file => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * The published files as static files under MOUNT, with the play host's headers (its page policy for these backend
 * origins, its permissions, nosniff, its types). → {url (the page's), origin, server (Node's), close}
 * `xcore dev` (./dev/index.mjs) adds: `route(req, res, url)`, tried first (→ true when it answered: the game's server,
 * the platform, the RPC); `html(text)`, applied to each .html file served; `port` (default: any free one).
 */
export function servePage(
  dir,
  { backend = [], server = false, route = null, html = null, port = 0, overlay = null } = {},
) {
  const root = resolve(dir);
  const over = overlay ? resolve(overlay) : null;
  // the play host's policy, plus a report address on this check's own server: Chrome reports every violation there,
  // a Web Worker's too, which no page event shows (a worker gets its policy from its own script's headers)
  const base = pageHeaders(backend);
  const headers = {
    ...base,
    'content-security-policy': `${base['content-security-policy']}; report-uri ${REPORTS}`,
    'cache-control': 'no-store',
  };
  const reports = [];
  const srv = createServer(async (req, res) => {
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
    const hidden = rel.split('/').some(x => x.startsWith('.')) || rel.startsWith('evidence/');
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
      ok({
        origin,
        url: `${origin}${MOUNT}`,
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
 * A Godot project's file changed after its Web export was made (the export's index.pck is older): the newest one, as a
 * path from the project, or null. Scenes, scripts, resources and the project's settings; never xcore's folders.
 */
export async function staleExport(game, out) {
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
  return newest?.rel ?? null;
}

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

/** One view of the page. → {errors, missing, rootPaths, refused: [{origin, kind, why}], reached: [origin], shows, shot} */
async function look(browser, site, view, out, { backend, server = false }) {
  const page = await browser.newPage({ viewport: { width: view.width, height: view.height } });
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
  const ownPages = new Set(), // the game's own pages, linked from the root (a multi-page build's links)
    hostAsked = new Set(),
    serverAsked = new Set(),
    icons = new Set(),
    unreachable = new Set();
  page.on('pageerror', e => errors.push(`thrown: ${String(e.message ?? e).slice(0, 300)}`));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/Content Security Policy|^Refused to /i.test(text)) return; // counted in check 4, from the page's own reports
    if (ENGINE_NOISE.some(re => re.test(text))) return;
    // Godot prints its warnings, and the source line under each message, as errors: a warning does not stop a game
    if (/^WARNING: /.test(text) || /^\s+at: \S+ \([^)]*:\d+\)$/.test(text)) return;
    // a device the play host turns off for every game: said once, in words, with what to do
    const device = /Permissions policy violation: ([\w-]+) is not allowed/.exec(text);
    if (device) {
      errors.push(
        `it asks for the ${device[1]}, which the play host turns off for every game: give the player another way`,
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
      if (o !== site.origin && /^(https?|wss?):/.test(r.url())) reached.add(o);
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
  await page
    .goto(site.url, { waitUntil: 'load', timeout: 30000 })
    .catch(e => errors.push(`did not load: ${e.message.split('\n')[0]}`));
  await page.waitForTimeout(SETTLE_MS);
  // something on screen: visible text, or a drawn canvas, or a visible picture
  const shows = await page
    .evaluate(() => {
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
      const canvas = [...document.querySelectorAll('canvas')].some(c => seen(c) && c.width > 0 && c.height > 0);
      const pic = [...document.querySelectorAll('img, svg, video')].some(seen);
      return text || canvas || pic;
    })
    .catch(() => false);
  // a router that reads the path moves the page out of its folder (history.replaceState to "/"): every relative URL
  // then resolves from the root, so what looks like "paths from the root" is that router
  let moved = null;
  try {
    const now = new URL(page.url()).pathname;
    if (!now.startsWith(MOUNT)) moved = now;
  } catch {}
  // the page's own events, and Chrome's reports to the check's server (a worker's violations arrive only there)
  await page.waitForTimeout(300);
  const reports = [
    ...(await page.evaluate(() => window.__gfRefused ?? []).catch(() => [])),
    ...(site.reports ?? []).splice(0),
  ];
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
  const shot = join(out, `${view.name}.png`);
  await page.screenshot({ path: shot }).catch(() => {});
  await page.close();
  return {
    errors,
    missing,
    rootPaths: [...new Set(rootPaths)],
    icons: [...icons],
    unreachable: [...unreachable],
    refused,
    reached: [...reached],
    hostAsked: [...hostAsked],
    ownPages: [...ownPages],
    moved,
    serverAsked: [...serverAsked],
    shows,
    shot,
  };
}

/** A brought game: gamesfun.json names its page (xcore adopt), and it is no game of the kit's (no gf-three.json). */
export const isBroughtGame = dir =>
  !!readJsonSync(join(dir, 'gamesfun.json'))?.page && !existsSync(join(dir, 'gf-three.json'));

/**
 * Check `dir` as a page. start: the kit's hook for a copy of one of its starts that is a page of its own: { id,
 * kept(game) → [{n, name, ok, detail}] (checks 1 and 2), notes(game) → [line] }. launch: another browser launcher
 * (the kit's). port: where the page is served (default: any free one). → the record ({kind, pass, checks, notes, outDir,
 * …})
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
  // in a Godot project, Godot imports every file under it into the game's own package: evidence/ is the check's, not
  // the game's (a .gdignore keeps Godot out of it)
  if (!out && existsSync(join(game, 'project.godot')) && !existsSync(join(game, 'evidence', '.gdignore')))
    await writeFile(join(game, 'evidence', '.gdignore'), '').catch(() => {});
  const checks = [],
    notes = [];
  const check = (n, name, ok, detail) => {
    checks.push({ n, name, gate: n <= 2 ? 'A' : 'B', ok, detail });
    log(`${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'} ${n} ${name}: ${detail}`);
  };
  const roots = pageRoots(game);
  let built = true;

  if (brought) {
    if (!roots.build)
      check(
        1,
        'it builds',
        null,
        existsSync(join(game, 'project.godot')) || existsSync(join(game, 'ProjectSettings', 'ProjectVersion.txt'))
          ? `no build here: the engine's web export in ${roots.out === game ? '.' : relative(game, roots.out)} is checked as it was last exported (export again after a change)${await staleExport(game, roots.out).then(f => (f ? `; ${f} changed after it was exported` : ''))}`
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
      const { preflight } = await import('./publish/index.mjs');
      const { scanPage } = await import('./publish/adopt.mjs');
      const pre = await preflight(game);
      const scan = existsSync(roots.out)
        ? await scanPage(roots.out, {
            backend: pre.backend,
            prefix: relative(game, roots.out).split(sep).join('/') || '.',
            hasServer,
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
          : `${pre.built.tree.files.length} files${pre.built.added?.length ? ` (with the ${pre.built.added.length} records xgames.fun keeps)` : ''}, ${(pre.built.bytes / 1048576).toFixed(1)} MB, nothing publish would refuse (${CMD} adopt lists what is worth a look)`,
      );
    } else check(2, 'it fits the hosting', null, 'not read: the build failed');
  } else for (const c of await base.kept(game)) check(c.n, c.name, c.ok, c.detail);

  if (!built || !existsSync(join(roots.out, 'index.html'))) {
    const why = !built
      ? 'not run: the build failed'
      : `no index.html in ${relative(game, roots.out).split(sep).join('/') || 'the game'}${roots.build ? ' (build it first, or check it without --no-build)' : ''}`;
    check(3, 'the page starts', built ? false : null, why);
    check(4, 'it stays inside its origins', null, 'not run: the page did not start');
  } else {
    const backend = backendOrigins(readJsonSync(pageFile(roots, BACKEND_FILE)), { own: ownOrigins() }).origins;
    const site = await servePage(roots.out, { backend, server: hasServer, overlay: roots.overlay, port });
    let browser = null;
    try {
      browser = await (launch ?? launchBrowser)();
      const views = [];
      for (const v of VIEWS)
        views.push({ ...v, ...(await look(browser, site, v, outDir, { backend, server: hasServer })) });
      const bad = views.flatMap(v => [
        ...v.errors.map(e => `${v.name}: ${e}`),
        ...v.missing.map(m =>
          /^api\//.test(m) && !hasServer
            ? `${v.name}: missing ${m}: the page expects a server at api/, and xgames.fun answers api/ only from the game's own server/ (docs/SERVER.md); otherwise call a backend of your own (${CMD} backend use custom)`
            : /^(undefined|null|NaN) \(/.test(m)
              ? `${v.name}: missing ${m}: the page asked for a file named ${m.split(' ')[0]}, a path from a variable that was not set (a field missing from its data, or a load that failed before it)`
              : `${v.name}: missing ${m}`,
        ),
        // the router moved the page to the root: its relative URLs then look like paths from the root; say the cause
        ...(v.moved
          ? [
              `${v.name}: the page moved itself out of its folder, to ${v.moved} (a router that reads the path does that): use a hash router (Vue createWebHashHistory(), Nuxt router.options.hashMode, React Router createHashRouter, Angular withHashLocation())`,
            ]
          : [
              ...v.rootPaths.map(
                p =>
                  `${v.name}: ${p} asked for from the root (the game is served under a folder in Studio's preview and in the kit's dev server: use a relative path)`,
              ),
              ...(v.ownPages.length
                ? [
                    `${v.name}: the game's own pages are linked from the root (${v.ownPages.slice(0, 3).join(', ')}), as Next.js <Link> and other multi-page builds write them: they work at the published link, not under a folder (Studio's preview, the kit's dev server); see the README, "A game of several pages"`,
                  ]
                : []),
            ]),
        ...(v.shows ? [] : [`${v.name}: nothing on screen after ${SETTLE_MS / 1000} s`]),
      ]);
      check(
        3,
        'the page starts',
        bad.length === 0,
        bad.length
          ? [...new Set(bad)].slice(0, 8).join('; ')
          : `no errors, nothing missing, something on screen at ${views.map(v => `${v.width}x${v.height}`).join(' and ')} under the play host's page policy (screenshots in ${views.map(v => `${v.name}.png`).join(', ')})`,
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
          `Its tab icon is asked for from the root (${icons.join(', ')}): it shows at the game's own link, not in Studio's preview or the kit's dev server. A relative path shows it everywhere.`,
        );
      const serverAsked = [...new Set(views.flatMap(v => v.serverAsked))];
      if (serverAsked.length)
        notes.push(
          `It calls its own server (${serverAsked.join(', ')}): server/ answers there once published (and in the kit's dev server, which runs it), not in this check.`,
        );
      if (asked.length)
        notes.push(
          `It calls the play host's own paths (${asked.join(', ')}): they answer once published (and in the kit's dev server), not in this check.`,
        );
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
    } catch (e) {
      check(3, 'the page starts', false, `Chrome could not run the page: ${e.message.split('\n')[0]}`);
      check(4, 'it stays inside its origins', null, 'not run: Chrome could not run the page');
    } finally {
      await browser?.close().catch(() => {});
      await site.close();
    }
  }

  const { staleClient } = await import('./add.mjs');
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
    outDir,
  };
  await writeFile(join(outDir, 'record.json'), JSON.stringify(record, null, 2) + '\n');
  return record;
}
