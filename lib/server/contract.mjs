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
//     gamesfun.json        { "database": { "engine": "d1", "binding": "DB", "migrations": "server/migrations" } }: a D1
//                          database of the game's own (xgames.fun's STORAGE.md §8.2, readDatabaseConfig below). A
//                          database and no server of its own: xcore's stock server is the server.
//   Requests:  <the game's origin>/api/*  → the server's fetch, the URL unchanged; every x-gf-* header removed (§4.1)
//              (in the kit's dev server: the page's /game/api/*, sent on as /api/*)
//   env:       env.GF          the platform (below); no other secret of xgames.fun's
//              env.<binding>   a Durable Object namespace for each declared object, SQLite storage
//              env.GF_GAME_ID, env.GF_SLUG, env.GF_CONTRACT   plain text
//              env.<database.binding>   the game's D1 database, when gamesfun.json has a database (env.DB)
//   Runtime:   Workers, compatibility date 2025-06-01; nodejs_compat only when gamesfun.json asks for it
//   Outbound:  fetch() reaches only backend.json's origins and xgames.fun's (hosted; not enforced on this machine)
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
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
 *   files.put(path, body, {type, public = false, length})  → {ok, path, bytes, url?}  (the game's project files,
 *                                          STORAGE.md §8.6, §8.10: body a string, ArrayBuffer or byte ReadableStream, up
 *                                          to 25 MB; a stream held to exactly its length, or up to 1 MB without; url,
 *                                          https://<slug>.xgamesusercontent.com/<path>, when public; over the cap
 *                                          {ok: false, code: 'full'})
 *   files.get(path)                      → {ok, body, type, bytes, public}  (body: a ReadableStream of the bytes)
 *   files.head(path)                     → {ok, type, bytes, public}
 *   files.list({prefix, after, limit = 100})  → {ok, items: [{path, bytes, type, public, updatedAt}], after}
 *   files.delete(path)                   → {ok, deleted}
 *   files.usage()                        → {ok, bytes, files, cap}
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
  'files.put',
  'files.get',
  'files.head',
  'files.list',
  'files.delete',
  'files.usage',
]);

// ---- the game's project files: env.GF.files and the files domain (STORAGE.md §8.6–8.7) ---------------------------
// Files the developer or the game's server writes, never players (replays, generated levels, content packs). Live:
// the bucket xgames-files, key g/<gameId>/<path>; a public one served at https://<slug>.xgamesusercontent.com/<path>,
// another site to the browser. On this machine: <game>/.gamesfun/dev/files/, served on a port of its own (another
// origin, though the same site as the page's)
// (../dev/files.mjs).

/** The files' rules and caps (§8.6; the cap is Free's: Creator 10 GB, Scale 100 GB). */
export const FILES = Object.freeze({
  path: /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/,
  pathChars: 512,
  fileBytes: 25 * 1024 * 1024,
  capBytes: 100 * 1024 * 1024,
  listMax: 1000,
  domain: 'xgamesusercontent.com',
});

/** A file's path, checked: letters, digits, . _ - and / between them, no . or .. part, at most 512. → null or why */
export function filePathProblem(p) {
  if (typeof p !== 'string' || !p) return 'A file needs a path, such as replays/2026-11-08.json.';
  if (p.length > FILES.pathChars) return `A file's path is at most ${FILES.pathChars} characters.`;
  if (!FILES.path.test(p)) return 'A path is letters, digits, ".", "_" and "-", with "/" between folders.';
  if (p.split('/').some(part => part === '.' || part === '..')) return 'A path has no "." or ".." part.';
  return null;
}

