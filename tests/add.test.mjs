// `xcore add signin|database|multiplayer|rpc|vouchers` (lib/add.mjs): what it writes for a web game, a Godot project and a Unity project, and
// the database it puts in server/ (lib/client/server/database.js), run here over Node's own SQLite in place of a
// Durable Object's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, sign } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  addDatabase,
  addDatabaseObject,
  addMultiplayer,
  addRpc,
  addSignin,
  addVouchers,
  engineOf,
  keepImports,
  withAutoload,
  withScript,
} from '../lib/add.mjs';
import { installServerCopy } from '../lib/economy.mjs';
import IDL from '@xgamesfun/solana/idl.json' with { type: 'json' };
import { encodeAccount } from '@xgamesfun/solana/chain/borsh';
import { decodeBase58 } from '@xgamesfun/solana/chain/base58';
import { decode, voucherBytes } from '@xgamesfun/solana/client';
import { readProof } from '@xgamesfun/solana/results';
import { bundleServer } from '../lib/server/bundle.mjs';
import { OLD_DEFAULT_RULES, OWNER_SPACES } from '../lib/server/contract.mjs';
import { fixture, ROOT, tempDir } from './helpers.mjs';

// the database imports cloudflare:workers (a Durable Object's base class); here a stand-in
register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(s, c, next) { if (s === 'cloudflare:workers') return { url: 'data:text/javascript,' + encodeURIComponent('export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }'), shortCircuit: true }; return next(s, c); }`,
    ),
);
const { createData, GameData, handleDatabase, dataOf } = await import('../lib/client/server/database.js');
const { handleRpc, RPC } = await import('../lib/client/server/rpc.js');

/** A Durable Object's ctx.storage.sql over node:sqlite: exec(query, ...bindings) → the rows. */
function sqlite(db = new DatabaseSync(':memory:')) {
  return {
    db,
    exec(q, ...b) {
      return db.prepare(q).all(...b);
    },
  };
}
const execOf =
  s =>
  (q, ...b) =>
    s.exec(q, ...b);

test('the database: each player reads and writes their own space; the rules and limits hold', async () => {
  let t = 1000;
  const data = createData(execOf(sqlite()), {
    rules: { levels: { read: 'anyone', write: 'owner' }, prizes: { read: 'anyone', write: 'server' } },
    limits: { valueBytes: 200, docsPerPlayer: 3, list: 2 },
    now: () => t++,
  });
  assert.equal((await data.put('levels', 'moon', { name: 'Moon' }, {}, '')).code, 'player', 'a guest writes nothing');
  const moon = await data.put('levels', 'moon', { name: 'Moon' }, {}, 'p1');
  assert.deepEqual(moon, { ok: true, item: { id: 'moon', owner: 'p1', value: { name: 'Moon' }, updatedAt: 1000 } });
  assert.equal((await data.get('levels', 'moon', {}, '')).code, 'player', 'a guest names whose it is');
  assert.deepEqual((await data.get('levels', 'moon', { owner: 'p1' }, '')).item.value, { name: 'Moon' });
  // p2's own space has no moon; p1's has: by id alone that is said, with how to name the owner
  const elsewhere = await data.get('levels', 'moon', {}, 'p2');
  assert.deepEqual([elsewhere.status, elsewhere.code], [400, 'owner']);
  assert.match(elsewhere.why, /not in your own space.*\{owner\}/);
  assert.equal((await data.get('levels', 'moon', { owner: 'me' }, 'p2')).code, 'unknown', 'named: simply not there');
  assert.equal((await data.put('levels', 'moon', 1, { owner: 'p1' }, 'p2')).code, 'not-yours');
  assert.equal((await data.delete('levels', 'moon', { owner: 'p1' }, 'p2')).code, 'not-yours');
  assert.equal((await data.put('levels', 'moon', { name: 'Moon 2' }, {}, 'p1')).item.value.name, 'Moon 2');
  assert.equal((await data.put('levels', 'big', 'x'.repeat(300), {}, 'p1')).code, 'too-big');
  assert.equal((await data.put('levels', 'bad id!', 1, {}, 'p1')).code, 'bad');
  assert.equal((await data.put('levels', 'none', undefined, {}, 'p1')).code, 'bad');
  // a player's quota per collection; the server's own space has none, and the server writes in a player's space
  await data.add('levels', { n: 2 }, {}, 'p1');
  await data.add('levels', { n: 3 }, {}, 'p1');
  assert.equal((await data.add('levels', { n: 4 }, {}, 'p1')).code, 'full');
  assert.equal((await data.put('levels', 'moon', { name: 'Moon 3' }, {}, 'p1')).ok, true, 'a replace still fits');
  assert.equal((await data.add('levels', { n: 5 }, {}, 'server')).item.owner, 'server');
  assert.equal((await data.put('levels', 'gift', 1, { owner: 'p2' }, 'server')).item.owner, 'p2');
  // the default: read 'owner' (every collection not named): others see nothing, not even that it exists
  await data.put('notes', 'n1', 'secret plan', {}, 'p1');
  assert.equal((await data.get('notes', 'n1', { owner: 'p1' }, 'p2')).code, 'unknown');
  assert.equal((await data.get('notes', 'n1', {}, 'p1')).item.value, 'secret plan');
  assert.equal((await data.list('notes', {}, '')).code, 'player');
  assert.deepEqual((await data.list('notes', { owner: 'p1' }, 'p2')).items, [], 'a player lists only their own');
  assert.equal((await data.list('notes', {}, 'server')).items.length, 1);
  assert.equal((await data.get('notes', 'n1', { owner: 'p1' }, 'server')).item.value, 'secret plan');
  // write: 'server': players cannot, the server can; a page reads it without naming the server
  assert.equal((await data.put('prizes', 'today', { won: 100 }, {}, 'p1')).code, 'server-only');
  assert.ok((await data.put('prizes', 'today', { won: 100 }, {}, 'server')).ok);
  assert.deepEqual((await data.get('prizes', 'today', {}, '')).item, {
    id: 'today',
    owner: 'server',
    value: { won: 100 },
    updatedAt: t - 1,
  });
  assert.deepEqual(await data.delete('levels', 'gone', {}, 'p1'), { ok: true, deleted: false });
  assert.deepEqual(await data.delete('levels', 'moon', {}, 'p1'), { ok: true, deleted: true });
});

test("the database: a document by id alone, from 0.1.0 pages: the player's own in a server-written collection; another's named", async () => {
  const data = createData(execOf(sqlite()), {
    rules: {
      inbox: { read: 'owner', write: 'server' },
      prizes: { read: 'anyone', write: 'server' },
      levels: { read: 'anyone', write: 'owner' },
      notes: { read: 'owner', write: 'owner' },
    },
  });
  // read: owner + write: server: what the server wrote in a player's space, read by id alone
  await data.put('inbox', 'welcome', 'hi p1', { owner: 'p1' }, 'server');
  assert.equal((await data.get('inbox', 'welcome', {}, 'p1')).item.value, 'hi p1');
  assert.equal((await data.get('inbox', 'welcome', {}, 'p2')).code, 'unknown', "never another player's");
  // read: anyone + write: server: the server's first, then the player's own
  await data.put('prizes', 'today', 'for all', {}, 'server');
  await data.put('prizes', 'mine', 'for p1', { owner: 'p1' }, 'server');
  assert.equal((await data.get('prizes', 'today', {}, 'p1')).item.value, 'for all');
  assert.equal((await data.get('prizes', 'mine', {}, 'p1')).item.value, 'for p1');
  // another player's document in a collection anyone reads: refused in words that name {owner}
  await data.put('levels', 'abc123', { name: 'Moon' }, {}, 'p1');
  const r = await data.get('levels', 'abc123', {}, 'p2');
  assert.deepEqual([r.ok, r.status, r.code], [false, 400, 'owner']);
  assert.match(r.why, /gf\.db\.get\('levels', 'abc123', \{owner\}\)/);
  assert.equal((await data.get('levels', 'abc123', { owner: 'p1' }, 'p2')).item.value.name, 'Moon');
  // a collection only its owners read never says that another player's document exists
  await data.put('notes', 'n1', 'secret', {}, 'p1');
  assert.equal((await data.get('notes', 'n1', {}, 'p2')).code, 'unknown');
});

test('the database: RULES are checked, and a list fails closed for anything but read: anyone', async () => {
  for (const rules of [
    { levels: { read: 'everyone' } },
    { levels: { write: 'anyone' } },
    { levels: { read: 'anyone', mode: 'x' } },
    { levels: 'anyone' },
    { 'bad name': { read: 'owner' } },
    [],
    null,
  ])
    assert.throws(() => createData(execOf(sqlite()), { rules }), /RULES/, JSON.stringify(rules));
  // a rule changed to something unknown after the check (or a prototype name): the player's own only, never all
  const rules = { '*': { read: 'owner', write: 'owner' }, levels: { read: 'anyone', write: 'owner' } };
  const data = createData(execOf(sqlite()), { rules });
  await data.put('levels', 'a', 1, {}, 'p1');
  await data.put('levels', 'b', 2, {}, 'p2');
  assert.equal((await data.list('levels', {}, '')).items.length, 2);
  rules.levels.read = 'public';
  assert.equal((await data.list('levels', {}, '')).code, 'player', 'a guest lists nothing');
  assert.deepEqual(
    (await data.list('levels', {}, 'p2')).items.map(d => d.id),
    ['b'],
  );
  assert.equal((await data.get('levels', 'a', { owner: 'p1' }, 'p2')).code, 'unknown');
  for (const name of ['__proto__', 'constructor', 'toString']) {
    await data.put(name, 'x', 1, {}, 'p1');
    assert.equal((await data.list(name, {}, '')).code, 'player', name);
  }
});

test('the database: no player takes an id in another player’s space, or the server’s', async () => {
  const data = createData(execOf(sqlite()), { rules: { '*': { read: 'anyone', write: 'owner' } } });
  // p2 writes "main" first, and p1's own "main" is still p1's to make
  assert.equal((await data.put('profiles', 'main', { name: 'squatter' }, {}, 'p2')).ok, true);
  const mine = await data.put('profiles', 'main', { name: 'Ana' }, {}, 'p1');
  assert.deepEqual([mine.ok, mine.item.owner], [true, 'p1']);
  assert.equal((await data.get('profiles', 'main', {}, 'p1')).item.value.name, 'Ana');
  assert.equal((await data.get('profiles', 'main', { owner: 'p2' }, 'p1')).item.value.name, 'squatter');
  // a player who names someone else's space, or the server's, is refused; the server's own "main" is untouched
  await data.put('profiles', 'main', { name: 'official' }, {}, 'server');
  assert.equal((await data.put('profiles', 'main', 1, { owner: 'server' }, 'p2')).code, 'not-yours');
  assert.equal((await data.put('profiles', 'main', 1, { owner: 'p1' }, 'p2')).code, 'not-yours');
  assert.equal((await data.add('profiles', 1, { owner: 'p1' }, 'p2')).code, 'not-yours');
  assert.equal((await data.get('profiles', 'main', { owner: 'server' }, '')).item.value.name, 'official');
  assert.equal((await data.list('profiles', {}, '')).items.length, 3, 'three documents, one "main" each');
});

test('the database: a list is paged by an after cursor over (updated, id), with ties, and offset is refused', async () => {
  let t = 0;
  const data = createData(execOf(sqlite()), {
    rules: { '*': { read: 'anyone', write: 'owner' } },
    now: () => Math.floor(t++ / 3), // three writes a millisecond: ties the cursor must keep apart
  });
  for (let i = 0; i < 7; i++) await data.put('runs', `r${i}`, i, {}, i % 2 ? 'p1' : 'p2');
  const walk = async opts => {
    const seen = [];
    let after = '';
    for (let page = 0; page < 10; page++) {
      const a = await data.list('runs', { ...opts, limit: 2, after }, '');
      assert.equal(a.ok, true, JSON.stringify(a));
      seen.push(...a.items.map(d => d.value));
      assert.equal(a.more, !!a.after);
      if (!a.more) return seen;
      after = a.after;
    }
    throw new Error('it never ended');
  };
  // newest first; within a millisecond by owner, then id (both newest-first too): every document once
  const all = (await data.list('runs', { limit: 100 }, '')).items;
  assert.deepEqual(
    all.map(d => d.updatedAt),
    [2, 1, 1, 1, 0, 0, 0],
  );
  assert.deepEqual(await walk({}), [6, 4, 5, 3, 2, 0, 1]);
  assert.deepEqual(
    await walk({}),
    all.map(d => d.value),
  );
  assert.deepEqual(await walk({ order: 'old' }), [6, 4, 5, 3, 2, 0, 1].reverse());
  assert.deepEqual(await walk({ owner: 'p1' }), [5, 3, 1]);
  assert.equal((await data.list('runs', { offset: 2 }, '')).code, 'bad');
  assert.match((await data.list('runs', { offset: 2 }, '')).why, /offset is gone: page with after/);
  assert.equal((await data.list('runs', { after: 'not a cursor' }, '')).code, 'bad');
});

test('the database: a table an older database.js made moves to the new one, every document kept by its owner', async () => {
  const s = sqlite();
  // the schema of xcore 0.1.0: one id per collection
  s.db.exec(
    'CREATE TABLE docs (collection TEXT NOT NULL, id TEXT NOT NULL, owner TEXT NOT NULL, value TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (collection, id))',
  );
  s.db.exec('CREATE INDEX docs_owner ON docs (collection, owner, updated)');
  s.db.exec(`INSERT INTO docs VALUES ('levels', 'moon', 'p1', '{"n":1}', 5), ('news', 'today', 'server', '"hi"', 6)`);
  const data = createData(execOf(s), { rules: { '*': { read: 'anyone', write: 'owner' }, news: { write: 'server' } } });
  await data.ready;
  assert.deepEqual((await data.get('levels', 'moon', {}, 'p1')).item, {
    id: 'moon',
    owner: 'p1',
    value: { n: 1 },
    updatedAt: 5,
  });
  assert.equal((await data.get('news', 'today', {}, '')).item.value, 'hi');
  assert.match(s.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'docs'").get().sql, /collection, owner, id/);
  // a move stopped half way (the old table gone, the new one not renamed yet) is finished the next time
  const half = sqlite();
  half.db.exec(
    'CREATE TABLE docs_v2 (collection TEXT NOT NULL, owner TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (collection, owner, id))',
  );
  half.db.exec(`INSERT INTO docs_v2 VALUES ('levels', 'p1', 'moon', '1', 5)`);
  const again = createData(execOf(half));
  assert.equal((await again.get('levels', 'moon', {}, 'p1')).item.value, 1);
  // and a second start changes nothing
  assert.equal((await createData(execOf(s)).get('levels', 'moon', {}, 'p1')).item.value.n, 1);
});

test("the database's routes: the page's token is checked by xgames.fun, and the calls reach the one object", async () => {
  const ctx = { storage: { sql: sqlite() } };
  const object = new GameData(ctx, {});
  const env = {
    GF: {
      verifyPlayer: async token =>
        token === 'good'
          ? { ok: true, sub: 'x:42' }
          : token === 'other'
            ? { ok: true, sub: 'x:7' }
            : token === 'server'
              ? { ok: true, sub: 'server' }
              : { ok: false, why: 'expired' },
    },
    GAME_DATA: { idFromName: name => name, get: () => ({ run: (op, args) => object.run(op, args) }) },
  };
  const call = async (method, p, { body, token } = {}) => {
    const res = await handleDatabase(
      new Request(`https://moth-play.xgames.fun${p}`, {
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
    return res && { status: res.status, body: await res.json() };
  };
  assert.equal(await call('GET', '/api/rooms'), null, 'another route of the server goes on');
  assert.equal((await call('POST', '/api/db/levels', { body: { value: 1 } })).status, 401);
  assert.equal(
    (await call('POST', '/api/db/levels', { body: { value: 1 }, token: 'old' })).body.why,
    'Sign in again: expired.',
  );
  assert.equal((await call('POST', '/api/db/levels', { body: { value: 1 }, token: 'server' })).status, 401);
  const made = await call('POST', '/api/db/levels', { body: { value: { name: 'Moon' } }, token: 'good' });
  assert.equal(made.status, 200);
  assert.equal(made.body.item.owner, 'x:42');
  assert.equal(made.body.status, undefined, 'the HTTP status is not repeated in the body');
  const id = made.body.item.id;
  assert.deepEqual((await call('GET', `/api/db/levels/${id}`, { token: 'good' })).body.item.value, { name: 'Moon' });
  // the default is read 'owner': another player, or a guest naming the owner, does not see it
  assert.equal((await call('GET', `/api/db/levels/${id}?owner=x%3A42`, { token: 'other' })).status, 404);
  assert.equal((await call('GET', `/api/db/levels/${id}?owner=x%3A42`)).status, 404);
  assert.equal((await call('GET', '/api/db/levels?owner=me', { token: 'good' })).body.items.length, 1);
  assert.deepEqual((await call('GET', '/api/db/levels', { token: 'other' })).body, {
    ok: true,
    items: [],
    more: false,
    after: null,
  });
  assert.equal((await call('GET', '/api/db/levels?offset=50', { token: 'good' })).status, 400);
  assert.equal((await call('PUT', `/api/db/levels/${id}`, { body: { value: 2 }, token: 'good' })).body.item.value, 2);
  assert.equal(
    (await call('PUT', `/api/db/levels/${id}?owner=x%3A42`, { body: { value: 3 }, token: 'other' })).body.code,
    'not-yours',
  );
  assert.equal((await call('PATCH', `/api/db/levels/${id}`, { token: 'good' })).status, 405);
  // under a folder (a preview, the kit's dev server's /game/) the same calls
  assert.equal((await call('GET', `/game/api/db/levels/${id}`, { token: 'good' })).status, 200);
  assert.equal((await call('DELETE', `/api/db/levels/${id}`, { token: 'good' })).body.deleted, true);
  assert.equal((await call('GET', `/api/db/levels/${id}`, { token: 'good' })).status, 404);
  // the server's own code, past the players' rules: its own space by default, a player's by name
  const server = dataOf(env);
  assert.equal((await server.put('news', 'today', { text: 'hi' })).item.owner, 'server');
  assert.equal((await server.get('news', 'today')).item.value.text, 'hi');
  assert.equal((await server.put('levels', 'gift', 9, { owner: 'x:42' })).item.owner, 'x:42');
  assert.equal((await call('GET', '/api/db/levels/gift', { token: 'good' })).body.item.value, 9);
  assert.equal((await server.list('news')).items.length, 1);
  assert.equal((await server.list('levels', { owner: 'x:42' })).items.length, 1);
});

