// adopt: a web game made anywhere, read for its shape, built, and its record written (gamesfun.json → page), with
// everything that does not fit xgames.fun's hosting listed with its fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adopt, packageManager, reportLines } from '../lib/publish/adopt.mjs';
import { pageRoots, pageTitle } from '../lib/publish/page.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import { typedPath } from '../lib/command.mjs';
import { FIXTURES, fixture, run, tempDir } from './helpers.mjs';

test('plain static files are their own published folder', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  const r = await adopt(dir);
  assert.deepEqual(r.refused, []);
  assert.deepEqual(r.fix, []);
  assert.equal(r.shape.kind, 'static');
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'gamesfun.json'), 'utf8')), { page: { out: '.' } });
  assert.equal(r.files, 4, 'gamesfun.json is not one of the published files');
  assert.equal(await resolveGame(dir), dir);
  assert.equal(pageTitle(dir), 'Dot Catch');
  assert.match(r.warn.map(w => w.what).join('\n'), /it has no way to go full screen/);
  assert.match(
    reportLines(r).join('\n'),
    /plain static files[\s\S]*Next: (npx -y @xgamesfun\/xcore|xcore|npx xcore|node bin\/xcore\.mjs) check/,
  );
  // the next commands name the folder, unless they run in it
  const next = shown => reportLines(r, { shown }).at(-1);
  assert.match(
    next(() => 'my-game'),
    / check my-game \(.* publish my-game\.$/,
  );
  assert.match(
    next(() => 'my game'),
    / check "my game" \(/,
  );
  assert.match(
    next(() => '.'),
    / check \(.* publish\.$/,
  );
});

test('a game with a full screen button (its own, or GamesFun.fullscreen()) is not told to add one', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  for (const call of ['document.body.requestFullscreen()', 'GamesFun.fullscreen()', 'el.webkitRequestFullscreen()']) {
    const dir = await fixture(tmp, 'static');
    await writeFile(path.join(dir, 'full.js'), `button.onclick = () => ${call};\n`);
    const r = await adopt(dir);
    assert.doesNotMatch(r.warn.map(w => w.what).join('\n'), /no way to go full screen/, call);
  }
});

test('a project with a build is built; its output is published and its public folder takes the files gamesfun adds', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'vite-like');
  const r = await adopt(dir);
  assert.deepEqual(r.refused, []);
  assert.equal(r.shape.framework, 'Vite');
  assert.deepEqual(r.page, { build: 'npm run build', out: 'dist', static: 'public' });
  assert.ok(existsSync(path.join(dir, 'dist', 'index.html')));
  assert.equal(pageRoots(dir).static, path.join(dir, 'public'));
  const bare = path.join(tmp.dir, 'bare');
  await cp(path.join(FIXTURES, 'vite-like'), bare, { recursive: true });
  assert.match(
    (await adopt(bare)).refused[0].what,
    /not installed/,
    'a project whose packages are not installed is told to install them',
  );
});

test("refused: a server-rendered page, a game the kit made, a copy of one of the kit's starts", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const ssr = await adopt(await fixture(tmp, 'ssr-only'));
  assert.ok(ssr.refused.length > 0);
  assert.equal(existsSync(path.join(tmp.dir, 'ssr-only', 'gamesfun.json')), false);
  const made = await fixture(tmp, 'static');
  await writeFile(path.join(made, 'gf-three.json'), '{}');
  assert.match((await adopt(made)).refused[0].what, /already a kit game/);
  const r = run(['adopt', made]);
  assert.equal(r.status, 1);
});

test('the code naming a site backend.json does not list is worth a look', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const r = await adopt(await fixture(tmp, 'undeclared'));
  assert.match(JSON.stringify(r.warn), /api\.scoreboard-example\.net/);
});

