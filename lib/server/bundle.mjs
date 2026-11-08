// A game's server/ as one file (gf-server-v1, ./contract.mjs): esbuild bundles the entry and everything it imports
// into one ES module, and the same checks run for the kit's dev server, `xcore publish --check` and the publish itself:
//   - it builds (an import that does not resolve, a syntax error: esbuild's own words, with the file and line);
//   - every file it reads is inside the game folder (a game's own node_modules counts), never the kit or the machine;
//   - Node built-ins only with nodejs_compat on (gamesfun.json), as `node:<name>`, left for the runtime; those it does
//     not give a Worker (node:fs, child_process, vm, …: contract.mjs NODE_REFUSED) refuse it;
//   - no code made from text at run time: eval, new Function, a dynamic import() of anything but a literal path,
//     importScripts (a Worker refuses them anyway; here the person reads where);
//   - no secrets: the publish scan (../publish/scan.mjs) over each server file and over the bundle;
//   - a default export (the Worker), and each room class gamesfun.json declares exported by that name;
//   - the size: xgames.fun's cap (5 MB, the wasm included), with a word above 1 MB;
//   - a compiled WebAssembly file (`import wasm from '../vendor/x.wasm'`: a physics engine, a codec) is not bundled into
//     the JS: it goes up as its own module (a Worker compiles no wasm from bytes at run time, only a module shipped with
//     it), named by its file name (unique), and the bundle imports it as `./<name>.wasm` (contract §3: up to 16 modules).
// The esbuild options are the contract's (§3), minified as publish sends it: the same input gives xgames.fun's bytes.
// esbuild is this package's own dependency (package.json); without it the answer says why.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { scanFile } from '../publish/scan.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CMD } from '../command.mjs';
import { LIMITS, NODE_REFUSED, readServerConfig, BUNDLE_NAME } from './contract.mjs';