test('add database again: an untouched RULES from 0.1.0 (anyone read) becomes the new default', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await addDatabaseObject(dir);
  const file = path.join(dir, 'server/database.js');
  const now = await readFile(file, 'utf8');
  assert.match(now, /'\*': \{ read: 'owner', write: 'owner' \}/);
  await writeFile(
    file,
    now.replace("'*': { read: 'owner', write: 'owner' }", "'*': { read: 'anyone', write: 'owner' }"),
  );
  const r = await addDatabase(dir);
  assert.match(await readFile(file, 'utf8'), /'\*': \{ read: 'owner', write: 'owner' \}/);
  assert.ok(
    r.steps.some(s => /was the old default, where anyone read every document/.test(s)),
    r.steps.join('\n'),
  );
  // RULES the person wrote are theirs, whatever they say
  await writeFile(
    file,
    (await readFile(file, 'utf8')).replace("'*': {", "levels: { read: 'anyone', write: 'owner' },\n  '*': {"),
  );
  const mine = await addDatabase(dir);
  assert.match(await readFile(file, 'utf8'), /levels: \{ read: 'anyone', write: 'owner' \}/);
  assert.ok(!mine.steps.some(s => /old default/.test(s)));
  // published as 0.1.0 left it, untouched: the check says it is open to anyone, and how to close it
  const before = await readFile(file, 'utf8');
  await writeFile(file, before.replace(/export const RULES = \{[\s\S]*?\n\};/, OLD_DEFAULT_RULES));
  const open = await bundleServer(dir);
  assert.match(
    open.warnings.join('\n'),
    /still has the RULES xcore 0\.1\.0 wrote .*open to anyone, signed in or not.*add database makes each player's documents their own/,
  );
  assert.doesNotMatch(open.warnings.join('\n'), /It keeps working/);
  await writeFile(file, before);
  assert.match((await bundleServer(dir)).warnings.join('\n'), /older database .*It keeps working/);
  // refused for the 8 Durable Objects a server may have: refused before database.js is touched
  const cfgFile = path.join(dir, 'gamesfun.json');
  const cfg = JSON.parse(await readFile(cfgFile, 'utf8'));
  cfg.server.objects = Array.from({ length: 8 }, (_, i) => ({ class: `Room${i}`, binding: `ROOM_${i}` }));
  await writeFile(cfgFile, JSON.stringify(cfg));
  const old = before.replace(/export const RULES = \{[\s\S]*?\n\};/, OLD_DEFAULT_RULES);
  await writeFile(file, old);
  await assert.rejects(addDatabase(dir), /already declares 8 Durable Objects/);
  assert.equal(await readFile(file, 'utf8'), old, 'database.js left as it was');
});

