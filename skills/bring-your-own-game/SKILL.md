---
name: bring-your-own-game
description: Help someone bring a web game they already made without this kit (plain HTML/JS, or a Vite, Next.js static export, Astro, SvelteKit, Nuxt, Create React App or Parcel project) to games.fun - adopt it, fix what does not fit the hosting (server-side rendering, paths from the root, CDN scripts and fonts, undeclared backend origins, secrets, size limits), check it with the page check, connect their own backend or a server/ Worker, add a loot economy, and publish it. Use when the person has an existing game folder or repository and wants web3, games.fun hosting, or the kit's checks for it; never rebuild such a game through the creation loop.
---

# Bring your own game

The person already has a game. Your job is to make it fit games.fun's hosting with the smallest changes to _their_
files, never to remake it. The whole story, with every rule of the hosting, is xcore's README
(github.com/XGamesFun/xcore; on npm, @xgamesfun/xcore's page); read its "What the hosting takes" table once. Everything
here is `@xgamesfun/xcore` (the `xcore` command: `npx -y @xgamesfun/xcore …`, or `xcore …` once installed with `npm i -g
@xgamesfun/xcore`; never a bare `npx xcore`, which is another package), which needs no kit; with the kit, its MCP tools
(`gamesfun_adopt` and the rest, named below) do the same.

The order: **adopt → fix the list → check → (backend) → (economy) → publish when they ask.**

## 1. Adopt

```bash
xcore adopt <folder>            # or gamesfun_adopt {"dir": "<folder>"}
```

It detects the shape, runs the build (install the packages first if it says so: `npm install`), writes
`gamesfun.json` → `page` (`build`, `out`: the published folder, `static`: the folder the build copies as it is) and
returns three lists:

- **refused**: it cannot be hosted as it is (a frontend rendered by a server, no `index.html`, a failing build).
  Nothing was written. Tell the person plainly what the hosting needs (static files) and the fix adopt gives (a static
  export, the static adapter, `nuxt generate`, server logic moved to `server/` or their own backend). Ask before a
  change of that size: it is their architecture.
- **fix**: it would be refused or break once published. Work through each, in their files.
- **warn**: worth a look. Decide each with the person when it needs their knowledge (is that origin really called?).

When adopt cannot tell the output or the public folder, pass them: `--build "<cmd>" --out <dir> --static <dir>`
(`gamesfun_adopt {"dir": "<folder>", "build": "<cmd>", "out": "<dir>", "static": "<dir>"}`).

## 2. Fix the list

The usual fixes, each the smallest one:

| Found                                                                                             | Fix                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| paths from the root (`/assets/x.js`), Vite `base: '/'`                                            | relative paths: Vite `base: './'`; Next.js static export of one page `assetPrefix: '.'` (production builds only); Astro of one page `build: { assetsPrefix: '.' }`; Create React App `"homepage": "."`; Parcel `--public-url ./`; hand-written HTML `./x` |
| a script from a CDN (`<script src="https://cdn…">`), an import map or `import … from "https://…"` | install the package so the build bundles it, or copy the files it uses into the game (with its licence) and load or map the copy                                                                                                                          |
| `/socket.io/socket.io.js` or another file their own server hands out                              | copy the client into the game and load the copy; connect to their server by its address (`io('https://…')`), declared with `backend use custom`                                                                                                           |
| web fonts or a style sheet from another site                                                      | download them into the game (fonts as `.woff2`) and link the copies                                                                                                                                                                                       |
| a backend address the page calls                                                                  | declare it: `xcore backend use custom <folder> --url <https://…> [--origin <wss://…>]`                                                                                                                                                                    |
| `http://localhost:…` in the code                                                                  | point it at the hosted backend (or `/api/` with a `server/`); keep the local one for development only                                                                                                                                                     |
| a key in the code                                                                                 | move it to their backend; a browser game carries only keys made to be public (a Supabase anon or publishable key, a Firebase web config's apiKey)                                                                                                         |
| more than 3,000 files, over 100 MB in all                                                         | compress (WebP, KTX2, Draco or meshopt, Ogg), pack sprites, drop unused files                                                                                                                                                                             |
| a file under `platform/v1/`, `loot/v1/` … (or `api/` when the game has a `server/`)               | move it: the host answers those paths itself                                                                                                                                                                                                              |

A game whose Node server (Express, Socket.IO) hands out a static folder: adopt publishes that folder and the server
stays on their host as a backend (README, "A game with its own Node server"). Suggest adding `evidence/` and
`.gamesfun/` to their `.gitignore`: xcore writes them, and neither is published.

Never edit their build tool's output by hand (it is made again on every build): change the source or the config.
Adopt again after the fixes; the list should be empty.

## 3. Check

```bash
xcore check <folder>            # with the kit's tools: gamesfun_verify {"dir": "<folder>"}
```

Four checks: it builds, it fits the hosting, the page starts (phone and desktop, under the play host's page policy, no
console errors, nothing missing, nothing from the root, something on screen), it stays inside its origins. Open the two
screenshots in `evidence/verify-N/` and look at them. A failing check 4 names the origin and why: declare it in
`backend.json` if the game really calls it, or remove the call. The page check does not say the game plays well:
that is the person's own game; ask them what to try, and try it with `xcore dev <folder>` (the game as games.fun
hosts it, with its server, sign-in, saves, rooms and economy RPC) or their own.

## 4. Players, a database, a backend (only when the game has or needs them)

- **Sign-in, saves, leaderboards** (a login, progress kept between visits, a high-score table): `xcore add signin
<folder>`. It works out the engine itself: a web game gets `gamesfun.js` loaded in its page, a Godot 4 project the
  `GamesFun` autoload, a Unity project `Assets/Plugins/GamesFun/`. Replace the game's own login, its local save file
  or its localhost leaderboard with these calls (listed at the top of the file it writes); sign-in starts from a click,
  and when `onCode` / `sign_in_code` / `SignInCode` fires with `window: false`, the game shows the code and the site;
  with `window: true` a sign-in window is open, so at most a quiet line, never an overlay over the game.
  Never ask for a password or keep accounts of your own.
- **Data the game keeps for everyone** (levels players make, profiles, a world's state) where it used a localhost
  database or a JSON file: `xcore add database <folder>`, then `GamesFun.db` calls. Read RULES at the top of
  `server/database.js` with the person: anything a player must not set for themselves (a prize, a verified score)
  gets `write: 'server'` and is written by the game's server code. A database they already host stays behind their
  backend (below); its address and password never go in the page.
- **Multiplayer** (a localhost Socket.IO or ENet server, a Godot game with `ENetMultiplayerPeer`, a Unity game with
  its own relay): `xcore add multiplayer <folder>`. In Godot, replace `create_server`/`create_client` with `var peer =
await GamesFun.join_room(code)` and `multiplayer.multiplayer_peer = peer`; keep its RPCs, spawners and synchronizers.
  Elsewhere the host's game (the first player in, id 1) runs what the server ran, and the others send it their input
  with `room.send`. Codes: `rooms.fromLink()` first (a shared link), else `rooms.code()`; offer `rooms.link(code)` to
  share. Ask the person before moving server logic into the host's game.

- **They run one already**: `xcore backend use custom <folder> --url <https://…>` (`gamesfun_backend_use
{"dir": "<folder>", "provider": "custom", "url": "<https://…>", "origins": ["<wss://…>"]}`). Their backend must
  answer CORS for the game's origin. Never put their secret keys in the game.
- **They want one**: Supabase or Railway, connected by the game-making kit (`@xgamesfun/kit`: `xcore backend connect
supabase|railway` with the kit installed). Without the kit, they set one up themselves and you declare it as above.
- **Server logic games.fun runs for them**: `server/index.js` and `gamesfun.json` → `server`
  ([docs/SERVER.md](../../docs/SERVER.md)): a Worker on `/api/*`, Durable Objects for rooms, `env.GF` for sign-in, saves
  and scores. Their page calls it with a relative address (`fetch('api/scores')`): `/api/*` at the published origin,
  `/game/api/*` under `xcore dev`, which runs it under workerd with a local `env.GF`. A Node-only server stays on
  their own host.

## 5. An economy (only when they ask: tokens, NFTs, a shop, prizes, staking)

Before designing one, tell the person plainly: loot boxes, raffles, lotteries, prize pools, tokens and staking are
regulated in many places (gambling, securities, money transmission, consumer and tax law); making sure their game is
legal where they and their players are is their responsibility, and you are not giving legal advice. The program is
on devnet and unaudited, so nothing of real value goes through it. The README's "Disclaimer and responsible use"
section says it in full.

```bash
xcore loot add <folder>         # or gamesfun_loot_add {"game": "<folder>"}
```

It says where `xsolana.json` goes (the `static` folder of a build project). Design the economy with the
`xsolana-economy` skill and the `xsolana_*` tools (`xcore loot connect` adds them: `xsolana_guide`,
`xsolana_examples`, `xsolana_check`, `xsolana_simulate`, then `xsolana_save` into that file); fix every refusal
`xsolana_check` gives and tell the person its warnings in plain words. Then run `loot add` again: it copies the page
client into `gf/loot/` beside it. Wire it into their page the way that README's §4 shows (a run-time import with a
page-relative URL, `solanaApp` with `rpcUrl: PAGE_RPC`); a Godot or Unity game (or any page with `gamesfun.js`) uses
`GamesFun.loot` instead (`loot_ready`/`loot_connect`/`loot_call` in Godot, `LootReady`/`LootConnect`/`LootCall` in
Unity). A browser with no wallet is told so, with the game still playable. `xcore dev <folder>` runs the page and
`server/` against devnet; the economy's calls answer only once it is live there (`xcore loot approve`, devnet's test
SOL: an economy approved to try it is one the person can approve again later). Going live is the person's own
`xcore loot approve`, in their wallet: never yours.

