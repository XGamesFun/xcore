# Changelog

All notable changes to `@xgamesfun/xcore` (the `xcore` command), newest first. Versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

Fixes from a usability run of 0.12.0 (a new developer's first hour).

- `xcore loot …` piped into a reader that stops early (`| head`) ends quietly instead of crashing with EPIPE.
- Paths in hints are the ones you typed: `xcore loot approve game/xsolana.json` says `(game/xsolana.json)` in its
  header, and `xcore loot add game` says `dev game`, `loot check game/xsolana.json` and
  `loot approve game/xsolana.json`, not `.` and a bare file name.
- A root-path finding in a built game names the source line (`src/main.js:7 (built into dist/assets/index-….js)`), not
  only the hashed bundle. The Vite fix says what to write when there is no `vite.config` yet.
- `xcore check` writes `evidence/.gitignore` (`*`), as `.gamesfun/` has, and its last line says the evidence is never
  published and kept out of git.
- The first-session walk counts play that starts as the page loads (a score posted before any tap): "reaches play as the
  game loads, with no tap", not "in 1 tap" after a Play again.
- `xcore dev` sends `/` to `/game/` instead of answering 404.
- `xcore add leaderboard` (or saves, scores, login, db, rooms) says what it comes with: `xcore add signin`.
- `add signin` no longer says every call is listed at the top of the game's `gamesfun.js`, which is minified: it, and the
  file's first line, link the readable source.

## 0.12.0 — 2026-11-24

Clearer output and documents, a stricter review, and a confirmation before a first publish, from four outside
reviews. No price or limit changed. **Breaking** marks a change that can stop a script, an import or a flow that
worked with 0.11.0.

**Ships with `@xgamesfun/solana` 0.29.12** (`xcore loot …`): its usage mistakes exit with code 2, `xsolana connect`
sets up the current project by default, and its named commands print for a person (`--json` is unchanged). Its
changelog has the rest.

**Breaking**

- **`xcore review` has a third verdict, INCONCLUSIVE, with exit code 3** (`ok: false`, `verdict` in `--json`). A payout
  the review could not read through used to PASS with "1 part not read": env handed to code it did not follow, a
  keeper report whose winners its callers decide, or a PAY.check that reads what it was handed by a computed key
  (`ctx['bo' + 'dy']`, `ctx[k]`, `{ [k]: req } = ctx`, `Reflect.get(ctx, k)`). A computed key is never taken as state
  the server keeps. A high finding is still FAIL (exit code 1); PASS is 0. Each payout entry in `unread` has
  `payout: true`.
- **The first publish of a folder asks first.** It creates a game on the account this computer is signed in to and
  takes one of its slots, so it prints the account, the game's name and the slot, and publishes nothing. At a
  terminal, type `publish` to go on; otherwise run it again with `--yes <code>` (`--json`: `planned: true`, with
  `code` and `next`). Publishing a folder already linked to its game is not asked, nor is a GitHub Actions job's OIDC
  publish.
- **One public entry point.** `exports` was every module (`./*`, `./publish/*`, `./server/*`, `./commands/*`). It is
  now `@xgamesfun/xcore` (`adopt`, `check`, `publishCheck`, `publishStatus`, `PLAN_LIMITS`, with types in
  `types/index.d.ts`; [docs/API.md](docs/API.md)) and `@xgamesfun/xcore/package.json`. Any other subpath fails with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- **`xcore connect` sets up the current project only.** It used to copy the skill into every project (the user's
  skills folders). By default the skills now go in the project's `.claude/skills/` and `.agents/skills/`, and Claude
  Code registers the tools for that project. `--scope user` does what it did before.
- **Default output is shorter.** `check`, `review`, `dev`, `add` and `loot add` print a verdict, one line per finding
  and at most three next steps; `--verbose` prints the rest, as before. A script that read their text should read
  `--json`, which is unchanged and complete. Measured on sample games: `review` 35 lines to 13, `check` 25 to 8, `dev`
  8 to 4.
- **`xcore review` takes a player's saves and the page's `GamesFun.db` documents as player input, never as state the
  server keeps.** A PAY.check that paid on `body.score` and also read `env.GF.saves.get(…)` passed; it is now the
  high finding `payout-input` (FAIL, exit code 1), as is a check that pays on a save alone. A check whose payout state
  the server keeps decides is judged as before.
- **`xcore review` counts state only when it decides, and follows state back to who wrote it.** A read whose answer
  no condition and no answer uses (`await db(env).first('SELECT 1')`), or a query with no table, is no state: the
  check is read as deciding on the request or the sign-in, and a declared `"decides"` or `"replays"` it does not do is a
  high `payout-trust` finding (it was a match). A table or KV namespace the payout reads that a route of the game's
  own writes from a request (`INSERT … VALUES (?, ?)` with `b.startedAt` from `request.json()`, `env.RUNS.put(b.runId,
…)`) is player input: the high finding `payout-stored-input`; a write the review can't place in a function is
  INCONCLUSIVE. A round new on every request (`crypto.randomUUID()`, `Date.now()`, `Math.random()`) is a high finding
  when no per-person or per-wallet limit bounds it (medium when one does). An amount the request names is high (it
  was medium). An alias of what the check is handed (`const req = ctx`) is followed.
- **An economy the review could not read is never a PASS.** A spec its own review did not run on makes the verdict
  INCONCLUSIVE, and a spec the economy check refuses is high findings, one line each in its own words (it was printed
  as a cut JSON blob).
- **Subcommands are named one way in every group.** `list` and `remove` are the names (`files ls` and `rm`, and
  `secret delete`, still work as aliases), and the game's folder is the last word or `--dir <folder>` in `secret`,
  `db`, `embed`, `domain`, `plan` and `coin` (`files` takes `--dir` only). A word that is no subcommand is a usage
  mistake that names the subcommands, never "no such folder" (`xcore embed lst` said "lst: no such folder").
- **Usage mistakes say what was wrong and exit with code 2**, followed by the command's usage lines (not its whole
  help). `xcore backend <word>` that is not a command, and a `--url` that is no address, exited with 1 and now exit
  with 2.

**Added**

- `xcore loot --help` lists every command of the installed `@xgamesfun/solana` (read from it, so `handover` is
  there), and `xcore loot <command> --help` is that command's own help.

- [docs/FEES.md](docs/FEES.md): every cost in one table (hosting, the $15 paid slot and what it includes, usage
  credit, coin launches, loot's fees, randomness, Metaplex), and docs/HOSTING.md's "Your game's data, and getting it
  out" (player saves and leaderboards are not in `xcore db export`).
- Publish makes a missing preview picture from the page check's newest screenshot (`evidence/verify-N/desktop.png`,
  960×960, a JPEG under 1,500,000 bytes), and says so in one line with how to replace it. It still stops when there is
  no screenshot, or for a picture xgames.fun cannot draw.
