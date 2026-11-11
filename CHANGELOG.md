# Changelog

All notable changes to `@xgamesfun/xcore` (the `xcore` command), newest first. Versions follow [Semantic Versioning](https://semver.org/).

## 0.6.1 — 2026-11-11

**`xcore loot approve --browser` takes what Phantom signs.** The tools are `@xgamesfun/solana` 0.28.1 (on loot 0.28.0,
unchanged). The page for a browser wallet sent a transaction only as it had prepared it, byte for byte; Phantom adds
its own checks to what it signs (instructions of the Lighthouse program), so it could not approve wherever it adds
them. The page now sends the wallet's own transaction when the wallet only added those to a transaction it alone
signs: everything that was prepared and shown is in it untouched and in order, no account of it gained or lost a
privilege, and nothing else rides with it, no other program's instruction and no fee of the wallet's own. Anything
else is still refused, saying what the wallet did. Going live with a key file (`--keypair`), the usual way, is as it
was.

## 0.6.0 — 2026-11-11

**A game with a claim can open itself in the player's wallet app.** A player who opens a game from a post in X's app
is in X's own browser, which has no wallet. Inside xgames.fun's play page, the page can now open the game in Phantom's
or Solflare's browser (or the person's own), signed in, when the game asks. `gamesfun.js` is 1.7.0, with three calls:

- `GamesFun.canOpenWallet()` → `true` (no wallet here, and the play page opens a wallet app when asked), `false`, or
  `null` (no play page around the game, or one that does not say); `GamesFun.onCanOpenWallet(fn)` follows each change.
- `GamesFun.walletNeeded()`: the game shows a Claim button, and the play page gets ready; it is told once a page load.
  → `{data: {told: true}}`, or `code: 'no-page'`.
- `GamesFun.openWallet(app = 'phantom', {view, href})`: from inside the player's tap, with no `await` before it (the
  message goes in the call). `app`: `'phantom'`, `'solflare'` or `'browser'`; `view`: `'claim'` with `href` (an
  address of the game's own play page) or `'wallet'`. → `{data: {asked: true}}`, or `code: 'invalid'`, `'no-page'` or
  `'not-offered'`, with nothing opened: the game shows its own fallback.

The README (§3, "A wallet app, for a claim") has a Claim button that chooses between the three. Under `xcore dev` and
on this machine there is no play page around the game, so `openWallet` answers `no-page` there. `xcore add signin`
again brings a game's copy of `gamesfun.js` up to 1.7.0; the Godot and Unity glue carry the new file but have no
calls of their own for these yet.

## 0.5.2 — 2026-11-11

**loot is at its official address on devnet**, `xgamesVsZBpCVgJuatfYAFJRmQoccfQf5qtUFNp2Eet`, and the tools are
`@xgamesfun/solana` 0.28.0, built for it. It is the same program as 0.27.0 at a new address, so every address the
program derives is new too: nothing set up under the address before (`9cwq…7NFQ`) exists under this one, and an
economy from before goes live again.

- `xcore dev`'s relay and every `xcore loot` command take loot's address from the installed tools now, so the next
  move needs no change here.
- A new game's `server/rpc.js` (`xcore add rpc`) names the official address. One written before names the old one in
  `scanPrograms`: put the new address first there, or the game's own RPC refuses the economy's transactions.

## 0.5.1 — 2026-11-11

**An economy goes live signed by a key file on your own computer; no page opens unless you ask for one.** The tools
are now `@xgamesfun/solana` 0.27.2 (on loot 0.27.0, unchanged: an economy that is live stays live).

- `xcore loot keygen <file>` makes a key file for a game's economy, outside any repository, and prints its address,
  never the key. `xcore loot approve --keypair <keyfile>` shows everything going live would send, with a code, and
  sends nothing; the same command with `--yes <code>` sends exactly that. The key file is the project's owner, for
  good: whoever can read it controls the project, every later change is signed by it, and nothing restores a lost one.
- **Plain `xcore loot approve` opens nothing now**: it says the two ways and stops. The page for a browser wallet is
  `xcore loot approve --browser`, for when you ask for it.
- `xcore loot approve` no longer sends through xgames.fun's shared relay, which passes only loot's own transactions:
  about one in eight of a setup's transactions (a token's mint, the token accounts an economy pays into) are not, and
  the relay refused them. It sends through `XSOLANA_RPC_URL` when you set one, else through Solana's public devnet
  RPC. Every other `xcore loot` command still reads through the relay.