test("upgrading 0.1.0's database.js: each dataOf(env) call with no owner is said with its change, by add database and at publish", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await addDatabaseObject(dir);
  const file = path.join(dir, 'server/database.js');
  const now = await readFile(file, 'utf8');
  const game = [
    "import { dataOf } from './database.js';",
    'export async function profile(env, sub, opts) {',
    "  const { item } = await dataOf(env).get('profiles', sub);",
    "  await dataOf(env).put('profiles', sub, { gold: 1 });",
    "  await dataOf(env).put('profiles', sub, { gold: 1 }, { owner: sub });",
    '  const data = dataOf(env);',
    "  await data.delete('profiles', sub);",
    "  await data.add('news', { at: 1 }, { owner: 'server' });",
    "  await data.list('news', { limit: 10, offset: 20 });",
    "  await data.list('news', { limit: 10, offset: 0 });",
    "  await data.get('profiles', sub, opts);",
    "  await data.add('news', { at: 2 });",
    "  // dataOf(env).get('in', 'a comment') is not code",
    `  const s = "dataOf(env).get('in', 'a string')";`,
    '  return [item, s];',
    '}',
    '',
  ].join('\n');
  await writeFile(path.join(dir, 'server/game.js'), game);
  await writeFile(
    path.join(dir, 'server/index.js'),
    "import { handleDatabase } from './database.js';\nimport { profile } from './game.js';\nexport { GameData } from './database.js';\nexport default {\n  async fetch(request, env) {\n    const r = await handleDatabase(request, env);\n    if (r) return r;\n    return Response.json(await profile(env, 'x'));\n  },\n};\n",
  );
  // database.js as 0.1.0 had it: one id a collection, no space of each player's own
  await writeFile(file, now.replace(OWNER_SPACES, 'PRIMARY KEY (collection, id)'));
  const want = [
    ['server/game.js', 3, 'get', /server's own space .*answers 404.*\{owner: sub\}.*\{owner: 'server'\}/],
    ['server/game.js', 4, 'put', /the server's own copy, which the player never sees/],
    ['server/game.js', 7, 'delete', /deletes the server's own copy/],
    ['server/game.js', 9, 'list', /offset is refused now: page with .*after/],
    ['server/game.js', 12, 'add', /adds to the server's own space/],
  ];
  const r = await addDatabase(dir);
  assert.equal(await readFile(file, 'utf8'), now, 'database.js brought up to date');
  assert.deepEqual(
    r.calls.map(c => [c.file, c.line, c.op]),
    want.map(w => w.slice(0, 3)),
  );
  r.calls.forEach((c, i) => assert.match(c.fix, want[i][3]));
  const step = r.steps.find(x => /was 0\.1\.0's/.test(x));
  assert.ok(step, r.steps.join('\n'));
  assert.match(step, /change these 5 calls before you publish/);
  assert.match(step, /server\/game\.js:3 dataOf\(env\)\.get\(…\): without an owner/);
  // again, the file already up to date: nothing upgraded, nothing said
  assert.equal((await addDatabase(dir)).calls.length, 0);
  // publish says them as long as they are there
  const b = await bundleServer(dir);
  const said = b.warnings.find(w => /dataOf\(env\) with no owner/.test(w));
  assert.ok(said, b.warnings.join('\n'));
  for (const [f, line, op] of want) assert.match(said, new RegExp(`${f}:${line} dataOf\\(env\\)\\.${op}\\(`));
  assert.doesNotMatch(said, /game\.js:(5|8|10|11|13|14):/);
  // each says whose space it means: nothing to say
  await writeFile(
    path.join(dir, 'server/game.js'),
    game
      .replace("get('profiles', sub)", "get('profiles', sub, { owner: sub })")
      .replace('{ gold: 1 });', "{ gold: 1 }, { owner: 'server' });")
      .replace("delete('profiles', sub)", "delete('profiles', sub, { owner: sub })")
      .replace('offset: 20', "after: ''")
      .replace('{ at: 2 })', "{ at: 2 }, { owner: 'server' })"),
  );
  assert.doesNotMatch((await bundleServer(dir)).warnings.join('\n'), /dataOf\(env\) with no owner/);
  // a 0.1.0 database.js not upgraded yet: its calls still mean what they did, so publish says nothing of them
  await writeFile(path.join(dir, 'server/game.js'), game);
  await writeFile(file, now.replace(OWNER_SPACES, 'PRIMARY KEY (collection, id)'));
  assert.doesNotMatch((await bundleServer(dir)).warnings.join('\n'), /dataOf\(env\) with no owner/);
});

test('signin for a web game: gamesfun.js beside the page and loaded first; again, nothing changes', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  assert.equal(engineOf(dir), 'page');
  const r = await addSignin(dir);
  assert.equal(r.engine, 'page');
  assert.equal(
    await readFile(path.join(dir, 'gamesfun.js'), 'utf8'),
    await readFile(path.join(ROOT, 'lib/client/gamesfun.js'), 'utf8'),
  );
  assert.match(
    await readFile(path.join(dir, 'index.html'), 'utf8'),
    /<head[^>]*>\s*<script src="\.\/gamesfun\.js"><\/script>/,
  );
  assert.deepEqual((await addSignin(dir)).written, [], 'run again: already up to date');
  assert.equal(withScript('<p>no head</p>'), '<script src="./gamesfun.js"></script>\n<p>no head</p>');
});

test('signin before adopt in a Vite project: gamesfun.js goes in public/, which the build copies', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = path.join(tmp.dir, 'vite-game');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '^8.0.0' } }),
  );
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><html><head></head><body></body></html>');
  await addSignin(dir);
  assert.ok(existsSync(path.join(dir, 'public', 'gamesfun.js')), 'in the folder Vite copies');
  assert.ok(!existsSync(path.join(dir, 'gamesfun.js')), 'not in the root, which the build does not publish');
  assert.match(await readFile(path.join(dir, 'index.html'), 'utf8'), /<script src="\.\/gamesfun\.js"><\/script>/);
});

