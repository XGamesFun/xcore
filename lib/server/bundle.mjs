// A game's server/ as one file (gf-server-v1, ./contract.mjs): esbuild bundles the entry and everything it imports
// into one ES module, and the same checks run for the kit's dev server, `xcore publish --check` and the publish itself:
//   - it builds (an import that does not resolve, a syntax error: esbuild's own words, with the file and line);
//   - every file it reads is inside the game folder (a game's own node_modules counts), never the kit or the machine;
//   - no Node built-ins (xgames.fun offers no nodejs_compat: contract.mjs ALLOWED_FLAGS), named in words;
//   - what xgames.fun refuses in a bundle: an import, a re-export or an import() of a module that opens raw sockets or
//     loads modules by name (contract.mjs SOCKET_MODULES), and an import() of anything but a plain string, which could
//     name any module at run time. The verdict is the bundle's, as xgames.fun reads the bundle it is sent: the bundle
//     the kit would send is read again by esbuild's own parser (bundleImports; never by searching its text), so code
//     esbuild leaves out (a package's export the game never uses) refuses nothing. Each refusal names the file that
//     has the import, as esbuild saw it while bundling;
//   - no code made from text at run time: eval, new Function, importScripts (a Worker refuses them anyway; here the
//     person reads where);
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
import { codeOnly, dataCallLine, ownerlessDataCalls } from './data-calls.mjs';
import {
  CONFIG_FILE,
  LIMITS,
  OLD_DEFAULT_RULES,
  OWNER_SPACES,
  readServerConfig,
  BUNDLE_NAME,
  socketModule,
  usesFiles,
} from './contract.mjs';

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
/**
 * Code made from text at run time: [what, pattern]. Matched in each file the bundle reads. (An import() of a name made
 * at run time is read by the parse instead: refusedImports below.)
 */