- A key file named beside the flags (`--keypair keys/game.json`) is never taken for the economy file, and is found
  from where you stand when the economy file is in another folder.
- Fixed in the tools: a transaction the network took, whose answer was lost, could be sent again at the next
  `approve` (a setup's seeds paid in twice); a browser wallet that adds its own priority fee was refused after a
  setup's first transaction.
- The README, the skill and `xcore loot add`'s next steps say how going live is signed now.

## 0.5.0 — 2026-11-11

**`xcore publish` now stops when the game has no preview picture xgames.fun can draw.** A link to a game shared on X
or in a chat shows a 960×960 card from xgames.fun with the game's own picture behind its title; without one it is a
plain gradient. The picture is `assets/card.jpg` (or `assets/card.png`) among the published files. To go on, either:

- make one: `xcore card <folder>` (a picture of the game as it plays, or `--from <picture>` from one you have), look
  at it, and publish again; or
- publish without one: `xcore publish <folder> --no-card`, or put `"card": false` in the game's `gamesfun.json` so it
  is not asked again.

A job that publishes from GitHub Actions stops the same way: commit `assets/card.jpg`, or add `--no-card`.

- The preview picture is checked on exactly the files that go up. Publish stops for what xgames.fun cannot draw: over
  1,500,000 bytes, not a JPEG or PNG, a PNG named `.jpg` or a JPEG named `.png` (rename it), cut short, a PNG whose
  image data is damaged, or a JPEG
  other than baseline or progressive. One it draws but small (under 600 px a side: blurry) or far from square (the
  longer side over 1.25 times the shorter: cropped to its middle) goes up with a warning and its fix. Width, height
  and kind are read from the file's own bytes; no image library was added.
- `xcore card [dir]` writes `assets/card.jpg` at 960×960: the game served as the page check serves it, opened in Chrome,
  after `--wait <seconds>` (4 by default), `--tap` to start a game that waits for one, `--path` for another of its
  pages; or `--from <picture>` (at most 40 MB), scaled to cover and cropped to its middle. It never replaces a picture
  that is there without `--force`, writes nothing outside the game's folder, makes no picture of a page that answers
  an error, and fails (unless `--force`) when the page threw or logged errors. A game with a build gets it in the
  folder its build copies as it is (`page.static`); a build with no such folder is told where it has to live.
- With no picture xgames.fun can draw, publish stops before anything is uploaded (`--json`: `"code": "card"`, `"card"`
  what it found, `"next"` the command that fixes it). `--draft`, `--status` and `--check` do not stop for it; `--check` and `xcore check` report it
  (a warning, never a failed check; `--check --json` carries it in `card` and `cardWarnings`). After a publish with a picture, xcore prints the card's address
  (`<site>/play/<slug>/card.png`); a link shared before can keep its old card for a while.
- `publishCommand` and `publishGame` take `card`: by default the picture is asked for only with this package's own
  check (a kit that passes its own check makes its own card), and `card: false` turns it off.

## 0.4.4 — 2026-11-11

`@xgamesfun/solana` is 0.27.1 (loot 0.27.0, as devnet runs it; the page client alone changed).

- The rest of what hands out an NFT finishes when the NFT is gone: a lottery's pull, a contest's claim, an auction's
  end and a raffle taken back. `claims()` says which of them would hand out a gone NFT, and `closeGone` also takes a
  gone NFT's row off the project's stash.

## 0.4.3 — 2026-11-11

`@xgamesfun/solana` is 0.27.0, for loot 0.27.0 (on devnet since 2026-11-11). No stored record changed shape and no
instruction changed, so an economy that went live under 0.26 stays live as it is.

- A hold, a loan or a listing whose NFT is gone (taken or burned by whoever controls a collection the project does
  not) can be closed: `claims()` lists it, `closeGone(asset)` closes it, and a deposit clears what an earlier owner
  left instead of refusing. Buying or renting a gone listing is refused in words.
- A farm gives the rounding share of weight that leaves back to the project. A walk takes 400 ends a transaction
  (it was 500).

## 0.4.2 — 2026-11-11

`@xgamesfun/solana` is 0.26.4 (loot 0.26.1, as devnet runs it).

- A live token's name, ticker or picture link can be changed: edit it in `xsolana.json` and run `xcore loot approve`
  again. It is written to the token's record on chain when the token has one its owner can still change.
- Going live that is cut short (a transaction refused, or one whose confirmation was not seen) finishes when it is
  gone on with: the accounts the economy pays into and the project's lookup table are still made.

## 0.4.1 — 2026-11-10

`@xgamesfun/solana` is 0.26.3 (loot 0.26.1, as devnet runs it).

- `xcore loot token <mint>` reads a coin made elsewhere from the chain and prints its entry for an economy's `tokens`,
  with what its mint's own keys can do. A token the economy makes itself is named on chain as it goes live (its
  `name`, `symbol` and `uri`), so wallets show it by name.