test('a Node server that hands out a static folder: the folder is the page, the server stays a backend', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = path.join(tmp.dir, 'party');
  await cp(path.join(FIXTURES, 'static'), path.join(dir, 'public'), { recursive: true });
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'party',
      scripts: { start: 'node server.js' },
      dependencies: { express: '5', 'socket.io': '4' },
    }),
  );
  await writeFile(path.join(dir, 'server.js'), "require('express')().use(require('express').static('public'));\n");
  // the page loads the client the Socket.IO server hands out
  const html = path.join(dir, 'public', 'index.html');
  await writeFile(
    html,
    (await readFile(html, 'utf8')).replace('</head>', '<script src="/socket.io/socket.io.js"></script></head>'),
  );
  const r = await adopt(dir);
  assert.deepEqual(r.refused, []);
  assert.equal(r.page.out, 'public');
  assert.match(reportLines(r).join('\n'), /plain static files \(its express, socket\.io server is not published\)/);
  assert.ok(
    r.warn.some(
      w =>
        /its server .* is not published/.test(w.what) &&
        /backend use custom/.test(w.fix) &&
        /into server\//.test(w.fix),
    ),
    'both ways: server/ on xgames.fun, or its own host',
  );
  // ported: the game has server/ now, and the Node server is said to be left behind, not to be kept
  await mkdir(path.join(dir, 'server'), { recursive: true });
  await writeFile(path.join(dir, 'server', 'index.js'), 'export default { fetch() { return new Response("ok"); } };');
  const ported = await adopt(dir);
  assert.match(reportLines(ported).join('\n'), /server is not published; its server\/ is\)/);
  assert.ok(ported.warn.some(w => /its server\/ is, and xgames\.fun runs that/.test(w.what)));
  const socket = r.fix.find(f => /socket\.io\.js/.test(f.what));
  assert.match(
    socket.what,
    /^public\/index\.html:\d+ loads \/socket\.io\/socket\.io\.js, which your Socket\.IO server serves/,
  );
  assert.match(socket.fix, /copy the client/);
  // the command a fix names carries the game's folder: run from elsewhere, backend.json still lands in the game
  const folder = typedPath(shown(dir));
  for (const f of [socket.fix, r.warn.find(w => /is not published/.test(w.what)).fix])
    assert.ok(f.includes(` backend use custom ${folder} --url https://<your server>`), f);
});

test('scripts from other sites are found in import maps and module imports, and not repeated as sites to declare', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  const html = path.join(dir, 'index.html');
  await writeFile(
    html,
    (await readFile(html, 'utf8')).replace(
      '</head>',
      '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
        '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">\n' +
        '<script type="importmap">{"imports": {"three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js"}}</script>\n' +
        '<script type="module">import confetti from "https://esm.sh/canvas-confetti@1";</script></head>',
    ),
  );
  const r = await adopt(dir);
  const fix = r.fix.map(f => f.what).join('\n');
  assert.match(fix, /index\.html:\d+ has an import map that loads modules from https:\/\/cdn\.jsdelivr\.net/);
  assert.match(fix, /index\.html:\d+ imports a module from https:\/\/esm\.sh/);
  assert.match(fix, /loads web fonts from https:\/\/fonts\.googleapis\.com/);
  assert.match(r.fix.find(f => /web fonts/.test(f.what)).fix, /@font-face[\s\S]*OFL/);
  // hosts already in the fix list are not also "sites the code names" to declare as a backend
  const named = r.warn.find(w => /other site/.test(w.what))?.what ?? '';
  for (const host of ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'esm.sh'])
    assert.ok(!named.includes(host), `${host} is not a site to declare`);
});

test('adopting again keeps what the last adopt recorded: a build that writes index.html into the project itself', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = path.join(tmp.dir, 'rooted');
  await cp(path.join(FIXTURES, 'static'), path.join(dir, 'src'), { recursive: true });
  await writeFile(
    path.join(dir, 'build.mjs'),
    "import { copyFileSync } from 'node:fs';\nfor (const f of ['index.html', 'game.js', 'style.css', 'icon.svg']) copyFileSync(`src/${f}`, f);\n",
  );
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'rooted', scripts: { build: 'node build.mjs' } }),
  );
  await mkdir(path.join(dir, 'node_modules'));
  const first = await adopt(dir);
  assert.match(first.refused[0].fix, /--out \. when the build writes index\.html into the project folder itself/);
  const given = await adopt(dir, { out: '.' });
  assert.deepEqual(given.refused, []);
  assert.ok(given.warn.some(w => /the published folder is the whole project/.test(w.what)));
  const again = await adopt(dir);
  assert.deepEqual(again.refused, [], 'the recorded out is used');
  assert.ok(again.fromRecord);
  assert.match(reportLines(again).join('\n'), /as gamesfun\.json records it/);
  assert.ok(
    !again.warn.some(w => /package\.json/.test(w.what) && /other site/.test(w.what)),
    'package.json is no page',
  );
});

