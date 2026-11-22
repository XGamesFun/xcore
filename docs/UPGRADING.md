# Upgrading a game made with an older xcore

## A game with `server/database.js` from xcore 0.1.0

xcore 0.1.0's `xcore add database` wrote `server/database.js`: one Durable Object whose documents were found by
collection and id alone, open to anyone by default, and paged with `offset`. A game with that file needs the changes
below. A game without it needs none (the D1 database, `xcore db` and `xcore files` are separate).

1. **Run `xcore add database` again.** It brings `server/database.js` up to date (your `RULES` and `LIMITS` are kept),
   with the current `gamesfun.js` and the Godot or Unity glue, and lists each `dataOf(env)` call in `server/` that needs
   an owner (step 3) as `file:line` with its change; `xcore publish` lists them again until each names its owner. On its
   first start the new `database.js` moves the documents to a table keyed by collection, owner and id, each under its
   owner. After that, do not roll the game back to a version with 0.1.0's `database.js`: its writes fail on the new
   table.
2. **Rules are private by default.** A `RULES` that 0.1.0 wrote and nobody changed
   (`'*': { read: 'anyone', write: 'owner' }`) becomes `'*': { read: 'owner', write: 'owner' }`: each player reads
   only their own documents. Name each collection that is meant to be public:
   `levels: { read: 'anyone', write: 'owner' }`. A rule xcore does not know (`read: 'everyone'`) now stops the server
   when it starts, instead of being read as something else.
3. **`dataOf(env)` takes an owner.** Without one it is the server's own space (owner `"server"`): 0.1.0's
   `dataOf(env).get('profiles', playerId)` answers 404, and `.put('profiles', playerId, …)` writes a copy the player
   never sees. Pass `{ owner: sub }` (the player's id, `env.GF.verifyPlayer`'s `sub`) as the last argument of `get`,
   `put`, `add` and `delete`, or `{ owner: 'server' }` for the server's own documents. A `list` without an owner is
   still everyone's.
4. **A page reads another player's document by its owner.** An id alone is now the player's own document (or, in a
   `write: 'server'` collection, the server's). For someone else's, pass the owner:
   `gf.db.get('levels', id, { owner: doc.owner })`, `GET api/db/<collection>/<id>?owner=<id>`, Godot
   `db_get(collection, id, {"owner": owner})`, Unity `DbGet(collection, id, owner)`. By id alone it gives
   `data: null` with `code: 'owner'` (said once in the console).
5. **Lists page with `after`, not `offset`.** Pass the last answer's `after` for the next page
   (`gf.db.list('levels', { after: page.after })`); it is `null` on the last page, and `more` says whether there is
   another. A real `offset` is refused (0 or none is fine): `code: 'offset'` from `gf.db.list` and Godot's `db_list`,
   400 from `GET api/db/<collection>?offset=` and from `dataOf(env).list`. Unity's
   `DbList(collection, owner, limit, after, order)` takes the `after` text where 0.1.0's took an `int offset`, so a
   call that passed an offset does not compile until it passes `after`. `LIMITS.offset` is gone.
6. **`createData`** (for server code that runs the documents over SQLite of its own): 0.1.0's
   `createData(sql, { rules, limits, now })`, which called `sql.exec`, is
   `createData(exec, { rules, limits, now, table })`, where `exec(query, ...bindings)` answers the rows or a promise
   of them. Every call is async, and the options come before `who`: `get(collection, id, opts, who)`,
   `put(collection, id, value, opts, who)`, `add(collection, value, opts, who)`, `delete(collection, id, opts, who)`,
   `list(collection, opts, who)`.
