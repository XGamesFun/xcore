// The game's database on xgames.fun (a D1 database of its own: gamesfun.json → database), for this server's own code.
// Written by `xcore add database`; running it again brings this file up to date.
// Its tables come from the migrations in server/migrations/ (0001_init.sql, then 0002_….sql): xgames.fun applies the
// new ones, in name order, before the version that brings them goes live, and `xcore dev` does the same with a
// database on this machine. Add a migration for each change; never change one that was published.
//
//   import { db, withPlayer } from './gf-db.js';
//   const sub = await withPlayer(request, env);             // the signed-in player's id (never the wallet), or null
//   if (!sub) return Response.json({ why: 'Sign in first.' }, { status: 401 });
//   const me = await db(env).first('SELECT gold, runs FROM players WHERE id = ?', sub);
//   // a rule in one statement, so two requests at once cannot both pass it
//   const left = await db(env).first('UPDATE players SET runs = runs - 1 WHERE id = ? AND runs > 0 RETURNING runs', sub);
//   await db(env).batch([['INSERT INTO runs (player) VALUES (?)', sub], ['UPDATE players SET gold = gold + 5 WHERE id = ?', sub]]);
//
// Always pass a value as a ? and an argument, never inside the SQL's text: a player's words in the SQL are a way in.

/** The database's name on env (gamesfun.json → database.binding). */
const BINDING = '__BINDING__';

/** Prepared queries on the game's database. */
export function db(env) {
  const d1 = env[BINDING];
  if (!d1) throw new Error(`The game's database is not bound as env.${BINDING} (gamesfun.json → database).`);
  const statement = (sql, params) => d1.prepare(sql).bind(...params);
  return {
    /** Every row it answers. → [row] */
    async all(sql, ...params) {
      return (await statement(sql, params).all()).results ?? [];
    },
    /** The first row, or null. */
    first(sql, ...params) {
      return statement(sql, params).first();
    },
    /** A write. → {changes, lastRowId} */
    async run(sql, ...params) {
      const r = await statement(sql, params).run();
      return { changes: r.meta?.changes ?? 0, lastRowId: r.meta?.last_row_id ?? null };
    },
    /** Several statements, all of them or none: [[sql, ...params], …]. → the rows of each */
    async batch(list) {
      const done = await d1.batch(list.map(([sql, ...params]) => statement(sql, params)));
      return done.map(r => r.results ?? []);
    },
    /** D1 itself, for anything else (env.<BINDING>). */
    d1,
  };
}

/**
 * The signed-in player's id (env.GF.verifyPlayer's sub: the account, x:<X id> or for Google g:<id>, different in every
 * game; never the wallet, which is v.wallet), from the token gamesfun.js sends; null for a guest, at once and with no
 * call when the request has no token, so a stranger costs the server nothing: answer 401 then, before any work.
 */
export async function withPlayer(request, env) {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return null;
  const v = await env.GF.verifyPlayer(token);
  return v?.ok && typeof v.sub === 'string' && v.sub ? v.sub : null;
}
