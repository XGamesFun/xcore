// The folder's shape: plain files or a project whose build makes them (Vite, Next.js, Astro …), its package manager,
// and the folder an unknown build or a monorepo's workspace put the page in.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { readJson } from '../../util.mjs';
import { engineProject } from './engines.mjs';

export const readText = file => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};
const firstFile = (dir, names) => names.map(n => path.join(dir, n)).find(f => existsSync(f)) ?? null;
export const configText = (dir, base) =>
  readText(
    firstFile(
      dir,
      ['js', 'mjs', 'cjs', 'ts', 'mts'].map(e => `${base}.${e}`),
    ) ?? '',
  );

/** The package manager the project uses: its lock file, else package.json's "packageManager" (Corepack's
 *  "pnpm@9.1.0"), else a pnpm-workspace.yaml. → 'npm' | 'pnpm' | 'yarn' | 'bun' */
export function packageManager(dir) {
  if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(dir, 'bun.lockb')) || existsSync(path.join(dir, 'bun.lock'))) return 'bun';
  const declared = /^(npm|pnpm|yarn|bun)@/.exec(readJson(path.join(dir, 'package.json'))?.packageManager ?? '');
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
export const installCommand = dir => {
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
  const pkg = readJson(path.join(dir, 'package.json'));
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
      const ng = readJson(path.join(dir, 'angular.json'));
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

/** The first folder of these with an index.html, after an unknown build ran: at the top, or a level or two down
 *  (dist/<project>/, dist/<project>/browser/, as Angular and other multi-project builds write), else in a monorepo's
 *  workspace (packages/game/dist/). → a posix path or null */
export function guessOut(dir, since) {
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
