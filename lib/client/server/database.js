// The game's own database on games.fun, written into server/ by `xcore add database`. It is part of the game's server
// code (docs/SERVER.md): one Durable Object with SQLite storage, published with the game, at the game's own
// api/db/. Nothing to sign up for and no keys. The page uses it through gamesfun.js (gf.db); this server's own code
// through dataOf(env).
//
//   GET    api/db/<collection>?owner=me|<id>&limit=&offset=&order=new|old   → {ok, items, more}
//   GET    api/db/<collection>/<id>                                          → {ok, item}
//   PUT    api/db/<collection>/<id>  {value}   a signed-in player's own      → {ok, item}
//   POST   api/db/<collection>       {value}   a new id                      → {ok, item}
//   DELETE api/db/<collection>/<id>            the owner's                   → {ok, deleted}
//
// A document is {id, owner, value, updatedAt}: `owner` is the player's id (env.GF.verifyPlayer's `sub`), or "server".
// Change who may read and write a collection in RULES below; that is the whole of its security, so read it once.

import { DurableObject } from 'cloudflare:workers';

/**
 * Who may read and write each collection; '*' is every collection not named.
 * read:  'anyone' (signed in or not) | 'owner' (a player reads only their own documents)
 * write: 'owner' (a signed-in player writes only their own documents) | 'server' (only this server: dataOf(env))
 */
export const RULES = {
  '*': { read: 'anyone', write: 'owner' },
};

export const LIMITS = { valueBytes: 64 * 1024, docsPerPlayer: 1000, list: 100, offset: 10000 };

const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const SERVER = 'server';
const te = new TextEncoder();

const refuse = (status, code, why) => ({ ok: false, status, code, why });
const ruleOf = (collection, rules) => ({
  read: 'anyone',
  write: 'owner',
  ...(rules['*'] ?? {}),
  ...(rules[collection] ?? {}),
});
const row = r => r && { id: r.id, owner: r.owner, value: JSON.parse(r.value), updatedAt: r.updated };

/**
 * The database over SQLite: `sql.exec(query, ...bindings)` answers the rows (a Durable Object's ctx.storage.sql, or
 * any SQLite with that shape). `who` is the player's id, '' for a guest, or "server" for the server's own code.
 */
export function createData(sql, { rules = RULES, limits = LIMITS, now = () => Date.now() } = {}) {
  sql.exec(
    'CREATE TABLE IF NOT EXISTS docs (collection TEXT NOT NULL, id TEXT NOT NULL, owner TEXT NOT NULL, value TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (collection, id))',
  );
  sql.exec('CREATE INDEX IF NOT EXISTS docs_owner ON docs (collection, owner, updated)');
  sql.exec('CREATE INDEX IF NOT EXISTS docs_updated ON docs (collection, updated)');
  const rows = (q, ...b) => [...sql.exec(q, ...b)];
  const named = (collection, id) =>
    !NAME.test(String(collection))
      ? refuse(400, 'bad', 'A collection is 1 to 64 letters, digits, - or _.')
      : id !== undefined && !NAME.test(String(id))
        ? refuse(400, 'bad', 'An id is 1 to 64 letters, digits, - or _.')
        : null;
  const canWrite = (rule, who) =>
    who === SERVER
      ? null
      : rule.write === 'server'
        ? refuse(403, 'server-only', 'Only the game itself writes here.')
        : who
          ? null
          : refuse(401, 'player', 'Sign in first.');

  const data = {
    get(collection, id, who = '') {
      const bad = named(collection, id);
      if (bad) return bad;
      const item = row(rows('SELECT * FROM docs WHERE collection = ? AND id = ?', collection, id)[0]);
      if (!item) return refuse(404, 'unknown', 'No such document.');
      const rule = ruleOf(collection, rules);
      if (rule.read === 'owner' && who !== SERVER && item.owner !== who)
        return refuse(404, 'unknown', 'No such document.');
      return { ok: true, item };
    },
    put(collection, id, value, who = '') {
      const bad = named(collection, id);
      if (bad) return bad;
      const rule = ruleOf(collection, rules);
      const denied = canWrite(rule, who);
      if (denied) return denied;
      if (value === undefined) return refuse(400, 'bad', 'A document needs a value (any JSON).');
      const text = JSON.stringify(value);
      if (te.encode(text).byteLength > limits.valueBytes)
        return refuse(413, 'too-big', `A document may be ${limits.valueBytes / 1024} KB.`);
      const was = rows('SELECT owner FROM docs WHERE collection = ? AND id = ?', collection, id)[0];
      if (was && who !== SERVER && was.owner !== who)
        return refuse(403, 'not-yours', 'Another player owns this document.');
      if (!was && who !== SERVER) {
        const n = rows('SELECT count(*) AS n FROM docs WHERE collection = ? AND owner = ?', collection, who)[0].n;
        if (n >= limits.docsPerPlayer)
          return refuse(409, 'full', `A player may keep ${limits.docsPerPlayer} documents in ${collection}.`);
      }
      const owner = was ? was.owner : who;
      const t = now();
      sql.exec(
        'INSERT INTO docs (collection, id, owner, value, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT (collection, id) DO UPDATE SET value = excluded.value, updated = excluded.updated',
        collection,
        id,
        owner,
        text,
        t,
      );
      return { ok: true, item: { id, owner, value: JSON.parse(text), updatedAt: t } };
    },
    add(collection, value, who = '') {
      return data.put(collection, crypto.randomUUID().replaceAll('-', '').slice(0, 20), value, who);
    },
    list(collection, { owner = '', limit = 50, offset = 0, order = 'new' } = {}, who = '') {
      const bad = named(collection);
      if (bad) return bad;
      const rule = ruleOf(collection, rules);
      let of = owner === 'me' ? who : String(owner || '');
      if (owner === 'me' && !who) return refuse(401, 'player', 'Sign in first.');
      if (rule.read === 'owner' && who !== SERVER) {
        if (!who) return refuse(401, 'player', 'Sign in first.');
        of = who; // a player lists only their own here
      }
      const n = Math.max(1, Math.min(limits.list, Number(limit) | 0 || 50));
      const skip = Math.max(0, Math.min(limits.offset, Number(offset) | 0));
      const dir = order === 'old' ? 'ASC' : 'DESC';
      const found = of
        ? rows(
            `SELECT * FROM docs WHERE collection = ? AND owner = ? ORDER BY updated ${dir}, id LIMIT ? OFFSET ?`,
            collection,
            of,
            n + 1,
            skip,
          )
        : rows(
            `SELECT * FROM docs WHERE collection = ? ORDER BY updated ${dir}, id LIMIT ? OFFSET ?`,
            collection,
            n + 1,
            skip,
          );
      return { ok: true, items: found.slice(0, n).map(row), more: found.length > n };
    },
    delete(collection, id, who = '') {
      const bad = named(collection, id);
      if (bad) return bad;
      const rule = ruleOf(collection, rules);
      const denied = canWrite(rule, who);
      if (denied) return denied;
      const was = rows('SELECT owner FROM docs WHERE collection = ? AND id = ?', collection, id)[0];
      if (!was) return { ok: true, deleted: false };
      if (who !== SERVER && was.owner !== who) return refuse(403, 'not-yours', 'Another player owns this document.');
      sql.exec('DELETE FROM docs WHERE collection = ? AND id = ?', collection, id);
      return { ok: true, deleted: true };
    },
  };
  return data;
}