- `--verbose` on `add`, `loot add`, `check`, `review` and `dev`; `--scope project|user` on `connect`.
- A Names table in the README (xgames.fun, gamesfun, xcore, `@xgamesfun/solana`, xsolana, solana-kit, loot, Studio).

**Changed**

- The economy's page client in `gf/loot/` is bundled and minified: 7 files, about 0.5 MB, in place of 66 files and
  1.3 MB. `play/index.js`, `chain/rpc.js` and `wallets.js` keep their paths, so pages import them as before. Running
  `xcore loot add` again refreshes it; publish does too.
- The `gamesfun.js` copied into a game is minified (132 KB to 47 KB; 17 KB gzipped), with a banner naming its version
  and the readable source the package keeps. A copy from 0.11.0 is the same code unminified and still counts as
  current.
- `.dev.vars` goes into the folder's `.gitignore` as soon as `add vouchers` or `add rpc` uses it, even in a folder
  that is not in git yet, said in one line.
- adopt and check findings are one line and a short fix. A path from the root names only the setting for the framework
  adopt detected (every framework's: docs/HOSTING.md, "Paths from the root"). A `.env` is listed once. check's summary
  reads "3 passed, 1 skipped", and the upload count names the two records xcore adds.
- Printed commands are ones that run this package: `npx -y @xgamesfun/xcore@<version>` (through npx or a project
  install; never the unscoped `npx xcore`, another package), `xcore` installed globally. The README's npx examples
  name the version too.
- Output is written to the person reading it: review.md's lists are "Questions to decide" and "What this build allows",
  its last section is "What a cheater gets, and the trade-offs", and it is titled "Payout and key review". check's walk
  ends with "In short". `review.json`'s `ask` and `tell` are unchanged. Directions for coding agents are in the skill.
- No message tells you to install `@xgamesfun/kit`, which is not on npm; a kit command says the game-making kit is
  not released yet.
- The page's database API is named `GamesFun.db` everywhere; `gf` in examples is the same object.
- Every `--help` has a usage line, a one-line description, options and limits; the README and docs/ are rewritten in
  plain English with every fact kept. `xcore review` is described as a pattern-based check, not a security audit.

**Fixed**

- `xcore connect --dry-run` starts no agent's program (it ran `claude --version` and `claude mcp get`, which can write
  `~/.claude.json`) and says each step as what it would do (`"action": "would-copy"`).
- The key file owns an economy until it hands it over with `xcore loot handover` (0.29.12); docs/ECONOMY.md,
  docs/DISCLAIMER.md and `xcore loot` said it owned it permanently. For real money, the docs name a browser wallet
  that keeps its key on a hardware device as the safer owner, as `@xgamesfun/solana`'s README does.
- `xcore adopt` finds a literal address the code calls (`fetch`, `XMLHttpRequest.open`, `WebSocket`, `EventSource`,
  `sendBeacon`) even at a host it otherwise ignores as noise (`fetch('https://api.example.com/score')`).
- The full-screen hint gives the direct fix (`element.requestFullscreen()` from a click) before the client's.
- CHANGELOG.md is in the package.
- FEES.md: Metaplex Core's 0.0015 SOL creation fee goes to Metaplex's fee collector (it said the account kept it); the
  README's costs name the ~0.0031 SOL an item minted as an NFT costs.

- Sign-in is X or Google, as the client does it; a Solana wallet linked to the account comes with the sign-in. The
  README and `xcore add --help` said "X first, or a wallet".
- HOSTING.md's engine export limit is 100 MiB, as the code holds it.

## 0.11.0 — 2026-11-23

Fixes from a read of the whole package: places where a command passed, or went ahead, on something it could not read,
and output and documents nobody had read as a reader. Four changes can stop what 0.10.7 let through; they are marked.

**Ships with `@xgamesfun/solana` 0.29.11** (`xcore loot …`): `check` refuses a spec the other tools cannot build, the guide
and the examples agree with `check`, and `units()` refuses an amount it cannot read exactly. Its changelog has the rest.

**`xcore review`**

