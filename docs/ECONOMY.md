# An economy (web3)

> **Read [DISCLAIMER.md](DISCLAIMER.md) before you build an economy.** Loot boxes, raffles, lotteries, prize pools and
> tokens are regulated in many places, and on-chain transactions cannot be undone.

A game's economy runs on loot, one shared Solana program, on devnet by default and on mainnet when its `xsolana.json`
says `"network": "mainnet"` (real money; loot is not independently audited): shops, loot boxes, raffles and lotteries,
prize pools, staking, crafting, perks for holders, rewards a player claims. Its tools come with this package
(`@xgamesfun/solana`, [`xsolana`](https://github.com/XGamesFun/solana-kit), which `xcore loot` runs). Before an
economy, a draw or anything a player pays for, read [BEFORE-YOU-BUILD.md](BEFORE-YOU-BUILD.md).

- [The tools](#the-tools)
- [Tokens](#tokens)
- [Adding it to a game: `xcore loot add`](#adding-it-to-a-game-xcore-loot-add)
- [Going live](#going-live)
- [When loot is upgraded](#when-loot-is-upgraded)
- [What a page alone can pay safely](#what-a-page-alone-can-pay-safely)
- [Paying a result: the keeper or your own key](#paying-a-result-the-keeper-or-your-own-key)
- [Review: `xcore review`](#review-xcore-review)
- [A coin that trades: `xcore coin`](#a-coin-that-trades-xcore-coin)

## The tools

`xcore loot connect` adds them to Claude Code or Codex: the `xsolana_*` MCP tools and the `xsolana-economy` skill, which
turn a one-line idea into a checked economy. `xsolana_check` refuses what would fail or lose money on chain (a prize a
pool cannot pay, a pool nothing fills, a farm that empties a lottery, a claim with no limit), `xsolana_simulate` shows
where the money goes day by day, and `xsolana_cost` what going live costs. `xcore loot check|simulate|cost|explain` runs
the tools from a terminal. Where `@xgamesfun/solana`'s help says `xsolana <command>`, run `xcore loot <command>`.

## Tokens

An economy's tokens are of three kinds, and the `xsolana-economy` skill asks which one is meant ("When they ask for a
token"):

- **A token the economy makes** (`"source": "project"`): points, tickets and shards the project mints as its rules
  say, or with `supply` a fixed supply minted once to your wallet and never again. It is named on chain as it goes
  live, so wallets show it by name: give it a `name`, a `symbol` and a `uri`, a link to a JSON file that names its
  picture (`{ "name": "Ember", "symbol": "EMBR", "image": "https://…/ember.png" }`), hosted anywhere that stays up.
  Without a `uri` it shows by name and ticker with no picture. Only your wallet can change the three afterwards.
- **A coin made elsewhere** (`"source": "existing"`): `xcore loot token <mint>` reads it from the chain and prints its
  whole entry for `tokens`, with what its mint's own keys can do (mint more, freeze an account, keep a fee on every
  transfer), so nothing is typed by hand. Going live reads the mint again and refuses a spec that denies a power the
  mint has.
- **A coin people trade** is not something loot makes: it runs no market. Once the game is published,
  `xcore coin launch` launches one for it on Meteora or pump.fun ([below](#a-coin-that-trades-xcore-coin)), or launch
  it anywhere else; either way the economy then names it as a coin made elsewhere.

## Adding it to a game: `xcore loot add`

`xcore loot add <folder>` says where the economy goes (`xsolana.json` in the `static` folder) and, once it is there,
copies the page client beside it (`gf/loot/`, a copy: never edit it; publish keeps it current). The page wires it
through `GamesFun.loot` (any engine, and every economy on mainnet) or loads `gf/loot/` by hand:
[CLIENT.md](CLIENT.md#the-economy-gamesfunloot-and-gfloot) has both. In a Godot or Unity project the two live in the
project's own `gamesfun/` folder, out of the engine's export (same place).

## Going live

Going live is signed by a key file on your own computer. `approve` first shows everything it would send, with a code,
and sends nothing; run again with that code, it sends exactly what it showed:

```bash
xcore loot keygen ~/.config/xsolana/my-game.json                 # a key for the game: prints its address, never the key
xcore loot approve --keypair ~/.config/xsolana/my-game.json      # in the folder with xsolana.json: everything it would send
xcore loot approve --keypair ~/.config/xsolana/my-game.json --yes <code>   # sends exactly that
```

On mainnet (the economy's `xsolana.json` says `"network": "mainnet"`) the printout opens with a line saying it is real
SOL and real tokens, and its code starts with `mainnet-` (`--yes mainnet-1a2b3c4d`): typing it back is a step beyond the
file's own word.

Send the address `keygen` prints the devnet SOL `xcore loot cost` names (and any coin or NFT the setup takes from you: it
must be at that address first). The key file is the project's owner, for good: whoever can read it controls the
project, every later change is signed by it, and nothing restores a lost one. Keep it outside the game's folder and out
of git (the tools refuse one inside a repository, and `xcore publish` refuses to upload one), back it up yourself, and
never paste it anywhere. Unless `xsolana.json` names a `treasury`, what the economy earns for you lands at the key's
address. Why a key file: it is a new key that has never held anything else, so the wallet that holds what you own is
never connected, and it signs each transaction exactly as it was shown, with no page. To sign in a browser wallet
instead, go live in one: run `xcore loot approve --browser` yourself and approve on the page it serves. An economy that
is live is changed only by the key that owns it.

The economy's reads go through xgames.fun's shared relay; going live does not, because the relay passes only loot's own
transactions and a setup also makes mints and token accounts. So `approve` sends through `XSOLANA_RPC_URL` when it is
set, else through Solana's public devnet RPC. Where that one refuses you (it limits each address, and some networks
block it), set `XSOLANA_RPC_URL` in `.env` to a devnet RPC of your own.

## When loot is upgraded

This package pins the tools for one build of loot (the one its `@xgamesfun/solana` dependency names), at loot's official
addresses: `xgamesVsZBpCVgJuatfYAFJRmQoccfQf5qtUFNp2Eet` on devnet and `xgames8C758PyweWB9sDw8evvwsTVwyA2fGRUeAXVPy` on
mainnet. When a new build cannot read the projects, grants, lotteries and orders an earlier one made at the same
addresses, an economy that was live goes live again (`xcore loot approve`; remove its file's old live section to set it
up anew). A game with its own `server/rpc.js` (`xcore add rpc`) lists the programs it may scan in `scanPrograms`: when
loot moves to a new address, put the new one first there. The next publish brings `gf/loot/` up to the installed
package. **Nothing runs by itself** on chain: the page client sends what a player needs (settles, refunds, claims, a
draw that is due); a schedule's runs are the project's own steps, and a run nobody sends is missed.

## What a page alone can pay safely

A game that runs only in the browser can't prove what a player did there: anyone can change its score in the console.
So from the page alone, offer what the player pays for or the chain decides (a shop, boxes, raffles, lotteries,
staking, crafting, perks for holders). A reward for a result (a score, a win, a level) is a grant claimed with a
voucher, and the voucher key must never be in the page (publish refuses a key it finds): the game's server checks the
result, and then one of two signers vouches for it.

## Paying a result: the keeper or your own key

When the server already decides who won and the prize is fixed by place (a room's winner, a match's top three), it
reports the winners with `env.GF.loot.report` and xgames.fun's keeper signs, with no key for you to keep. When the
amount depends on the result (paid by score), when the server replays or bounds runs before paying, when there are
entry fees or a prize pool, or when results come faster than 120 an hour, give the server its own key:
`xcore add vouchers` writes `server/vouchers.js` (its `PAY.check` is what your server checks) and a test key in
`.dev.vars` for `xcore dev`. In order: write `PAY.check`, `xcore publish`, `xcore secret set VOUCHER_SEED --new-key`
(the live key: made here, sent only to xgames.fun and never kept on your machine; it points the grants `PAY.check`
names at it in `xsolana.json`), `xcore loot approve`, `xcore publish`
([SERVER.md](SERVER.md#your-own-key-xcore-add-vouchers), "Your own key", has each step). A voucher pays only a wallet
the player proved is theirs (signed in with it, or linked with `gf.loot.link()`), and since a wallet is free, pay
rewards worth farming only to players signed in with X (`VOUCHERS.payOnly`). A grant names up to three keys, so the
keeper and your own can pay the same grant while you move from one to the other.
[SERVER.md](SERVER.md#paying-a-result-xgamesfuns-keeper-or-a-voucher-key-of-your-own), "Paying a result", has both,
side by side.

## Review: `xcore review`

A game that pays is read the way a cheater reads it before players are paid. `xcore review <folder>` writes
`evidence/review-N/review.md` and `review.json`, prints what it found, and exits 1 on any high finding:

- **The economy**: `@xgamesfun/solana`'s own review (`xcore loot review`): each route that pays, what it trusts, its
  ceiling, and the trade-offs in words. An installed version without it says so in one line, and the rest goes on.
- **The server**, as two analyses. The **payout ledger**: for each route that pays, who signs it (the server's own key,
  the keeper, a key the game's code holds, or nothing), what decides it (no check yet, the request alone, or state the
  server keeps), who is paid (a proven wallet, or one the code or the request names), the identity its limits count
  (`VOUCHERS.payOnly`: a wallet, which is free; an X or Google account; an X account), its limits, its `trust` declared
  and observed, and its **ceiling**: what one person can take, identities × limit for each × time. Its findings are
  `payout-input` (the request decides something a cheater shouldn't), `payout-ceiling` (unbounded, high; or bounded only
  by a total every player shares, medium), `payout-signer` (nothing signs it, or what it signs can't be claimed) and
  `payout-trust` (the trust declared is missing, unknown, or not what the code does). **Key custody**: for each key (the
  test key in `.dev.vars`, the live key on xgames.fun, any key or seed in the page's files), every place its bytes are
  (tracked by git, not ignored, in a served folder, in the page's files, named by a grant) and who can read it; each
  place outside its one holder is a `key-custody` finding, a level higher when the key signs on mainnet. Besides
  them: a server that works before checking a player's token, and every `api/` route the code names.
- **Live** (`--live`, after publishing; `--live <origin>` for another, such as `xcore dev`'s
  `http://127.0.0.1:<port>/game/`): each of those routes asked with no sign-in and with a forged one, GET and POST (a
  route that pays gets an empty body: nothing it sends can spend or sign); `api/vouchers/key` against the grants' keys;
  the published economy's `live` against the folder's.

Each grant a voucher pays says how much its server checks before signing: `"trust": "decides"`, `"replays"` or
`"bounds"` ([SERVER.md](SERVER.md#what-a-payout-rests-on), "What a payout rests on"). `review.md` ends with the
trade-offs for the person: for each paid route, its level, what a cheater gets, and what the stronger level would cost.
It opens with two blocks for the agent to pass on: "Ask the person" (questions whose answers change the design) and
"Tell the person, as written" (final sentences: the economy check's own, each paid route's ceiling, keys out of place,
and what stops when the plan caps the server), also in `review.json` as `ask` and `tell`. `xcore publish` says when a
game that pays through vouchers changed since its last review (it never refuses for it).

## A coin that trades: `xcore coin`

A coin people can buy and sell, for a published game: on Solana devnet by default, to rehearse, and on mainnet (real
money) with `--cluster mainnet` where xgames.fun has mainnet launching on. loot runs no market, so the coin is launched
on a venue through xgames.fun's launchpad: **Meteora** (a curve of its own, then a pool; you keep 90% of its trading
fees after Meteora's own cut) or **pump.fun** (its curve; you keep 90% of the creator fee). xgames.fun never takes more
than 10% of a coin's creator fees, and xcore refuses to sign a launch that gives it more. A game has one coin on each
cluster, and its name and ticker stay as launched.

```bash
xcore coin                      # where the game's coin stands; the venues, their pairs, the pictures to choose from
xcore loot keygen ~/.config/xsolana/<game>.json    # a key file (or the one the game's economy went live with)
xcore coin launch --name "Moth Coin" --ticker MOTH --picture art/coin.png --keypair ~/.config/xsolana/<game>.json
xcore coin launch … --yes <code>                   # the same command, with the code the first run printed
```

- **The picture** is a PNG, JPEG or WebP among the published game's files (`xcore coin` lists them); the coin's link
  is the game's own play link.
- **The key file** signs and pays (about 0.03 SOL on the cluster), on your machine: no browser page opens. The coin's
  creator fees belong to its address for good, so keep the file, and a copy somewhere safe.
- **Nothing is sent by the first run.** It prints the launch (every choice, the key's address and what it holds, what
  can't be undone) and a code, and keeps the plan in the folder (`.gamesfun/coin-plan.json`). The same command with
  `--yes <code>` launches it, held to that kept plan choice by choice (also the venue and pair xgames.fun chose by
  default, and whether it is a new launch or the rest of one); a code printed for other choices sends nothing.
- **xgames.fun's launchpad builds the launch's transactions**, and the code you approve covers only your own
  choices. So before the key signs, xcore reads every transaction and holds it to the launch the first run printed
  ([`lib/coin-check.mjs`](../lib/coin-check.mjs) has the whole rule, and says what it does not read):
  - only the instructions a launch on that venue is made of, each once and in order, with exactly the accounts its
    program takes, and the key, the coin and the pair in the places the program reads them;
  - one coin whose own new key signs (the signature is checked), with the plan's name, ticker and link, byte for
    byte, paired with what the plan said, and this key as its creator;
  - on Meteora: no fee for making the pool or for moving to it, at least 90% of the creator's side of trading fees
    and of liquidity to this key, the launchpad's part of the liquidity locked, a fixed supply, and nobody able to
    mint more of the coin or rename it; on pump.fun: none of its optional modes, and at least 90% of the creator fee
    to this key;
  - no buy, nothing of the System or Token programs (so no move of the key's SOL or of a token it holds), a token
    program (and on pump.fun Token-2022 for the coin) in every place an instruction reads one, the key's share of a
    pump.fun fee paid to the key's own account, no change to another coin of the key's, nothing that names loot (the
    game's economy, which the same key may own), no lookup table, and at most 0.1 SOL in fees of the key's own.
- **The cluster is asked, too.** Nothing in a transaction names its cluster, so before the key signs, an RPC of the
  launch's cluster (devnet, or mainnet with `--cluster mainnet`, held to mainnet's first block) is asked. On devnet: a
  devnet RPC is asked that each transaction's blockhash is one of devnet's and that the coin's address holds nothing
  yet. It is your own RPC when `XSOLANA_RPC_URL` is set, else Solana's public one, and never xgames.fun's (the same
  party as the launchpad: it may show the key's balance in the plan, never decide a signature). When none answers, or
  `XSOLANA_RPC_URL` is set to something that can't be used, nothing is signed: Solana's public RPC limits how often one
  address asks, so a devnet RPC of your own makes a launch steadier.
- **Mainnet** (`--cluster mainnet`): real money. A game has one mainnet coin besides its devnet one; the plan opens
  with "MAINNET: REAL MONEY", the code covers the cluster, and every call to xgames.fun names it. Mainnet is checked
  through your own mainnet RPC (`XSOLANA_RPC_URL`) or Solana's public mainnet RPC, never xgames.fun's. Selling a token
  to the public is regulated in most places: that is yours to check before you launch one.
- **What is not read**, and is xgames.fun's to get right: the picture and the description (they are what the coin's
  link serves), and on Meteora the curve's shape (its prices, how the supply is spread along it, its fee schedule).
  And the check leans on each venue's program doing what its instruction says: those take rent for the coin's own
  accounts (about 0.02 SOL).
- Anything else is refused in words that say what it held, nothing is signed, and the launch is given up. After a
  launch is handed in, what was sent is xgames.fun's to say: `xcore coin` asks it where the launch stands, and says so
  plainly when the coin it names is not the one this folder's key launched (`.gamesfun/coin.json`). Its `--json`
  escapes every character that would hide or move text in a terminal.
- `xcore coin drop` gives up a launch that was begun and never sent. `--venue pumpfun` and `--pair <SYMBOL>` choose
  the other venue and what the coin trades against (the default: Meteora, SOL). The ticker is 2 to 10 letters or
  digits, launched in capitals; `--symbol` is another name for `--ticker`. `--description <text>` gives the coin a
  description. xgames.fun lets an account launch three coins a day.
- Then name the coin in the economy: `xcore loot token <mint>` prints its entry for `xsolana.json`'s `tokens`.

The same from a browser wallet: the game's console (xgames.fun/console), Token tab. A devnet coin trades nothing of
value. Selling a token for real money is regulated in most places: that is yours to check before any mainnet, and
nothing here is legal advice.
