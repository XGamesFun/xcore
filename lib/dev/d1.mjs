// The game's database on this machine (gamesfun.json → database; xgames.fun's STORAGE.md §8.2): a local D1, run by
// Miniflare as `xcore dev` runs the game's server, kept in <game>/.gamesfun/dev/d1/ (a hidden folder: never published),
// with the same migrations xgames.fun applies, in name order, each once. As on xgames.fun, the database itself records
// what it has applied, in its table _gf_migrations (name, sha256, applied_at in ms), written in the same batch as each
// migration's statements, as xgames.fun writes it: the row as started (applied_at = minus the time the batch began), the
// file's statements, the row finished (applied_at = that time). A negative applied_at is a file left partly applied:
// refused, with how to undo it, never taken as applied nor run again over itself. A migration that changed after
// it was applied here is refused, as xgames.fun refuses it (409 migration-changed): the database is left as it was and
// the server does not start until the migration is put back. `xcore db` (../db.mjs) reads and writes the same database.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  COMPATIBILITY_DATE,
  emptyMigration,
  migrationStatementsProblem,
  migrationsChanged,
} from '../server/contract.mjs';
import { stateFolder } from '../state-folder.mjs';

/** Where the local database lives. */
export const devFolder = dir => path.join(dir, '.gamesfun', 'dev');
export const d1Folder = dir => path.join(devFolder(dir), 'd1');
/** The record an xcore before this one kept beside the database, read once into _gf_migrations and then removed. */
const oldAppliedFile = dir => path.join(d1Folder(dir), 'gf-migrations.json');
/** The local database's id in Miniflare (one a game folder). */
export const LOCAL_D1_ID = 'gf-local-database';

