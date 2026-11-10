// A game's own server code (lib/server/): what gamesfun.json → server may say, and what the bundle may not do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readServerConfig } from '../lib/server/contract.mjs';
import { bundleServer } from '../lib/server/bundle.mjs';
import { tempDir } from './helpers.mjs';

async function game(tmp, code, server = { main: 'server/index.js' }) {
  const dir = path.join(tmp.dir, `g${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(path.join(dir, 'server'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>g</title>');
  await writeFile(path.join(dir, 'server', 'index.js'), code);
  await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify({ server }));
  return dir;
}
const OK = 'export default { fetch: () => Response.json({ ok: true }) };\n';

test('a key gamesfun.json → server does not know is refused (a typo once dropped the Durable Objects)', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const typo = await game(tmp, OK, { main: 'server/index.js', object: [{ class: 'Pond', binding: 'POND' }] });
  const r = await readServerConfig(typo);
  assert.ok(
    r.problems.some(p =>
      /server has "object", which it does not know \(it takes main, objects, routes, compatibilityFlags\)/.test(p),
    ),
    r.problems.join('\n'),
  );
  const good = await game(tmp, OK, { main: 'server/index.js', objects: [], routes: '/api/*', compatibilityFlags: [] });
  assert.deepEqual((await readServerConfig(good)).problems, []);
});

test('nodejs_compat is not offered: gamesfun.json that asks for it is refused, in words, before anything is bundled', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp, OK, { main: 'server/index.js', compatibilityFlags: ['nodejs_compat'] });
  const r = await readServerConfig(dir);
  assert.ok(
    r.problems.some(p => /"nodejs_compat"/.test(p) && /does not offer/.test(p) && /Web APIs/.test(p)),
    r.problems.join('\n'),
  );
  assert.deepEqual(r.compatibilityFlags, []);
  const b = await bundleServer(dir);
  assert.equal(b.ok, false);
  assert.ok(b.problems.some(p => /nodejs_compat/.test(p)));
  // an empty list is what every game has
  assert.deepEqual((await readServerConfig(await game(tmp, OK, { compatibilityFlags: [] }))).problems, []);
  // and a Node built-in is never offered as a fix any more
  const node = await bundleServer(
    await game(tmp, `import { createHash } from 'node:crypto';\nexport const h = () => createHash;\n${OK}`),
  );
  const said = node.problems.find(p => /node:crypto/.test(p));
  assert.ok(said && !/nodejs_compat/.test(said) && /crypto\.subtle/.test(said), JSON.stringify(node.problems));
});

// What the host refuses in a server bundle (docs/SERVER.md, "Not allowed"): an import, a re-export or an import() of a
// module that opens raw network connections or loads modules by name, and an import() of anything but a plain string.
const SOCKETS = [
  'cloudflare:sockets',
  'node:net',
  'node:tls',
  'node:dgram',
  'node:http2',
  'node:module',
  'node:child_process',
];
const REFUSED_CASES = [
  ["import { connect } from 'cloudflare:sockets';\nexport const c = () => connect;", 'imports cloudflare:sockets'],
  ["export * from 'cloudflare:sockets';", 'imports cloudflare:sockets'],
  ["export { connect } from 'cloudflare:sockets';", 'imports cloudflare:sockets'],
  ["export const c = () => import('cloudflare:sockets');", 'imports cloudflare:sockets'],
  ["export const c = () => import('cloudflare:sockets?raw');", 'imports cloudflare:sockets'],
  ...SOCKETS.slice(1).map(m => [`import * as x from '${m}';\nexport const c = () => x;`, `imports ${m}`]),
  ['export const z = p => import(p);', 'a module named at run time'],
  ['export const z = p => import(p.name, { with: { type: "json" } });', 'a module named at run time'],
  ['export const z = p => import((0, p));', 'a module named at run time'],
];
const ACCEPTED_CASES = [
  "import { DurableObject } from 'cloudflare:workers';\nexport class Room extends DurableObject {}",
  "export const z = () => import('./more.js');",
  // a path esbuild can list at bundle time is bundled, file by file: no import() is left for the host to refuse
  "export const z = p => import('./levels/' + p + '.js');",
  'export const z = p => import(`./levels/${p}.js`);',
  // words, never imports
  'const s = "import(\'cloudflare:sockets\')"; // import(p) and node:net\nexport const f = () => s;',
];
async function serverGame(tmp, code) {
  const dir = await game(tmp, `${code}\n${OK}`);
  await writeFile(path.join(dir, 'server', 'more.js'), 'export const x = 1;\n');
  await mkdir(path.join(dir, 'server', 'levels'), { recursive: true });
  await writeFile(path.join(dir, 'server', 'levels', 'forest.js'), 'export default { name: "forest" };\n');
  return dir;
}

test('the bundle is refused, in words naming the file, for what the host refuses: raw sockets and import() of a name made at run time', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  for (const [code, said] of REFUSED_CASES) {
    const r = await bundleServer(await serverGame(tmp, code));
    const hit = r.problems.find(p => p.includes(said));
    assert.ok(hit, `${code.split('\n')[0]}: ${JSON.stringify(r.problems)}`);
    assert.match(hit, /^server\/index\.js(:\d+)? /, hit);
    assert.match(hit, /xgames\.fun refuses/, hit);
    assert.ok(!/nodejs_compat/.test(hit), hit);
    assert.equal(r.ok, false);
  }
  for (const code of ACCEPTED_CASES) {
    const r = await bundleServer(await serverGame(tmp, code));
    assert.deepEqual(r.problems, [], code);
  }
});

test('the same, from a package the server bundles: the package is named', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp, `import { dial } from 'dialer';\nexport const d = () => dial;\n${OK}`);
  const pkg = path.join(dir, 'node_modules', 'dialer');
  await mkdir(pkg, { recursive: true });
  await writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: 'dialer', main: 'index.js' }));
  await writeFile(
    path.join(pkg, 'index.js'),
    "import { connect } from 'cloudflare:sockets';\nexport const dial = (h, name) => [connect(h), import(name)];\n",
  );
  const r = await bundleServer(dir);
  assert.ok(
    r.problems.some(p => /^node_modules\/dialer\/index\.js imports cloudflare:sockets/.test(p)),
    JSON.stringify(r.problems),
  );
  assert.ok(
    r.problems.some(p => /^node_modules\/dialer\/index\.js:2 imports a module named at run time/.test(p)),
    JSON.stringify(r.problems),
  );
});

// The host parses the bundle it is sent; the kit reads the same bundle with esbuild. A parse of the kit's own output
// with another parser (acorn, which the dev tools carry) finds exactly what the kit refused, case by case.
test('what the kit refuses is what a parse of the bundle it sends finds', async t => {
  const acorn = await import('acorn').catch(() => null);
  if (!acorn) return t.skip('acorn is not installed (it comes with the dev tools)');
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const refused = new Set(SOCKETS.flatMap(m => (m.startsWith('node:') ? [m, m.slice(5)] : [m])));
  const hostWould = code => {
    const ast = acorn.parse(new TextDecoder().decode(code), { ecmaVersion: 'latest', sourceType: 'module' });
    const found = [];
    const visit = node => {
      if (!node || typeof node.type !== 'string') return;
      const mod = s =>
        refused.has(
          String(s)
            .replace(/[?#].*$/, '')
            .toLowerCase(),
        );
      if (/^(Import|ExportAll|ExportNamed)Declaration$/.test(node.type) && node.source && mod(node.source.value))
        found.push('module');
      if (node.type === 'ImportExpression') {
        if (node.source.type !== 'Literal' || typeof node.source.value !== 'string') found.push('computed');
        else if (mod(node.source.value)) found.push('module');
      }
      for (const v of Object.values(node))
        if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v === 'object') visit(v);
    };
    visit(ast);
    return found.length > 0;
  };
  for (const [code] of REFUSED_CASES.filter(([c]) => !/node:/.test(c))) {
    // the bundle as it would be sent, with the kit's refusal set aside: the host would refuse it too
    const r = await bundleServer(await serverGame(tmp, code), { minify: true });
    assert.ok(r.code, code);
    assert.ok(hostWould(r.code), code);
  }
  for (const code of ACCEPTED_CASES) {
    const r = await bundleServer(await serverGame(tmp, code));
    assert.ok(!hostWould(r.code), code);
  }
});

test('a named export the runtime cannot start with (a plain value) is refused; functions, classes and objects are not', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp, `export { RULES } from './rules.js';\nexport const SEASON = 5;\n${OK}`);
  await writeFile(path.join(dir, 'server', 'rules.js'), "export const RULES = 'x';\n");
  const r = await bundleServer(dir);
  assert.ok(
    r.problems.some(p => /exports SEASON = 5: the hosted runtime takes only functions, classes and objects/.test(p)),
    JSON.stringify(r.problems),
  );
  assert.ok(
    r.problems.some(p => /exports RULES = "x"/.test(p)),
    JSON.stringify(r.problems),
  );
  const fine = await bundleServer(
    await game(
      tmp,
      `export const helper = () => 1;\nexport function f() {}\nexport class K {}\nexport const TABLE = { a: 1 };\nexport const LIST = [1];\n${OK}`,
    ),
  );
  assert.deepEqual(fine.problems, []);
});

test("the platform's numbers by plan: Free's boards are 8 (16 rules), Creator's and Scale's 16 (32)", async () => {
  const contract = await import('../lib/server/contract.mjs');
  const plans = contract.PLAN_LIMITS ?? {};
  assert.deepEqual(Object.keys(plans), ['free', 'creator', 'scale']);
  assert.deepEqual(
    Object.values(plans).map(p => [p.scores.boards, p.scores.rules, p.scores.entriesPerBoard]),
    [
      [8, 16, 10_000],
      [16, 32, 1_000_000],
      [16, 32, 1_000_000],
    ],
  );
  assert.deepEqual(
    Object.values(plans).map(p => [p.saves.gameBytes, p.saves.writesPerMinute, p.reads.perMinute, p.cpuMs]),
    [
      [10 * 1048576, 600, 1_200, 50],
      [1024 * 1048576, 12_000, 12_000, 200],
      [10 * 1024 * 1048576, 60_000, 60_000, 1_000],
    ],
  );
  // what holds on every plan, and a game's own default (Free) where a single number is read
  assert.equal(contract.PLATFORM_LIMITS.scores.boards, 8);
  assert.equal(contract.PLATFORM_LIMITS.scores.rules, 16);
  assert.equal(contract.PLATFORM_LIMITS.saves.keysPerPlayer, 16);
});
