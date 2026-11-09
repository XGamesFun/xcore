// The game's own D1 database (gamesfun.json → database; xgames.fun's STORAGE.md §8): the block's rules, `xcore add
// database` with and without a server, the stock server (the same answers as server/database.js, over D1), the
// migrations in the publish manifest and xgames.fun's refusals of them, and `xcore db` against a stand-in xgames.fun.
// The local D1 (xcore dev, xcore db without --live) needs Miniflare: GAMESFUN_SERVER_DEPS, as tests/dev.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { addDatabase, addMultiplayer } from '../lib/add.mjs';
import { bundleServer } from '../lib/server/bundle.mjs';
import { migrationsChanged, publishField, readServerConfig } from '../lib/server/contract.mjs';
import { splitSql } from '../lib/dev/d1.mjs';
import { queryProblem, readOnlyProblem, sqlStatements } from '../lib/db.mjs';
import { adopt } from '../lib/publish/adopt.mjs';
import { publishGame, preflight, checkSummary } from '../lib/publish/index.mjs';
import { fixture, passing, runAsync, signIn, standIn, tempDir } from './helpers.mjs';

// database.js imports cloudflare:workers (a Durable Object's base class); here a stand-in
register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(s, c, next) { if (s === 'cloudflare:workers') return { url: 'data:text/javascript,' + encodeURIComponent('export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }'), shortCircuit: true }; return next(s, c); }`,
    ),
);
const { GameData, handleDatabase } = await import('../lib/client/server/database.js');

const sha = b => createHash('sha256').update(b).digest('hex');
const noMiniflare = process.env.GAMESFUN_SERVER_DEPS
  ? false
  : 'GAMESFUN_SERVER_DEPS (a folder with miniflare) is not set';

/** A game folder: index.html, gamesfun.json, and any more files ({path: text}). */
async function game(tmp, config, files = {}) {
  const dir = path.join(tmp.dir, `g${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>g</title>');
  if (config) await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify(config));
  for (const [p, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, p)), { recursive: true });
    await writeFile(path.join(dir, p), text);
  }
  return dir;
}
const SERVER = 'export default { fetch: () => new Response("ok") };\n';