/** The table in the game's database that records the migrations applied to it (the same name and shape live). */
export const MIGRATIONS_TABLE = '_gf_migrations';
/** xgames.fun's progress of a migration batch (§8.10): there while one runs, or after one failed part-way. */
export const STEPS_TABLE = '_gf_migration_steps';
const MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at INTEGER NOT NULL)`;
const RECORD = `INSERT INTO ${MIGRATIONS_TABLE} (name, sha256, applied_at) VALUES (?, ?, ?)`;
const FINISHED = `UPDATE ${MIGRATIONS_TABLE} SET applied_at = ? WHERE name = ?`;

/** A migration whose batch began and never finished (its row's applied_at is negative): what happened, and the way out. */
export function partlyApplied(name, startedAt) {
  const began = Number.isFinite(startedAt) && startedAt > 0 ? new Date(startedAt).toISOString() : null;
  return `${name} was partly applied: it failed part-way${began ? ` (it began at ${began})` : ''}, and the database kept the statements before the one that failed. It is not run again over itself. Undo or finish it by hand (xcore db query "…" --write), then delete its row (xcore db query "DELETE FROM ${MIGRATIONS_TABLE} WHERE name = '${name}'" --write); or, on this machine, delete .gamesfun/dev/d1/ to start the local database afresh. Then fix ${name}`;
}

/**
 * The tables that are the database's own machinery, not the game's: SQLite's, D1's, the migrations' record and
 * xgames.fun's progress of a migration batch.
 */
export const internalTable = name =>
  /^(sqlite_|_cf_|d1_)/i.test(String(name)) || name === MIGRATIONS_TABLE || name === STEPS_TABLE;

/**
 * The migrations recorded in `db` (a D1Database), in name order, the order they went in: [{name, sha256, at}] (`at` in
 * milliseconds; negative: started at -at and never finished). A database with no record yet has applied none.
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
 * 'migration-failed', name, why, applied, partly?}. A refusal leaves the database as it was before that migration;
 * `partly`: a migration an earlier batch left partly applied (refused until it is undone).
 */
export async function applyMigrations(dir, db, migrations, { now = () => Date.now() } = {}) {
  await db.prepare(MIGRATIONS_DDL).run();
  await adoptOldRecord(dir, db);
  const applied = await readApplied(db);
  const half = applied.find(a => !(a.at > 0));
  if (half)
    return {
      ok: false,
      code: 'migration-failed',
      name: half.name,
      why: partlyApplied(half.name, -half.at),
      applied: [],
      partly: true,
    };
  const changed = migrationsChanged(migrations, applied);
  if (changed) return { ok: false, ...changed, applied: [] };
  // every statement of every new migration measured before the first runs, as xgames.fun does (§8.10): one D1 cannot
  // run (over 100,000 bytes, or SQL that never ends) is refused with nothing of them applied
  for (const m of migrations.slice(applied.length)) {
    const why = m.bytes === 0 ? null : migrationStatementsProblem(m);
    if (why)
      return {
        ok: false,
        code: 'migration-failed',
        name: m.name,
        why: `${why}. Nothing of the new migrations was applied; fix ${m.name}`,
        applied: [],
      };
  }
  const done = [];
  for (const m of migrations.slice(applied.length)) {
    const why = emptyMigration(m);
    if (why) return { ok: false, code: 'migration-empty', name: m.name, why, applied: done };
    const statements = splitSql(m.text);
    const t = Math.max(1, Math.floor(now()));
    try {
      await db.batch([
        db.prepare(MIGRATIONS_DDL),
        db.prepare(RECORD).bind(m.name, m.sha256, -t),
        ...statements.map(s => db.prepare(s)),
        db.prepare(FINISHED).bind(t, m.name),
      ]);
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
  await stateFolder(dir);
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
    // a migration left partly applied: the database opens all the same (xcore db query --write is how it is mended),
    // with no other migration applied, and says so
    if (!r.ok && r.partly) log(`${r.why}.`);
    else if (!r.ok) throw Object.assign(new Error(`${r.why}.`), { code: r.code, name: r.name });
    return { db, applied: r.applied, partly: r.partly ? r.name : null, close: () => mf.dispose() };
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
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** A CREATE that stops a dump going into a database that has the object already: it gets IF NOT EXISTS. */
const CREATE =
  /^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?(?:UNIQUE\s+INDEX|INDEX|TABLE|VIEW|TRIGGER|VIRTUAL\s+TABLE)\s+(?!IF\s+NOT\s+EXISTS\b)/i;
const keepWhatIsThere = s => s.replace(CREATE, m => `${m.trimEnd()} IF NOT EXISTS `);

/**
 * What makes an INSERT of a dump go in over the database as it is: a row with the same key is updated where it is
 * (an upsert), never deleted and written again as REPLACE does, which would fire the ON DELETE CASCADE of every row
 * that points at it. `key`: the table's primary key, or rowid for a table without one; with no column but the key,
 * the row is there already as it is.
 */
const onConflict = (columns, key) => {
  const rest = columns.filter(c => !key.some(k => same(k, c)));
  return ` ON CONFLICT (${key.map(ident).join(', ')}) ${
    rest.length ? `DO UPDATE SET ${rest.map(c => `${ident(c)} = excluded.${ident(c)}`).join(', ')}` : 'DO NOTHING'
  }`;
};

/** SQL as its tokens, each {t: 'word' | 'name' (quoted) | 'text' | 'mark', v, start, end}, outside comments. */
function tokens(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) i++;
    else if (c === '-' && s[i + 1] === '-') i = s.indexOf('\n', i) < 0 ? s.length : s.indexOf('\n', i) + 1;
    else if (c === '/' && s[i + 1] === '*') i = s.indexOf('*/', i + 2) < 0 ? s.length : s.indexOf('*/', i + 2) + 2;
    else if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1,
        v = '';
      while (j < s.length) {
        if (s[j] === close && s[j + 1] === close && c !== '[') ((v += close), (j += 2));
        else if (s[j] === close) break;
        else v += s[j++];
      }
      out.push({ t: c === "'" ? 'text' : 'name', v, start: i, end: j + 1 });
      i = j + 1;
    } else if (/[A-Za-z0-9_$]/.test(c)) {
      const w = /^[A-Za-z0-9_$]+/.exec(s.slice(i))[0];
      out.push({ t: 'word', v: w, start: i, end: i + w.length });
      i += w.length;
    } else out.push({ t: 'mark', v: c, start: i, end: ++i });
  }
  return out;
}
const isWord = (tk, ...words) => tk?.t === 'word' && words.some(w => same(tk.v, w));
const nameOf = tk => (tk && (tk.t === 'name' || tk.t === 'word') ? tk.v : null);
/** A table's name in its tokens from `i` (main.x, "x", [x]): → {name, next} */
function tableAt(tk, i) {
  if (isWord(tk[i], 'main', 'temp') && tk[i + 1]?.v === '.' && tk[i + 1].t === 'mark') i += 2;
  return { name: nameOf(tk[i]), next: i + 1 };
}
/** The tokens between the ( at `i` and its ), split at its own commas: → {items: [tokens], next} */
function inParens(tk, i) {
  const items = [[]];
  let depth = 0;
  for (; i < tk.length; i++) {
    const v = tk[i].t === 'mark' ? tk[i].v : null;
    if (v === '(' && depth++ === 0) continue;
    if (v === ')' && --depth === 0) return { items: items.filter(x => x.length), next: i + 1 };
    if (v === ',' && depth === 1) items.push([]);
    else items.at(-1).push(tk[i]);
  }
  return null;
}

/**
 * The tables a dump makes, read from its CREATE TABLE statements: name (lower case) → {columns, key}, and `statements`,
 * the CREATE TABLEs read. `key` is the primary key's columns, or [] for a table without one. A table made AS SELECT,
 * or one that cannot be read, is not in it.
 */
function tablesOf(statements) {
  const out = Object.assign(new Map(), { statements: new Set() });
  for (const st of statements) {
    const tk = tokens(st);
    let i = 0;
    if (!isWord(tk[i++], 'CREATE')) continue;
    if (isWord(tk[i], 'TEMP', 'TEMPORARY')) i++;
    if (!isWord(tk[i++], 'TABLE')) continue;
    if (isWord(tk[i], 'IF') && isWord(tk[i + 1], 'NOT') && isWord(tk[i + 2], 'EXISTS')) i += 3;
    const { name, next } = tableAt(tk, i);
    if (!name || tk[next]?.v !== '(') continue;
    const body = inParens(tk, next);
    if (!body) continue;
    const columns = [];
    let key = [];
    for (const item of body.items) {
      if (isWord(item[0], 'CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN')) {
        const at = item.findIndex((x, j) => isWord(x, 'PRIMARY') && isWord(item[j + 1], 'KEY'));
        const list = at >= 0 && inParens(item, at + 2);
        if (list) key = list.items.map(x => nameOf(x[0])).filter(Boolean);
        continue;
      }
      const column = nameOf(item[0]);
      if (!column) continue;
      columns.push(column);
      if (item.some((x, j) => j > 0 && isWord(x, 'PRIMARY') && isWord(item[j + 1], 'KEY'))) key = [column];
    }
    out.set(name.toLowerCase(), { columns, key });
    out.statements.add(st);
  }
  return out;
}

/**
 * An INSERT of a dump made to go in over what is there without deleting anything. A plain INSERT INTO, INSERT OR
 * REPLACE INTO or REPLACE INTO (D1's export writes the first) becomes an upsert on the table's key: its columns are the
 * statement's own list, or the table's in the dump's CREATE TABLE. One already with an ON CONFLICT (xcore's export),
 * or any other statement, is left as it is. One into a table the dump does not make, or one without a key, is a plain
 * INSERT INTO (it adds its rows, or fails on a key that is there, and never deletes one).
 */
function upsertOf(st, tables) {
  const tk = tokens(st);
  let i;
  if (isWord(tk[0], 'REPLACE')) i = 1;
  else if (isWord(tk[0], 'INSERT') && isWord(tk[1], 'OR') && isWord(tk[2], 'REPLACE')) i = 3;
  else if (isWord(tk[0], 'INSERT')) i = 1;
  else return st;
  if (!isWord(tk[i++], 'INTO')) return st;
  const { name, next } = tableAt(tk, i);
  const head = tk[i].start;
  let columns = null,
    j = next;
  if (tk[j]?.v === '(') {
    const list = inParens(tk, j);
    if (!list) return st;
    columns = list.items.map(x => nameOf(x[0]));
    j = list.next;
  }
  if (!isWord(tk[j], 'VALUES')) return st;
  // an ON CONFLICT or RETURNING of its own, outside the rows' parentheses
  let depth = 0;
  for (const x of tk.slice(j)) {
    if (x.t === 'mark' && x.v === '(') depth++;
    else if (x.t === 'mark' && x.v === ')') depth--;
    else if (depth === 0 && isWord(x, 'ON', 'RETURNING')) return st;
  }
  const table = name && tables.get(name.toLowerCase());
  const rest = `INSERT INTO ${st.slice(head)}`;
  if (!table) return rest;
  columns ??= table.columns;
  const key = table.key.length ? table.key : columns.filter(c => /^(rowid|_rowid_|oid)$/i.test(c ?? '')).slice(0, 1);
  if (!key.length || columns.some(c => !c) || !key.every(k => columns.some(c => same(c, k)))) return rest;
  return rest + onConflict(columns, key);
}

/** A statement on the migrations' record (_gf_migrations) or xgames.fun's progress of their batch (_gf_migration_steps). */
const ON_RECORD = new RegExp(
  String.raw`^(?:CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?|INSERT\s+(?:OR\s+[A-Z]+\s+)?INTO\s+|REPLACE\s+INTO\s+|DELETE\s+FROM\s+|UPDATE\s+(?:OR\s+[A-Z]+\s+)?|DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?|ALTER\s+TABLE\s+)(?:main\s*\.\s*)?["\x60[]?(?:${MIGRATIONS_TABLE}|${STEPS_TABLE})\b`,
  'i',
);
const DUMP_MARK = /^PRAGMA\s+defer_foreign_keys\b/i;