- The README's economy section and the bring-your-own-game skill say which kind of token is which.

## 0.4.0 — 2026-11-10

The kit now refuses at build time what xgames.fun refuses at publish, `xcore dev` behaves like the platform on a plan,
and `@xgamesfun/solana` is 0.26.0.

**May break**

- Server bundles: an import, re-export or `import()` of `cloudflare:sockets`, `node:net`, `node:tls`, `node:dgram`,
  `node:http2`, `node:module` or `node:child_process`, an `import()` of a name made at run time, and `nodejs_compat`
  (so every `node:` import a bundle still uses) are refused, as xgames.fun refuses them. An import esbuild leaves out
  of the bundle no longer refuses a publish.
- Programs, installers and archives other than `.zip` are refused at publish, before anything is sent.
- `xcore dev` enforces the Free plan by default (`--plan creator|scale` for another): 8 boards and 16 rules where it
  allowed 16 and 32, "high" boards only from a page and two a player, a player's share of save bytes, rates a minute,
  JSON page bodies of at most 96 KB, and for project files a matching type for anything public and 1 MB for a string
  or `ArrayBuffer` body. A public file stored under 0.3.0 is served as a download until it is put again.
- `PLATFORM_LIMITS.scores` in `@xgamesfun/xcore/server/contract` is Free's (8 boards, 16 rules), no longer 16 and 32;
  `PLAN_LIMITS` has every plan's numbers.
- `@xgamesfun/solana` 0.26.0, for loot 0.26.0 (on devnet since 2026-11-10, slot 520,815,761). No account of an earlier
  build carries over: an economy that went live before goes live again (`xcore loot approve`), and the next publish
  brings `gf/loot/` up to the installed package.

**Servers and publishing**

- Server bundles are checked by parsing the finished bundle, and a refusal names the file it came from, in a package
  too. A path esbuild can list (``import(`./levels/${n}.js`)``) is bundled and accepted.
- `nodejs_compat` is not offered: a `gamesfun.json` that asks for it is refused, in words.
- docs/SERVER.md and README say what the platform does today: the list in `backend.json` applies to the calls a
  server's entry makes (do not rely on it for anything else), no number of calls out a request is promised, and an
  unpublished, taken-down or capped game's server is switched off (a running room within about five minutes).
- The publish scan's patterns are bounded and linear, as xgames.fun's (4 MiB of any hostile text in well under a
  second), and a secret-looking literal is judged with the host's bounds (one longer than 1,024 characters is no longer
  refused). A backend origin whose host a page's security policy cannot name is refused.
- A first publish (and `xcore check`) says the link name a game will get when xgames.fun leaves reserved words out of
  its title.
- A player's id is the account (`x:<id>`, or `g:<id>` for Google, different in every game), never the wallet: `wallet`
  is a claim of its own and may be absent. The docs and the server templates say so.
- `xcore review`: `server-no-token-check` (medium) and `work-before-token` (low) for a server of the game's own that
  does work without, or before, checking a player's token; docs/SERVER.md has "Check the token first".

**Local development and sign-in**

- `xcore dev --plan free|creator|scale`: the dev platform refuses what xgames.fun refuses on that plan, and says which
  plan it is imitating when it starts. Board reads carry per-game player ids with `me: true`; a read with no token sees
  the top 100 (a 5-second cache, its own minute); ranks and offsets go to 10,000. `env.GF.scores.list()` works there.
- `xcore login` says whether the sign-in reaches your whole account or which games, and `login --status` says it again
  (asked of xgames.fun each time, with the saved answer when it cannot be reached). A command refused because the
  sign-in was not given that game (`not-granted`) says so, with `xcore login` as the next step.
- README: a backend of your own that keeps xgames.fun's key set fetches it again, once, when a token names a key id it
  does not hold.

