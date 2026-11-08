// `xcore adopt <folder>`: bring a web game made anywhere (this package's README). It reads the folder's
// shape (plain static files, or a project whose build makes them: Vite, Next.js static export, Astro, SvelteKit's static
// adapter, Nuxt generate, Create React App, Parcel, Gatsby, or any `build` script), builds it, writes its record
// (gamesfun.json → page: lib/publish/page.mjs) and reports everything that does not fit games.fun's hosting
// (lib/publish/hosting.mjs), each with its fix:
//
//   refused   it cannot be hosted as it is: no static index.html (server-side rendering, a Node server as the
//             frontend), a build that fails; no record is written
//   fix       it would break or be refused once published: publish's own refusals (secrets, .env files, links,
//             backend.json), files over the limits, paths from the root, scripts, styles, fonts or frames from
//             other sites, files under the host's own paths
//   warn      worth a look: addresses the code names that backend.json does not, a service worker, the camera or
//             location, files served without a type, hidden files that do not go up
//
// The check after it is `xcore check` (../check.mjs: the page in Chrome, with the host's page policy).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { backendOrigins, BACKEND_FILE } from './scan.mjs';
import { DEFAULT_LIMITS, servedTyped, UNTYPED_CODE } from './hosting.mjs';
import { ownOrigins } from './client.mjs';
import { CONFIG_FILE, buildFailure, checkPage, pageFile, pageRoots, readPage, runBuild, writePage } from './page.mjs';
import { preflight } from './index.mjs';
import { CMD } from '../command.mjs';

const readJsonSync = file => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const readText = file => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};
const firstFile = (dir, names) => names.map(n => path.join(dir, n)).find(f => existsSync(f)) ?? null;
const configText = (dir, base) =>
  readText(
    firstFile(
      dir,
      ['js', 'mjs', 'cjs', 'ts', 'mts'].map(e => `${base}.${e}`),
    ) ?? '',
  );
const mb = n => `${(n / 1048576).toFixed(1)} MB`;

/** The package manager the project uses: its lock file, else package.json's "packageManager" (Corepack's
 *  "pnpm@9.1.0"), else a pnpm-workspace.yaml. → 'npm' | 'pnpm' | 'yarn' | 'bun' */
export function packageManager(dir) {
  if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(dir, 'bun.lockb')) || existsSync(path.join(dir, 'bun.lock'))) return 'bun';
  const declared = /^(npm|pnpm|yarn|bun)@/.exec(readJsonSync(path.join(dir, 'package.json'))?.packageManager ?? '');
  if (declared) return declared[1];
  if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return 'pnpm';
  return 'npm';
}
/**
 * Are the project's packages installed where Node finds them: a node_modules in its folder or any folder above it (npm
 * and Yarn workspaces install at the repo's root), or Yarn Plug'n'Play's .pnp.cjs there?
 */
export function packagesInstalled(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (existsSync(path.join(d, 'node_modules')) || existsSync(path.join(d, '.pnp.cjs'))) return true;
    if (path.dirname(d) === d) return false;
  }
}
/** The command that installs the project's packages: `npm ci` when it has a lock file, so the build gets those exact versions. */
const installCommand = dir => {
  const pm = packageManager(dir);
  if (pm === 'npm') return existsSync(path.join(dir, 'package-lock.json')) ? 'npm ci' : 'npm install';
  return `${pm} install`;
};
const runScript = (pm, s) => (pm === 'yarn' ? `yarn ${s}` : `${pm} run ${s}`);

/**
 * What the folder is, from its files alone (nothing is run). → {kind: 'static' | 'build' | 'server' | 'none', framework,
 * build, out, static, base (a Vite base, when set), why} — `server`: its frontend is rendered by a server (refused);
 * `none`: no index.html and no build. `out` is a guess for an unknown build (checked after it runs).
 */
