// The game's own database on xgames.fun, written into server/ by `xcore add database`. It is part of the game's server
// code (docs/SERVER.md): one Durable Object with SQLite storage, published with the game, at the game's own
// api/db/. Nothing to sign up for and no keys. The page uses it through gamesfun.js (gf.db); this server's own code
// through dataOf(env).
//
//   GET    api/db/<collection>?owner=me|server|<id>&limit=&after=&order=new|old  → {ok, items, more, after}
//   GET    api/db/<collection>/<id>?owner=me|server|<id>                         → {ok, item}
//   PUT    api/db/<collection>/<id>  {value}   the signed-in player's own        → {ok, item}
//   POST   api/db/<collection>       {value}   a new id, the player's own        → {ok, item}
//   DELETE api/db/<collection>/<id>            the player's own                  → {ok, deleted}
//
// A document is {id, owner, value, updatedAt}: `owner` is the player's id (env.GF.verifyPlayer's `sub`), or "server"
// for what this server's own code writes. Every player has a space of their own in each collection: a document is
// found by its collection, its owner and its id, so two players can both have a "main", and no player can take an id
// in anyone else's space. A page names whose document it wants with `owner`; without it, the player's own (in a
// collection only the server writes: the server's, then the player's own, which the server wrote for them). A get by
// id alone that finds another player's document in a collection anyone reads answers 400 `owner`: name its owner.
// Lists come newest first (by when a document was last written), a page at a time: pass the answer's `after` back to
// get the next page. A document written between two pages moves to the front, so a listing taken while players write
// can show it twice or not at all: list what must be exact in one page (limit up to 100), or by a field of its own.
// Change who may read and write a collection in RULES below; that is the whole of its security, so read it once.

import { DurableObject } from 'cloudflare:workers';

/**
 * Who may read and write each collection; '*' is every collection not named.
 * read:  'owner' (a player reads only their own documents) | 'anyone' (signed in or not: any player's, by its owner)
 * write: 'owner' (a signed-in player writes only their own documents) | 'server' (only this server: dataOf(env))
 */
export const RULES = {
  '*': { read: 'owner', write: 'owner' },
};

export const LIMITS = { valueBytes: 64 * 1024, docsPerPlayer: 1000, list: 100 };

const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const SERVER = 'server';
const OWNER_CHARS = 128;
const te = new TextEncoder();

const refuse = (status, code, why) => ({ ok: false, status, code, why });
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);
const ruleOf = (collection, rules) => ({
  read: 'owner',
  write: 'owner',
  ...(own(rules, '*') ?? {}),
  ...(own(rules, collection) ?? {}),
});
/** RULES, checked: a mistyped rule (read: 'everyone') would otherwise be read as something else. Throws in words. */
export function checkRules(rules) {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules))
    throw new Error("RULES is an object: { '*': { read: 'owner', write: 'owner' } }.");
  for (const [name, rule] of Object.entries(rules)) {
    if (name !== '*' && !NAME.test(name))
      throw new Error(`RULES: ${JSON.stringify(name)} is not a collection (1 to 64 letters, digits, - or _; or '*').`);
    const ok =
      rule &&
      typeof rule === 'object' &&
      !Array.isArray(rule) &&
      Object.keys(rule).every(k => k === 'read' || k === 'write') &&
      (rule.read === undefined || rule.read === 'owner' || rule.read === 'anyone') &&
      (rule.write === undefined || rule.write === 'owner' || rule.write === 'server');
    if (!ok) throw new Error(`RULES.${name} is { read: 'owner' | 'anyone', write: 'owner' | 'server' }.`);
  }
  return rules;
}
const row = r => r && { id: r.id, owner: r.owner, value: JSON.parse(r.value), updatedAt: r.updated };