test('signin for a Godot project: the autoload carries the client; for a Unity project, the WebGL plugin does', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const client = await readFile(path.join(ROOT, 'lib/client/gamesfun.js'), 'utf8');
  const godot = path.join(tmp.dir, 'godot');
  await mkdir(godot);
  await writeFile(path.join(godot, 'project.godot'), 'config_version=5\n\n[application]\n\nconfig/name="Moth"\n');
  const g = await addSignin(godot);
  assert.equal(g.engine, 'godot');
  const gd = await readFile(path.join(godot, 'addons/gamesfun/gamesfun.gd'), 'utf8');
  const b64 = /const SOURCE = "([A-Za-z0-9+/=]+)"/.exec(gd)?.[1];
  assert.equal(Buffer.from(b64, 'base64').toString('utf8'), client);
  assert.match(
    await readFile(path.join(godot, 'project.godot'), 'utf8'),
    /\[autoload\]\n\nGamesFun="\*res:\/\/addons\/gamesfun\/gamesfun\.gd"\n$/,
  );
  assert.equal(
    withAutoload('[autoload]\n\nMusic="*res://music.gd"\n'),
    '[autoload]\n\nGamesFun="*res://addons/gamesfun/gamesfun.gd"\nMusic="*res://music.gd"\n',
  );
  assert.ok(
    existsSync(path.join(godot, 'addons/gamesfun/gamesfun_peer.gd')),
    'the multiplayer peer the autoload preloads',
  );
  assert.deepEqual((await addSignin(godot)).written, []);

  const unity = path.join(tmp.dir, 'unity');
  await mkdir(path.join(unity, 'ProjectSettings'), { recursive: true });
  await mkdir(path.join(unity, 'Assets'));
  await writeFile(path.join(unity, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.0.30f1\n');
  const u = await addSignin(unity);
  assert.equal(u.engine, 'unity');
  const jslib = await readFile(path.join(unity, 'Assets/Plugins/GamesFun/GamesFun.jslib'), 'utf8');
  assert.equal(Buffer.from(/var b64 = '([A-Za-z0-9+/=]+)'/.exec(jslib)[1], 'base64').toString('utf8'), client);
  assert.ok(existsSync(path.join(unity, 'Assets/Plugins/GamesFun/GamesFun.cs')));

  await assert.rejects(addSignin(path.join(tmp.dir)), /not a game xcore knows/);
});

test('the older database (server/database.js): its object declared; the bundle is one publish takes; a server of its own is left to its owner', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  const r = await addDatabaseObject(dir);
  assert.ok(existsSync(path.join(dir, 'gamesfun.js')), 'signin comes with it');
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'gamesfun.json'), 'utf8')).server.objects, [
    { class: 'GameData', binding: 'GAME_DATA' },
  ]);
  const b = await bundleServer(dir);
  assert.deepEqual(b.problems, []);
  assert.ok(b.ok, JSON.stringify(b.warnings));
  assert.ok(b.exports.includes('GameData'));
  assert.doesNotMatch(r.steps.join('\n'), /is your own/);
  assert.deepEqual((await addDatabase(dir)).written, [], 'run again: already up to date');

  const tmp2 = await tempDir();
  t.after(tmp2.cleanup);
  const own = await fixture(tmp2, 'static');
  await mkdir(path.join(own, 'server'));
  await writeFile(path.join(own, 'server', 'index.js'), 'export default { fetch: () => new Response("mine") };\n');
  const o = await addDatabaseObject(own);
  assert.equal(
    await readFile(path.join(own, 'server', 'index.js'), 'utf8'),
    'export default { fetch: () => new Response("mine") };\n',
  );
  assert.ok(
    o.steps.some(x => /server\/index\.js is your own: .*export \{ GameData \} from '\.\/database\.js'/.test(x)),
    o.steps.join('\n'),
  );
});

test('multiplayer beside the database: one server routes both, both objects declared, the bundle is one publish takes', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  const m = await addMultiplayer(dir);
  assert.match(m.steps.join('\n'), /GamesFun\.rooms\.join/);
  await addDatabaseObject(dir);
  const index = await readFile(path.join(dir, 'server/index.js'), 'utf8');
  assert.match(index, /handleDatabase[\s\S]*handleRooms/);
  assert.match(index, /Written by `xcore add database` and `xcore add multiplayer`/);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'gamesfun.json'), 'utf8')).server.objects, [
    { class: 'GameRoom', binding: 'GAME_ROOMS' },
    { class: 'GameData', binding: 'GAME_DATA' },
  ]);
  const b = await bundleServer(dir);
  assert.deepEqual(b.problems, []);
  assert.deepEqual(b.exports.filter(e => e !== 'default').sort(), ['GameData', 'GameRoom']);
  // the person took the file over (removed "Written by"): xcore leaves it, and says what to add
  const theirs = index
    .replace('Written by', 'Was written by')
    .replace("import { handleRooms } from './rooms.js';\n", '');
  await writeFile(path.join(dir, 'server/index.js'), theirs);
  const again = await addMultiplayer(dir);
  assert.equal(await readFile(path.join(dir, 'server/index.js'), 'utf8'), theirs, 'their file is left alone');
  assert.ok(!again.steps.some(x => /is your own/.test(x)), 'it still names handleRooms: nothing to add');
  // the settings they changed (ROOM, RULES) survive the next `xcore add`, and a setting a new version adds comes in
  const roomsFile = path.join(dir, 'server/rooms.js');
  await writeFile(
    roomsFile,
    (await readFile(roomsFile, 'utf8'))
      .replace('maxPlayers: 16', 'maxPlayers: 2')
      .replace(/\n.*\n {2}perSecond: \d+,/, ''),
  );
  const dbFile = path.join(dir, 'server/database.js');
  await writeFile(
    dbFile,
    (await readFile(dbFile, 'utf8')).replace("'*': {", "levels: { read: 'owner', write: 'owner' },\n  '*': {"),
  );
  await addMultiplayer(dir);
  await addDatabase(dir);
  const rooms = await readFile(roomsFile, 'utf8');
  assert.match(rooms, /maxPlayers: 2,/);
  assert.match(rooms, /perSecond: 120,/);
  assert.match(await readFile(dbFile, 'utf8'), /levels: \{ read: 'owner', write: 'owner' \}/);
  const tmp2 = await tempDir();
  t.after(tmp2.cleanup);
  const godot = path.join(tmp2.dir, 'godot');
  await mkdir(godot);
  await writeFile(path.join(godot, 'project.godot'), 'config_version=5\n');
  const g = await addMultiplayer(godot);
  assert.match(g.steps.join('\n'), /GamesFun\.join_room\(code\)/);
  assert.match(g.steps.join('\n'), /local ENet game/);
});

