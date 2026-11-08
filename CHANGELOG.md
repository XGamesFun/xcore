# Changelog

All notable changes to `@xgamesfun/xcore` (the `xcore` command), newest first. Versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

A database of the game's own, on D1 (xgames.fun's storage interface, STORAGE.md §8.1–8.5):

- `gamesfun.json` → `database` (`engine`, `binding`, `migrations`, `collections`), checked as xgames.fun checks it:
  the binding's name and its clash with a Durable Object's, migration names (`0001_init.sql`), at most 200 of 1 MB,
  and append only: a migration published (and remembered in `.gamesfun/publish.json`) that changed is refused before
  anything goes up.
- `xcore add database`: a game with a server gets the block, `server/migrations/0001_init.sql` and `server/gf-db.js`
  (prepared queries, `withPlayer`); a game with none gets the block with `collections`, and **xcore's stock server**
  as its server, which serves `api/db/*` from D1 with the same routes and answers as `server/database.js`, so
  `gf.db` is unchanged. A game that has `server/database.js` keeps it; the check says it is the older way.
- `xcore publish` sends `server.database` with the migration files as blobs, refuses a game with a database when
  xgames.fun's `/api/kit/me` does not list `"d1"`, and says xgames.fun's `migration-changed` (409) and
  `migration-failed` (422) in plain words.
- `xcore dev` runs a local D1 in `.gamesfun/dev/d1/`, applies the migrations at each start and reload, and keeps the
  server down with the reason when an applied migration changed.
- `xcore db info|query|export|import|restore`: the local database, or `--live` through xgames.fun's owner routes. A
  query only reads unless `--write`; `restore --live` shows its preview, warns that loot balances and payouts are not
  rolled back for a game with an economy, and needs `--yes` or the word `restore` typed.

The database is safe by default, and the secret scan reads every byte:

- `xcore add database`: a collection is private by default (`RULES` `'*': { read: 'owner', write: 'owner' }`); a
  `RULES` an older xcore wrote and nobody changed becomes the new default on the next `xcore add database`, which says
  so.
- Each player has a space of their own in every collection: documents are keyed by collection, owner and id, so no
  player can take an id in another player's space (or the server's, `owner: "server"`, which only the server writes).
  A page reads another player's document in a `read: 'anyone'` collection by its owner
  (`gf.db.get(c, id, {owner})`, `GET api/db/<c>/<id>?owner=<id>`); without an owner it is the player's own, or the
  server's in a `write: 'server'` collection. `dataOf(env)` reads and writes the server's own space by default, a
  player's with `{owner: sub}`. A table an older `server/database.js` made moves to the new one on its first start,
  every document kept under its owner.
- Lists page with a cursor: `gf.db.list(c, {after})` and `GET api/db/<c>?after=` answer `after` (the next page's
  place, `null` on the last) and `more`. `offset` is gone and refused in words; Unity's `DbList` takes `after` in its
  place, Godot's `db_get` and Unity's `DbGet` take an owner.
- The publish scan reads a text file whole, however big, in 4 MiB pieces that overlap by more than any key it looks
  for can be long; it read only the first 4 MiB before. The patterns are one list, `lib/secret-patterns.mjs`, which
  the publish scan and the kit both read; each has an upper bound, so the overlap is enough.

Every lifecycle the commands report now has one named state, one place that decides it, and the same answer for a
person and for `--json`.

- Sign-in: `login --status`, `publish --status` and every signed call name the state (`signed-in`, `signed-out`,
  `expired`, `unreadable`). An expired sign-in is refused in its own words and gives way to GitHub's OIDC token in
  Actions; a token is read from the store its record names, so a sign-in saved over SSH is never shadowed by an older
  keyring token; `logout` says why a token was not revoked (`why`: `unreadable`, `ended`, `offline`, `refused`).
- `publish --status` names the game's `link` (`never`, `started`, `public`, `draft`, `draft-over-public`): an
  interrupted first publish no longer reads "version undefined", and a draft over a public game says the earlier
  version is the one playing.
- `--json` failures are printed on stdout too, as `{ ok: false, error, code, state, next }`; `adopt --json` gives
  `state` (`refused`, `fix`, `ready`) and `next`.
- `adopt` again with one of `--build`, `--out` or `--static` keeps the rest of `gamesfun.json` (and says what it
  kept); `add` refuses a broken `gamesfun.json` or test key before writing any file.