/** The Durable Object that holds the database (gamesfun.json → server.objects: {class: "GameData", binding: "GAME_DATA"}). */
export class GameData extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.data = createData(ctx.storage.sql);
  }
  /** One call, over RPC: op is get | put | add | list | delete, args as createData's. */
  run(op, args) {
    if (!Object.hasOwn(this.data, op)) return refuse(400, 'bad', `No such call: ${op}.`);
    return this.data[op](...args);
  }
}

const stubOf = env => env.GAME_DATA.get(env.GAME_DATA.idFromName('main'));

/** This server's own access, past the players' rules (owner "server"): await dataOf(env).put('news', 'today', {…}). */
export function dataOf(env) {
  const stub = stubOf(env);
  const as =
    op =>
    (...args) =>
      stub.run(op, op === 'list' ? [args[0], args[1] ?? {}, SERVER] : [...args, SERVER]);
  return { get: as('get'), put: as('put'), add: as('add'), list: as('list'), delete: as('delete') };
}

const reply = (a, status = a.ok ? 200 : a.status) => {
  const { status: _, ...body } = a;
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
};

/** The page's calls to api/db/…; null for any other path, so the server's own routes go on. */
export async function handleDatabase(request, env) {
  const url = new URL(request.url);
  const m = /\/api\/db\/([^/]+)(?:\/([^/]+))?\/?$/.exec(url.pathname);
  if (!m) return null;
  let collection, id;
  try {
    collection = decodeURIComponent(m[1]);
    id = m[2] === undefined ? undefined : decodeURIComponent(m[2]);
  } catch {
    return reply(refuse(400, 'bad', 'Not a path.'));
  }
  // who is asking: the sign-in token the page sends (gamesfun.js does), checked by games.fun
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  let who = '';
  if (bearer) {
    const v = await env.GF.verifyPlayer(bearer);
    if (!v?.ok)
      return reply(
        refuse(401, 'player', `Sign in again: ${String(v?.why ?? 'not a player token').replace(/\.$/, '')}.`),
      );
    who = v.sub;
  }
  const method = request.method.toUpperCase();
  let body = {};
  if (method === 'PUT' || method === 'POST') {
    const text = await request.text();
    if (te.encode(text).byteLength > LIMITS.valueBytes + 1024)
      return reply(refuse(413, 'too-big', `A document may be ${LIMITS.valueBytes / 1024} KB.`));
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      return reply(refuse(400, 'bad', 'The body is not JSON.'));
    }
  }
  const stub = stubOf(env);
  const q = Object.fromEntries(url.searchParams);
  if (id === undefined && method === 'GET') return reply(await stub.run('list', [collection, q, who]));
  if (id === undefined && method === 'POST') return reply(await stub.run('add', [collection, body.value, who]));
  if (id !== undefined && method === 'GET') return reply(await stub.run('get', [collection, id, who]));
  if (id !== undefined && method === 'PUT') return reply(await stub.run('put', [collection, id, body.value, who]));
  if (id !== undefined && method === 'DELETE') return reply(await stub.run('delete', [collection, id, who]));
  return reply(refuse(405, 'method', `${method} is not a database call here.`));
}