test('Angular: its output folder from angular.json, and <base href> is one finding with the router fix', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = path.join(tmp.dir, 'kart');
  await cp(path.join(FIXTURES, 'static'), path.join(dir, 'src'), { recursive: true });
  const html = path.join(dir, 'src', 'index.html');
  await writeFile(html, (await readFile(html, 'utf8')).replace('<head>', '<head><base href="/">'));
  await writeFile(
    path.join(dir, 'angular.json'),
    JSON.stringify({
      projects: {
        kart: { architect: { build: { builder: '@angular/build:application', options: { outputPath: 'dist/kart' } } } },
      },
    }),
  );
  // a stand-in for `ng build`: the application builder writes the page into dist/kart/browser
  await writeFile(
    path.join(dir, 'build.mjs'),
    "import { cpSync } from 'node:fs';\ncpSync('src', 'dist/kart/browser', { recursive: true });\n",
  );
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'kart', scripts: { build: 'node build.mjs' }, dependencies: { '@angular/core': '22' } }),
  );
  await mkdir(path.join(dir, 'node_modules'));
  const r = await adopt(dir);
  assert.deepEqual(r.refused, []);
  assert.equal(r.shape.framework, 'Angular');
  assert.equal(r.page.out, 'dist/kart/browser');
  const base = r.fix.filter(f => /<base href>|loads \/ from the root/.test(f.what));
  assert.equal(base.length, 1, 'one finding for <base href="/">');
  assert.match(base[0].fix, /withHashLocation\(\)/);
});

test('an unknown build whose page is a level or two down in dist/ is found', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = path.join(tmp.dir, 'deep');
  await cp(path.join(FIXTURES, 'static'), path.join(dir, 'src'), { recursive: true });
  await writeFile(
    path.join(dir, 'build.mjs'),
    "import { cpSync } from 'node:fs';\ncpSync('src', 'dist/game/browser', { recursive: true });\n",
  );
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'deep', scripts: { build: 'node build.mjs' } }),
  );
  await mkdir(path.join(dir, 'node_modules'));
  const r = await adopt(dir);
  assert.deepEqual(r.refused, []);
  assert.equal(r.page.out, 'dist/game/browser');
});

test('a page that calls its own api/ with no server/ is a fix, naming the program beside it; script root paths too', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = path.join(tmp.dir, 'ashes');
  await cp(path.join(FIXTURES, 'static'), path.join(dir, 'web'), { recursive: true });
  await writeFile(path.join(dir, 'run.py'), 'import http.server\n');
  await writeFile(
    path.join(dir, 'web', 'api.js'),
    "const call = (method, url) => fetch(url, { method });\nexport const state = () => call('GET', '/api/state');\nconst img = new Image();\nimg.src = '/assets/hero.png';\nnavigator.mediaDevices.getUserMedia({ audio: true });\n",
  );
  const html = path.join(dir, 'web', 'index.html');
  await writeFile(
    html,
    (await readFile(html, 'utf8')).replace(
      '</head>',
      '<script type="importmap">{"imports": {"three": "/vendor/three.module.js"}}</script></head>',
    ),
  );
  const r = await adopt(dir);
  const fix = r.fix.map(f => f.what).join('\n');
  assert.match(
    fix,
    /the page calls api\/ on its own origin \(web\/api\.js:2\), and the game has no server\/; the folder has a Python program \(run\.py\)/,
  );
  assert.match(
    r.fix.find(f => /calls api\//.test(f.what)).fix,
    /server\/[\s\S]*backend use custom[\s\S]*WebAssembly[\s\S]*Ask the person/,
  );
  assert.match(fix, /web\/api\.js:4 loads \/assets\/hero\.png from the root, in a script/);
  assert.match(fix, /web\/index\.html:\d+ has an import map entry \/vendor\/three\.module\.js from the root/);
  assert.match(r.warn.map(w => w.what).join('\n'), /it asks for the camera or microphone \(web\/api\.js:5\)/);
});

