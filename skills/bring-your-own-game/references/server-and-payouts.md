# A server, and paying results

Open this when the game gets server logic on xgames.fun (`server/`), calls a backend of its own, or pays players for a
result (a score, a win, a place). The full rules are [docs/SERVER.md](../../../docs/SERVER.md).

## Where the game's logic runs

- **A backend they already run**: `xcore backend use custom <folder> --url <https://…> [--origin <wss://…>]`. It
  answers CORS for the game's origin, and its secret keys stay on it: everything in the page is readable by players.
- **Server logic xgames.fun runs for them**: `server/index.js` and `gamesfun.json` → `server`, a Worker on `/api/*`,
  Durable Objects for rooms, `env.GF` for sign-in, saves and scores. The page calls it with a relative address
  (`fetch('api/scores')`): `/api/*` when published, `/game/api/*` under `xcore dev`, which runs it under workerd with a
  local `env.GF`.
- **What stays on their own host**: a Node-only server, and anything that opens raw sockets (a database driver, a mail
  or chat client). xgames.fun refuses `cloudflare:sockets`, `node:net` and the like, an `import()` of a name made at run
  time, and `nodejs_compat`.
- **Every route that does work checks the player's token first** (`env.GF.verifyPlayer`; 401 at once without one),
  because a stranger's request that does work counts toward what caps the game.
- **Key a player's data on `sub`** (the account: `x:…`, or `g:…` for Google; different in every game). `wallet` is its
  own claim and may be null, so it is no key.
- A server's keys go in with `xcore secret set <NAME>`; on this machine `xcore dev` reads the same names from the
  folder's `.dev.vars`, which stays out of git.

## Paying a result: two signers

docs/SERVER.md, "Paying a result", has the rule.

- **xgames.fun's keeper**, when the server already decides who won and the prize is fixed by place: the server calls
  `env.GF.loot.report`; the owner certifies the host key in Studio once, and nobody keeps a key.
- **The server's own key**, when the amount depends on the result, when the server replays or bounds runs, for entry
  fees or a prize pool, or past 120 results an hour. Then, in order:
  1. `xcore add vouchers <folder>` writes `server/vouchers.js` and a test key for `xcore dev` (its seed in `.dev.vars`).
  2. Write `PAY.check` with the person (what their server checks before it pays; nothing is paid until it is written)
     and count payouts in `PAY.paid`.
  3. They publish.
  4. They run `xcore secret set VOUCHER_SEED --new-key`: the live key, made on their machine and sent only to
     xgames.fun, which keeps it. It prints the address. If the server has a key already, it prints what replacing it
     breaks and a code first.
  5. That address goes in the grant's `vouchers` (`xcore loot check`), the change goes live (`xcore loot approve`,
     signed by the key file that owns the economy, after their yes) and they publish again.

## What a payout rests on

Lenses 3 and 5 of the method, applied to every route that pays (docs/SERVER.md, "What a payout rests on"):

- List each input that decides who is paid, how much and for which round, and where it is held: the chain, state the
  server keeps, or the request. Whatever the request decides, a cheater decides.
- The ceiling: the identities one person can make × what each may take × time. Bound it with what the platform gives
  (`VOUCHERS.payOnly`, a grant's `perDay` and `perPerson`, a board the server writes:
  `env.GF.scores.setup(board, {writer: 'server'})`), or tell the person what a cheater gets.
- A bounded result earns small capped amounts; entry fees and prize pools need a decided or replayed one. A game
  without a server can still offer what the player pays for or the chain decides (a shop, boxes, raffles, staking,
  perks): say why that is the choice.

## Review: trust levels

`xcore review` asks each grant a voucher pays to declare `trust` as what `PAY.check` really does:

- `"decides"`: the server runs the game; the page sends only inputs.
- `"replays"`: the server runs the page's inputs again.
- `"bounds"`: the page plays and reports; the server checks its clock, order and caps. A server that times a run the
  page simulated is `bounds`, whatever it is called.

A bounded result is not safe, only capped. Where a paid route rests on a weaker level, review.md ends with both choices
for it: a smaller prize and tighter caps, or the stronger level and what it costs to build. Put that choice to the
person with your pick.