/**
 * What an import runs (`xcore db import`, here and live). A dump (its first statement PRAGMA defer_foreign_keys, as
 * xcore's and D1's exports begin) goes in over the database as it is, or into an empty one: each CREATE gets IF NOT
 * EXISTS, so the tables the migrations made are kept; each INSERT updates the row with the same key in place (an
 * upsert: nothing is deleted, so no ON DELETE CASCADE fires); and the PRAGMA stays first, here as live, so a row may
 * point at one the dump writes after it. Its _gf_migrations (and any _gf_migration_steps) is the record of the database
 * it came from, so it is left out (this database keeps its own). SQL of your own runs as it is, and may touch neither.
 * → {sql (the text to send live), statements (to run here, the PRAGMA first), dump, left (statements left out)}
 */
export function importPlan(text) {
  const all = splitSql(text);
  const dump = DUMP_MARK.test(all[0] ?? '');
  if (!dump) {
    const touch = all.find(st => ON_RECORD.test(st));
    if (touch)
      throw Object.assign(
        new Error(
          `${MIGRATIONS_TABLE} and ${STEPS_TABLE} are the database's record of its migrations, which xcore and xgames.fun keep: an import does not change them (${touch.slice(0, 60)}…)`,
        ),
        { code: 'bad-sql' },
      );
    return { sql: text, statements: all, dump: false, left: 0 };
  }
  const body = all.slice(1).filter(st => !ON_RECORD.test(st));
  const tables = tablesOf(body);
  // the tables first: an INSERT into one whose foreign key names a table not made yet fails, deferred or not
  const made = st => tables.statements.has(st);
  const statements = [all[0], ...body.filter(made), ...body.filter(st => !made(st))].map((st, i) =>
    i ? upsertOf(keepWhatIsThere(st), tables) : st,
  );
  return {
    sql: statements.map(st => `${st};`).join('\n') + '\n',
    statements,
    dump: true,
    left: all.length - statements.length,
  };
}