test('SvelteKit 3: its adapter in vite.config is read (no svelte.config any more)', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = path.join(tmp.dir, 'kit3');
  await cp(path.join(FIXTURES, 'static'), path.join(dir, 'src-page'), { recursive: true });
  await writeFile(
    path.join(dir, 'vite.config.js'),
    "import { sveltekit } from '@sveltejs/kit/vite';\nimport adapter from '@sveltejs/adapter-static';\nexport default { plugins: [sveltekit({ adapter: adapter({ pages: 'site' }) })] };\n",
  );
  await writeFile(
    path.join(dir, 'build.mjs'),
    "import { cpSync } from 'node:fs';\ncpSync('src-page', 'site', { recursive: true });\n",
  );
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'kit3',
      scripts: { build: 'node build.mjs' },
      devDependencies: { '@sveltejs/kit': '3.1.1', '@sveltejs/adapter-static': '4' },
    }),
  );
  await mkdir(path.join(dir, 'node_modules'));
  const r = await adopt(dir);
  assert.deepEqual(r.refused, []);
  assert.equal(r.shape.framework, 'SvelteKit (static adapter)');
  assert.equal(r.page.out, 'site');
});

test('a page written as name.html and linked without .html is a fix; linked with .html it is not', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await writeFile(path.join(dir, 'play.html'), '<!doctype html><title>Play</title><a href="./">back</a>');
  await writeFile(path.join(dir, 'about.html'), '<!doctype html><title>About</title>');
  const html = path.join(dir, 'index.html');
  await writeFile(
    html,
    (await readFile(html, 'utf8')).replace(
      '</body>',
      '<a href="./play">Play</a> <a href="about.html">About</a></body>',
    ),
  );
  const r = await adopt(dir);
  const fixes = r.fix.map(f => f.what).join('\n');
  assert.match(fixes, /play\.html is a page of its own, and index\.html:\d+ links to it without \.html/);
  assert.doesNotMatch(fixes, /about\.html/);
  assert.match(r.fix.find(f => /play\.html/.test(f.what)).fix, /trailingSlash = 'always'/);
});

test('a router that reads the path, in the source, is worth a look with the hash-router fix', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await mkdir(path.join(dir, 'src'));
  await writeFile(
    path.join(dir, 'src', 'router.js'),
    "import { createRouter, createWebHistory } from 'vue-router';\nexport default createRouter({ history: createWebHistory(), routes: [] });\n",
  );
  const r = await adopt(dir);
  const w = r.warn.find(x => /routes by path/.test(x.what));
  assert.match(w.what, /src\/router\.js:2 routes by path \(Vue Router createWebHistory\)/);
  assert.match(w.fix, /createWebHashHistory\(\)/);
  await writeFile(
    path.join(dir, 'src', 'router.js'),
    "import { createRouter, createWebHashHistory } from 'vue-router';\nexport default createRouter({ history: createWebHashHistory(), routes: [] });\n",
  );
  assert.ok(!(await adopt(dir)).warn.some(x => /routes by path/.test(x.what)), 'a hash router is fine');
});

test("workers from the root, SharedArrayBuffer, no tab icon; xcore's own .gamesfun/ is no hidden file; exit 1 while there is a fix", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await writeFile(
    path.join(dir, 'sim.js'),
    "const w = new Worker('/sim-worker.js');\nconst shared = new SharedArrayBuffer(1024);\n",
  );
  const html = path.join(dir, 'index.html');
  await writeFile(
    html,
    (await readFile(html, 'utf8'))
      .replace(/<link[^>]*rel="icon"[^>]*>/i, '')
      .replace('</body>', '<script src="sim.js"></script></body>'),
  );
  await mkdir(path.join(dir, '.gamesfun'));
  await writeFile(path.join(dir, '.gamesfun', 'gate.json'), '{}');
  const r = await adopt(dir);
  assert.match(r.fix.map(f => f.what).join('\n'), /sim\.js:1 loads \/sim-worker\.js from the root, in a script/);
  const warns = r.warn.map(w => w.what).join('\n');
  assert.match(
    warns,
    /sim\.js:2 uses SharedArrayBuffer or Atomics\.wait: an xgames\.fun page is not cross-origin isolated/,
  );
  assert.match(warns, /index\.html names no tab icon/);
  assert.doesNotMatch(warns, /hidden files never go up: \.gamesfun/);
  assert.equal(run(['adopt', dir]).status, 1, 'a fix is left');
});