- **Changed: the review says how it reads a game and what a PASS means, under every verdict** (on screen, in
  `review.md` and in `--json`'s `method`). It reads the server's code as text, by patterns, and runs none of it. A
  PASS is no proof that a game is safe to pay from.
- **Changed: what it could not read is listed beside the verdict and does not pass quietly.** A `PAY.check` whose
  answer comes from code the review could not follow is a high finding (`pay-unreadable`). An `xsolana.json` or
  `gamesfun.json` that is there but is not valid JSON is a high finding (`file-unreadable`); it was a clean PASS.
- `PAY.check` is read by the names its own parameters give (renamed, destructured, or handed to a helper in another
  server file). A word in a message, a comment or a regular expression, a fetch whose answer is unused, and a setting
  read from env no longer change the verdict.
- A route that pays with `voucherFor` is in the payout ledger, and the review no longer says such a game "pays nothing
  yet". `token-any-game` fires in games that use xcore's voucher template. With several grants in one check, each
  grant's amount and wallet are read from the answer that names it.
- The counts say "1 route", "1 paid route", "1 key".

**A file that does not parse is never read as a missing one**

- **Changed: a `gamesfun.json` that is not valid JSON is refused by every command**, with its name and the parser's
  reason. `xcore check` said "run adopt first", and `dev`, `add signin` and `card` went ahead. The same for
  `xsolana.json` (or `loot.json`) and `backend.json` wherever a command reads them: `add vouchers` and `add rpc` refuse
  before writing anything, and `secret set VOUCHER_SEED` before the live key is replaced.
- A damaged `.gamesfun/publish.json` was read as "never published", so the next publish would have made a second
  game. Publish and every command that needs the game now stop and say how to put the record back. The file is written
  whole and moved into place, so an interrupted publish cannot cut it short.

**Live project files**

- **Changed: `xcore files rm --live`, and `xcore files put --live` over a file that is there, ask first.** xgames.fun
  keeps one copy of a project file and no earlier one, so a file deleted or written over is gone for good. Both print
  what would be lost with a code and change nothing; the same command with `--yes <code>` goes on, as for live database
  and secret changes. A new path is put at once. `xcore files get <path> --live` keeps a copy first.

**Checks and messages**

- `xcore check` answers on a page whose script never yields (`while (true) {}`): check 3 fails as "the page stopped
  answering" within about a minute, and no browser is left running. `xcore card` and the first-session walk say the
  same in words.
- `xcore plan` told the owner of a capped game its server "answers slowly"; it is switched off (every `api/` request
  answers 451), as the help and the docs say.
- Every size is on one scale, the one the limits are set in (1 MB = 1,048,576 bytes): the live request limit is
  4.3 MB everywhere (`db` said 4.5). A small game is "2.3 KB", not "0.0 MB", and one file is "1 file".
- `xcore check` and `xcore adopt` name `xcore dev` where they said "the kit's dev server". The first-session walk
  speaks of a first reward, a wallet and SOL only for a game with an economy. `xcore dev --port 80` says which port it
  could not take and why.
- **Changed: a usage mistake prints on stderr and exits with 2**, for every command: bare `xcore` (was stdout, exit 1),
  an unknown command, `xcore loot` with no subcommand, and `xcore coin`'s bad flags (were 1). Every `--json` failure
  carries `code`; `check --json` and `adopt --json` carry `ok`, `error` and `code` when they fail.

**In the files a game carries**

A game picks these up when `xcore add signin` (and `add multiplayer`) writes its copies again; `xcore check` says when
a game's copy is older.

- A player who was never there stayed in a room: one connection that said hello twice, or closed while its sign-in was
  checked, was announced and never left. A connection now has one seat (`server/rooms.js`). A room address that is not
  valid text answers 400, not 500.
- Large room messages sent in the same frame were all dropped: `room.send()` counted every JSON message as 64 bytes.
  Each is counted by its real size, sent as it was when `send` was called, and one that cannot be JSON is reported in
  the console instead of losing the frame.
- A save key or board name that worked on localhost failed once published: the client took 64 characters and no dot,
  xgames.fun takes 1 to 32 letters, digits, `.`, `_` or `-`. The client holds xgames.fun's rule, and a test holds the
  two equal.
- An error thrown in a game's own listener (`gf.onChange`, `room.on` and the others) is reported with `console.error`;
  it vanished. The game still plays on.
- Godot and Unity, outside a web export: `GamesFun.sign_in()` kept an error as the player, so `is_signed_in()` was
  true in the Godot editor; Unity's `SignIn()` returned an error. Both now answer nobody.
- `xcore add signin` names what the Godot and Unity plugins have (`GamesFun.player` and `player_changed`;
  `GamesFun.Player` and `PlayerChanged`); it named a `ready` neither has. `add database` and `add multiplayer` print
  their own steps, and the sign-in's only when they added it.
- The payout example in `server/vouchers.js` uses the database a new game gets (`db(env)` from `server/gf-db.js`).

**Documents**

- The README's example for a backend of your own was refused ("must be a public name"); it uses an address the command
  takes.
- Paying with the server's own key is told in one order: `docs/SERVER.md` ("Your own key") has the steps, and the
  README and the skill give the same order and point there.
- Corrected: where a new game's database rules are (`gamesfun.json` → `database.collections`), what `signIn()` and
  `signOut()` answer, `env.GF.scores.list()`, how to wire a mainnet economy into a page (`gf/loot/wallets.js`'s
  `cluster`, `pageRpc`, `chainOf`), Miniflare's size (about 180 MB), and `xcore coin launch --symbol` and
  `--description`.

**For contributors**

- Tests hold eleven safety behaviours a one-line change could break unseen: the saved sign-in's file mode, the sign-in
  callback's `state`, the dev host's socket guard, `nosniff`, each name the secret scan reads, the publish limits, the
  direct upload and others.
- A test run leaves no folder in the temp directory, and on a machine with no browser it ends by saying how many
  browser tests did not run and how to get one.

## 0.10.7 — 2026-11-23

Mainnet voucher servers pay, a new voucher key keeps the people already counted, banned players are refused at once,
and two sign-in races are fixed. Ships with `@xgamesfun/solana` 0.29.10 (was 0.29.3); loot 0.29.0 and every live
economy are unchanged. Includes 0.10.4 to 0.10.6, which were not published.

**Breaking**

- Publish refuses a mainnet game whose server names no cluster (in `server/vouchers.js` or a file of its own): such a
  server read every grant at its devnet address and refused every payout. Run `xcore add vouchers` again; it keeps
  `PAY`, `VOUCHERS` and the settings at its top.
- Rooms no longer pass a player's wallet to the others in the room, only their id and X handle.
- Publish refuses a published folder that is a link to outside the game, as it refused links inside it.
- `xcore check` and `xcore dev` leave out what publish leaves out (`node_modules`, the maker's notes, the top folders
  publish skips), so a page that loads one of them fails there as it would live.

**Added**

- `xcore secret set VOUCHER_SEED --new-key` points the grants at the new key. It writes the live key's address into
  the grants the server pays (those that name a voucher key, and those `PAY.check` names, however it names them),
  makes it the economy's issuer where a grant counts people (unless you chose another), and on mainnet takes the test
  key out. It says each change and what it left. `xcore loot approve` puts it on chain; no address is copied by hand.
  Setting `VOUCHER_SEED` from `.dev.vars`, a file or typed does the same.
- `xcore add vouchers` points the grants at the live key made before and, on devnet, adds the test key, so claims
  under `xcore dev` pay with no address copied.
- `xcore dev`: a local player stands in for one signed in with X, so a grant that counts people and
  `VOUCHERS.payOnly: 'x'` can be tried; `XCORE_DEV_SIGNIN=wallet` signs them in with a wallet only.
- `xcore review` says when a grant that counts people has the test key as the economy's issuer (every claim the
  hosted server pays is then refused), asks which key is the issuer when a grant names several, reads
  `perWalletEach`, and counts a grant capped by `limits.tokens` as bounded.

**Changed**

- The voucher server, the database (`api/db`), `withPlayer` in `server/gf-db.js` and rooms refuse a banned player
  themselves. Before, a token made before a ban was served until it expired, up to an hour. A player who is only
  hidden is served as before.
- `xcore dev` with no `--port` takes the first free port from 8787, so a second game can run beside the first.
- `xcore secret set XSOLANA_RPC_URL` checks the URL (its network, https) before anything is set or replaced. When its
  origin is not in `backend.json` yet, it adds the origin and sets nothing: publish, then run it again.
- `--json` failures always print JSON: `xcore check` and `xcore dev` on a game the kit made, `publish --check` when the
  build fails (`code: "build"`), `xcore loot`'s own refusals and a kit command with no kit (`code: "no-kit"`) print
  `{ "ok": false, "error", "code"? }` on stdout, and their stderr line starts with `xcore:`. The exit code is still 1.
- Sizes are given in the unit the limits are set in (1 MB = 1,048,576 bytes): `files put --live` says "at most 4.3 MB
  a request" (was 4.5, in millions of bytes).