/** The types served as themselves (§8.7); anything else goes as application/octet-stream, to be downloaded. */
const INLINE =
  /^(image\/(png|jpeg|webp|gif|avif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|font\/[a-z0-9.+-]+|application\/json|text\/plain)$/;
/** How the files domain serves a file of this type. → {type, inline} */
export function servedType(type) {
  const t = String(type ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  return INLINE.test(t)
    ? { type: t === 'text/plain' ? 'text/plain; charset=utf-8' : t, inline: true }
    : { type: 'application/octet-stream', inline: false };
}
const BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  json: 'application/json',
  txt: 'text/plain',
};
/** A file's type from its name, when the put names none. */
export const fileType = p => BY_EXTENSION[/\.([a-z0-9]+)$/i.exec(p)?.[1]?.toLowerCase()] ?? 'application/octet-stream';

/** Server code that calls env.GF.files (its sources, comments left out), which needs "files" in server.features. */
export const usesFiles = code => /\bGF\s*\.\s*files\b|\bfiles\b[^;{}]*\}\s*=\s*[\w.]*\bGF\b/.test(code);
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
 * What else this xgames.fun runs for a game (STORAGE.md §8.1): GET /api/kit/me → server.features, a list that has
 * "d1" once it makes each game a database, and "files" once env.GF.files and the files domain are live. → a Set
 */
export const studioFeatures = me =>
  new Set(Array.isArray(me?.server?.features) ? me.server.features.filter(f => typeof f === 'string') : []);

/**
 * The publish body's `server` field (POST /api/kit/publish), the manifest of §6.1. The module's bytes go up through
 * the same blob route as the files (POST /api/kit/publish/<id>/blobs/<sha256>), named in the answer's `missing`; so
 * do the database's migration files (STORAGE.md §8.3: `database: {binding, migrations: [{name, sha256, bytes}]}`).
 */
export function publishField({ sha256, bytes, objects, compatibilityFlags, wasm = [], database = null }) {
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
    ...(database?.has
      ? {
          database: {
            binding: database.binding,
            migrations: database.migrations.map(m => ({ name: m.name, sha256: m.sha256, bytes: m.bytes })),
          },
        }
      : {}),
  };
}

// ---- the game's database: gamesfun.json → database (STORAGE.md §8.2) ---------------------------------------------
//   "database": { "engine": "d1", "binding": "DB", "migrations": "server/migrations",
//                 "collections": { "*": {"read": "owner", "write": "owner"} } }
// One D1 database a game, bound to its server as env.<binding>. Its tables come from the migration files, applied in
// name order, each once; once applied a migration never changes (append only). `collections` are the rules of the
// page's documents (gf.db, api/db/*): a game with a database and no server/ gets xcore's stock server
// (../client/server/stock.js), which serves them from the database; a game with a server of its own serves them with
// server/gf-docs.js (`xcore add` writes it), and publish refuses one whose server does not route api/db/.

/** The keys gamesfun.json → database takes. */
export const DATABASE_KEYS = Object.freeze(['engine', 'binding', 'migrations', 'collections']);
export const DATABASE_DEFAULTS = Object.freeze({ engine: 'd1', binding: 'DB', migrations: 'server/migrations' });
/** A migration's file name: four digits, then words (0001_init.sql). */
export const MIGRATION_NAME = /^\d{4}_[a-z0-9_-]+\.sql$/;
/**
 * The most a request through xgames.fun's Studio may carry (§8.10): it runs on Vercel, which caps a request body at
 * 4.5 MB. An owner's `db import --live` and `files put --live` are held to it; a bigger file goes up from the game's
 * server (env.GF.files.put, up to 25 MB).
 */
export const STUDIO_BODY_BYTES = 4_500_000;
/** xgames.fun's caps (§8.3, §8.5): 200 migrations of 1 MB each; an import of 5 MB. */
export const DATABASE_LIMITS = Object.freeze({
  migrations: 200,
  migrationBytes: 1024 * 1024,
  importBytes: 5 * 1024 * 1024,
});
/** RULES as an xcore before 0.1.1 wrote it into server/database.js, untouched: anyone read every document. */
export const OLD_DEFAULT_RULES = "export const RULES = {\n  '*': { read: 'anyone', write: 'owner' },\n};";
/** The collections' rules when the stock server has none: each player reads and writes only their own. */
export const DEFAULT_COLLECTIONS = Object.freeze({ '*': Object.freeze({ read: 'owner', write: 'owner' }) });
/** What the stock server is called where a server's entry file would be named. */
export const STOCK_ENTRY = "xcore's stock server";
const COLLECTION = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The database block, checked (§8.2). `objects`: the server's Durable Objects, whose bindings it must not take.
 * → { has, engine, binding, migrationsDir, migrations: [{name, path, sha256, bytes, data, text}], collections, problems,
 * warnings }. `has` is false without a block.
 */