- Vouchers: a round goes free → reserved → signed in one place (`roundStep`); a round whose signing failed can be signed
  again by its wallet; `PAY.paid` runs once a round, never twice for two asks at once or a renewal, and again if it
  threw; a voucher signed with an earlier key is signed anew.
- Rooms: two players hosting one code at once get one host, and a room never passes `maxPlayers`.
- `xcore dev`: saves made at once on start are all kept; an install interrupted by Ctrl-C no longer blocks the next one
  for 10 minutes; `close()` stops a pending reload; a port in use stops the started game server.
- The page client: two sign-in clicks share one sign-in, sign-out ends a pending one, and a late answer never signs the
  player back in; a local room's "taken" and "nobody here" answers settle the join; an older game's `loot.json` is read
  when it has no `xsolana.json`.
- `check` downloads Chromium where there is no Chrome (it failed: playwright-core's exports); its progress goes to
  stderr. `adopt`'s next step names the folder; `check --port 4000 <game>` goes to the kit for a game it made.

## 0.1.0 (2026-11-08)

The first release: xgames.fun from the command line, the one place to start: a web game you already made is brought,
checked, given a backend and an economy, and published; an idea for a game goes to the kit.

- `adopt`: reads the game's shape (plain files, or a Vite, Next.js static export, Astro, SvelteKit, Nuxt, Create React
  App, Parcel or Gatsby build, in its own folder or a monorepo's workspace), builds it, writes its record (`gamesfun.json` → `page`) and lists everything that does
  not fit xgames.fun's hosting, each with its fix. An engine's export that cannot start there is named with the setting
  that fixes it: a Unity build compressed for Content-Encoding (Compression Format or Decompression Fallback), a Godot
  export built with Thread Support. A Unity or Godot project (its sources) is read as one: its web export is the page,
  or adopt says how to make it; an entry page that loads files the folder lacks is said before publishing.
- `check`: the page check, as xgames.fun hosts the game: it builds, fits the hosting, starts clean in Chrome at a phone's
  and a desktop's size under the play host's page policy, and stays inside its origins.
- `@xgamesfun/solana` 0.25.0, for loot 0.25.0 (on devnet since 2026-11-08, slot 519,994,814). No account of an
  earlier program carries over: an economy that went live before then goes live again (`xcore loot approve`), and the
  next publish brings its `gf/loot/` and `server/gf-loot/` copies up to 0.25.0. The tools follow loot's rules (a prize
  is a fixed amount; a box's `whenOut`; a lottery names where its places are paid from, a `pot` or each round's own
  money with a `rest`) and warn about farming (`W-GRANT-TOTAL`, `W-GRANT-OPEN`, `W-FARM-MINT`, `W-FARM-SWITCH`).
- `add vouchers`: a game's server pays the results it checked from a grant, with a key of its own: `server/vouchers.js`
  at `api/vouchers/` (`PAY.check` decides what pays and names the amount, base units or `'grant'`; `PAY.paid` runs
  once a voucher is signed; `voucherFor(env, …)` and `walletOf(env, player)` for the server's own code), a Durable
  Object (`GameVouchers`) that reserves each result for one wallet before signing, so a result pays once and never again
  once the grant is made again, and loot's voucher code in `server/gf-loot/`, which publish keeps at the installed
  `@xgamesfun/solana`. A voucher pays only a wallet the player proved is theirs: the one they signed in with, or one
  linked with the kit's signed proof (`api/vouchers/link`, a nonce taken once; `gf.loot.link()`, Godot `loot_link()`,
  Unity `LootLink()`); a wallet the page names is refused. `VOUCHERS.payOnly: 'x'` pays only players signed in with X,
  a grant with `perPerson` pays only them, and `VOUCHERS.perMinute` limits a player's requests. It makes a test key
  for `xcore dev` (`VOUCHER_SEED` in `.dev.vars`, kept out of git); `xcore secret set VOUCHER_SEED --new-key` makes the
  live key, sends it only to xgames.fun and never keeps it on the machine, and prints its address for the grant.
- Paying a result, in docs/SERVER.md, the README and the skill: xgames.fun's keeper (`env.GF.loot.report`) for prizes
  fixed by place, the server's own key for amounts it works out, replayed or bounded runs, entry fees and prize pools,
  or more than 120 results an hour. A grant names up to three keys, so both can pay it while a game moves over.
