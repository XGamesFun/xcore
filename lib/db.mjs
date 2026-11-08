// `xcore db info|query|export|import|restore`: the game's own database (gamesfun.json → database, a D1), on this
// machine by default (the local database `xcore dev` runs, ./dev/d1.mjs), on xgames.fun with `live: true`, through the
// owner's routes (xgames.fun's STORAGE.md §8.5; each call is kept in the game's audit log there):
//   GET  /api/kit/games/<id>/db           → {ok, exists, name, sizeBytes, applied, cap}
//   POST /api/kit/games/<id>/db/query     {sql, params?, write?}  → {ok, results, meta}
//   POST /api/kit/games/<id>/db/export    → {ok, url}             (a signed address of the SQL dump)
//   POST /api/kit/games/<id>/db/import    {sql} (≤ 5 MB)          → {ok, meta}
//   POST /api/kit/games/<id>/db/restore   {timestamp, confirm?}   → {ok, preview: {bookmark, at}, economy} without
//                                                                    confirm; {ok, restored: {bookmark, at}} with it
// A query is one statement, and reads only (SELECT, EXPLAIN, PRAGMA table_info / table_list) unless `write` is set:
// the same rule here as there, so what works on this machine works live. The game is the folder's own (its
// .gamesfun/publish.json for this xgames.fun); the credential is publish's.
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { call, studioOrigin } from './publish/client.mjs';
import { requireCredential } from './publish/oidc.mjs';
import { readLinks } from './publish/index.mjs';
import { CONFIG_FILE, DATABASE_LIMITS, readServerConfig } from './server/contract.mjs';
import { d1Folder, dumpDatabase, openLocalDatabase, readApplied, splitSql } from './dev/d1.mjs';
import { CMD } from './command.mjs';

/** The game's database settings; throws in words when it has none. */
export async function databaseOf(dir) {
  const cfg = await readServerConfig(dir);
  if (cfg.problems.length) throw new Error(`${CONFIG_FILE}: ${cfg.problems.join('; ')}`);
  if (!cfg.database?.has)
    throw new Error(`this game has no database yet: ${CMD} add database gives it one (${CONFIG_FILE} → database)`);
  return cfg.database;
}

/**
 * Is this SQL one statement that only reads? The rule xgames.fun's query route keeps without `write` (§8.5):
 * SELECT, EXPLAIN, and PRAGMA table_info / table_list. → null, or why not
 */
export function readOnlyProblem(sql) {
  const statements = splitSql(String(sql ?? ''));
  if (statements.length !== 1) return statements.length ? 'a query is one statement' : 'there is no statement to run';
  const s = statements[0];
  if (/^(SELECT|EXPLAIN)\b/i.test(s) || /^PRAGMA\s+(table_info|table_list)\b/i.test(s)) return null;
  return 'without --write a query only reads (SELECT, EXPLAIN, PRAGMA table_info or table_list)';
}

/** The game's id on xgames.fun and how to sign the call. Throws in plain words. */
async function target(dir, { origin, env, fetchImpl }) {
  const known = (await readLinks(dir))[origin];
  if (!known?.projectId)
    throw new Error(`this folder's game is not on ${origin} yet: publish it with its database first (${CMD} publish)`);
  const cred = await requireCredential(origin, { env, fetchImpl });
  return { id: known.projectId, auth: await cred.auth() };
}
const route = (id, what = '') => `/api/kit/games/${encodeURIComponent(id)}/db${what ? `/${what}` : ''}`;
const liveCall = async (dir, what, opts, { origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {}) => {
  const t = await target(dir, { origin, env, fetchImpl });
  return call(origin, route(t.id, what), { ...opts, ...t.auth, fetchImpl });
};

/** The local database, opened for one task and closed after it. */
async function withLocal(dir, fn, { env = process.env, log = () => {} } = {}) {
  const database = await databaseOf(dir);
  const local = await openLocalDatabase(dir, database, { env, log });
  try {
    return await fn(local.db, database, local);
  } finally {
    await local.close().catch(() => {});
  }
}

/** The database: where it is, its size, the migrations applied, its tables. → {ok, live, …} */
export async function dbInfo(dir, { live = false, ...opts } = {}) {
  if (live) return { live: true, ...(await liveCall(dir, '', { method: 'GET' }, opts)) };
  return withLocal(
    dir,
    async (db, database) => {
      const { results } = await db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name",
        )
        .all();
      const tables = [];
      for (const { name } of results) {
        const n = (await db.prepare(`SELECT count(*) AS n FROM "${name.replace(/"/g, '""')}"`).first())?.n ?? 0;
        tables.push({ name, rows: n });
      }
      return {
        ok: true,
        live: false,
        exists: true,
        binding: database.binding,
        folder: path.relative(dir, d1Folder(dir)).split(path.sep).join('/'),
        sizeBytes: await folderBytes(d1Folder(dir)),
        applied: await readApplied(dir),
        tables,
      };
    },
    opts,
  );
}
async function folderBytes(dir) {
  const { readdir } = await import('node:fs/promises');
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []))
    if (e.isFile() && /\.sqlite$/.test(e.name)) n += (await stat(path.join(e.parentPath ?? e.path, e.name))).size;
  return n;
}