test('the Godot client refuses an offset but 0 in db_list before it reaches the page (in the editor too), as gamesfun.js does', async () => {
  const gd = await readFile(path.join(ROOT, 'lib', 'client', 'godot', 'gamesfun.gd'), 'utf8');
  const fn = /func db_list\(collection: String, opts := \{\}\):\n([\s\S]*?)\n\n/.exec(gd)?.[1] ?? '';
  const refuse = fn.indexOf('if opts.has("offset") and');
  // a real offset only: 0 (or none) is the first page, as gamesfun.js takes it
  assert.match(fn, /float\(str\(opts\["offset"\]\)\) != 0\.0/);
  assert.ok(refuse >= 0, fn);
  assert.ok(refuse < fn.indexOf('_run("db.list"'), 'refused before the bridge is asked');
  assert.match(fn, /"code": "offset"/);
  const cs = await readFile(path.join(ROOT, 'lib', 'client', 'unity', 'GamesFun.cs'), 'utf8');
  assert.doesNotMatch(/public static Task<string> DbList\([^)]*\)/.exec(cs)[0], /offset/, "Unity's DbList takes after");
});

test("the engines' glue files hold no raw control character or line separator (C# and GDScript break on them)", async () => {
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(path.join(ROOT, 'lib/client'), { recursive: true })).filter(f =>
    /\.(js|gd|cs|jslib)$/.test(f),
  );
  assert.ok(files.length >= 6, files.join());
  for (const f of files)
    assert.doesNotMatch(
      await readFile(path.join(ROOT, 'lib/client', f), 'utf8'),
      // eslint-disable-next-line no-control-regex -- the raw characters are what this looks for
      /[\u2028\u2029\u0000-\u0008\u000b\u000c\u000e-\u001f]/,
      f,
    );
});

test('a published gamesfun.js that the built index.html does not load is named (a build that writes index.html from a template)', async t => {
  const { unloadedClient } = await import('../lib/check.mjs');
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const files = [{ path: 'index.html' }, { path: 'gamesfun.js' }];
  const roots = { out: tmp.dir, overlay: null, build: 'node tools/build.mjs' };
  await writeFile(path.join(tmp.dir, 'index.html'), '<!doctype html><head><title>x</title></head>');
  const [why] = unloadedClient(files, roots);
  assert.match(why, /does not load gamesfun\.js.*node tools\/build\.mjs writes index\.html/);
  await writeFile(path.join(tmp.dir, 'index.html'), '<head><script src="./gamesfun.js"></script></head>');
  assert.deepEqual(unloadedClient(files, roots), []);
  assert.deepEqual(unloadedClient([{ path: 'index.html' }], roots), [], 'no client published: nothing to say');
});

test('a client copy from an older xcore is named, and add signin brings it up to date', async t => {
  const { staleClient } = await import('../lib/add.mjs');
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const godot = path.join(tmp.dir, 'godot');
  await mkdir(godot);
  await writeFile(path.join(godot, 'project.godot'), 'config_version=5\n');
  await addSignin(godot);
  assert.deepEqual(await staleClient(godot), []);
  const gd = path.join(godot, 'addons/gamesfun/gamesfun.gd');
  await writeFile(gd, (await readFile(gd, 'utf8')).replace('func loot_ready', 'func old_loot_ready'));
  assert.deepEqual(await staleClient(godot), ['addons/gamesfun/gamesfun.gd']);
  await addSignin(godot);
  assert.deepEqual(await staleClient(godot), []);
  const web = path.join(tmp.dir, 'web');
  await mkdir(web);
  await writeFile(path.join(web, 'index.html'), '<!doctype html><head></head>');
  await addSignin(web);
  await writeFile(path.join(web, 'gamesfun.js'), '// an older copy');
  assert.deepEqual(await staleClient(web), ['gamesfun.js']);
});

