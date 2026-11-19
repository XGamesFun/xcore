---
name: bring-your-own-game
description: Bring a web game someone already made (plain HTML/JS, or a Vite, Next.js static export, Astro, SvelteKit, Nuxt, Create React App or Parcel project; Godot and Unity web exports) to xgames.fun with the xcore command - adopt it, fix what does not fit the hosting, check it in the play page's frame, add sign-in, saves, a server or a loot economy, review what a cheater gets, and publish it. Use when the person has an existing game folder or repository and wants it hosted on xgames.fun, given web3, or checked as xgames.fun serves it.
---

# Bring your own game

The person already has a game. Make it fit xgames.fun's hosting with the smallest change to _their_ files; remaking it
would throw away their work. Every command here is `@xgamesfun/xcore`: run it as `npx -y @xgamesfun/xcore <command>`,
or `xcore <command>` once installed with `npm i -g @xgamesfun/xcore` (a bare `npx xcore` finds another package on npm).
Each command prints its findings with their fix and the command that comes next, and `<command> --help` gives its
options and limits: they are the reference, so this file holds the method and the order, not the details.

The order: **adopt → fix → check → (players, data, a server) → (economy) → (review, when it pays) → preview picture →
publish when they ask → (review --live).**

## One method, every step

The method's home is [docs/BEFORE-YOU-BUILD.md](../../docs/BEFORE-YOU-BUILD.md). For anything that touches money, a
token, a flow a player taps through, or can't be undone:

- **Challenge before you build.** Name the simplest version that gets most of the outcome, run the six lenses on both,
  and recommend one with its trade. Build what they asked once they have seen the trade and still want it. Taste is
  theirs, and a decision they made after hearing the trade stays made.
- **The six lenses**, in every state (before, running, done, won, lost, cancelled, abandoned, undone, after the end),
  as a player, the owner and a cheater: follow the value; one intent, one step; check every assumption (and its
  deadline); who makes it happen; where each rule is enforced; how the player experiences it. Run them again before you
  say it is done. The better version is the one that plays best, then the cleaner one, then the more secure one: an
  on-chain guard when it costs the player nothing, the server otherwise, said plainly.

## Four invariants

They hold at every step, so no step needs a rule of its own.

- **Consent where it can't be undone.** Some commands print exactly what they would do with a code, send nothing, and
  act only when run again with `--yes <code>`: `loot approve` (an economy going live), `coin launch`, a change to the
  live database (`db query --write --live`, `db import --live`, `db restore --live`), and replacing or deleting a
  secret the live server has (`secret set` over an existing name, `secret delete`). They move money, hand over keys,
  lose a key for good or change players' data, and none can be taken back. Show the person the printout, and run it
  with the code only after they have read it and said yes; a code fits only the printout it came with. Everything
  else is reversible and runs when the person asked for that change: publish (a new version, or a private draft when
  checks fail), a domain, an embed (it applies in about a minute), `plan activate` and `deactivate` (a slot moves, no
  money does). A step that costs the creator a click is fine. A player's path is different: a tap added for a narrow
  threat costs real players, so that guard goes on the server.