**Solana economies**

- New for a game's page through `gf.loot.call`: an auction's end delivers the lot and pays the seller together, and
  says when a sale is waiting (`endAuction`); a loan's repayment brings the NFT home (`repay`); `lotteries` and
  `ticketWeight` show a time-weighted lottery's weights and its sales close; `unstakeNft` can leave without a prize that
  cannot be given; `collect` can give up a prize the player cannot receive.
- Before a player hands an NFT of another collection to the project (a stake in escrow, a loan, an NFT bid, ticket or
  stake), the page client reads the listing and the holds an earlier owner may have left on it and refuses in words;
  `acceptLeftover: true` goes ahead.
- New in a spec (`xcore loot check` explains each): a lottery's `closesBefore` and `timeWeighted`, a place's
  `whenShort`, a box's `whenOut: "giveNothing"`. Many limits are gone and are warnings now: read the check's warnings
  again for an economy written for 0.25.

## 0.3.0 — 2026-11-09

- `gamesfun.js` is 1.6.0.
- **Live operations** (xgames.fun/console's Live tab): `gamesfun.js` adds `GamesFun.live` (`get()`, `refresh()`,
  `onChange(fn)`, `banner(on)`, `value`) for the game's announcement, remote config and maintenance mode, which its
  owner changes with no republish (xgames.fun's play edge answers `GET /platform/v1/live` itself). A default banner
  shows the announcement and a pause that starts while the game is open; `data-live-banner="off"`,
  `GAMESFUN_LIVE_BANNER = false` or `GamesFun.live.banner(false)` turn it off. A refusal with code `maintenance` (from
  `api/` or the platform while the game is paused) is passed on like any other code.
- `env.GF.verifyPlayer` answers `banned` too: the creator's ban on the player from xgames.fun/console (`{kind, until}`
  or null). A token made before the ban still verifies for its hour, so a game's server that keeps players (a room)
  refuses `kind: 'ban'` itself. `xcore dev` always answers `banned: null`.
- `xcore dev` answers `/platform/v1/live` from the game's `.gamesfun/live.json`, and with maintenance on there serves
  the holding page for the game's pages and `503 maintenance` for its `api/` and platform calls, as hosted.
- Full screen: `GamesFun.fullscreen()` (and `GamesFun.fullscreen()` in Godot): from a click,
  the play page around the game goes full screen (or fills the screen in an app's own browser, X's among them), the
  browser does on the game's own link, and a frame that allows none (a post on X) opens the game in a tab of its own;
  `GamesFun.onFullscreen` follows it. `xcore adopt` warns when a game has no way to go full screen, and the
  bring-your-own-game skill offers the button.
- Sign-in is X or Google (xgames.fun 2026-11-09): a wallet signs nobody in any more (a copycat game could relay that
  signature); a player links a wallet on xgames.fun's account page and it comes with every sign-in.
  `GamesFun.signIn({how: 'google'})` (and Godot's `sign_in("google")`, Unity's `SignIn("google")`); `how:
'wallet'` signs in with X; `player.google` and the player's name (no @ for a Google name).
- `server/vouchers.js`: `VOUCHERS.payOnly` may be `'account'` (players signed in with X or Google); a Google account
  with no X counts as one person (`g:<id>`) for `perPerson`.
- `@xgamesfun/solana` 0.25.1 (its `xsolana review`).
- `xcore review [game] [--live [origin]] [--json]`: the security review of a game, read as a cheater would. The
  economy by `@xgamesfun/solana`'s own review (`xsolana review`; an installed version without it is said in one line);
  the server by xcore's reading (`PAY.check` still the template, or paying from the request alone; `VOUCHERS.payOnly`
  against the grants; the voucher key and the grants that name it; `trust` on each voucher grant; `.dev.vars` in git
  or in the published folder; a seed in the page; the test key in a grant; every `api/` route); with `--live`, the
  published game asked with no sign-in and a forged one, its voucher key and its economy's `live`. It writes
  `evidence/review-N/review.md` (ending with the trade-offs for the person) and `review.json`, and exits 1 on a high
  finding.
- `xcore loot review` runs `xsolana review` on the economy file.
- `xcore publish` says when a game that pays through vouchers changed since its last review (it never refuses for it);
  `xcore add vouchers` says to declare each grant's `trust` and run `xcore review`.
- The bring-your-own-game skill has a review step before publishing, and `review --live` after.