- docs/SERVER.md, "How much your server can check" and "Who gets paid": never hand the page a run's whole seed (a script
  searches it offline), slack per second rather than per request, one open run per player; a wallet is not a person
  (X-only payouts, `perDay` totals, gates, proven wallets); the kit's server helpers every `server/gf-loot/` carries
  (`holds`, `collectiblesOf`, `makeCodes`, `codeVoucher`).
- `add rpc`'s `server/rpc.js` passes only the calls loot's page client makes, scans only loot's own programs and sends
  only the game's own transactions (a loot instruction, or a plain SOL send), so a stranger can't spend the game's RPC
  credits. The server `add` writes answers the page's `api/rpc` question when the game has no RPC of its own.
- `xcore dev` answers only `localhost`, `127.0.0.1` and `[::1]`, and rebuilds the server when a file of the game's own
  it imports from outside `server/` changes. `gamesfun.js` documents `gf.local` and `gf.dev` (under `xcore dev` both
  are true and the server is there).
- Publish leaves out the makers' notes at the folder's top (`README.md`, `NOTES.md`, `LAUNCH.md`, `FRICTION.md`,
  `CLAUDE.md`, `AGENTS.md`, `TODO.md`); its scan refuses a signing key's seed by its name (`VOUCHER_SEED=…`), a
  `{pub, seed}` key file and a 64-byte secret key written into code.
- `embed` and `domain`: a site of your own may frame the published game (`xcore embed add https://mygame.com`, which
  prints the `<iframe>`; every plan: 3, 10 or 25 sites), and on Creator (1) or Scale (5) it is served on a domain of
  your own (`xcore domain add play.mygame.com` prints the CNAME and TXT records as a table; `check` and `list` say its
  state). `gamesfun.js` 1.2.0 asks the play edge which game it is on a host of its own (`/platform/v1/site`), and takes
  a sign-in from the page above only when that page is xgames.fun's own, so a site that embeds the game can't sign
  players in for it; `domain add` says when the folder's copy is older.
- `add rpc`: an economy game's Solana calls through its own devnet RPC (`server/rpc.js` at `api/rpc`, the URL a secret
  of its server, its origin added to `backend.json`) instead of xgames.fun's shared relay, which counts every call toward
  the game's plan; the page client asks `api/rpc` once and keeps the relay until the secret is set. Publish says which
  one an economy game uses.
- `add signin`: xgames.fun's player sign-in (X first, or a wallet), saves and leaderboards from a web game, a Godot 4
  project (an autoload) or a Unity project (a WebGL plugin), with one page client (`gamesfun.js`): signed in by the play
  page, by a window or a typed code on the game's own link and inside a post on X, and a local player on this machine.
  The code is shown plainly only when no window opened (`window: false`); with a window open, at most as a quiet line
  (X's login page hides the window's state from the game, so a code shown "when it closed" interrupts a sign-in).
- `add database`: a database of the game's own, put up with it by publish: `server/database.js`, one Durable Object
  with SQLite storage at the game's `api/db/`, documents in collections with per-collection rules.
- `add multiplayer`: rooms of the game's own, put up with it by publish: `server/rooms.js`, one Durable Object a room
  at `api/rooms/<CODE>`, a relay with a host (id 1) that passes on when the host leaves. Godot's high-level
  multiplayer runs over it through a `MultiplayerPeer` (`GamesFun.join_room`; a local ENet game in the editor); Unity
  and web games get a room with send and events; tabs of one browser share a room on this machine; room links
  (`?room=CODE`) open the game in its room on xgames.fun and in a post on X. A frame's messages go to the room as one
  (at most about 60 a second at any frame rate), so a Godot game's MultiplayerSynchronizers stay under the room's
  limit; Host and Join buttons can ask for a new room only or an existing one only; a refused message reaches the
  game (Godot's `room_error`, Unity's `OnError`); running `add` again keeps the settings at the top of `server/`'s files.
- `plan [dir]`, `plan activate|deactivate [dir]`, `plan --all`: a game's backend plan on xgames.fun (Free by default,
  Creator in one of the account's paid game slots, Scale when xgames.fun grants it), its limits and this month's use;
  a slot moves between games at any time.