- **Custody.** Every key has one intended holder: the owner's key file on their machine, the live voucher key on
  xgames.fun, the test seed in `.dev.vars`. Its bytes anywhere else (the page, the game's folder or git, this chat, a
  log, a server that shouldn't hold it) are a leak, so you don't open, print, copy or ask for one. How the economy's key
  file is made and used is the xsolana-economy skill's.
- **Their game stays theirs.** The smallest change to their source. Their build's output is made again on every build,
  and the copies xcore keeps (`gf/loot/`, `gf/platform/`) are replaced whenever xcore brings them up to date, so a
  change goes in their source or config.
  Say only what you know: an economy is not legal, safe, an investment or ready for real money because you say so.
- **A refusal is the rule.** When a tool, the host or the chain refuses (a sign-in not given, a launch not this key's,
  a check that fails), stop and tell them what it said, with the fix it names. Working around a refusal hides the
  problem it found.

**Say in your own words**, keeping every number, everything a command prints for the person. Three kinds of fact go
**as written**, because a paraphrase can overclaim: what a cheater gets and the key-leak ceiling (review), and the legal
flags. Pass on each "Ask the person" question before building on its answer.

## 1. Adopt and fix

`xcore adopt <folder>` detects the shape, runs the build (install the packages first if it says so), writes
`gamesfun.json` → `page` and prints three lists, each item with its fix:

- **refused**: it can't be hosted as it is (a frontend rendered by a server, no `index.html`, a failing build), and
  nothing was written. Tell the person what the hosting needs (static files) and adopt's fix. A change of that size is
  their architecture: ask first.
- **fix**: it would be refused or break once published. Work through each, in their files.
- **warn**: worth a look. Decide each with the person when it needs their knowledge (is that origin really called?).

When adopt can't tell the build, the output or the public folder, pass them: `--build "<cmd>" --out <dir> --static
<dir>`. A game whose Node server hands out a static folder publishes that folder, and the server stays on their host
as a backend. Suggest adding `evidence/` and `.gamesfun/` to their `.gitignore`: xcore writes both and publishes
neither. Adopt again after the fixes; the lists should be empty. When adopt warns that the game can't go full screen,
offer a button: [references/sign-in-saves-rooms.md](references/sign-in-saves-rooms.md), "Full screen".

## 2. Check

`xcore check <folder>` serves the game as xgames.fun does and runs it in Chrome, including inside the play page's
sandboxed frame. Open the screenshots in `evidence/verify-N/` and look at them. Read its "First session" walk (a
first-time player on a phone: taps, sign-in, wallet, waits) and pass its lines to the person; when the walk can't
reach the first reward, declare the path in `gamesfun.json` (`"journey": [{"tap": "<css selector>"} | {"wait": ms}]`)
and check again.

The check does not say the game plays well: ask the person what to try, and try it with `xcore dev <folder>` (the game
as xgames.fun hosts it, with its server, sign-in, saves, rooms and economy RPC, refusing what the Free plan refuses;
`--plan creator` for a Creator game). A refusal there (`rate`, `full`, `too-many`, `order`) is one the published game
would get: fix the game, not the stand-in.

## 3. Players, data, a server (only when the game has or needs them)

- **Sign-in, saves, leaderboards, shared data, multiplayer**: `xcore add signin|database|multiplayer <folder>` (web,
  Godot 4 and Unity). Open [references/sign-in-saves-rooms.md](references/sign-in-saves-rooms.md) before wiring them:
  sign-in on the game's own host reloads the tab, which a game with an unsaved run must plan for.
- **A backend they run**: `xcore backend use custom <folder> --url <https://…>`. **Server logic xgames.fun runs**:
  `server/` ([docs/SERVER.md](../../docs/SERVER.md)). **Paying players for a result**: open
  [references/server-and-payouts.md](references/server-and-payouts.md) first; it has the two signers, the steps for
  the server's own voucher key, and what a payout rests on.

## 4. An economy (only when they ask: tokens, NFTs, a shop, prizes, staking)

The economy is designed with the xsolana-economy skill and its `xsolana_*` tools (`xcore connect` or
`xcore loot connect` adds them), which hold the loop: guide, examples, check, simulate, save, review, and going live
with a key file on the person's machine. Follow that skill; this one adds where the economy sits in a brought game.

- `xcore loot add <folder>` says where `xsolana.json` goes (the `static` folder of a build project); run it again
  once the economy is saved to copy the page client. Wiring it into the page and a claim button that works in X's own
  browser: [references/economy-in-the-page.md](references/economy-in-the-page.md).
- **The law, once.** The first time the checker flags a chance at a prize (`W-CHANCE-PRIZE`, or another legal flag),
  tell the person in one plain sentence that it is regulated in many places, that its legality where they and their
  players are is theirs to check, and that you are not giving legal advice. Say it again when they ask for mainnet,
  with the rest of what mainnet means (real money, what is sent can be lost, loot not independently audited). The
  README's "Disclaimer and responsible use" says it in full.
- An economy is on devnet, where nothing has real value, unless its `xsolana.json` says `"network": "mainnet"`, which
  goes in only when the person asks for mainnet in their own words.

## 5. Review (a game whose server pays results)

Before publishing a game that pays results, read it as a cheater would: `xcore review <folder>` writes
`evidence/review-N/review.md` and `review.json` and exits 1 on a high finding (`xcore loot review` is the economy's
part alone).

- Fix every high finding and run it again. Mediums are the person's to decide with you: say each one plainly.
- Declare each voucher grant's `trust` as what `PAY.check` really does
  ([references/server-and-payouts.md](references/server-and-payouts.md), "Review: trust levels").
- review.md opens with "Tell the person, as written" (what a cheater gets, the key-leak ceiling: say these as written)
  and "Ask the person" (ask before building on the answers). A bounded result is capped, not safe.
- Confirm each draft in its "Design and code" (`offchain`, `serverLimit`) with the person, add the confirmed ones to
  `xsolana.json`, and run `xcore loot check` again: a loop through the server shows only once it is declared.

After publishing, `xcore review <folder> --live` asks the published game as a stranger would and checks its voucher
key and economy against the folder (under `xcore dev`, give its address: `--live http://127.0.0.1:<port>/game/`).

## 6. Its preview picture (before the first publish)

A shared link shows a square card built from `assets/card.jpg` (best a 960×960 JPEG). `xcore card <folder>` takes a
picture of the game as it plays (`--tap`, `--wait <seconds>`, `--path <page?query>` for a game that needs them;
`--from <picture>` for key art they have). Then **open the picture and look at it**: a loading screen, a blank page or a
menu makes a poor card. Keep the subject clear of the top third (the title) and the bottom left (the button).
`xcore publish` stops without a picture xgames.fun can draw (code `card`; `next` names the fix); go without one
(`--no-card`, or `"card": false` in `gamesfun.json`) only when the person says so.

## 7. Publish (only when they ask)

`xcore publish <folder> --check` shows what goes up and what would refuse it, offline. `xcore publish <folder>` builds,
runs the page check on exactly those files and uploads them with the `server/` bundle; a failed check makes a private
draft only. `xcore login` asks the person to tick the games this computer may work on; a command refused with
`not-granted` means they run `xcore login` again and tick that game. Tell them the link, what you changed in their
files, what the checks proved, and what nothing checked (their gameplay, their backend's own behaviour).

After that, at their request: its plan and game slots (`xcore plan`, whose `--help` has the tiers, limits and prices;
a third game needs a free slot or a paid one), their own site (`xcore embed add <site> <folder>`), their own domain on
Creator or Scale (`xcore domain add <domain> <folder>`; it needs `gamesfun.js` 1.2.0 or later in the page), and a coin
that trades ([references/economy-in-the-page.md](references/economy-in-the-page.md), "A coin that trades").