test('a Godot project with no Web export gets a single-threaded Web preset, once', async t => {
  const { godotWebPreset, GODOT_EXCLUDE } = await import('../lib/publish/adopt.mjs');
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  await writeFile(path.join(tmp.dir, 'project.godot'), 'config_version=5\n');
  await writeFile(
    path.join(tmp.dir, 'export_presets.cfg'),
    '[preset.0]\n\nname="Linux"\nplatform="Linux"\n\n[preset.0.options]\n\nx=1\n',
  );
  const first = await godotWebPreset(tmp.dir);
  assert.deepEqual(first, { wrote: true, name: 'Web', path: 'build/web/index.html', threads: false });
  const cfg = await readFile(path.join(tmp.dir, 'export_presets.cfg'), 'utf8');
  assert.match(cfg, /\[preset\.1\]\n\nname="Web"\nplatform="Web"/);
  assert.match(cfg, /\[preset\.1\.options\][^[]*variant\/thread_support=false/);
  assert.ok(cfg.includes(`exclude_filter="${GODOT_EXCLUDE}"`));
  assert.ok(cfg.startsWith('[preset.0]'), 'the presets it had are kept');
  assert.ok(existsSync(path.join(tmp.dir, 'build', '.gdignore')) && existsSync(path.join(tmp.dir, 'build', 'web')));
  const again = await godotWebPreset(tmp.dir);
  assert.equal(again.wrote, false);
  assert.equal(await readFile(path.join(tmp.dir, 'export_presets.cfg'), 'utf8'), cfg, 'unchanged');
  await writeFile(
    path.join(tmp.dir, 'export_presets.cfg'),
    cfg.replace('variant/thread_support=false', 'variant/thread_support=true'),
  );
  assert.equal((await godotWebPreset(tmp.dir)).threads, true, 'a preset with threads is said');
});

test('a Godot export older than the project is named; adopt before the first export writes the preset', async t => {
  const { staleExport } = await import('../lib/check.mjs');
  const { adopt, reportLines } = await import('../lib/publish/adopt.mjs');
  const { utimes } = await import('node:fs/promises');
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  await writeFile(path.join(tmp.dir, 'project.godot'), 'config_version=5\n');
  await writeFile(path.join(tmp.dir, 'main.gd'), 'extends Node\n');
  const named = await adopt(tmp.dir, { out: 'build/web' });
  assert.ok(
    named.refused.length && /export_presets\.cfg/.test(named.refused[0].fix),
    'the preset, before the first export',
  );
  assert.match(
    reportLines(named).join('\n'),
    /Wrote export_presets\.cfg \(a Web preset\) and build\/\.gdignore; no record yet/,
  );
  await writeFile(path.join(tmp.dir, 'build', 'web', 'index.html'), '<!doctype html>');
  await writeFile(path.join(tmp.dir, 'build', 'web', 'index.pck'), 'pck');
  const past = new Date(Date.now() - 60_000);
  await utimes(path.join(tmp.dir, 'build', 'web', 'index.pck'), past, past);
  assert.equal(await staleExport(tmp.dir, path.join(tmp.dir, 'build', 'web')), 'main.gd');
  await utimes(path.join(tmp.dir, 'main.gd'), new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
  await utimes(path.join(tmp.dir, 'project.godot'), new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
  assert.equal(await staleExport(tmp.dir, path.join(tmp.dir, 'build', 'web')), null);
});

test("rpc: the game's own RPC at api/rpc, only loot's calls, its URL never answered; unset, the page keeps the relay", async t => {
  const call = (method, body, env) =>
    handleRpc(
      new Request('https://g-play.example/api/rpc', {
        method,
        ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      }),
      env,
    );
  assert.equal(await handleRpc(new Request('https://g-play.example/api/state'), {}), null, 'another path: not its');
  assert.deepEqual(await (await call('GET', undefined, {})).json(), { gamesfun: 'rpc', own: false });
  const own = { XSOLANA_RPC_URL: 'https://devnet.rpc.example/?api-key=SECRET' };
  assert.deepEqual(await (await call('GET', undefined, own)).json(), { gamesfun: 'rpc', own: true });
  for (const url of ['https://mainnet.rpc.example/', 'http://rpc.example/', 'not a url'])
    assert.equal((await (await call('GET', undefined, { XSOLANA_RPC_URL: url })).json()).own, false, url);
  assert.equal((await call('POST', { jsonrpc: '2.0', id: 1, method: 'getSlot' }, {})).status, 503);

  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: init.body });
    if (init.body.includes('getBalance')) throw new TypeError('fetch failed');
    if (init.body.includes('getSlot') && sent.length > 1)
      return new Response(`This game's server may not call ${url}. Add the origin to backend.json.`, { status: 403 });
    return new Response('{"jsonrpc":"2.0","id":1,"result":42}', { headers: { 'content-type': 'application/json' } });
  };
  t.after(() => (globalThis.fetch = realFetch));
  const ok = await call('POST', { jsonrpc: '2.0', id: 1, method: 'getSlot' }, own);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { jsonrpc: '2.0', id: 1, result: 42 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, own.XSOLANA_RPC_URL);
  const refused = async (body, code) => {
    const r = await call('POST', body, own);
    const j = await r.json();
    assert.equal(j.error?.code, code, JSON.stringify(j));
    assert.doesNotMatch(JSON.stringify(j), /SECRET/, 'never the key');
    return j;
  };
  await refused({ jsonrpc: '2.0', id: 2, method: 'requestAirdrop', params: [] }, -32601);
  await refused([{ jsonrpc: '2.0', id: 3, method: 'getSlot' }], -32600);
  await refused('{nope', -32700);
  await refused({ jsonrpc: '2.0', id: 4, method: 'getProgramAccounts', params: ['Prog111'] }, -32602);
  await refused({ jsonrpc: '2.0', id: 5, method: 'getSlot', pad: 'x'.repeat(RPC.maxBody) }, -32600);
  await refused({ jsonrpc: '2.0', id: 6, method: 'getBalance', params: ['Addr111'] }, -32000);
  assert.equal(sent.length, 2, 'only the getBalance that failed upstream went out after the first');
  const words = await refused({ jsonrpc: '2.0', id: 7, method: 'getSlot' }, -32000);
  assert.match(
    words.error.message,
    /refused \(403\): This game's server may not call https:\/\/devnet\.rpc\.example\. Add/,
  );
  // scans only of loot's own programs; transactions only the game's own (a loot instruction, or a plain SOL send)
  const [LOOT_ID, CORE_ID] = RPC.scanPrograms;
  const filters = [{ dataSize: 1 }];
  await refused({ jsonrpc: '2.0', id: 8, method: 'getProgramAccounts', params: ['Prog111', { filters }] }, -32602);
  const scan = await call(
    'POST',
    { jsonrpc: '2.0', id: 9, method: 'getProgramAccounts', params: [CORE_ID, { filters }] },
    own,
  );
  assert.equal(scan.status, 200, "a scan of Core (the player's NFTs) goes on");
  // a legacy transaction: one empty signature, then a message whose instructions call `programs`
  const wire = programs => {
    const keys = [new Uint8Array(32).fill(7), ...programs.map(p => decodeBase58(p))];
    return Buffer.concat([
      Buffer.from([1]),
      Buffer.alloc(64),
      Buffer.from([1, 0, programs.length, keys.length]),
      ...keys.map(k => Buffer.from(k)),
      Buffer.alloc(32),
      Buffer.from([programs.length]),
      ...programs.map((_, i) => Buffer.from([i + 1, 0, 0])),
    ]).toString('base64');
  };
  const send = (programs, id) =>
    call(
      'POST',
      { jsonrpc: '2.0', id, method: 'sendTransaction', params: [wire(programs), { encoding: 'base64' }] },
      own,
    );
  assert.equal((await send([RPC.plainPrograms[1], LOOT_ID], 10)).status, 200, "the game's own transaction is sent");
  assert.equal(
    (await send([RPC.plainPrograms[0]], 11)).status,
    200,
    'a plain SOL send (a key sending SOL back) is sent',
  );
  for (const [programs, id] of [
    [['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'], 12],
    [[RPC.plainPrograms[0], CORE_ID], 13],
  ])
    assert.equal((await (await send(programs, id)).json()).error?.code, -32602, `refused: ${programs}`);
  await refused({ jsonrpc: '2.0', id: 14, method: 'sendTransaction', params: ['not a transaction'] }, -32602);
});

test('add rpc: server/rpc.js routed in an index of its own, no object declared, beside the rooms; the bundle builds', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await writeFile(path.join(dir, '.dev.vars'), 'XSOLANA_RPC_URL=https://devnet.rpc.example.com/?api-key=SECRET\n');
  const r = await addRpc(dir);
  assert.ok(existsSync(path.join(dir, 'server', 'rpc.js')));
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'backend.json'), 'utf8')), {
    version: 1,
    origins: ['https://devnet.rpc.example.com'],
  });
  assert.doesNotMatch(r.written.join('\n'), /SECRET/);
  const index = await readFile(path.join(dir, 'server', 'index.js'), 'utf8');
  assert.match(index, /import \{ handleRpc \} from '\.\/rpc\.js';/);
  assert.doesNotMatch(index, /export \{ .* \} from '\.\/rpc\.js'/);
  const cfg = path.join(dir, 'gamesfun.json');
  assert.equal(existsSync(cfg) ? JSON.parse(await readFile(cfg, 'utf8')).server?.objects : undefined, undefined);
  assert.match(r.steps.join('\n'), /secret set XSOLANA_RPC_URL/);
  await addMultiplayer(dir);
  const both = await readFile(path.join(dir, 'server', 'index.js'), 'utf8');
  assert.match(both, /handleRooms/);
  assert.match(both, /handleRpc/);
  const b = await bundleServer(dir);
  assert.deepEqual(b.problems, []);
  assert.ok(b.ok, JSON.stringify(b.warnings));
  assert.deepEqual((await addRpc(dir)).written, [], 'run again: already up to date');

  const tmp2 = await tempDir();
  t.after(tmp2.cleanup);
  const own = await fixture(tmp2, 'static');
  await mkdir(path.join(own, 'server'));
  await writeFile(path.join(own, 'server', 'index.js'), 'export default { fetch: () => new Response("mine") };\n');
  const o = await addRpc(own);
  assert.ok(
    o.steps.some(x =>
      /server\/index\.js is your own: route api\/rpc in it\. First thing in fetch: .*handleRpc/.test(x),
    ),
    o.steps.join('\n'),
  );
  assert.ok(
    o.steps.some(x => /may call only the origins in backend\.json/.test(x)),
    'no RPC set here: the step says to add its origin',
  );
});

// a voucher server reads the game's xsolana.json as a module, as the server's bundle does (esbuild takes JSON)
register(
  'data:text/javascript,' +
    encodeURIComponent(
      `import { readFileSync } from 'node:fs'; import { fileURLToPath } from 'node:url';
       export async function load(u, c, next) {
         if (u.startsWith('file:') && u.endsWith('.json') && !c.importAttributes?.type)
           return { format: 'module', source: 'export default ' + readFileSync(fileURLToPath(u), 'utf8'), shortCircuit: true };
         return next(u, c);
       }`,
    ),
);

const LOOT = '9cwqM1TXytPnFZsLfmUyv2dg4uW6Ch9C6UJVPns7NFQ';
const GRANT = JSON.parse(await readFile(path.join(ROOT, 'tests', 'fixtures', 'grant-0.24.0.json'), 'utf8'));

/** A game with a live economy whose grant "clear" is the devnet grant in the fixture, and its voucher server added. */
async function voucherGame(tmp) {
  const dir = await fixture(tmp, 'static');
  await writeFile(
    path.join(dir, 'xsolana.json'),
    JSON.stringify({
      grants: [
        { key: 'clear', name: 'Clear', id: GRANT.id },
        { key: 'people', name: 'People', id: 99, limits: { perPerson: 1 } },
      ],
      live: { project: GRANT.project },
    }),
  );
  return { dir, r: await addVouchers(dir) };
}

