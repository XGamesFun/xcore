// A brought game: a web game made without this kit, adopted to be checked, served and published by it
// (`xcore adopt`, lib/publish/adopt.mjs; README.md). Its record is the `page` part of the game's
// gamesfun.json (never published; its `server` part is the game's own server, docs/SERVER.md):
//
//   { "page": { "build": "npm run build", "out": "dist", "static": "public", "title": "My Game" } }
//
//   build    the command that makes the published files, run in the game's folder; omitted for a folder of plain
//            static files
//   out      the folder that is published (relative, inside the game's folder): "." for plain files, else the build's
//            output; index.html at its root is the game's entry
//   static   the folder the build copies into `out` as it is (Vite, Next.js, Astro: public/), where the kit puts the
//            files it adds (backend.json, xsolana.json, gf/loot/); "." for plain files; omitted when the build has none
//   title    optional: the game's name on games.fun (else index.html's <title>, else package.json's name)
//
// Only these four keys; every path is relative, with forward slashes, and stays inside the game's folder.
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const CONFIG_FILE = 'gamesfun.json';
export const PAGE_KEY = 'page';
const KEYS = ['build', 'out', 'static', 'title'];

const readJsonSync = file => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** A relative folder inside the game ("." or "dist" or "web/out"), normalised; throws with words when it is not one. */
export function relFolder(value, what) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(
      `gamesfun.json page.${what} is a folder inside the game, like "dist" (or "." for the game's own folder)`,
    );
  const v =
    value
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\.\/+/, '')
      .replace(/\/+$/, '') || '.';
  if (path.posix.isAbsolute(v) || /^[a-z]:/i.test(v) || v.split('/').some(p => p === '..'))
    throw new Error(`gamesfun.json page.${what} ${JSON.stringify(value)} must stay inside the game's folder`);
  return path.posix.normalize(v);
}

/** Check a `page` record. → the cleaned record; throws with every problem in words. */
export function checkPage(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p))
    throw new Error('gamesfun.json "page" is an object: {"out": "dist", "build": "npm run build"}');
  const problems = [],
    out = {};
  const extra = Object.keys(p).filter(k => !KEYS.includes(k));
  if (extra.length) problems.push(`unknown keys ${extra.join(', ')} (page has ${KEYS.join(', ')})`);
  if (p.build != null) {
    if (typeof p.build !== 'string' || !p.build.trim() || p.build.length > 500)
      problems.push('page.build is the build command, like "npm run build"');
    else out.build = p.build.trim();
  }
  try {
    out.out = relFolder(p.out ?? '.', 'out');
  } catch (e) {
    problems.push(e.message);
  }
  if (p.static != null) {
    try {
      out.static = relFolder(p.static, 'static');
    } catch (e) {
      problems.push(e.message);
    }
  } else if (!out.build) out.static = out.out;
  // with no build, a static folder of its own is laid over the published one (an engine's export keeps what xcore adds
  // out of the folder the engine writes): never the game's own folder, and neither inside the other
  if (!out.build && out.static && out.out && out.static !== out.out) {
    const inside = (a, b) => b === '.' || a.startsWith(`${b}/`);
    if (inside(out.out, out.static) || inside(out.static, out.out))
      problems.push(
        `page.static (${out.static}) and page.out (${out.out}) are folders apart when there is no build: xcore lays static's files over the published folder`,
      );
  }
  if (p.title != null) {
    if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 80)
      problems.push("page.title is the game's name, 1–80 characters");
    else out.title = p.title.trim();
  }
  if (problems.length) throw new Error(`gamesfun.json: ${problems.join('; ')}`);
  return out;
}

/** The folder's page record (gamesfun.json → page), checked, or null when it is not a brought game. Throws on a bad record. */
export function readPage(dir) {
  const cfg = readJsonSync(path.join(dir, CONFIG_FILE));
  if (!cfg || typeof cfg !== 'object' || cfg[PAGE_KEY] === undefined) return null;
  return checkPage(cfg[PAGE_KEY]);
}

/** Is this folder a brought game (a gamesfun.json with a page record)? */
export const isBrought = dir => readJsonSync(path.join(dir, CONFIG_FILE))?.[PAGE_KEY] !== undefined;

/**
 * Where a game's files are. → {dir, brought, build (a command or null), out (absolute: the folder that is published and
 * served), static (absolute, or null: where the kit puts the files it adds), overlay (absolute, or null: with no build,
 * a static folder apart from out, whose files are laid over it when it is published, checked or served), title}. A kit game or a copy of a start is
 * its own folder for all of them. Throws, in words, when its page record is not valid.
 */
export function pageRoots(dir) {
  const root = path.resolve(dir);
  const page = readPage(root);
  if (!page) return { dir: root, brought: false, build: null, out: root, static: root, overlay: null, title: null };
  const abs = rel => path.join(root, ...rel.split('/').filter(x => x !== '.'));
  return {
    dir: root,
    brought: true,
    build: page.build ?? null,
    out: abs(page.out),
    static: page.static ? abs(page.static) : null,
    overlay: !page.build && page.static && page.static !== page.out ? abs(page.static) : null,
    title: page.title ?? null,
  };
}