test('a workspace package: its packages installed at the repo root (npm and Yarn workspaces) count as installed', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const repo = path.join(tmp.dir, 'repo');
  const dir = path.join(repo, 'packages', 'game');
  await cp(path.join(FIXTURES, 'static'), path.join(dir, 'src'), { recursive: true });
  await writeFile(
    path.join(dir, 'build.mjs'),
    "import { cpSync } from 'node:fs';\ncpSync('src', 'dist', { recursive: true });\n",
  );
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'game', scripts: { build: 'node build.mjs' } }),
  );
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'] }));
  const refused = await adopt(dir);
  assert.match(
    refused.refused[0]?.what ?? '',
    /packages are not installed/,
    'no node_modules anywhere: still asked to install',
  );
  await mkdir(path.join(repo, 'node_modules')); // hoisted to the root, as npm workspaces do
  const r = await adopt(dir);
  assert.deepEqual(r.refused, []);
  assert.equal(r.page.out, 'dist');
});

test("a monorepo's root build: the output is found in the workspace it built (npm workspaces, pnpm-workspace.yaml)", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  for (const [name, setup] of [
    ['npm', { workspaces: ['packages/*'] }],
    ['pnpm', { packageManager: 'pnpm@9.15.0' }],
  ]) {
    const repo = path.join(tmp.dir, name);
    const game = path.join(repo, 'packages', 'game');
    await cp(path.join(FIXTURES, 'static'), path.join(game, 'src'), { recursive: true });
    await mkdir(path.join(repo, 'packages', 'engine', 'dist'), { recursive: true });
    await writeFile(path.join(repo, 'packages', 'engine', 'dist', 'index.js'), 'export {};\n'); // a library: no page
    await writeFile(
      path.join(repo, 'build.mjs'),
      "import { cpSync } from 'node:fs';\ncpSync('packages/game/src', 'packages/game/dist', { recursive: true });\n",
    );
    await writeFile(
      path.join(repo, 'package.json'),
      JSON.stringify({ private: true, ...setup, scripts: { build: 'node build.mjs' } }),
    );
    if (name === 'pnpm') await writeFile(path.join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    await mkdir(path.join(repo, 'node_modules'));
    assert.equal(packageManager(repo), name);
    const r = await adopt(repo, { build: 'node build.mjs' });
    assert.deepEqual(r.refused, [], name);
    assert.equal(r.page.out, 'packages/game/dist', name);
  }
});

test('a failed build is reported by what went wrong, not by its last stack lines', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await writeFile(
    path.join(dir, 'build.mjs'),
    [
      "console.log('building…');",
      "console.error(' ERROR  Build failed with 1 error:');",
      'console.error("[UNRESOLVED_IMPORT] Could not resolve \'./moth.png\' in app/app.vue");',
      ...Array.from({ length: 40 }, (_, i) => `console.error('    at frame${i} (node_modules/x/index.mjs:${i}:1)');`),
      "console.error('npm error Lifecycle script `build` failed with error:');",
      'process.exit(1);',
    ].join('\n'),
  );
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'node build.mjs' } }));
  await mkdir(path.join(dir, 'node_modules'));
  const r = await adopt(dir, { build: 'node build.mjs', out: 'dist' });
  assert.match(r.refused[0].what, /failed with exit code 1/);
  assert.match(
    r.refused[0].fix,
    /it said: \[UNRESOLVED_IMPORT\] Could not resolve '\.\/moth\.png' in app\/app\.vue\)$/,
  );
  assert.doesNotMatch(r.refused[0].fix, /at frame|npm error/);
});