- A game's `gf/loot/` copy has more, smaller files (65, was 29, about the same size).
- From `@xgamesfun/solana` 0.29.4 to 0.29.10: a shop item's per-person limit goes live as written (0.29.3 put it live
  with no limit); a change to a live economy publishes every part it changes, never reuses a removed part's id, and
  keeps "publish+7d" times where they were; `check` refuses what the program refuses, including a change to what
  can't change once live; draws, lottery places, halving, rising prices and farm rates are simulated as the program
  pays them; the approval reads an NFT's collection and a coin's decimals and token program from the chain.
- Upgrading a game whose `server/database.js` came from xcore 0.1.0 is in docs/UPGRADING.md.

**Fixed**

- A new voucher key made every player a new person, so each `perPerson` grant would pay everyone again. The server
  now keeps the key that names people in its own storage (derived as before, so the people a live server counted stay
  the same). Nothing to set.
- `xcore add vouchers` run again keeps helpers and constants written beside `PAY`, and a new setting's whole default
  value (a list was cut at its first comma). It keeps `.dev.vars` out of git when the game sits in a monorepo's
  subfolder.
- `xcore adopt` run again keeps the game's `page.title`.
- `xcore review` no longer counts a setting read from `env` (`env.MIN_SCORE`) as the server keeping state.
- `xcore check` names a game's own-server calls in a fixed order, not the order the browser made them.
- A booster comes off a token farm through the page client.
- Sign-in in `gamesfun.js` (a game picks it up when `xcore add signin` writes its copy again): a game back in view
  asks who is signed in as soon as a look already on its way is answered (it waited two seconds more); the sign-in
  window could stay on xgames.fun's `/go` page, and now goes on once it has opened (at most 5 seconds).

No behaviour changed otherwise: internal modules were split and tidied.

## 0.10.3 — 2026-11-22

Mainnet economies are quoted at mainnet's fees. Ships with `@xgamesfun/solana` 0.29.3; loot 0.29.0, every spec and
every live economy are unchanged.

- Fixed: `check`, `simulate`, `cost` and `explain` quoted every economy at devnet's player fee (0.002 SOL), so each
  mainnet player action was quoted 0.0015 SOL high. Mainnet's player fee is 0.0005 SOL. Only the quotes were wrong:
  the program always charged what its platform account holds.

## 0.10.2 — 2026-11-21

The economy skill loads in strict readers again. Ships with `@xgamesfun/solana` 0.29.2.

- Fixed: in 0.10.1 the skill's `description` had a `: ` in it, which strict YAML reads as a mapping, so
  `xcore connect` could leave an agent without the `xsolana-economy` skill. Run `xcore connect` again after updating.

## 0.10.1 — 2026-11-21

Wording and listings. Ships with `@xgamesfun/solana` 0.29.1 (the tools alone; loot 0.29.0 is unchanged).

- The economy's tools say "the game keeps 38% of each price" where they said "the house keeps", and every `xsolana_*`
  tool has a title a person can read. Every warning about the law is as it was.
- The README says what xcore is for (host a web game you already made, with a backend and a Solana economy), the
  stacks it takes and what a game gets, with a "Questions people ask" section and links to xgames.fun/xcore.
- On npm: 28 keywords, and the homepage is `https://xgames.fun/xcore`.

## 0.10.0 — 2026-11-21

Changes that can't be undone ask for a code, `xcore connect` sets up an agent, `xcore review` reads more of a server,
and economies move to loot 0.29.0. Ships with `@xgamesfun/solana` 0.29.0 (was 0.28.17).

**Breaking**

