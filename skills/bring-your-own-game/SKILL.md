---
name: bring-your-own-game
description: Help someone bring a web game they already made without this kit (plain HTML/JS, or a Vite, Next.js static export, Astro, SvelteKit, Nuxt, Create React App or Parcel project) to xgames.fun - adopt it, fix what does not fit the hosting (server-side rendering, paths from the root, CDN scripts and fonts, undeclared backend origins, secrets, size limits), check it with the page check, connect their own backend or a server/ Worker, add a loot economy, review what a cheater gets from it, and publish it. Use when the person has an existing game folder or repository and wants web3, xgames.fun hosting, or the kit's checks for it; never rebuild such a game through the creation loop.
---

# Bring your own game

The person already has a game. Your job is to make it fit xgames.fun's hosting with the smallest changes to _their_
files, never to remake it. The whole story, with every rule of the hosting, is xcore's README
(github.com/XGamesFun/xcore; on npm, @xgamesfun/xcore's page); read its "What the hosting takes" table once. Everything
here is `@xgamesfun/xcore` (the `xcore` command: `npx -y @xgamesfun/xcore …`, or `xcore …` once installed with `npm i -g
@xgamesfun/xcore`; never a bare `npx xcore`, which is another package), which needs no kit; with the kit, its MCP tools
(`gamesfun_adopt` and the rest, named below) do the same.

The order: **adopt → fix the list → check → (backend) → (economy) → (review, when it pays) → its preview picture → publish when they ask → (review --live).**

**One method, every step** ([docs/BEFORE-YOU-BUILD.md](../../docs/BEFORE-YOU-BUILD.md)). For anything that touches
money, a token, a flow a player taps through, or can't be undone:

- **Challenge before you build.** Name the simplest version that gets most of the outcome, run the six lenses on both,
  and recommend one with its trade. Build what they asked once they have seen it and still want it. Not taste, and
  never the same decision twice.
- **The six lenses**, in every state (before, running, done, won, lost, cancelled, abandoned, undone, after the end),
  as a player, the owner and a cheater: follow the value; one intent, one step; check every assumption (and its
  deadline); who makes it happen; where each rule is enforced; how the player experiences it. Run them again before
  you say it is done. The better version is the one that plays best, then the cleaner one, then the more secure one:
  an on-chain guard when it costs the player nothing, the server otherwise (said plainly).

And three invariants that hold everywhere, so no step needs its own rule:

- **Consent to a printout.** Anything irreversible, anything that costs money, and anything that changes their
  architecture, ownership or what is public (going live, a coin, a domain or an embed, where the game's logic runs)
  happens only after their yes to a printout of exactly that change, and you do exactly what was printed. Every
  command that acts that way prints first and sends only with `--yes <code>`.
- **Custody.** Every key has one intended holder: the owner's key file on their machine, the live voucher key on
  xgames.fun, the test seed in `.dev.vars`. Its bytes anywhere else (the page, the game's folder or git, this chat, a
  log, a server that shouldn't hold it) are a leak. You never open, print, copy or ask for one.
- **Their game stays theirs.** The smallest change to their source; never their build's output, the kit's copies
  (`gf/loot/`, `gf/platform/`) or a rebuild through the creation loop. Say only what you know: never call an economy
  legal, safe, an investment or ready for real money.
- **A refusal is the rule.** When a tool, the host or the chain refuses (a sign-in not given, a launch not this key's,
  a check that fails), stop and tell them what it said, with the fix it names; never work around it.

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

**Full screen.** Most players meet a game in a post on X or on a phone, where it first shows in a small frame. When adopt
warns that the game has no way to go full screen, offer the person a button for it (their game, their call): a small
button in a corner of the first screen, big enough for a thumb, that calls `GamesFun.fullscreen()` from the click
(`gamesfun.js`, loaded by `xcore add signin`; Godot `await GamesFun.fullscreen()`; Unity `Screen.fullScreen`).
Pressed again it comes back. It answers `{on, how}`: on xgames.fun the page around the game goes full screen, or fills
the screen in an app's own browser (X's on a phone among them); on the game's own link the browser does; in a frame
that allows none (a post on X on a computer) the game opens in a tab of its own (`how: 'tab'`); an iPhone's Safari has
no full screen for a page (`how: 'none'`): there the button can hide, or say "Add to Home Screen".
`GamesFun.onFullscreen(on => …)` follows it (Esc, the browser's own controls). A game that goes full screen already
(its own button, or its engine's) needs nothing.

## 3. Check

```bash
xcore check <folder>            # with the kit's tools: gamesfun_verify {"dir": "<folder>"}
```

Four checks: it builds, it fits the hosting, the page starts (phone and desktop, under the play host's page policy, no
console errors, nothing missing, nothing from the root, something on screen), it stays inside its origins. Open the two
screenshots in `evidence/verify-N/` and look at them. Its report also says whether the game has a preview picture
(§7): a warning, never a failure. A failing check 4 names the origin and why: declare it in
`backend.json` if the game really calls it, or remove the call. The page check does not say the game plays well:
that is the person's own game; ask them what to try, and try it with `xcore dev <folder>` (the game as xgames.fun
hosts it, with its server, sign-in, saves, rooms and economy RPC, refusing what xgames.fun refuses on the Free plan;
`--plan creator` for a Creator game) or their own. A refusal there (`rate`, `full`, `too-many`, `order`) is one the
published game would get: fix the game, not the stand-in.

## 4. Players, a database, a backend (only when the game has or needs them)

- **Sign-in, saves, leaderboards** (a login, progress kept between visits, a high-score table): `xcore add signin
<folder>`. It works out the engine itself: a web game gets `gamesfun.js` loaded in its page, a Godot 4 project the
  `GamesFun` autoload, a Unity project `Assets/Plugins/GamesFun/`. Replace the game's own login, its local save file
  or its localhost leaderboard with these calls (listed at the top of the file it writes); sign-in starts from a click,
  and when `onCode` / `sign_in_code` / `SignInCode` fires with `window: false`, the game shows the code and the site;
  with `window: true` the player has a way to sign in on screen (a window, or the small panel `gamesfun.js` draws
  where none opens), so at most a quiet line, never an overlay over the game.
  Read the player after `GamesFun.ready` and follow `onChange` / `player_changed` / `PlayerChanged`, never only the
  answer of the sign-in call: on the game's own host (`<name>-play.xgames.fun`, where a post's card on X and
  xgames.fun's wallet hand-off open it) xgames.fun is asked who is here as the page loads, and a player who chose this
  game in this browser is signed in with no tap. There **the tap on Sign in takes the tab to X and back, on a phone and
  a computer, so the game starts again**, signed in: call `signIn` in the click handler itself, nothing awaited
  before it; `GamesFun.signInEnded` says `'cancelled'` or `'failed'` when it came back with nobody. Tell the person
  that; if their game cannot start again at that moment (a run in progress with nothing saved), either sign in before
  play starts or pass `stay: true` (`GamesFun.signIn({stay: true})`, `sign_in("x", true)`, `SignIn("x", true)`), which
  opens a window instead. Sign out (`GamesFun.signOut()`) tells xgames.fun to forget the game in that browser. A game
  that drew its own button as a link takes its address from `GamesFun.signInLink('x')`. A game whose `gamesfun.js` is
  older than 1.9.0 gets none of this until `xcore add signin` brings the file up to date and it is published again.
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
- **Server logic xgames.fun runs for them**: `server/index.js` and `gamesfun.json` → `server`
  ([docs/SERVER.md](../../docs/SERVER.md)): a Worker on `/api/*`, Durable Objects for rooms, `env.GF` for sign-in, saves
  and scores. Their page calls it with a relative address (`fetch('api/scores')`): `/api/*` at the published origin,
  `/game/api/*` under `xcore dev`, which runs it under workerd with a local `env.GF`. A Node-only server stays on
  their own host, and so does anything that opens raw sockets (a database driver, a mail or chat client): xgames.fun
  refuses `cloudflare:sockets`, `node:net` and the like, an `import()` of a name made at run time, and `nodejs_compat`.
  Every route that does work checks the player's token first (`env.GF.verifyPlayer`; 401 at once without one): a
  stranger's request that does work counts toward what caps the game. Key a player's data on `sub` (the account:
  `x:…`, or `g:…` for Google, different in every game), never on the wallet; `wallet` is its own claim, maybe null.

## 5. An economy (only when they ask: tokens, NFTs, a shop, prizes, staking)

Before designing one, tell the person plainly: loot boxes, raffles, lotteries, prize pools, tokens and staking are
regulated in many places (gambling, securities, money transmission, consumer and tax law); making sure their game is
legal where they and their players are is their responsibility, and you are not giving legal advice. The program is
not independently audited. An economy is on devnet, where nothing has real value, unless its `xsolana.json` says
`"network": "mainnet"`: write that only when the person asks for mainnet in their own words, and tell them first that
it is real money and what is sent can be lost. The README's "Disclaimer and responsible use"
section says it in full.

```bash
xcore loot add <folder>         # or gamesfun_loot_add {"game": "<folder>"}
```

It says where `xsolana.json` goes (the `static` folder of a build project). Design the economy with the
`xsolana-economy` skill and the `xsolana_*` tools (`xcore loot connect` adds them: `xsolana_guide`,
`xsolana_examples`, `xsolana_check`, `xsolana_simulate`, then `xsolana_save` into that file); fix every refusal
`xsolana_check` gives and tell the person its warnings in plain words. When they want a token, that skill's "When they
ask for a token" says which of the kinds it is: a token the economy makes (named on chain as it goes live: ask for its
name, its ticker and a picture's link first), a coin made elsewhere (`xcore loot token <mint>` reads its whole entry
from the chain: never type its decimals or powers), or a coin people trade, which loot does not make (once the game is
published, `xcore coin launch` launches one for it, §8; then it is a coin made elsewhere). Then run `loot add` again: it copies the page
client into `gf/loot/` beside it. Wire it into their page the way that README's §4 shows (a run-time import with a
page-relative URL, `solanaApp` with `rpcUrl: PAGE_RPC`); a Godot or Unity game (or any page with `gamesfun.js`) uses
`GamesFun.loot` instead (`loot_ready`/`loot_connect`/`loot_call` in Godot, `LootReady`/`LootConnect`/`LootCall` in
Unity). A browser with no wallet is told so, with the game still playable. A game with a claim (anything the player
claims to their wallet) calls `GamesFun.walletNeeded()` when it shows the Claim button, and when no wallet is in the
browser (X's own browser, from a post in X's app) and `GamesFun.canOpenWallet()` is `true`, its button calls
`GamesFun.openWallet('phantom', {view: 'claim', href})` (or `'solflare'`) inside the tap itself, with no `await` or
timer before it. The same button works in both places a player meets the game: inside xgames.fun's play page the page
opens the wallet app; on the game's own host as the whole tab (a post's card on X opens it there) the tab goes to
xgames.fun's wallet page and comes back signed in. When it is not `true` (a frame inside X's timeline, another site),
the game shows its own fallback (its link to copy); never build wallet links in the game. README §3, "A wallet app,
for a claim", has the button. `xcore dev <folder>` runs the page and
`server/` against devnet; the economy's calls answer only once it is live there (devnet's test SOL: an economy put
live to try it is one the person can put live again later). Going live is signed by a key file on the person's own
machine, after their yes, and you open no signing page: `xcore loot keygen ~/.config/xsolana/<game>.json` makes the
key for a new economy (it prints the address, which they send the devnet SOL `xcore loot cost` names, with any coin
or NFT the setup takes from them); `xcore loot approve --keypair <that file>`, in the folder with `xsolana.json`,
prints everything it would send, with a code, and sends nothing; you run it again with `--yes <code>` only after
they have read that printout and said yes. On mainnet the printout opens with "MAINNET: … real SOL" and the code
starts with `mainnet-`: read that first line to them too. The key file owns the project, for good: every later change is signed by
it, and nothing restores a lost one (custody, above). Say this to the person once, with where what the economy earns
lands (the key's address, unless `xsolana.json` names a `treasury`: ask for a wallet address of theirs first). An
economy that is already live is changed only by the key that owns it. A
browser wallet's page (`xcore loot approve --browser`) only when they ask for one, or when a browser wallet owns
the project: they run it themselves. The xsolana-economy skill has the whole of it.

Paying a result has two signers (docs/SERVER.md, "Paying a result", has the rule): xgames.fun's keeper, when the
server already decides who won and the prize is fixed by place (the server calls `env.GF.loot.report`; the owner
certifies the host key in Studio once, and nobody keeps a key), or the server's own key, when the amount depends on
the result, when the server replays or bounds runs, for entry fees or a prize pool, or past 120 results an hour. For
the own key, run `xcore add vouchers <folder>`: it writes `server/vouchers.js` and a test key for `xcore dev` (its
seed in `.dev.vars`, kept out of git). Then, in order: write `PAY.check` with the person (what their server checks
before it pays; nothing is paid until it is written) and count payouts in `PAY.paid`; they publish; they run `xcore
secret set VOUCHER_SEED --new-key` (the live key: made here, sent to xgames.fun only and never kept on their machine; it prints the address);
that address goes in the grant's `vouchers` (`xcore loot check`); the change goes live (`xcore loot approve`, the
same key file, after their yes) and they publish again.

