# xcore

[![npm](https://img.shields.io/npm/v/@xgamesfun/xcore?label=npm)](https://www.npmjs.com/package/@xgamesfun/xcore)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Publish your browser game on [xgames.fun](https://xgames.fun). Players can open its link or play in a post on X.
Add sign-in, saves, multiplayer or a Solana economy if your game needs them.

Bring plain HTML, a static web build or a Godot or Unity web export. Keep your code and build tools.
[Supported frameworks and engines](docs/HOSTING.md#frameworks-and-engines)

## Install

Use Node 24 or newer. For browser checks, xcore uses Chrome, Edge or Chromium, or downloads Chromium on first use.

```bash
npm i -g @xgamesfun/xcore
```

To run without installing, use `npx -y @xgamesfun/xcore@0.14.1 adopt .`. The unscoped npm package `xcore` is unrelated.

## Quick start

1. Open your game folder, or make a one-button game.

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

2. Run `xcore adopt .` to detect your build and write `gamesfun.json`. If your project has a build, install its dependencies first. Fix any required items in your source and rerun it.
3. Run `xcore check .` to test the game on phone, desktop and inside the play frame. Find the screenshots in
   `evidence/verify-1/`. That folder stays local.
4. Run `xcore dev .` and open the URL it prints. It starts at `http://127.0.0.1:8787/game/` and tries another port
   if needed. Sign in locally to test saves and scores. Press Ctrl+C to stop.
5. Run `xcore card .` for a preview image, then `xcore login` and `xcore publish .`. Confirm the account and game name to publish at an unlisted link.
   A failed check leaves the upload as a private draft.

## Names

**xcore** is the CLI. **xgames.fun** hosts the game. **Your console**, at xgames.fun/console, is where you manage a
published game, its plan and its billing. **GamesFun** is the client your game calls.

For economies, `xcore loot` runs **xsolana**, the CLI in `@xgamesfun/solana`. **loot** is the shared Solana
program. [solana-kit source](https://github.com/XGamesFun/solana-kit)

## What it adds to a game

| To add                                             | Use                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| X or Google sign-in, player saves and leaderboards | `xcore add signin` · [Page client](docs/CLIENT.md)                                                      |
| A SQLite database that persists across publishes   | `xcore add database` · [Database](docs/SERVER.md#the-games-database)                                    |
| Multiplayer rooms                                  | `xcore add multiplayer` · [Rooms](docs/CLIENT.md#rooms-xcore-add-multiplayer)                           |
| Server code for scores, payouts or your own API    | Put a Cloudflare Worker in `server/`. [Server guide](docs/SERVER.md)                                    |
| Replays, level files or content packs              | `xcore files` · [Project files](docs/COMMANDS.md#files)                                                 |
| A backend you already host                         | `xcore backend use custom` · [Backend setup](docs/HOSTING.md#a-backend)                                 |
| Announcements, settings or maintenance mode        | Your console's Live tab. [Live settings](docs/CLIENT.md#live-settings-gamesfunlive)                     |
| Shops, loot boxes, staking or rewards              | `xcore loot add` · [Solana economy](docs/ECONOMY.md)                                                    |
| Payout and key checks                              | `xcore review` scans your code for known mistakes. [Review limits](docs/ECONOMY.md#review-xcore-review) |
| Your own site or domain                            | `xcore embed` or `xcore domain` · [Hosting](docs/HOSTING.md#embedding)                                  |

## Commands

Run `xcore --help` for the command list or `xcore <command> --help` for options. Use `--json` in scripts.
[Command reference and exit codes](docs/COMMANDS.md)

A live server's errors and logs, rolling back to an earlier version, unpublishing and pausing for maintenance are on
your console, not in the CLI. [What only the console does](docs/COMMANDS.md#what-only-the-console-does)

## Hosting rules and limits

- The host serves static files that run in the browser, unchanged. `index.html` is the entry point. A missing path
  returns "not found"; there is no fallback to `index.html`.
- Use relative URLs (`./assets/x.js`, not `/assets/x.js`), so the game works at its own origin, under xgames.fun's preview
  folder, and in `xcore dev`.
- In xgames.fun's play page, the game runs in a sandboxed frame: no form submissions, pop-ups or top-level navigation.
- Scripts, style sheets, fonts and frames must come from the game's own files. The page can connect to its own origin
  and to the public origins listed in `backend.json` (at most 8).
- Always refused: `.env` files, symbolic links, key and certificate files, wallet keypairs, and anything in a text file
  that looks like a secret.

A game can include up to 3,000 files and 100 MiB. An account can publish 30 times and upload 1 GB of new files per day.
[All hosting limits](docs/HOSTING.md#limits)

## Costs

Free accounts can host **2 games**, with $1 of backend use per game each month.
Creator costs **$15 per account for 30 days** and covers up to **10 games**. Your games share $10 of monthly use.
Buy it on your console's Plans tab (xgames.fun/console) in one of two ways: by card, a subscription that renews every
30 days until you cancel it, or prepaid in SOL or USDC for 1–12 periods, which you renew yourself.

Server work, rooms and stored data count toward the hosting cap. Page requests and shared Solana relay calls
also use the allowance, but cannot trigger a cap on their own. For example, 100,000 relay calls use $1 of the
allowance or $2 of Creator overage credit. At the cap, pages stay up, the server stops, and saves and scores slow down.
Past the included use, Creator games use usage credit (paying in SOL or USDC) or go on the card invoice up to a spending
cap you set (paying by card).

Solana fees are separate. A mainnet player action costs 0.0005 SOL plus network fees. Minting a collectible adds
about 0.0031 SOL including rent. Run `xcore loot cost` for your economy. A coin launch costs about 0.03 SOL.
[Fee breakdown](docs/FEES.md)

## Your data

- **Database.** `xcore db export --live` downloads SQL, including documents saved with `GamesFun.db`. Restore it with `xcore db import`.
- **Project files.** List them with `xcore files list --live`, then download each with `xcore files get <path> --live`.
- **Saves and leaderboards.** `xcore data export` downloads every save and every board's entries into one JSON file,
  each player as the game's player id, never their X id or wallet. [Data access](docs/HOSTING.md#your-games-data-and-getting-it-out)

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

## With a coding agent

Run `xcore connect` in your project to install the game skill and economy tools for Claude Code or Codex.
For Cursor and other agents, use `npx skills add XGamesFun/xcore`. [Game skill](skills/bring-your-own-game/SKILL.md)

## FAQ

**Do players need a wallet?** Players sign in with X or Google. They can link a wallet for Solana features.

**Does the economy use real money?** It starts on devnet with test funds. Set `"network": "mainnet"` in
`xsolana.json` to use real funds. [Economy guide](docs/ECONOMY.md)

**Can my game launch a coin?** Once published, it can launch on Meteora or pump.fun.
[Coin launches](docs/ECONOMY.md#a-coin-that-trades-xcore-coin)

## Documentation

- [Commands](docs/COMMANDS.md) · [Hosting and plans](docs/HOSTING.md) · [Fees](docs/FEES.md)
- [Page client](docs/CLIENT.md) · [Game server](docs/SERVER.md) · [xcore library API](docs/API.md)
- [Economies](docs/ECONOMY.md) · [Economy design](docs/BEFORE-YOU-BUILD.md) · [Add Solana to a browser game](https://xgames.fun/solana/web-game)
- [Upgrading](docs/UPGRADING.md) · [Changelog](https://github.com/XGamesFun/xcore/blob/main/CHANGELOG.md) · [Contributing](https://github.com/XGamesFun/xcore/blob/main/CONTRIBUTING.md)

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