test('Nuxt pages route by path unless nuxt.config turns on hashMode', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await mkdir(path.join(dir, 'app', 'pages'), { recursive: true });
  await writeFile(path.join(dir, 'app', 'pages', 'index.vue'), '<template><main/></template>\n');
  await writeFile(
    path.join(dir, 'nuxt.config.ts'),
    "export default defineNuxtConfig({ ssr: false, app: { cdnURL: './' } })\n",
  );
  const w = (await adopt(dir, { out: '.' })).warn.find(x => /routes by path/.test(x.what));
  assert.match(w?.what ?? '', /nuxt\.config routes by path \(Nuxt pages, without hashMode\)/);
  assert.match(w.fix, /Nuxt router: \{ options: \{ hashMode: true \} \}/);
  await writeFile(
    path.join(dir, 'nuxt.config.ts'),
    'export default defineNuxtConfig({ ssr: false, router: { options: { hashMode: true } } })\n',
  );
  assert.ok(!(await adopt(dir, { out: '.' })).warn.some(x => /routes by path/.test(x.what)));
});

test('a URL parser\'s base ("http://localhost") is no address on this machine; a dev server\'s is', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  const html = path.join(dir, 'index.html');
  await writeFile(html, (await readFile(html, 'utf8')).replace('</body>', '<script src="router.js"></script></body>'));
  await writeFile(
    path.join(dir, 'router.js'),
    'let n="http://localhost";var T=new URL("http://localhost");const u=new URL(p,\'http://localhost/\');\n',
  );
  assert.ok(!(await adopt(dir)).fix.some(f => /on this machine/.test(f.what)));
  await writeFile(path.join(dir, 'router.js'), 'fetch("http://localhost:3000/api/scores");\n');
  assert.match(
    (await adopt(dir)).fix.map(f => f.what).join('\n'),
    /router\.js:1 names http:\/\/localhost:3000, on this machine/,
  );
});

test("React Router's framework mode is worth a look: no hash routing, and under a folder React stops", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await writeFile(path.join(dir, 'react-router.config.ts'), 'export default { ssr: false };\n');
  const w = (await adopt(dir, { out: '.' })).warn.find(x => /routes by path/.test(x.what));
  assert.match(w?.what ?? '', /react-router\.config routes by path \(React Router's framework mode\)/);
  assert.match(w.fix, /error #418[\s\S]*createHashRouter/);
});

test('one setting, one line: the long root-path advice once, a tab icon from the root once for every page', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  const page = n =>
    `<!doctype html><title>p${n}</title><link rel="icon" href="/moth.png"><script src="/a${n}.js"></script><script src="/b${n}.js"></script>`;
  await writeFile(path.join(dir, 'index.html'), page(0));
  for (const n of [1, 2]) {
    await mkdir(path.join(dir, `p${n}`));
    await writeFile(path.join(dir, `p${n}`, 'index.html'), page(n));
  }
  const r = await adopt(dir);
  const icons = r.warn.filter(w => /tab icon \/moth\.png/.test(w.what));
  assert.equal(icons.length, 1);
  assert.match(icons[0].what, /\(and 2 more pages\)$/);
  assert.ok(!('icon' in icons[0]), 'no working fields in the report');
  const roots = r.fix.filter(f => / loads \/\S+ from the root$/.test(f.what));
  assert.equal(roots.length, 3);
  assert.equal(roots.filter(f => /Vite: base/.test(f.fix)).length, 1, 'the list of settings is given once');
  assert.match(r.fix.at(-1).what, /^3 more paths from the root$/);
});

test('adopt with no folder reads the one it runs in, as check and publish do', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  const r = run(['adopt', '--json'], { cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).page.out, '.');
  assert.ok(existsSync(path.join(dir, 'gamesfun.json')));
});