/** One statement. → {ok, live, results, meta} */
export async function dbQuery(dir, sql, { live = false, params = [], write = false, ...opts } = {}) {
  if (!Array.isArray(params)) throw new Error('params is a list (a JSON array): ["moon", 3]');
  if (!write) {
    const why = readOnlyProblem(sql);
    if (why) throw Object.assign(new Error(why), { code: 'read-only' });
  } else if (splitSql(String(sql ?? '')).length !== 1) throw new Error('a query is one statement');
  if (live)
    return {
      live: true,
      ...(await liveCall(dir, 'query', { method: 'POST', body: { sql, params, write: !!write } }, opts)),
    };
  return withLocal(
    dir,
    async db => {
      const r = await db
        .prepare(sql)
        .bind(...params)
        .all();
      return { ok: true, live: false, results: r.results ?? [], meta: r.meta ?? {} };
    },
    opts,
  );
}

/**
 * The database as SQL text, into a file: `out`, else .gamesfun/exports/db-<when>.sql in the game folder (a hidden
 * folder, so a dump of the players' data is never published). → {ok, live, file, bytes}
 */
export async function dbExport(dir, { live = false, out = null, ...opts } = {}) {
  const when = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.resolve(out ?? path.join(dir, '.gamesfun', 'exports', `db-${live ? 'live' : 'local'}-${when}.sql`));
  let text;
  if (live) {
    const a = await liveCall(dir, 'export', { method: 'POST' }, opts);
    if (!a?.url) throw new Error('xgames.fun did not give an address for the dump');
    const res = await (opts.fetchImpl ?? fetch)(a.url);
    if (!res.ok) throw new Error(`the dump could not be downloaded (${res.status}): run it again`);
    text = Buffer.from(await res.arrayBuffer());
  } else text = Buffer.from(await withLocal(dir, db => dumpDatabase(db), opts));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, { mode: 0o600 });
  return { ok: true, live, file, bytes: text.length };
}

/** SQL statements from a file (a dump, or statements of your own), run in one batch. → {ok, live, meta | statements} */
export async function dbImport(dir, file, { live = false, ...opts } = {}) {
  if (!existsSync(file)) throw new Error(`${file} is not there`);
  const sql = await readFile(file, 'utf8');
  if (Buffer.byteLength(sql) > DATABASE_LIMITS.importBytes)
    throw new Error(`an import is at most ${DATABASE_LIMITS.importBytes / 1048576} MB of SQL; split it into parts`);
  if (live) return { live: true, ...(await liveCall(dir, 'import', { method: 'POST', body: { sql } }, opts)) };
  return withLocal(
    dir,
    async db => {
      // defer_foreign_keys is a D1 export's first line; the batch is one transaction either way
      const statements = splitSql(sql).filter(s => !/^PRAGMA\s+defer_foreign_keys\b/i.test(s));
      if (statements.length) await db.batch(statements.map(s => db.prepare(s)));
      return { ok: true, live: false, statements: statements.length };
    },
    opts,
  );
}

/**
 * The live database as it was at `timestamp` (D1 Time Travel, the last 30 days). Without `confirm` it changes
 * nothing and answers what it would go back to: {ok, preview: {bookmark, at}, economy}; with it, {ok, restored}.
 */
export async function dbRestore(dir, timestamp, { live = false, confirm = false, ...opts } = {}) {
  if (!live)
    throw new Error(
      `restore goes back in time on xgames.fun's copy (--live). The database on this machine has no history: to put back an earlier state here, ${CMD} db import a dump from ${CMD} db export`,
    );
  const text = String(timestamp ?? '').trim();
  // xgames.fun takes an ISO 8601 time (a number there is milliseconds), so unix seconds and any date go as ISO text
  const ms = /^\d{9,11}$/.test(text) ? Number(text) * 1000 : Date.parse(text);
  if (!text || Number.isNaN(ms))
    throw new Error('restore needs a time: a date such as 2026-11-08T12:00:00Z, or unix seconds');
  const at = new Date(ms).toISOString();
  return {
    live: true,
    ...(await liveCall(
      dir,
      'restore',
      { method: 'POST', body: { timestamp: at, ...(confirm ? { confirm: true } : {}) } },
      opts,
    )),
  };
}