- `xcore db query --write --live`, `db import --live` and `db restore --live` print exactly what they would change
  (the statement and its params; the file's name, size and SHA-256; or the time and what it goes back to) with an
  8-hex code, and change nothing. Run again with `--yes <code>` to go on; a code printed for another change is refused.
  A bare `--yes` is now a usage error. Typing the word (write, import, restore) at a terminal still works. With
  `--json` the printout is `{planned: true, code, plan, next}`.
- `xcore secret delete <NAME>`, and `secret set <NAME>` when the live server already has that name, print what they
  replace or remove (never a value) with a code, and act only with `--yes <code>`. A new name is set at once.
  `--new-key` over a voucher key says the old key is gone for good and what that breaks until the grant names the new
  address.
- loot 0.29.0 reads no project, grant, lottery or order that 0.28 made: an economy live before goes live again
  (`xcore loot approve`).
- A grant that counts people needs the live voucher key as `"keys": { "issuer": … }`, since loot counts the person a
  voucher names only when the issuer signed it; `xcore loot check` refuses one without. Such a grant counts people or
  wallets, not both. `xcore review` flags a per-person grant whose issuer does not sign its vouchers.

Publish, domains, embeds and `plan activate`/`deactivate` need no code: each can be undone.

**Added**

- `xcore connect` gives Claude Code and Codex the bring-your-own-game skill and everything `xcore loot connect` does,
  then prints a few lines to paste into a project's AGENTS.md or CLAUDE.md. It writes nothing into the project.
  `--dry-run` says what it would do.
- New `xcore review` findings: `pay-unreadable` (high) for a `PAY.check` that is commented out or gone, which passed
  before while every claim failed; `paid-read-open` (medium) for a `winPaid` whose failure answers "not paid", which
  lets a server sign a win twice. The summary prints each question for the person, not only their count.
- `xcore check`'s first-session walk says when it stopped before a first reward, and what claiming one asks.
- From `@xgamesfun/solana` 0.28.18 to 0.29.0: limits per person on any part (`perPerson`, `perPersonEach`) with
  `keys.issuer`, tickets a grant gives, a cap on a grant's tokens (`limits.tokens`), a server's own rules in
  `offchain`, `serverLimit.claims`, `approve --mint-key`, a short first guide call, and a player's step that leaves
  room for what Phantom adds, so Phantom on mainnet no longer warns that the page could be malicious. A project handed
  to a new owner is theirs to change.

**Changed**

- `xcore review` reads a `PAY.check` through the file's own functions it calls; follows a multiplier's condition
  through what the server stores, its helpers and modules `server/` imports from outside it; and reads a cap held in a
  helper, in a ranking's top N or as a count against the declared number. It drafts an undeclared code, streak or
  server-kept count as an `offchain` rule (`{ "takes": "a code", "gives": "grant:pops", "rate": 2 }`).
- The bring-your-own-game skill is trimmed to its method (about 12,400 characters, was 31,832), with per-case detail
  in its `references/`.
- Errors name the next step: `xcore plan --json` refusals carry `code` and `next`; `xcore loot … --json` passes the
  economy tools' JSON on untouched; an unknown command is told the nearest command; `xcore loot connect --dry-run`
  shows the MCP command it really registers.
- adopt's fixes that declare a backend name the game's folder, so run from a parent folder they write into the game.

**Fixed**

- `xcore plan --help` said a capped Free game's server is "capped (slow)": it is switched off until the month ends
  (every `api/` request answers 451). Pages keep loading; saves and scores slow down.
- Windows: a printed re-run command with a quote in it runs when pasted.

## 0.9.1 — 2026-11-14

A coin that trades (`xcore coin`), economies on mainnet, going live with a key file, a preview card at publish,
sign-in on a game's own host, and a page check and review built around how a game plays and pays. Ships with
`@xgamesfun/solana` 0.28.17 (was 0.26.0), for loot 0.28.0. Includes 0.4.1 to 0.9.0, which were not published.

**Breaking**

- loot is at its official devnet address, `xgamesVsZBpCVgJuatfYAFJRmQoccfQf5qtUFNp2Eet`. Nothing set up under the old
  one (`9cwq…7NFQ`) exists under it: an economy from before goes live again. A `server/rpc.js` written before names
  the old address in `scanPrograms`: put the new one first, or the game's own RPC refuses the economy's transactions.
- `xcore publish` stops when the game has no preview picture xgames.fun can draw (`assets/card.jpg` or
  `assets/card.png`). Make one with `xcore card`, publish with `--no-card`, or put `"card": false` in `gamesfun.json`.
  A GitHub Actions job stops the same way. With `--json`: `"code": "card"`. `--draft`, `--status` and `--check` do not
  stop for it.
- Plain `xcore loot approve` opens nothing: it says the two ways and stops. Use `--keypair <keyfile>` (the usual way)
  or `--browser` for the page.
- `xcore loot approve` sends through `XSOLANA_RPC_URL` when set, else Solana's public devnet RPC, no longer through
  xgames.fun's relay, which refused about one in eight of a setup's transactions. Other `xcore loot` commands still
  read through the relay.
- On a game's own host (`https://<name>-play.xgames.fun/`, as the whole tab), `GamesFun.signIn()` sends the tab to X
  (or Google) and back, so the page loads afresh and whatever the game held in memory is gone. To keep the window:
  `GamesFun.signIn({stay: true})`, `globalThis.GAMESFUN_SIGNIN_STAY = true` before `gamesfun.js`, `data-signin-stay` on
  its `<script>`, Godot's `sign_in("x", true)` or Unity's `SignIn("x", true)`. Read the player from `GamesFun.ready`
  and `GamesFun.onChange`, not only from what `signIn` answers. Run `xcore add signin` to update a game's copy.

**Added**

- `xcore coin [game]` and `xcore coin launch --name … --ticker … --picture <file> --keypair <keyfile>`: a coin that
  trades, on Meteora or pump.fun through xgames.fun's launchpad, signed by a key file. The first run prints the whole
  launch and a code and sends nothing; `--yes <code>` launches it. `--venue` and `--pair` choose the venue and what it
  trades against (default Meteora, SOL); `xcore coin drop` gives up a launch never sent. `--cluster mainnet` launches
  the real coin where xgames.fun has mainnet launching on; its plan opens with "MAINNET: REAL MONEY".
- Before the key signs, every launch transaction is held to the printed plan: the venue's launch instructions only,
  the plan's name, ticker and link byte for byte, this key as creator, no buy, nothing that names loot, no lookup
  table and at most 0.1 SOL of the key's own in fees. The cluster is checked through your own RPC or Solana's public
  one, never xgames.fun's. Anything else is refused and nothing is signed. The picture, the description and Meteora's
  curve shape are not read, and the plan says so.
- A coin's creator keeps at least 90% of its fees: pump.fun's creator fee is shared 90/10, and on Meteora the creator
  gets 90% of the trading fee left after Meteora's cut and 90% of the graduated pool's locked liquidity. `xcore coin`
  refuses a launch that gives the key less than 90% of any of these.
- Economies on mainnet: loot runs there at `xgames8C758PyweWB9sDw8evvwsTVwyA2fGRUeAXVPy`. An economy is on devnet
  unless its `xsolana.json` says `"network": "mainnet"`, where it is real money; loot is not independently audited. On
  mainnet, `xcore loot`, `xcore review` and `xcore dev` need an RPC of your own (`XSOLANA_RPC_URL`): the relay answers
  only a published game's signed-in players. The page asks the wallet for `solana:mainnet`, and `xcore add rpc` takes
  a mainnet URL. `xcore loot approve` on mainnet opens its printout with a line saying it moves real SOL and real
  tokens, and its code starts with `mainnet-`.
- `xcore loot keygen <file>` makes a key file for an economy, outside any repository, and prints its address, never
  the key. `xcore loot approve --keypair <keyfile>` prints everything going live would send with a code; `--yes <code>`
  sends exactly that. The key file is the project's owner for good: whoever can read it controls the project, and
  nothing restores a lost one.
- `xcore loot approve --browser` takes a transaction Phantom signed with its own checks (Lighthouse instructions)
  added, when nothing prepared was changed; anything else is still refused.
- `xcore loot token <mint>` reads a coin made elsewhere and prints its `tokens` entry, with what its mint's keys can
  do. A token the economy makes is named on chain as it goes live; its name, ticker or picture link can be changed
  later by editing `xsolana.json` and running `xcore loot approve` again.
- `xcore card [dir]` writes `assets/card.jpg` at 960×960: a picture of the game as it plays in Chrome (`--wait`,
  `--tap`, `--path`), or `--from <picture>`. It never replaces a picture without `--force`. Publish checks the picture
  it will send: it stops for one xgames.fun can't draw (over 1,500,000 bytes, not a baseline or progressive JPEG or a
  PNG, misnamed, cut short or damaged) and warns of one under 600 px a side or far from square. `publishCommand` and
  `publishGame` take `card` (`false` turns it off).
- `gamesfun.js` 1.9.0. A game opened as the whole tab on its own host (from a post's card on X, or in a wallet app's
  browser) asks xgames.fun who is signed in as it loads and signs that player in with no tap (`GamesFun.ready` waits
  1.5 s at most). `GamesFun.signInLink('x')` gives the address for a game's own button; `GamesFun.signInEnded` says a
  sign-in was cancelled or failed; `GamesFun.signOut()` tells xgames.fun to forget the game in that browser. It asks
  at most twelve times an hour, never on a timer. In a frame other than the play page it asks nothing and signs in
  with a window, as before. `xcore dev` imitates all of it, and `GamesFun.signIn({name: 'Ana'})` signs a named dev
  player in at once.