What a payout rests on is lenses 5 and 3 applied to every route that pays (docs/SERVER.md, "What a payout rests
on"): list each input that decides who is paid, how much and for which round, and where it is held (the chain, state
the server keeps, or the request: whatever the request decides, a cheater decides). Then the ceiling: the identities
one person can make × what each may take × time. Bound it with what the platform gives (`VOUCHERS.payOnly`, a grant's
`perDay` and `perPerson`, a board the server writes: `env.GF.scores.setup(board, {writer: 'server'})`), or tell the
person what a cheater gets. A bounded result earns small capped amounts; entry fees and prize pools need a decided or
replayed one. Without a server, offer what the player pays for or the chain decides (a shop, boxes, raffles, staking,
perks), and say why.

## 6. Review (a game whose server pays results)

Before publishing a game that pays results, read it as a cheater would:

```bash
xcore review <folder>           # evidence/review-N/review.md and review.json; exits 1 on a high finding
xcore loot review               # the economy's part alone (@xgamesfun/solana's xsolana_review)
```

- **Fix every high finding** (a `PAY.check` that pays from the request alone, a route anyone can call, a seed in the
  page, `.dev.vars` in git…), and run it again. Mediums are the person's to decide with you: say each one plainly.
- **Declare `trust` honestly** on every grant a voucher pays: `"decides"` (the server runs the game; the page sends
  only inputs), `"replays"` (the server runs the page's inputs again) or `"bounds"` (the page plays and reports; the
  server checks its clock, order and caps). It is what `PAY.check` really does, not what you hope it does: a server
  that times a run the page simulated is `bounds`, whatever it is called.