const NODE_BUILTINS = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'stream/web',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
]);
/** Code made from text at run time: [what, pattern]. Matched in each file the bundle reads. */
export const FORBIDDEN = [
  ['eval()', /(?<![.\w$])eval\s*\(/],
  ['new Function()', /\bnew\s+Function\s*\(/],
  ['a dynamic import() of a computed path', /(?<![.\w$])import\s*\(\s*(?!['"`]|\))/],
  // a string built at run time: import('./' + name), import(`./${name}`)
  ['a dynamic import() of a computed path', /(?<![.\w$])import\s*\(\s*(?:(['"])[^'"\n]*\1\s*\+|`[^`]*\$\{)/],
  ['importScripts()', /(?<![.\w$])importScripts\s*\(/],
];

const sha256 = b => createHash('sha256').update(b).digest('hex');
const lineAt = (text, i) => text.slice(0, i).split('\n').length;
/** Comments and strings blanked (same length), so a word in them is not code. */
function codeOnly(src) {
  // a string keeps its quotes (so `import('./x.js')` still reads as a literal path), its text becomes spaces
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, m =>
    m[0] === '/' ? m.replace(/[^\n]/g, ' ') : m[0] + ' '.repeat(m.length - 2) + m[0],
  );
}

let esbuildOnce = null;
/** esbuild, this package's dependency. Throws with words (code NO_ESBUILD) when it cannot be had. */
export async function loadEsbuild() {
  try {
    esbuildOnce ??= createRequire(import.meta.url)('esbuild');
    return esbuildOnce;
  } catch (e) {
    throw Object.assign(
      new Error(
        `Bundling server/ needs esbuild, which comes with this package, and it could not be loaded: ${String(e.message ?? e).split('\n')[0]}. Install the package again (npm i @xgamesfun/xcore).`,
      ),
      { code: 'NO_ESBUILD' },
    );
  }
}

/** esbuild's options for a game's server: the contract's (§3, as xgames.fun bundles it), so a bundle is the same bytes. */
export function buildOptions(entry, { minify = true, nodeCompat = false } = {}) {
  return {
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
    minify,
    conditions: ['workerd', 'worker', 'browser'],
    mainFields: ['module', 'main'],
    external: nodeCompat ? ['cloudflare:*', 'node:*'] : ['cloudflare:*'],
    metafile: true,
  };
}

/**
 * Bundle and check the game's server. → { has: false } for a game without one; else { has: true, ok, entry, objects,
 * compatibilityFlags, code (Uint8Array, when it built), sha256, bytes, exports, inputs: [path], sources: [{path, sha256,
 * bytes}] (the game's own server files), problems: [string], hits: [{path, line, kind}], warnings: [string] }.
 * `minify` (default true, as publish sends it); the kit's dev server runs it unminified, so an error names a readable line.
 */
export async function bundleServer(dir, { limits = LIMITS, minify = true } = {}) {
  const root = path.resolve(dir);
  const cfg = await readServerConfig(root);
  if (!cfg.has) return { has: false, problems: cfg.problems };
  const nodeCompat = cfg.compatibilityFlags.includes('nodejs_compat');
  const out = {
    has: true,
    ok: false,
    stock: cfg.stock,
    entry: cfg.entry,
    objects: cfg.objects,
    compatibilityFlags: cfg.compatibilityFlags,
    database: cfg.database,
    code: null,
    sha256: null,
    bytes: 0,
    exports: [],
    inputs: [],
    sources: [],
    problems: [...cfg.problems],
    hits: [],
    warnings: [...cfg.warnings],
  };
  if (out.problems.length) return out;
  const { build } = await loadEsbuild();
  if (cfg.stock) return bundleStock(build, out, { minify });
  const refusedImports = [];
  // compiled wasm: its own module, never inlined (the runtime can't compile wasm from bytes)
  const wasmFiles = new Map(); // name → absolute path
  const wasm = {
    name: 'gf-server-wasm',
    setup(b) {
      b.onResolve({ filter: /\.wasm$/ }, args => {
        const abs = path.resolve(args.resolveDir, args.path),
          name = path.basename(abs),
          where = path.relative(root, args.importer).replace(/\\/g, '/');
        if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*\.wasm$/.test(name)) {
          refusedImports.push(
            `${where} imports ${args.path}: a wasm file's name may hold only letters, digits, _ . and -`,
          );
          return { path: args.path, external: true };
        }
        if (wasmFiles.has(name) && wasmFiles.get(name) !== abs)
          refusedImports.push(
            `${where} imports ${args.path}, and another ${name} is imported too: two wasm files need different names`,
          );
        wasmFiles.set(name, abs);
        return { path: `./${name}`, external: true };
      });
    },
  };
  // Node's built-ins: only as nodejs_compat gives them (§3), named in words, never a bare name esbuild cannot find
  const guard = {
    name: 'gf-server-node',
    setup(b) {
      b.onResolve({ filter: /^node:|^[a-z_]+(\/[a-z_]+)?$/ }, args => {
        const bare = args.path.replace(/^node:/, '');
        if (!args.path.startsWith('node:') && !NODE_BUILTINS.has(bare)) return undefined; // a package of the game's own
        const where = path.relative(root, args.importer).replace(/\\/g, '/');
        if (!args.path.startsWith('node:'))
          refusedImports.push(
            `${where} imports "${args.path}": write "node:${bare}"${nodeCompat ? '' : ', and turn on nodejs_compat in gamesfun.json (server.compatibilityFlags: ["nodejs_compat"])'}`,
          );
        else if (!nodeCompat)
          refusedImports.push(
            `${where} imports ${args.path}: Node's built-ins need nodejs_compat (gamesfun.json server.compatibilityFlags: ["nodejs_compat"]); or use the Web APIs (fetch, crypto.subtle, URL, TextEncoder)`,
          );
        else if (NODE_REFUSED.includes(bare))
          refusedImports.push(
            `${where} imports ${args.path}: the hosted runtime (a Worker) does not have it. Keep data in env.GF (saves, scores) or a Durable Object's storage, and use the Web APIs (fetch, crypto.subtle, URL)`,
          );
        return { path: args.path.startsWith('node:') ? args.path : `node:${bare}`, external: true };
      });
    },
  };
  let result;
  try {
    result = await build({
      ...buildOptions(path.join(root, cfg.entry), { minify, nodeCompat }),
      absWorkingDir: root,
      plugins: [guard, wasm],
    });
  } catch (e) {
    for (const m of e.errors ?? [{ text: e.message }])
      out.problems.push(
        `server/ does not build: ${m.location ? `${m.location.file}:${m.location.line}: ` : ''}${m.text}`,
      );
    return out;
  }
  out.problems.push(...refusedImports);
  const inputs = Object.keys(result.metafile.inputs).filter(p => !/^(cloudflare|node):/.test(p));
  for (const p of inputs) {
    const abs = path.resolve(root, p);
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    // the game's own files, or a package from a node_modules folder (§3)
    if ((rel.startsWith('../') || path.isAbsolute(rel)) && !abs.split(path.sep).includes('node_modules')) {
      out.problems.push(
        `server/ reads ${p}, which is outside the game folder: a game's server is made of the game's own files and npm packages`,
      );
      continue;
    }
    out.inputs.push(rel);
  }
  if (out.inputs.length > limits.sourceFiles)
    out.problems.push(`server/ is made of ${out.inputs.length} files; at most ${limits.sourceFiles}`);
  for (const rel of out.inputs) {
    let bytes;
    try {
      bytes = await readFile(path.resolve(root, rel));
    } catch {
      continue;
    }
    if (rel.startsWith('server/')) out.sources.push({ path: rel, sha256: sha256(bytes), bytes: bytes.length });
    if (/\.(m?js|cjs|ts|mts|jsx|tsx)$/.test(rel)) {
      const src = codeOnly(bytes.toString('utf8'));
      for (const [what, re] of FORBIDDEN) {
        const m = re.exec(src);
        if (m)
          out.problems.push(
            `${rel}:${lineAt(src, m.index)} uses ${what}: a game's server may not run code made from text at run time (the hosted runtime refuses it too)`,
          );
      }
    }
    out.hits.push(...scanFile(rel, new Uint8Array(bytes)));
  }
  // the wasm modules: inside the game folder (or a node_modules folder), each one's bytes and hash
  out.wasm = [];
  for (const [name, abs] of wasmFiles) {
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    if ((rel.startsWith('../') || path.isAbsolute(rel)) && !abs.split(path.sep).includes('node_modules')) {
      out.problems.push(`server/ reads ${rel}, which is outside the game folder`);
      continue;
    }
    let bytes;
    try {
      bytes = await readFile(abs);
    } catch {
      out.problems.push(`server/ imports ${rel}, which is not there`);
      continue;
    }
    if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0x6d736100) {
      out.problems.push(`${rel} is not a compiled WebAssembly file`);
      continue;
    }
    out.inputs.push(rel);
    out.wasm.push({ name, path: rel, bytes: new Uint8Array(bytes), sha256: sha256(bytes), size: bytes.length });
  }
  if (1 + out.wasm.length > limits.modules)
    out.problems.push(
      `server/ makes ${1 + out.wasm.length} modules (the bundle and its wasm files); at most ${limits.modules}`,
    );
  out.sources.sort((a, b) => (a.path < b.path ? -1 : 1));
  const file = result.outputFiles[0];
  out.code = file.contents;
  out.bytes = file.contents.byteLength;
  out.sha256 = sha256(file.contents);
  const meta =
    Object.values(result.metafile.outputs).find(o => o.entryPoint) ?? Object.values(result.metafile.outputs)[0];
  out.exports = meta?.exports ?? [];
  const inBundle = scanFile(`server bundle (${BUNDLE_NAME})`, file.contents).filter(
    h => !out.hits.some(s => s.kind === h.kind),
  );
  out.hits.push(...inBundle);
  if (!out.exports.includes('default'))
    out.problems.push(`${cfg.entry} has no default export: export default { async fetch(request, env, ctx) { … } }`);
  for (const o of cfg.objects)
    if (!out.exports.includes(o.class))
      out.problems.push(
        `gamesfun.json declares the Durable Object ${o.class}, but ${cfg.entry} does not export a class by that name (export class ${o.class} extends DurableObject { … })`,
      );
  // a named export the runtime cannot take: workerd starts a module only when each export is a handler (a function, a
  // class, an object); a plain value (`export const SEASON = 5`) stops the server at its first request, where no check
  // here would see it. Read in an unminified pass, where each export's declaration is its own line.
  const others = out.exports.filter(n => n !== 'default' && !cfg.objects.some(o => o.class === n));
  if (others.length) {
    const plain = await plainExports(build, path.join(root, cfg.entry), root, nodeCompat).catch(() => []);
    for (const { name, value } of plain.filter(x => others.includes(x.name)))
      out.problems.push(
        `${cfg.entry} exports ${name} = ${value}: the hosted runtime takes only functions, classes and objects as a server's exports, and refuses to start a server with a plain value. Keep ${name} unexported (or in a module the server imports)`,
      );
  }
  const total = out.bytes + out.wasm.reduce((n, w) => n + w.size, 0);
  if (total > limits.bytes)
    out.problems.push(
      `The server bundle is ${(total / 1048576).toFixed(1)} MB${out.wasm.length ? ' with its wasm' : ''}; a game's server may be ${(limits.bytes / 1048576).toFixed(0)} MB`,
    );
  else if (out.bytes > limits.warnBytes)
    out.warnings.push(
      `The server bundle is ${(out.bytes / 1048576).toFixed(1)} MB: it works, but a smaller server starts faster`,
    );
  // the database a Durable Object holds (xcore add database before D1): it still works, and the new way is D1
  if (out.inputs.includes('server/database.js') && cfg.objects.some(o => o.class === 'GameData'))
    out.warnings.push(
      `server/database.js is the older database (a Durable Object, GameData). It keeps working; a new game's database is its own D1 (gamesfun.json → database: ${CMD} add database in a game without it, docs/SERVER.md "A database of its own")`,
    );
  out.ok = !out.problems.length && !out.hits.length;
  return out;
}

const STOCK = fileURLToPath(new URL('../client/server/stock.js', import.meta.url));

/**
 * The stock server (../client/server/stock.js) as the game's bundle: a game with a database and no server/ of its
 * own. Its settings (the binding's name and the collections' rules) go in as generated data, the module gf:stock.
 * Nothing of the game folder is read. → bundleServer's answer
 */
async function bundleStock(build, out, { minify }) {
  const settings = { binding: out.database.binding, rules: out.database.collections };
  const generated = {
    name: 'gf-stock',
    setup(b) {
      b.onResolve({ filter: /^gf:stock$/ }, () => ({ path: 'gf:stock', namespace: 'gf-stock' }));
      b.onLoad({ filter: /.*/, namespace: 'gf-stock' }, () => ({
        contents: `export default ${JSON.stringify(settings)};`,
        loader: 'js',
      }));
    },
  };
  let result;
  try {
    result = await build({
      ...buildOptions(STOCK, { minify }),
      absWorkingDir: path.dirname(STOCK),
      plugins: [generated],
    });
  } catch (e) {
    for (const m of e.errors ?? [{ text: e.message }]) out.problems.push(`the stock server does not build: ${m.text}`);
    return out;
  }
  const file = result.outputFiles[0];
  out.code = file.contents;
  out.bytes = file.contents.byteLength;
  out.sha256 = sha256(file.contents);
  out.wasm = [];
  const meta =
    Object.values(result.metafile.outputs).find(o => o.entryPoint) ?? Object.values(result.metafile.outputs)[0];
  out.exports = meta?.exports ?? [];
  out.hits.push(...scanFile(`server bundle (${BUNDLE_NAME})`, file.contents));
  out.ok = !out.problems.length && !out.hits.length;
  return out;
}

/** A primitive's first token in esbuild's unminified output: a number, a string, a template, true/false/null/undefined. */
const PRIMITIVE = /^(?:-?\d|-?\.\d|["'`]|(?:true|false|null|undefined|void\b)(?![\w$]))/;

/**
 * The entry's named exports bound to a plain value, from an unminified bundle (packages left out): [{name, value}].
 * esbuild ends the module with `export { local as Name, … }` and declares each top-level binding on a line of its own.
 */
export async function plainExports(build, entry, root, nodeCompat = false) {
  const r = await build({
    ...buildOptions(entry, { minify: false, nodeCompat }),
    absWorkingDir: root,
    metafile: false,
    packages: 'external',
    external: ['cloudflare:*', 'node:*', '*.wasm'],
  });
  const code = r.outputFiles[0].text;
  const tail = /export\s*\{([^}]*)\};?\s*$/.exec(code);
  if (!tail) return [];
  const found = [];
  for (const part of tail[1].split(',')) {
    const [local, name = local] = part
      .trim()
      .split(/\s+as\s+/)
      .map(x => x.trim());
    if (!local || name === 'default') continue;
    const decl = new RegExp(`^(?:var|let|const) ${local.replace(/[$]/g, '\\$')} = (.*)$`, 'm').exec(code);
    if (decl && PRIMITIVE.test(decl[1])) found.push({ name, value: decl[1].replace(/;$/, '').slice(0, 40) });
  }
  return found;
}