Paying a result has two signers (docs/SERVER.md, "Paying a result", has the rule): games.fun's keeper, when the
server already decides who won and the prize is fixed by place (the server calls `env.GF.loot.report`; the owner
certifies the host key in Studio once, and nobody keeps a key), or the server's own key, when the amount depends on
the result, when the server replays or bounds runs, for entry fees or a prize pool, or past 120 results an hour. For
the own key, run `xcore add vouchers <folder>`: it writes `server/vouchers.js` and a test key for `xcore dev` (its
seed in `.dev.vars`, kept out of git). Then, in order: write `PAY.check` with the person (what their server checks
before it pays; nothing is paid until it is written) and count payouts in `PAY.paid`; they publish; they run `xcore
secret set VOUCHER_SEED --new-key` (the live key: made here, sent to games.fun only and never kept on their machine; it prints the address);
that address goes in the grant's `vouchers` (`xcore loot check`); they approve and publish again. Never read the seed
out of `.dev.vars` or repeat it.

Design it so a cheater gains little (docs/SERVER.md, "How much your server can check" and "Who gets paid"): never send
the page a run's whole seed up front (reveal randomness as the run goes); give slack per second, not per request; one
open run per player; pay only proven wallets (the page calls `gf.loot.link()` once; a wallet sign-in needs none);
a wallet is free, so for rewards worth farming set `VOUCHERS.payOnly` to `'x'` and give every grant a `perDay` total.