- **Tell the person**, in plain words, from the end of `review.md`: for each paid route, the level it uses, what a
  cheater gets (a bounded result pays a script that waits and reports, without playing; a decided one pays what a bot
  that plays well wins), and what the stronger level would cost to build (replaying: a deterministic step and about
  3 ms of CPU a second played; deciding: the rules moved to the server, a request each step). Let them choose: a
  smaller prize and tighter caps, or the stronger level. Never call a bounded result safe.

After publishing, `xcore review <folder> --live` asks the published game as a stranger (no sign-in, a forged one;
nothing it sends can spend or sign) and checks its voucher key and economy against the folder. Under `xcore dev`,
give its address: `--live http://127.0.0.1:<port>/game/`. `xcore publish` reminds you when the economy or `server/`
changed since the last review.

## 7. Its preview picture (before the first publish)

A link to the game, shared on X or in a chat, shows a square card: the game's own picture behind "XGames.fun" and its
title (drawn large across the top band) and a "Tap to play" button (bottom left). The picture is `assets/card.jpg` (or
`assets/card.png`) in the published files, best a 960×960 JPEG. With none, or one xgames.fun cannot draw (over
1,500,000 bytes, not a JPEG or PNG, a PNG named `.jpg` or a JPEG named `.png`, cut short, a kind of JPEG it does not
draw), the card is a plain gradient and `xcore publish` stops before anything goes up (code `card`; `card` in the JSON
says what it found). One it draws but small (under 600 px a side: blurry) or far from square (cropped to its middle)
goes up with a warning and its fix.