test("keepImports: imports the person added stay; the template's own, now importing more, are not doubled", () => {
  const before =
    "import { signVoucher } from './gf-loot/results/index.js';\nimport { dataOf } from './database.js';\nexport const PAY = {};\n";
  const text = "import { proofRequest, signVoucher } from './gf-loot/results/index.js';\nexport const PAY = {};\n";
  assert.equal(
    keepImports(before, text),
    "import { proofRequest, signVoucher } from './gf-loot/results/index.js';\nimport { dataOf } from './database.js';\nexport const PAY = {};\n",
  );
  assert.equal(keepImports(text, text), text);
});

test('add vouchers: refused without an economy; the server, the signer copy, the key in .dev.vars, its address for the grant', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const other = await tempDir();
  t.after(other.cleanup);
  const bare = await fixture(other, 'static');
  await assert.rejects(addVouchers(bare), /has no economy yet/);
  const { dir, r } = await voucherGame(tmp);
  await writeFile(path.join(dir, '.gitignore'), 'node_modules\n');
  assert.match(
    await readFile(path.join(dir, 'server', 'vouchers.js'), 'utf8'),
    /import ECONOMY from '\.\.\/xsolana\.json';/,
  );
  assert.ok(existsSync(path.join(dir, 'server', 'gf-loot', 'results', 'index.js')));
  assert.ok(existsSync(path.join(dir, 'server', 'gf-loot', 'chain', 'rpc.js')));
  const record = JSON.parse(await readFile(path.join(dir, 'server', 'gf-loot', 'release.json'), 'utf8'));
  assert.equal(record.package, '@xgamesfun/solana');
  const seed = /^VOUCHER_SEED=([0-9a-f]{64})$/m.exec(await readFile(path.join(dir, '.dev.vars'), 'utf8'))?.[1];
  assert.ok(seed, 'the seed is in .dev.vars');
  assert.match(r.address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.ok(
    r.steps.some(s => s.includes(`a test key for`) && s.includes(r.address)),
    r.steps.join('\n'),
  );
  assert.ok(
    r.steps.some(s => /secret set VOUCHER_SEED --new-key/.test(s)),
    'the live key is made on xgames.fun',
  );
  assert.ok(
    r.steps.some(s => /gf\.loot\.link\(\)/.test(s)),
    'the page links its wallet',
  );
  assert.doesNotMatch(JSON.stringify(r), new RegExp(seed), 'the seed is never in what it says');
  const cfg = JSON.parse(await readFile(path.join(dir, 'gamesfun.json'), 'utf8'));
  assert.deepEqual(cfg.server.objects, [{ class: 'GameVouchers', binding: 'GAME_VOUCHERS' }]);
  // again: the same key, the person's PAY kept, .dev.vars now ignored by git
  const vouchers = path.join(dir, 'server', 'vouchers.js');
  const mine = (await readFile(vouchers, 'utf8'))
    .replace(
      /async check\(\) \{\r?\n {4}return \{ why: [^\r\n]*\r?\n {2}\},/,
      "async check({ body }) {\n    return { grant: 'clear', round: body.runId };\n  },",
    )
    .replace(
      "import ECONOMY from '../xsolana.json';",
      "import ECONOMY from '../xsolana.json';\nimport { toHex } from './gf-loot/chain/bytes.js';",
    );
  await writeFile(vouchers, mine);
  const again = await addVouchers(dir);
  assert.equal(again.address, r.address);
  assert.equal(await readFile(vouchers, 'utf8'), mine, 'PAY.check and the imports the person added: kept');
  assert.match(await readFile(path.join(dir, '.gitignore'), 'utf8'), /^\.dev\.vars$/m);
  const named = JSON.parse(await readFile(path.join(dir, 'xsolana.json'), 'utf8'));
  named.grants[0].vouchers = [r.address];
  await writeFile(path.join(dir, 'xsolana.json'), JSON.stringify(named));
  assert.ok((await addVouchers(dir)).steps.some(s => /names the test key in "clear"/.test(s)));
  const b = await bundleServer(dir);
  assert.deepEqual(b.problems, []);
  assert.ok(b.ok, JSON.stringify(b.warnings));
  assert.ok(b.exports.includes('GameVouchers'));
  // publish keeps the signer at the installed package: a copy that drifted is put back, a game without one is left be
  await writeFile(path.join(dir, 'server', 'gf-loot', 'results', 'index.js'), '// changed\n');
  assert.equal((await installServerCopy(dir)).changed, true);
  assert.equal((await installServerCopy(dir)).changed, false);
  assert.equal(await installServerCopy(bare), null);
});

test('the voucher server: PAY.check decides, only a proven wallet is paid, one result once, never after the grant is made again', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const { dir, r } = await voucherGame(tmp);
  const file = path.join(dir, 'server', 'vouchers.js');
  await writeFile(
    file,
    (await readFile(file, 'utf8')).replace(
      /async check\(\) \{\r?\n {4}return \{ why: [^\r\n]*\r?\n {2}\},/,
      "async check({ body }) {\n    return body.cheat ? { why: 'Too fast.' } : { grant: 'clear', round: body.runId, amount: body.amount };\n  },\n  paid({ pays }) {\n    globalThis.__paid = (globalThis.__paid ?? []).concat(String(pays.round));\n  },",
    ),
  );
  const { handleVouchers, voucherFor, walletOf, linkPurpose, GameVouchers, VOUCHERS } = await import(
    pathToFileURL(file).href
  );
  const seed = /^VOUCHER_SEED=([0-9a-f]{64})$/m.exec(await readFile(path.join(dir, '.dev.vars'), 'utf8'))[1];
  // the test key's own wallet (its seed is in .dev.vars): it signs link texts here as a player's wallet would
  const walletKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  });
  const W1 = r.address,
    W2 = GRANT.project;
  let incarnation = null, // the grant as the chain has it: the fixture's, or the same grant made again
    reads = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const { id, method } = JSON.parse(init.body);
    assert.equal(method, 'getMultipleAccounts');
    assert.equal(String(url), 'https://devnet.rpc.example.com/');
    reads++;
    let data = GRANT.data;
    if (incarnation !== null)
      data = Buffer.from(
        encodeAccount(IDL, 'Grant', { ...decode('Grant', Buffer.from(GRANT.data, 'base64')), incarnation }),
      ).toString('base64');
    return Response.json({
      jsonrpc: '2.0',
      id,
      result: {
        context: { slot: 1 },
        value: [{ data: [data, 'base64'], owner: LOOT, lamports: 1, executable: false, space: 304 }],
      },
    });
  };
  t.after(() => (globalThis.fetch = realFetch));
  // the real Durable Object, over a storage kept in memory
  const kept = new Map();
  const storage = {
    get: async k => (kept.has(k) ? structuredClone(kept.get(k)) : undefined),
    put: async (k, v) => {
      if (typeof k === 'object') for (const [kk, vv] of Object.entries(k)) kept.set(kk, structuredClone(vv));
      else kept.set(k, structuredClone(v));
    },
    delete: async k => [].concat(k).forEach(x => kept.delete(x)),
    list: async ({ prefix = '' } = {}) => new Map([...kept].filter(([k]) => k.startsWith(prefix))),
  };
  const object = new GameVouchers({ storage }, {});
  const players = {
    x: { ok: true, sub: 'p1', wallet: null, x: { id: '42', handle: 'ana' } },
    w: { ok: true, sub: 'p2', wallet: W2, x: null },
    g: { ok: true, sub: W2, wallet: W2, x: null, google: { id: '77', name: 'Anna' } },
  };
  const env = {
    VOUCHER_SEED: seed,
    XSOLANA_RPC_URL: 'https://devnet.rpc.example.com/',
    GF_GAME_ID: 'g-test',
    GAME_VOUCHERS: { idFromName: n => n, get: () => object },
    GF: { verifyPlayer: async token => players[token] ?? { ok: false, why: 'expired' } },
  };
  const call = async (pathname, { body, token, method = body ? 'POST' : 'GET' } = {}) => {
    const res = await handleVouchers(
      new Request(`https://game.example${pathname}`, {
        method,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
    );
    return res && { status: res.status, json: await res.json() };
  };
  assert.equal(await call('/api/other'), null, "another path: the server's own routes go on");
  assert.deepEqual((await call('/api/vouchers/key')).json, { ok: true, publicKey: r.address });
  assert.equal((await call('/api/vouchers/pay', { body: {} })).status, 401);
  assert.equal((await call('/api/vouchers/pay', { body: {}, token: 'old' })).status, 401);
  const cheat = await call('/api/vouchers/pay', { body: { cheat: true }, token: 'x' });
  assert.deepEqual([cheat.status, cheat.json.why], [403, 'Too fast.']);

  // an X player with no wallet: a wallet the page names is never paid; linking proves one
  const named = await call('/api/vouchers/pay', { body: { runId: 'run-1', wallet: W1, amount: 500 }, token: 'x' });
  assert.deepEqual([named.status, named.json.code], [403, 'wallet'], 'no proven wallet: refused');
  const start = await call(`/api/vouchers/link?wallet=${W1}`, { token: 'x' });
  const asked = readProof(start.json.text); // @xgamesfun/solana's proof: game, wallet, purpose, a nonce, an expiry
  assert.deepEqual([asked.game, asked.wallet, asked.purpose], ['g-test', W1, linkPurpose('p1')]);
  const text = start.json.text;
  const signature = sign(null, Buffer.from(text), walletKey).toString('base64');
  const otherText = text.replace(linkPurpose('p1'), linkPurpose('p9'));
  const forged = sign(null, Buffer.from(otherText), walletKey).toString('base64');
  for (const [body, code] of [
    [{ wallet: W1, text: otherText, signature: forged }, 'signature'], // a proof for another player
    [{ wallet: W1, text, signature: forged }, 'signature'], // not this text's signature
    [{ wallet: W2, text, signature }, 'signature'], // another wallet
  ])
    assert.equal(
      (await call('/api/vouchers/link', { body, token: 'x' })).json.code,
      code,
      JSON.stringify(body).slice(0, 60),
    );
  assert.deepEqual((await call('/api/vouchers/link', { body: { wallet: W1, text, signature }, token: 'x' })).json, {
    ok: true,
    wallet: W1,
  });
  // the same signed proof again: its nonce was taken
  assert.equal(
    (await call('/api/vouchers/link', { body: { wallet: W1, text, signature }, token: 'x' })).json.code,
    'nonce',
  );
  assert.equal(await walletOf(env, players.x), W1);
  assert.equal(await walletOf(env, players.w), W2, 'a wallet sign-in is its own proof');

  const first = await call('/api/vouchers/pay', { body: { runId: 'run-1', amount: 500 }, token: 'x' });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const v = first.json.voucher;
  assert.deepEqual([v.wallet, v.grant, v.incarnation, v.amount, v.publicKey], [W1, GRANT.id, '1', '500', r.address]);
  assert.notEqual(v.personHash, '0'.repeat(64), 'a player signed in with X is counted as one person');
  const message = voucherBytes({
    grant: GRANT.address,
    incarnation: v.incarnation,
    wallet: v.wallet,
    personHash: v.personHash,
    round: v.round,
    expires: v.expires,
    amount: BigInt(v.amount),
  });
  const key = await crypto.subtle.importKey('raw', decodeBase58(v.publicKey), { name: 'Ed25519' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify('Ed25519', key, decodeBase58(v.signature), message), "loot's own voucher bytes");
  const readsBefore = reads;
  const again = await call('/api/vouchers/pay', { body: { runId: 'run-1', amount: 500 }, token: 'x' });
  assert.equal(again.json.voucher.signature, v.signature, 'the same result asked again: the same voucher');
  assert.equal(reads, readsBefore, '...with no chain read');
  assert.deepEqual(globalThis.__paid, ['run-1'], 'PAY.paid ran once, for the voucher signed, not for the repeat');
  const other = await call('/api/vouchers/pay', { body: { runId: 'run-1', amount: 500, wallet: W2 }, token: 'x' });
  assert.equal(other.json.code, 'wallet', 'a different wallet named in the body is refused');
  assert.equal(
    (await call('/api/vouchers/pay', { body: { runId: 'run-1', amount: 900 }, token: 'x' })).json.code,
    'round-used',
  );

  // a wallet player is paid at the wallet they signed in with
  const wp = await call('/api/vouchers/pay', { body: { runId: 'run-w', amount: 1 }, token: 'w' });
  assert.equal(wp.json.voucher.wallet, W2);
  // X only: a wallet player is refused
  VOUCHERS.payOnly = 'x';
  assert.equal((await call('/api/vouchers/pay', { body: { runId: 'run-w2' }, token: 'w' })).json.code, 'x-only');
  VOUCHERS.payOnly = 'any';
  // X or Google (2026-11-09): a wallet's own sign-in is refused; a Google account is paid, counted as one person
  VOUCHERS.payOnly = 'account';
  assert.equal((await call('/api/vouchers/pay', { body: { runId: 'run-w3' }, token: 'w' })).json.code, 'account-only');
  const gp = await call('/api/vouchers/pay', { body: { runId: 'run-g', amount: 1 }, token: 'g' });
  assert.equal(gp.status, 200, JSON.stringify(gp.json));
  assert.notEqual(gp.json.voucher.personHash, '0'.repeat(64), 'a Google account with no X is one person (g:<id>)');
  VOUCHERS.payOnly = 'x';
  assert.equal((await call('/api/vouchers/pay', { body: { runId: 'run-g2' }, token: 'g' })).json.code, 'x-only');
  VOUCHERS.payOnly = 'any';
  // the rate: past perMinute a minute, refused
  VOUCHERS.perMinute = 1;
  assert.equal((await call('/api/vouchers/pay', { body: { runId: 'run-r' }, token: 'w' })).status, 429);
  VOUCHERS.perMinute = 20;

  // two wallets asking for the same new result at once: one is paid, the other refused
  const race = await Promise.all([
    voucherFor(env, { grant: 'clear', wallet: W1, round: 'race', amount: 'grant' }),
    voucherFor(env, { grant: 'clear', wallet: W2, round: 'race', amount: 'grant' }),
  ]);
  assert.deepEqual(race.map(x => x.ok).sort(), [false, true], JSON.stringify(race.map(x => x.code ?? 'ok')));
  assert.equal(race.find(x => !x.ok).code, 'round-used');
  assert.equal((await voucherFor(env, { grant: 'nope', wallet: W1, round: 'r', amount: 1 })).code, 'grant');
  assert.equal((await voucherFor(env, { grant: 'clear', wallet: 'xyz', round: 'r', amount: 1 })).code, 'wallet');
  assert.equal(
    (await voucherFor(env, { grant: 1, wallet: W1, round: 'run-2', amount: 'grant' })).ok,
    true,
    'a grant by its id too',
  );
  incarnation = 2n; // the grant closed and made again: a new campaign pays new rounds only
  assert.equal((await voucherFor(env, { grant: 'clear', wallet: W1, round: 'run-2', amount: 7 })).code, 'grant-remade');
  assert.equal(
    (await voucherFor(env, { grant: 'clear', wallet: W1, round: 'run-3', amount: 'grant' })).voucher.incarnation,
    '2',
  );
  assert.equal(
    (await voucherFor({ ...env, VOUCHER_SEED: '' }, { grant: 'clear', wallet: W1, round: 'x', amount: 1 })).code,
    'not-set',
  );
  // the amount is always named: left out (or 0) it is refused, never the grant's most
  for (const amount of [undefined, 0, -5, 1.5, 'lots'])
    assert.equal(
      (await voucherFor(env, { grant: 'clear', wallet: W1, round: `a-${amount}`, amount })).code,
      'amount',
      String(amount),
    );
  // a grant that counts people pays only a person
  assert.equal((await voucherFor(env, { grant: 'people', wallet: W1, round: 'p', amount: 1 })).code, 'person');
  assert.equal(
    (await voucherFor(env, { grant: 'people', wallet: W1, round: 'p', amount: 1, person: '42' })).ok,
    true,
    'a person is paid',
  );
  // a player linking a wallet another player linked takes it over; a player has one linked wallet
  await object.link('p3', W1);
  assert.equal(await object.linked('p1'), null);
  assert.equal(await object.linked('p3'), W1);
});
