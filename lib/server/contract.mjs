// gf-server-v1: what a game's own server code is, as the kit reads it. This one module holds every name and number of
// the contract between a game's `server/`, the kit (dev, publish) and xgames.fun's hosting (the play edge's /api/*, the
// dispatch namespace, the platform binding env.GF). docs/SERVER.md is the person's page for it.
//
// Coded to xgames.fun's hosting contract, version gf-server-v1, and the play edge's own checks of a server's manifest.
// Where that contract changes, change it here: nothing else in the kit names these values.
//
//   A game folder:
//     server/index.js      the server: an ES module whose default export is a Worker ({ fetch(request, env, ctx) })
//                          and whose named exports include each Durable Object class it declares (§4)
//     gamesfun.json        { "server": { "main": "server/index.js", "objects": [{"class": "Room", "binding": "ROOM"}],
//                          "routes": "/api/*", "compatibilityFlags": [] } } (§2). Without it, server/index.js is the
//                          server when it exists, with no objects.
//     server/ and gamesfun.json are never served; a game with a server has no files under api/ (§1).
//   Requests:  <the game's origin>/api/*  → the server's fetch, the URL unchanged; every x-gf-* header removed (§4.1)
//              (in the kit's dev server: the page's /game/api/*, sent on as /api/*)
//   env:       env.GF          the platform (below); no other secret of xgames.fun's
//              env.<binding>   a Durable Object namespace for each declared object, SQLite storage
//              env.GF_GAME_ID, env.GF_SLUG, env.GF_CONTRACT   plain text
//   Runtime:   Workers, compatibility date 2025-06-01; nodejs_compat only when gamesfun.json asks for it
//   Outbound:  fetch() reaches only backend.json's origins and xgames.fun's (hosted; not enforced on this machine)
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const SERVER_FORMAT = 'gf-server-v1';
export const CONFIG_FILE = 'gamesfun.json';
export const DEFAULT_ENTRY = 'server/index.js';
export const SERVER_DIR = 'server';
/** The runtime the hosted script runs on (xgames.fun's upload and its local parity use these). */
export const COMPATIBILITY_DATE = '2025-06-01';
/** The only compatibility flag a game may ask for (gamesfun.json server.compatibilityFlags). */
export const ALLOWED_FLAGS = Object.freeze(['nodejs_compat']);
export const ROUTES = '/api/*';
/** The keys gamesfun.json → server takes. */
export const SERVER_KEYS = Object.freeze(['main', 'objects', 'routes', 'compatibilityFlags']);
/** One module goes up: the bundle. */
export const BUNDLE_NAME = 'index.js';
/** xgames.fun's caps for one game's server (§7: 16 modules and 5 MB in all, 8 Durable Object classes). */
export const LIMITS = Object.freeze({
  bytes: 5 * 1024 * 1024,
  warnBytes: 1024 * 1024,
  modules: 16,
  objects: 8,
  sourceFiles: 500,
});
export const CLASS_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
/** A binding: A–Z, 0–9 and _, starting with a letter, at most 32 characters, never GF or GF_* (§2). */
export const BINDING_NAME = /^[A-Z][A-Z0-9_]{0,31}$/;
export const reservedBinding = b => b === 'GF' || b.startsWith('GF_');
/** The prefix of a game's own server on its origin, and of the platform's services for the page (same origin). */
export const API_PREFIX = '/api/';
export const PLATFORM_PREFIX = '/platform/v1/';
/**
 * Node built-ins nodejs_compat does not give a Worker at COMPATIBILITY_DATE (or gives only as a stub that throws):
 * an import of one is refused at bundle time with words, not left to fail on the first request hosted.
 */
export const NODE_REFUSED = Object.freeze([
  'child_process',
  'cluster',
  'dgram',
  'fs',
  'fs/promises',
  'http2',
  'inspector',
  'module',
  'readline',
  'repl',
  'trace_events',
  'tty',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
]);

/**
 * env.GF, the platform binding (a Workers RPC service, entrypoint GameServices; locally ./gf-local.js). Every answer is
 * {ok: true, …} or {ok: false, code, why}; a refusal is an answer, never a throw.
 *   verifyPlayer(token)                  → {ok, sub, wallet | null, x: {id, handle} | null, lvl, exp (unix s)}
 *   saves.get(player, key = 'main')      → {ok, value | null, updatedAt}
 *   saves.put(player, key, value)        → {ok, bytes}                 (a JSON value, 64 KB; 16 keys a player)
 *   saves.delete(player, key)            → {ok, deleted}
 *   saves.list(player)                   → {ok, keys: [{key, bytes, updatedAt}]}
 *   scores.submit(board, player, score, {name?, order?: 'high' | 'low', writer?: 'server' | 'any'})
 *                                        → {ok, improved, best, rank}
 *   scores.setup(board, {order?, writer?: 'server' | 'any'})  → {ok, board, order, writer, removed}  (writer
 *                                          'server': the page's /platform/v1/scores submit is refused, 403
 *                                          server-only, and what the page wrote before is removed; board may be a
 *                                          pattern, 'daily-*' or '*': the rule for every board it names, to come too)
 *   scores.drop(board)                   → {ok, dropped, removed}      (the board gone: its place among the 16 free)
 *   scores.top(board, {limit?, offset?}) → {ok, order, writer, entries: [{rank, player, name, score, at}]}
 *   scores.best(board, player)           → {ok, entry: {rank, score, name, at} | null}
 *   scores.remove(board, player)         → {ok, removed}
 *   loot.report({round, endedAt, winners: [{wallet, place, grant?}]})    → {ok, result, vouchers} (xgames.fun signs it
 *                                          with the game's host key; the keeper decides) — locally logged only
 *   loot.status()                        → {ok, host, certified, game}
 *   info()                               → {ok, contract, gameId, slug}
 */
