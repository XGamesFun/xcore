// The game's database on this machine (gamesfun.json → database; xgames.fun's STORAGE.md §8.2): a local D1, run by
// Miniflare as `xcore dev` runs the game's server, kept in <game>/.gamesfun/dev/d1/ (a hidden folder: never published),
// with the same migrations xgames.fun applies, in name order, each once. As on xgames.fun, the database itself records
// what it has applied, in its table _gf_migrations (name, sha256, applied_at), written in the same batch as each
// migration's statements: a migration is in the database with its record, or neither is. A migration that changed after
// it was applied here is refused, as xgames.fun refuses it (409 migration-changed): the database is left as it was and
// the server does not start until the migration is put back. `xcore db` (../db.mjs) reads and writes the same database.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { COMPATIBILITY_DATE, emptyMigration, migrationsChanged } from '../server/contract.mjs';

/** Where the local database lives. */
export const devFolder = dir => path.join(dir, '.gamesfun', 'dev');
export const d1Folder = dir => path.join(devFolder(dir), 'd1');
/** The record an xcore before this one kept beside the database, read once into _gf_migrations and then removed. */
const oldAppliedFile = dir => path.join(d1Folder(dir), 'gf-migrations.json');
/** The local database's id in Miniflare (one a game folder). */
export const LOCAL_D1_ID = 'gf-local-database';