/**
 * The database as SQL text: its tables (CREATE TABLE IF NOT EXISTS) and their rows (INSERT … ON CONFLICT DO UPDATE on
 * the table's key, the rowid with them for a table without a primary key), then indexes, views and triggers, after
 * PRAGMA defer_foreign_keys, so a row may come before the one it points at. It goes back in with `xcore db import`,
 * here or live, over a database whose migrations made the same tables (each row updated where it is, none deleted,
 * none twice) or into an empty one. _gf_migrations is left out: it is the record of this database's migrations, and
 * the database it goes into keeps its own.
 */
export async function dumpDatabase(db) {
  const { results: all } = await db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name",
    )
    .all();
  const objects = all.filter(o => !internalTable(o.name) && !internalTable(o.tbl_name));
  const lines = [
    'PRAGMA defer_foreign_keys=TRUE;',
    `-- the game's database, from xcore db export: xcore db import puts it back (tables kept, each row updated where it is, none deleted). ${MIGRATIONS_TABLE} is left out: each database keeps its own.`,
  ];
  const tables = objects.filter(x => x.type === 'table');
  // every table before any row: a row's foreign key may name a table that comes after its own
  for (const o of tables) lines.push(`${keepWhatIsThere(o.sql)};`);
  for (const o of tables) {
    if (/^CREATE\s+VIRTUAL\b/i.test(o.sql)) continue; // its rows are in its own tables, dumped with the rest
    // table_info leaves out generated columns, which take no value of their own
    const { results: info } = await db.prepare(`PRAGMA table_info(${ident(o.name)})`).all();
    const pk = info.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk);
    // a table without a primary key is told its rows apart by rowid: kept, so an import updates and never doubles
    const rowid = !pk.length && !info.some(c => /^(rowid|_rowid_|oid)$/i.test(c.name));
    const columns = [...(rowid ? ['rowid'] : []), ...info.map(c => c.name)];
    const key = pk.length ? pk.map(c => c.name) : rowid ? ['rowid'] : [];
    const tail = key.length ? onConflict(columns, key) : '';
    const { results: rows } = await db
      .prepare(
        `SELECT ${columns.map(c => (c === 'rowid' && rowid ? 'rowid AS "rowid"' : ident(c))).join(', ')} FROM ${ident(o.name)}`,
      )
      .all();
    for (const r of rows)
      lines.push(
        `INSERT INTO ${ident(o.name)} (${columns.map(ident).join(', ')}) VALUES (${columns.map(c => quote(r[c])).join(', ')})${tail};`,
      );
  }
  for (const o of objects.filter(x => x.type !== 'table')) lines.push(`${keepWhatIsThere(o.sql)};`);
  return lines.join('\n') + '\n';
}
