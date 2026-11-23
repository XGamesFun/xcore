# xcore: host a web game you already made, with a backend and a Solana economy

[![npm](https://img.shields.io/npm/v/@xgamesfun/xcore?label=npm)](https://www.npmjs.com/package/@xgamesfun/xcore)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Publish a browser game you already made at a link anyone can play, and give it player sign-in, a database,
multiplayer rooms and a Solana economy (shops, loot boxes, raffles, prize pools, staking, token rewards) with no smart
contract to write.** It takes plain HTML/JS, a Vite, Next.js static export, Astro, SvelteKit, Nuxt, Create React App or
Parcel project, and Godot and Unity web exports. The economy runs on Solana devnet, and on mainnet when you say so. One
command line does it all, by hand or run by Claude Code, Codex or another coding agent.

xcore is the one place to start with [xgames.fun](https://xgames.fun) (`@xgamesfun/xcore` on npm, the `xcore`
command). It is for a person who made a web game and wants it played, and for the coding agent that does the work for
them: it checks the game as xgames.fun hosts it, gives it a backend and an economy, and publishes it. Nothing about the
game changes: it keeps its code, its framework and its build, as long as it fits the [hosting](docs/HOSTING.md). The
economy tools are [`@xgamesfun/solana`](https://github.com/XGamesFun/solana-kit) (`xsolana`), which `xcore loot` runs.

A game-making kit, for a game that starts from an idea, is coming as `@xgamesfun/kit`.

## Install

It needs Node 24 or newer, and Chrome, Edge or Chromium for the check (else it downloads Playwright's Chromium once).

```bash
npm i -g @xgamesfun/xcore      # then: xcore <command>
npx -y @xgamesfun/xcore adopt  # or run it without installing
```

`xcore` on npm is another package: always run this one as `npx -y @xgamesfun/xcore …`, or install it. This page writes
`xcore`.

## Quick start

From an empty folder to a game that passes the check and plays on this machine. Nothing here needs an account.

1. **A game.** Bring a folder you have, or make one with a single page:

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

2. **Adopt it.** `xcore adopt .` reads the folder's shape (here, plain static files; a project with a build has its
   packages installed first, and adopt runs the build), writes the game's record in `gamesfun.json`, and lists what to
   fix before publishing and what is worth a look, each line with its fix (this page gets two worth a look: no tab icon,
   no full screen button). Fix in the game's own files and adopt again; it exits 0 once nothing is refused or left to
   fix.
3. **Check it.** `xcore check .` builds it (when it has a build), holds it to the hosting, opens it in Chrome at a
   phone's size and a desktop's and inside the play page's frame, and walks a new player's first taps. Screenshots and
   the record go in `evidence/verify-1/`.
4. **Play it here.** `xcore dev .` serves it as xgames.fun will host it, at `http://127.0.0.1:8787/game/`, with
   sign-in, saves, leaderboards, its server and its rooms behind it. Ctrl+C stops it.
5. **Publish it** (this step needs an xgames.fun account). `xcore card .` makes its preview picture, `xcore login`
   signs this computer in, and `xcore publish .` checks it and puts it at a link anyone can play (unlisted). A
   game whose check fails goes up as a private draft only.

[docs/COMMANDS.md](docs/COMMANDS.md) has what each step reads, writes and prints.

## What it adds to a game

Sign-in, saves, leaderboards, the database, rooms and the economy are the same calls from a web page, a Godot 4
project and a Unity project.

- **Sign-in, saves and leaderboards**: `xcore add signin`. xgames.fun signs players in (with X first, or a Solana
  wallet) for every game, and keeps each player's saves and the game's leaderboards. A web game calls
  `await GamesFun.signIn()`. [docs/CLIENT.md](docs/CLIENT.md)
- **A database**: `xcore add database`. One D1 database (SQLite) a game, made on xgames.fun by the first publish and
  kept between publishes; nothing to sign up for and no keys. `xcore db` reads it here, or with `--live` on xgames.fun.
  [docs/CLIENT.md](docs/CLIENT.md#the-database-gamesfundb), [docs/SERVER.md](docs/SERVER.md#a-database-of-its-own)
- **Rooms**: `xcore add multiplayer`. Rooms the game owns, published with it; Godot's high-level multiplayer runs over
  them unchanged. [docs/CLIENT.md](docs/CLIENT.md#rooms-xcore-add-multiplayer)
- **A server**: `server/`, a Cloudflare Worker that xgames.fun runs on the game's `/api/*`, with Durable Objects, its
  own secrets and `env.GF` (sign-in, saves, scores, loot reports): a leaderboard nobody can write from the console, a
  result that pays. [docs/SERVER.md](docs/SERVER.md)
- **Live settings**: an announcement, a remote config and maintenance from xgames.fun/console, with no republish.
  [docs/CLIENT.md](docs/CLIENT.md#live-settings-gflive)
- **Project files**: `xcore files`. Replays, generated levels, content packs its server writes and its page loads.
  [docs/COMMANDS.md](docs/COMMANDS.md#files)
- **A backend of its own**: `xcore backend use custom`. Any public `https://` or `wss://` origin the page may reach.
  [docs/HOSTING.md](docs/HOSTING.md#a-backend)
- **An economy**: `xcore loot add`. Shops, loot boxes, raffles and lotteries, prize pools, staking, crafting, perks for
  holders and rewards, on loot, one shared Solana program, so there is no Anchor or Rust to write, deploy or audit.
  Devnet by default; mainnet (real money) when its `xsolana.json` says so. [docs/ECONOMY.md](docs/ECONOMY.md)
- **A security review**: `xcore review`. What a cheater gets from the game's economy and server, before players are
  paid. [docs/ECONOMY.md](docs/ECONOMY.md#review-xcore-review)
- **And**: a preview picture for shared links (`xcore card`), a coin that trades (`xcore coin`), your own site and
  domain (`xcore embed`, `xcore domain`).

## The commands

```bash
xcore adopt ./my-game                      # its record, and the list of what to fix
xcore check ./my-game                      # the page in Chrome, as the host serves it
xcore dev ./my-game                        # play it here as xgames.fun hosts it: its server, sign-in, rooms, economy
xcore add signin ./my-game                 # players sign in (X or a wallet); saves and leaderboards
xcore add database ./my-game               # a database of its own (D1), put up with the game
xcore db query "SELECT * FROM players"     # read it here, or --live on xgames.fun
xcore files put ./level.json levels/1.json --public --live   # a file its server and page read
xcore add multiplayer ./my-game            # rooms players share (Godot's own multiplayer runs over them)
xcore backend use custom ./my-game --url https://api.example.com   # only if it calls a backend you run
xcore loot add ./my-game                   # only if it gets an economy (a Solana economy on loot)
xcore add vouchers ./my-game               # its server pays results it checked from a grant, with its own key
xcore review ./my-game                     # the security review: what a cheater gets (--live once published)
xcore card ./my-game                       # its preview picture: what a shared link to it shows
xcore login && xcore publish ./my-game
xcore embed add https://mygame.com ./my-game     # your own site may show it (an <iframe>)
xcore domain add play.mygame.com ./my-game       # Creator or Scale: it plays at your own domain
```

`xcore --help` lists all of them and `xcore <command> --help` each one's options. Every command takes `--json`.
[docs/COMMANDS.md](docs/COMMANDS.md) is the reference.

## What the hosting takes, and its limits

- Static files a browser runs on its own, served as they are: `index.html` is the entry, and a missing path is "not
  found", with no fallback to `index.html`.
- Relative URLs (`./assets/x.js`, not `/assets/x.js`), so the game works at its own origin, under Studio's preview
  folder and in `xcore dev`.
- In xgames.fun's play page the game runs in a sandboxed frame: no form submits, no pop-ups and no top-level
  navigation.
- Scripts, style sheets, fonts and frames from its own files only; connections to its own origin and to the public
  origins `backend.json` lists (at most 8).
- Refused, always: `.env` files, symbolic links, key and certificate files, wallet keypairs, and anything in a text
  file that looks like a secret.

| Limit           |                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------- |
| One game        | 3,000 files, 100 MiB                                                                        |
| One account     | 30 publishes and 1 GB of new files a day, 100 games                                         |
| A server bundle | 5 MB                                                                                        |
| Free            | 2 free slots for everyone; 50 ms of CPU a request, 600 requests a minute; $1 of use a month |
| Creator         | a paid slot, $15 for 30 days; 200 ms, 6,000 requests a minute; $10 of use a month a slot    |

Past what is included, a game is capped until the month ends: its server is switched off, and its pages keep loading.
[docs/HOSTING.md](docs/HOSTING.md) has every rule, the whole plan table, and notes for frameworks and engines.

## What is not supported

- Server-side rendering: the host serves files only.
- A server in Node, Python, Ruby or Go on xgames.fun: `server/` is a Worker. Such a server runs on a host of your own,
  declared with `backend use custom`.
- Scripts, style sheets and fonts from a CDN: a copy goes in the game.
- A fallback to `index.html` for every path: use a hash router.
- More than 8 backend origins, IP addresses, localhost, wildcards.
- Keys that are public by design but look like secrets, other than a Supabase anon or publishable key and a Firebase
  web config's `apiKey`.
- A threaded engine export (export single-threaded), and Unreal Engine 5, which has no web export.

Why, and what to do instead: [docs/HOSTING.md](docs/HOSTING.md#what-is-not-supported-and-why).

## With a coding agent

The skill in [`skills/bring-your-own-game/`](skills/bring-your-own-game/SKILL.md) walks the same steps. `xcore connect`
copies it into Claude Code's and Codex's skills, adds the economy's tools (what `xcore loot connect` does), and prints a
few lines for a project's AGENTS.md. For other agents (Cursor, Copilot, Gemini CLI and more),
`npx skills add XGamesFun/xcore` installs the same skill.

Before an economy, a draw or anything a player pays for, read [docs/BEFORE-YOU-BUILD.md](docs/BEFORE-YOU-BUILD.md): one
method (challenge before you build, then six lenses) that finds what a design gets wrong.

## Questions people ask

**How do I add Solana payments, loot boxes or token rewards to a web game I already made?** `xcore loot add ./my-game`
gives the game an economy on loot, one shared Solana program, so there is no Anchor or Rust to write, deploy or audit.
You describe its shops, loot boxes, raffles, prize pools, staking and rewards in one JSON file (`xsolana.json`), and the
tools check it, simulate it and price it before anything goes live. See [the economy](docs/ECONOMY.md) and
[`@xgamesfun/solana`](https://github.com/XGamesFun/solana-kit), the toolkit underneath.

**Does the economy run on Solana mainnet?** Yes. It is on devnet, where nothing is real money, until its `xsolana.json`
says `"network": "mainnet"`, where everything is. The loot program has not been independently audited: read the
[disclaimer](docs/DISCLAIMER.md) before real money.

**How do I host a Vite, Next.js, Godot or Unity web game with a backend, for free?** `xcore adopt`, `xcore check` and
`xcore publish` put its static build on xgames.fun at a link anyone can play. Everyone gets 2 free slots, and a game in
one has a server of its own (a Worker in `server/`), 10 MB of saves and 8 leaderboards, within the Free plan's limits
([plans](docs/HOSTING.md#plans-xcore-plan)). A page rendered per request, or a server in Node, Python or Go, does not
run there ([what is not supported](docs/HOSTING.md#what-is-not-supported-and-why)).

**How do I add multiplayer to a browser game without running a server?** `xcore add multiplayer ./my-game` adds sign-in
and rooms the game owns, published with the game. A web game joins one with `GamesFun.rooms.join(code)`, and Godot's
high-level multiplayer runs over the same rooms unchanged. See [rooms](docs/CLIENT.md#rooms-xcore-add-multiplayer).

**How do players sign in to a web game with X or a Solana wallet?** `xcore add signin ./my-game` gives the game the page
client for xgames.fun's sign-in (X first, or a Solana wallet), with saves and leaderboards for each player. A web game
calls `await GamesFun.signIn()`; Godot 4 and Unity get the same calls in their own shape. See
[the page client](docs/CLIENT.md).

**Can Claude Code, Codex or Cursor publish my game for me?** Yes. `xcore connect` copies the `bring-your-own-game` skill
into Claude Code's and Codex's skills and adds the economy's MCP tools (`xsolana_*`). For other agents (Cursor, Copilot,
Gemini CLI and more), `npx skills add XGamesFun/xcore` installs the same skill. The agent then walks the steps on this
page: adopt, check, add what the game needs, review, publish.

**Can a game launch its own coin?** Yes, once it is published: `xcore coin` launches one on Meteora or pump.fun through
xgames.fun's launchpad, on devnet to rehearse or on mainnet. See [a coin that trades](docs/ECONOMY.md#a-coin-that-trades-xcore-coin).

**Is `xcore` on npm this package?** No. This one is `@xgamesfun/xcore`: run it as `npx -y @xgamesfun/xcore`, or install
it with `npm i -g @xgamesfun/xcore`.

## Documentation

- [docs/COMMANDS.md](docs/COMMANDS.md): every command, what it reads and writes, `--json`, publishing from GitHub
  Actions
- [docs/HOSTING.md](docs/HOSTING.md): what the hosting takes, its limits and plans, frameworks and engines, your own
  site and domain, what is not supported
- [docs/CLIENT.md](docs/CLIENT.md): the page client (`gamesfun.js`, Godot, Unity): sign-in, saves, leaderboards, full
  screen, the wallet app, live settings, the database, rooms, the economy
- [docs/SERVER.md](docs/SERVER.md): a game's own server code (`server/`, the `gf-server-v1` contract), its database
  and its payouts
- [docs/ECONOMY.md](docs/ECONOMY.md): an economy on loot, going live, paying a result, the review, a coin that trades
- [docs/BEFORE-YOU-BUILD.md](docs/BEFORE-YOU-BUILD.md): challenge before you build, and the six lenses that find what a
  design gets wrong
- [docs/UPGRADING.md](docs/UPGRADING.md): a game made with an older xcore
- [docs/DISCLAIMER.md](docs/DISCLAIMER.md): disclaimer and responsible use
- [skills/bring-your-own-game/SKILL.md](skills/bring-your-own-game/SKILL.md): the same steps, for a coding agent
- [xgames.fun/xcore](https://xgames.fun/xcore): this page in short, with what a game gets, the plans and what is not
  supported
- [Add Solana to a browser game](https://xgames.fun/solana/web-game): what a page can pay safely, what needs the game's
  server, and the page code, step by step
- [CHANGELOG.md](https://github.com/XGamesFun/xcore/blob/main/CHANGELOG.md),
  [CONTRIBUTING.md](https://github.com/XGamesFun/xcore/blob/main/CONTRIBUTING.md),
  [SECURITY.md](https://github.com/XGamesFun/xcore/blob/main/SECURITY.md)

## Security and responsible use

Report a vulnerability privately, as [SECURITY.md](https://github.com/XGamesFun/xcore/blob/main/SECURITY.md)
describes, never in a public issue.

**Use this software at your own risk.** It is provided "as is", without warranty of any kind ([LICENSE](LICENSE)). The
loot program runs on Solana devnet and on mainnet, and has not been independently audited: on mainnet every transaction
moves real SOL and real tokens, and what is sent to the program can be lost. Loot boxes, raffles, lotteries, prize pools
and tokens are regulated in many places, and making sure what you build is legal where you and your players are is
yours. Nothing here is legal, financial, investment or tax advice. [docs/DISCLAIMER.md](docs/DISCLAIMER.md) says it in
full.

## License

[MIT](LICENSE) © xgames.fun