## 0.2.1 — 2026-11-09

- Slots (xgames.fun 2026-11-08): every game sits in a slot; everyone gets 2 free slots (games on Free), any more are
  paid (games on Creator). `xcore plan --all` shows free and paid slots; `xcore publish` names the commands that open a
  free slot when a new game is refused (`no-free-slot`); paid slots are bought on your console (xgames.fun/console).

## 0.2.0 — 2026-11-08

### Upgrading from 0.1.0

A game made with xcore 0.1.0 that has `server/database.js` (`xcore add database` then) needs these changes. A game
without one needs none: the D1 database, `xcore db` and `xcore files` are new.

1. **Run `xcore add database` again.** It brings `server/database.js` up to date (your `RULES` and `LIMITS` are
   kept), with `gamesfun.js` (1.4.0) and the Godot or Unity glue, and lists each `dataOf(env)` call in `server/` that
   needs an owner (step 3) as `file:line` with its change; `xcore publish` lists them again until each names its
   owner. On its first start the new `database.js` moves the documents to a table keyed by collection, owner and id,
   each under its owner. After that, do not roll the game back to a version with 0.1.0's `database.js`: its writes
   fail on the new table.
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

### What changed

After an audit of the storage work, and as settled with the platform (STORAGE.md §8.10):

- **A game that gets a server of its own keeps `gf.db`.** A game the stock server served lost its documents (404 on
  every page save and load) once `xcore add multiplayer`, `rpc` or `vouchers` gave it a server. Now `xcore add`
  writes `server/gf-docs.js` whenever `database` has `collections` (a stock game's rules are written out first), and
  the generated `server/index.js` routes `api/db/` through it, from the same `gf_docs` table under the same rules
  (read from `gamesfun.json` when the server is bundled). Publish refuses a server of its own that has `collections`
  and does not route `api/db/` (code `db-route`), and says the two lines to add.
- **`offset` is refused in every client**, not dropped: `gf.db.list`, the browser's local list and Godot's
  `db_list` answer an error (`code: 'offset'`) for any offset but 0, so 0.1.0 code that paged with it stops instead of
  reading page 1 for ever; `offset: 0` (or none) is the first page, as it was. Page with `after`.
- **Lists fail closed**: anything but `read: 'anyone'` lists only the player's own (a mistyped rule listed everything,
  even to guests), and `RULES` / `collections` are checked when the server starts.
- **A document by id alone (0.1.0 pages):** in a `write: 'server'` collection a player's get by id alone looks in the
  server's space and then their own, so a `read: 'owner'` + `write: 'server'` document is read again. In a
  `read: 'anyone'` collection, a get by id alone that finds only another player's document answers 400 `owner`,
  naming `{owner}`; `gf.db.get` gives `data: null` with `code: 'owner'` and says it once in the console. Pass
  `{owner: doc.owner}`. (gamesfun.js is 1.4.0.)
- **Migrations are recorded in the database**, in `_gf_migrations (name, sha256, applied_at)`, in the same batch as
  the migration (its row as started, the statements, its row finished), as xgames.fun records them; `xcore dev` reads
  what is applied from there (the file beside the local database is read in once and removed). A row left as
  started, a file partly applied, is refused with how to undo it; an empty migration (0 bytes) is refused. A
  statement over D1's 100,000 bytes (UTF-8, comments left out, as xgames.fun sends it) or SQL that never ends is
  refused before publish and by `xcore dev`, in xgames.fun's words, with nothing of the new migrations applied; a
  migration may still be 1 MB of many statements. xgames.fun's progress table `_gf_migration_steps` is left out of
  dumps, imports and `db info`, as `_gf_migrations` is.
  `xcore add database` writes `server/migrations/.gitattributes` (`*.sql -text`), so git cannot change a migration's
  line endings.
- **Publish** says `migration-busy` (another publish is applying them: try again in a minute) and
  `database-unavailable` (502: Cloudflare, not the SQL) in words.
- **`xcore db query`** uses a copy of xgames.fun's rule (its statement splitting, the statements it allows, its
  params), so it takes and refuses the same queries here and live; a `null` param is refused (write `NULL` in the
  SQL).
