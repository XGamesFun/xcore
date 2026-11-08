// A game's server/ on this machine, for `xcore dev`: the same bundle publish sends (../server/bundle.mjs, unminified so
// an error names a readable line), run by workerd through Miniflare (./tools.mjs: installed on first use), with:
//   env.GF        the platform stand-in (./gf-local.js → ./platform.mjs)
//   env.<binding> each Durable Object gamesfun.json declares, with SQLite storage kept in <game>/.gamesfun/dev-server/
//                 (so its state survives a restart, as hosted)
//   env.DB        the game's database (gamesfun.json → database, under its own binding): a local D1 kept in
//                 <game>/.gamesfun/dev/d1/, its migrations applied at each start and reload (./d1.mjs); a migration
//                 changed after it was applied here keeps the server down, as xgames.fun refuses that publish
//   env.GF_GAME_ID, GF_SLUG, GF_CONTRACT   as hosted (the game id here is dev-<folder>)
//   env.<NAME>    the owner's secrets: hosted, set with `xcore secret set`; here, from the game folder's .dev.vars
//                 (KEY=value lines; a dot file, so publish never sends it), read again at each reload
// The dev host sends the page's /game/api/* here as /api/* (HTTP through dispatchFetch; WebSockets through a plain TCP
// pipe to Miniflare's own port), with every x-gf-* header removed, as xgames.fun's dispatch removes them. What is not
// the same as hosted: no CPU or request limits, and outbound fetch is not limited to backend.json's origins.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { bundleServer } from '../server/bundle.mjs';
import { COMPATIBILITY_DATE, SERVER_FORMAT } from '../server/contract.mjs';
import { loadMiniflare } from './tools.mjs';
import { secretNameProblem } from '../server/secrets.mjs';
import { applyMigrations, d1Options } from './d1.mjs';

const GF_LOCAL = fileURLToPath(new URL('./gf-local.js', import.meta.url));

/** Miniflare's options (v4) for one game's bundle: the bindings xgames.fun's upload gives it, the same runtime. */
export function workerOptions({
  code,
  objects,
  compatibilityFlags = [],
  persist,
  store,
  gfSource,
  wasm = [],
  secrets = {},
  database = null,
  dir = null,
}) {
  return {
    host: '127.0.0.1',
    port: 0,
    ...(persist ? { durableObjectsPersist: persist } : {}),
    ...(database?.has ? { d1Persist: d1Options(dir, database.binding).d1Persist } : {}),
    workers: [
      {
        name: 'game',
        modules: [
          { type: 'ESModule', path: 'index.js', contents: code },
          ...wasm.map(w => ({ type: 'CompiledWasm', path: w.name, contents: Buffer.from(w.bytes) })),
        ],
        compatibilityDate: COMPATIBILITY_DATE,
        compatibilityFlags: [...compatibilityFlags],
        durableObjects: Object.fromEntries(objects.map(o => [o.binding, { className: o.class, useSQLite: true }])),
        ...(database?.has ? { d1Databases: d1Options(dir, database.binding).d1Databases } : {}),
        bindings: { ...secrets, GF_GAME_ID: store.gameId, GF_SLUG: store.slug, GF_CONTRACT: SERVER_FORMAT },
        serviceBindings: { GF: { name: 'gf-local', entrypoint: 'GameServices' } },
      },
      {
        name: 'gf-local',
        modules: [{ type: 'ESModule', path: 'gf-local.js', contents: gfSource }],
        compatibilityDate: COMPATIBILITY_DATE,
        serviceBindings: { HOST: request => store.handleHost(request) },
      },
    ],
  };
}

const HOP = /^(host|connection|keep-alive|transfer-encoding|upgrade|x-gf-.*)$/i;

/** The secrets file `xcore dev` reads: the hosted game's are set with `xcore secret set` (never published). */
export const DEV_VARS = '.dev.vars';

/**
 * The game folder's .dev.vars as the server's secrets: {secrets: {NAME: value}, names, warnings}. A name xgames.fun would
 * refuse (lowercase, GF_*, a room's binding) is left out with a warning, so the code meets the same rules here.
 */
export async function readDevVars(dir, objects = []) {
  const file = path.join(dir, DEV_VARS);
  if (!existsSync(file)) return { secrets: {}, names: [], warnings: [] };
  let parsed;
  try {
    parsed = parseEnv(await readFile(file, 'utf8'));
  } catch (e) {
    return { secrets: {}, names: [], warnings: [`${DEV_VARS} could not be read (${e.message}): no secrets given`] };
  }
  const taken = objects.map(o => o.binding),
    secrets = {},
    warnings = [];
  for (const [name, value] of Object.entries(parsed)) {
    const problem = secretNameProblem(name, taken) ?? (value === '' ? 'it is empty' : null);
    if (problem) warnings.push(`${DEV_VARS}: ${name} left out: ${problem}`);
    else secrets[name] = value;
  }
  return { secrets, names: Object.keys(secrets).sort(), warnings };
}

/**
 * Start the game's server. → {status(), fetch(href, init), proxy(req, res, rest, base), upgrade(req, socket, head, rest),
 * reload(), close()}. A server that does not build or start stays down with its problems (every /api/* answers 503
 * with them) until it is fixed and reloaded.
 */
