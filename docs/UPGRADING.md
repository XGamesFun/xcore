# Upgrading a game made with an older xcore

## A game with `server/database.js` from xcore 0.1.0

In xcore 0.1.0, `xcore add database` wrote `server/database.js`: one Durable Object whose documents were identified by
collection and ID only, readable by anyone by default, and paged with `offset`.

If your game has that file, make the changes below. If it does not, you need none of them. (The D1 database,
`xcore db` and `xcore files` are separate features.)

1. **Run `xcore add database` again.**
   - It updates `server/database.js` (your `RULES` and `LIMITS` are kept), along with the current `gamesfun.js` and the
     Godot or Unity glue.
   - It lists each `dataOf(env)` call in `server/` that needs an owner (step 3), as `file:line` with the change to make.
     `xcore publish` keeps listing them until each one names its owner.
   - On its first start, the new `database.js` moves the documents to a table keyed by collection, owner and ID, each
     under its owner.
   - **After that, do not roll the game back to a version with 0.1.0's `database.js`.** Its writes fail on the new
     table.
2. **Rules are private by default.**
   - An unchanged 0.1.0 `RULES` (`'*': { read: 'anyone', write: 'owner' }`) becomes
     `'*': { read: 'owner', write: 'owner' }`: each player reads only their own documents.
   - Name each collection that should be public: `levels: { read: 'anyone', write: 'owner' }`.
   - An unknown rule value (such as `read: 'everyone'`) now stops the server when it starts, instead of being read as
     something else.
3. **`dataOf(env)` takes an owner.**
   - Without an owner, calls use the server's own space (owner `"server"`). So 0.1.0's
     `dataOf(env).get('profiles', playerId)` returns 404, and `.put('profiles', playerId, …)` writes a copy the player
     never sees.
   - Pass `{ owner: sub }` (the player's ID: `sub` from `env.GF.verifyPlayer`) as the last argument of `get`, `put`,
     `add` and `delete`. Use `{ owner: 'server' }` for the server's own documents.
   - A `list` without an owner still returns everyone's documents.
4. **A page reads another player's document by its owner.**
   - An ID alone now means the player's own document (or, in a `write: 'server'` collection, the server's).
   - For someone else's document, pass the owner: `gf.db.get('levels', id, { owner: doc.owner })`,
     `GET api/db/<collection>/<id>?owner=<id>`, Godot `db_get(collection, id, {"owner": owner})`, Unity
     `DbGet(collection, id, owner)`.
   - Reading by ID alone returns `data: null` with `code: 'owner'` (reported once in the console).
5. **Lists are paged with `after`, not `offset`.**
   - Pass the last answer's `after` to get the next page: `gf.db.list('levels', { after: page.after })`. It is `null`
     on the last page, and `more` says whether there is another page.
   - A real `offset` is refused (0 or none is fine): `code: 'offset'` from `gf.db.list` and Godot's `db_list`, and
     `400` from `GET api/db/<collection>?offset=` and from `dataOf(env).list`.
   - Unity's `DbList(collection, owner, limit, after, order)` takes the `after` text where 0.1.0 took an `int offset`.
     A call that passed an offset will not compile until it passes `after`.
   - `LIMITS.offset` has been removed.
6. **`createData`** (for server code that runs the documents on its own SQLite):
   - 0.1.0's `createData(sql, { rules, limits, now })`, which called `sql.exec`, is now
     `createData(exec, { rules, limits, now, table })`. `exec(query, ...bindings)` returns the rows, or a promise of
     them.
   - Every call is async, and the options come before `who`: `get(collection, id, opts, who)`,
     `put(collection, id, value, opts, who)`, `add(collection, value, opts, who)`, `delete(collection, id, opts, who)`,
     `list(collection, opts, who)`.