export const GF_METHODS = Object.freeze([
  'verifyPlayer',
  'saves.get',
  'saves.put',
  'saves.delete',
  'saves.list',
  'scores.submit',
  'scores.setup',
  'scores.top',
  'scores.best',
  'scores.remove',
  'scores.drop',
  'loot.report',
  'loot.status',
  'info',
]);
/** The platform's per-game limits (xgames.fun platform/limits.mjs), the same here so a game fits both. */
export const PLATFORM_LIMITS = Object.freeze({
  saves: Object.freeze({ playerChars: 128, valueBytes: 64 * 1024, keysPerPlayer: 16 }),
  scores: Object.freeze({ boards: 16, rules: 32, nameChars: 32, perPlayerEveryMs: 1000, topMax: 100 }),
  loot: Object.freeze({ winners: 16 }),
});
/** A save key or a board name. */
export const SAVE_KEY = /^[A-Za-z0-9_.-]{1,32}$/;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ROUND = /^[0-9a-f]{32}$/;
/** A loot result's shape, as xgames.fun checks it (platform/loot.mjs checkResult, less the owner's grant list). → null or a refusal */
export function checkLootResult(r, now = Date.now()) {
  const no = (code, why) => ({ ok: false, code, why });
  if (!r || typeof r !== 'object') return no('shape', 'A result is {round, endedAt, winners}.');
  if (!ROUND.test(String(r.round ?? ''))) return no('round', 'round is 16 bytes in hex (32 characters).');
  if (!Number.isInteger(r.endedAt) || r.endedAt > now / 1000 + 60 || r.endedAt < now / 1000 - 86_400)
    return no('time', 'endedAt is unix seconds, within the last day.');
  if (!Array.isArray(r.winners) || r.winners.length < 1 || r.winners.length > PLATFORM_LIMITS.loot.winners)
    return no('winners', `1–${PLATFORM_LIMITS.loot.winners} winners.`);
  for (const w of r.winners) {
    if (!ADDRESS.test(String(w?.wallet ?? ''))) return no('wallet', 'Each winner has a wallet address.');
    if (!Number.isInteger(w.place) || w.place < 1 || w.place > 255)
      return no('place', 'Each winner has a place, 1–255.');
    if (w.grant !== undefined && w.grant !== null && !(Number.isInteger(w.grant) && w.grant >= 1 && w.grant <= 65_534))
      return no('grant', 'grant is a grant id.');
  }
  return null;
}

/**
 * Does this xgames.fun take server code? The contract (§6) does not say how a kit learns it, so the kit asks GET
 * /api/kit/me for `server: { contracts: ['gf-server-v1'], maxBytes? }` (also read: `formats`, `contract`) and sends
 * server code only when it is there. → { ok, maxBytes } | { ok: false, why }
 */
export function studioAccepts(me) {
  const s = me?.server;
  const formats = [s?.contracts, s?.formats, s?.contract, s?.format].flatMap(v =>
    Array.isArray(v) ? v : v ? [v] : [],
  );
  if (!formats.includes(SERVER_FORMAT))
    return {
      ok: false,
      why: `this xgames.fun does not take server code yet (GET /api/kit/me does not list ${SERVER_FORMAT})`,
    };
  const maxBytes = Number.isFinite(s.maxBytes) && s.maxBytes > 0 ? Math.min(s.maxBytes, LIMITS.bytes) : LIMITS.bytes;
  return { ok: true, maxBytes };
}

/**
 * The publish body's `server` field (POST /api/kit/publish), the manifest of §6.1. The module's bytes go up through
 * the same blob route as the files (POST /api/kit/publish/<id>/blobs/<sha256>), named in the answer's `missing`.
 */
export function publishField({ sha256, bytes, objects, compatibilityFlags, wasm = [] }) {
  return {
    contract: SERVER_FORMAT,
    main: BUNDLE_NAME,
    modules: [
      { name: BUNDLE_NAME, sha256, bytes },
      ...wasm.map(w => ({ name: w.name, sha256: w.sha256, bytes: w.size })),
    ],
    objects: objects.map(o => ({ class: o.class, binding: o.binding })),
    compatibilityDate: COMPATIBILITY_DATE,
    compatibilityFlags: [...compatibilityFlags],
  };
}