/** D1's shape over node:sqlite: prepare(q).bind(...).all() / first() / run(), and batch() (all or none). */
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  const prep = (q, b = []) => ({
    bind: (...v) => prep(q, v),
    all: async () => ({ results: db.prepare(q).all(...b), meta: {} }),
    first: async () => db.prepare(q).get(...b) ?? null,
    run: async () => {
      const r = db.prepare(q).run(...b);
      return { meta: { changes: r.changes, last_row_id: r.lastInsertRowid } };
    },
    q,
    b,
  });
  return {
    db,
    prepare: q => prep(q),
    batch: async list => {
      db.exec('BEGIN');
      try {
        const out = list.map(s => ({ results: db.prepare(s.q).all(...s.b) }));
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

test('gamesfun.json → database: the binding, the migrations and the collections follow §8.2', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const problems = async (config, files) => (await readServerConfig(await game(tmp, config, files))).problems;
  // the defaults: env.DB, server/migrations, each player's own documents
  const stock = await readServerConfig(await game(tmp, { database: {} }));
  assert.equal(stock.stock, true, 'a database and no server/: the stock server');
  assert.equal(stock.has, true);
  assert.deepEqual(
    [stock.database.binding, stock.database.migrationsDir, stock.database.collections],
    ['DB', 'server/migrations', { '*': { read: 'owner', write: 'owner' } }],
  );
  // binding: A–Z, 0–9, _, never GF or GF_*, never a Durable Object's
  for (const binding of ['db', 'GF', 'GF_DATA', '1DB', 'A'.repeat(33)])
    assert.match((await problems({ database: { binding } })).join('\n'), /database\.binding/, binding);
  const clash = await problems(
    { server: { objects: [{ class: 'Room', binding: 'ROOM' }] }, database: { binding: 'ROOM' } },
    { 'server/index.js': `${SERVER}export class Room {}\n` },
  );
  assert.match(clash.join('\n'), /database\.binding ROOM is also a Durable Object's binding/);
  // engine, keys, the folder
  assert.match((await problems({ database: { engine: 'postgres' } })).join('\n'), /database\.engine is "d1"/);
  assert.match(
    (await problems({ database: { tables: [] } })).join('\n'),
    /database has "tables", which it does not know/,
  );
  assert.match(
    (await problems({ database: { migrations: 'migrations' } })).join('\n'),
    /a folder inside server\//,
    'outside server/, a migration would be a public file',
  );
  assert.match((await problems({ database: { migrations: 'server/../x' } })).join('\n'), /inside server\//);
  // file names, numbers, other files
  const named = await readServerConfig(
    await game(
      tmp,
      { database: {} },
      {
        'server/migrations/0001_init.sql': 'CREATE TABLE a (x);',
        'server/migrations/0002_Add Guilds.sql': 'CREATE TABLE b (x);',
        'server/migrations/0003_x.sql': 'CREATE TABLE c (x);',
        'server/migrations/0003_y.sql': 'CREATE TABLE d (x);',
        'server/migrations/notes.md': 'why',
      },
    ),
  );
  assert.match(named.problems.join('\n'), /0002_Add Guilds\.sql: a migration's name is four digits/);
  assert.match(named.problems.join('\n'), /0003_x\.sql and 0003_y\.sql have the same number/);
  assert.match(named.warnings.join('\n'), /notes\.md is not a migration/);
  // an empty migration (0 bytes) is refused, as xgames.fun refuses it
  assert.match(
    (await problems({ database: {} }, { 'server/migrations/0001_init.sql': '' })).join('\n'),
    /server\/migrations\/0001_init\.sql is empty \(0 bytes\)/,
  );
  assert.deepEqual(
    named.database.migrations.map(m => m.name),
    ['0001_init.sql', '0003_x.sql'],
  );
  // collections: names and rules
  assert.match(
    (await problems({ database: { collections: { 'bad name': { read: 'owner' } } } })).join('\n'),
    /"bad name" is not a collection's name/,
  );
  assert.match(
    (await problems({ database: { collections: { levels: { read: 'everyone' } } } })).join('\n'),
    /collections\.levels is \{"read": "owner" \| "anyone"/,
  );
  const own = await readServerConfig(
    await game(tmp, { database: { collections: { '*': { read: 'anyone' } } } }, { 'server/index.js': SERVER }),
  );
  assert.equal(own.stock, false);
  assert.deepEqual(own.database.collections, { '*': { read: 'anyone' } }, "a server of its own's, for gf-docs.js");
  const none = await readServerConfig(await game(tmp, { database: {} }, { 'server/index.js': SERVER }));
  assert.equal(none.database.collections, null, 'none given: a server of its own writes its rules in code');
});

test('append only: the migrations applied must come first, each the same bytes', () => {
  const m = (name, text) => ({ name, sha256: sha(text) });
  const applied = [m('0001_a.sql', 'A'), m('0002_b.sql', 'B')];
  assert.equal(migrationsChanged([...applied, m('0003_c.sql', 'C')], applied), null, 'a new one after them');
  assert.match(migrationsChanged([m('0001_a.sql', 'A!'), applied[1]], applied).why, /0001_a\.sql changed after it/);
  assert.match(migrationsChanged([applied[0]], applied).why, /0002_b\.sql was applied .* not there any more/);
  assert.match(
    migrationsChanged([applied[0], m('0001_z.sql', 'Z'), applied[1]], applied).why,
    /0001_z\.sql comes before 0002_b\.sql/,
  );
  assert.equal(migrationsChanged([applied[0], applied[1]], applied), null);
});

test("a statement over D1's 100,000 bytes: refused before publish and by xcore dev, with nothing of the new migrations applied", async t => {
  const { applyMigrations, readApplied } = await import('../lib/dev/d1.mjs');
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const init = 'CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT);\n';
  const big = `-- seed\nINSERT INTO notes (text) VALUES ('a');\nINSERT INTO notes (text) VALUES ('${'x'.repeat(100_000)}');\n`;
  // a migration may still be up to 1 MB of many statements, and a comment is not sent, so it does not count
  const many = `-- ${'c'.repeat(60_000)}\n${Array.from({ length: 12 }, () => `INSERT INTO notes (text) VALUES ('${'y'.repeat(60_000)}');`).join('\n')}\n`;
  const dir = await game(
    tmp,
    { database: {} },
    {
      'server/migrations/0001_init.sql': init,
      'server/migrations/0002_many.sql': many,
      'server/migrations/0003_seed.sql': big,
    },
  );
  const cfg = await readServerConfig(dir);
  assert.equal(cfg.problems.length, 1, cfg.problems.join('\n'));
  assert.match(
    cfg.problems[0],
    /^server\/migrations\/0003_seed\.sql: Statement 2 of 0003_seed\.sql \(INSERT INTO notes \(text\) VALUES \('x+…\) is 100,036 bytes, and D1 runs at most 100,000 bytes in one statement\. Split it \(an INSERT of many rows into several INSERTs, each under the limit\)\. xgames\.fun would refuse it \(migration-failed\)$/,
  );
  // SQL that never ends is refused the same way
  await writeFile(path.join(dir, 'server/migrations/0003_seed.sql'), "INSERT INTO notes (text) VALUES ('open);\n");
  assert.match(
    (await readServerConfig(dir)).problems.join('\n'),
    /0003_seed\.sql has a string, a quoted name or a comment that never ends/,
  );
  // xcore dev (applyMigrations): every new migration measured before the first runs
  const m = (name, text) => ({ name, text, sha256: sha(text), bytes: Buffer.byteLength(text) });
  const db = fakeD1();
  assert.deepEqual(await applyMigrations(null, db, [m('0001_init.sql', init)]), {
    ok: true,
    applied: ['0001_init.sql'],
  });
  const r = await applyMigrations(null, db, [
    m('0001_init.sql', init),
    m('0002_many.sql', many),
    m('0003_seed.sql', big),
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'migration-failed');
  assert.equal(r.name, '0003_seed.sql');
  assert.match(
    r.why,
    /^Statement 2 of 0003_seed\.sql .* is 100,036 bytes, and D1 runs at most 100,000 bytes in one statement\. .*Nothing of the new migrations was applied; fix 0003_seed\.sql$/,
  );
  assert.deepEqual(
    (await readApplied(db)).map(a => a.name),
    ['0001_init.sql'],
    '0002_many.sql, which fits, waits for 0003 to be fixed',
  );
  const fixed = await applyMigrations(null, db, [m('0001_init.sql', init), m('0002_many.sql', many)]);
  assert.deepEqual(fixed, { ok: true, applied: ['0002_many.sql'] });
});

test('the database records its migrations in _gf_migrations, in the batch with their statements', async t => {
  const { applyMigrations, readApplied } = await import('../lib/dev/d1.mjs');
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const m = (name, text) => ({
    name,
    path: `server/migrations/${name}`,
    text,
    sha256: sha(text),
    bytes: Buffer.byteLength(text),
  });
  const one = m('0001_init.sql', 'CREATE TABLE players (id TEXT PRIMARY KEY);');
  const d1 = fakeD1();
  let r = await applyMigrations(null, d1, [one], { now: () => 7 });
  assert.deepEqual(r, { ok: true, applied: ['0001_init.sql'] });
  assert.deepEqual(
    d1.db
      .prepare('SELECT * FROM _gf_migrations')
      .all()
      .map(x => ({ ...x })),
    [{ name: '0001_init.sql', sha256: one.sha256, applied_at: 7 }],
  );
  assert.deepEqual(await readApplied(d1), [{ name: '0001_init.sql', sha256: one.sha256, at: 7 }]);
  // again: nothing to do
  assert.deepEqual(await applyMigrations(null, d1, [one]), { ok: true, applied: [] });
  // a migration that fails leaves neither its statements nor its record
  const bad = m('0002_bad.sql', 'CREATE TABLE guilds (id TEXT);\nCREATE TABLE players (dup INT);');
  r = await applyMigrations(null, d1, [one, bad]);
  assert.equal(r.code, 'migration-failed');
  assert.equal(d1.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'guilds'").get().n, 0);
  assert.equal(d1.db.prepare('SELECT count(*) AS n FROM _gf_migrations').get().n, 1);
  // an empty one is refused before anything runs
  r = await applyMigrations(null, d1, [one, m('0002_none.sql', '')]);
  assert.equal(r.code, 'migration-empty');
  assert.match(r.why, /0002_none\.sql is empty \(0 bytes\)/);
  // changed after it was applied: refused, from what the database itself recorded
  r = await applyMigrations(null, d1, [m('0001_init.sql', 'CREATE TABLE players (id TEXT);')]);
  assert.equal(r.code, 'migration-changed');
  // a row left as started (negative applied_at: a batch that stopped part-way) is refused, with how to undo it
  d1.db.exec(`INSERT INTO _gf_migrations VALUES ('0002_half.sql', 'x', -${Date.parse('2026-11-08T09:00:00Z')})`);
  r = await applyMigrations(null, d1, [
    one,
    m('0002_half.sql', 'CREATE TABLE half (x);'),
    m('0003_n.sql', 'SELECT 1;'),
  ]);
  assert.deepEqual([r.ok, r.code, r.name, r.partly, r.applied], [false, 'migration-failed', '0002_half.sql', true, []]);
  assert.match(
    r.why,
    /0002_half\.sql was partly applied: it failed part-way \(it began at 2026-11-08T09:00:00\.000Z\)/,
  );
  assert.match(r.why, /DELETE FROM _gf_migrations WHERE name = '0002_half\.sql'/);
  assert.equal(d1.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'half'").get().n, 0, 'not run');
  // the file an earlier xcore kept beside the database is read into the table once, then removed
  const dir = path.join(tmp.dir, 'old');
  const file = path.join(dir, '.gamesfun', 'dev', 'd1', 'gf-migrations.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify([{ name: one.name, sha256: one.sha256, at: '2026-11-08T00:00:00.000Z' }]));
  const old = fakeD1();
  old.db.exec(one.text);
  assert.deepEqual(await applyMigrations(dir, old, [one]), { ok: true, applied: [] }, 'not applied a second time');
  assert.equal(existsSync(file), false);
  assert.deepEqual(
    (await readApplied(old)).map(a => [a.name, a.at]),
    [['0001_init.sql', Date.parse('2026-11-08T00:00:00.000Z')]],
  );
});

test('xcore db export and import round-trip: a dump goes back in over the tables its migrations made', async () => {
  const { dumpDatabase, importPlan, applyMigrations, internalTable } = await import('../lib/dev/d1.mjs');
  const text =
    'CREATE TABLE players (id TEXT PRIMARY KEY, gold INT);\nCREATE TABLE log (what TEXT);\nCREATE INDEX log_by_what ON log (what);';
  const migrations = [{ name: '0001_init.sql', text, sha256: sha(text), bytes: text.length }];
  const from = fakeD1();
  await applyMigrations(null, from, migrations);
  from.db.exec(
    "INSERT INTO players VALUES ('p1', 3), ('it''s', NULL); INSERT INTO log VALUES ('a'), ('a'), ('b'); CREATE TABLE gf_docs (k TEXT PRIMARY KEY); INSERT INTO gf_docs VALUES ('x')",
  );
  // xgames.fun's progress of a migration batch, as one that failed part-way leaves it: machinery, not the game's
  from.db.exec(
    "CREATE TABLE _gf_migration_steps (name TEXT PRIMARY KEY, began INTEGER NOT NULL, done INTEGER NOT NULL, total INTEGER NOT NULL); INSERT INTO _gf_migration_steps VALUES ('0002_x.sql', 5, 1, 3)",
  );
  const dump = await dumpDatabase(from);
  assert.doesNotMatch(dump, /_gf_migration_steps/);
  assert.match(dump, /^PRAGMA defer_foreign_keys=TRUE;/);
  assert.match(dump, /CREATE TABLE IF NOT EXISTS players/);
  assert.match(dump, /CREATE INDEX IF NOT EXISTS log_by_what/);
  assert.match(
    dump,
    /INSERT INTO "log" \("rowid", "what"\) VALUES \(1, 'a'\) ON CONFLICT \("rowid"\) DO UPDATE SET "what" = excluded\."what";/,
    'no key: its rowid',
  );
  assert.match(
    dump,
    /INSERT INTO "players" \("id", "gold"\) VALUES \('p1', 3\) ON CONFLICT \("id"\) DO UPDATE SET "gold" = excluded\."gold";/,
  );
  assert.doesNotMatch(dump, /REPLACE/, 'never REPLACE, which deletes the row first');
  assert.doesNotMatch(dump, /INSERT[^\n]*_gf_migrations|CREATE TABLE[^\n]*_gf_migrations/);
  // into another database with the same migrations, twice: every row once
  const into = fakeD1();
  await applyMigrations(null, into, migrations);
  const run = async plan => into.batch(plan.statements.map(st => into.prepare(st)));
  await run(importPlan(dump));
  await run(importPlan(dump));
  const rows = q =>
    into.db
      .prepare(q)
      .all()
      .map(r => ({ ...r }));
  assert.deepEqual(rows('SELECT * FROM players ORDER BY id'), [
    { id: "it's", gold: null },
    { id: 'p1', gold: 3 },
  ]);
  assert.deepEqual(rows('SELECT what FROM log ORDER BY rowid'), [{ what: 'a' }, { what: 'a' }, { what: 'b' }]);
  assert.deepEqual(rows('SELECT k FROM gf_docs'), [{ k: 'x' }]);
  assert.deepEqual(rows('SELECT name FROM _gf_migrations'), [{ name: '0001_init.sql' }]);
  assert.equal(
    into.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = '_gf_migration_steps'").get().n,
    0,
  );
  // D1's own export (CREATE TABLE, INSERT INTO … VALUES, its _gf_migrations) goes in the same way
  const d1 = importPlan(
    "PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE players (id TEXT PRIMARY KEY, gold INT);\nINSERT INTO \"players\" VALUES('p1',9);\nCREATE TABLE _gf_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at INTEGER NOT NULL);\nINSERT INTO \"_gf_migrations\" VALUES('0001_init.sql','x',1);\nCREATE TABLE _gf_migration_steps (name TEXT PRIMARY KEY, began INTEGER NOT NULL, done INTEGER NOT NULL, total INTEGER NOT NULL);\nINSERT INTO \"_gf_migration_steps\" VALUES('0002_x.sql',5,1,3);",
  );
  assert.equal(d1.left, 4, 'its record of migrations and their progress left out');
  await run(d1);
  assert.deepEqual(rows("SELECT gold FROM players WHERE id = 'p1'"), [{ gold: 9 }]);
  assert.deepEqual(rows('SELECT sha256 FROM _gf_migrations'), [{ sha256: sha(text) }]);
  assert.match(d1.sql, /^PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE IF NOT EXISTS players/);
  assert.match(
    d1.sql,
    /INSERT INTO "players" VALUES\('p1',9\) ON CONFLICT \("id"\) DO UPDATE SET "gold" = excluded\."gold";/,
  );
  assert.equal(d1.statements[0], 'PRAGMA defer_foreign_keys=TRUE', 'here as live, the PRAGMA goes first');
  // SQL of your own runs as written, and may not change the record
  assert.deepEqual(importPlan("INSERT INTO log VALUES ('c');").statements, ["INSERT INTO log VALUES ('c')"]);
  assert.throws(
    () => importPlan("DELETE FROM _gf_migrations WHERE name = '0001_init.sql'"),
    /record of its migrations/,
  );
  assert.throws(() => importPlan('DROP TABLE IF EXISTS _gf_migration_steps'), /record of its migrations/);
  assert.equal(internalTable('_gf_migration_steps'), true);
  assert.equal(internalTable('_gf_migrations'), true);
  assert.equal(internalTable('players'), false);
});

// players, and items that point at them with ON DELETE CASCADE: the shape a REPLACE wipes (it deletes each player,
// and the cascade its items), and that an import into an empty database breaks unless foreign keys wait for the end
const FK_SCHEMA = [
  'CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT);',
  'CREATE TABLE items (id INTEGER PRIMARY KEY, player TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE, what TEXT);',
  'CREATE TABLE badges (player TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE, badge TEXT NOT NULL, PRIMARY KEY (player, badge)) WITHOUT ROWID;',
].join('\n');
const FK_ROWS =
  "INSERT INTO players VALUES ('p1', 'Ada'), ('p2', 'Bo'); INSERT INTO items VALUES (1, 'p1', 'sword'), (2, 'p1', 'shield'), (3, 'p2', 'map'); INSERT INTO badges VALUES ('p1', 'first');";

test('a dump with foreign keys and ON DELETE CASCADE round-trips: over the same database, into a fresh one, into an empty one', async () => {
  const { dumpDatabase, importPlan, applyMigrations } = await import('../lib/dev/d1.mjs');
  const migrations = [{ name: '0001_init.sql', text: FK_SCHEMA, sha256: sha(FK_SCHEMA), bytes: FK_SCHEMA.length }];
  const from = fakeD1();
  assert.equal(from.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'foreign keys enforced, as on D1');
  await applyMigrations(null, from, migrations);
  from.db.exec(FK_ROWS);
  const dump = await dumpDatabase(from);
  assert.ok(dump.indexOf('INSERT INTO "items"') < dump.indexOf('INSERT INTO "players"'), 'items come before players');
  assert.match(
    dump,
    /INSERT INTO "badges" \("player", "badge"\) VALUES \('p1', 'first'\) ON CONFLICT \("player", "badge"\) DO NOTHING;/,
  );
  const run = async (db, plan) => db.batch(plan.statements.map(st => db.prepare(st)));
  const all = db => ({
    players: db.db
      .prepare('SELECT id, name FROM players ORDER BY id')
      .all()
      .map(r => ({ ...r })),
    items: db.db
      .prepare('SELECT id, player, what FROM items ORDER BY id')
      .all()
      .map(r => ({ ...r })),
    badges: db.db
      .prepare('SELECT player, badge FROM badges')
      .all()
      .map(r => ({ ...r })),
  });
  const want = all(from);
  assert.equal(want.items.length, 3);
  // over the database it came from, twice: the rows updated where they are, nothing deleted, nothing doubled
  from.db.exec("UPDATE players SET name = 'changed' WHERE id = 'p1'");
  await run(from, importPlan(dump));
  await run(from, importPlan(dump));
  assert.deepEqual(all(from), want, 'the items kept, and the name put back');
  // into a fresh database its migrations made: the items go in before the players they point at
  const fresh = fakeD1();
  await applyMigrations(null, fresh, migrations);
  await run(fresh, importPlan(dump));
  assert.deepEqual(all(fresh), want);
  // into an empty database: the dump makes the tables itself
  const empty = fakeD1();
  await run(empty, importPlan(dump));
  assert.deepEqual(all(empty), want);
  // D1's own export (INSERT INTO … VALUES, no columns named, a child table first) goes in the same way
  const d1 = [
    'PRAGMA defer_foreign_keys=TRUE;',
    ...FK_SCHEMA.split('\n'),
    `INSERT INTO "items" VALUES(1,'p1','sword');`,
    `INSERT INTO "items" VALUES(2,'p1','shield');`,
    `INSERT INTO "items" VALUES(3,'p2','map');`,
    `INSERT INTO "players" VALUES('p1','Ada');`,
    `INSERT INTO "players" VALUES('p2','Bo');`,
    `INSERT INTO "badges" VALUES('p1','first');`,
  ].join('\n');
  const plan = importPlan(d1);
  assert.doesNotMatch(plan.sql, /REPLACE/);
  await run(from, plan);
  assert.deepEqual(all(from), want, "D1's dump over the same database");
  const fresh2 = fakeD1();
  await applyMigrations(null, fresh2, migrations);
  await run(fresh2, plan);
  assert.deepEqual(all(fresh2), want, "D1's dump into a fresh database");
  // an INSERT OR REPLACE in a dump is made an upsert too, so it cannot fire the cascade either
  const replaced = importPlan(
    `PRAGMA defer_foreign_keys=TRUE;\n${FK_SCHEMA}\nINSERT OR REPLACE INTO players (id, name) VALUES ('p1', 'Ada');\nREPLACE INTO "players" VALUES('p2','Bo');`,
  );
  assert.doesNotMatch(replaced.sql, /REPLACE/);
  await run(from, replaced);
  assert.deepEqual(all(from), want);
});

test(
  'xcore db export and import with foreign keys on a local D1: over the same database and into a fresh one, nothing lost',
  { skip: noMiniflare, timeout: 120_000 },
  async t => {
    const { dbExport, dbImport, dbQuery } = await import('../lib/db.mjs');
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await game(tmp, { database: {} }, { 'server/migrations/0001_init.sql': FK_SCHEMA });
    for (const st of FK_ROWS.split('; ')) await dbQuery(dir, st, { write: true });
    const count = async (d, table) => (await dbQuery(d, `SELECT count(*) AS n FROM ${table}`)).results[0].n;
    const dump = await dbExport(dir);
    const back = await dbImport(dir, dump.file);
    assert.equal(back.dump, true);
    assert.deepEqual([await count(dir, 'players'), await count(dir, 'items'), await count(dir, 'badges')], [2, 3, 1]);
    // a fresh game: its migrations made the tables, empty
    const fresh = await game(tmp, { database: {} }, { 'server/migrations/0001_init.sql': FK_SCHEMA });
    await dbImport(fresh, dump.file);
    assert.deepEqual(
      [await count(fresh, 'players'), await count(fresh, 'items'), await count(fresh, 'badges')],
      [2, 3, 1],
    );
    // a game whose migrations made none of them: the dump makes them
    const other = 'CREATE TABLE other (x TEXT);\n';
    const empty = await game(tmp, { database: {} }, { 'server/migrations/0001_init.sql': other });
    await dbImport(empty, dump.file);
    assert.deepEqual((await dbQuery(empty, 'SELECT player, what FROM items ORDER BY id')).results, [
      { player: 'p1', what: 'sword' },
      { player: 'p1', what: 'shield' },
      { player: 'p2', what: 'map' },
    ]);
  },
);

test('splitSql: statements as SQLite reads them (quotes, comments, a trigger’s BEGIN … END)', () => {
  assert.deepEqual(
    splitSql(`-- a comment; not a statement
CREATE TABLE a (x TEXT DEFAULT 'a;b', "we;ird" INT); /* ; */
INSERT INTO a VALUES ('it''s; fine', 1);;
CREATE TRIGGER t AFTER INSERT ON a BEGIN
  UPDATE a SET x = CASE WHEN new.x = 'e' THEN 'f' END;
  DELETE FROM a WHERE 0;
END;
SELECT 1`),
    [
      `CREATE TABLE a (x TEXT DEFAULT 'a;b', "we;ird" INT)`,
      `INSERT INTO a VALUES ('it''s; fine', 1)`,
      `CREATE TRIGGER t AFTER INSERT ON a BEGIN
  UPDATE a SET x = CASE WHEN new.x = 'e' THEN 'f' END;
  DELETE FROM a WHERE 0;
END`,
      'SELECT 1',
    ],
  );
  assert.deepEqual(splitSql('  -- only a comment\n'), []);
});

test("xcore db query: the rule of xgames.fun's query route, the same cases taken and refused", () => {
  // the cases of creator-studio/tests/game-database.test.mjs, so a query fares the same here and live
  for (const sql of [
    'SELECT * FROM guilds',
    '  select 1;',
    "SELECT ';' AS semi",
    'SELECT "a;b" FROM t -- trailing; comment',
    'EXPLAIN QUERY PLAN SELECT 1',
    'EXPLAIN DELETE FROM guilds',
    'PRAGMA table_list',
    'PRAGMA table_info(guilds)',
    "PRAGMA table_info('guilds');",
    'PRAGMA main.table_info("guilds")',
    '/* hi */ SELECT 1',
  ])
    assert.equal(queryProblem(sql), null, sql);
  for (const sql of [
    'DELETE FROM guilds',
    'INSERT INTO guilds VALUES (1)',
    'UPDATE guilds SET name=1',
    'DROP TABLE guilds',
    'ATTACH DATABASE x AS y',
    'CREATE TABLE x (y)',
    'WITH x AS (SELECT 1) DELETE FROM guilds',
    'REPLACE INTO guilds VALUES (1)',
    'PRAGMA writable_schema=1',
    'PRAGMA table_info(guilds) = 1',
    'PRAGMA foreign_keys=OFF',
    'VACUUM',
    '/* SELECT */ DELETE FROM guilds',
    '-- SELECT\nDELETE FROM guilds',
    'SELECT 1; DELETE FROM guilds',
    "SELECT ''; DROP TABLE guilds; --'",
    'BEGIN',
    'select 1;;delete from t',
  ])
    assert.ok(queryProblem(sql), sql);
  assert.match(queryProblem('SELECT 1; SELECT 2'), /one statement at a time \(this has 2\)/);
  assert.match(queryProblem("SELECT 'unclosed"), /never ends/);
  assert.match(queryProblem('DELETE FROM t'), /Add --write/);
  assert.equal(queryProblem('DELETE FROM t', { write: true }), null);
  assert.match(queryProblem('DELETE FROM t; DELETE FROM u', { write: true }), /one statement/);
  assert.deepEqual(sqlStatements("SELECT 'a;b'; -- c;\nSELECT [x;y] /* ; */"), ["SELECT 'a;b'", 'SELECT [x;y]']);
  // as Studio sends a migration: a trigger's BEGIN … END is one statement
  const trig =
    'CREATE TABLE a (x);\nCREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET x = 1; DELETE FROM a WHERE 0; END;';
  assert.equal(sqlStatements(trig, { triggers: true }).length, 2);
  assert.equal(sqlStatements(trig).length, 4, 'the query route reads it without triggers');
  // readOnlyProblem is the same rule without write
  assert.equal(readOnlyProblem('PRAGMA table_info(players)'), null);
  assert.ok(readOnlyProblem(''));
});

test('add database to a game with no server: the block with collections, and the stock server is its server', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  const r = await addDatabase(dir);
  assert.ok(existsSync(path.join(dir, 'gamesfun.js')), 'signin comes with it');
  assert.ok(!existsSync(path.join(dir, 'server')), 'nothing in server/: xcore brings the server');
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'gamesfun.json'), 'utf8')).database, {
    engine: 'd1',
    binding: 'DB',
    collections: { '*': { read: 'owner', write: 'owner' } },
  });
  assert.match(r.steps.join('\n'), /xcore's stock server answers them/);
  const b = await bundleServer(dir);
  assert.deepEqual(b.problems, []);
  assert.ok(b.ok && b.stock, JSON.stringify(b.warnings));
  assert.deepEqual(b.exports, ['default']);
  assert.deepEqual((await addDatabase(dir)).written, [], 'run again: already up to date');
  // the publish check says what goes up
  const sum = checkSummary(await preflight(dir));
  assert.equal(sum.server.stock, true);
  assert.deepEqual(sum.server.database, {
    binding: 'DB',
    migrations: [],
    collections: { '*': { read: 'owner', write: 'owner' } },
  });
});

test('add database to a game with a server: the block, an example migration and server/gf-db.js', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await addMultiplayer(dir);
  const index = await readFile(path.join(dir, 'server', 'index.js'), 'utf8');
  const r = await addDatabase(dir);
  const cfg = JSON.parse(await readFile(path.join(dir, 'gamesfun.json'), 'utf8'));
  assert.deepEqual(cfg.database, { engine: 'd1', binding: 'DB', migrations: 'server/migrations' });
  assert.deepEqual(cfg.server.objects, [{ class: 'GameRoom', binding: 'GAME_ROOMS' }], 'no Durable Object for it');
  assert.equal(await readFile(path.join(dir, 'server', 'index.js'), 'utf8'), index, 'its server is left as it is');
  assert.match(await readFile(path.join(dir, 'server/migrations/0001_init.sql'), 'utf8'), /CREATE TABLE players/);
  // no line-ending conversion for a migration (its sha256 is its bytes), and that file is no migration itself
  assert.match(await readFile(path.join(dir, 'server/migrations/.gitattributes'), 'utf8'), /^\*\.sql -text$/m);
  const read = await readServerConfig(dir);
  assert.deepEqual([read.warnings, read.database.migrations.map(m => m.name)], [[], ['0001_init.sql']]);
  const helper = await readFile(path.join(dir, 'server/gf-db.js'), 'utf8');
  assert.match(helper, /const BINDING = 'DB';/);
  assert.match(helper, /export async function withPlayer\(request, env\)/);
  assert.match(r.steps.join('\n'), /import \{ db, withPlayer \} from '\.\/gf-db\.js'/);
  assert.deepEqual((await addDatabase(dir)).written, [], 'run again: already up to date');
  // the person's own migration: no example is written over or beside it
  const mine = await fixture(await tempDir(), 'static');
  await mkdir(path.join(mine, 'server', 'migrations'), { recursive: true });
  await writeFile(path.join(mine, 'server', 'index.js'), SERVER);
  await writeFile(path.join(mine, 'server', 'migrations', '0001_mine.sql'), 'CREATE TABLE m (x);');
  await writeFile(path.join(mine, 'gamesfun.json'), JSON.stringify({ database: { binding: 'GAME_DB' } }));
  await addDatabase(mine);
  assert.ok(!existsSync(path.join(mine, 'server/migrations/0001_init.sql')));
  assert.match(await readFile(path.join(mine, 'server/gf-db.js'), 'utf8'), /const BINDING = 'GAME_DB';/);
  // a Durable Object already bound as DB: refused before anything is written
  const taken = await game(
    tmp,
    { server: { objects: [{ class: 'Db', binding: 'DB' }] } },
    { 'server/index.js': SERVER },
  );
  await assert.rejects(addDatabase(taken), /a Durable Object bound as DB: add "database": \{"binding": "GAME_DB"\}/);
  assert.ok(!existsSync(path.join(taken, 'gamesfun.js')));
  // gf-db.js works over D1: prepared queries, a batch all or none, and the signed-in player
  const url = pathToFileURL(path.join(dir, 'server/gf-db.js')).href;
  const { db, withPlayer } = await import(url);
  const d1 = fakeD1();
  const env = { DB: d1, GF: { verifyPlayer: async tok => (tok === 'good' ? { ok: true, sub: 'p1' } : { ok: false }) } };
  for (const s of splitSql(await readFile(path.join(dir, 'server/migrations/0001_init.sql'), 'utf8'))) d1.db.exec(s);
  await db(env).run('INSERT INTO players (id) VALUES (?)', 'p1');
  assert.deepEqual({ ...(await db(env).first('SELECT runs FROM players WHERE id = ?', 'p1')) }, { runs: 3 });
  await assert.rejects(
    db(env).batch([
      ['UPDATE players SET gold = 5 WHERE id = ?', 'p1'],
      ['INSERT INTO players (id) VALUES (?)', 'p1'],
    ]),
  );
  assert.equal((await db(env).first('SELECT gold FROM players')).gold, 0, 'the batch went in whole or not at all');
  const req = auth => new Request('https://x/api/me', { headers: auth ? { authorization: `Bearer ${auth}` } : {} });
  assert.equal(await withPlayer(req('good'), env), 'p1');
  assert.equal(await withPlayer(req('bad'), env), null);
  assert.equal(await withPlayer(req(), env), null);
});

test('the stock server answers as server/database.js does, over D1, under the collections in gamesfun.json', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const rules = { '*': { read: 'owner', write: 'owner' }, levels: { read: 'anyone', write: 'owner' } };
  const dir = await game(tmp, { database: { collections: rules } });
  const b = await bundleServer(dir, { minify: false });
  assert.ok(b.ok, JSON.stringify(b.problems));
  const file = path.join(tmp.dir, 'stock.mjs');
  await writeFile(file, b.code);
  const stock = (await import(pathToFileURL(file).href)).default;
  const verifyPlayer = async tok =>
    ({ a: { ok: true, sub: 'p:a' }, b: { ok: true, sub: 'p:b' } })[tok] ?? { ok: false, why: 'expired' };
  const d1 = fakeD1();
  const stockEnv = { DB: d1, GF: { verifyPlayer } };
  const sql = () => {
    const db = new DatabaseSync(':memory:');
    return { exec: (q, ...v) => db.prepare(q).all(...v) };
  };
  const object = new GameData({ storage: { sql: sql() } }, {});
  object.data = (await import('../lib/client/server/database.js')).createData(
    (q, ...v) => object.ctx.storage.sql.exec(q, ...v),
    { rules },
  );
  const objectEnv = {
    GF: { verifyPlayer },
    GAME_DATA: { idFromName: n => n, get: () => ({ run: (op, args) => object.run(op, args) }) },
  };
  // the same calls to each; ids and times differ, so they are read back by what they made
  const calls = [
    ['POST', '/api/db/levels', { value: { name: 'Moon' } }, 'a'],
    ['GET', '/api/db/levels?owner=p%3Aa', null, null],
    ['GET', '/api/db/levels?owner=p%3Aa&limit=1', null, 'b'],
    ['PUT', '/api/db/notes/n1', { value: 'secret' }, 'a'],
    ['GET', '/api/db/notes/n1?owner=p%3Aa', null, 'b'],
    ['GET', '/api/db/notes/n1', null, 'a'],
    ['PUT', '/api/db/notes/n1?owner=p%3Aa', { value: 'mine now' }, 'b'],
    ['GET', '/api/db/notes', null, null],
    ['GET', '/api/db/notes?offset=10', null, 'a'],
    ['DELETE', '/api/db/notes/n1', null, 'a'],
    ['POST', '/api/db/levels', { value: 1 }, 'expired'],
    ['PATCH', '/api/db/levels/x', null, 'a'],
    ['GET', '/api/rpc', null, null],
  ];
  const ask = async (handler, env, [method, p, body, tok]) => {
    const res = await handler(
      new Request(`https://moth-play.xgames.fun${p}`, {
        method,
        headers: tok ? { authorization: `Bearer ${tok}` } : {},
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
    );
    if (!res) return null;
    const v = await res.json();
    const strip = d => (d && typeof d === 'object' ? { ...d, id: d.id ? 'id' : d.id, updatedAt: 't' } : d);
    return {
      status: res.status,
      ...v,
      ...(v.item ? { item: strip(v.item) } : {}),
      ...(v.items ? { items: v.items.map(strip) } : {}),
      ...(v.after ? { after: 'cursor' } : {}),
    };
  };
  const route = async (req, env) => (await handleDatabase(req, env)) ?? stock.fetch(req, env);
  for (const c of calls) {
    const a = await ask(stock.fetch, stockEnv, c);
    const want = c[1] === '/api/rpc' ? { status: 200, gamesfun: 'rpc', own: false } : await ask(route, objectEnv, c);
    assert.deepEqual(a, want, `${c[0]} ${c[1]}`);
  }
  // its documents are in a table of its own, made by itself
  assert.ok(d1.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'gf_docs'").get());
});

test('a game the stock server served keeps gf.db when it gets a server of its own (xcore add multiplayer)', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp, { database: {} });
  const verifyPlayer = async tok => ({ a: { ok: true, sub: 'p:a' } })[tok] ?? { ok: false, why: 'expired' };
  const d1 = fakeD1();
  const env = { DB: d1, GF: { verifyPlayer }, GAME_ROOMS: { idFromName: n => n, get: () => ({}) } };
  const serve = async (n, b) => {
    assert.ok(b.ok, JSON.stringify([b.problems, b.hits]));
    const file = path.join(tmp.dir, `server-${n}.mjs`);
    await writeFile(file, b.code);
    return (await import(pathToFileURL(file).href)).default;
  };
  const ask = async (server, method, p, body) => {
    const res = await server.fetch(
      new Request(`https://moth-play.xgames.fun${p}`, {
        method,
        headers: { authorization: 'Bearer a' },
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
    );
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
  };
  // a document the page saved through the stock server
  const stock = await serve('stock', await bundleServer(dir, { minify: false }));
  const made = await ask(stock, 'POST', '/api/db/levels', { value: { name: 'Moon' } });
  assert.equal(made.status, 200);
  // a server of its own: its rules written out, server/gf-docs.js routed first in server/index.js
  const r = await addMultiplayer(dir);
  const cfg = JSON.parse(await readFile(path.join(dir, 'gamesfun.json'), 'utf8'));
  assert.deepEqual(cfg.database.collections, { '*': { read: 'owner', write: 'owner' } });
  assert.ok(r.written.includes('wrote server/gf-docs.js'), r.written.join('\n'));
  const index = await readFile(path.join(dir, 'server', 'index.js'), 'utf8');
  assert.match(index, /import \{ handleDocs \} from '\.\/gf-docs\.js';/);
  assert.ok(index.indexOf('handleDocs(request, env)') < index.indexOf('handleRooms(request, env)'), 'routed first');
  assert.match(r.steps.join('\n'), /server\/gf-docs\.js answers gf\.db there from the same documents/);
  const docs = await readFile(path.join(dir, 'server', 'gf-docs.js'), 'utf8');
  assert.match(docs, /export function createData\(/, "database.js's documents code is in it");
  assert.doesNotMatch(docs, /__DOCS_CORE__|DurableObject|---- the documents' code/);
  const own = await bundleServer(dir, { minify: false });
  assert.equal(own.docsUnrouted, undefined);
  assert.ok(own.inputs.includes('server/gf-docs.js') && own.inputs.includes('gamesfun.json'), own.inputs.join(' '));
  // the same document, through the game's own server; and a new one
  const server = await serve('own', own);
  const got = await ask(server, 'GET', `/api/db/levels/${made.item.id}`);
  assert.deepEqual([got.status, got.item?.value], [200, { name: 'Moon' }]);
  assert.equal((await ask(server, 'POST', '/api/db/levels', { value: 2 })).status, 200);
  assert.equal((await ask(server, 'GET', '/api/db/levels')).items.length, 2);
  // the rules are gamesfun.json's: a mistyped one stops the bundle, in words
  cfg.database.collections.levels = { read: 'everyone' };
  await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify(cfg));
  assert.match((await bundleServer(dir)).problems.join('\n'), /collections\.levels is \{"read": "owner" \| "anyone"/);
});

test('a server of its own with database.collections and no api/db/ route: said, and publish refuses it', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  await signIn(g, env);
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  const cfgFile = path.join(dir, 'gamesfun.json');
  const cfg = JSON.parse(await readFile(cfgFile, 'utf8'));
  await writeFile(cfgFile, JSON.stringify({ ...cfg, database: { collections: { '*': { read: 'owner' } } } }));
  await mkdir(path.join(dir, 'server'), { recursive: true });
  await writeFile(path.join(dir, 'server', 'index.js'), SERVER);
  const b = await bundleServer(dir);
  assert.equal(b.docsUnrouted, true);
  assert.match(b.warnings.join('\n'), /does not route api\/db\/: every gf\.db call answers 404/);
  g.state.me = { server: { contracts: ['gf-server-v1'], features: ['d1'] } };
  await assert.rejects(
    publishGame(dir, { origin: g.origin, env, check: passing }),
    e => e.code === 'db-route' && /does not route api\/db\/.*handleDocs/.test(e.message),
  );
  assert.ok(!g.state.calls.includes('POST /api/kit/publish'), 'nothing was sent');
  // xcore add database writes the helper, and says how to route it in a server/index.js of the person's own
  const r = await addDatabase(dir);
  assert.ok(existsSync(path.join(dir, 'server', 'gf-docs.js')));
  assert.match(r.steps.join('\n'), /server\/index\.js is your own: route the page's documents in it/);
  await writeFile(
    path.join(dir, 'server', 'index.js'),
    `import { handleDocs } from './gf-docs.js';\nexport default { async fetch(request, env) { const db = await handleDocs(request, env); if (db) return db; return new Response('ok'); } };\n`,
  );
  const routed = await bundleServer(dir);
  assert.ok(routed.ok, JSON.stringify(routed.problems));
  assert.equal(routed.docsUnrouted, undefined);
  // a route of its own for api/db/ is the person's choice: allowed, with a word that collections are not read
  await writeFile(
    path.join(dir, 'server', 'index.js'),
    `export default { fetch(request) { if (new URL(request.url).pathname.startsWith('/api/db/')) return new Response('mine'); return new Response('ok'); } };\n`,
  );
  const mine = await bundleServer(dir);
  assert.equal(mine.docsUnrouted, undefined);
  assert.match(
    mine.warnings.join('\n'),
    /collections is read by server\/gf-docs\.js \(handleDocs\), which this server does not route/,
  );
});

test('publish: a database needs "d1" in server.features; with it, the migrations go up as blobs in server.database', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  await signIn(g, env);
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  await addDatabase(dir);
  const migration = 'CREATE TABLE players (id TEXT PRIMARY KEY);\n';
  await mkdir(path.join(dir, 'server', 'migrations'), { recursive: true });
  await writeFile(path.join(dir, 'server', 'migrations', '0001_init.sql'), migration);
  const publish = () => publishGame(dir, { origin: g.origin, env, check: passing });
  // no server code at all, then server code without d1: refused, nothing goes up
  await assert.rejects(
    publish(),
    e => e.code === 'feature' && /takes server code|does not take server code/.test(e.message),
  );
  g.state.me = { server: { contracts: ['gf-server-v1'] } };
  await assert.rejects(
    publish(),
    e => e.code === 'feature' && /does not make databases for games yet .*"d1"/.test(e.message),
  );
  assert.ok(!g.state.calls.includes('POST /api/kit/publish'), 'nothing was sent');
  g.state.me = { server: { contracts: ['gf-server-v1'], features: ['d1'] } };
  const r = await publish();
  assert.equal(r.url, 'http://x/play/dot-catch');
  assert.equal(r.server.stock, true);
  const sent = g.state.published.server;
  assert.deepEqual(sent.database, {
    binding: 'DB',
    migrations: [{ name: '0001_init.sql', sha256: sha(migration), bytes: Buffer.byteLength(migration) }],
  });
  assert.equal(sent.objects.length, 0);
  assert.equal(
    g.state.uploads.get(sha(migration)).toString(),
    migration,
    'the migration went up through the blob route',
  );
  assert.ok(g.state.uploads.has(sent.modules[0].sha256), 'and the stock server bundle');
  const link = JSON.parse(await readFile(path.join(dir, '.gamesfun', 'publish.json'), 'utf8'))[g.origin];
  assert.match(
    await readFile(path.join(dir, '.gamesfun', '.gitignore'), 'utf8'),
    /^\*$/m,
    '.gamesfun/ kept out of git',
  );
  assert.deepEqual(link.migrations, [{ name: '0001_init.sql', sha256: sha(migration) }], 'remembered as applied');
  // the published migration changed: refused here before anything is sent
  const calls = g.state.calls.length;
  await writeFile(path.join(dir, 'server', 'migrations', '0001_init.sql'), `${migration}-- and more\n`);
  await assert.rejects(
    publish(),
    e => e.code === 'migration-changed' && /0001_init\.sql changed after it was applied/.test(e.message),
  );
  assert.ok(!g.state.calls.slice(calls).includes('POST /api/kit/publish'));
  await writeFile(path.join(dir, 'server', 'migrations', '0001_init.sql'), migration);
  // xgames.fun's own refusals, in words: 409 at the start, 422 at the end
  await writeFile(path.join(dir, 'server', 'migrations', '0002_more.sql'), 'ALTER TABLE players ADD gold INT;\n');
  g.state.refuse = { at: 'begin', status: 409, body: { code: 'migration-changed', name: '0001_init.sql' } };
  await assert.rejects(
    publish(),
    e => e.code === 'migration-changed' && /0001_init\.sql changed after xgames\.fun applied it/.test(e.message),
  );
  g.state.refuse = { at: 'complete', status: 502, body: { code: 'database-unavailable', error: 'Cloudflare 503' } };
  await assert.rejects(
    publish(),
    e =>
      e.code === 'database-unavailable' &&
      /could not reach the game's database .*Nothing is wrong with the migrations.*publish again in a minute/.test(
        e.message,
      ),
  );
  g.state.refuse = { at: 'complete', status: 409, body: { code: 'migration-busy' } };
  await assert.rejects(
    publish(),
    e =>
      e.code === 'migration-busy' &&
      /another publish of this game is applying its database migrations .*Try again in a minute/.test(e.message),
  );
  g.state.refuse = {
    at: 'complete',
    status: 422,
    body: {
      code: 'migration-failed',
      name: '0002_more.sql',
      why: 'near "INT": syntax error; 0001_init.sql stays applied.',
    },
  };
  await assert.rejects(publish(), e => {
    assert.equal(e.code, 'migration-failed');
    assert.match(
      e.message,
      /Nothing new went live: 0002_more\.sql failed on the game's database on xgames\.fun \(near "INT": syntax error; 0001_init\.sql stays applied\)\. The version before keeps playing\./,
    );
    return true;
  });
  g.state.refuse = null;
  // a draft does not count its migrations as applied
  const before = JSON.parse(await readFile(path.join(dir, '.gamesfun', 'publish.json'), 'utf8'))[g.origin].migrations;
  await publishGame(dir, {
    origin: g.origin,
    env,
    check: passing,
    draft: true,
  });
  assert.deepEqual(
    JSON.parse(await readFile(path.join(dir, '.gamesfun', 'publish.json'), 'utf8'))[g.origin].migrations,
    before,
  );
  assert.deepEqual(publishField({ sha256: 'a', bytes: 1, objects: [], compatibilityFlags: [] }).database, undefined);
});

test('xcore db --live goes through the owner routes; restore shows its preview and the economy warning, and needs --yes', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = {
    GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'),
    GAMESFUN_CREDENTIALS: 'file',
    GAMESFUN_STUDIO: g.origin,
    GAMESFUN_NO_UPDATE_CHECK: '1',
  };
  await signIn(g, env);
  const dir = await game(tmp, { database: {} });
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(path.join(dir, '.gamesfun', 'publish.json'), JSON.stringify({ [g.origin]: { projectId: 'g1' } }));
  await writeFile(path.join(dir, 'xsolana.json'), '{}'); // an economy
  const seen = [];
  const dump = Buffer.from('CREATE TABLE players (id TEXT);\n');
  g.state.handle = (method, url, json, { authed }) => {
    if (url === '/dump/1.sql') return [200, dump, { 'content-type': 'application/sql' }]; // a signed address: no token
    if (!url.startsWith('/api/kit/games/g1/db')) return null;
    if (!authed) return [401, { error: 'Sign in first.' }];
    seen.push([method, url, json]);
    if (url === '/api/kit/games/g1/db')
      return [
        200,
        { ok: true, exists: true, name: 'g-g1', sizeBytes: 2048, applied: [{ name: '0001_init.sql' }], cap: 104857600 },
      ];
    if (url.endsWith('/db/query')) return [200, { ok: true, results: [{ id: 'p1', gold: 3 }], meta: { rows_read: 1 } }];
    if (url.endsWith('/db/export')) return [200, { ok: true, url: `${g.origin}/dump/1.sql` }];
    if (url.endsWith('/db/import'))
      return json.sql.includes('huge')
        ? [413, Buffer.from('Request Entity Too Large'), { 'content-type': 'text/plain' }] // Studio's host, not xgames.fun
        : [200, { ok: true, meta: { changes: 1 } }];
    if (url.endsWith('/db/restore'))
      return json.confirm
        ? [200, { ok: true, restored: { bookmark: 'bm1', at: '2026-11-08T10:00:00Z', previous: 'bm0' } }]
        : [
            200,
            {
              ok: true,
              preview: {
                bookmark: 'bm1',
                at: '2026-11-08T10:00:00Z',
                migrations: [{ name: '0002_guilds.sql', at: '2026-11-08T11:00:00.000Z' }],
                warning: 'This restore rolls back migration 0002_guilds.sql, applied after that time.',
              },
              economy: 'A restore rolls back this game’s database only.',
            },
          ];
    return [404, { error: 'no' }];
  };
  const xc = args => runAsync(['db', ...args], { env, cwd: dir });
  let r = await xc(['info', '--live']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /database on xgames\.fun \(g-g1\): 2\.0 KB of 100\.0 MB/);
  assert.match(r.stdout, /migrations applied: 0001_init\.sql/);
  r = await xc(['query', 'SELECT * FROM players WHERE gold > ?', '--params', '[2]', '--live']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /id\s+gold\n-+\s+-+\np1\s+3/);
  assert.deepEqual(seen.at(-1)[2], { sql: 'SELECT * FROM players WHERE gold > ?', params: [2], write: false });
  // a write is refused here without --write, before anything is sent; so is a null param (D1's API takes text)
  const sent = seen.length;
  r = await xc(['query', 'SELECT * FROM players WHERE id = ?', '--params', '[null]', '--live']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /for a null, write NULL in the SQL itself/);
  assert.equal(seen.length, sent);
  r = await xc(['query', 'DELETE FROM players', '--live']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a query may only read: SELECT, EXPLAIN.*Add --write/);
  assert.equal(seen.length, sent);
  // a write live needs --yes (or the word typed): with no terminal to ask in, refused before anything is sent
  r = await xc(['query', 'DELETE FROM players', '--live', '--write']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /This changes .*database on xgames\.fun.*DELETE FROM players/);
  assert.match(r.stderr, /nothing was written: add --yes/);
  assert.equal(seen.length, sent);
  r = await xc(['query', 'DELETE FROM players', '--live', '--write', '--yes', '--json']);
  assert.equal(JSON.parse(r.stdout).ok, true);
  assert.equal(seen.at(-1)[2].write, true);
  // a write here (not live) needs no yes
  assert.equal((await xc(['query', 'SELECT 1; SELECT 2', '--live', '--write'])).status, 1, 'refused first, unasked');
  // export downloads the dump into .gamesfun/exports/ (hidden: never published)
  r = await xc(['export', '--live', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.match(out.file, /\.gamesfun\/exports\/db-live-.*\.sql$/);
  assert.equal(await readFile(out.file, 'utf8'), dump.toString());
  await writeFile(path.join(tmp.dir, 'in.sql'), 'INSERT INTO players VALUES (1);');
  const before = seen.length;
  r = await xc(['import', path.join(tmp.dir, 'in.sql'), '--live']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /nothing was imported: add --yes/);
  assert.equal(seen.length, before);
  r = await xc(['import', path.join(tmp.dir, 'in.sql'), '--live', '--yes']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(seen.at(-1)[2], { sql: 'INSERT INTO players VALUES (1);' });
  // over 4.5 MB as sent: refused here, before it goes (Studio's host takes no more); a bare 413 is said in words
  await writeFile(path.join(tmp.dir, 'big.sql'), `INSERT INTO players VALUES ('${'x'.repeat(4_600_000)}');`);
  r = await xc(['import', path.join(tmp.dir, 'big.sql'), '--live', '--yes']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /this import is 4\.6 MB as sent.*at most 4\.5 MB: split it/);
  assert.equal(seen.at(-1)[2].sql, 'INSERT INTO players VALUES (1);', 'not sent');
  await writeFile(path.join(tmp.dir, 'huge.sql'), "INSERT INTO players VALUES ('huge');");
  r = await xc(['import', path.join(tmp.dir, 'huge.sql'), '--live', '--yes']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /xgames\.fun answered 413: the request was too big .*Split the SQL/);
  // restore: not on this machine; live, a preview, the warning, and no yes (not a terminal): nothing restored
  r = await xc(['restore', '2026-11-08T10:00:00Z']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /restore is --live only/);
  r = await xc(['restore', '2026-11-08T10:00:00Z', '--live']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /would go back to how it was at 2026-11-08T10:00:00Z \(bookmark bm1\)/);
  assert.match(
    r.stdout,
    /It rolls back 1 migration applied after that time: 0002_guilds\.sql \(2026-11-08T11:00:00\.000Z\)/,
  );
  assert.match(r.stdout, /Warning: This restore rolls back migration 0002_guilds\.sql/);
  assert.match(r.stdout, /Warning: This game has an economy: .*Loot balances, items and payouts are not rolled back/);
  assert.match(r.stderr, /nothing was restored: add --yes/);
  assert.ok(!seen.some(s => s[2]?.confirm), 'never confirmed');
  r = await xc(['restore', '2026-11-08T10:00:00Z', '--live', '--yes']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Restored .* to 2026-11-08T10:00:00Z \(bookmark bm1\)/);
  assert.match(
    r.stdout,
    /Before it, the database was at bookmark bm0\. To undo this restore: .*?xcore(\.mjs)? db restore \d{4}-\d\d-\d\dT[\d:.]+Z --live/,
  );
  assert.match(r.stderr, /not rolled back/);
  assert.deepEqual(seen.at(-1)[2], { timestamp: '2026-11-08T10:00:00.000Z', confirm: true });
  // unix seconds go up as the same ISO time: xgames.fun reads a bare number as milliseconds
  r = await xc(['restore', '1794132000', '--live', '--yes']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(seen.at(-1)[2], { timestamp: '2026-11-08T10:00:00.000Z', confirm: true });
  r = await xc(['restore', 'yesterday', '--live', '--yes']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /restore needs a time/);
});

test('db export --live picks up an export-pending with its bookmark; a CI credential refused is said in words', async t => {
  const { dbExport } = await import('../lib/db.mjs');
  const { OIDC_HEADER } = await import('../lib/publish/oidc.mjs');
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  await signIn(g, env);
  const dir = await game(tmp, { database: {} });
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(path.join(dir, '.gamesfun', 'publish.json'), JSON.stringify({ [g.origin]: { projectId: 'g1' } }));
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const asked = [];
  let pending = 2;
  const NOTE = "While an export or an import runs, the game's database answers nothing else.";
  g.state.handle = (method, url, json, { req }) => {
    if (url === '/dump/1.sql') return [200, Buffer.from('SELECT 1;\n'), { 'content-type': 'application/sql' }];
    if (url.startsWith('/oidc')) return [200, { value: `e30.${b64({ repository: 'o/r' })}.sig` }];
    if (req.headers[OIDC_HEADER]) return [403, { error: 'A GitHub Actions run may not export the database.' }];
    if (url !== '/api/kit/games/g1/db/export') return null;
    asked.push(json);
    if (pending-- > 0)
      return [
        504,
        { error: 'The export is still running on D1.', code: 'export-pending', bookmark: `bm${asked.length}` },
      ];
    return [200, { ok: true, url: `${g.origin}/dump/1.sql`, note: NOTE }];
  };
  const said = [];
  const r = await dbExport(dir, { live: true, origin: g.origin, env, wait: 1, log: m => said.push(m) });
  assert.deepEqual(asked, [null, { bookmark: 'bm1' }, { bookmark: 'bm2' }], 'asked again with the bookmark each time');
  assert.equal(r.note, NOTE);
  assert.match(said[0], /still running on D1; asking again .*answers nothing else/);
  assert.equal(await readFile(r.file, 'utf8'), 'SELECT 1;\n');
  // still pending after the last try: said, with how to pick it up
  pending = 9;
  await assert.rejects(
    dbExport(dir, { live: true, origin: g.origin, env, wait: 1, tries: 2 }),
    e =>
      e.code === 'export-pending' && /still running on D1 \(bookmark bm\d+\).*db export --live again/.test(e.message),
  );
  // GitHub Actions (an OIDC credential, no login): xgames.fun's plain 403 is said as what it is
  const ci = {
    GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'ci-config'),
    GAMESFUN_CREDENTIALS: 'file',
    ACTIONS_ID_TOKEN_REQUEST_URL: `${g.origin}/oidc`,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 't',
  };
  await assert.rejects(
    dbExport(dir, { live: true, origin: g.origin, env: ci }),
    e =>
      e.code === 'ci' &&
      /does not let a GitHub Actions run export the database.*login there\), not from CI/.test(e.message),
  );
});

test(
  'xcore dev: a local D1, its migrations applied on start and kept; a changed one is refused; the stock server serves gf.db',
  { skip: noMiniflare, timeout: 180_000 },
  async t => {
    const { startDev } = await import('../lib/dev/index.mjs');
    const { dbInfo, dbQuery, dbExport, dbImport } = await import('../lib/db.mjs');
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const one = 'CREATE TABLE players (id TEXT PRIMARY KEY, gold INT NOT NULL DEFAULT 0);\n';
    const dir = await game(
      tmp,
      { database: { collections: { levels: { read: 'anyone', write: 'owner' } } } },
      { 'server/migrations/0001_init.sql': one },
    );
    const start = () => startDev(dir, { port: 0, log: () => {}, env: process.env });
    let dev = await start();
    assert.equal(dev.server.running, true, JSON.stringify(dev.server));
    assert.deepEqual(dev.server.database, { binding: 'DB', migrated: ['0001_init.sql'] });
    const tok = await (await fetch(`${dev.origin}/platform/v1/dev/token`, { method: 'POST', body: '{}' })).json();
    const auth = { authorization: `Bearer ${tok.token}`, 'content-type': 'application/json' };
    const made = await (
      await fetch(`${dev.url}api/db/levels`, { method: 'POST', headers: auth, body: '{"value":{"name":"Moon"}}' })
    ).json();
    assert.equal(made.item.owner, tok.player.id);
    await dev.close();
    // xcore db reads the same database, with the dev host stopped
    const info = await dbInfo(dir);
    assert.deepEqual(
      info.applied.map(m => m.name),
      ['0001_init.sql'],
    );
    assert.deepEqual(
      info.tables.find(x => x.name === 'gf_docs'),
      { name: 'gf_docs', rows: 1 },
    );
    await assert.rejects(dbQuery(dir, 'INSERT INTO players (id) VALUES (?)', { params: ['p1'] }), /may only read/);
    await dbQuery(dir, 'INSERT INTO players (id) VALUES (?)', { params: ['p1'], write: true });
    assert.deepEqual((await dbQuery(dir, 'SELECT id, gold FROM players')).results, [{ id: 'p1', gold: 0 }]);
    const dump = await dbExport(dir);
    assert.match(await readFile(path.join(dir, '.gamesfun', '.gitignore'), 'utf8'), /^\*$/m, 'exports kept out of git');
    assert.match(
      await readFile(dump.file, 'utf8'),
      /INSERT INTO "players" \("id", "gold"\) VALUES \('p1', 0\) ON CONFLICT \("id"\) DO UPDATE SET "gold" = excluded\."gold";/,
    );
    // the dump goes back in over the same database: nothing doubled, and its migrations' record left as it was
    const back = await dbImport(dir, dump.file);
    assert.equal(back.dump, true);
    assert.equal((await dbQuery(dir, 'SELECT count(*) AS n FROM players')).results[0].n, 1);
    assert.equal((await dbQuery(dir, 'SELECT count(*) AS n FROM gf_docs')).results[0].n, 1);
    assert.deepEqual(
      (await dbInfo(dir)).applied.map(m => m.name),
      ['0001_init.sql'],
    );
    await writeFile(
      path.join(tmp.dir, 'more.sql'),
      "INSERT INTO players (id) VALUES ('p2'); INSERT INTO players (id) VALUES ('p3');",
    );
    assert.equal((await dbImport(dir, path.join(tmp.dir, 'more.sql'))).statements, 2);
    // a restart keeps it all, and applies only what is new
    await writeFile(path.join(dir, 'server/migrations/0002_guilds.sql'), 'CREATE TABLE guilds (id TEXT);\n');
    dev = await start();
    assert.deepEqual(dev.server.database.migrated, ['0002_guilds.sql']);
    const list = await (await fetch(`${dev.url}api/db/levels?owner=${encodeURIComponent(tok.player.id)}`)).json();
    assert.equal(list.items[0].value.name, 'Moon', 'the documents were kept');
    await dev.close();
    assert.equal((await dbQuery(dir, 'SELECT count(*) AS n FROM players')).results[0].n, 3);
    // an applied migration changed: the server stays down, and says why
    await writeFile(path.join(dir, 'server/migrations/0001_init.sql'), `${one}-- changed\n`);
    dev = await start();
    t.after(() => dev.close());
    assert.equal(dev.server.running, false);
    assert.match(dev.server.problems.join('\n'), /0001_init\.sql changed after it was applied to the database/);
    const down = await fetch(`${dev.url}api/db/levels`);
    assert.equal(down.status, 503);
    await assert.rejects(dbInfo(dir), /0001_init\.sql changed after it was applied/);
  },
);

test(
  'xcore dev: the older database (server/database.js) moves its old table in a real Durable Object, every document kept',
  { skip: noMiniflare, timeout: 120_000 },
  async t => {
    const { addDatabaseObject } = await import('../lib/add.mjs');
    const { startDev } = await import('../lib/dev/index.mjs');
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await fixture(tmp, 'static');
    await addDatabaseObject(dir);
    // a route of the game's own that makes the 0.1.0 table first, as an older database.js left it
    const index = path.join(dir, 'server', 'index.js');
    const file = path.join(dir, 'server', 'database.js');
    const text = await readFile(file, 'utf8');
    await writeFile(
      file,
      text.replace(
        '    this.data = createData((q, ...b) => ctx.storage.sql.exec(q, ...b));',
        `    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS docs (collection TEXT NOT NULL, id TEXT NOT NULL, owner TEXT NOT NULL, value TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (collection, id))");
    if (![...ctx.storage.sql.exec("SELECT 1 FROM docs")].length) ctx.storage.sql.exec("INSERT INTO docs VALUES ('news', 'today', 'server', '\\"hi\\"', 5)");
    this.data = createData((q, ...b) => ctx.storage.sql.exec(q, ...b));`,
      ),
    );
    assert.notEqual(await readFile(file, 'utf8'), text);
    assert.ok(existsSync(index));
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace(
        "'*': { read: 'owner', write: 'owner' },",
        "'*': { read: 'owner', write: 'owner' },\n  news: { read: 'anyone', write: 'server' },",
      ),
    );
    const dev = await startDev(dir, { port: 0, log: () => {}, env: process.env });
    t.after(() => dev.close());
    assert.equal(dev.server.running, true, JSON.stringify(dev.server));
    const r = await (await fetch(`${dev.url}api/db/news/today`)).json();
    assert.deepEqual(r, { ok: true, item: { id: 'today', owner: 'server', value: 'hi', updatedAt: 5 } });
    assert.match(dev.server.warnings.join('\n'), /server\/database\.js is the older database/);
  },
);