- Opening the game in a wallet app for a claim: `GamesFun.canOpenWallet()`, `GamesFun.onCanOpenWallet(fn)`,
  `GamesFun.walletNeeded()` and `GamesFun.openWallet(app, {view, href})` (`'phantom'`, `'solflare'` or `'browser'`),
  inside the play page and as the top window on the game's own host. Under `xcore dev` there is no play page, so
  `openWallet` answers `no-page`. The Godot and Unity glue have no calls for these yet.
- With loot 0.27.0: a hold, loan, listing or prize whose NFT is gone (taken or burned by whoever controls its
  collection) can be closed: `claims()` lists it and `closeGone(asset)` closes it. A deposit clears what an earlier
  owner left instead of refusing. Buying or renting a gone listing is refused in words.
- `xcore check` tests the page inside the play page's sandboxed frame, with a query string, and fails a pop-up, a
  form submit or top-level navigation. It walks a first session as a new player on a phone (up to 6 taps in about
  45 s, or the path in `gamesfun.json` → `journey`) and reports taps, sign-in, wallet and SOL needs, and waits.
- `xcore review` reads payouts by lens: a payout ledger (each paying route: who signs, what decides it, its ceiling)
  and key custody replace thirteen per-case findings. `review.md` opens with "Ask the person" and "Tell the person, as
  written". "Design and code" compares what the economy declares the server does (`offchain`, `serverLimit`) with
  `server/`, and drafts the missing declarations.
- docs/BEFORE-YOU-BUILD.md: one method for anything that touches money, a token, or a flow a player taps through or
  can't undo: challenge before you build, then six lenses in every state as a player, the owner and a cheater.
- From `@xgamesfun/solana` 0.28.7 to 0.28.17: tickets and the entry they cost in one approval (`buyTickets`' `make`),
  the deep checker's "Ask the person" and "Tell the person" lines, `xsolana_design`, and `serverLimit`.

**Fixed**

- adopt no longer reads `gamesfun.js`'s own `api/` paths as the page calling its own `api/`.
- Going live that was cut short finishes when it is gone on with. A transaction the network took, whose answer was
  lost, is no longer sent again (a setup's seeds could be paid in twice). A browser wallet that adds its own priority
  fee can approve.
- `claims()` behind the play host's relay listed none of a player's refunds.
- A game's server folder reached through a link (as macOS's temporary folders are) has its refusals name
  `server/index.js` again.
- `xcore dev`'s install lock is no longer taken from a live install on the same machine; it is stale after 30 minutes,
  and the refusal says how to clear it.

## 0.4.0 — 2026-11-10

xcore refuses at build time what xgames.fun refuses at publish, and `xcore dev` behaves like the platform on a plan.
Ships with `@xgamesfun/solana` 0.26.0, for loot 0.26.0.

**Breaking**

- Server bundles that import, re-export or `import()` `cloudflare:sockets`, `node:net`, `node:tls`, `node:dgram`,
  `node:http2`, `node:module` or `node:child_process`, that `import()` a name made at run time, or that need
  `nodejs_compat` (so every `node:` import a bundle still uses) are refused, as xgames.fun refuses them. A
  `gamesfun.json` that asks for `nodejs_compat` is refused in words.
- Programs, installers and archives other than `.zip` are refused at publish, before anything is sent.
- `xcore dev` enforces the Free plan by default (`--plan creator|scale` for another): 8 boards and 16 rules (it allowed
  16 and 32), "high" boards only from a page and two a player, a player's share of save bytes, rates a minute, JSON
  page bodies of at most 96 KB, and for project files a matching type for anything public and 1 MB for a string or
  `ArrayBuffer` body. A public file stored under 0.3.0 is served as a download until it is put again.
- `PLATFORM_LIMITS.scores` in `@xgamesfun/xcore/server/contract` is Free's (8 boards, 16 rules), no longer 16 and 32;
  `PLAN_LIMITS` has every plan's numbers.
- loot 0.26.0: no account of an earlier build carries over. An economy that went live before goes live again
  (`xcore loot approve`), and the next publish brings `gf/loot/` up to the installed package. Many limits of a spec
  written for 0.25 are gone and are warnings now: read the check's warnings again.

**Added**

- `xcore dev --plan free|creator|scale` imitates that plan's refusals and says which plan it imitates. Board reads
  carry per-game player ids with `me: true`; ranks and offsets go to 10,000; `env.GF.scores.list()` works there.
- `xcore login` and `login --status` say whether the sign-in reaches your whole account or which games. A command
  refused because the sign-in was not given that game (`not-granted`) says so, with `xcore login` as the next step.
- `xcore review`: `server-no-token-check` (medium) and `work-before-token` (low) for a server that does work without,
  or before, checking a player's token.
- A first publish (and `xcore check`) says the link name a game will get when xgames.fun leaves reserved words out of
  its title.
- For a game's page through `gf.loot.call`: `endAuction` delivers the lot and pays the seller together; `repay` brings
  the NFT home; `lotteries` and `ticketWeight` show a time-weighted lottery's weights; `unstakeNft` can leave without
  a prize that cannot be given; `collect` can give up a prize the player cannot receive. Before a player hands over an
  NFT of another collection, the page client reads what an earlier owner left on it and refuses in words
  (`acceptLeftover: true` goes ahead).
- In a spec: a lottery's `closesBefore` and `timeWeighted`, a place's `whenShort`, a box's `whenOut: "giveNothing"`.

**Changed**

- Server bundles are checked by parsing the finished bundle, and a refusal names the file it came from. A path esbuild
  can list (``import(`./levels/${n}.js`)``) is bundled and accepted. An import esbuild leaves out of the bundle no
  longer refuses a publish.
- The publish scan's patterns are bounded and linear, as xgames.fun's, and a secret-looking literal longer than 1,024
  characters is no longer refused. A backend origin whose host a page's security policy cannot name is refused.
- A player's id is the account (`x:<id>`, or `g:<id>` for Google, different in every game), never the wallet: `wallet`
  is a claim of its own and may be absent.
- Docs: the list in `backend.json` applies only to the calls a server's entry makes; an unpublished, taken-down or
  capped game's server is switched off (a running room within about five minutes); a backend of your own fetches
  xgames.fun's key set again when a token names a key id it does not hold.

## 0.3.0 — 2026-11-09

Live operations, full screen, sign-in with X or Google, and `xcore review`. `gamesfun.js` is 1.6.0; ships with
`@xgamesfun/solana` 0.25.1.

**Breaking**

- Sign-in is X or Google: a wallet signs nobody in any more (a copycat game could relay that signature). A player
  links a wallet on xgames.fun's account page and it comes with every sign-in. `how: 'wallet'` signs in with X.

**Added**

- `GamesFun.live` (`get()`, `refresh()`, `onChange(fn)`, `banner(on)`, `value`): the game's announcement, remote config
  and maintenance mode, which its owner changes in xgames.fun/console's Live tab with no republish. A default banner
  shows the announcement and a pause; `data-live-banner="off"`, `GAMESFUN_LIVE_BANNER = false` or
  `GamesFun.live.banner(false)` turn it off. A refusal with code `maintenance` is passed on like any other. `xcore dev`
  answers `/platform/v1/live` from `.gamesfun/live.json` and serves the holding page while maintenance is on.
- `env.GF.verifyPlayer` answers `banned` (`{kind, until}` or null). A token made before a ban still verifies for its
  hour, so a server that keeps players (a room) refuses `kind: 'ban'` itself. `xcore dev` always answers `null`.
- `GamesFun.fullscreen()` (and in Godot), from a click, and `GamesFun.onFullscreen`. In a frame that allows none (a
  post on X) it opens the game in a tab of its own. `xcore adopt` warns when a game has no way to go full screen.
- `GamesFun.signIn({how: 'google'})`, Godot's `sign_in("google")`, Unity's `SignIn("google")`, and `player.google`.
- `VOUCHERS.payOnly: 'account'` pays players signed in with X or Google; a Google account with no X counts as one
  person (`g:<id>`) for `perPerson`.
- `xcore review [game] [--live [origin]] [--json]`: a security review of a game, read as a cheater would: the economy
  by `xsolana review`; the server by xcore's own reading (`PAY.check`, `VOUCHERS.payOnly`, the voucher key, `trust`,
  `.dev.vars` in git or in the published folder, a seed in the page, the test key in a grant, every `api/` route); and
  with `--live` the published game asked with no sign-in and a forged one. It writes `evidence/review-N/review.md` and
  `review.json`, and exits 1 on a high finding. `xcore loot review` runs `xsolana review` on the economy file.