export async function startLocalServer({
  dir,
  store,
  log = () => {},
  persist = path.join(dir, '.gamesfun', 'dev-server'),
  env = process.env,
}) {
  const { Miniflare } = await loadMiniflare({ log, env });
  const gfSource = await readFile(GF_LOCAL, 'utf8');
  let mf = null,
    url = null,
    closed = false, // close() was called: no start after it makes a Miniflare again
    chain = Promise.resolve();
  let state = { running: false, error: null, problems: [], warnings: [], objects: [] };

  async function start() {
    if (closed) return state;
    const b = await bundleServer(dir, { minify: false });
    if (closed) return state;
    if (!b.has) {
      state = { running: false, error: 'this game has no server/', problems: [], warnings: [], objects: [] };
      return state;
    }
    // a secret in server/ is not public here, but publish refuses it: say so now, and still run
    const warnings = [
      ...b.warnings,
      ...b.hits.map(
        h => `${h.path}${h.line ? `:${h.line}` : ''} looks like it holds a secret (${h.kind}); publish refuses it`,
      ),
    ];
    const objects = b.objects.map(o => o.class);
    const vars = await readDevVars(dir, [
      ...b.objects,
      ...(b.database?.has ? [{ class: 'the database', binding: b.database.binding }] : []),
    ]);
    warnings.push(...vars.warnings);
    if (b.problems.length || !b.code) {
      if (mf) await mf.dispose().catch(() => {});
      mf = url = null;
      state = {
        running: false,
        error: 'server/ does not start',
        problems: [...b.problems],
        warnings,
        objects,
        inputs: b.inputs,
      };
      return state;
    }
    const opts = workerOptions({
      code: Buffer.from(b.code).toString('utf8'),
      objects: b.objects,
      compatibilityFlags: b.compatibilityFlags,
      wasm: b.wasm,
      persist,
      store,
      gfSource,
      secrets: vars.secrets,
      database: b.database,
      dir,
    });
    try {
      if (mf) await mf.setOptions(opts);
      else mf = new Miniflare(opts);
      url = await mf.ready;
      // the game's database: the migrations not applied here yet, in order; a refused one keeps the server down
      let migrated = [];
      if (b.database?.has) {
        const m = await applyMigrations(dir, await mf.getD1Database(b.database.binding), b.database.migrations);
        if (!m.ok) {
          await mf.dispose().catch(() => {});
          mf = url = null;
          state = {
            running: false,
            error: "the game's database did not take its migrations",
            problems: [`${m.why}.`],
            warnings,
            objects,
            inputs: b.inputs,
            migration: { code: m.code, name: m.name },
          };
          return state;
        }
        migrated = m.applied;
      }
      state = {
        running: true,
        error: null,
        problems: [],
        warnings,
        objects,
        secrets: vars.names,
        inputs: b.inputs,
        ...(b.database?.has ? { database: { binding: b.database.binding, migrated } } : {}),
        ...(b.stock ? { stock: true } : {}),
      };
    } catch (e) {
      if (mf) await mf.dispose().catch(() => {});
      mf = url = null;
      state = {
        running: false,
        error: 'server/ does not start',
        problems: [String(e.message ?? e).split('\n')[0]],
        warnings,
        objects,
        inputs: b.inputs,
      };
    }
    return state;
  }
  const queue = fn => (chain = chain.then(fn, fn));
  await queue(start);

  const down = () =>
    Response.json(
      {
        error: 'not-running',
        message: `The game's server is not running on this machine: ${state.problems.join('; ') || state.error || 'it did not start'}`,
        problems: state.problems,
      },
      { status: 503 },
    );
  async function fetchServer(href, init = {}) {
    await chain;
    if (!mf) return down();
    try {
      return await mf.dispatchFetch(href, { ...init, redirect: 'manual' });
    } catch (e) {
      return Response.json(
        { error: 'server', message: `The game's server failed: ${String(e.message ?? e).split('\n')[0]}` },
        { status: 502 },
      );
    }
  }
  return {
    status: () => ({ ...state }),
    fetch: fetchServer,
    /** Node request → the server → Node response. `rest` is the server-side path with its query (/api/…). */
    async proxy(req, res, rest, base) {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers))
        if (v !== undefined && !HOP.test(k)) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Readable.toWeb(req);
      const r = await fetchServer(new URL(rest, base).href, {
        method: req.method,
        headers,
        body,
        ...(body ? { duplex: 'half' } : {}),
      });
      const out = {};
      r.headers.forEach((v, k) => {
        if (!/^(content-length|content-encoding|transfer-encoding|connection)$/i.test(k)) out[k] = v;
      });
      res.writeHead(r.status, out);
      if (!r.body || req.method === 'HEAD') return res.end();
      Readable.fromWeb(r.body)
        .on('error', () => res.destroy())
        .pipe(res);
    },
    /** A WebSocket upgrade for /api/…: piped to Miniflare's own port with the path rewritten. */
    async upgrade(req, socket, head, rest) {
      await chain;
      if (!mf || !url) {
        socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
        return;
      }
      const upstream = net.connect(Number(url.port), url.hostname, () => {
        const lines = [`${req.method} ${rest} HTTP/1.1`];
        for (let i = 0; i < req.rawHeaders.length; i += 2)
          if (!/^x-gf-/i.test(req.rawHeaders[i]))
            lines.push(`${req.rawHeaders[i]}: ${/^host$/i.test(req.rawHeaders[i]) ? url.host : req.rawHeaders[i + 1]}`);
        upstream.write(lines.join('\r\n') + '\r\n\r\n');
        if (head?.length) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      // either side ending ends both: a WebSocket never half-closes
      const end = () => {
        upstream.destroy();
        socket.destroy();
      };
      for (const s of [upstream, socket]) for (const ev of ['error', 'end', 'close']) s.on(ev, end);
    },
    reload: () => queue(start),
    async close() {
      closed = true;
      await chain;
      if (mf) await mf.dispose().catch(() => {});
      mf = null;
      await store.flush();
    },
  };
}