test('paths from the root in every way a page loads a file: srcset, poster, styles, Audio, setAttribute, engine loaders', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  const cases = [
    ['<img srcset="img/a.png 1x, /img/a2.png 2x">', '/img/a2.png from the root (srcset)'],
    ['<video poster="/img/poster.png"></video>', 'loads /img/poster.png from the root'],
    ['<div style="background:url(/img/bg.png)"></div>', 'uses /img/bg.png from the root, in a style'],
    ['<script>new Audio("/snd/hit.ogg")</script>', 'loads /snd/hit.ogg from the root, in a script'],
    ["<script>el.setAttribute('src', '/img/x.png')</script>", 'loads /img/x.png from the root, in a script'],
    ["<script>this.load.image('sky', '/assets/sky.png')</script>", 'loads /assets/sky.png from the root, in a script'],
    ["<script>new GLTFLoader().load('/models/ship.glb', s => {})</script>", 'loads /models/ship.glb from the root'],
    ["<script>await PIXI.Assets.load('/sprites/hero.json')</script>", 'loads /sprites/hero.json from the root'],
    ['<object data="movie.swf" type="application/x-shockwave-flash"></object>', 'has an <object> or <embed>'],
  ];
  for (const [html, what] of cases) {
    await writeFile(
      path.join(dir, 'index.html'),
      `<!doctype html><title>t</title><link rel="icon" href="icon.png">\n${html}\n`,
    );
    const found = (await adopt(dir)).fix.map(f => f.what).join('\n');
    assert.ok(found.includes(what), `${html}\n→ ${found}`);
  }
  // relative ones, JSDoc's Array<Object>, and one path written twice on a line are not findings (or one)
  await writeFile(
    path.join(dir, 'index.html'),
    '<!doctype html><title>t</title><link rel="icon" href="icon.png">\n<img srcset="img/a.png 1x, img/a2.png 2x"><script>/** @type {Array<Object>} */ this.load.image("sky", "assets/sky.png"); new Audio("/s.ogg"); new Audio("/s.ogg")</script>\n',
  );
  assert.deepEqual(
    (await adopt(dir)).fix.map(f => f.what),
    ['index.html:2 loads /s.ogg from the root, in a script'],
  );
});

test('engine exports that cannot start on xgames.fun are fixes: a Unity build compressed for Content-Encoding, a threaded Godot export', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const page = (extra = '') =>
    `<!doctype html><html><head><title>Export</title><link rel="icon" href="./icon.png"></head><body><canvas></canvas>${extra}</body></html>`;

  const unity = path.join(tmp.dir, 'unity');
  await mkdir(path.join(unity, 'Build'), { recursive: true });
  await writeFile(path.join(unity, 'index.html'), page('<script src="Build/web.loader.js"></script>'));
  await writeFile(path.join(unity, 'icon.png'), '');
  await writeFile(path.join(unity, 'Build', 'web.loader.js'), 'var createUnityInstance = () => {};\n');
  for (const f of ['web.framework.js.br', 'web.wasm.br', 'web.data.br'])
    await writeFile(path.join(unity, 'Build', f), 'x');
  const u = await adopt(unity);
  const packed = u.fix.find(f => /a Unity build compressed/.test(f.what));
  assert.ok(packed, JSON.stringify(u.fix));
  assert.match(packed.what, /Build\/web\.(framework\.js|wasm|data)\.br and 2 more/);
  assert.match(packed.fix, /Compression Format Disabled.*Decompression Fallback/);
  assert.ok(
    !u.warn.some(w => /type the host does not know/.test(w.what)),
    'not also listed as files of an unknown type',
  );

  // the same build with Decompression Fallback (.unityweb) unpacks itself: no fix
  const fallback = path.join(tmp.dir, 'unity-fallback');
  await mkdir(path.join(fallback, 'Build'), { recursive: true });
  await writeFile(path.join(fallback, 'index.html'), page());
  await writeFile(path.join(fallback, 'icon.png'), '');
  await writeFile(path.join(fallback, 'Build', 'web.wasm.unityweb'), 'x');
  assert.ok(!(await adopt(fallback)).fix.some(f => /Unity/.test(f.what)));

  for (const [threads, expectFix] of [
    ['true', true],
    ['false', false],
  ]) {
    const godot = path.join(tmp.dir, `godot-${threads}`);
    await mkdir(godot);
    await writeFile(path.join(godot, 'icon.png'), '');
    await writeFile(
      path.join(godot, 'index.html'),
      page(`<script>const GODOT_CONFIG = {}; const GODOT_THREADS_ENABLED = ${threads};</script>`),
    );
    const g = await adopt(godot);
    assert.equal(
      g.fix.some(f => /Godot export built with Thread Support/.test(f.what) && /Thread Support off/.test(f.fix)),
      expectFix,
      `${threads}: ${JSON.stringify(g.fix)}`,
    );
  }
});