- `xcore publish` says when a game that pays through vouchers changed since its last review (it never refuses for it).

## 0.2.1 — 2026-11-09

Slots.

- Every game sits in a slot: everyone gets 2 free slots (games on Free); more are paid (games on Creator) and bought
  on xgames.fun/console. `xcore plan --all` shows them; `xcore publish` names the commands that open a free slot when a
  new game is refused (`no-free-slot`).

## 0.2.0 — 2026-11-09

A database of the game's own on D1, project files, and a document store that is private by default. A game made with
0.1.0 that has `server/database.js` needs the steps below; a game without one needs none.

**Breaking: upgrading from 0.1.0**

1. Run `xcore add database` again. It brings `server/database.js` up to date (your `RULES` and `LIMITS` are kept),
   with `gamesfun.js` (1.4.0) and the Godot or Unity glue, and lists each `dataOf(env)` call that needs an owner (see
   step 3) as `file:line`; publish lists them again until each names one. On its first start the new `database.js` moves
   the documents to a table keyed by collection, owner and id. Do not then roll the game back to a version with
   0.1.0's `database.js`: its writes fail on the new table.
2. Rules are private by default. 0.1.0's unchanged default (`'*': { read: 'anyone', write: 'owner' }`) becomes
   `'*': { read: 'owner', write: 'owner' }`. Name each public collection: `levels: { read: 'anyone', write: 'owner' }`.
   A rule xcore does not know (`read: 'everyone'`) stops the server when it starts.
3. `dataOf(env)` takes an owner. Without one it is the server's own space (owner `"server"`), so 0.1.0's
   `dataOf(env).get('profiles', playerId)` answers 404 and `.put(…)` writes a copy the player never sees. Pass
   `{ owner: sub }` as the last argument of `get`, `put`, `add` and `delete`, or `{ owner: 'server' }`. A `list`
   without an owner is still everyone's.
4. A page reads another player's document by its owner: `gf.db.get('levels', id, { owner: doc.owner })`,
   `GET api/db/<collection>/<id>?owner=<id>`, Godot `db_get(collection, id, {"owner": owner})`, Unity
   `DbGet(collection, id, owner)`. By id alone it is the player's own (or the server's, in a `write: 'server'`
   collection); another player's answers `data: null` with `code: 'owner'`.
5. Lists page with `after`, not `offset`: pass the last answer's `after` (`null` on the last page; `more` says whether
   there is another). Any `offset` but 0 is refused (`code: 'offset'`, or 400 from `GET api/db/<collection>?offset=`
   and `dataOf(env).list`). Unity's `DbList(collection, owner, limit, after, order)` takes `after` where it took an
   `int offset`, so a call that passed an offset does not compile. `LIMITS.offset` is gone.
6. `createData(sql, { rules, limits, now })` is `createData(exec, { rules, limits, now, table })`, where
   `exec(query, ...bindings)` answers the rows or a promise of them. Every call is async and the options come before
   `who`: `get(collection, id, opts, who)`, `put(collection, id, value, opts, who)`,
   `add(collection, value, opts, who)`, `delete(collection, id, opts, who)`, `list(collection, opts, who)`.

**Added**

- A database on D1: `gamesfun.json` → `database` (`engine`, `binding`, `migrations`, `collections`), checked as
  xgames.fun checks it (migration names like `0001_init.sql`, at most 200 of 1 MB, append only: a published migration
  that changed is refused before anything goes up). `xcore add database` writes the block,
  `server/migrations/0001_init.sql` and `server/gf-db.js` (prepared queries, `withPlayer`); a game with no server gets
  xcore's stock server, which serves `api/db/*` from D1 with the same answers, so `gf.db` is unchanged. A game that has
  `server/database.js` keeps it.
- `xcore dev` runs a local D1 in `.gamesfun/dev/d1/` and applies the migrations at each start and reload.
- `xcore db info|query|export|import|restore`, locally or `--live`. A query only reads unless `--write`.
  `restore --live` warns that loot balances and payouts are not rolled back. A dump creates its tables and upserts
  each row (a row is never deleted), so `export` and `import` round-trip, here and live.
- Project files: `env.GF.files` (`put`, `get`, `head`, `list`, `delete`, `usage`; 25 MB a file, 100 MB on Free) and
  `xcore files ls|put|get|rm|usage`, locally or `--live`. `xcore dev` serves the public files on a port of their own
  with the files domain's headers.
- Publish refuses a game with a database, or a server that uses `env.GF.files`, while xgames.fun's `/api/kit/me` does
  not list `"d1"` or `"files"`; `xcore files --live` is refused in words until then.
