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
// the same rule here as there (queryProblem, a copy of xgames.fun's), so what works on this machine works live. The game is the folder's own (its
// .gamesfun/publish.json for this xgames.fun); the credential is publish's.
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { call, studioOrigin } from './publish/client.mjs';
import { requireCredential } from './publish/oidc.mjs';
import { readLinks } from './publish/index.mjs';
import { CONFIG_FILE, DATABASE_LIMITS, readServerConfig } from './server/contract.mjs';
import { d1Folder, dumpDatabase, internalTable, openLocalDatabase, readApplied, splitSql } from './dev/d1.mjs';
import { CMD } from './command.mjs';

/** The game's database settings; throws in words when it has none. */
export async function databaseOf(dir) {
  const cfg = await readServerConfig(dir);
  if (cfg.problems.length) throw new Error(`${CONFIG_FILE}: ${cfg.problems.join('; ')}`);
  if (!cfg.database?.has)
    throw new Error(`this game has no database yet: ${CMD} add database gives it one (${CONFIG_FILE} → database)`);
  return cfg.database;
}

// ---- the query route's rule (§8.5), copied from xgames.fun's creator-studio/lib/game-database.mjs as it is, so a query
// is taken or refused the same here as there ------------------------------------------------------------------------
export const QUERY_LIMITS = Object.freeze({ sqlChars: 100_000, params: 100 });
/**
 * The SQL's statements, split on semicolons outside strings, quoted names and comments, with the comments removed.
 * → [statement text, trimmed] (empty statements dropped). An unterminated string or comment → null.
 */
export function sqlStatements(sql) {
  const out = [];
  let cur = '',
    i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i],
      d = sql[i + 1];
    if (c === '-' && d === '-') {
      const e = sql.indexOf('\n', i);
      i = e < 0 ? n : e + 1;
      cur += ' ';
      continue;
    }
    if (c === '/' && d === '*') {
      const e = sql.indexOf('*/', i + 2);
      if (e < 0) return null;
      i = e + 2;
      cur += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1;
      for (;;) {
        if (j >= n) return null;
        if (sql[j] === close) {
          if (close !== ']' && sql[j + 1] === close) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const READ = [
  /^SELECT\b/i,
  /^EXPLAIN\b/i,
  /^PRAGMA\s+(?:main\s*\.\s*)?table_list\s*$/i,
  /^PRAGMA\s+(?:main\s*\.\s*)?table_info\s*\(\s*(?:[A-Za-z_][A-Za-z0-9_]*|'[^']*'|"[^"]*"|`[^`]*`)\s*\)\s*$/i,
];
/**
 * Why `sql` may not run through the owner's query route, or null (§8.5): one statement; without `write`, only SELECT,
 * EXPLAIN and PRAGMA table_info / table_list.
 */
export function queryProblem(sql, { write = false } = {}) {
  if (typeof sql !== 'string' || !sql.trim()) return 'Send the SQL as {"sql": "SELECT …"}.';
  if (sql.length > QUERY_LIMITS.sqlChars)
    return `A query is at most ${QUERY_LIMITS.sqlChars.toLocaleString('en-US')} characters (an import takes more: xcore db import).`;
  const statements = sqlStatements(sql);
  if (!statements) return 'The SQL has a string, a quoted name or a comment that never ends.';
  if (statements.length !== 1) return `Send one statement at a time (this has ${statements.length}).`;
  if (write) return null;
  if (!READ.some(re => re.test(statements[0])))
    return 'Without "write": true, a query may only read: SELECT, EXPLAIN, PRAGMA table_info(<table>) or PRAGMA table_list. Add --write to change data.';
  return null;
}
const PARAM = v =>
  v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
// ---- end of the copy -----------------------------------------------------------------------------------------------

/** Is this SQL one statement that only reads (the rule above without `write`)? → null, or why not */
export const readOnlyProblem = sql => queryProblem(sql);

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
      const { results } = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
      const tables = [];
      for (const { name } of results.filter(r => !internalTable(r.name))) {
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
        applied: await readApplied(db),
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
  // the route's own checks, so a query is refused here in the words xgames.fun would answer
  const why = queryProblem(sql, { write: !!write });
  if (why) throw Object.assign(new Error(why), { code: write ? 'bad-sql' : 'read-only' });
  if (!Array.isArray(params) || params.length > QUERY_LIMITS.params || !params.every(PARAM))
    throw new Error(
      `params is a list (a JSON array) of at most ${QUERY_LIMITS.params} strings, numbers, booleans or nulls: ["moon", 3]`,
    );
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