/** A file as it is published: the overlay's copy when it has one, else the published folder's. → its path */
export const pageFile = (roots, name) =>
  roots.overlay && existsSync(path.join(roots.overlay, name))
    ? path.join(roots.overlay, name)
    : path.join(roots.out, name);

/** Write the page record into gamesfun.json, keeping everything else in it (its `server` part). → the record written */
export async function writePage(dir, page) {
  const file = path.join(dir, CONFIG_FILE);
  let cfg = {};
  if (existsSync(file)) {
    try {
      cfg = JSON.parse(await readFile(file, 'utf8'));
    } catch (e) {
      throw new Error(`${CONFIG_FILE} is not valid JSON (${e.message}); fix it first`, { cause: e });
    }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error(`${CONFIG_FILE} must be an object`);
  }
  const clean = checkPage(page);
  // a plain folder's static is its out: written once, as out
  const written = {
    ...(clean.build ? { build: clean.build } : {}),
    out: clean.out,
    ...(clean.static && (clean.build || clean.static !== clean.out) ? { static: clean.static } : {}),
    ...(clean.title ? { title: clean.title } : {}),
  };
  await writeFile(file, JSON.stringify({ ...cfg, [PAGE_KEY]: written }, null, 2) + '\n');
  return written;
}

/** The game's name: page.title, else the published index.html's <title>, else package.json's name, else the folder's. */
export function pageTitle(dir) {
  const r = pageRoots(dir);
  if (r.title) return r.title;
  try {
    const t = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(readFileSync(path.join(r.out, 'index.html'), 'utf8'))?.[1];
    if (t?.trim())
      return t
        .trim()
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .slice(0, 80);
  } catch {}
  const pkg = readJsonSync(path.join(r.dir, 'package.json'));
  return typeof pkg?.name === 'string' && pkg.name ? pkg.name.replace(/^@[^/]+\//, '') : path.basename(r.dir);
}

// A line of build output that says what went wrong: not a stack frame, a code frame, or the package manager's own
// "the script failed" lines, which say only that it did.
const ERROR_LINE =
  /\b(error|failed|cannot|can't|could not|couldn't|not found|unresolved|unexpected|missing|undefined)\b/i;
const NOT_THE_ERROR = [
  /^\s*at\s/, // a stack frame
  /^\s*[│╭╰─|>]\s|^\s*\d+\s*[│|]/, // a code frame
  /^\s*(npm (error|ERR!)|error Command failed|ELIFECYCLE|ERR_PNPM_|\s*Exit code|error: script ".*" exited)/i,
  /^\W*(error\W*)?(✗\s*)?build failed( in [\d.]+m?s| with \d+ errors?)?\W*$/i, // "Build failed" and nothing else
  /^error during build:?$/i, // Vite's heading for the error on the next line
];
// eslint-disable-next-line no-control-regex
const plain = line => line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();

/** Why a build failed, in a line: its first lines that say what went wrong, else its last lines. → string */
export function buildFailure(b) {
  const lines = b.errors?.length ? b.errors : (b.tail ?? []).map(plain).filter(l => l && !/^\s*at\s/.test(l));
  const picked = b.errors?.length ? lines.slice(0, 3) : lines.slice(-3);
  return picked.map(l => (l.length > 300 ? `${l.slice(0, 300)}…` : l)).join(' | ');
}

/**
 * Run the game's build command (`build`, else its record's) in its folder, as a shell command (as `npm run` runs one).
 * → {ran, code, seconds, tail, errors} (`tail`: the last lines of its output; `errors`: its first lines that say what
 * went wrong, for buildFailure). `onLine` gets each line. No build: {ran: false}.
 */
export function runBuild(dir, { build, onLine = () => {}, env = process.env, timeoutMs = 10 * 60_000 } = {}) {
  const r = { dir: path.resolve(dir), build: build === undefined ? pageRoots(dir).build : build };
  if (!r.build) return Promise.resolve({ ran: false, code: 0, seconds: 0, tail: [], errors: [] });
  const started = Date.now(),
    tail = [],
    errors = [];
  const keep = l => {
    const p = plain(l);
    if (errors.length < 8 && ERROR_LINE.test(p) && !NOT_THE_ERROR.some(re => re.test(p)) && !errors.includes(p))
      errors.push(p);
  };
  return new Promise(resolve => {
    const child = spawn(r.build, {
      cwd: r.dir,
      shell: true,
      env: { ...env, CI: env.CI ?? '1', NO_COLOR: env.NO_COLOR ?? '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    let buf = '';
    const take = d => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) {
        tail.push(l);
        if (tail.length > 30) tail.shift();
        keep(l);
        onLine(l);
      }
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', e => {
      clearTimeout(timer);
      resolve({
        ran: true,
        code: 127,
        seconds: (Date.now() - started) / 1000,
        tail: [...tail, e.message],
        errors: [e.message],
      });
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (buf) {
        tail.push(buf);
        keep(buf);
        onLine(buf);
      }
      resolve({ ran: true, code: code ?? 1, seconds: Math.round((Date.now() - started) / 100) / 10, tail, errors });
    });
  });
}

/** Is `cmd` on this machine's PATH? (npm, pnpm, yarn, bun) */
export const hasCommand = cmd =>
  new Promise(resolve => execFile(process.platform === 'win32' ? 'where' : 'which', [cmd], err => resolve(!err)));