A page alone can't prove a score or a win: anyone can change it in the console. A leaderboard that must be fair is
one the server owns: `env.GF.scores.setup(board, {writer: 'server'})` refuses the page's submits to it (a pattern,
`'daily-*'`, for a day's or a week's boards; `scores.drop` frees a past one). Pay for those only through a grant
whose voucher a server signs after checking the result (the keeper or the server's own key, above); never put a
voucher key in the page. How much the
server can check (it decides the result, replays it, or only bounds it) sets what to pay: docs/SERVER.md, "How much
your server can check". A bounded result earns small capped amounts; entry fees and prize pools need a decided or
replayed one. Without a server,
offer what the player pays for or the chain decides (a shop, boxes, raffles, staking, perks), and say why.

## 6. Publish (only when they ask)

```bash
xcore publish <folder> --check  # the offline part: what goes up, what refuses it
xcore publish <folder>          # or gamesfun_login, then gamesfun_publish {"game": "<folder>"}
```

It builds, runs the page check on exactly those files, uploads the published folder and the `server/` bundle. A failed
check makes a private draft only. Tell them the link, what you changed in their files, what the checks proved and what
nothing checked (their gameplay, their backend's own behaviour).

A game with a `server/`, saves or scores runs under its **plan** (`xcore plan <folder>`): Free by default (50 ms of CPU
and 600 requests a minute, $1 of use a month, then capped and slow until the month ends). When the game needs more
(a server that replays play, many players at once), tell them: a paid game slot makes it Creator
(`xcore plan activate <folder>` once they have a slot), and the slot moves between their games at any time. Never
activate or deactivate a game without asking.

Their own website can show the game (`xcore embed add https://theirsite.com <folder>` prints the `<iframe>`), and on
Creator or Scale it can play at their own domain (`xcore domain add play.theirsite.com <folder>` prints two DNS records
they add where their domain's DNS is; `xcore domain check …` once they have). Both are theirs to ask for: never add a
site or a domain they did not name. A domain needs `gamesfun.js` 1.2.0+ in the page (`xcore add signin`, then publish).

## Never

- Change where the game's logic runs (a server moved into the page or into `server/`, a port to another language or
  framework) without the person's yes. Stop, lay out the options with their costs, and let them choose.
- Rebuild their game through the creation loop (`gamesfun_step_*`), or move it onto the kit's runtime.
- Edit `gf/loot/` or `gf/platform/` (kit copies), or their build's output by hand.
- Put a secret key, a `.env` file or a wallet keypair in the game.
- Widen what the page may reach beyond what the game really calls.
- Present an economy as legal, safe or ready for real money: that is the person's call, with their own advice.