- Every lifecycle the commands report has one named state, for a person and for `--json`: sign-in (`signed-in`,
  `signed-out`, `expired`, `unreadable`) and `publish --status`'s `link` (`never`, `started`, `public`, `draft`,
  `draft-over-public`). `--json` failures print `{ ok: false, error, code, state, next }` on stdout. An expired sign-in
  is refused in its own words, and in GitHub Actions gives way to the job's OIDC token.

**Changed**

- A game that gets a server of its own keeps `gf.db`: `xcore add` writes `server/gf-docs.js` when `database` has
  `collections`, and the generated `server/index.js` routes `api/db/` through it. Publish refuses a server of its own
  that has `collections` and does not route `api/db/` (`db-route`).
- Lists fail closed: anything but `read: 'anyone'` lists only the player's own documents.
- Migrations are recorded in the database (`_gf_migrations`), as xgames.fun records them. A half-applied or empty
  migration is refused, and so is a statement over D1's 100,000 bytes. `xcore add database` writes
  `server/migrations/.gitattributes`, so git cannot change a migration's line endings.
- `xcore db query` follows xgames.fun's rule for statements and params, so it takes and refuses the same queries here
  and live; a `null` param is refused (write `NULL` in the SQL).
- Live owner routes: `db import --live` and `files put --live` are held to 4.5 MB a request before anything is sent;
  `import --live` and `query --write --live` need `--yes` or the word typed, as `restore` does. `db export --live`
  resumes an export it gave up on. An answer over 4 MB is fetched from its download address.
- The secret scan reads a text file whole, however big (it read the first 4 MiB), and no longer misses a long JWT.
- `.gamesfun/` keeps itself out of git (`.gamesfun/.gitignore`), so `db export`'s dumps are not committed.
- A `server/database.js` whose `RULES` are still 0.1.0's default is said at publish to be open to anyone.

**Fixed**

- A local import of a local export failed ("table already exists").
- Vouchers: `PAY.paid` runs once a round, never twice for two asks at once, and again if it threw; a round whose
  signing failed can be signed again; a voucher signed with an earlier key is signed anew.
- Rooms: two players hosting one code at once get one host, and a room never passes `maxPlayers`.
- The page client: two sign-in clicks share one sign-in, sign-out ends a pending one, and a late answer never signs the
  player back in.
- `xcore dev`: saves made at once on start are all kept; an interrupted install no longer blocks the next for 10
  minutes. `check` downloads Chromium where there is no Chrome.
- `adopt` again with `--build`, `--out` or `--static` keeps the rest of `gamesfun.json`; `add` refuses a broken
  `gamesfun.json` or test key before writing any file.

## 0.1.0 — 2026-11-08

The first release: xgames.fun from the command line. A web game you already made is brought, checked, given a
backend and an economy, and published. Ships with `@xgamesfun/solana` 0.25.0, for loot 0.25.0 on devnet.

- `adopt` reads the game's shape (plain files; a Vite, Next.js static export, Astro, SvelteKit, Nuxt, Create React App,
  Parcel or Gatsby build, alone or in a monorepo; a Unity or Godot project or web export), builds it, writes
  `gamesfun.json` → `page`, and lists everything that does not fit xgames.fun's hosting with its fix. On a Godot
  project with no Web export it writes the Web preset. On a game with a Node server it names both ways to move it.
- `check`: the page check, as xgames.fun hosts the game: it builds, fits the hosting, starts clean in Chrome at a
  phone's and a desktop's size under the play host's page policy, and stays inside its origins.
- `dev`: the game on this machine as xgames.fun hosts it, with its `server/` under workerd, a local sign-in, saves and
  scores, and the economy's RPC forwarded to xgames.fun's relay or `XSOLANA_RPC_URL`. It answers only `localhost`,
  `127.0.0.1` and `[::1]`, and its log says when the page would pass a published plan's limits.
- `login`, `logout`, `publish`: sign in from the browser (or `--code`); publish at an unlisted link (only new files go
  up; a failing check saves a private draft), or from GitHub Actions with the job's OIDC token. Publish leaves out the
  makers' notes at the folder's top (`README.md`, `NOTES.md`, `CLAUDE.md`, `AGENTS.md` and others) and refuses a
  signing key's seed, a `{pub, seed}` key file or a 64-byte secret key in code.
- `add signin`: xgames.fun's player sign-in, saves and leaderboards for a web game, a Godot 4 project or a Unity
  project, through one page client (`gamesfun.js`).
- `add database`: documents in collections with per-collection rules (`server/database.js` at `api/db/`).
- `add multiplayer`: rooms (`server/rooms.js` at `api/rooms/<CODE>`), a relay with a host that passes on when the host
  leaves; Godot's high-level multiplayer runs over it; room links (`?room=CODE`) open the game in its room.
- `add vouchers`: a game's server pays results it checked from a grant, with a key of its own (`server/vouchers.js` at
  `api/vouchers/`: `PAY.check`, `PAY.paid`, `voucherFor`, `walletOf`). A result pays once, and only to a wallet the
  player proved is theirs. `VOUCHERS.payOnly: 'x'`, `perPerson` and `VOUCHERS.perMinute` limit who and how often.
  `xcore secret set VOUCHER_SEED --new-key` makes the live key, sends it only to xgames.fun and prints its address.
- `add rpc`: an economy game's Solana calls through its own devnet RPC (`server/rpc.js` at `api/rpc`), which passes
  only loot's calls and the game's own transactions.
- `loot`: a Solana economy on loot (devnet), with `@xgamesfun/solana`'s tools (`check`, `simulate`, `approve`,
  `connect` …) and its page client copied into the game (`loot add`). `GamesFun.loot` gives it to Godot and Unity.
- `plan`, `plan activate|deactivate`, `plan --all`: a game's backend plan (Free, Creator in a paid slot, Scale), its
  limits and this month's use.
- `secret set|list|delete`: a server's own secrets, read as `env.<NAME>`, never shown again or given to the page.
- `embed` and `domain`: a site of your own may frame the game (3, 10 or 25 sites by plan), and on Creator (1) or Scale
  (5) it is served on a domain of your own.
- `backend use custom`: a backend you already run, named in `backend.json` so the page may reach it.
- Leaderboards a server owns: `env.GF.scores.setup(board, {writer: 'server'})` refuses the page's submits to it
  (`server-only`); the page still reads it.
- A server's named export the hosted runtime cannot start with (`export const SEASON = 5`) is refused before publish.
- With `@xgamesfun/kit` installed, every other command goes to it, and so do `check`, `dev` and `publish` for a game
  the kit made.