```bash
xcore card <folder>                      # a picture of the game as it plays, at 960×960
xcore card <folder> --tap --wait 6       # a game that starts on a tap, or takes longer to show something
xcore card <folder> --from key-art.png   # from a picture they have: scaled to cover, cropped to the middle
```

Then **open the picture and look at it** (read the image file): a loading screen, a blank page or a menu makes a poor
card, and so does a page that had errors (xcore card says so and fails unless `--force`). Try `--wait`, `--tap` or
`--path <page?query>`, or ask the person for key art or a screenshot (`--from`, then `--force` to replace the one
there; `--from assets/card.jpg --force` re-crops theirs in place). Keep the subject clear of the top third (the title)
and the bottom left (the button). For a game with a build it writes into the folder the build copies as it is
(`page.static`, such as `public/`), so the build carries it into what is published; it says where, and for a build
with no such folder it writes nothing and says where the picture has to live. Only when the person says they want no
picture: `xcore publish <folder> --no-card`, or `"card": false` in `gamesfun.json` so they are not asked again. A link
shared before can keep its old card for a while (X and chat apps cache it).

## 8. Publish (only when they ask)

```bash
xcore card <folder>             # once, before the first publish (§7); look at it
xcore publish <folder> --check  # the offline part: what goes up, what refuses it, its preview picture
xcore publish <folder>          # or gamesfun_login, then gamesfun_publish {"game": "<folder>"}
```