- `secret set|list|delete`: a game server's own secrets on xgames.fun, read by the server as `env.<NAME>` (a
  voucher-signing key, an outside API's key): kept only on the server's host, never shown again, never given to the
  page, live from the server's next request with no publish. `dev` reads the same names from `.dev.vars`.
- Leaderboards a server owns: `env.GF.scores.setup(board, {writer: 'server'})` (or `writer` in the server's `submit`)
  refuses the page's submits to that board (`server-only`); the page still reads it. A board that becomes the
  server's starts empty; a pattern (`'daily-*'`, `'*'`) owns boards to come; `scores.drop(board)` frees a board's
  place. The same under `dev`. The page client's refusals carry xgames.fun's `code`.
- `dev`: the game on this machine as xgames.fun hosts it, with everything behind it: its files under `/game/` with the
  play host's headers, its `server/` under workerd (Durable Objects, WebSockets, a local `env.GF`; reloaded on change;
  Miniflare installed once on first use), a local sign-in a tab with saves and scores at `/platform/v1/*`, and the
  economy's `/loot/v1/rpc` forwarded to xgames.fun's relay or `XSOLANA_RPC_URL` (a call the relay would refuse is said).
  `gamesfun.js` uses all of it under `xcore dev`, from any engine. The local server has no limits, so its log says when the
  page's requests to it would pass a published plan's (more than Free's 60 a minute from one player, or Creator's 600)
  and when a request takes longer than Free's 50 ms of CPU, before players find out.
- `GamesFun.loot` in `gamesfun.js`: a game's economy (loot's page client) with JSON in and out, so Godot
  (`loot_ready`, `loot_connect`, `loot_call`) and Unity (`LootReady`, `LootConnect`, `LootCall`) use it as a web page does.
- An engine's export keeps what xcore adds apart: in a Godot or Unity project `loot add` puts the economy in the
  project's `gamesfun/` (`page.static`), which publish, `check` and `dev` lay over the export, so a new export or a
  fresh clone never loses the addresses the economy went live at. Any brought game with no build may name such a folder.
- `check` names a published `gamesfun.js` that the built `index.html` does not load (a build that writes `index.html`
  from a template drops the tag `add signin` added to it).
- `adopt` on a game with a Node server (Express, Socket.IO) names both ways: its work moved into `server/`, or the
  server kept on its own host; once the game has `server/`, it no longer says to keep the Node server.
- docs/SERVER.md: a server that pays results with loot vouchers (its key made and kept in a Durable Object, the
  grant's incarnation read through xgames.fun's relay, the go-live order), run as written under `xcore dev`.
- `adopt` on a Godot project with no Web export writes its Web preset (Thread Support off, into `build/web/`, xcore's
  folders left out of the package, `build/` kept from the editor's imports) and says the one command that exports it.
- `check` on a Godot project says when the project changed after its Web export (with no build, the export on disk is
  what goes up); `adopt --out build/web` before the first export writes the Web preset too, and says what it wrote.
- `check` notes client files (`gamesfun.js`, the Godot and Unity glue) that an older xcore wrote.
- `adopt`'s service-worker note says never to cache the host's answers (`api/`, `/platform/v1/`, `/loot/v1/`).
- The publish scan passes a transaction's signature recorded in a live economy's `xsolana.json` (base58 of 64 bytes,
  the length of a Solana secret key), so a game whose economy is live publishes.
- `backend use custom`: a backend you already run, named in `backend.json` so the published page may reach it.
- `loot`: a Solana economy on loot (devnet), with `@xgamesfun/solana`'s tools (`check`, `simulate`, `approve`,
  `connect` …) and its page client copied into the game (`loot add`). The tools' words name `xcore loot <command>` and
  the file as it was given, never `npx … @xgamesfun/solana` or `xsolana`.
- A game's server: a named export the hosted runtime cannot start with (a plain value, `export const SEASON = 5`) is
  refused by `publish --check` and publish, before it could fail at its first request.
- `check` in a Godot project keeps Godot out of its `evidence/` (a `.gdignore`), so its screenshots are never packed
  into the game.
- `login`, `logout`, `publish`: sign in from the browser (or `--code`), publish at an unlisted link (only new files go
  up; a failing check saves a private draft), from GitHub Actions with the job's OIDC token and no stored key.
- With `@xgamesfun/kit` (the game-making kit) installed, every other command (`create`, `verify` …) goes to it, and so
  do `check`, `dev` and `publish` for a game the kit made.
