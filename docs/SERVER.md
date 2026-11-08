# A game's own server code (`server/`)

Most games need no server: the page is the game. When a game needs one party everybody trusts (a leaderboard nobody
can write to from the console, a result that pays a prize, a room the host cannot cheat in), it can carry **its own
server code** in `server/`. `xcore publish` bundles it and puts it on xgames.fun beside the game's files, at the game's
own `/api/*`. You set up no account elsewhere, no keys and no deploy.

The contract is `gf-server-v1`. Every name and number in it lives in one module,
[`lib/server/contract.mjs`](../lib/server/contract.mjs); the bundler and its checks are
[`lib/server/bundle.mjs`](../lib/server/bundle.mjs).

## What goes in the game folder

```
my-game/
  index.html, …          the game, as always
  gamesfun.json          the server's settings (below)
  server/index.js        the server: a Worker module
  server/…               anything it imports (npm packages from the game's node_modules are bundled in)
```

```json
{
  "server": {
    "main": "server/index.js",
    "objects": [{ "class": "Vault", "binding": "VAULT" }],
    "routes": "/api/*",
    "compatibilityFlags": []
  }
}
```

| Field                | Rule                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`               | default `server/index.js`; a `.js` or `.mjs` file under `server/`                                                                                                                                                                                                                                                                                               |
| `objects`            | 0–8 Durable Objects (a room, a run, a vault): `class` is the class the entry exports, `binding` the name it has on `env` (A–Z, 0–9 and `_`, starting with a letter, at most 32 characters, never `GF` or `GF_…`). Each gets its own SQLite storage. **Append only**: once published, keep every class (removing one deletes its data, so the upload refuses it) |
| `routes`             | `"/api/*"`, the only value for now                                                                                                                                                                                                                                                                                                                              |
| `compatibilityFlags` | empty, or `["nodejs_compat"]` to use `node:crypto`, `node:buffer` and the other Node built-ins a Worker has                                                                                                                                                                                                                                                     |

Without a `gamesfun.json` server entry, a `server/index.js` alone is a server with no objects. `server/` and
`gamesfun.json` are **never served** as files, and a game with a server keeps no files under `api/` (its `/api/*` is
the server's).

## What the server is

```js
import { DurableObject } from 'cloudflare:workers';
export class Vault extends DurableObject {
  /* this.ctx.storage, this.env.GF, WebSockets, alarms */
}
export default {
  async fetch(request, env, ctx) {
    /* every /api/* request of the game, URL unchanged */
  },
};
```

- **Requests.** Every request to the game's own address under `/api/` (any method, WebSockets too) reaches `fetch`.
  The page calls it with a relative address, `fetch('api/rounds')`, so it works at the published origin and under a
  folder alike. Same origin, so no CORS and no change to the page's security policy. Headers starting with `x-gf-` are
  removed on the way in.
- **`env`**: `env.GF` (the platform, below), one Durable Object namespace per `objects` entry, the plain strings
  `env.GF_GAME_ID`, `env.GF_SLUG` and `env.GF_CONTRACT` (`"gf-server-v1"`), and your own secrets as `env.<NAME>`
  (below, "Secrets"). No key of xgames.fun's. Keep keys out of server code: publish refuses one it finds.
- **Runtime**: Cloudflare Workers, compatibility date `2025-06-01`.
- **Outbound `fetch`** reaches only the origins in your `backend.json` and xgames.fun's own. To read Solana devnet
  from the server, call xgames.fun's relay, `https://play.xgames.fun/loot/v1/rpc` (the methods loot's client uses, one
  request a call): the public devnet RPC (`api.devnet.solana.com`) answers the Workers runtime with 403 ("Your IP or
  provider is blocked"), under `xcore dev` as well.
- **Limits**: set by the game's plan (README §5, `xcore plan`). Free: 50 ms of CPU per request to `fetch`, 20
  subrequests, **600 requests a minute per game and 120 from one player**; Creator: 200 ms, 50, 6,000 and 600; a 5 MB
  bundle on every plan. Past a rate, `/api/*` answers 429 with `retry-after: 60`, `scope` (`"player"` or `"game"`)
  and `plan`. Keep frequent traffic,
  such as positions in a real-time game, on a WebSocket rather than in many HTTP requests. A Durable
  Object's WebSocket counts as one request for its whole life, but a room's messages are held to a few milliseconds
  of CPU each **on every plan** (a bigger plan raises a request's CPU, not a room's): a room doing ~3 ms a message ran
  for minutes, one doing ~15 ms was reset within seconds (every socket closes with code 1006). Do a room's work as
  messages arrive rather than in timers, keep it to a millisecond or two per message, and reconnect on 1006. Heavy
  work (a replay, a long simulation) goes in an HTTP request instead, which gets the plan's CPU.
- **Not allowed**: code made from text at run time (`eval`, `new Function`, `import()` of a computed path,
  `importScripts`), files from outside the game folder (packages from `node_modules` are fine), Node built-ins without
  `nodejs_compat`, and those a Worker does not have even with it (`node:fs`, `child_process`, `vm`, …). The check names
  the file and line.
- **One request at a time, between awaits.** A Durable Object holds other requests back while it waits on its own
  storage, but an `await` of anything else (`fetch`, `env.GF.verifyPlayer`, another object) lets the next request
  in. Read and update a player's state (a daily cap, a balance) with nothing but storage calls in between: verify
  the player first, then read, check and write; or wrap it in `this.ctx.blockConcurrencyWhile(...)`. Test it with a
  burst of requests sent at once.
- **WebAssembly** (a physics engine, a codec): import the `.wasm` file itself, `import wasm from './physics.wasm'`; it
  goes up beside the bundle as its own module, named by its file name, so two wasm files need two names. A Worker
  compiles no wasm from bytes at run time: a library's "compat" build, which carries its wasm inside the JavaScript,
  fails with `Wasm code generation disallowed by embedder`; use its plain build's `.wasm`. wasm-bindgen's `web`
  build takes that module with `initSync({ module: wasm })`. Its `bundler` build (the usual one on npm: its loader
  does `import * as wasm from './x_bg.wasm'`, with no `initSync`) needs that loader replaced: copy the package into
  `server/vendor/` (with its license) and make its loader file

  ```js
  import module from './x_bg.wasm';
  import * as bg from './x_bg.js';
  export * from './x_bg.js';
  const { exports } = new WebAssembly.Instance(module, { './x_bg.js': bg });
  bg.__wbg_set_wasm(exports);
  exports.__wbindgen_start?.();
  ```

  (Rapier's `rapier_wasm2d.js` is such a loader; a game running the same deterministic build in the page and in the
  server got identical results.)

### A room over a WebSocket

A Durable Object holds the room: every player's socket is accepted there, and a message from one goes to the others.
The page connects to `api/…` on its own origin (`wss://` once published).

```js
import { DurableObject } from 'cloudflare:workers';

export class Room extends DurableObject {
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server); // hibernatable: the room sleeps between messages
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws, data) {
    for (const other of this.ctx.getWebSockets()) if (other !== ws) other.send(data);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/room') return env.ROOM.get(env.ROOM.idFromName('main')).fetch(request);
    return new Response('not found', { status: 404 });
  },
};
```

```js
// the page
const url = new URL('api/room', document.baseURI);
url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(url);
```

`gamesfun.json`: `{ "server": { "objects": [{ "class": "Room", "binding": "ROOM" }] } }`. `xcore check` cannot run the
server, so it notes the socket instead of failing on it.

**When you publish an update**, the page's files and the server change within about 30 seconds, not all at once, and
a room that has players connected can keep running the previous code until it empties. Make your messages tolerate one
version talking to the other (a version number in the first message is enough to tell a player to reload).

### `env.GF`, the platform

Every call answers `{ok: true, …}` or `{ok: false, code, why}` (`why` is words a game may show); none throws.

| Call                                                                                                                                                                                                | Answer                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GF.verifyPlayer(token)`                                                                                                                                                                            | `{ok, sub, wallet, x, lvl, exp}`: who the player is, from the sign-in token the page sends (no display name: show `x.handle` when they signed in with X, else a name the page sends, cleaned)                                            |
| `GF.saves.get(player, key = 'main')`, `.put(player, key, value)`, `.delete(player, key)`, `.list(player)`                                                                                           | a player's saves: any JSON value, 64 KB each, 16 a player                                                                                                                                                                                |
| `GF.scores.submit(board, player, score, {name, order, writer})`, `.setup(board, {order, writer})`, `.top(board, {limit, offset})`, `.best(board, player)`, `.remove(board, player)`, `.drop(board)` | leaderboards: a player's best is kept; `order` `"high"` (default) or `"low"`; `writer: "server"`: only the server writes the board (or every board a pattern names: `daily-*`, `*`); `drop`: the board gone, its place among the 16 free |
| `GF.loot.report({round, endedAt, winners})`, `GF.loot.status()`                                                                                                                                     | a result that pays prizes by place: xgames.fun's keeper signs it with the game's host key (set up by the owner in Studio); for amounts your server works out, your own key (below, "Paying a result")                                    |
| `GF.info()`                                                                                                                                                                                         | `{ok, contract, gameId, slug}`                                                                                                                                                                                                           |

`player` is the game's own word for a player; normally `verifyPlayer`'s `sub`, so nobody can write another player's.
The page writes the same saves and boards for its own signed-in player (`/platform/v1/*`), so a board is the player's
own word until the server takes it: **`GF.scores.setup(board, {writer: 'server'})`** (or `writer: 'server'` in the
server's own `submit`) makes a board only the server writes. From then on the page's submit to it is refused
(`server-only`, HTTP 403; `GamesFun.scores.submit` answers `{error, status: 403, code: 'server-only'}`), the page still reads it (`top` says
`writer: "server"`), and the server submits what it checked. A board that becomes the server's starts empty: what
the page wrote while anyone could write it is removed (`setup` answers how many, `removed`). **A pattern** names every
board starting that way, now and to come: `GF.scores.setup('daily-*', {writer: 'server'})` before the first day, and
nobody fills a day's board ahead of time; `GF.scores.setup('*', {writer: 'server'})` keeps the page from making
boards at all (a board's own rule wins over a pattern, a longer pattern over a shorter one). A game has 16 boards:
**`GF.scores.drop(board)`** removes one (a past day's, once its prizes are paid) and frees its place. Only the server
can set or lift a rule (`writer: 'any'`) or drop a board.

### Secrets

A key the server needs and no player may see (a voucher-signing key, an outside API's key, an RPC URL with its key)
is a secret: the server reads it as `env.<NAME>`.

```sh
xcore secret set VOUCHER_SEED --from-file ../voucher-seed.txt   # or piped in, or typed (not shown)
xcore secret list                                               # the names; values are never shown again
xcore secret delete VOUCHER_SEED
```

- xgames.fun keeps the value only on the server's host (Cloudflare), never stores or shows it, and never gives it to
  the page. A new publish keeps the secrets.
- Set it once the game is published with its `server/`; it reaches the server's next request, with no publish.
- Names: A–Z, 0–9 and `_`, starting with a letter, not `GF` or `GF_*`, not a room's binding. Values up to 5,120
  bytes; 32 a game.
- **Locally**, `xcore dev` reads the same names from the game folder's `.dev.vars` (`NAME=value` lines), and reloads
  the server when it changes. It is a hidden file, so publish never sends it; keep it out of git too.

### The economy's own RPC

A game with an economy (`xcore loot add`) sends its Solana calls through xgames.fun's shared devnet relay by default
(the play host's `/loot/v1/rpc`), and every call counts toward the game's plan: $10 a million, the biggest cost a
player of an economy game has (a page reading balances every 5 s spends Free's $1 in ~140 player-hours). Bring the
game's own devnet RPC (Helius, Triton, QuickNode; their free plans fit a small game) instead:

```sh
xcore add rpc                            # server/rpc.js at api/rpc, routed in server/index.js
xcore publish
xcore secret set XSOLANA_RPC_URL         # the RPC's URL with its key: the server's, never the page's
```

- The page client (`gamesfun.js`) asks `api/rpc` once a page load and sends the economy's calls there when the
  server has `XSOLANA_RPC_URL`; without it, they keep going to the shared relay, so setting it late breaks nothing.
- Each call is one request to the game's server (its plan's rates; ~$0.30 a million) and your RPC's own plan.
- `RPC` at the top of `server/rpc.js` is what it passes on: the calls loot's page client makes, one at a time;
  `getProgramAccounts` only with filters and only of loot's own programs (loot, Metaplex Core, lookup tables); and
  `sendTransaction` only for the game's own transactions (one with a loot instruction, or a plain SOL send). So a
  stranger calling `api/rpc` cannot spend your RPC's credits on anything else. Mainnet URLs are not used (loot runs on devnet until it is audited).
- The server may call only `backend.json`'s origins: `xcore add rpc` adds the RPC's (`https://host` alone, never the
  key) when `XSOLANA_RPC_URL` is in `.dev.vars` or `.env`, and publish says when it is missing.
- Solana's public `https://api.devnet.solana.com` refuses calls from Cloudflare ("Your IP or provider is blocked",
  measured 2026-11-03): use a provider's URL.
- Under `xcore dev`, put `XSOLANA_RPC_URL` in `.dev.vars` to run this path; in `.env` it is the dev server's own
  `/loot/v1/rpc` forward, the path a published page without `api/rpc` takes.

### How much your server can check

A result is worth paying only as far as the server can tell it happened. Strongest first:

- **The server decides it.** A turn game played in the server, or a room whose Durable Object runs the match (the
  page sends inputs, never results). The result is what the server saw.
- **The server replays it.** A deterministic game (fixed time step, seeded randomness, a deterministic physics build
  such as Rapier's): the page sends its inputs, the server runs them and reads the result itself. Mind the 50 ms of
  CPU a request: replay short runs, or a long one in pieces as it is played. **Never hand the page the whole run's
  randomness up front:** with the seed and the rules (which the page has), a script searches for the best run offline
  and sends only that, and the replay proves it was possible, not that a person played it. Reveal randomness as the
  run goes (the server sends what spawns next after each step the page sends), or keep the seed on the server and
  replay in pieces; allow one open run per player, and count a run that is abandoned toward the day's runs.
- **The server bounds it.** Any game the browser simulates (most action games): the server starts each run (an id
  and its own clock), takes each checkpoint in order, refuses what is faster than the game allows, caps what one
  player earns a day, and can ban. Give slack per second of play, never per request (a checkpoint every few
  milliseconds must not add up). A script that plays at human speed still gets through: this limits what a cheater
  earns, it does not stop one.

Even a result the server decided is worth what a good bot can earn: a bot that plays well wins what a player who
plays well wins. Pay a bounded or replayed result only what you would accept losing to a patient script (small
amounts, capped a day), and keep entry fees and prize pools for results the server decided and chance (the oracle).
Tell players which one your game is.

**Who gets paid: a wallet is not a person.** On Solana a wallet is free, and a wallet sign-in costs nothing, so every
cap that counts players or wallets multiplies with each one a person makes. What helps:

- **A person, not a wallet.** For rewards worth farming, pay only players signed in with X (`VOUCHERS.payOnly = 'x'`
  in `server/vouchers.js`), count your caps per X account, and give the grant `perPerson` (the voucher carries a
  hash of the player's X account).
- **Totals.** Give every grant a `perDay` total in `xsolana.json`, so the most it pays a day is known whoever claims.
- **Holding something.** Gate a reward on an NFT the game sells (a pass, a creature): each identity then costs money.
- **Proven wallets.** Pay, and grant perks to, only a wallet the player proved is theirs: the one they signed in
  with, or one linked by signing (`gf.loot.link()`); never a wallet the page names. Read holdings from the chain on the
  server, for that wallet.

`server/gf-loot/` carries @xgamesfun/solana's server helpers for this (`import { … } from './gf-loot/results/index.js'`):
`holds({ rpc, spec, wallet, item })` and `collectiblesOf(…)` (the game's collectibles a wallet holds, from the chain),
`proofRequest` / `verifyProof` (a wallet's signed proof: the link uses them), and `makeCodes` / `codeVoucher` (promo
codes with keys nobody can guess, 80 bits by default).

**Replaying costs CPU, so replay what pays.** A replay runs the whole game again on the server: a physics game used
about 3 ms of CPU for each second played, the largest line of its bill. Replay every run that pays (a prize, a
voucher, a ranked board) and a random sample of the rest (one in ten, say), and bound the others as above. A cheater
cannot tell which runs are replayed, and a run that pays is always one of them.

### Paying a result: xgames.fun's keeper, or a voucher key of your own

A reward for a result (a score, a win, a podium) is a grant in the game's economy, claimed with a voucher: a
signature that says this wallet earned it. The page can never sign one (anyone can change a page in the console), so
a voucher comes from one of two signers. Both start from a result your server stands behind (above); they differ in
who holds the key.

|                    | **xgames.fun's keeper** (`env.GF.loot.report`)                                    | **your server's own key** (`xcore add vouchers`)                                          |
| ------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Who signs          | xgames.fun, with the game's host key (made for the game, never shown to anyone)   | your server, with `VOUCHER_SEED` (a secret only it reads)                                 |
| What a result pays | a place: up to 16 winners a result, each paid its grant's own amount              | any amount up to the grant's (by score, by rank), worked out by your server               |
| How often          | 120 reports an hour a game                                                        | your plan's request rates                                                                 |
| To set up          | the owner certifies the host key in Studio once; the grant names the keeper's key | `xcore add vouchers`, `xcore secret set VOUCHER_SEED --new-key`, its address in the grant |
| Under `xcore dev`  | printed, not signed                                                               | signed with the key in `.dev.vars`, against devnet                                        |
| Follows loot       | when xgames.fun updates the keeper                                                | when you update xcore (publish keeps `server/gf-loot/` at its loot)                       |

**Use the keeper** when the server already decides who won and the prize is fixed by place: a room's winner, the top
three of a match, a hidden thing found first. No key to make or keep.

**Use your own key** when the amount depends on the result (paid by score), when you replay or bound runs before
paying (any single-player game that pays), when the game takes entry fees or has a prize pool, when results come
faster than 120 an hour, or when payouts must not wait on anyone else's upgrade.

A grant names up to three voucher keys, so both can pay the same grant: start with the keeper and add your own key
later beside it (`xcore loot approve` puts the change live). Changing a live grant keeps its incarnation, so vouchers
and rounds already paid stay as they were.

#### The keeper

```js
// in the server code that decided the round (a room's Durable Object, a route of your own)
const r = await env.GF.loot.report({
  round: matchId, // 16 bytes in hex (32 characters): this result's id, used once
  endedAt: Math.floor(Date.now() / 1000),
  winners: [{ wallet, place: 1, grant: 1 }], // 1–16; grant: a grant id the owner allowed
});
// r: {ok, result, vouchers} or {ok: false, code, why}; sending the same result again gets the same answer
```

- Once, in Studio: the owner certifies the game's host key (their wallet signs it), and the grant names the keeper's
  key for the game in its `vouchers` (`https://play.xgames.fun/loot/v1/voucher-key?game=<live.project>`).
  `env.GF.loot.status()` says whether the host key is certified.
- The winner's page claims every win at once:
  `await gf.loot.call('claimWins', { server: new URL('/loot/v1', location.href).href, token: gf.token })`.
- A grant that counts people (`perPerson`) counts each winner by their X account.

#### Your own key: `xcore add vouchers`

```sh
xcore add vouchers <folder>      # needs the economy (xcore loot add) with a grant that pays results
```

It writes `server/vouchers.js` (routed at `api/vouchers/`, with its Durable Object `GameVouchers`), copies loot's
voucher code into `server/gf-loot/` (bundled with the server, never a public file), makes a **test key** for
`xcore dev` with its seed as `VOUCHER_SEED` in `.dev.vars` (and, in a folder kept in git, `.dev.vars` into
`.gitignore`), and says its address. The **live key** is made here and sent to xgames.fun only, never kept on your machine:

1. `xcore publish`, then `xcore secret set VOUCHER_SEED --new-key`: a new key made and sent to the server only; it
   prints the key's address.
2. Put that address in the grant: `"vouchers": ["<the live key's address>"]` in `xsolana.json`; `xcore loot check`.
   To claim vouchers signed under `xcore dev`, add the test key's address too (devnet only; take it out before the
   economy holds anything of value: a copy of the folder holds the test key).
3. Write `PAY.check` at the top of `server/vouchers.js`: what your server checks before a result pays. It gets the
   page's JSON, the signed-in player and `env`, and answers `{grant, round, amount}` (grant: its key or id; round:
   the result's own id, any text, used once; amount: base units, or `'grant'` for the grant's own amount, always
   named so a forgotten amount never pays the most) or `{why}` to refuse. Until you write it, nothing is paid. Count a
   player's daily total in `PAY.paid` (it runs once a round, after its voucher is signed; again only if it threw), not in `check`.
4. Who is paid: set `VOUCHERS.payOnly` to `'x'` for rewards worth farming (above, "Who gets paid"); the grant's
   `perDay` total caps the rest.
5. `xcore loot approve` (the grant's change goes live), then `xcore publish`. `api/vouchers/key` answers the live
   key's address once the secret is set; until then the server pays nothing.

```js
// the page: link the wallet once (it signs that it is this player's; a wallet sign-in needs none), then claim
await gf.loot.connect();
await gf.loot.link();
const r = await gf.api('vouchers/pay', { method: 'POST', body: { runId } });
if (r.data?.voucher) await gf.loot.call('claimGrant', 'clear', { voucher: r.data.voucher });
```

```js
// your server's own code (a room that decided a match): no page request needed
import { voucherFor, walletOf } from './vouchers.js';
const wallet = await walletOf(env, player); // the wallet this player proved, or null
const { voucher } = await voucherFor(env, { grant: 'clear', wallet, round: matchId, amount: 500 });
```

- **A voucher pays a proven wallet.** `api/vouchers/pay` pays the wallet the player signed in with, or the one they
  linked (`api/vouchers/link`: the wallet signs @xgamesfun/solana's proof text naming the game, the link to this
  player, a nonce the server takes once and an expiry), or one `PAY.check` names itself. A wallet the page names is refused. One wallet is linked to one player at a time.
- **One result pays one wallet once.** `GameVouchers` remembers every round it signed: the same result asked again
  gets the same voucher (with no chain read, and a fresh one when it is about to run out), never one for another
  wallet or amount, and never one once the grant has been closed and made again (a new campaign pays new rounds only).
- **Rate:** a player may make `VOUCHERS.perMinute` pay and link requests a minute (20).
- **Keys:** the live key lives only on xgames.fun's server and is never shown again; a lost or leaked one: run
  `xcore secret set VOUCHER_SEED --new-key` again, put the new address in the grant in place of the old, approve. A
  leaked key can pay no more than the grant's limits, so keep them tight. The test key in `.dev.vars` signs only
  what the grant lets it sign.
- `person`: a player signed in with X is counted as one person, hashed with your key (never the account itself), for
  a grant with `perPerson`. A player signed in with a wallet only has no person, so a grant with `perPerson` refuses
  to pay them (`person`): sign in with X.
- Each pay is one request to your server and one read of the grant, through xgames.fun's relay or your own RPC
  (`xcore add rpc`).
- A grant's limits count claims, not amounts: a daily cap of tokens is the grant's amount with one claim a day, or
  your server's own count in `PAY.check`.
- A server of your own that is not xcore's (`server/index.js` without "Written by"): route `handleVouchers` in it and
  export `GameVouchers`, as `xcore add vouchers` says. `signVoucher` from `@xgamesfun/solana/results` is the same
  signature, for a server that signs by itself.

## Running it locally

`xcore dev <folder>` runs `server/` under workerd, the runtime xgames.fun runs it on, at the page's `/game/api/*`
(WebSockets too), with the game's page beside it and a local `env.GF`: `verifyPlayer` accepts the local sign-in that
`gamesfun.js` gets from it, and saves and scores are the ones the page reads through `/platform/v1/*` (kept in
`.gamesfun/dev-platform.json`). `env.GF.loot.report` is printed, not signed or paid; a voucher key of your own
(`xcore add vouchers`) signs for real, with the test key in `.dev.vars`. The dev host answers only `localhost`,
`127.0.0.1` and `[::1]`, so a page on another site can't reach it. Durable Object storage is kept in
`.gamesfun/dev-server/`, its secrets come from `.dev.vars`, and a change under `server/`, to `gamesfun.json` or to
`.dev.vars` rebuilds and reloads it. Miniflare (with
workerd, about 140 MB) is installed once on first use, into xcore's state folder (`GAMESFUN_SERVER_DEPS=<folder>` uses
one installed elsewhere). What is not the same as hosted: no CPU or request limits (its log says when the page's requests would pass Free's
or Creator's rate, or a request takes longer than Free's CPU allows: lines starting `limits:`), and outbound `fetch`
is not limited to `backend.json`'s origins.

A named export that is a plain value (`export const SEASON = 5`) makes the runtime refuse to start the server: keep
only the default export and the Durable Object classes exported (the check says so before publishing).

## Publishing it

`xcore publish` bundles `server/` into **one file** with esbuild (minified, with the contract's own options), runs
the checks above and the secret scan over each server file and the bundle, and sends it with the game's files when
xgames.fun says it takes server code. Otherwise it publishes the files alone and says so. `xcore publish --check` shows
the bundle without publishing:

```
my-vault: 278 files, 10.0 MB, nothing refused. Left out: .gamesfun/, .gitignore, gamesfun.json, server/.
  server code: server/index.js bundled from 1 file (server/index.js) into one 4.2 KB file, sha256 98b594a47bc6…,
  Durable Objects Vault (env.VAULT); server/ and gamesfun.json are not public files
```

Hosted, the game's server answers at `https://<slug>-play.xgames.fun/api/…`. A blocked or over-limit server answers
`{error, message}` with 451, 429, 404, 503 or 502 instead of the server's own answer.