- **`xcore db export` and `import` round-trip**: a dump makes its tables first (`CREATE … IF NOT EXISTS`), then
  writes each row as an upsert on the table's key (`INSERT … ON CONFLICT (key) DO UPDATE SET …`, the rowid for a
  table without a key), after `PRAGMA defer_foreign_keys`, and leaves out `_gf_migrations`. A dump (xcore's or D1's,
  whose `INSERT`s and any `REPLACE` are made upserts the same way) goes in over the database as it is, or into an
  empty one, here and live: a row is updated where it is and never deleted, so a table whose rows point at another's
  with `ON DELETE CASCADE` keeps them, and a row may come before the one it points at. Before, a local import of a
  local export always failed ("table already exists").
- **Live owner routes:** `db import --live` and `files put --live` are held to Studio's 4.5 MB a request before anything
  is sent, with the way that takes more (`GF.files.put` from the game's server), and a bare 413 is explained.
  `import --live` and `query --write --live` need `--yes` or the word typed, as `restore` does, and are refused with no
  terminal to ask in; what would be refused anyway (an import too big to send, a query the route refuses) is said before
  the word is asked for. `restore` prints `restored.previous` and the command that undoes it, and its preview shows the
  migrations it rolls back and its warning. `db export --live` picks up an `export-pending` with its bookmark, and
  prints the answer's `note`; one it gave up on is kept (`.gamesfun/export-pending.json`) and the next
  `db export --live` picks it up there instead of starting over. A GitHub Actions credential's 403 on export, import,
  restore, write queries, `files put` and `rm` says these need the owner's own login. An answer over 4 MB, which Studio
  sends as `{"$download": url}` (a signed address in its bucket), is fetched from there without the sign-in and read as
  the answer, so a big `db query --live` prints its rows instead of nothing; a download that failed is said.
- **`GF.files.put` under `xcore dev`** holds a stream to exactly its `{length}`, and reads one with none up to 1 MB,
  as the platform does. A missing local file answers `not-found`. A file named `__proto__`, `constructor` or
  `toString` is a file like any other.
- **The secret scan** misses nothing the unbounded scan caught: a JWT is matched up to 4,096 + 16,384 + 2,048
  characters and a `*_SECRET` literal up to 16,384 (`MAX_MATCH` 32 KiB, under the 64 KiB overlap); before, a
  service-role JWT with a payload over 1,000 characters went through.
- **`.gamesfun/` keeps itself out of git**: xcore writes `.gamesfun/.gitignore` (`*`) when it writes there and finds
  none, so `db export`'s dumps of players' data are not committed. It comes back when deleted, so its own words say
  to change it instead (`!publish.json` commits that file); one you changed is left as you wrote it.
- **0.1.0's server code over the new `database.js`:** `xcore add database`, bringing a 0.1.0 `server/database.js` up
  to date, and then every publish list each `dataOf(env)` call in the server's code whose `get`, `put`, `add` or
  `delete` names no owner (it now means the server's own space) and each `list` that passes an `offset`, as
  `file:line` with the change to make. See "Upgrading from 0.1.0" above.
- A `server/database.js` whose `RULES` are still 0.1.0's default is said to be open to anyone at publish, with
  `xcore add database` to fix it. `xcore add database` over a `server/database.js` asks first whether there is room for
  its Durable Object (8 a server), so a refusal leaves `database.js` as it was. The paging cursor's order is by when a
  document was last written (one written between two pages can show twice or be skipped): said in `docs/SERVER.md` and
  `gf.db`'s comments. The local files origin is cross-origin to the page but the same site (both `127.0.0.1`); live it
  is another site as well.

Project files (STORAGE.md §8.6–8.8):

- `env.GF.files` (`put`, `get`, `head`, `list`, `delete`, `usage`) in the contract's `GF_METHODS` and under `xcore dev`, with
  xgames.fun's path rules and caps (25 MB a file, Free's 100 MB); the files are kept in `.gamesfun/dev/files/`.
- `xcore dev` serves the public files on a port of their own, with the files domain's headers (nosniff,
  `sandbox; default-src 'none'`, CORP cross-origin, `*` CORS, no referrer), its types (media, fonts, JSON and text
  inline; anything else a download), ETag and one range; the page's policy lets it load pictures, sounds, fonts and
  data from there, as the play edge does for `<slug>.xgamesusercontent.com`.
- `xcore files ls|put|get|rm|usage`, here or `--live` through xgames.fun's owner routes, refused in words while
  `/api/kit/me` does not list `"files"`; publish refuses a server that uses `env.GF.files` until it does.

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