export async function readDatabaseConfig(dir, config, { objects = [], own = false } = {}) {
  const problems = [],
    warnings = [];
  const d = config?.database;
  const none = { has: false, binding: null, migrations: [], collections: null, problems, warnings };
  if (d === undefined) return none;
  if (d === null || typeof d !== 'object' || Array.isArray(d)) {
    problems.push(`${CONFIG_FILE} "database" is an object: {"engine": "d1", "binding": "DB"}`);
    return none;
  }
  const extra = Object.keys(d).filter(k => !DATABASE_KEYS.includes(k));
  if (extra.length)
    problems.push(
      `${CONFIG_FILE} database has ${extra.map(k => JSON.stringify(k)).join(', ')}, which it does not know (it takes ${DATABASE_KEYS.join(', ')})`,
    );
  const engine = d.engine ?? DATABASE_DEFAULTS.engine;
  if (engine !== 'd1') problems.push(`${CONFIG_FILE} database.engine is "d1" (the only engine xgames.fun runs)`);
  const binding = d.binding ?? DATABASE_DEFAULTS.binding;
  if (typeof binding !== 'string' || !BINDING_NAME.test(binding) || reservedBinding(binding))
    problems.push(
      `${CONFIG_FILE} database.binding ${JSON.stringify(binding)} must be A–Z, 0–9 and _, starting with a letter, at most 32 characters, and not GF or GF_* (it is env.<binding> in the server; the default is "DB")`,
    );
  else if (objects.some(o => o.binding === binding))
    problems.push(
      `${CONFIG_FILE} database.binding ${binding} is also a Durable Object's binding (server.objects): give one of them another name`,
    );
  // the migrations stay inside server/, which is never a public file
  const folder =
    typeof d.migrations === 'string' ? d.migrations.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') : null;
  let migrationsDir = DATABASE_DEFAULTS.migrations;
  if (
    d.migrations !== undefined &&
    (folder === null || !/^server\/[A-Za-z0-9_./-]+$/.test(folder) || folder.split('/').includes('..'))
  )
    problems.push(
      `${CONFIG_FILE} database.migrations is a folder inside server/, such as "server/migrations" (server/ is never a public file)`,
    );
  else if (folder !== null) migrationsDir = folder;
  const migrations = [];
  const abs = path.join(dir, ...migrationsDir.split('/'));
  if (existsSync(abs)) {
    const names = (await readdir(abs, { withFileTypes: true }))
      .filter(e => e.isFile() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort();
    const seen = new Map();
    for (const name of names) {
      if (!MIGRATION_NAME.test(name)) {
        if (/\.sql$/i.test(name))
          problems.push(
            `${migrationsDir}/${name}: a migration's name is four digits, _ and lowercase words, such as 0002_add_guilds.sql`,
          );
        else warnings.push(`${migrationsDir}/${name} is not a migration (NNNN_name.sql): it is left out`);
        continue;
      }
      const n = name.slice(0, 4);
      if (seen.has(n)) {
        problems.push(`${migrationsDir}: ${seen.get(n)} and ${name} have the same number; give each its own`);
        continue;
      }
      seen.set(n, name);
      const bytes = await readFile(path.join(abs, name));
      const empty = emptyMigration({ name, path: `${migrationsDir}/${name}`, bytes: bytes.length });
      if (empty) problems.push(empty);
      else if (bytes.length > DATABASE_LIMITS.migrationBytes)
        problems.push(`${migrationsDir}/${name} is ${(bytes.length / 1048576).toFixed(1)} MB; a migration may be 1 MB`);
      migrations.push({
        name,
        path: `${migrationsDir}/${name}`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
        data: bytes,
        text: bytes.toString('utf8'),
      });
    }
    if (migrations.length > DATABASE_LIMITS.migrations)
      problems.push(
        `${migrationsDir} has ${migrations.length} migrations; a game may have ${DATABASE_LIMITS.migrations}`,
      );
  }
  let collections = null;
  if (d.collections !== undefined) {
    if (!d.collections || typeof d.collections !== 'object' || Array.isArray(d.collections))
      problems.push(
        `${CONFIG_FILE} database.collections is an object: {"*": {"read": "owner", "write": "owner"}, "profiles": {"read": "anyone", "write": "owner"}}`,
      );
    else {
      collections = {};
      for (const [name, rule] of Object.entries(d.collections)) {
        if (name !== '*' && !COLLECTION.test(name)) {
          problems.push(
            `${CONFIG_FILE} database.collections: ${JSON.stringify(name)} is not a collection's name (1 to 64 letters, digits, - or _; or "*")`,
          );
          continue;
        }
        const keys = rule && typeof rule === 'object' && !Array.isArray(rule) ? Object.keys(rule) : null;
        if (
          !keys ||
          keys.some(k => k !== 'read' && k !== 'write') ||
          (rule.read !== undefined && !['owner', 'anyone'].includes(rule.read)) ||
          (rule.write !== undefined && !['owner', 'server'].includes(rule.write))
        ) {
          problems.push(
            `${CONFIG_FILE} database.collections.${name} is {"read": "owner" | "anyone", "write": "owner" | "server"}`,
          );
          continue;
        }
        collections[name] = { ...(rule.read ? { read: rule.read } : {}), ...(rule.write ? { write: rule.write } : {}) };
      }
    }
  }
  return {
    has: true,
    engine,
    binding: typeof binding === 'string' ? binding : DATABASE_DEFAULTS.binding,
    migrationsDir,
    migrations,
    // the stock server's rules, or a server of its own's when it has them (server/gf-docs.js reads them)
    collections: own ? collections : (collections ?? { ...DEFAULT_COLLECTIONS }),
    problems,
    warnings,
  };
}

/** A migration file with nothing in it (0 bytes) is refused, here as on xgames.fun. → null, or why */
export const emptyMigration = m =>
  m.bytes === 0
    ? `${m.path ?? m.name} is empty (0 bytes): put the migration's statements in it, or delete the file`
    : null;

/**
 * Do the migrations still begin with the ones already applied, each the same bytes (append only, §8.4.2)? `applied`:
 * [{name, sha256}] in the order they were applied. → null, or {code, name, why} in plain words.
 */
export function migrationsChanged(migrations, applied = []) {
  for (let i = 0; i < applied.length; i++) {
    const was = applied[i],
      now = migrations[i];
    if (now?.name === was.name && now.sha256 === was.sha256) continue;
    const there = migrations.find(m => m.name === was.name);
    const why = !there
      ? `${was.name} was applied to the database, and it is not there any more`
      : there.sha256 !== was.sha256
        ? `${was.name} changed after it was applied to the database`
        : `${now?.name ?? 'a migration'} comes before ${was.name}, which was applied already`;
    return {
      code: 'migration-changed',
      name: was.name,
      why: `${why}. A migration is never changed once applied: put it back as it was, and make the change in a new migration after the last one`,
    };
  }
  return null;
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
  const own = s !== undefined || existsSync(path.join(dir, DEFAULT_ENTRY));
  if (!own) {
    // a database and no server of its own: xcore's stock server serves the page's api/db/ from it
    const database = await readDatabaseConfig(dir, config);
    problems.push(...database.problems);
    if (!database.has)
      return { has: false, entry: null, objects: [], compatibilityFlags: [], problems, warnings: [], database, config };
    return {
      has: true,
      stock: true,
      entry: STOCK_ENTRY,
      objects: [],
      compatibilityFlags: [],
      problems,
      warnings: [...database.warnings],
      database,
      config,
    };
  }
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
  const database = await readDatabaseConfig(dir, config, { objects, own: true });
  problems.push(...database.problems);
  return {
    has: true,
    stock: false,
    entry,
    objects,
    compatibilityFlags: Array.isArray(flags) ? [...new Set(flags.filter(f => ALLOWED_FLAGS.includes(f)))] : [],
    problems,
    warnings: [...database.warnings],
    database,
    config,
  };
}
