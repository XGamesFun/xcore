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
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { call, studioOrigin } from './publish/client.mjs';
import { OIDC_KIND, requireCredential } from './publish/oidc.mjs';
import { readLinks } from './publish/index.mjs';
import {
  CONFIG_FILE,
  DATABASE_LIMITS,
  STUDIO_BODY_BYTES,
  readServerConfig,
  sqlStatements,
} from './server/contract.mjs';
import { d1Folder, dumpDatabase, importPlan, internalTable, openLocalDatabase, readApplied } from './dev/d1.mjs';
import { CMD } from './command.mjs';
import { stateFolder } from './state-folder.mjs';

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
// sqlStatements is in ../server/contract.mjs, which the migrations' check reads too
export { sqlStatements };
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
/**
 * A query's params as D1's query API takes them: a list of strings. A number goes as its decimal text and a boolean as
 * "1" or "0" (SQLite has no booleans); SQLite's column affinity turns them back into numbers in a comparison with, or an
 * insert into, a numeric column. null cannot be sent as a string, so it is refused: write NULL in the SQL itself. → the
 * strings, or null
 */
export function d1Params(params) {
  if (!Array.isArray(params) || params.length > QUERY_LIMITS.params) return null;
  const out = [];
  for (const v of params) {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'number' && Number.isFinite(v)) out.push(String(v));
    else if (typeof v === 'boolean') out.push(v ? '1' : '0');
    else return null;
  }
  return out;
}
// ---- end of the copy -----------------------------------------------------------------------------------------------

/** Is this SQL one statement that only reads (the rule above without `write`)? → null, or why not */
export const readOnlyProblem = sql => queryProblem(sql);

/** The game's id on xgames.fun and how to sign the call. Throws in plain words. */
async function target(dir, { origin, env, fetchImpl }) {
  const known = (await readLinks(dir))[origin];
  if (!known?.projectId)
    throw new Error(`this folder's game is not on ${origin} yet: publish it with its database first (${CMD} publish)`);
  const cred = await requireCredential(origin, { env, fetchImpl });
  return { id: known.projectId, auth: await cred.auth(), ci: cred.kind === OIDC_KIND };
}

/** What a GitHub Actions run may not do on xgames.fun (403): the owner's own sign-in does it. */
export const notFromCi = what =>
  `xgames.fun does not let a GitHub Actions run ${what}: any workflow of the linked branch could do it. Run it from your own machine, signed in as the game's owner (${CMD} login there), not from CI.`;
