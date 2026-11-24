# xcore: host a web game you already made, with a backend and a Solana economy

[![npm](https://img.shields.io/npm/v/@xgamesfun/xcore?label=npm)](https://www.npmjs.com/package/@xgamesfun/xcore)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**xcore publishes a browser game you already made to [xgames.fun](https://xgames.fun), at a link anyone can play. It
can also add player sign-in, a database, multiplayer rooms and a Solana economy (shops, loot boxes, raffles, prize
pools, staking, token rewards) without a smart contract to write.**

- It works with plain HTML/JS; Vite, Next.js static export, Astro, SvelteKit, Nuxt, Create React App and Parcel
  projects; and Godot and Unity web exports.
- Your game keeps its code, framework and build, as long as it fits the [hosting rules](docs/HOSTING.md).
- The economy runs on Solana devnet, and on mainnet only when you set it to.
- You can run every step by hand, or have Claude Code, Codex or another coding agent run it.

The package is `@xgamesfun/xcore` on npm, and the command is `xcore`. The economy tools come from
[`@xgamesfun/solana`](https://github.com/XGamesFun/solana-kit) (`xsolana`), which `xcore loot` runs for you. See
[Names](#names) for how the pieces fit together.

A game-making kit, for a game that starts from an idea, is coming as `@xgamesfun/kit`.

## Install

You need Node 24 or newer. The page check uses Chrome, Edge or Chromium if one is installed; otherwise it downloads
Playwright's Chromium once.

```bash
npm i -g @xgamesfun/xcore      # install, then run: xcore <command>
npx -y @xgamesfun/xcore adopt  # or run it without installing
```

The unscoped `xcore` package on npm is a different package. Always run this one as `npx -y @xgamesfun/xcore …`, or
install it. The examples below use `xcore`.

## Quick start

These steps take an empty folder to a game that passes the check and runs on your machine. None of them needs an
account.

1. **Make a game.** Use a folder you have, or create a one-page game:

   ```bash
   mkdir my-game && cd my-game
   cat > index.html <<'EOF'
   <!doctype html>
   <meta charset="utf-8" />
   <title>Click the Moth</title>
   <button id="moth" style="font-size: 3rem">🦋</button>
   <p>Score: <span id="score">0</span></p>
   <script>
     let score = 0;
     document.getElementById('moth').onclick = () => (document.getElementById('score').textContent = ++score);
   </script>
   EOF
   ```

2. **Adopt it.** `xcore adopt .` detects the folder's type (here, plain static files). For a project with a build, it
   asks you to install its packages first, then runs the build. It writes the game's record to `gamesfun.json`, and
   lists what to fix before publishing and what is worth a look, each with its fix. This example gets two "worth a
   look" items: no tab icon, and no full-screen button. Fix the game's own files and run adopt again. It exits with 0
   once nothing is refused or left to fix.
3. **Check it.** `xcore check .` builds the game (if it has a build) and checks it against the hosting rules. It opens
   the game in Chrome at a phone's size and a desktop's, inside the play page's frame, and walks through a new
   player's first taps. Screenshots and the record go in `evidence/verify-1/`.
4. **Play it locally.** `xcore dev .` serves the game as xgames.fun will host it, at `http://127.0.0.1:8787/game/`,
   with sign-in, saves, leaderboards, its server and its rooms. Press Ctrl+C to stop it.
5. **Publish it** (needs an xgames.fun account). `xcore card .` makes its preview picture, `xcore login` signs this
   computer in, and `xcore publish .` checks the game and publishes it at an unlisted link anyone can play. The first
   publish of a folder creates a new game on the signed-in account and takes one of its slots, so it first shows the
   account, the game's name and the slot, and asks you to confirm. A game that fails its check is uploaded only as a
   private draft.

[docs/COMMANDS.md](docs/COMMANDS.md) describes what each step reads, writes and prints.

## What it adds to a game

Sign-in, saves, leaderboards, the database, rooms and the economy use the same calls from a web page, a Godot 4
project and a Unity project.

- **Sign-in, saves and leaderboards:** `xcore add signin`. xgames.fun signs players in with X or Google, for every
  game. A player can link a Solana wallet to their account, and it comes with the sign-in. xgames.fun stores each
  player's saves and the game's leaderboards. A web game calls `await GamesFun.signIn()`.
  [docs/CLIENT.md](docs/CLIENT.md)
- **A database:** `xcore add database`. One D1 (SQLite) database per game, created on xgames.fun by the first publish
  and kept between publishes. There is nothing to sign up for and no keys to manage. `xcore db` works with the local
  copy, or with `--live` the one on xgames.fun. [docs/CLIENT.md](docs/CLIENT.md#the-database-gamesfundb),
  [docs/SERVER.md](docs/SERVER.md#the-games-database)
- **Multiplayer rooms:** `xcore add multiplayer`. Rooms run by the game's own server code and deployed with the game.
  Godot's high-level multiplayer runs over them unchanged. [docs/CLIENT.md](docs/CLIENT.md#rooms-xcore-add-multiplayer)
- **A server:** `server/`, a Cloudflare Worker that xgames.fun runs at the game's `/api/*`. It can use Durable
  Objects, its own secrets, and `env.GF` (sign-in, saves, scores, loot reports). Use it for a leaderboard nobody can
  write to from the browser console, or a result that pays out. [docs/SERVER.md](docs/SERVER.md)
- **Live settings:** an announcement, remote config and maintenance mode, set from xgames.fun/console without
  republishing. [docs/CLIENT.md](docs/CLIENT.md#live-settings-gflive)
- **Project files:** `xcore files`. Replays, generated levels and content packs that the game's server writes and its
  page loads. [docs/COMMANDS.md](docs/COMMANDS.md#files)
- **Your own backend:** `xcore backend use custom`. Any public `https://` or `wss://` origin the page needs to reach.
  [docs/HOSTING.md](docs/HOSTING.md#a-backend)
- **An economy:** `xcore loot add`. Shops, loot boxes, raffles and lotteries, prize pools, staking, crafting, holder
  perks and rewards, on loot, one shared Solana program. There is no Anchor or Rust to write, deploy or audit. It runs
  on devnet by default, and on mainnet (real money) when its `xsolana.json` says so. [docs/ECONOMY.md](docs/ECONOMY.md)
- **A payout and key check:** `xcore review`. A pattern-based check of the game's economy and server code for payout
  and key-handling mistakes: what a cheater could get before players are paid. It reads code as text and runs none of
  it, so it is not a security audit, and a PASS is not proof that the game is safe.
  [docs/ECONOMY.md](docs/ECONOMY.md#review-xcore-review)
- **Also:** a preview picture for shared links (`xcore card`), a coin that trades (`xcore coin`), and your own site and
  domain (`xcore embed`, `xcore domain`).

## Commands

```bash
xcore adopt ./my-game                      # write the game's record and list what to fix
xcore check ./my-game                      # run the page in Chrome as the host serves it
xcore dev ./my-game                        # run it locally as xgames.fun hosts it: server, sign-in, rooms, economy
xcore add signin ./my-game                 # player sign-in (X or Google), saves and leaderboards
xcore add database ./my-game               # a D1 database for the game, deployed with it
xcore db query "SELECT * FROM players"     # query it locally, or on xgames.fun with --live
xcore files put ./level.json levels/1.json --public --live   # a file the game's server and page read
xcore add multiplayer ./my-game            # rooms players share (Godot's own multiplayer runs over them)
xcore backend use custom ./my-game --url https://api.example.com   # only if it calls a backend you run
xcore loot add ./my-game                   # only if it has an economy (a Solana economy on loot)
xcore add vouchers ./my-game               # a voucher key, so its server can pay results it has checked
xcore review ./my-game                     # check payouts and key handling, as a cheater would (--live once published)
xcore card ./my-game                       # make its preview picture: what a shared link shows
xcore login && xcore publish ./my-game
xcore embed add https://mygame.com ./my-game     # let your own site show it in an <iframe>
xcore domain add play.mygame.com ./my-game       # serve it on your own domain (Creator or Scale)
```

`xcore --help` lists every command, and `xcore <command> --help` shows its options. Every command accepts `--json`.
[docs/COMMANDS.md](docs/COMMANDS.md) is the full reference.

## Hosting rules and limits

- The host serves static files that run in the browser, unchanged. `index.html` is the entry point. A missing path
  returns "not found"; there is no fallback to `index.html`.
- Use relative URLs (`./assets/x.js`, not `/assets/x.js`), so the game works at its own origin, under Studio's preview
  folder, and in `xcore dev`.
- In xgames.fun's play page, the game runs in a sandboxed frame: no form submissions, pop-ups or top-level navigation.
- Scripts, style sheets, fonts and frames must come from the game's own files. The page can connect to its own origin
  and to the public origins listed in `backend.json` (at most 8).
- Always refused: `.env` files, symbolic links, key and certificate files, wallet keypairs, and anything in a text file
  that looks like a secret.

| Limit           |                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------- |
| One game        | 3,000 files, 100 MiB                                                                            |
| One account     | 30 publishes and 1 GB of new files a day; 100 games                                             |
| A server bundle | 5 MB                                                                                            |
| Free            | 2 free slots for everyone; 50 ms of CPU per request, 600 requests a minute; $1 of use a month   |
| Creator         | a paid slot, $15 per 30 days; 200 ms, 6,000 requests a minute; $10 of use a month per paid slot |

When a game uses more than its plan includes, it is capped until the month ends: its server is switched off, and its
pages keep loading. A Creator game with usage credit is not capped. [docs/HOSTING.md](docs/HOSTING.md) has every rule,
the full plan table, and notes for frameworks and engines.

## Costs

xcore is free and open source. Hosting is free in your 2 free slots. A paid slot costs $15 per game per 30 days. An
economy's players pay loot's per-action fee (0.0005 SOL on mainnet), and a coin launch costs about 0.03 SOL.
[docs/FEES.md](docs/FEES.md) lists every cost in one table: hosting, the paid plan and usage credit, coin launches,
loot's fees, randomness, and Metaplex's fee on new NFTs.

## Your data

- **The game's database** (D1, including the page's `GamesFun.db` documents): `xcore db export --live` writes all of
  it as SQL, and `xcore db import` loads it back.
- **Project files:** `xcore files ls --live` and `xcore files get <path> --live`.
- **Player saves and leaderboards** are kept by xgames.fun's player services, not in the game's database, so
  `xcore db export` does not include them. There is no bulk export for them yet. A game's own server can read them
  through `env.GF`: one player's saves at a time, and leaderboards in pages of up to 100 entries.

Details: [docs/HOSTING.md](docs/HOSTING.md#your-games-data-and-getting-it-out).

## What is not supported

- Server-side rendering: the host serves files only.
- A server in Node, Python, Ruby or Go on xgames.fun: `server/` is a Worker. Run such a server on your own host and
  declare it with `backend use custom`.
- Scripts, style sheets and fonts from a CDN: include a copy in the game.
- A fallback to `index.html` for every path: use a hash router.
- More than 8 backend origins, IP addresses, localhost, or wildcards.
- Keys that are public by design but look like secrets, other than a Supabase anon or publishable key and a Firebase
  web config's `apiKey`.
- A threaded engine export (export single-threaded), and Unreal Engine 5, which has no web export.

Reasons and alternatives: [docs/HOSTING.md](docs/HOSTING.md#what-is-not-supported-and-why).

## Names

| Name                  | What it is                                                                                                         | Required?                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| **xgames.fun**        | The site that hosts the games and runs sign-in, saves, leaderboards, databases and plans.                          | Yes: xcore publishes there. |
| **gamesfun**          | The name xgames.fun uses in code: the `GamesFun` page client, `gamesfun.json`, `.gamesfun/`, `GAMESFUN_*`.         | Comes with xcore.           |
| **xcore**             | This command line (`@xgamesfun/xcore` on npm).                                                                     | Yes.                        |
| **@xgamesfun/solana** | The economy toolkit: checks, simulates, prices and publishes an economy. Installed as a dependency of xcore.       | Only for an economy.        |
| **xsolana**           | The command line of `@xgamesfun/solana`. `xcore loot <command>` runs it for you.                                   | Only for an economy.        |
| **solana-kit**        | The GitHub repository of `@xgamesfun/solana` ([XGamesFun/solana-kit](https://github.com/XGamesFun/solana-kit)).    | No: source and docs only.   |
| **loot**              | The shared Solana program every economy runs on, so you deploy no contract of your own. Not independently audited. | Only for an economy.        |

## With a coding agent

The skill in [`skills/bring-your-own-game/`](skills/bring-your-own-game/SKILL.md) follows the same steps.
`xcore connect` copies it into Claude Code's and Codex's skills, adds the economy tools (as `xcore loot connect`
does), and prints a few lines for a project's AGENTS.md. For other agents (Cursor, Copilot, Gemini CLI and more),
`npx skills add XGamesFun/xcore` installs the same skill.

Before you build an economy, a draw, or anything a player pays for, read
[docs/BEFORE-YOU-BUILD.md](docs/BEFORE-YOU-BUILD.md). It describes one method (challenge the request before you build,
then check it through six lenses) for finding what a design gets wrong.

## FAQ

**How do I add Solana payments, loot boxes or token rewards to a web game I already made?** Run
`xcore loot add ./my-game`. The game gets an economy on loot, one shared Solana program, so there is no Anchor or Rust
to write, deploy or audit. You describe its shops, loot boxes, raffles, prize pools, staking and rewards in one JSON
file (`xsolana.json`). The tools check, simulate and price it before anything goes live. See
[the economy](docs/ECONOMY.md) and [`@xgamesfun/solana`](https://github.com/XGamesFun/solana-kit), the toolkit
underneath.

**Does the economy run on Solana mainnet?** Yes. It stays on devnet, where nothing is real money, until its
`xsolana.json` says `"network": "mainnet"`, where everything is. The loot program has not been independently audited:
read the [disclaimer](docs/DISCLAIMER.md) before using real money.

**How do I host a Vite, Next.js, Godot or Unity web game with a backend, for free?** `xcore adopt`, `xcore check` and
`xcore publish` put its static build on xgames.fun at a link anyone can play. Everyone gets 2 free slots. A game in a
free slot can have its own server (a Worker in `server/`), 10 MB of saves and 8 leaderboards, within the Free plan's
limits ([plans](docs/HOSTING.md#plans-xcore-plan)). Pages rendered per request, and servers in Node, Python or Go, do
not run there ([what is not supported](docs/HOSTING.md#what-is-not-supported-and-why)).

**How do I add multiplayer to a browser game without running a server?** `xcore add multiplayer ./my-game` adds
sign-in and rooms run by the game, deployed with it. A web game joins a room with `GamesFun.rooms.join(code)`, and
Godot's high-level multiplayer runs over the same rooms unchanged. See
[rooms](docs/CLIENT.md#rooms-xcore-add-multiplayer).

**How do players sign in?** `xcore add signin ./my-game` adds the page client for xgames.fun's sign-in: players sign
in with X or Google, and a Solana wallet they linked to their account comes with the sign-in. Each player gets saves
and leaderboard entries. A web game calls `await GamesFun.signIn()`; Godot 4 and Unity have the same calls. See
[the page client](docs/CLIENT.md).

**Can Claude Code, Codex or Cursor publish my game for me?** Yes. `xcore connect` copies the `bring-your-own-game`
skill into Claude Code's and Codex's skills and adds the economy's MCP tools (`xsolana_*`). For other agents (Cursor,
Copilot, Gemini CLI and more), `npx skills add XGamesFun/xcore` installs the same skill. The agent then follows the
steps above: adopt, check, add what the game needs, review, publish.

**Can a game launch its own coin?** Yes, once it is published. `xcore coin` launches one on Meteora or pump.fun through
xgames.fun's launchpad, on devnet to rehearse or on mainnet. See
[a coin that trades](docs/ECONOMY.md#a-coin-that-trades-xcore-coin) and its costs in [FEES.md](docs/FEES.md#coin-launch).

**Can I get my game's data out?** The database and project files, yes: `xcore db export --live` and
`xcore files get <path> --live`. Player saves and leaderboards have no bulk export yet. See [Your data](#your-data).

**Is `xcore` on npm this package?** No. This one is `@xgamesfun/xcore`: run it as `npx -y @xgamesfun/xcore`, or install
it with `npm i -g @xgamesfun/xcore`.

## Documentation

- [docs/COMMANDS.md](docs/COMMANDS.md): every command, what it reads and writes, `--json`, and publishing from GitHub
  Actions
- [docs/HOSTING.md](docs/HOSTING.md): the hosting rules, limits and plans, frameworks and engines, your own site and
  domain, your data, and what is not supported
- [docs/FEES.md](docs/FEES.md): every cost, in one table
- [docs/CLIENT.md](docs/CLIENT.md): the page client (`gamesfun.js`, Godot, Unity): sign-in, saves, leaderboards, full
  screen, the wallet app, live settings, the database, rooms, the economy
- [docs/SERVER.md](docs/SERVER.md): a game's own server code (`server/`, the `gf-server-v1` contract), its database and
  its payouts
- [docs/ECONOMY.md](docs/ECONOMY.md): an economy on loot, going live, paying a result, the review, a coin that trades
- [docs/BEFORE-YOU-BUILD.md](docs/BEFORE-YOU-BUILD.md): challenge the request before you build, and the six lenses that
  find what a design gets wrong
- [docs/UPGRADING.md](docs/UPGRADING.md): upgrading a game made with an older xcore
- [docs/DISCLAIMER.md](docs/DISCLAIMER.md): disclaimer and responsible use
- [skills/bring-your-own-game/SKILL.md](skills/bring-your-own-game/SKILL.md): the same steps, for a coding agent
- [xgames.fun/xcore](https://xgames.fun/xcore): a short overview, with what a game gets, the plans, and what is not
  supported
- [Add Solana to a browser game](https://xgames.fun/solana/web-game): what a page can pay for safely, what needs the
  game's server, and the page code, step by step
- [CHANGELOG.md](https://github.com/XGamesFun/xcore/blob/main/CHANGELOG.md),
  [CONTRIBUTING.md](https://github.com/XGamesFun/xcore/blob/main/CONTRIBUTING.md),
  [SECURITY.md](https://github.com/XGamesFun/xcore/blob/main/SECURITY.md)

## Security and responsible use

Report a vulnerability privately, as [SECURITY.md](https://github.com/XGamesFun/xcore/blob/main/SECURITY.md)
describes, never in a public issue.

**Use this software at your own risk.** It is provided "as is", without warranty of any kind ([LICENSE](LICENSE)). The
loot program runs on Solana devnet and mainnet, and has not been independently audited. On mainnet, every transaction
moves real SOL and real tokens, and what is sent to the program can be lost. Loot boxes, raffles, lotteries, prize
pools and tokens are regulated in many places; making sure what you build is legal where you and your players are is
your responsibility. Nothing here is legal, financial, investment or tax advice. [docs/DISCLAIMER.md](docs/DISCLAIMER.md)
has the full text.

## License

[MIT](LICENSE) © xgames.fun