/**
 * The game's server settings (§2). → { has, entry (relative, posix), objects: [{class, binding}], compatibilityFlags,
 * problems, config (gamesfun.json or null) }. `has` is false for a game without server code (no gamesfun.json
 * `server` and no server/index.js): nothing changes for it.
 */
export async function readServerConfig(dir) {
  const problems = [];
  let config = null;
  const file = path.join(dir, CONFIG_FILE);
  if (existsSync(file)) {
    try {
      config = JSON.parse(await readFile(file, 'utf8'));
    } catch (e) {
      problems.push(`${CONFIG_FILE} is not valid JSON (${e.message})`);
    }
    if (config !== null && (typeof config !== 'object' || Array.isArray(config))) {
      problems.push(`${CONFIG_FILE} must be an object`);
      config = null;
    }
  }
  const s = config?.server;
  if (s !== undefined && (s === null || typeof s !== 'object' || Array.isArray(s)))
    problems.push(
      `${CONFIG_FILE} "server" is an object: {"main": "server/index.js", "objects": [{"class": "Room", "binding": "ROOM"}]}`,
    );
  const srv = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  const has = s !== undefined || existsSync(path.join(dir, DEFAULT_ENTRY));
  if (!has) return { has: false, entry: null, objects: [], compatibilityFlags: [], problems, config };
  // a misspelled key (object for objects) was silently ignored, and the server went up without its Durable Objects
  const extra = srv && typeof srv === 'object' ? Object.keys(srv).filter(k => !SERVER_KEYS.includes(k)) : [];
  if (extra.length)
    problems.push(
      `${CONFIG_FILE} server has ${extra.map(k => JSON.stringify(k)).join(', ')}, which it does not know (it takes ${SERVER_KEYS.join(', ')})`,
    );
  const entry = typeof srv.main === 'string' ? srv.main.replace(/\\/g, '/').replace(/^\.\//, '') : DEFAULT_ENTRY;
  if (srv.main !== undefined && typeof srv.main !== 'string')
    problems.push(`${CONFIG_FILE} server.main is a path such as "server/index.js"`);
  else if (!/^server\/[A-Za-z0-9_./-]+\.m?js$/.test(entry) || entry.split('/').includes('..'))
    problems.push(
      `${CONFIG_FILE} server.main must be a .js or .mjs file inside server/ (it is ${JSON.stringify(entry)})`,
    );
  else if (!existsSync(path.join(dir, entry)))
    problems.push(`${entry} does not exist (${CONFIG_FILE} names it as the server)`);
  if ((srv.routes ?? ROUTES) !== ROUTES)
    problems.push(`${CONFIG_FILE} server.routes must be "${ROUTES}" (the only value in ${SERVER_FORMAT})`);
  const objects = [];
  const declared = srv.objects ?? [];
  if (!Array.isArray(declared))
    problems.push(`${CONFIG_FILE} server.objects is a list: [{"class": "Room", "binding": "ROOM"}]`);
  for (const o of Array.isArray(declared) ? declared : []) {
    if (!o || typeof o !== 'object' || typeof o.class !== 'string' || !CLASS_NAME.test(o.class)) {
      problems.push(
        `${CONFIG_FILE} server.objects: ${JSON.stringify(o)} needs a "class" that is a JavaScript class name`,
      );
      continue;
    }
    if (typeof o.binding !== 'string' || !BINDING_NAME.test(o.binding) || reservedBinding(o.binding)) {
      problems.push(
        `${CONFIG_FILE} server.objects: the binding ${JSON.stringify(o.binding)} of ${o.class} must be A–Z, 0–9 and _, starting with a letter, at most 32 characters, and not GF or GF_* (e.g. "${o.class.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}")`,
      );
      continue;
    }
    if (objects.some(x => x.class === o.class || x.binding === o.binding)) {
      problems.push(`${CONFIG_FILE} server.objects: ${o.class} (${o.binding}) is declared twice`);
      continue;
    }
    objects.push({ class: o.class, binding: o.binding });
  }
  if (objects.length > LIMITS.objects)
    problems.push(
      `${CONFIG_FILE} declares ${objects.length} Durable Object classes; a game's server may have ${LIMITS.objects}`,
    );
  const flags = srv.compatibilityFlags ?? [];
  if (!Array.isArray(flags) || flags.some(f => !ALLOWED_FLAGS.includes(f)))
    problems.push(
      `${CONFIG_FILE} server.compatibilityFlags may hold only ${ALLOWED_FLAGS.map(f => JSON.stringify(f)).join(', ')}`,
    );
  return {
    has: true,
    entry,
    objects,
    compatibilityFlags: Array.isArray(flags) ? [...new Set(flags.filter(f => ALLOWED_FLAGS.includes(f)))] : [],
    problems,
    config,
  };
}
