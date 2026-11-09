// The page's documents (gf.db in gamesfun.js) in the game's own D1 database, for a game with a server of its own.
// Written by `xcore add` (database, multiplayer, rpc, vouchers) when gamesfun.json → database has `collections`;
// running it again brings this file up to date. It answers api/db/* with the same routes and answers as xcore's stock
// server, from the same table (gf_docs), under the same rules: gamesfun.json → database.collections, read from that
// file when the server is bundled, so the rules are in one place. Route it first thing in the server's fetch:
//
//   import { handleDocs } from './gf-docs.js';
//   const db = await handleDocs(request, env);
//   if (db) return db;
//
//   GET    api/db/<collection>?owner=me|server|<id>&limit=&after=&order=new|old  → {ok, items, more, after}
//   GET    api/db/<collection>/<id>?owner=me|server|<id>                         → {ok, item}
//   PUT    api/db/<collection>/<id>  {value}   the signed-in player's own        → {ok, item}
//   POST   api/db/<collection>       {value}   a new id, the player's own        → {ok, item}
//   DELETE api/db/<collection>/<id>            the player's own                  → {ok, deleted}
//
// This server's own code reads and writes past the rules with docsOf(env) (the server's own space, owner "server", by
// default; a player's with {owner: sub}): await docsOf(env).put('news', 'today', {…}).
import config from '../gamesfun.json';

/** Who may read and write each collection: gamesfun.json → database.collections ('*' is every collection not named). */
const RULES = config?.database?.collections ?? { '*': { read: 'owner', write: 'owner' } };
/** The database's name on env (gamesfun.json → database.binding). */
const BINDING = config?.database?.binding ?? 'DB';

export const LIMITS = { valueBytes: 64 * 1024, docsPerPlayer: 1000, list: 100 };

// __DOCS_CORE__

/** D1 as createData's exec(query, ...bindings) → rows. */
const d1 =
  db =>
  async (q, ...b) => {
    const r = await db
      .prepare(q)
      .bind(...b)
      .all();
    return r.results ?? [];
  };

let data = null;
const docs = env => {
  const db = env[BINDING];
  if (!db) throw new Error(`The game's database is not bound as env.${BINDING} (gamesfun.json → database).`);
  return (data ??= createData(d1(db), { rules: RULES, table: 'gf_docs' }));
};

/** The page's calls to api/db/…, from the game's database; null for any other path, so the server's routes go on. */
export function handleDocs(request, env) {
  return routeDatabase(request, env, (op, args) => docs(env)[op](...args));
}

/** This server's own access to the documents, past the players' rules (as server/database.js's dataOf). */
export function docsOf(env) {
  return serverData((op, args) => docs(env)[op](...args));
}