const route = (id, what = '') => `/api/kit/games/${encodeURIComponent(id)}/db${what ? `/${what}` : ''}`;
const mb = n => `${(n / 1_000_000).toFixed(1)} MB`;
const CI_REFUSED = {
  export: 'export the database',
  import: 'import into the database',
  restore: 'restore the database',
  query: 'change the database (query --write)',
};
const liveCall = async (dir, what, opts, { origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {}) => {
  const t = await target(dir, { origin, env, fetchImpl });
  try {
    return await call(origin, route(t.id, what), { ...opts, ...t.auth, fetchImpl });
  } catch (e) {
    if (e.status === 403 && t.ci && CI_REFUSED[what])
      throw Object.assign(new Error(notFromCi(CI_REFUSED[what])), { status: 403, code: 'ci', cause: e });
    // Studio's host refuses a request over 4.5 MB with a bare 413, before xgames.fun reads it
    if (e.status === 413 && !e.code)
      throw Object.assign(
        new Error(
          `xgames.fun answered 413: the request was too big for it to take (at most ${mb(STUDIO_BODY_BYTES)} through its Studio). Split the SQL into smaller files and import each.`,
        ),
        { status: 413, code: 'too-big', cause: e },
      );
    if (e.code === 'migration-busy')
      throw Object.assign(
        new Error(
          'another publish of this game is applying its database migrations on xgames.fun right now: try again in a minute',
        ),
        { status: e.status, code: e.code, cause: e },
      );
    throw e;
  }
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
  // the same here as live (D1's API takes each as text): a null is refused, and written as NULL in the SQL instead
  if (!d1Params(params))
    throw Object.assign(
      new Error(
        `params is a list (a JSON array) of at most ${QUERY_LIMITS.params} strings, numbers or booleans, such as ["moon", 3]. D1 takes each as text; for a null, write NULL in the SQL itself.`,
      ),
      { code: 'bad-sql' },
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
        .bind(...d1Params(params))
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
export async function dbExport(
  dir,
  { live = false, out = null, log = () => {}, tries = 5, wait = 3000, ...opts } = {},
) {
  const when = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.resolve(out ?? path.join(dir, '.gamesfun', 'exports', `db-${live ? 'live' : 'local'}-${when}.sql`));
  let text,
    note = null;
  if (live) {
    // a large export answers 504 export-pending with its bookmark: asked again with it, D1 goes on where it got to
    // (asked without it, it starts over; nobody asking, it stops). One this command gave up on is kept in
    // .gamesfun/export-pending.json, so the next `db export --live` picks it up there
    const pendingFile = path.join(dir, '.gamesfun', 'export-pending.json');
    const origin = opts.origin ?? studioOrigin();
    let a,
      bookmark = null,
      kept = null;
    try {
      const p = JSON.parse(await readFile(pendingFile, 'utf8'));
      if (p?.origin === origin && typeof p.bookmark === 'string') bookmark = kept = p.bookmark;
    } catch {
      /* none kept */
    }
    for (let i = 0; ; i++) {
      try {
        a = await liveCall(dir, 'export', { method: 'POST', ...(bookmark ? { body: { bookmark } } : {}) }, opts);
        break;
      } catch (e) {
        // a kept bookmark D1 no longer knows (its export stopped): this one starts over
        if (kept && bookmark === kept && e.code !== 'export-pending' && e.status >= 400 && e.status < 500) {
          bookmark = kept = null;
          i--;
          continue;
        }
        if (e.code !== 'export-pending' || i + 1 >= tries) {
          if (e.code === 'export-pending') {
            const left = e.answer?.bookmark ?? bookmark;
            if (left) {
              await stateFolder(dir);
              await writeFile(pendingFile, JSON.stringify({ origin, bookmark: left, at: new Date().toISOString() }));
            }
            throw Object.assign(
              new Error(
                `the export is still running on D1${e.answer?.bookmark ? ` (bookmark ${e.answer.bookmark})` : ''}: run ${CMD} db export --live again soon to pick it up. Until it ends, the game's database answers nothing else`,
              ),
              { code: e.code, bookmark: left, cause: e },
            );
          }
          throw e;
        }
        bookmark = e.answer?.bookmark ?? bookmark;
        log(
          `The export is still running on D1; asking again in ${wait / 1000} s. While it runs, the game's database answers nothing else (its players' calls wait or fail).`,
        );
        await new Promise(r => setTimeout(r, wait));
      }
    }
    await rm(pendingFile, { force: true });
    if (!a?.url) throw new Error('xgames.fun did not give an address for the dump');
    note = a.note ?? null;
    const res = await (opts.fetchImpl ?? fetch)(a.url);
    if (!res.ok) throw new Error(`the dump could not be downloaded (${res.status}): run it again`);
    text = Buffer.from(await res.arrayBuffer());
  } else text = Buffer.from(await withLocal(dir, db => dumpDatabase(db), { log, ...opts }));
  if (!out) await stateFolder(dir);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, { mode: 0o600 });
  return { ok: true, live, file, bytes: text.length, ...(note ? { note } : {}) };
}

/**
 * The import a file makes (./dev/d1.mjs importPlan), held to the limits before anything is asked or sent: the file is
 * there, at most 5 MB of SQL, and live at most 4.5 MB as sent (Studio's host). Throws in words. → the plan
 */
export async function importOf(file, { live = false } = {}) {
  if (!existsSync(file)) throw new Error(`${file} is not there`);
  const text = await readFile(file, 'utf8');
  if (Buffer.byteLength(text) > DATABASE_LIMITS.importBytes)
    throw new Error(`an import is at most ${DATABASE_LIMITS.importBytes / 1048576} MB of SQL; split it into parts`);
  const plan = importPlan(text);
  // live, the SQL goes as JSON through Studio, whose host takes at most 4.5 MB a request
  const sent = live ? Buffer.byteLength(JSON.stringify({ sql: plan.sql })) : 0;
  if (sent > STUDIO_BODY_BYTES)
    throw Object.assign(
      new Error(
        `this import is ${mb(sent)} as sent, and a request through xgames.fun's Studio is at most ${mb(STUDIO_BODY_BYTES)}: split it into smaller files and import each`,
      ),
      { code: 'too-big' },
    );
  return plan;
}

/**
 * SQL statements from a file, run in one batch: a dump from `xcore db export` (here or live, and D1's own) goes in over
 * the database as it is (or into an empty one), each row updated by its key where it is, none deleted, foreign keys
 * checked at the end; statements of your own run as they are
 * (./dev/d1.mjs importPlan). → {ok, live, meta | statements, dump, left}
 */
export async function dbImport(dir, file, { live = false, ...opts } = {}) {
  const plan = await importOf(file, { live });
  if (live)
    return {
      live: true,
      dump: plan.dump,
      left: plan.left,
      ...(await liveCall(dir, 'import', { method: 'POST', body: { sql: plan.sql } }, opts)),
    };
  return withLocal(
    dir,
    async db => {
      if (plan.statements.length) await db.batch(plan.statements.map(s => db.prepare(s)));
      return { ok: true, live: false, statements: plan.statements.length, dump: plan.dump, left: plan.left };
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
