// xcore's stock server: the server a game gets when gamesfun.json has a database and the game has no server/ of its
// own. It serves the page's api/db/* (gf.db in gamesfun.js) from the game's D1 database, with the same routes and
// answers as server/database.js (./database.js: the two share that code), under the rules in gamesfun.json →
// database.collections. Its documents live in a table of its own, gf_docs, which it makes itself; the game's own
// migrations make any other tables. xcore bundles this file with the rules and the binding's name (gf:stock) as the
// game's server, so nothing of it is in the game folder.
import { createData, routeDatabase } from './database.js';
import SETTINGS from 'gf:stock';

/** D1 as createData's exec(query, ...bindings) → rows. */
function d1(db) {
  return async (q, ...b) => {
    const r = await db
      .prepare(q)
      .bind(...b)
      .all();
    return r.results ?? [];
  };
}

let data = null;
const dataOf = env => {
  const db = env[SETTINGS.binding];
  if (!db) throw new Error(`The game's database is not bound as env.${SETTINGS.binding}.`);
  return (data ??= createData(d1(db), { rules: SETTINGS.rules, table: 'gf_docs' }));
};

export default {
  async fetch(request, env) {
    const db = await routeDatabase(request, env, (op, args) => dataOf(env)[op](...args));
    if (db) return db;
    // gamesfun.js asks once a page load whether the game has its own RPC (xcore add rpc): it has not
    if (request.method === 'GET' && /\/api\/rpc\/?$/.test(new URL(request.url).pathname))
      return Response.json({ gamesfun: 'rpc', own: false });
    return Response.json({ ok: false, code: 'unknown', why: 'Not a route of this game.' }, { status: 404 });
  },
};
