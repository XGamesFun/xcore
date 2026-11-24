# An economy (web3)

> **Read [DISCLAIMER.md](DISCLAIMER.md) before you build an economy.** Loot boxes, raffles, lotteries, prize pools and
> tokens are regulated in many places, and on-chain transactions cannot be undone.

A game's economy runs on loot, a single Solana program that every project shares. An economy can include shops, loot
boxes, raffles and lotteries, prize pools, staking, crafting, perks for holders, and rewards that players claim.

- It runs on **devnet** by default.
- It runs on **mainnet** only when its `xsolana.json` says `"network": "mainnet"`. Mainnet means real money, and loot
  has not been independently audited.

The tools ship with this package as `@xgamesfun/solana` ([`xsolana`](https://github.com/XGamesFun/solana-kit)), and
`xcore loot` runs them. Before you build an economy, a draw or anything a player pays for, read
[BEFORE-YOU-BUILD.md](BEFORE-YOU-BUILD.md). For every cost involved (loot's fees, randomness, a coin launch, Metaplex's
NFT fee, hosting), see [FEES.md](FEES.md).

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

`xcore loot connect` adds the tools to Claude Code or Codex: the `xsolana_*` MCP tools and the `xsolana-economy`
skill. Together they turn a one-line idea into a checked economy.

| Tool               | What it does                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `xsolana_check`    | Refuses what would fail or lose money on chain: a prize a pool cannot pay, a pool nothing fills, a farm that empties a lottery, a claim with no limit. |
| `xsolana_simulate` | Shows where the money goes, day by day.                                                                                                                |
| `xsolana_cost`     | Shows what going live costs.                                                                                                                           |

From a terminal, run `xcore loot check|simulate|cost|explain`. Where `@xgamesfun/solana`'s help says
`xsolana <command>`, run `xcore loot <command>` instead.

## Tokens

An economy uses three kinds of token. The `xsolana-economy` skill asks which kind you mean (its section "When they ask
for a token").

- **A token the economy makes** (`"source": "project"`). Points, tickets and shards that the project mints as its
  rules say. With `supply`, it is a fixed supply, minted once to your wallet and never again.
  - The token is named on chain when the economy goes live, so wallets show it by name. Give it a `name`, a `symbol`
    and a `uri`.
  - The `uri` is a link to a JSON file that names its picture, for example
    `{ "name": "Ember", "symbol": "EMBR", "image": "https://…/ember.png" }`. Host it anywhere that stays up.
  - Without a `uri`, wallets show the name and ticker with no picture.
  - Only your wallet can change these three fields later.
- **A coin made elsewhere** (`"source": "existing"`). `xcore loot token <mint>` reads the coin from the chain and
  prints its full entry for `tokens`, so you type nothing by hand. The entry includes what the mint's own keys can do:
  mint more, freeze an account, or keep a fee on every transfer. Going live reads the mint again, and refuses a spec
  that denies a power the mint has.
- **A coin people trade.** loot does not make these, because it runs no market. Once the game is published,
  `xcore coin launch` launches one on Meteora or pump.fun ([see below](#a-coin-that-trades-xcore-coin)). You can also
  launch it anywhere else. Either way, the economy then lists it as a coin made elsewhere.

## Adding it to a game: `xcore loot add`

`xcore loot add <folder>` tells you where the economy file goes: `xsolana.json`, in the `static` folder. Once the file
is there, run it again and it puts the page client next to it, as `gf/loot/`: one bundled, minified client
(`play/index.js` and `chain/rpc.js`, about 0.5 MB with their shared chunk) and `wallets.js`. This is a managed copy:
never edit it. Running `xcore loot add` again is the update path: it rebuilds the copy when the installed
`@xgamesfun/solana` changed, and leaves it alone otherwise. Each publish does the same.

The page uses the client in one of two ways:

- through `GamesFun.loot` (any engine, and every economy on mainnet), or
- by loading `gf/loot/` directly.

[CLIENT.md](CLIENT.md#the-economy-gamesfunloot-and-gfloot) covers both. In a Godot or Unity project, both files live in
the project's own `gamesfun/` folder, outside the engine's export.

## Going live

Going live is signed with a key file on your own computer. The first `approve` shows everything it would send, along
with a code, and sends nothing. Run it again with that code to send exactly what it showed:

```bash
xcore loot keygen ~/.config/xsolana/my-game.json                 # a key for the game: prints its address, never the key
xcore loot approve --keypair ~/.config/xsolana/my-game.json      # in the folder with xsolana.json: everything it would send
xcore loot approve --keypair ~/.config/xsolana/my-game.json --yes <code>   # sends exactly that
```

On mainnet (the economy's `xsolana.json` says `"network": "mainnet"`), the printout starts with a line saying it uses
real SOL and real tokens, and the code starts with `mainnet-` (for example `--yes mainnet-1a2b3c4d`). Typing that code
back is an extra confirmation on top of the setting in the file.

Before you approve, send the address that `keygen` printed the devnet SOL that `xcore loot cost` names. If the setup
takes a coin or NFT from you, that must be at the address first too.

**The key file owns the project** until it hands the project to another key with `xcore loot handover`, which both
keys sign.

- Whoever can read it controls the project, and every later change is signed with it.
- Nothing can restore a lost key file.
- Keep it outside the game's folder and out of git. The tools refuse a key file inside a repository, and `xcore publish`
  refuses to upload one.
- Back it up yourself, and never paste it anywhere.
- Unless `xsolana.json` names a `treasury`, what the economy earns for you goes to the key's address.

Why a key file: it is a new key that has never held anything else, so the wallet that holds your assets is never
connected. It also signs each transaction exactly as shown, with no web page involved. The cost: it is a plain file,
so anything on your machine that can read it can sign as the project.

To sign with a browser wallet instead, run `xcore loot approve --browser` yourself and approve on the page it serves.
**For real money (mainnet), that is the safer choice:** the wallet that goes live owns the project, and a browser
wallet can keep its key on a hardware device (a Ledger, for example) instead of in a plain file. The tools have not
been tested with a hardware wallet.

Once an economy is live, only the key that owns it can change it, and `xcore loot handover` moves ownership to another
key (both keys sign, as the program requires).

The economy's reads go through xgames.fun's shared relay. Going live does not: the relay passes only loot's own
transactions, and a setup also creates mints and token accounts. So `approve` sends through `XSOLANA_RPC_URL` when it is
set, and through Solana's public devnet RPC otherwise. The public RPC limits each address, and some networks block it.
If it refuses you, set `XSOLANA_RPC_URL` in `.env` to a devnet RPC of your own.

## When loot is upgraded

This package pins the tools to one build of loot (the one its `@xgamesfun/solana` dependency names), at loot's official
addresses:

| Network | Program address                               |
| ------- | --------------------------------------------- |
| devnet  | `xgamesVsZBpCVgJuatfYAFJRmQoccfQf5qtUFNp2Eet` |
| mainnet | `xgames8C758PyweWB9sDw8evvwsTVwyA2fGRUeAXVPy` |

- If a new build cannot read the projects, grants, lotteries and orders that an earlier build made at the same
  addresses, an economy that was live must go live again (`xcore loot approve`). To set it up anew, remove the old
  live section from its file.
- A game with its own `server/rpc.js` (`xcore add rpc`) lists the programs it may scan in `scanPrograms`. When loot
  moves to a new address, put the new address first there.
- The next publish updates `gf/loot/` to the installed package.

**Nothing runs by itself on chain.** The page client sends what a player needs: settles, refunds, claims, and a draw
that is due. A schedule's runs are steps the project sends itself, and a run that nobody sends is missed.

## What a page alone can pay safely

A game that runs only in the browser cannot prove what a player did there: anyone can change the score in the browser
console. So a page on its own should offer only what the player pays for or the chain decides: a shop, boxes, raffles,
lotteries, staking, crafting, perks for holders.

A reward for a result (a score, a win, a level) is a grant claimed with a voucher. The voucher key must never be in the
page, and publish refuses a key it finds there. Instead, the game's server checks the result, and then one of two
signers vouches for it.

## Paying a result: the keeper or your own key

**xgames.fun's keeper.** Use it when the server already decides who won and the prize is fixed by place (a room's
winner, a match's top three). The server reports the winners with `env.GF.loot.report`, and xgames.fun's keeper signs.
You have no key to keep.

**Your own key.** Give the server its own key when any of these apply:

- the amount depends on the result (paid by score);
- the server replays or bounds runs before paying;
- there are entry fees or a prize pool;
- results come faster than 120 an hour.

`xcore add vouchers` writes `server/vouchers.js` (its `PAY.check` is what your server checks) and a test key in
`.dev.vars` for `xcore dev`. Then, in order:

1. Write `PAY.check`.
2. `xcore publish`.
3. `xcore secret set VOUCHER_SEED --new-key`. This makes the live key here, sends it only to xgames.fun and never keeps
   it on your machine. It also points the grants that `PAY.check` names at the new key in `xsolana.json`.
4. `xcore loot approve`.
5. `xcore publish`.

[SERVER.md](SERVER.md#your-own-key-xcore-add-vouchers) ("Your own key") has each step in detail.

A voucher pays only a wallet the player proved is theirs: they signed in with it, or linked it with `gf.loot.link()`.
Wallets are free to create, so pay rewards worth farming only to players signed in with X (`VOUCHERS.payOnly`). A grant
can name up to three keys, so the keeper and your own key can pay the same grant while you move from one to the other.
[SERVER.md](SERVER.md#paying-a-result-xgamesfuns-keeper-or-a-voucher-key-of-your-own) ("Paying a result") compares the
two side by side.

## Review: `xcore review`

`xcore review` is a pattern-based check of a game's economy and server code for payout and key-handling mistakes,
read the way a cheater would read it. It is not a security audit. It reads the code as text, by patterns, and runs none
of it, so a PASS is not proof that the game is safe to pay real money from. Run it before players are paid.

`xcore review <folder>` writes `evidence/review-N/review.md` and `review.json`, and prints what it found and one of three
verdicts (`verdict` in `--json`):

| Verdict      | Meaning                                                                  | Exit code |
| ------------ | ------------------------------------------------------------------------ | --------- |
| PASS         | no high finding in what it read, and every payout read through           | 0         |
| FAIL         | at least one high finding                                                | 1         |
| INCONCLUSIVE | no high finding, but a payout it could not read through; `ok` is `false` | 3         |

A payout is not read through when its code calls code the review did not follow (a package, or more than three calls
deep), or when PAY.check reads what it was handed by a computed key (`ctx[k]`, `ctx['bo' + 'dy']`,
`{ [k]: req } = ctx`, `Reflect.get(ctx, k)`). The review can't tell which field such code reads, so it never treats it
as state the server keeps. Write the field by name (`ctx.body`, `ctx.env.RUNS`), or check that code yourself.

What the page writes for its own player is never state the server keeps: a check that reads the player's saves
(`env.GF.saves`) or the page's `GamesFun.db` documents (the table `gf_docs`) reads player input, as it does when it
reads the request's body. Reading them never makes a payout safe: with no state the server keeps behind it, the payout
is the high finding `payout-input`.

The review covers three parts.

**The economy.** `@xgamesfun/solana`'s own review (also `xcore loot review`): each route that pays, what it trusts, its
ceiling, and the trade-offs in plain words. If the installed version has no review, the output says so in one line and
the rest of the review continues.

**The server**, as two analyses.

- **The payout ledger.** For each route that pays, it records:
  - who signs it: the server's own key, the keeper, a key the game's code holds, or nothing;
  - what decides it: no check yet, the request alone, or state the server keeps;
  - who is paid: a proven wallet, or one the code or the request names;
  - the identity its limits count (`VOUCHERS.payOnly`): a wallet, which is free; an X or Google account; or an X
    account;
  - its limits, and its `trust` as declared and as observed;
  - its **ceiling**: what one person can take, as identities × limit for each × time.

  Its findings:

  | Finding          | Meaning                                                                         |
  | ---------------- | ------------------------------------------------------------------------------- |
  | `payout-input`   | The request decides something a cheater should not control.                     |
  | `payout-ceiling` | Unbounded (high), or bounded only by a total that every player shares (medium). |
  | `payout-signer`  | Nothing signs it, or what it signs cannot be claimed.                           |
  | `payout-trust`   | The declared trust is missing, unknown, or not what the code does.              |

- **Key custody.** For each key (the test key in `.dev.vars`, the live key on xgames.fun, any key or seed in the page's
  files), every place its bytes are (tracked by git, not ignored, in a served folder, in the page's files, named by a
  grant) and who can read it. Each place other than its one intended holder is a `key-custody` finding, one level
  higher when the key signs on mainnet.

It also reports a server that does work before checking a player's token, and lists every `api/` route the code names.

**Live** (`--live`, after publishing; `--live <origin>` for another address, such as `xcore dev`'s
`http://127.0.0.1:<port>/game/`). It requests each of those routes with no sign-in and with a forged one, using GET and
POST. A route that pays gets an empty body, so nothing it sends can spend or sign. It also compares `api/vouchers/key`
with the grants' keys, and the published economy's `live` section with the folder's.

Each grant that a voucher pays declares how much its server checks before signing: `"trust": "decides"`, `"replays"`
or `"bounds"` (see [SERVER.md](SERVER.md#what-a-payout-rests-on), "What a payout rests on").

`review.md` is laid out as follows:

- It opens with two lists, also in `review.json` as `ask` and `tell`:
  - **"Questions to decide"**: questions whose answers change the design.
  - **"What this build allows"**: the economy check's own sentences, each paid route's ceiling, keys in the wrong
    place, and what stops when the plan caps the server.
- It ends with **"What a cheater gets, and the trade-offs"**: for each paid route, its level, what a cheater gets, and
  what the stronger level would cost.

`xcore publish` tells you when a game that pays through vouchers has changed since its last review. It never refuses a
publish for this.

## A coin that trades: `xcore coin`

`xcore coin` launches a coin that people can buy and sell, for a published game.

- It runs on Solana devnet by default, for a rehearsal.
- With `--cluster mainnet`, it runs on mainnet (real money), where xgames.fun has mainnet launching turned on.

loot runs no market, so the coin is launched on a trading venue through xgames.fun's launchpad:

| Venue        | How it trades              | Your share                                              |
| ------------ | -------------------------- | ------------------------------------------------------- |
| **Meteora**  | its own curve, then a pool | 90% of the coin's trading fees, after Meteora's own cut |
| **pump.fun** | pump.fun's curve           | 90% of the creator fee                                  |

xgames.fun never takes more than 10% of a coin's creator fees, and xcore refuses to sign a launch that gives it more. A
game has one coin on each cluster, and its name and ticker cannot change after launch.

```bash
xcore coin                      # where the game's coin stands; the venues, their pairs, the pictures to choose from
xcore loot keygen ~/.config/xsolana/<game>.json    # a key file (or the one the game's economy went live with)
xcore coin launch --name "Moth Coin" --ticker MOTH --picture art/coin.png --keypair ~/.config/xsolana/<game>.json
xcore coin launch … --yes <code>                   # the same command, with the code the first run printed
```

### What you choose

- **The picture** is a PNG, JPEG or WebP among the published game's files (`xcore coin` lists them). The coin's link is
  the game's own play link.
- **The key file** signs and pays (about 0.03 SOL on the cluster) on your machine. No browser page opens. The coin's
  creator fees belong to its address permanently, so keep the file, and a backup somewhere safe.
- `--venue pumpfun` picks the other venue, and `--pair <SYMBOL>` picks what the coin trades against. The default is
  Meteora, against SOL.
- The ticker is 2 to 10 letters or digits, launched in capitals. `--symbol` is another name for `--ticker`.
- `--description <text>` gives the coin a description.
- xgames.fun lets an account launch three coins a day.

### How a launch is confirmed

- **The first run sends nothing.** It prints the launch (every choice, the key's address and what it holds, and what
  cannot be undone) and a code, and saves the plan in the folder (`.gamesfun/coin-plan.json`).
- **The same command with `--yes <code>` launches it.** It is held to the saved plan, choice by choice, including the
  venue and pair xgames.fun chose by default and whether it is a new launch or the rest of an earlier one. A code
  printed for other choices sends nothing.
- `xcore coin drop` abandons a launch that was started and never sent.

### What xcore checks before the key signs

xgames.fun's launchpad builds the launch's transactions, and the code you approve covers only your own choices. So
before the key signs, xcore reads every transaction and holds it to the launch the first run printed.
[`lib/coin-check.mjs`](../lib/coin-check.mjs) has the full rule, and says what it does not read. Each transaction must
have:

- only the instructions a launch on that venue is made of, each once and in order, with exactly the accounts its
  program takes, and the key, the coin and the pair where the program reads them;
- one coin, signed by its own new key (the signature is checked), with the plan's name, ticker and link byte for byte,
  paired with what the plan said, and this key as its creator;
- on Meteora: no fee for creating the pool or for moving to it; at least 90% of the creator's side of trading fees and
  of liquidity going to this key; the launchpad's part of the liquidity locked; a fixed supply; and nobody able to mint
  more of the coin or rename it;
- on pump.fun: none of its optional modes, and at least 90% of the creator fee going to this key;
- no buy, and nothing from the System or Token programs (so no transfer of the key's SOL or of a token it holds);
- a token program (and on pump.fun, Token-2022 for the coin) wherever an instruction reads one;
- the key's share of a pump.fun fee paid to the key's own account;
- no change to another of the key's coins, nothing that names loot (the game's economy, which the same key may own),
  and no lookup table;
- at most 0.1 SOL in fees paid by the key itself.

**The cluster is checked too.** A transaction does not name its cluster, so before the key signs, xcore asks an RPC of
the launch's cluster: devnet, or mainnet with `--cluster mainnet` (checked against mainnet's first block).

- On devnet, it asks a devnet RPC to confirm that each transaction's blockhash is a devnet one and that the coin's
  address holds nothing yet.
- It uses your own RPC when `XSOLANA_RPC_URL` is set, and Solana's public one otherwise. It never uses xgames.fun's RPC,
  because xgames.fun also runs the launchpad: xgames.fun's RPC may show the key's balance in the plan, but never decides
  whether to sign.
- If no RPC answers, or `XSOLANA_RPC_URL` is set to something unusable, nothing is signed. Solana's public RPC limits
  how often one address can ask, so a devnet RPC of your own makes launches more reliable.

### Mainnet

`--cluster mainnet` uses real money.

- A game has one mainnet coin, separate from its devnet one.
- The plan starts with "MAINNET: REAL MONEY", the code covers the cluster, and every call to xgames.fun names it.
- Mainnet is checked through your own mainnet RPC (`XSOLANA_RPC_URL`) or Solana's public mainnet RPC, never
  xgames.fun's.
- Selling a token to the public is regulated in most places. Checking that is your responsibility before you launch
  one.

### What is not checked

These are xgames.fun's responsibility:

- the picture and the description (they are what the coin's link serves);
- on Meteora, the curve's shape: its prices, how the supply is spread along it, and its fee schedule.

The check also relies on each venue's program doing what its instruction says. Those programs charge rent for the
coin's own accounts (about 0.02 SOL).

### After the launch

- Anything else is refused with a message that says what failed the check. Nothing is signed, and the launch is
  abandoned.
- Once a launch is submitted, xgames.fun reports what was sent. `xcore coin` asks it where the launch stands, and says
  so plainly when the coin it names is not the one this folder's key launched (`.gamesfun/coin.json`).
- `--json` output escapes every character that could hide or move text in a terminal.
- Then add the coin to the economy: `xcore loot token <mint>` prints its entry for the `tokens` list in
  `xsolana.json`.

You can do the same from a browser wallet in the game's console (xgames.fun/console), on the Token tab. A devnet coin
has no real value. Selling a token for real money is regulated in most places. Checking that is your responsibility
before any mainnet launch, and nothing here is legal advice.