It builds, runs the page check on exactly those files, uploads the published folder and the `server/` bundle. A failed
check makes a private draft only. With no preview picture xgames.fun can draw it stops before anything goes up (code
`card`; `next` is the command that fixes it, when there is one): fix it or make one (§7) rather than reaching for
`--no-card`. `xcore login` asks the person to tick, on xgames.fun's approval page, the games this
computer may work on (or their whole account), and says which it got; a command refused with code `not-granted` means
the sign-in was not given that game: they run `xcore login` again and tick it. Tell them the link, what you changed in their files, what the checks proved and what
nothing checked (their gameplay, their backend's own behaviour).

A game with a `server/`, saves or scores runs under its **plan** (`xcore plan <folder>`): Free by default (50 ms of CPU
and 600 requests a minute, $1 of use a month; past it the game is capped until the month ends: its server is switched
off and saves and scores slow down). When the game needs more
(a server that replays play, many players at once), tell them: a paid slot makes it Creator
(`xcore plan activate <folder>` once they have one), and the paid slot moves between their games at any time. Everyone
has 2 free slots: a third game is refused on publish (`no-free-slot`) until they archive one on their console
(xgames.fun/console) or move one to a paid slot. Activating, deactivating or archiving a game is theirs (consent, above).

Their own website can show the game (`xcore embed add https://theirsite.com <folder>` prints the `<iframe>`), and on
Creator or Scale it can play at their own domain (`xcore domain add play.theirsite.com <folder>` prints two DNS records
they add where their domain's DNS is; `xcore domain check …` once they have). Both are theirs to ask for (consent,
above). A domain needs `gamesfun.js` 1.2.0+ in the page (`xcore add signin`, then publish).

**A coin that trades (only when they ask for one).** For a published game, `xcore coin` says where its coin stands
and what a launch can choose from (Meteora or pump.fun, what each pairs a coin with, the pictures among the published
files). Ask for the coin's name, its ticker (2 to 10 letters or digits) and which picture; then `xcore coin launch --name … --ticker … --picture
<file> --keypair <key file>` prints the whole launch with a code and sends nothing. Show them that printout. Run it
again with `--yes <code>` only after they have read it and said yes: a game has one coin, for good, and anyone can
trade it from the moment it lands. The key file is one made on their machine (`xcore loot keygen`, or the one their
economy went live with), holding about 0.03 devnet SOL; the coin's creator fees belong to its address. Open no signing
page; the game's console (Token tab) is the browser wallet's way, theirs to use. If xcore refuses the launch
xgames.fun built ("is not one this key signs"), stop and tell them what it said. Then
`xcore loot token <mint>` gives the coin's entry for `xsolana.json`. A devnet coin trades nothing of value; never
call a coin an investment or say what it will be worth.

## Never

What the method and the three invariants at the top forbid, in one place: building a paid flow as named without the
trade, or calling it done without the lenses; acting before a yes to the printout; a key anywhere but with its holder;
changing more of their game than the change needs; and saying more than you know about money or the law.