export const FORBIDDEN = [
  ['eval()', /(?<![.\w$])eval\s*\(/],
  ['new Function()', /\bnew\s+Function\s*\(/],
  ['importScripts()', /(?<![.\w$])importScripts\s*\(/],
];
/** esbuild's word for an import() it cannot bundle because its argument is not a plain string. */
const COMPUTED_IMPORT = 'unsupported-dynamic-import';
/** A string literal in printed code: "…" or '…' (never a template: the host's parse reads only these as plain). */
const STRING = /^\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')\s*,/;
const unquote = q => {
  try {
    return JSON.parse(q[0] === '"' ? q : `"${q.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`);
  } catch {
    return null;
  }
};
/**
 * An import() esbuild did not bundle (its warning, `w`), read at its place: → {module} when its first argument is a
 * plain string after all (an import() with a second argument esbuild does not take, such as `{}`), else {computed}.
 */
function unbundled(w) {
  const text = w.location?.lineText ?? '',
    col = w.location?.column ?? 0;
  const at = text.slice(col).startsWith('import') ? col : text.lastIndexOf('import', col);
  const m = at >= 0 ? /^import\s*\(/.exec(text.slice(at)) : null;
  const lit = m ? STRING.exec(text.slice(at + m[0].length)) : null;
  const value = lit ? unquote(lit[1]) : null;
  return typeof value === 'string' ? { module: value } : { computed: true };
}

/**
 * The imports a bundle (its bytes) still has, read by esbuild's parser as xgames.fun's parse reads them: → {modules:
 * Set of what is imported (statically, as a re-export or by import() of a plain string, as written), computed: the
 * number of import() calls of anything else}. null when it cannot be read (then nothing is taken off what the build saw).
 */
export async function bundleImports(build, code) {
  const modules = new Set();
  let computed = 0;
  try {
    const r = await build({
      stdin: { contents: new TextDecoder().decode(code), loader: 'js', sourcefile: BUNDLE_NAME },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'neutral',
      logLevel: 'silent',
      logOverride: { [COMPUTED_IMPORT]: 'warning' },
      plugins: [
        {
          name: 'gf-bundle-imports',
          setup(b) {
            b.onResolve({ filter: /.*/ }, a => {
              if (a.kind === 'import-statement' || a.kind === 'dynamic-import') modules.add(a.path);
              return { path: a.path, external: true };
            });
          },
        },
      ],
    });
    for (const w of r.warnings)
      if (w.id === COMPUTED_IMPORT) {
        const u = unbundled(w);
        if (u.computed) computed++;
        else modules.add(u.module);
      }
  } catch {
    return null;
  }
  return { modules, computed };
}
/** What xgames.fun refuses, said where it is: a socket module. */
const socketWords = (where, mod) =>
  `${where} imports ${mod}, which opens raw network connections or loads modules by name: xgames.fun refuses a server that can (a game's server reaches the network with fetch() only). Take out what needs it (a database driver, a mail or chat client) and call a service over fetch() instead`;
/** … and an import() of a name made at run time. */
const computedWords = where =>
  `${where} imports a module named at run time (import() of something other than a plain string): xgames.fun refuses it, since it could load any module. Import each module by its own name (import('./levels/forest.js')), or a path esbuild can list (import(\`./levels/\${name}.js\`) bundles every file there)`;

const sha256 = b => createHash('sha256').update(b).digest('hex');
const lineAt = (text, i) => text.slice(0, i).split('\n').length;
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
  const rel = p => path.relative(root, path.resolve(root, p)).replace(/\\/g, '/');
  // what the build saw import a socket module or a Node built-in, by module: [the words for each file that has it].
  // Only a module the bundle still imports refuses it (below): esbuild leaves out what nothing uses.
  const seen = new Map();
  const saw = (mod, line) => {
    const lines = seen.get(mod) ?? [];
    if (!lines.includes(line)) lines.push(line);
    seen.set(mod, lines);
  };
  const sockets = {
    name: 'gf-server-sockets',
    setup(b) {
      b.onResolve({ filter: /.*/ }, args => {
        if (args.kind !== 'import-statement' && args.kind !== 'dynamic-import') return undefined;
        const mod = socketModule(args.path);
        if (!mod) return undefined;
        saw(mod, socketWords(rel(args.importer), mod));
        return { path: args.path, external: true };
      });
    },
  };
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
  // Node's built-ins: a game's server has none (xgames.fun offers no nodejs_compat), named in words, never a bare name
  // esbuild cannot find
  const guard = {
    name: 'gf-server-node',
    setup(b) {
      b.onResolve({ filter: /^node:|^[a-z_]+(\/[a-z_]+)?$/ }, args => {
        const bare = args.path.replace(/^node:/, '');
        if (!args.path.startsWith('node:') && !NODE_BUILTINS.has(bare)) return undefined; // a package of the game's own
        saw(
          `node:${bare}`,
          `${rel(args.importer)} imports ${JSON.stringify(args.path)}, one of Node's built-in modules, which a game's server on xgames.fun does not have. Use the Web APIs a Worker has: fetch, crypto.subtle and crypto.getRandomValues, URL, TextEncoder and TextDecoder, Response; keep data in env.GF (saves, scores), a database or a Durable Object's storage`,
        );
        return { path: `node:${bare}`, external: true };
      });
    },
  };
  let result;
  try {
    result = await build({
      ...buildOptions(path.join(root, cfg.entry), { minify }),
      absWorkingDir: root,
      plugins: [sockets, guard, wasm],
      // an import() esbuild cannot bundle (its argument is not a plain string) stays in the bundle, where xgames.fun
      // refuses it: said as a warning with its file and line, in a package's code too
      logOverride: { [COMPUTED_IMPORT]: 'warning' },
    });
  } catch (e) {
    for (const m of e.errors ?? [{ text: e.message }])
      out.problems.push(
        `server/ does not build: ${m.location ? `${m.location.file}:${m.location.line}: ` : ''}${m.text}`,
      );
    return out;
  }
  // the bundle as it would be sent, read as xgames.fun reads it: only what it still imports is refused
  const kept = await bundleImports(build, result.outputFiles[0].contents);
  const keptMods = kept ? new Set([...kept.modules].map(m => socketModule(m) ?? m)) : null;
  // a plain-string import() esbuild did not take (a second argument it does not read) is an import of that module
  const computedAt = [];
  for (const w of result.warnings ?? [])
    if (w.id === COMPUTED_IMPORT) {
      const where = w.location ? `${rel(w.location.file)}:${w.location.line}` : 'server/';
      const u = unbundled(w);
      if (u.computed) computedAt.push(where);
      else if (socketModule(u.module)) saw(socketModule(u.module), socketWords(where, socketModule(u.module)));
    }
  for (const [mod, lines] of seen) if (!keptMods || keptMods.has(mod)) refusedImports.push(...lines);
  if (kept) {
    // a module the bundle imports that the build never named (not expected; said for the bundle)
    for (const mod of keptMods)
      if (socketModule(mod) && !seen.has(mod)) refusedImports.push(socketWords(`the server bundle`, mod));
    if (kept.computed)
      refusedImports.push(...(computedAt.length ? computedAt : ['the server bundle']).map(computedWords));
  } else refusedImports.push(...computedAt.map(computedWords));
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
  // who answers api/db/ (the page's gf.db): server/gf-docs.js's handleDocs, the older database's handleDatabase, or a
  // route of the person's own; the files that define those are not routes themselves
  let routesDocs = false,
    usesDocs = false;
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
      // env.GF.files: the game's project files, which xgames.fun must run (server.features "files")
      if (rel.startsWith('server/') && usesFiles(src)) out.usesFiles = true;
      if (rel.startsWith('server/') && rel !== 'server/gf-docs.js' && rel !== 'server/database.js') {
        if (/\bhandleDocs\s*\(/.test(src)) usesDocs = routesDocs = true;
        else if (
          /\b(?:handleDatabase|routeDatabase)\s*\(/.test(src) ||
          /api\/db\b/.test(bytes.toString('utf8').replace(/\/\*[\s\S]*?\*\/|(?<![:'"`])\/\/[^\n]*/g, ''))
        )
          routesDocs = true;
      }
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
    const plain = await plainExports(build, path.join(root, cfg.entry), root).catch(() => []);
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
  // gamesfun.json → database.collections: the page's documents, which a server of its own must answer at api/db/
  if (cfg.database?.has && cfg.database.collections) {
    if (!routesDocs) {
      out.docsUnrouted = true;
      out.warnings.push(
        `${CONFIG_FILE} → database.collections says who may read and write the page's documents (gf.db, at api/db/), and this game's own server does not route api/db/: every gf.db call answers 404, and publish refuses the game. ${CMD} add database writes server/gf-docs.js; route it first thing in fetch: const db = await handleDocs(request, env); if (db) return db; (import { handleDocs } from './gf-docs.js')`,
      );
    } else if (!usesDocs)
      out.warnings.push(
        `${CONFIG_FILE} → database.collections is read by server/gf-docs.js (handleDocs), which this server does not route: its own api/db/ route decides who may read and write`,
      );
  }
  // the database a Durable Object holds (xcore add database before D1): it still works, and the new way is D1
  if (out.inputs.includes('server/database.js') && cfg.objects.some(o => o.class === 'GameData')) {
    const text = await readFile(path.join(root, 'server', 'database.js'), 'utf8').catch(() => '');
    // its RULES as xcore 0.1.0 wrote them, never changed: open to anyone, which is not "working"
    // 0.1.0's code over the database as it is now: a dataOf(env) call with no owner means the server's own space
    if (text.includes(OWNER_SPACES)) {
      const calls = await ownerlessDataCalls(root, out.inputs);
      if (calls.length)
        out.warnings.push(
          `${calls.length === 1 ? 'A call' : `${calls.length} calls`} to dataOf(env) with no owner: since xcore 0.2.0 that is the server's own space, not the document a player wrote (in 0.1.0 a document was found by its id alone). Say whose space each means:\n${calls
            .slice(0, 20)
            .map(c => `  ${dataCallLine(c)}`)
            .join('\n')}${calls.length > 20 ? `\n  and ${calls.length - 20} more` : ''}`,
        );
    }
    if (text.includes(OLD_DEFAULT_RULES))
      out.warnings.push(
        `server/database.js still has the RULES xcore 0.1.0 wrote ('*': { read: 'anyone' }): every document in every collection is open to anyone, signed in or not, including what players keep for themselves. ${CMD} add database makes each player's documents their own (read: 'owner'); name a collection that is meant to be public in RULES (levels: { read: 'anyone', write: 'owner' })`,
      );
    else
      out.warnings.push(
        `server/database.js is the older database (a Durable Object, GameData). It keeps working; a new game's database is its own D1 (gamesfun.json → database: ${CMD} add database in a game without it, docs/SERVER.md "A database of its own")`,
      );
  }
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