export function detectShape(dir) {
  const engine = engineProject(dir);
  if (engine) return engine;
  const pkg = readJsonSync(path.join(dir, 'package.json'));
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const has = name => Object.hasOwn(deps, name);
  const scripts = pkg?.scripts ?? {};
  const pm = packageManager(dir);
  const build = typeof scripts.build === 'string' ? runScript(pm, 'build') : null;
  const server = (framework, why, fix) => ({ kind: 'server', framework, build, out: null, static: null, why, fix });
  const made = (framework, out, stat, extra = {}) => ({
    kind: 'build',
    framework,
    build: extra.build ?? build,
    out,
    static: stat,
    why: null,
    ...extra,
  });

  if (pkg) {
    if (has('next')) {
      const cfg = configText(dir, 'next.config');
      const exported = /output\s*:\s*['"`]export['"`]/.test(cfg) || /\bnext export\b/.test(String(scripts.build ?? ''));
      if (!exported)
        return server(
          'Next.js',
          'a Next.js app runs on its own Node server unless it is a static export',
          "Make it a static export: output: 'export' in next.config (pages that need the server go: their data comes from a backend or from server/ instead), then adopt again",
        );
      const dist = /distDir\s*:\s*['"`]([^'"`]+)['"`]/.exec(cfg)?.[1];
      return made(
        'Next.js (static export)',
        dist && /\bnext export\b/.test(String(scripts.build ?? '')) ? dist : 'out',
        'public',
      );
    }
    if (has('@remix-run/dev') || has('@remix-run/node') || has('@react-router/dev')) {
      const spa = /ssr\s*:\s*false/.test(configText(dir, 'vite.config') + configText(dir, 'react-router.config'));
      if (!spa)
        return server(
          'Remix / React Router',
          'a Remix or React Router framework app renders on its server',
          'Turn on its SPA mode (ssr: false), which builds static files, then adopt again',
        );
      return made('React Router (SPA mode)', 'build/client', 'public');
    }
    if (has('@sveltejs/kit')) {
      // SvelteKit 3 takes its configuration in vite.config (sveltekit({ adapter })); 2 in svelte.config
      const cfg = configText(dir, 'svelte.config') + configText(dir, 'vite.config');
      if (!/adapter-static/.test(cfg))
        return server(
          'SvelteKit',
          'SvelteKit renders on a server unless it builds with @sveltejs/adapter-static',
          'Build with @sveltejs/adapter-static (and prerender = true), then adopt again',
        );
      return made('SvelteKit (static adapter)', /pages\s*:\s*['"`]([^'"`]+)['"`]/.exec(cfg)?.[1] ?? 'build', 'static');
    }
    if (has('nuxt')) {
      if (typeof scripts.generate === 'string' && !/\bnuxt generate\b/.test(String(scripts.build ?? '')))
        return made('Nuxt (generate)', '.output/public', 'public', { build: runScript(pm, 'generate') });
      if (/\bnuxt generate\b/.test(String(scripts.build ?? '')))
        return made('Nuxt (generate)', '.output/public', 'public');
      return server(
        'Nuxt',
        '`nuxt build` makes a Node server',
        'Build it with `nuxt generate` (a static site), then adopt again',
      );
    }
    if (has('astro')) {
      const cfg = configText(dir, 'astro.config');
      if (/output\s*:\s*['"`](server|hybrid)['"`]/.test(cfg))
        return server(
          'Astro',
          "an Astro site with output: 'server' renders on a server",
          "Use output: 'static' (the default), then adopt again",
        );
      return made('Astro', /outDir\s*:\s*['"`]([^'"`]+)['"`]/.exec(cfg)?.[1]?.replace(/^\.\//, '') ?? 'dist', 'public');
    }
    if (has('gatsby')) return made('Gatsby', 'public', 'static');
    if (has('react-scripts')) return made('Create React App', 'build', 'public');
    if (has('@angular/core') && existsSync(path.join(dir, 'angular.json'))) {
      const ng = readJsonSync(path.join(dir, 'angular.json'));
      const [name, project] = Object.entries(ng?.projects ?? {})[0] ?? [];
      const target = project?.architect?.build ?? project?.targets?.build;
      const opt = target?.options?.outputPath;
      const base = (typeof opt === 'string' ? opt : opt?.base) ?? (name ? `dist/${name}` : null);
      // the application builder (Angular 17+) writes the page into <outputPath>/browser; the older browser builder, into outputPath
      const browser = /:application$/.test(String(target?.builder ?? '')) ? (opt?.browser ?? 'browser') : '';
      const out = base ? [base.replace(/^\.\//, '').replace(/\/+$/, ''), browser].filter(Boolean).join('/') : null;
      return made('Angular', out, existsSync(path.join(dir, 'public')) ? 'public' : null);
    }
    if (has('vite') || has('rolldown-vite')) {
      const cfg = configText(dir, 'vite.config');
      const out = /outDir\s*:\s*['"`]([^'"`]+)['"`]/.exec(cfg)?.[1]?.replace(/^\.\//, '') ?? 'dist';
      const pub = /publicDir\s*:\s*['"`]([^'"`]+)['"`]/.exec(cfg)?.[1]?.replace(/^\.\//, '') ?? 'public';
      const base = /\bbase\s*:\s*['"`]([^'"`]*)['"`]/.exec(cfg)?.[1] ?? null;
      return made('Vite', out, pub, { base });
    }
    if (has('parcel') || has('parcel-bundler'))
      return made('Parcel', /--dist-dir[ =]([^\s]+)/.exec(String(scripts.build ?? ''))?.[1] ?? 'dist', null);
    if (build)
      return made(
        has('webpack') ? 'webpack' : has('esbuild') ? 'esbuild' : has('rollup') ? 'Rollup' : 'a build script',
        null,
        null,
      );
    const serverDeps = ['express', 'fastify', 'koa', 'hono', '@hapi/hapi', 'socket.io', 'ws'].filter(has);
    const nodeServer = serverDeps.length || typeof scripts.start === 'string';
    // a server that only hands out a folder of static files: that folder is the page, the server stays a backend
    const pageDir = ['public', 'static', 'www', 'client', 'web', 'dist', 'build'].find(sub =>
      existsSync(path.join(dir, sub, 'index.html')),
    );
    if (!existsSync(path.join(dir, 'index.html')) && nodeServer && pageDir)
      return {
        kind: 'static',
        framework: null,
        build: null,
        out: pageDir,
        static: pageDir,
        why: null,
        server: {
          framework: serverDeps.length ? serverDeps.join(', ') : 'a Node program',
          start: typeof scripts.start === 'string' ? scripts.start : null,
        },
      };
    if (!existsSync(path.join(dir, 'index.html')) && nodeServer)
      return server(
        serverDeps.length ? `a Node server (${serverDeps.join(', ')})` : 'a Node program',
        `its frontend is served by ${typeof scripts.start === 'string' ? `\`${scripts.start}\`` : 'a Node server'}, with no static index.html`,
        'Make the page static files (index.html and what it loads) the browser runs on its own; move what must run on a server to server/ (a Worker on /api/*, docs/SERVER.md) or a backend of your own (backend.json origins)',
      );
  }
  if (existsSync(path.join(dir, 'index.html')))
    return { kind: 'static', framework: null, build: null, out: '.', static: '.', why: null };
  for (const sub of ['dist', 'build', 'public', 'www', 'web', 'out', 'docs', 'site'])
    if (existsSync(path.join(dir, sub, 'index.html')))
      return { kind: 'static', framework: null, build: null, out: sub, static: sub, why: null };
  return {
    kind: 'none',
    framework: null,
    build: null,
    out: null,
    static: null,
    why: 'no index.html in the folder (nor in dist/, build/, public/ …) and no build script',
    fix: 'A hosted game is static files with index.html at the root of what is published: point adopt at that folder (--out <dir>), or give the command that makes it (--build "<cmd>" --out <dir>)',
  };
}

/** A web export: an index.html beside a Unity build's loader, or a Godot export's .pck. */
const isWebExport = d =>
  existsSync(path.join(d, 'index.html')) &&
  (existsSync(path.join(d, 'index.pck')) ||
    readdirSafe(d).some(n => n.endsWith('.pck')) ||
    readdirSafe(path.join(d, 'Build')).some(n => /\.loader\.js$/.test(n)) ||
    existsSync(path.join(d, 'Build', 'UnityLoader.js')));
function readdirSafe(d) {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
}

/** A Unity or Godot project (its sources): games.fun hosts its web export, so that folder is the page. → a shape, or
 *  null when the folder is no engine's project */
function engineProject(dir) {
  const unity =
    existsSync(path.join(dir, 'ProjectSettings', 'ProjectVersion.txt')) && existsSync(path.join(dir, 'Assets'));
  const godot = existsSync(path.join(dir, 'project.godot'));
  if (!unity && !godot) return null;
  const tried = [];
  if (godot) {
    // the Web preset's export path (export_presets.cfg), then the usual places
    const presets = (() => {
      try {
        return readFileSync(path.join(dir, 'export_presets.cfg'), 'utf8');
      } catch {
        return '';
      }
    })();
    for (const block of presets.split(/^\[preset\.\d+\]$/m))
      if (/^platform="Web"$/m.test(block)) {
        const p = /^export_path="([^"]*)"$/m.exec(block)?.[1];
        if (p) tried.push(path.posix.dirname(p.replace(/^res:\/\//, '')));
      }
  }
  tried.push(
    ...(unity
      ? ['Builds/WebGL', 'Build/WebGL', 'WebGL', 'Builds/Web', 'Builds', 'Build', 'docs']
      : ['build/web', 'export/web', 'exports/web', 'build', 'export', 'web', 'docs']),
  );
  const out = [...new Set(tried)].find(sub => sub && sub !== '.' && isWebExport(path.join(dir, sub)));
  const name = unity ? 'Unity' : 'Godot';
  if (out) return { kind: 'static', framework: null, build: null, out, static: out, why: null, engine: name };
  return {
    kind: 'none',
    framework: null,
    build: null,
    out: null,
    static: null,
    engine: name,
    why: `a ${name} project with no web export in it: games.fun hosts the export (index.html and what it loads), not the project`,
    fix: unity
      ? 'In Unity: File → Build Settings → WebGL, Player Settings → Publishing Settings: Compression Format Disabled (or Decompression Fallback on), then Build into a folder such as Builds/WebGL, and adopt again (or point adopt at it: --out Builds/WebGL)'
      : 'In Godot: Project → Export → Add… → Web, Thread Support off, export to build/web/index.html, and adopt again (or point adopt at it: --out build/web)',
  };
}

/** What to do with a Godot project's Web preset, in words. */
function godotExportFix(preset) {
  const exportIt = `Export it: godot --headless --path . --export-release "${preset.name}" ${preset.path} (or Project → Export → ${preset.name} in the editor), then ${CMD} adopt again`;
  return preset.wrote
    ? `xcore wrote a Web export preset in export_presets.cfg (Thread Support off, to build/web/index.html, leaving xcore's folders out of the game's package; build/ has a .gdignore). ${exportIt}`
    : `Its Web export preset is there, with nothing exported yet. ${exportIt}${preset.threads ? '. It has Thread Support on: turn it off first (a games.fun page is not cross-origin isolated)' : ''}`;
}

/** What a Godot project's Web preset leaves out of the game's package: xcore's and the tools' folders. */
export const GODOT_EXCLUDE = 'build/*, evidence/*, gamesfun/*, server/*, node_modules/*, .work/*';

/**
 * A Web export preset for games.fun in a Godot project that has none (export_presets.cfg made or added to): Thread
 * Support off (a games.fun page is not cross-origin isolated), exported to build/web/index.html, with xcore's folders
 * left out of the package, and a .gdignore in build/ so the editor never imports the export's own files.
 * → {wrote, name, path (its export path from the project), threads}; with a Web preset already, that one, unchanged
 */
export async function godotWebPreset(dir) {
  const file = path.join(dir, 'export_presets.cfg');
  const had = existsSync(file) ? await readFile(file, 'utf8') : '';
  const web = had.split(/^(?=\[preset\.\d+\]\s*$)/m).find(b => /^platform="Web"\s*$/m.test(b));
  if (web) {
    const p = (/^export_path="([^"]*)"$/m.exec(web)?.[1] ?? '').replace(/^res:\/\//, '');
    if (p) await mkdir(path.join(dir, path.dirname(p)), { recursive: true });
    const name = /^name="([^"]*)"$/m.exec(web)?.[1] ?? 'Web';
    const threads = had.includes(`[${/^\[(preset\.\d+)\]/.exec(web)?.[1]}.options]`)
      ? /variant\/thread_support=true/.test(
          had.split(`[${/^\[(preset\.\d+)\]/.exec(web)[1]}.options]`)[1].split(/^\[/m)[0],
        )
      : false;
    return { wrote: false, name, path: p || 'build/web/index.html', threads };
  }
  const n = Math.max(-1, ...[...had.matchAll(/^\[preset\.(\d+)\]\s*$/gm)].map(m => Number(m[1]))) + 1;
  const preset = `[preset.${n}]

name="Web"
platform="Web"
runnable=true
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter="${GODOT_EXCLUDE}"
export_path="build/web/index.html"
encryption_include_filters=""
encryption_exclude_filters=""
encrypt_pck=false
encrypt_directory=false

[preset.${n}.options]

custom_template/debug=""
custom_template/release=""
variant/extensions_support=false
variant/thread_support=false
vram_texture_compression/for_desktop=true
vram_texture_compression/for_mobile=false
html/export_icon=true
html/custom_html_shell=""
html/head_include=""
html/canvas_resize_policy=2
html/focus_canvas_on_start=true
html/experimental_virtual_keyboard=false
progressive_web_app/enabled=false
`;
  await writeFile(file, had ? `${had.replace(/\s*$/, '')}\n\n${preset}` : preset);
  await mkdir(path.join(dir, 'build', 'web'), { recursive: true });
  if (!existsSync(path.join(dir, 'build', '.gdignore'))) await writeFile(path.join(dir, 'build', '.gdignore'), '');
  return { wrote: true, name: 'Web', path: 'build/web/index.html', threads: false };
}

/** The first folder of these with an index.html, after an unknown build ran: at the top, or a level or two down
 *  (dist/<project>/, dist/<project>/browser/, as Angular and other multi-project builds write), else in a monorepo's
 *  workspace (packages/game/dist/). → a posix path or null */
function guessOut(dir, since) {
  const tops = ['dist', 'build', 'out', 'public', 'www', '_site', 'site'];
  const top = tops.find(sub => existsSync(path.join(dir, sub, 'index.html')));
  if (top) return top;
  for (const sub of tops) {
    let children;
    try {
      children = readdirSync(path.join(dir, sub), { withFileTypes: true }).filter(e => e.isDirectory());
    } catch {
      continue;
    }
    for (const c of children)
      for (const rel of [`${sub}/${c.name}`, `${sub}/${c.name}/browser`])
        if (existsSync(path.join(dir, ...rel.split('/'), 'index.html'))) return rel;
  }
  return workspaceOut(dir, since);
}

/** The folders a monorepo's workspaces live in (package.json "workspaces", pnpm-workspace.yaml "packages"), with a
 *  trailing /* or /** read as "each folder in it". → posix paths */
function workspaceDirs(dir) {
  let globs = [];
  try {
    const ws = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).workspaces;
    globs = Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : [];
  } catch {}
  try {
    const yaml = readFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'utf8');
    const block = /^packages:\s*\n((?:[ \t]+-.*\n?)+)/m.exec(yaml);
    if (block) for (const m of block[1].matchAll(/-\s*["']?([^"'\n#]+?)["']?\s*(?:#.*)?$/gm)) globs.push(m[1]);
  } catch {}
  const dirs = [];
  for (const g of globs.filter(g => typeof g === 'string' && !g.startsWith('!'))) {
    const parent = g.replace(/\/\*\*?$/, '');
    if (parent === g) {
      dirs.push(g.replace(/\/$/, ''));
      continue;
    }
    if (/[*?{[]/.test(parent)) continue;
    try {
      for (const e of readdirSync(path.join(dir, parent), { withFileTypes: true }))
        if (e.isDirectory() && e.name !== 'node_modules') dirs.push(`${parent}/${e.name}`);
    } catch {}
  }
  return dirs;
}

/** A monorepo whose build runs one workspace's build: that workspace's output folder (dist/, build/ …). With
 *  several, the one written by this build (index.html changed since `since`), else the newest. → posix path or null */
function workspaceOut(dir, since) {
  const found = [];
  for (const ws of workspaceDirs(dir))
    for (const sub of ['dist', 'build', 'out', 'public', 'www', '_site']) {
      const index = path.join(dir, ...ws.split('/'), sub, 'index.html');
      try {
        found.push({ rel: `${ws}/${sub}`, at: statSync(index).mtimeMs });
        break;
      } catch {}
    }
  const fresh = since ? found.filter(f => f.at >= since - 2000) : found;
  const pick = (fresh.length ? fresh : found).sort((a, b) => b.at - a.at)[0];
  return pick?.rel ?? null;
}

/**
 * A router that reads the path, in the project's own source (not node_modules, not the built output): Vue Router's
 * createWebHistory, React Router's browser router or framework mode, Nuxt pages without hashMode, Angular's router
 * without hash location. → {where, how, fix?} or null (`fix`: when the usual one, a hash router, is not there)
 */
function pathRouter(root, out) {
  // React Router's framework mode routes by path, with no hash mode, and renders the page for / when it builds
  if (configText(root, 'react-router.config'))
    return {
      where: 'react-router.config',
      how: "React Router's framework mode",
      fix: `Its framework mode has no hash routing, and under a folder React stops with error #418 (the page it built for / does not match), so ${CMD} check fails it and publish saves a private draft; at the game's own link it works. For a game that runs everywhere, use React Router as a library in a Vite app, with createHashRouter, or one page that changes screens itself`,
    };
  // Nuxt routes its pages/ folder by path unless its config turns on hash mode
  const nuxt = configText(root, 'nuxt.config');
  if (
    nuxt &&
    ['pages', 'app/pages', 'src/pages'].some(d => existsSync(path.join(root, d))) &&
    !/\bhashMode\s*:\s*true\b/.test(nuxt)
  )
    return { where: 'nuxt.config', how: 'Nuxt pages, without hashMode' };
  const skip = new Set(['node_modules', '.git', '.svelte-kit', '.next', '.nuxt', '.output', 'evidence', '.gamesfun']);
  const outTop = out && out !== '.' ? out.split('/')[0] : null;
  const rules = [
    [/\bcreateWebHistory\s*\(/, 'Vue Router createWebHistory'],
    [/\bcreateBrowserRouter\s*\(|<BrowserRouter\b|\bcreateBrowserHistory\s*\(/, 'React Router browser routing'],
  ];
  let seen = 0,
    angular = null,
    hashed = false;
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      if (seen > 3000) return null;
      if (skip.has(e.name) || (!rel && e.name === outTop) || e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const hit = walk(path.join(dir, e.name), r);
        if (hit) return hit;
        continue;
      }
      if (!/\.(m?[jt]sx?|vue|svelte)$/.test(e.name)) continue;
      seen++;
      const text = readText(path.join(dir, e.name));
      for (const [re, how] of rules) {
        const m = re.exec(text);
        if (m) return { where: `${r}:${lineAt(text, m.index)}`, how };
      }
      if (/withHashLocation\s*\(|useHash\s*:\s*true/.test(text)) hashed = true;
      const ng = /\bprovideRouter\s*\(|RouterModule\.forRoot\s*\(/.exec(text);
      if (ng && !angular) angular = { where: `${r}:${lineAt(text, ng.index)}`, how: 'Angular router, path location' };
    }
    return null;
  };
  return walk(root, '') ?? (angular && !hashed ? angular : null);
}

/** How each known build makes its paths relative. */
const ROOT_PATH_FIX =
  "Vite: base: './' in vite.config (not with React Router's framework mode: it then loads its routes from assets/assets/ and reloads for ever; it has no relative mode, see the README); Next.js static export with one page: assetPrefix: '.' in next.config (production builds only, so next dev keeps working; with more than one page Next.js has no relative mode: see the README); Astro with one page: build: { assetsPrefix: '.' } in astro.config (base: './' does not do it); Nuxt: ssr: false, app: { cdnURL: './' } and router: { options: { hashMode: true } } in nuxt.config, and in templates :src=\"'x.png'\" for a file in public/ (src=\"./x.png\" is read as an import); Create React App: \"homepage\": \".\" in package.json; Parcel: --public-url ./; hand-written HTML: ./x";

// Origins a bundled library names that a game never calls: XML namespaces, specifications, documentation and error pages.
const NOISE_DOMAINS = [
  'w3.org',
  'whatwg.org',
  'ecma-international.org',
  'ietf.org',
  'schema.org',
  'json-schema.org',
  'example.com',
  'example.org',
  'example.net',
  'reactjs.org',
  'react.dev',
  'vuejs.org',
  'svelte.dev',
  'github.com',
  'githubusercontent.com',
  'mozilla.org',
  'developer.chrome.com',
  'web.dev',
  'npmjs.com',
  'npmjs.org',
  'nodejs.org',
  'stackoverflow.com',
  'wikipedia.org',
  'goo.gl',
  'bit.ly',
  'fb.me',
  'khronos.org',
  'threejs.org',
  'babeljs.io',
  'tc39.es',
  'ns.adobe.com',
  'purl.org',
  'xmlns.com',
  'openxmlformats.org',
  'apple.com',
  'microsoft.com',
  'chromium.org',
  'creativecommons.org',
  'opensource.org',
  'spdx.org',
  'mit-license.org',
  'apache.org',
  'gnu.org',
  'jquery.com',
  'jquery.org',
  'lodash.com',
  'underscorejs.org',
  'feross.org',
  'tailwindcss.com',
  'vitejs.dev',
  'webpack.js.org',
  'esbuild.github.io',
  'rollupjs.org',
  'parceljs.org',
  'nextjs.org',
  'vercel.com',
  'angular.io',
  'emberjs.com',
  'getbootstrap.com',
  'fontawesome.com',
  'unicode.org',
];
const NOISE = new RegExp(`(^|\\.)(${NOISE_DOMAINS.map(d => d.replaceAll('.', '\\.')).join('|')})$`, 'i');
const ORIGIN_IN_TEXT =
  /\b((?:https?|wss?):)\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+|localhost|127\.0\.0\.1)(:\d{2,5})?(?=[/"'`\s?#)\\]|$)/gi;
const CODE_EXT = /\.(m?js|cjs|html?|css|json|svg)$/i;
const lineAt = (text, i) => text.slice(0, i).split('\n').length;

/** Every file of the published folder (hidden files listed apart, never read). → {files: [{rel, bytes, link}], hidden: [rel]} */
async function filesOf(root) {
  const files = [],
    hidden = [];
  async function walk(abs, rel) {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? `${rel}/${e.name}` : e.name,
        full = path.join(abs, e.name);
      if (
        e.name === 'node_modules' ||
        (!rel && ['evidence', 'server', 'supabase'].includes(e.name) && e.isDirectory()) ||
        (!rel && e.name === 'gamesfun.json')
      )
        continue;
      if (e.name.startsWith('.')) {
        hidden.push(r + (e.isDirectory() ? '/' : ''));
        continue;
      }
      const st = await lstat(full);
      if (st.isSymbolicLink()) {
        files.push({ rel: r, bytes: 0, link: true });
        continue;
      }
      if (st.isDirectory()) await walk(full, r);
      else if (st.isFile()) files.push({ rel: r, bytes: st.size, link: false });
    }
  }
  await walk(root, '');
  return { files, hidden };
}

/**
 * The published folder read against the hosting (no browser): {files, bytes, fix: [{what, fix}], warn: [{what, fix}],
 * origins: [{origin, where, kind}]} — `origins` are the other sites the code names that backend.json does not list.
 */
export async function scanPage(out, { backend = [], limits = DEFAULT_LIMITS, prefix = '.', hasServer = false } = {}) {
  // a file as the person finds it: under the published folder (dist/index.html), not as the host serves it
  const at = rel => (prefix && prefix !== '.' ? `${prefix}/${rel}` : rel);
  // hosts the fix list already names (a CDN, a font service): not repeated as sites to declare
  const loadedFrom = new Set();
  const hostOf = url => url.replace(/^\/\//, 'https://').split('/').slice(0, 3).join('/');
  const fix = [],
    warn = [],
    named = new Map();
  const { files, hidden } = await filesOf(out);
  // what the entry page names as an engine's files: a Unity build's loader config (hashed names too), a Godot export
  const entryText = await readFile(path.join(out, 'index.html'), 'utf8').catch(() => '');
  const unityNamed = new Set(
    [
      ...entryText.matchAll(
        /\b(loaderUrl|frameworkUrl|codeUrl|dataUrl|symbolsUrl)\s*[:=]\s*(?:buildUrl\s*\+\s*)?["'`]([^"'`]+)["'`]/g,
      ),
    ].map(m => m[2].replace(/^\.?\//, '')),
  );
  const unityBuild =
    unityNamed.size > 0 || files.some(f => /(^|\/)Build\/[^/]+\.loader\.js$|(^|\/)UnityLoader\.js$/.test(f.rel));
  const namedByUnity = rel => [...unityNamed].some(n => rel === n || rel.endsWith(`/${n}`));
  // the data an engine fetches itself (Unity's .data and .unityweb, Godot's .pck): no type needed
  const engineData = rel =>
    (unityBuild && (/\.(data|unityweb|symbols\.json)$/i.test(rel) || namedByUnity(rel))) || /\.pck$/i.test(rel);
  const bytes = files.reduce((n, f) => n + f.bytes, 0);
  if (files.length > limits.files)
    fix.push({
      what: `${files.length} files; a published game may have ${limits.files}`,
      fix: 'Pack small files together (a sprite sheet, an audio sprite, one bundle) or leave out what the game never loads',
    });
  if (bytes > limits.totalBytes)
    fix.push({
      what: `${mb(bytes)} in all; a published game may be ${mb(limits.totalBytes)}`,
      fix: 'Compress pictures (WebP, KTX2) and sounds (Ogg, lower bit rates), and leave out what the game never loads',
    });
  for (const f of files.filter(x => x.bytes > limits.fileBytes))
    fix.push({
      what: `${at(f.rel)} is ${mb(f.bytes)}; one file may be ${mb(limits.fileBytes)}`,
      fix: 'Split it, or compress it (Draco or meshopt for models, KTX2 for textures, a lower bit rate for sounds and videos)',
    });
  const untyped = files.filter(f => UNTYPED_CODE.test(f.rel));
  if (untyped.length)
    warn.push({
      what: `${untyped
        .slice(0, 5)
        .map(f => f.rel)
        .join(
          ', ',
        )}${untyped.length > 5 ? ', …' : ''}: the host serves these as plain bytes (application/octet-stream), so a browser will not run them as code`,
      fix: 'Publish what the build makes from them (.js, .css), not the sources; a page that loads one of these by URL needs it built first',
    });
  // Unity's WebGL build compressed with Brotli or Gzip (its default) and no decompression fallback: the loader expects the
  // server to send these with Content-Encoding, and the play host serves every file as it is
  const packedAll = files.filter(f => /\.(framework\.js|wasm|data|symbols\.json)\.(br|gz)$/i.test(f.rel));
  // an older build's packed files beside the unpacked ones the page loads: left over, never fetched
  const unpacked = new Set(files.map(f => f.rel));
  const leftover = packedAll.filter(f => unpacked.has(f.rel.replace(/\.(br|gz)$/i, '')));
  const unityPacked = packedAll.filter(f => !leftover.includes(f));
  if (leftover.length)
    warn.push({
      what: `${at(leftover[0].rel)}${leftover.length > 1 ? ` and ${leftover.length - 1} more` : ''}: compressed copies of a Unity build's files that sit beside the files themselves (an earlier build's)`,
      fix: 'The page loads the uncompressed files, so these are never fetched: delete them to publish less',
    });
  if (unityPacked.length)
    fix.push({
      what: `${at(unityPacked[0].rel)}${unityPacked.length > 1 ? ` and ${unityPacked.length - 1} more` : ''}: a Unity build compressed for a server that sends Content-Encoding, which the play host does not; the loader stops with "Unable to parse ${unityPacked[0].rel.split('/').pop()}"`,
      fix: 'In Unity, Player Settings → Publishing Settings: Compression Format Disabled, or keep the compression and turn on Decompression Fallback (the loader then unpacks the files itself). Then build again',
    });
  // a Godot export inside its project: the editor imports the export's own pictures, and writes .import files beside them
  const godotImports = files.some(f => /\.pck$/i.test(f.rel)) ? files.filter(f => /\.import$/i.test(f.rel)) : [];
  if (godotImports.length)
    warn.push({
      what: `${at(godotImports[0].rel)}${godotImports.length > 1 ? ` and ${godotImports.length - 1} more` : ''}: the Godot editor imported the export's own files`,
      fix: 'Delete them, and put an empty file named .gdignore in the export folder: the editor then leaves the folder alone',
    });
  const odd = files.filter(
    f =>
      !godotImports.includes(f) &&
      !servedTyped(f.rel) &&
      !UNTYPED_CODE.test(f.rel) &&
      /\.[a-z0-9]+$/i.test(f.rel) &&
      !packedAll.includes(f) &&
      !engineData(f.rel),
  );
  if (odd.length)
    warn.push({
      what: `${odd.length} file${odd.length === 1 ? '' : 's'} of a type the host does not know (${[...new Set(odd.map(f => f.rel.split('.').pop()))].slice(0, 6).join(', ')}): served as application/octet-stream`,
      fix: 'Fine for data the game reads with fetch(); a picture, sound or script in such a file will not play from its URL',
    });
  // what the entry page loads from its own folder and the folder lacks (a build that was not made, or not copied)
  const absent = [];
  for (const m of entryText.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const src = m[1].split(/[?#]/)[0];
    if (/^([a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(src) || src.includes('${') || src.includes('{{')) continue;
    let rel;
    try {
      rel = decodeURIComponent(path.posix.normalize(src).replace(/^\.\//, ''));
    } catch {
      continue;
    }
    if (!rel.startsWith('..') && !unpacked.has(rel))
      absent.push(`${at('index.html')}:${lineAt(entryText, m.index)} loads ${rel}`);
  }
  for (const n of unityNamed)
    if (!files.some(f => f.rel === n || f.rel.endsWith(`/${n}`))) absent.push(`its Unity loader names ${n}`);
  if (absent.length)
    fix.push({
      what: `${absent.slice(0, 3).join('; ')}${absent.length > 3 ? ` and ${absent.length - 3} more` : ''}, which ${absent.length === 1 ? 'is' : 'are'} not in the folder`,
      fix: unityBuild
        ? "The Unity build's Build/ folder is missing (git often leaves it out): build again into this folder, or adopt the folder the build went to"
        : 'Build the game first, or point adopt at the folder the build writes (--out <dir>)',
    });
  const ownHidden = new Set(['.gamesfun/', '.git/', '.gitignore', '.DS_Store']);
  const theirs = hidden.filter(h => !ownHidden.has(h));
  if (theirs.length)
    warn.push({
      what: `hidden files never go up: ${theirs.slice(0, 5).join(', ')}${theirs.length > 5 ? ', …' : ''}`,
      fix: 'If the game loads one of them, give it a name without the leading dot',
    });

  let rootPaths = 0,
    sw = false,
    devices = new Map(), // what it asks for → where
    callsApi = [];
  // a file the page loads by a path from the root: the first three are listed, the rest counted
  const fromRoot = (what, own) => {
    if (fix.some(x => x.what === what)) return; // the same path twice on a line of a bundle
    if (rootPaths++ >= 3) return;
    const long = `Use relative paths: the game is served under a folder in games.fun Studio's preview and in the kit's dev server, so /x breaks there. ${ROOT_PATH_FIX}`;
    fix.push({ what, fix: own ?? (fix.some(x => x.fix === long) ? 'The same fix: relative paths' : long) });
  };
  // a page written as name.html (SvelteKit's default, some others): the host serves /name.html and /name/ (from
  // name/index.html), never /name, so a link or a reload of /name answers "not found"
  const present = new Set(files.map(f => f.rel));
  const pages = files
    .map(f => f.rel)
    .filter(
      r =>
        /\.html?$/i.test(r) &&
        !/(^|\/)(index|404|_not-found|200)\.html?$/i.test(r) && // the entry, and the error pages builds write
        !present.has(`${r.replace(/\.html?$/i, '')}/index.html`),
    )
    .map(r => {
      const base = r
        .replace(/\.html?$/i, '')
        .split('/')
        .pop()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return { rel: r, re: new RegExp(`["'\`](?:\\.{1,2}/|/)(?:[\\w.-]+/)*${base}/?["'\`?#]`) };
    });
  const pageLinked = new Map();
  // an engine's own files (a Godot export's index.js and worklets, a Unity build's loader and framework): what they can
  // do (a service worker, the microphone) and the sites their comments name are the engine's, not the game's
  const godotExe = /GODOT_CONFIG\s*=\s*\{[^]*?"executable"\s*:\s*"([^"]+)"/.exec(entryText)?.[1];
  const engineFile = rel =>
    (godotExe &&
      new RegExp(
        `^${godotExe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(js|audio\\.worklet\\.js|audio\\.position\\.worklet\\.js|service\\.worker\\.js)$`,
      ).test(rel)) ||
    /(^|\/)Build\/[^/]+\.(loader|framework)\.js$|(^|\/)UnityLoader\.js$/.test(rel) ||
    (unityBuild && /\.js$/i.test(rel) && namedByUnity(rel));
  for (const f of files.filter(x => CODE_EXT.test(x.rel) && !x.link && x.bytes < 8 * 1024 * 1024)) {
    const text = await readFile(path.join(out, ...f.rel.split('/')), 'utf8').catch(() => '');
    const engine = engineFile(f.rel);
    if (/\.html?$/i.test(f.rel)) {
      for (const m of text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi)) {
        loadedFrom.add(hostOf(m[1]));
        fix.push({
          what: `${at(f.rel)}:${lineAt(text, m.index)} loads a script from ${hostOf(m[1])}`,
          fix: 'The hosted page runs scripts from its own files only: install it as a package (it is bundled) or put a copy of the file in the game and load that',
        });
      }
      // an import map sends bare imports ("three") to whatever URL it names
      for (const m of text.matchAll(/<script\b[^>]*\btype\s*=\s*["']?importmap["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
        let map;
        try {
          map = JSON.parse(m[1]);
        } catch {
          continue;
        }
        const urls = [...Object.values(map?.imports ?? {}), ...Object.values(map?.scopes ?? {}).flatMap(Object.values)];
        const hosts = [...new Set(urls.filter(u => typeof u === 'string' && /^(https?:)?\/\//.test(u)).map(hostOf))];
        for (const u of urls.filter(u => typeof u === 'string' && /^\/(?!\/)/.test(u)))
          fromRoot(
            `${at(f.rel)}:${lineAt(text, m.index)} has an import map entry ${u} from the root`,
            `Use a relative path (./${u.slice(1)}): the game is served under a folder in games.fun Studio's preview and in the kit's dev server`,
          );
        for (const h of hosts) loadedFrom.add(h);
        if (hosts.length)
          fix.push({
            what: `${at(f.rel)}:${lineAt(text, m.index)} has an import map that loads modules from ${hosts.join(', ')}`,
            fix: 'The hosted page runs scripts from its own files only: copy the library into the game (only the files it imports, with its licence) and point the import map at the copy (./vendor/…)',
          });
      }
      for (const m of text.matchAll(/<link\b[^>]*\bhref\s*=\s*["']((?:https?:)?\/\/[^"']+)["'][^>]*>/gi)) {
        const fonts = /fonts\.(googleapis|gstatic)\.com/.test(m[1]);
        // a preconnect or dns-prefetch hint loads nothing; it goes with the font or file link it serves
        if (fonts || /rel\s*=\s*["']?(preconnect|dns-prefetch)/i.test(m[0])) loadedFrom.add(hostOf(m[1]));
        if (fonts) loadedFrom.add('https://fonts.gstatic.com');
        if (/rel\s*=\s*["']?(stylesheet|preload|modulepreload|icon|manifest)/i.test(m[0])) {
          loadedFrom.add(hostOf(m[1]));
          fix.push({
            what: `${at(f.rel)}:${lineAt(text, m.index)} loads ${fonts ? 'web fonts' : 'a file'} from ${hostOf(m[1])}`,
            fix: fonts
              ? "The hosted page loads fonts from its own files only: open the Google Fonts CSS link, download the .woff2 files it names (only the subsets for the scripts the game shows: latin for English, every subset listed for Japanese, Chinese or Korean), copy its @font-face rules into the game's CSS pointing at the copies, and keep the font's licence (OFL.txt) beside them"
              : 'The hosted page loads style sheets and fonts from its own files only: download them into the game and link the copies',
          });
        }
      }
      for (const m of text.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi))
        fix.push({
          what: `${at(f.rel)}:${lineAt(text, m.index)} frames ${m[1].split('/').slice(0, 3).join('/')}`,
          fix: 'The hosted page cannot frame other sites: link to it instead',
        });
      if (/<base\b[^>]*href/i.test(text))
        fix.push({
          what: `${at(f.rel)} has a <base href>`,
          fix: 'The hosted page refuses <base>: take it out and use relative URLs. A router that reads the path needs a hash router then (Angular: remove <base href> from src/index.html and add withHashLocation() to provideRouter; React Router: createHashRouter; Vue Router: createWebHashHistory; Nuxt: router: { options: { hashMode: true } })',
        });
      if (/<form\b[^>]*\baction\s*=/i.test(text))
        warn.push({
          what: `${at(f.rel)} has a form with an action`,
          fix: 'The hosted page sends no form posts: handle the form in script (fetch to your backend or /api/)',
        });
      // a tag with its attributes (not JSDoc's Array<Object>)
      const plugin = /<(?:object|embed)\s[^>]*\b(?:data|src|type)\s*=/i.exec(text);
      if (plugin)
        fix.push({
          what: `${at(f.rel)}:${lineAt(text, plugin.index)} has an <object> or <embed>`,
          fix: 'The hosted page loads none (plug-in content is off): show the file with <img>, <video>, <iframe> of your own page, or a canvas',
        });
      // srcset="/a.png 1x, /a@2x.png 2x": each picture in the list
      for (const m of text.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) {
        const root = m[1]
          .split(',')
          .map(c => c.trim().split(/\s+/)[0])
          .find(u => /^\/(?!\/)/.test(u));
        if (root) fromRoot(`${at(f.rel)}:${lineAt(text, m.index)} loads ${root} from the root (srcset)`);
      }
      // url(/x) in a <style> or a style="" attribute
      for (const m of text.matchAll(/url\(\s*["']?(\/(?!\/)[^"')]+)/gi))
        fromRoot(
          `${at(f.rel)}:${lineAt(text, m.index)} uses ${m[1]} from the root, in a style`,
          `Use a relative path (url(./${m[1].slice(1)})): the game is served under a folder in games.fun Studio's preview and in the kit's dev server`,
        );
      for (const m of text.matchAll(/\b(?:src|href|poster)\s*=\s*["'](\/(?!\/)[^"']*)["']/gi)) {
        const tag = text.slice(text.lastIndexOf('<', m.index), text.indexOf('>', m.index) + 1);
        if (/^<(a|base)\b/i.test(tag)) continue; // a link the player follows, or <base> (its own finding): no file the page loads
        if (/\brel\s*=\s*["']?[^"'>]*icon/i.test(tag)) {
          // one line for the icon, however many pages name it
          const same = warn.find(w => w.icon === m[1]);
          if (same) same.pages++;
          else
            warn.push({
              icon: m[1],
              pages: 1,
              what: `${at(f.rel)}:${lineAt(text, m.index)} names its tab icon ${m[1]} from the root`,
              fix: "It shows at the game's own link, not in Studio's preview or the kit's dev server: a relative path shows it everywhere",
            });
          continue;
        }
        if (/^\/socket\.io\//.test(m[1])) {
          fix.push({
            what: `${at(f.rel)}:${lineAt(text, m.index)} loads ${m[1]}, which your Socket.IO server serves`,
            fix: "games.fun serves only the game's files, not your server's: copy the client (node_modules/socket.io-client/dist/socket.io.min.js) into the game and load the copy, then connect with io('https://<your server>') instead of io(), and declare that server: backend use custom --url https://<your server>",
          });
          continue;
        }
        fromRoot(`${at(f.rel)}:${lineAt(text, m.index)} loads ${m[1]} from the root`);
      }
    }
    if (/\.css$/i.test(f.rel)) {
      for (const m of text.matchAll(/@import\s+(?:url\()?\s*["']?(https?:\/\/[^"')\s]+)/gi)) {
        loadedFrom.add(hostOf(m[1]));
        fix.push({
          what: `${at(f.rel)}:${lineAt(text, m.index)} imports a style sheet from ${m[1].split('/').slice(0, 3).join('/')}`,
          fix: 'Download it (and its fonts) into the game and import the copy',
        });
      }
      for (const m of text.matchAll(/url\(\s*["']?(\/(?!\/)[^"')]+)/gi))
        fromRoot(
          `${at(f.rel)}:${lineAt(text, m.index)} uses ${m[1]} from the root`,
          'Use a path relative to the style sheet',
        );
    }
    if (/\.(m?js|cjs|html?)$/i.test(f.rel)) {
      const imported = new Map();
      for (const m of text.matchAll(/\b(?:from|import)\s*\(?\s*["']((?:https?:)?\/\/[^"']+)["']/g))
        if (!imported.has(hostOf(m[1]))) imported.set(hostOf(m[1]), lineAt(text, m.index));
      for (const [h, line] of imported) {
        loadedFrom.add(h);
        fix.push({
          what: `${at(f.rel)}:${line} imports a module from ${h}`,
          fix: 'The hosted page runs scripts from its own files only: install it as a package (it is bundled) or put a copy in the game and import that',
        });
      }
      if (!engine && /serviceWorker\s*\.\s*register\s*\(/.test(text)) sw = true;
      for (const [what, re] of [
        ['the camera or microphone', /getUserMedia\s*\(/],
        ['the location', /geolocation\s*\.\s*(getCurrentPosition|watchPosition)/],
        ['USB or payments', /navigator\s*\.\s*usb\b|PaymentRequest\s*\(/],
        ['SharedArrayBuffer (threads)', /\bnew\s+SharedArrayBuffer\s*\(|\bAtomics\s*\.\s*wait\s*\(/],
      ]) {
        if (engine && !/threads/.test(what)) continue;
        const m = re.exec(text);
        if (m && !devices.has(what)) devices.set(what, `${at(f.rel)}:${lineAt(text, m.index)}`);
      }
      // the page calling its own api/: only the game's own server/ answers there once hosted
      // a fetch of api/…, or a path to /api/… handed to the game's own helper (call('GET', '/api/state'))
      const api = /\bfetch\s*\(\s*["'`](?:\.?\/)?api\/[^"'`]*|["'`]\/api\/[A-Za-z][^"'`\s]*["'`]/.exec(text);
      if (api && !hasServer) callsApi.push(`${at(f.rel)}:${lineAt(text, api.index)}`);
      // paths from the root built in a script: fetch('/x'), import('/x'), el.src = '/x', new Audio('/x'),
      // setAttribute('src', '/x'), and the engines' loaders: Phaser load.image('key', '/x'), three.js loader.load('/x'),
      // PIXI Assets.load('/x') and Texture.from('/x')
      for (const m of text.matchAll(
        /(?:\b(?:fetch|import|importScripts)\s*\(\s*|\bnew\s+(?:(?:Shared)?Worker|Audio)\s*\(\s*|\.src\s*=\s*|\.setAttribute\s*\(\s*["'](?:src|href|poster)["']\s*,\s*|\bload\.(?:image|audio|spritesheet|atlas|json|tilemapTiledJSON|bitmapFont|video|text|glsl|svg|multiatlas|aseprite)\s*\(\s*["'`][^"'`]*["'`]\s*,\s*|\.load\s*\(\s*|\b(?:Assets\.(?:load|add)|Texture\.from)\s*\(\s*)["'`](\/(?!\/)(?!api\/)[^"'`$\s]*)/g,
      ))
        fromRoot(
          `${at(f.rel)}:${lineAt(text, m.index)} loads ${m[1]} from the root, in a script`,
          `Use a relative path (./${m[1].slice(1)}): the game is served under a folder in games.fun Studio's preview and in the kit's dev server`,
        );
    }
    if (/\.(m?js|html?)$/i.test(f.rel))
      for (const pg of pages) {
        if (pageLinked.has(pg.rel)) continue;
        const m = pg.re.exec(text);
        if (m) pageLinked.set(pg.rel, `${at(f.rel)}:${lineAt(text, m.index)}`);
      }
    ORIGIN_IN_TEXT.lastIndex = 0;
    // a package manifest names sites (homepage, repository) the page never loads
    if (/(^|\/)(package(-lock)?\.json|composer\.json)$/.test(f.rel)) continue;
    // xcore's own copies in the game (loot's page client, the platform client) name their defaults; not the game's
    if (/^gf\/(loot|platform)\//.test(f.rel) || f.rel === 'gamesfun.js' || engine) continue;
    for (const m of text.matchAll(ORIGIN_IN_TEXT)) {
      const proto = m[1].toLowerCase(),
        host = m[2].toLowerCase();
      if (NOISE.test(host)) continue;
      // a bare "http://localhost" is a URL parser's base (new URL(path, 'http://localhost'), as React Router's and
      // Nuxt's runtimes write), not an address the page calls; one with a port or a path is a dev server
      if (host === 'localhost' && proto === 'http:' && !m[3] && /^\/?["'`]/.test(text.slice(m.index + m[0].length)))
        continue;
      let origin;
      try {
        origin = new URL(`${proto}//${host}${m[3] ?? ''}`).origin;
      } catch {
        continue;
      }
      if (proto === 'ws:' || proto === 'wss:') origin = `${proto}//${host}${m[3] ?? ''}`;
      if (backend.includes(origin)) continue;
      if (!named.has(origin))
        named.set(origin, {
          origin,
          where: `${at(f.rel)}:${lineAt(text, m.index)}`,
          kind: /^wss?:/.test(proto) ? 'websocket' : 'address',
        });
    }
  }
  if (rootPaths > 3)
    fix.push({ what: `${rootPaths - 3} more paths from the root`, fix: 'The same fix: relative paths' });
  for (const w of warn.filter(w => w.icon)) {
    if (w.pages > 1) w.what += ` (and ${w.pages - 1} more page${w.pages === 2 ? '' : 's'})`;
    delete w.icon;
    delete w.pages;
  }
  // no tab icon: every browser then asks for /favicon.ico, and the live page's console shows a 404 for it
  const entry = entryText;
  if (entry && !/<link\b[^>]*\brel\s*=\s*["']?[^"'>]*\bicon\b/i.test(entry) && !present.has('favicon.ico'))
    warn.push({
      what: `${at('index.html')} names no tab icon: browsers ask for /favicon.ico, and the live game's console shows a 404 for it`,
      fix: 'Add one beside the page and link it relatively: <link rel="icon" href="./icon.png"> (or put a favicon.ico at the root of what is published)',
    });
  if (sw)
    warn.push({
      what: 'it registers a service worker',
      fix: "Allowed, but it keeps the old files after you publish a new version until it updates itself: make it check for updates (or leave it out). Never let it cache the host's answers (api/, /platform/v1/, /loot/v1/, /player/v1/): a player would see another moment's scores, saves and balances",
    });
  if (callsApi.length)
    fix.push({
      what: `the page calls api/ on its own origin (${callsApi.slice(0, 3).join(', ')}), and the game has no server/`,
      fix: `games.fun answers a game's api/ only from its own server/ (a Worker, docs/SERVER.md). Either move that logic into server/, run the server on a host of your own and call it there (${CMD} backend use custom), or run the logic in the page (WebAssembly runs: Pyodide for Python, for example). Ask the person before a change of that size`,
    });
  const threads = devices.get('SharedArrayBuffer (threads)');
  devices.delete('SharedArrayBuffer (threads)');
  // Godot 4.3+ writes its export's choice into the page; with threads it waits for cross-origin isolation and never starts
  const godotThreads = /\bGODOT_THREADS_ENABLED\s*=\s*true\b/.test(entry);
  if (godotThreads)
    fix.push({
      what: `${at('index.html')} is a Godot export built with Thread Support: it needs a cross-origin isolated page, which games.fun does not give a brought game, so it stops at "missing features: Cross Origin Isolation, SharedArrayBuffer"`,
      fix: 'In Godot (4.3 or later), Project → Export → Web: turn Thread Support off and export again (Godot 4.0 to 4.2 always export with threads: upgrade the project)',
    });
  else if (threads)
    warn.push({
      what: `${threads} uses SharedArrayBuffer or Atomics.wait: a games.fun page is not cross-origin isolated, so SharedArrayBuffer is undefined there`,
      fix: 'Keep a path without it (the game should still start), or export single-threaded: an engine built with threads (Emscripten pthreads, Godot or Unity with thread support) does not start on games.fun',
    });
  if (devices.size)
    warn.push({
      what: `it asks for ${[...devices.entries()].map(([what, where]) => `${what} (${where})`).join(' and ')}`,
      fix: 'The play host turns these off for every game: give the player another way',
    });
  for (const [rel, where] of pageLinked)
    fix.push({
      what: `${at(rel)} is a page of its own, and ${where} links to it without .html: a link or a reload there answers "not found" once hosted`,
      fix: `The host serves ${rel.replace(/\.html?$/i, '')}/ from ${rel.replace(/\.html?$/i, '')}/index.html, and ${rel} as it is, never the name alone. Build each page as a folder: SvelteKit export const trailingSlash = 'always' (in +layout.js); Next.js trailingSlash: true; Astro build.format: 'directory' (its default); or link to the .html file`,
    });
  const origins = [...named.values()];
  const local = origins.filter(o => /\/\/(localhost|127\.0\.0\.1)(:|$)/.test(o.origin));
  for (const o of local)
    fix.push({
      what: `${o.where} names ${o.origin}, on this machine`,
      fix: `A published game cannot reach this machine: point it at your hosted backend (and declare it: ${CMD} backend use custom --url <https://…>), or at /api/ (server/, docs/SERVER.md)`,
    });
  const others = origins.filter(o => !local.includes(o) && !loadedFrom.has(o.origin));
  if (others.length)
    warn.push({
      what: `the code names ${others.length} other site${others.length === 1 ? '' : 's'} that backend.json does not list: ${others
        .slice(0, 8)
        .map(o => `${o.origin} (${o.where})`)
        .join(', ')}${others.length > 8 ? ', …' : ''}`,
      fix: `The hosted page reaches only its own origin and backend.json's origins (at most 8). If the game calls one of these, declare it: ${CMD} backend use custom --url <its origin> [--origin wss://…]. A library's own links (documentation, licences) need nothing; ${CMD} check shows which ones the page really calls`,
    });
  return { files: files.length, bytes, fix, warn, origins: others };
}

/**
 * Adopt a folder: gamesfun.json → page is written unless it is refused. Options: build (a command), out, static
 * (folders), noBuild (read what is there, do not run the build), onLine (the build's output). → the report:
 * {dir, shape, page, wrote, built: {ran, code, seconds, tail} | null, refused: [{what, fix}], fix: [...], warn: [...],
 * origins: {declared, found}, files, bytes, ok}
 */
export async function adopt(
  dir,
  { build = null, out = null, static: stat = null, noBuild = false, onLine = () => {}, env = process.env } = {},
) {
  const root = path.resolve(dir);
  const report = {
    dir: root,
    shape: null,
    page: null,
    wrote: false,
    built: null,
    refused: [],
    fix: [],
    warn: [],
    made: [], // files adopt wrote in the project besides its record (a Godot Web preset)
    origins: { declared: [], found: [] },
    files: 0,
    bytes: 0,
    ok: false,
  };
  if (!existsSync(root)) {
    report.refused.push({ what: `${dir}: no such folder`, fix: 'Give the folder of your game' });
    return report;
  }
  if (existsSync(path.join(root, 'gf-three.json'))) {
    report.refused.push({
      what: 'this is already a kit game (gf-three.json)',
      fix: `It needs no adopting: the kit's verify and publish work on it as it is`,
    });
    return report;
  }
  if (readJsonSync(path.join(root, 'base.json'))?.schema === 'gf-base-release/1') {
    report.refused.push({
      what: "this is a copy of one of the kit's starts (base.json)",
      fix: "It needs no adopting: change it by its EDITING.md, then the kit's verify",
    });
    return report;
  }

  // adopting again: what the last adopt recorded counts as given, unless this run gives its own
  let saved;
  try {
    saved = readPage(root);
  } catch {
    saved = null; // a record that does not read is written again from what is found
  }
  if (saved && !build && !out && !stat) {
    build = saved.build ?? null;
    out = saved.out;
    stat = saved.build || saved.static !== saved.out ? (saved.static ?? null) : null;
    report.fromRecord = true;
  } else if (saved) {
    // a flag changes its own part of the record; the rest stays as recorded (a custom build kept when only --static
    // is given; the folder loot add chose kept when only --out is). A new --build makes its own output folder.
    report.kept = [];
    if (!build && saved.build) {
      build = saved.build;
      report.kept.push(`build (${saved.build})`);
    }
    if (!out && saved.out && !(build && build !== saved.build)) {
      out = saved.out;
      report.kept.push(`out (${saved.out})`);
    }
    if (!stat && saved.static && (saved.build || saved.static !== saved.out)) {
      stat = saved.static;
      report.kept.push(`static (${saved.static})`);
    }
  }
  const shape = detectShape(root);
  report.shape = {
    kind: shape.kind,
    framework: shape.framework,
    ...(shape.server ? { server: shape.server } : {}),
    ...(shape.engine ? { engine: shape.engine } : {}),
  };
  const given = build || out;
  if (!given && (shape.kind === 'server' || shape.kind === 'none')) {
    // a Godot project with no Web export yet: its preset written for games.fun (single-threaded, into build/web/)
    const preset = shape.engine === 'Godot' ? await godotWebPreset(root) : null;
    if (preset?.wrote) report.made.push('export_presets.cfg (a Web preset)', 'build/.gdignore');
    report.refused.push({ what: shape.why, fix: preset ? godotExportFix(preset) : shape.fix });
    return report;
  }
  // what is given wins; an unknown build's output is found after it runs; a folder with no build is its own static folder
  const page = { build: build ?? shape.build, out: out ?? shape.out, static: stat ?? null };
  if (page.build && !stat) page.static = shape.static ?? null;
  if (!page.build && !page.out) page.out = '.';
  let buildStarted = null;
  if (
    shape.kind === 'build' &&
    shape.base !== undefined &&
    shape.base !== null &&
    !['./', '', '.'].includes(shape.base)
  )
    report.fix.push({
      what: `vite.config sets base: '${shape.base}'`,
      fix: "Use base: './': the game is served under a folder in games.fun Studio's preview and in the kit's dev server, so paths from the root break there",
    });

  if (page.build && !noBuild) {
    if (
      existsSync(path.join(root, 'package.json')) &&
      !packagesInstalled(root) &&
      /^(npm|pnpm|yarn|bun)\b/.test(page.build)
    ) {
      report.refused.push({
        what: 'its packages are not installed (no node_modules)',
        setup: true,
        fix: `Install them first (${installCommand(root)}), then adopt again`,
      });
      return report;
    }
    buildStarted = Date.now();
    report.built = await runBuild(root, { build: page.build, onLine, env });
    if (report.built.code !== 0) {
      report.refused.push({
        what: `the build (${page.build}) failed with exit code ${report.built.code}`,
        fix: `Make it pass on its own first: ${page.build}${buildFailure(report.built) ? ` (it said: ${buildFailure(report.built)})` : ''}`,
      });
      return report;
    }
  }
  if (!page.out) page.out = guessOut(root, buildStarted);
  if (!page.out) {
    report.refused.push({
      what: `the build ran but no folder of its output has an index.html (looked in dist/, build/, out/, public/ …)`,
      fix: 'Say where it writes: --out <dir> (--out . when the build writes index.html into the project folder itself)',
    });
    return report;
  }
  if (!existsSync(path.join(root, ...page.out.split('/'), 'index.html'))) {
    report.refused.push(
      noBuild && page.build
        ? {
            what: `${page.out}/index.html is not there yet`,
            fix: `Build it (${page.build}), or adopt without --no-build`,
          }
        : {
            what: `no index.html in ${page.out === '.' ? 'the folder' : `${page.out}/`}${page.build ? ' after the build' : ''}: nothing static to serve`,
            fix:
              shape.kind === 'build'
                ? 'A hosted game is static files: check that the build makes a static site (not a server), or say where it writes with --out <dir>'
                : 'Point adopt at the folder with index.html (--out <dir>)',
          },
    );
    // a Godot project named with the folder its export goes to, before the first export: its preset, and the command
    if (!page.build && existsSync(path.join(root, 'project.godot'))) {
      const preset = await godotWebPreset(root);
      if (preset.wrote) report.made.push('export_presets.cfg (a Web preset)', 'build/.gdignore');
      report.refused[report.refused.length - 1].fix = godotExportFix(preset);
    }
    return report;
  }
  try {
    report.page = checkPage({
      build: page.build ?? undefined,
      out: page.out,
      ...(page.static ? { static: page.static } : {}),
    });
  } catch (e) {
    report.refused.push({ what: e.message, fix: "Give folders inside the game's folder" });
    return report;
  }
  if (page.build && !page.static)
    report.warn.push({
      what: 'xcore does not know which folder this build copies as it is (its public folder)',
      fix: `Say it with --static <dir> before \`${CMD} loot add\` or \`${CMD} backend use\`: the files they add (backend.json, xsolana.json, gf/loot/) go there so every build carries them`,
    });

  report.page = await writePage(root, report.page);
  report.wrote = true;
  const roots = pageRoots(root);
  const backendFile = pageFile(roots, BACKEND_FILE);
  const declared = backendOrigins(readJsonSync(backendFile), { own: ownOrigins() }).origins;
  report.origins.declared = declared;
  const hasServer = existsSync(path.join(root, 'server')) || !!readJsonSync(path.join(root, CONFIG_FILE))?.server;
  report.hasServer = hasServer;
  const scanned = await scanPage(roots.out, { backend: declared, prefix: report.page.out, hasServer });
  report.files = scanned.files;
  report.bytes = scanned.bytes;
  report.fix.push(...scanned.fix);
  report.warn.push(...scanned.warn);
  const program = [
    [
      'a Python program',
      ['run.py', 'app.py', 'server.py', 'main.py', 'manage.py', 'requirements.txt', 'pyproject.toml'],
    ],
    ['a Go program', ['go.mod']],
    ['a Ruby program', ['Gemfile']],
    ['a Rust program', ['Cargo.toml']],
    ['a PHP program', ['composer.json']],
  ].find(([, files]) => files.some(f => existsSync(path.join(root, f))));
  const apiFix = report.fix.find(f => /calls api\/ on its own origin/.test(f.what));
  if (apiFix && program)
    apiFix.what += `; the folder has ${program[0]} (${program[1].find(f => existsSync(path.join(root, f)))}), which games.fun does not run`;
  const router = pathRouter(root, report.page.out);
  if (router)
    report.warn.push({
      what: `${router.where} routes by path (${router.how}): a deep link or a reload of a route (/level/2) answers "not found" once hosted, and under a folder (games.fun Studio's preview, the kit's dev server) no route matches`,
      fix:
        router.fix ??
        'The host serves files only, with no fallback to index.html. Use hash routing: Vue createWebHashHistory(); Nuxt router: { options: { hashMode: true } } in nuxt.config; React Router createHashRouter or <HashRouter>; Angular withHashLocation() in provideRouter (or useHash: true). Links people already shared keep their old paths',
    });
  if (report.page.out === '.' && existsSync(path.join(root, 'package.json')))
    report.warn.push({
      what: 'the published folder is the whole project: its source, package.json, README and every other file go up',
      fix: 'Fine if they may be public. Otherwise have the build write the page into a folder of its own (site/, dist/) and adopt with --out <that folder>, or give what should stay private a name that starts with a dot',
    });
  if (shape.server) {
    const named = `${shape.server.framework}${shape.server.start ? `, \`${shape.server.start}\`` : ''}`;
    report.warn.push(
      hasServer
        ? {
            what: `its Node server (${named}) is not published; its server/ is, and games.fun runs that at /api/*`,
            fix: `Fine when server/ took over its work (the page talks to api/ on its own origin, not to the Node server): run both with ${CMD} dev to see. If the page still needs the Node server, keep it on your own host and declare it: ${CMD} backend use custom --url https://<your server>`,
          }
        : {
            what: `its server (${named}) is not published: games.fun hosts ${report.page.out}/ only`,
            fix: `Either move what it does into server/, which games.fun runs for the game (docs/SERVER.md: a Worker at /api/*, Durable Objects for rooms; ${CMD} add multiplayer starts rooms, ${CMD} add database a database; ${CMD} dev runs it here), or keep it on your own host and declare it: ${CMD} backend use custom --url https://<your server> (its wss:// origin comes with it), with the page connecting to that address instead of its own origin (io(), fetch('/api/…')); the server answers CORS for https://<slug>-play.xgames.fun`,
          },
    );
  }
  report.origins.found = scanned.origins;
  // publish's own refusals, on exactly what would go up: no index.html, .env files, links, the host's own paths,
  // secrets, backend.json, server/
  const pre = await preflight(root);
  for (const p of pre.problems) report.fix.push({ what: p, fix: 'Publish refuses it: change it as it says' });
  if (pre.secrets)
    report.fix.push({
      what: pre.secrets.replace(/^Nothing was published: /, ''),
      fix: 'Move the key out of the game: a browser game carries only keys made to be public; the rest lives in your backend, or in server/ (docs/SERVER.md). If the file was ever shared, committed or published, treat the key as exposed: revoke it and make a new one',
    });
  if (pre.names) report.fix.push({ what: pre.names, fix: 'Take the name out' });
  report.ok = !report.refused.length && !report.fix.length;
  return report;
}

/** The report as plain lines (the command and the tool's text). */
export function reportLines(r, { shown = d => d } = {}) {
  const lines = [];
  const kind = r.shape
    ? r.shape.kind === 'build'
      ? `a project with a build (${r.shape.framework})`
      : r.shape.kind !== 'build' && r.page?.build
        ? `built by ${r.page.build}`
        : r.shape.kind === 'static' && r.shape.engine
          ? `a ${r.shape.engine} project (its web export, ${r.page?.out ?? 'as exported'}: export again after a change, then check)`
          : r.shape.kind === 'static'
            ? `plain static files${r.shape.server ? ` (its ${r.shape.server.framework} server is not published${r.hasServer ? '; its server/ is' : ''})` : ''}`
            : r.shape.kind === 'server'
              ? `rendered by a server (${r.shape.framework})`
              : existsSync(path.join(r.dir, 'project.godot'))
                ? 'a Godot project'
                : existsSync(path.join(r.dir, 'ProjectSettings', 'ProjectVersion.txt'))
                  ? 'a Unity project'
                  : r.page
                    ? 'files made outside xcore'
                    : 'no game the kit can see'
    : '';
  const name = shown(r.dir);
  lines.push(`${name === '.' ? path.basename(r.dir) : name}: ${kind}.`);
  if (r.built?.ran) lines.push(`  built with ${r.page?.build ?? 'its build'} in ${r.built.seconds} s`);
  if (r.page)
    lines.push(
      `  published folder: ${r.page.out}${r.page.build ? `, made by: ${r.page.build}` : ''}${r.page.static && r.page.static !== r.page.out ? `; xcore adds its files to: ${r.page.static}` : ''}; ${r.files} files, ${mb(r.bytes)}`,
    );
  if (r.fromRecord) lines.push('  as gamesfun.json records it (give --build, --out or --static to change it)');
  if (r.kept?.length) lines.push(`  kept from gamesfun.json: ${r.kept.join(', ')}`);
  if (r.wrote) lines.push('  wrote gamesfun.json (page: how it builds and what is published; never published itself)');
  const list = (title, items) => {
    if (!items.length) return;
    lines.push('', `${title}:`);
    for (const i of items) lines.push(`  - ${i.what}`, `    fix: ${i.fix}`);
  };
  // a step before adopt can read the game (its packages) is not a reason it cannot be hosted
  list(
    'Before adopt can run',
    r.refused.filter(i => i.setup),
  );
  list(
    'Cannot be hosted as it is',
    r.refused.filter(i => !i.setup),
  );
  list('Fix before publishing', r.fix);
  list('Worth a look', r.warn);
  if (r.origins.declared.length) lines.push('', `backend.json lets the page reach: ${r.origins.declared.join(', ')}`);
  lines.push('', adoptNext(r, { shown }).words);
  return lines;
}

/**
 * Where an adopt leaves the game, and what to do next (the report's last line, and `state` and `next` in --json):
 *   refused (nothing recorded; `made` lists any file written to help, such as a Godot Web preset) → fix, adopt again
 *   fix     (recorded, with problems that stop a publish)                                         → fix, then check
 *   ready   (recorded; only "worth a look" left, if anything)                                     → check, then publish
 * → { state, words, next (the command to run, or null while something must be fixed by hand first) }
 */
export function adoptNext(r, { shown = d => d } = {}) {
  const name = shown(r.dir);
  // the folder for the next commands, when it is not the one they run in
  const at = name === '.' ? '' : ` ${/[\s"'$`\\]/.test(name) ? JSON.stringify(name) : name}`;
  if (r.refused.length)
    return {
      state: 'refused',
      words: r.made?.length
        ? `Wrote ${r.made.join(' and ')}; no record yet (gamesfun.json). Do the above and adopt again.`
        : 'Nothing was written. Fix the above and adopt again.',
      next: null,
    };
  if (r.fix.length)
    return {
      state: 'fix',
      words: `Next: fix the list above, then ${CMD} check${at} (the page in Chrome, as the host serves it).`,
      next: null,
    };
  return {
    state: 'ready',
    words: `Next: ${CMD} check${at} (the page in Chrome, as the host serves it); when you want it live, ${CMD} login and ${CMD} publish${at}.`,
    next: `${CMD} check${at}`,
  };
}

/**
 * `xcore loot add`: where a game's economy lives and its page client (@xgamesfun/solana's, as ../economy.mjs
 * installPage copies it). A brought game keeps both in the folder its build copies as it is (gamesfun.json page.static),
 * so its build serves them; a plain folder, in its own folder.
 * → {home, economy (its file, or null), page: {package, version, files, changed} | null, steps: [words]}
 */
/** Where xcore keeps what it adds to an engine's export (a folder of the project, laid over the export: page.static). */
export const ENGINE_OVERLAY = 'gamesfun';

export async function addLoot(dir, { env = process.env } = {}) {
  const { installPage, solanaRoot, economyFile, ECONOMY_FILE } = await import('../economy.mjs');
  if (!solanaRoot(env))
    throw new Error(
      'The economy tools (@xgamesfun/solana) are not installed here: reinstall @xgamesfun/xcore (npm i @xgamesfun/xcore), or set GAMESFUN_SOLANA to a solana-kit checkout.',
    );
  let r = pageRoots(dir);
  if (r.brought && !r.static)
    throw new Error(
      `${dir} is a brought game with a build, and xcore does not know the folder its build copies as it is: adopt it again with --static <dir> (Vite, Next.js, Astro: public), so ${ECONOMY_FILE} and gf/loot/ are published with every build`,
    );
  // an engine's export is the engine's folder (an export can replace it, and it is often left out of git): the economy,
  // whose file holds the addresses it went live at, goes in a folder of the project's own, laid over the export
  const godot = existsSync(path.join(r.dir, 'project.godot'));
  const unity = existsSync(path.join(r.dir, 'ProjectSettings', 'ProjectVersion.txt'));
  if (r.brought && !r.build && r.static === r.out && r.out !== r.dir && (godot || unity) && !economyFile(r.out)) {
    const own = path.join(r.dir, ENGINE_OVERLAY);
    await mkdir(own, { recursive: true });
    // Godot imports every file under its project into the game's own package: not these
    if (godot && !existsSync(path.join(own, '.gdignore'))) await writeFile(path.join(own, '.gdignore'), '');
    await writePage(r.dir, { ...readPage(r.dir), static: ENGINE_OVERLAY });
    r = pageRoots(dir);
  }
  const home = r.static;
  const economy = economyFile(home);
  const page = economy ? await installPage(home, { env }) : null;
  const at = path.relative(r.dir, home).split(path.sep).join('/');
  const where = at ? `${at}/` : '';
  const name = economy ? path.basename(economy) : ECONOMY_FILE;
  const overlay = r.overlay && home === r.overlay;
  const laid = overlay
    ? [
        `${where.slice(0, -1)} is laid over the engine's export (${path.relative(r.dir, r.out).split(path.sep).join('/')}) when the game is published, checked or run with ${CMD} dev: export as before, and keep ${where} in git.`,
      ]
    : [];
  const steps = economy
    ? [
        ...laid,
        `The page client is in ${where}gf/loot/ (a copy: never edit it; publish keeps it current).`,
        `Load it from the page at run time with a page-relative URL: const { solanaApp, walletStandardSigner } = await import(new URL('gf/loot/play/index.js', document.baseURI).href) (a bundler leaves a URL import alone; Vite: add /* @vite-ignore */), and { solanaWallets, connectWallet, PAGE_RPC } from gf/loot/wallets.js; read the economy with fetch('${name}').`,
        "Give solanaApp rpcUrl: PAGE_RPC (the page's own /loot/v1/rpc: games.fun's relay once published, xcore dev's forward on this machine); a browser with no wallet is told so, with the game still playable.",
        `From Godot, Unity or a page with gamesfun.js (${CMD} add signin): GamesFun.loot.ready(), .connect() and .call('shop'), .call('buy', key, {listing}) … do the same with JSON in and out; play it all with ${CMD} dev.`,
        `Going live is the person's own step, in their own wallet: ${CMD} loot approve (in the folder with ${name}).`,
      ]
    : [
        `Design the economy with the xsolana-economy skill and the xsolana_* tools (${CMD} loot connect adds them): xsolana_guide, xsolana_examples, xsolana_check, xsolana_simulate, then xsolana_save {"spec": …, "file": "${where}${ECONOMY_FILE}"} (a path from the game's folder, where the tools run), or from a terminal: ${CMD} loot check|simulate|cost|explain <file>.`,
        `Then ${CMD} loot add again: it copies the page client into ${where}gf/loot/ beside it (publish does too).`,
        ...laid,
      ];
  return { home, economy, page, steps };
}