/** The table in the game's database that records the migrations applied to it (the same name and shape live). */
export const MIGRATIONS_TABLE = '_gf_migrations';
const MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at INTEGER NOT NULL)`;
const RECORD = `INSERT INTO ${MIGRATIONS_TABLE} (name, sha256, applied_at) VALUES (?, ?, ?)`;

/** The tables that are the database's own machinery, not the game's: SQLite's, D1's, and the migrations' record. */
export const internalTable = name => /^(sqlite_|_cf_|d1_)/i.test(String(name)) || name === MIGRATIONS_TABLE;

/**
 * The migrations applied to `db` (a D1Database), in name order, the order they went in: [{name, sha256, at}] (`at` in
 * milliseconds). A database with no record yet has applied none.
 */
export async function readApplied(db) {
  await db.prepare(MIGRATIONS_DDL).run();
  const { results } = await db.prepare(`SELECT name, sha256, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY name`).all();
  return (results ?? []).map(r => ({ name: r.name, sha256: r.sha256, at: Number(r.applied_at) }));
}

/** An xcore before this one kept the record in a file beside the database: it goes into the table, once. */
async function adoptOldRecord(dir, db) {
  const file = dir ? oldAppliedFile(dir) : null;
  if (!file || !existsSync(file)) return;
  let old = [];
  try {
    const v = JSON.parse(await readFile(file, 'utf8'));
    old = Array.isArray(v) ? v.filter(m => typeof m?.name === 'string' && typeof m?.sha256 === 'string') : [];
  } catch {
    /* unreadable: nothing to carry over */
  }
  if (old.length && !(await readApplied(db)).length)
    await db.batch(old.map(m => db.prepare(RECORD).bind(m.name, m.sha256, Date.parse(m.at) || Date.now())));
  await rm(file, { force: true });
}

/**
 * SQL text as its statements, each without its closing `;`. Quotes, comments and a trigger's BEGIN … END (whose
 * statements end in `;` too) are read as SQLite reads them.
 */
export function splitSql(text) {
  const out = [];
  let start = 0,
    depth = 0,
    i = 0;
  const TRIGGER = /^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i;
  let trigger = TRIGGER.test(text.slice(0, 4096));
  const word = () => /^[A-Za-z_]+/.exec(text.slice(i, i + 64))?.[0]?.toUpperCase() ?? '';
  const push = end => {
    const s = text
      .slice(start, end)
      .replace(/^(\s|--[^\n]*(\n|$)|\/\*[\s\S]*?\*\/)+/, '')
      .trim();
    if (s) out.push(s);
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '-' && text[i + 1] === '-') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? text.length : nl + 1;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      i++;
      while (i < text.length) {
        if (text[i] === close && text[i + 1] === close && c !== '[') i += 2;
        else if (text[i] === close) break;
        else i++;
      }
      i++;
    } else if (/[A-Za-z_]/.test(c) && !/[A-Za-z0-9_$]/.test(text[i - 1] ?? '')) {
      const w = word();
      // inside a trigger, BEGIN and CASE open what END closes
      if (trigger) {
        if (w === 'BEGIN' || (w === 'CASE' && depth > 0)) depth++;
        else if (w === 'END' && depth > 0) depth--;
      }
      i += w.length;
    } else if (c === ';' && depth === 0) {
      push(i);
      start = ++i;
      trigger = TRIGGER.test(text.slice(start, start + 4096));
    } else i++;
  }
  push(text.length);
  return out;
}

/**
 * Apply the migrations not applied yet to `db` (a D1Database), in order, each in one batch with its record in
 * _gf_migrations (all of it or none). `dir`: the game folder, for an older xcore's record file (null: none).
 * → {ok: true, applied: [names applied now]} | {ok: false, code: 'migration-changed' | 'migration-empty' |
 * 'migration-failed', name, why, applied}. A refusal leaves the database as it was before that migration.
 */
export async function applyMigrations(dir, db, migrations, { now = () => Date.now() } = {}) {
  await db.prepare(MIGRATIONS_DDL).run();
  await adoptOldRecord(dir, db);
  const applied = await readApplied(db);
  const changed = migrationsChanged(migrations, applied);
  if (changed) return { ok: false, ...changed, applied: [] };
  const done = [];
  for (const m of migrations.slice(applied.length)) {
    const why = emptyMigration(m);
    if (why) return { ok: false, code: 'migration-empty', name: m.name, why, applied: done };
    const statements = splitSql(m.text);
    try {
      await db.batch([...statements.map(s => db.prepare(s)), db.prepare(RECORD).bind(m.name, m.sha256, now())]);
    } catch (e) {
      return {
        ok: false,
        code: 'migration-failed',
        name: m.name,
        why: `${m.name} failed: ${
          String(e?.message ?? e)
            .replace(/^D1_ERROR:\s*/, '')
            .split('\n')[0]
        }${done.length ? ` (${done.join(', ')} before it went in)` : ''}`,
        applied: done,
      };
    }
    done.push(m.name);
  }
  return { ok: true, applied: done };
}

/** Miniflare's options for the D1 binding of a game's server. */
export const d1Options = (dir, binding) => ({
  d1Databases: { [binding]: LOCAL_D1_ID },
  d1Persist: d1Folder(dir),
});

/**
 * The local database on its own, for `xcore db` (no game server needed): a Miniflare with one empty Worker and the
 * binding, its migrations applied first. → {db, applied, close()}. Throws in words when a migration is refused.
 */
export async function openLocalDatabase(dir, database, { log = () => {}, env = process.env } = {}) {
  const { loadMiniflare } = await import('./tools.mjs');
  const { Miniflare } = await loadMiniflare({ log, env });
  await mkdir(d1Folder(dir), { recursive: true });
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch: () => new Response(null, { status: 404 }) };',
    compatibilityDate: COMPATIBILITY_DATE,
    ...d1Options(dir, database.binding),
  });
  try {
    const db = await mf.getD1Database(database.binding);
    const r = await applyMigrations(dir, db, database.migrations);
    if (!r.ok) throw Object.assign(new Error(`${r.why}.`), { code: r.code, name: r.name });
    return { db, applied: r.applied, close: () => mf.dispose() };
  } catch (e) {
    await mf.dispose().catch(() => {});
    if (e.code) throw e;
    throw new Error(
      `the local database did not open (${String(e?.message ?? e).split('\n')[0]}). If ${'`xcore dev`'} is running for this game, stop it first`,
      { cause: e },
    );
  }
}

/** Has this game a local database yet? */
export const hasLocalDatabase = dir => existsSync(d1Folder(dir));

const quote = v =>
  v === null || v === undefined
    ? 'NULL'
    : typeof v === 'number' || typeof v === 'bigint'
      ? String(v)
      : v instanceof ArrayBuffer || ArrayBuffer.isView(v) || Array.isArray(v)
        ? `X'${Buffer.from(Array.isArray(v) ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : v).toString('hex')}'`
        : `'${String(v).replace(/'/g, "''")}'`;
const ident = name => `"${String(name).replace(/"/g, '""')}"`;

/** The database as SQL text (its tables, their rows, then indexes, views and triggers), as D1's export writes one. */
export async function dumpDatabase(db) {
  const { results: all } = await db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name",
    )
    .all();
  const objects = all.filter(o => !internalTable(o.name) && !internalTable(o.tbl_name));
  const lines = ['PRAGMA defer_foreign_keys=TRUE;'];
  for (const o of objects.filter(x => x.type === 'table')) {
    lines.push(`${o.sql};`);
    const { results: rows } = await db.prepare(`SELECT * FROM ${ident(o.name)}`).all();
    for (const r of rows)
      lines.push(
        `INSERT INTO ${ident(o.name)} (${Object.keys(r).map(ident).join(', ')}) VALUES (${Object.values(r).map(quote).join(', ')});`,
      );
  }
  for (const o of objects.filter(x => x.type !== 'table')) lines.push(`${o.sql};`);
  return lines.join('\n') + '\n';
}
