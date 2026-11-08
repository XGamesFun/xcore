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
import { readOnlyProblem } from '../lib/db.mjs';
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
  assert.equal(own.database.collections, null, 'a server of its own writes its rules in code');
  assert.match(own.warnings.join('\n'), /collections is read only by the stock server/);
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

test('xcore db query reads only, unless --write: one statement, SELECT, EXPLAIN, PRAGMA table_info / table_list', () => {
  for (const ok of ['SELECT * FROM players', 'explain select 1', 'PRAGMA table_info(players)', 'PRAGMA table_list'])
    assert.equal(readOnlyProblem(ok), null, ok);
  for (const no of ['DELETE FROM players', 'PRAGMA writable_schema = 1', 'SELECT 1; DROP TABLE players', ''])
    assert.ok(readOnlyProblem(no), no);
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
    if (url.endsWith('/db/import')) return [200, { ok: true, meta: { changes: 1 } }];
    if (url.endsWith('/db/restore'))
      return json.confirm
        ? [200, { ok: true, restored: { bookmark: 'bm1', at: '2026-11-08T10:00:00Z' } }]
        : [200, { ok: true, preview: { bookmark: 'bm1', at: '2026-11-08T10:00:00Z' }, economy: true }];
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
  // a write is refused here without --write, before anything is sent
  const sent = seen.length;
  r = await xc(['query', 'DELETE FROM players', '--live']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /without --write a query only reads/);
  assert.equal(seen.length, sent);
  r = await xc(['query', 'DELETE FROM players', '--live', '--write', '--json']);
  assert.equal(JSON.parse(r.stdout).ok, true);
  assert.equal(seen.at(-1)[2].write, true);
  // export downloads the dump into .gamesfun/exports/ (hidden: never published)
  r = await xc(['export', '--live', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.match(out.file, /\.gamesfun\/exports\/db-live-.*\.sql$/);
  assert.equal(await readFile(out.file, 'utf8'), dump.toString());
  await writeFile(path.join(tmp.dir, 'in.sql'), 'INSERT INTO players VALUES (1);');
  r = await xc(['import', path.join(tmp.dir, 'in.sql'), '--live']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(seen.at(-1)[2], { sql: 'INSERT INTO players VALUES (1);' });
  // restore: not on this machine; live, a preview, the warning, and no yes (not a terminal): nothing restored
  r = await xc(['restore', '2026-11-08T10:00:00Z']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /restore is --live only/);
  r = await xc(['restore', '2026-11-08T10:00:00Z', '--live']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /would go back to how it was at 2026-11-08T10:00:00Z \(bookmark bm1\)/);
  assert.match(r.stdout, /Warning: This game has an economy: .*Loot balances, items and payouts are not rolled back/);
  assert.match(r.stderr, /nothing was restored: add --yes/);
  assert.ok(!seen.some(s => s[2]?.confirm), 'never confirmed');
  r = await xc(['restore', '2026-11-08T10:00:00Z', '--live', '--yes']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Restored .* to 2026-11-08T10:00:00Z \(bookmark bm1\)/);
  assert.match(r.stderr, /not rolled back/);
  assert.deepEqual(seen.at(-1)[2], { timestamp: '2026-11-08T10:00:00Z', confirm: true });
  r = await xc(['restore', 'yesterday', '--live', '--yes']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /restore needs a time/);
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
    await assert.rejects(dbQuery(dir, 'INSERT INTO players (id) VALUES (?)', { params: ['p1'] }), /only reads/);
    await dbQuery(dir, 'INSERT INTO players (id) VALUES (?)', { params: ['p1'], write: true });
    assert.deepEqual((await dbQuery(dir, 'SELECT id, gold FROM players')).results, [{ id: 'p1', gold: 0 }]);
    const dump = await dbExport(dir);
    assert.match(await readFile(dump.file, 'utf8'), /INSERT INTO "players" \("id", "gold"\) VALUES \('p1', 0\);/);
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