test("an engine's project is read as one: its web export is the page, or adopt says how to make it", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const page = (extra = '') =>
    `<!doctype html><html><head><title>Export</title><link rel="icon" href="./icon.png"></head><body><canvas></canvas>${extra}</body></html>`;
  // a Unity project with its template's index.html at the top and no build in it
  const unity = path.join(tmp.dir, 'unity');
  await mkdir(path.join(unity, 'ProjectSettings'), { recursive: true });
  await mkdir(path.join(unity, 'Assets'));
  await writeFile(path.join(unity, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.1f1\n');
  await writeFile(path.join(unity, 'index.html'), page('<script src="Build/web.loader.js"></script>'));
  const u = await adopt(unity);
  assert.match(u.refused[0]?.what ?? '', /a Unity project with no web export/, JSON.stringify(u));
  assert.match(u.refused[0].fix, /File → Build Settings → WebGL/);
  // its build in Builds/WebGL is found
  const build = path.join(unity, 'Builds', 'WebGL');
  await mkdir(path.join(build, 'Build'), { recursive: true });
  await writeFile(path.join(build, 'index.html'), page('<script src="Build/web.loader.js"></script>'));
  await writeFile(path.join(build, 'icon.png'), '');
  await writeFile(path.join(build, 'Build', 'web.loader.js'), 'var createUnityInstance = () => {};\n');
  await writeFile(path.join(build, 'Build', 'web.data'), 'x');
  // an earlier build's compressed copies beside the files: worth a look, not a fix
  await writeFile(path.join(build, 'Build', 'web.data.gz'), 'x');
  const b = await adopt(unity);
  assert.equal(b.page.out, 'Builds/WebGL');
  assert.ok(!b.fix.some(f => /Unity build compressed/.test(f.what)), JSON.stringify(b.fix));
  assert.ok(b.warn.some(w => /compressed copies/.test(w.what)));
  assert.ok(!b.warn.some(w => /type the host does not know/.test(w.what)), 'a Unity build’s .data needs no type');
  assert.match(reportLines(b).join('\n'), /a Unity project \(its web export, Builds\/WebGL/);

  // a Godot project: its Web preset's export path; no export there yet is said
  const godot = path.join(tmp.dir, 'godot');
  await mkdir(godot);
  await writeFile(path.join(godot, 'project.godot'), 'config_version=5\n');
  await writeFile(
    path.join(godot, 'export_presets.cfg'),
    '[preset.0]\n\nname="Web"\nplatform="Web"\nexport_path="out/html/index.html"\n',
  );
  assert.match((await adopt(godot)).refused[0]?.fix ?? '', /Project → Export/);
  await mkdir(path.join(godot, 'out', 'html'), { recursive: true });
  await writeFile(path.join(godot, 'out', 'html', 'index.html'), page('<script src="index.js"></script>'));
  for (const f of ['index.js', 'index.pck', 'icon.png', 'index.icon.png.import'])
    await writeFile(path.join(godot, 'out', 'html', f), 'x');
  const g = await adopt(godot);
  assert.equal(g.page.out, 'out/html');
  assert.ok(
    g.warn.some(w => /\.gdignore/.test(w.fix)),
    JSON.stringify(g.warn),
  );

  // a page that loads a file its folder lacks
  const lacking = path.join(tmp.dir, 'lacking');
  await mkdir(lacking);
  await writeFile(path.join(lacking, 'icon.png'), '');
  await writeFile(path.join(lacking, 'index.html'), page('<script src="./dist/game.js"></script>'));
  assert.ok((await adopt(lacking)).fix.some(f => /loads dist\/game\.js, which is not in the folder/.test(f.what)));
});

test("xcore's own sign-in client naming the host's api/ paths is not the page calling its own api/", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = path.join(tmp.dir, 'pop');
  await cp(path.join(FIXTURES, 'static'), dir, { recursive: true });
  await cp(new URL('../lib/client/gamesfun.js', import.meta.url), path.join(dir, 'gamesfun.js'));
  const r = await adopt(dir);
  assert.equal(r.fix.filter(f => /calls api\//.test(f.what)).length, 0, r.fix.map(f => f.what).join('\n'));
});