// the list's place: the last document of a page, as text the page hands back (it never needs to read it)
const b64url = s =>
  btoa(String.fromCharCode(...te.encode(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const unb64url = s =>
  new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
export const cursorOf = d => b64url(JSON.stringify([d.updatedAt, d.owner, d.id]));
function readCursor(text) {
  try {
    const [updated, owner, id] = JSON.parse(unb64url(String(text)));
    if (Number.isSafeInteger(updated) && typeof owner === 'string' && typeof id === 'string')
      return { updated, owner, id };
  } catch {}
  return null;
}

/**
 * The tables, made on first use. An older database.js kept one id per collection (whoever wrote it first owned it);
 * its documents move to the new table as they are, each under its owner. Every step can run again: a move stopped
 * half way is finished the next time.
 */
async function prepare(exec, table) {
  const made = async name =>
    (await exec(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`, name))[0]?.sql ?? null;
  const create = name =>
    exec(
      `CREATE TABLE IF NOT EXISTS ${name} (collection TEXT NOT NULL, owner TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (collection, owner, id))`,
    );
  const now = await made(table);
  const next = `${table}_v2`;
  if (now && /PRIMARY KEY\s*\(\s*collection\s*,\s*id\s*\)/i.test(now)) {
    await create(next);
    await exec(
      `INSERT OR IGNORE INTO ${next} (collection, owner, id, value, updated) SELECT collection, owner, id, value, updated FROM ${table}`,
    );
    await exec(`DROP TABLE ${table}`);
    await exec(`ALTER TABLE ${next} RENAME TO ${table}`);
  } else if (!now && (await made(next))) await exec(`ALTER TABLE ${next} RENAME TO ${table}`);
  await create(table);
  await exec(`CREATE INDEX IF NOT EXISTS ${table}_by_owner ON ${table} (collection, owner, updated, id)`);
  await exec(`CREATE INDEX IF NOT EXISTS ${table}_by_time ON ${table} (collection, updated, owner, id)`);
  await exec(`CREATE INDEX IF NOT EXISTS ${table}_by_id ON ${table} (collection, id)`);
}

/**
 * The database over SQLite. `exec(query, ...bindings)` answers the rows, or a promise of them (a Durable Object's
 * ctx.storage.sql, D1, or any SQLite with that shape). Every call is async. `who` is the player's id, '' for a guest,
 * or "server" for the server's own code. `opts.owner` names whose space a document is in: 'me', 'server' or a
 * player's id.
 */
export function createData(exec, { rules = RULES, limits = LIMITS, now = () => Date.now(), table = 'docs' } = {}) {
  checkRules(rules);
  const rows = async (q, ...b) => [...(await exec(q, ...b))];
  const ready = prepare(rows, table);
  const named = (collection, id) =>
    !NAME.test(String(collection))
      ? refuse(400, 'bad', 'A collection is 1 to 64 letters, digits, - or _.')
      : id !== undefined && !NAME.test(String(id))
        ? refuse(400, 'bad', 'An id is 1 to 64 letters, digits, - or _.')
        : null;
  /** Whose space `owner` names for `who`: {owner} or a refusal. Without one: the player's own, or the server's. */
  const spaceOf = (rule, owner, who) => {
    if (owner === undefined || owner === null || owner === '')
      owner = who === SERVER || rule.write === 'server' ? SERVER : 'me';
    if (owner === 'me') {
      if (!who) return refuse(401, 'player', 'Sign in first, or name whose document it is (owner).');
      return { owner: who };
    }
    if (typeof owner !== 'string' || owner.length > OWNER_CHARS)
      return refuse(400, 'bad', `An owner is "me", "server" or a player's id (at most ${OWNER_CHARS} characters).`);
    return { owner };
  };
  /** May `who` write in `owner`'s space of this collection? null, or the refusal. */
  const canWrite = (rule, owner, who) =>
    who === SERVER
      ? null
      : rule.write === 'server'
        ? refuse(403, 'server-only', 'Only the game itself writes here.')
        : !who
          ? refuse(401, 'player', 'Sign in first.')
          : owner !== who
            ? refuse(403, 'not-yours', 'A player writes only their own documents.')
            : null;
  const canRead = (rule, owner, who) => who === SERVER || rule.read === 'anyone' || owner === who;

  const data = {
    async get(collection, id, opts = {}, who = '') {
      await ready;
      const bad = named(collection, id);
      if (bad) return bad;
      const rule = ruleOf(collection, rules);
      const space = spaceOf(rule, opts?.owner, who);
      if (!space.owner) return space;
      const byIdAlone = opts?.owner === undefined || opts?.owner === null || opts?.owner === '';
      // where to look: the space named; by id alone in a collection only the server writes, the server's and then the
      // player's own (what the server wrote for them)
      const spaces = [space.owner];
      if (byIdAlone && rule.write === 'server' && who && who !== SERVER) spaces.push(who);
      for (const owner of spaces) {
        // read: 'owner': another player's document is not there, not even that it exists
        if (!canRead(rule, owner, who)) continue;
        const item = row(
          (
            await rows(`SELECT * FROM ${table} WHERE collection = ? AND owner = ? AND id = ?`, collection, owner, id)
          )[0],
        );
        if (item) return { ok: true, item };
      }
      // by id alone, in a collection anyone reads, another player's document (how ids worked before each player had a
      // space of their own): said, with what to send instead
      if (byIdAlone && rule.read === 'anyone' && who !== SERVER) {
        const other = (
          await rows(`SELECT owner FROM ${table} WHERE collection = ? AND id = ? LIMIT 1`, collection, id)
        )[0];
        if (other)
          return refuse(
            400,
            'owner',
            `${collection}/${id} is not in your own space: every player has a space of their own, so name whose document it is with {owner} (gf.db.get('${collection}', '${id}', {owner}), GET api/db/${collection}/${id}?owner=<their id>). A document's owner is in it, and in each item of a list.`,
          );
      }
      return refuse(404, 'unknown', 'No such document.');
    },
    async put(collection, id, value, opts = {}, who = '') {
      await ready;
      const bad = named(collection, id);
      if (bad) return bad;
      const rule = ruleOf(collection, rules);
      const space = spaceOf(rule, opts?.owner, who);
      if (!space.owner) return space;
      const denied = canWrite(rule, space.owner, who);
      if (denied) return denied;
      if (value === undefined) return refuse(400, 'bad', 'A document needs a value (any JSON).');
      const text = JSON.stringify(value);
      if (te.encode(text).byteLength > limits.valueBytes)
        return refuse(413, 'too-big', `A document may be ${limits.valueBytes / 1024} KB.`);
      const t = now();
      // one statement, so two calls at once cannot both pass the count: a document already there is replaced; a new
      // one only while its owner has room (the server's own space has no cap)
      const cap = space.owner === SERVER ? Number.MAX_SAFE_INTEGER : limits.docsPerPlayer;
      const done = await rows(
        `INSERT INTO ${table} (collection, owner, id, value, updated) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM ${table} WHERE collection = ? AND owner = ? AND id = ?) OR (SELECT count(*) FROM ${table} WHERE collection = ? AND owner = ?) < ? ON CONFLICT (collection, owner, id) DO UPDATE SET value = excluded.value, updated = excluded.updated RETURNING id`,
        collection,
        space.owner,
        id,
        text,
        t,
        collection,
        space.owner,
        id,
        collection,
        space.owner,
        cap,
      );
      if (!done.length)
        return refuse(409, 'full', `A player may keep ${limits.docsPerPlayer} documents in ${collection}.`);
      return { ok: true, item: { id, owner: space.owner, value: JSON.parse(text), updatedAt: t } };
    },
    async add(collection, value, opts = {}, who = '') {
      return data.put(collection, crypto.randomUUID().replaceAll('-', '').slice(0, 20), value, opts, who);
    },
    async list(collection, { owner = '', limit = 50, after = '', order = 'new', offset } = {}, who = '') {
      await ready;
      const bad = named(collection);
      if (bad) return bad;
      if (offset !== undefined && offset !== '' && Number(offset) !== 0)
        return refuse(400, 'bad', "offset is gone: page with after (the last answer's after).");
      const rule = ruleOf(collection, rules);
      let of = '';
      if (owner) {
        const space = spaceOf(rule, owner, who);
        if (!space.owner) return space;
        of = space.owner;
      }
      // anything but read: 'anyone' is the player's own only (fail closed: a rule this code does not know shows nothing)
      if (rule.read !== 'anyone' && who !== SERVER) {
        if (!who) return refuse(401, 'player', 'Sign in first.');
        of = who; // a player lists only their own here
      }
      const n = Math.max(1, Math.min(limits.list, Number(limit) | 0 || 50));
      const from = after ? readCursor(after) : null;
      if (after && !from) return refuse(400, 'bad', "after is the last answer's after, as it came.");
      const old = order === 'old';
      const dir = old ? 'ASC' : 'DESC';
      const where = [`collection = ?`];
      const args = [collection];
      if (of) (where.push('owner = ?'), args.push(of));
      if (from)
        (where.push(`(updated, owner, id) ${old ? '>' : '<'} (?, ?, ?)`), args.push(from.updated, from.owner, from.id));
      const found = await rows(
        `SELECT * FROM ${table} WHERE ${where.join(' AND ')} ORDER BY updated ${dir}, owner ${dir}, id ${dir} LIMIT ?`,
        ...args,
        n + 1,
      );
      const items = found.slice(0, n).map(row);
      const more = found.length > n;
      return { ok: true, items, more, after: more ? cursorOf(items.at(-1)) : null };
    },
    async delete(collection, id, opts = {}, who = '') {
      await ready;
      const bad = named(collection, id);
      if (bad) return bad;
      const rule = ruleOf(collection, rules);
      const space = spaceOf(rule, opts?.owner, who);
      if (!space.owner) return space;
      const denied = canWrite(rule, space.owner, who);
      if (denied) return denied;
      const gone = await rows(
        `DELETE FROM ${table} WHERE collection = ? AND owner = ? AND id = ? RETURNING id`,
        collection,
        space.owner,
        id,
      );
      return { ok: true, deleted: gone.length > 0 };
    },
  };
  data.ready = ready;
  return data;
}

/** The Durable Object that holds the database (gamesfun.json → server.objects: {class: "GameData", binding: "GAME_DATA"}). */
export class GameData extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.data = createData((q, ...b) => ctx.storage.sql.exec(q, ...b));
    // the tables are ready (an older one moved) before the first call
    ctx.blockConcurrencyWhile?.(() => this.data.ready);
  }
  /** One call, over RPC: op is get | put | add | list | delete, args as createData's. */
  run(op, args) {
    if (!['get', 'put', 'add', 'list', 'delete'].includes(op)) return refuse(400, 'bad', `No such call: ${op}.`);
    return this.data[op](...args);
  }
}

const stubOf = env => env.GAME_DATA.get(env.GAME_DATA.idFromName('main'));

/**
 * This server's own access, past the players' rules. Without an owner it reads and writes the server's own space
 * (owner "server"): await dataOf(env).put('news', 'today', {…}). With one, a player's: dataOf(env).get('profiles',
 * 'main', {owner: sub}). A list without an owner is everyone's.
 */
export function dataOf(env) {
  return serverData((op, args) => stubOf(env).run(op, args));
}

/** dataOf's calls over any `run(op, args)` (the Durable Object's, or the stock server's D1). */
export function serverData(run) {
  return {
    get: (collection, id, opts = {}) => run('get', [collection, id, opts, SERVER]),
    put: (collection, id, value, opts = {}) => run('put', [collection, id, value, opts, SERVER]),
    add: (collection, value, opts = {}) => run('add', [collection, value, opts, SERVER]),
    list: (collection, opts = {}) => run('list', [collection, opts, SERVER]),
    delete: (collection, id, opts = {}) => run('delete', [collection, id, opts, SERVER]),
  };
}

const reply = (a, status = a.ok ? 200 : a.status) => {
  const { status: _, ...body } = a;
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
};

/**
 * The page's calls to api/db/…, answered by `run(op, args)` (createData's calls). → the Response, or null for any
 * other path, so the server's own routes go on.
 */
export async function routeDatabase(request, env, run) {
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
  // who is asking: the sign-in token the page sends (gamesfun.js does), checked by xgames.fun
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  let who = '';
  if (bearer) {
    const v = await env.GF.verifyPlayer(bearer);
    if (!v?.ok)
      return reply(
        refuse(401, 'player', `Sign in again: ${String(v?.why ?? 'not a player token').replace(/\.$/, '')}.`),
      );
    // "server" is the server's own space: no player is it
    if (typeof v.sub !== 'string' || !v.sub || v.sub === SERVER)
      return reply(refuse(401, 'player', 'Sign in again: not a player.'));
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
  const q = Object.fromEntries(url.searchParams);
  const opts = q.owner === undefined ? {} : { owner: q.owner };
  if (id === undefined && method === 'GET') return reply(await run('list', [collection, q, who]));
  if (id === undefined && method === 'POST') return reply(await run('add', [collection, body.value, opts, who]));
  if (id !== undefined && method === 'GET') return reply(await run('get', [collection, id, opts, who]));
  if (id !== undefined && method === 'PUT') return reply(await run('put', [collection, id, body.value, opts, who]));
  if (id !== undefined && method === 'DELETE') return reply(await run('delete', [collection, id, opts, who]));
  return reply(refuse(405, 'method', `${method} is not a database call here.`));
}

/** The page's calls to api/db/…, to the one Durable Object; null for any other path. */
export function handleDatabase(request, env) {
  return routeDatabase(request, env, (op, args) => stubOf(env).run(op, args));
}
