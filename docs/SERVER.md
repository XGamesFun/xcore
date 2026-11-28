# A game's own server code (`server/`)

Most games need no server: the page is the game. Some games need one party that everybody trusts: a leaderboard
nobody can write to from the browser console, a result that pays a prize, or a room the host cannot cheat in. Such a
game can include **its own server code** in `server/`. `xcore publish` bundles it and deploys it to xgames.fun with
the game's files, at the game's own `/api/*`. You don't need an account anywhere else, any keys, or a separate deploy.

The contract is called `gf-server-v1`. Every name and number in it is defined in one module,
[`lib/server/contract.mjs`](../lib/server/contract.mjs). The bundler and its checks are in
[`lib/server/bundle.mjs`](../lib/server/bundle.mjs).

- [What goes in the game folder](#what-goes-in-the-game-folder)
- [What the server is](#what-the-server-is): requests, `env`, limits, what is not allowed;
  [the token](#check-the-token-first), [rooms over a WebSocket](#a-room-over-a-websocket),
  [`env.GF`](#envgf-the-platform), [project files](#project-files-envgffiles), [secrets](#secrets),
  [the economy's own RPC](#the-economys-own-rpc), [what a payout rests on](#what-a-payout-rests-on),
  [what your server does, declared](#what-your-server-does-declared),
  [paying a result](#paying-a-result-xgamesfuns-keeper-or-a-voucher-key-of-your-own)
- [The game's database](#the-games-database): from a server, with no server, and `xcore db`
- [Running it locally](#running-it-locally)
- [Publishing it](#publishing-it): what a stopped, capped or paused server returns

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

| Field                | Rule                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`               | Default `server/index.js`. A `.js` or `.mjs` file under `server/`.                                                                                                                                                                                                                                                                                                     |
| `objects`            | 0–8 Durable Objects (a room, a run, a vault). `class` is the class the entry file exports. `binding` is its name on `env`: A–Z, 0–9 and `_`, starting with a letter, at most 32 characters, never `GF` or `GF_…`. Each object gets its own SQLite storage. **Append only**: once published, keep every class. Removing one deletes its data, so the upload is refused. |
| `routes`             | `"/api/*"`, the only value for now.                                                                                                                                                                                                                                                                                                                                    |
| `compatibilityFlags` | Empty. `["nodejs_compat"]` is not offered: Node's built-in modules would let a server open raw network connections. xgames.fun refuses a publish that asks for it, and xcore's check reports it first. Use the Web APIs a Worker has (`fetch`, `crypto.subtle`, `URL`, `TextEncoder`).                                                                                 |

Without a `server` entry in `gamesfun.json`, a `server/index.js` on its own is a server with no objects. `server/` and
`gamesfun.json` are **never served** as files. A game with a server can't have files under `api/`, because its
`/api/*` belongs to the server.

## What the server is

```js
import { DurableObject } from 'cloudflare:workers';
export class Vault extends DurableObject {
  /* this.ctx.storage, this.env.GF, WebSockets, alarms */
}
export default {
  async fetch(request, env, ctx) {
    /* every /api/* request of the game, URL unchanged: check the player's token first (below) */
  },
};
```

### Requests

Every request to the game's own address under `/api/` reaches `fetch`, with any method, WebSockets included. The page
calls it with a relative address, such as `fetch('api/rounds')`, so the call works both at the published origin and
under a folder. Because it is the same origin, you need no CORS and no change to the page's security policy. Headers
that start with `x-gf-` are removed from incoming requests.

### `env`

- `env.GF`: the platform (see [`env.GF`](#envgf-the-platform)).
- One Durable Object namespace for each `objects` entry.
- Plain strings: `env.GF_GAME_ID`, `env.GF_SLUG` and `env.GF_CONTRACT` (`"gf-server-v1"`).
- Your own secrets, as `env.<NAME>` (see [Secrets](#secrets)).

`env` contains no xgames.fun keys. Keep keys out of server code: publish refuses any key it finds there.

### Runtime

Cloudflare Workers, compatibility date `2025-06-01`.

### Outbound `fetch`

- The origins listed in `backend.json` (plus xgames.fun's own origins) apply to the calls your server's entry file
  makes while it handles a request. Any other call returns 403 with the header `x-gf-outbound: refused`.
- Don't rely on this list for anything else. Limit what your Durable Objects call to what they need, in their own
  code.
- There is no guaranteed number of outbound calls per request.
- To read Solana devnet from the server, call xgames.fun's relay, `https://play.xgames.fun/loot/v1/rpc` (the methods
  loot's client uses, one request per call). The public devnet RPC (`api.devnet.solana.com`) returns 403 ("Your IP or
  provider is blocked") to the Workers runtime, under `xcore dev` as well.

### Limits

Limits depend on the game's plan ([HOSTING.md](HOSTING.md#plans-xcore-plan), `xcore plan`):

| Plan    | CPU per request to `fetch` | Requests a minute, per game | Requests a minute, per player | Bundle size |
| ------- | -------------------------- | --------------------------- | ----------------------------- | ----------- |
| Free    | 50 ms                      | **600**                     | **120**                       | 5 MB        |
| Creator | 200 ms                     | 6,000                       | 600                           | 5 MB        |

- Requests without a valid game token share half of the game's minute (300 on Free). Signed-in players always have
  the other half.
- Over a rate, `/api/*` returns 429 with `retry-after: 60`, `scope` (`"player"` or `"game"`) and `plan`.
- Send frequent traffic, such as positions in a real-time game, over a WebSocket rather than as many HTTP requests. A
  Durable Object's WebSocket counts as one request for its whole life.
- A room's messages are limited to a few milliseconds of CPU each, **on every plan**. A bigger plan raises a request's
  CPU, not a room's. In testing, a room using about 3 ms per message ran for minutes; one using about 15 ms was reset
  within seconds (every socket closed with code 1006).
- Do a room's work as messages arrive rather than in timers, keep it to a millisecond or two per message, and
  reconnect on 1006. Put heavy work (a replay, a long simulation) in an HTTP request instead, which gets the plan's
  CPU.

### Not allowed

xcore's check names the file and line before anything is sent. xgames.fun refuses the same things at publish, except
code built from text at run time, which its runtime refuses when it runs:

- **Raw network connections**: an import, a re-export or an `import()` of `cloudflare:sockets`, `node:net`,
  `node:tls`, `node:dgram`, `node:http2`, `node:module` or `node:child_process` (with or without the `node:` prefix),
  in the server's own code or in a package it bundles. A game's server reaches the network with `fetch()` only. A
  database driver, or a mail or chat client that opens sockets, has to run on a host of your own.
- **An `import()` of a name built at run time** (`import(name)`), because it could load any module. Import each module
  by its own name. A path that esbuild can resolve when it bundles (``import(`./levels/${name}.js`)``) is fine: every
  file there is bundled. xgames.fun parses the bundle it receives, and xcore reads the same bundle with esbuild's own
  parser rather than searching its text, so a word in a comment or a string is not treated as an import.
- **Node's built-in modules** (`node:crypto`, `node:buffer`, `fs`, …). `nodejs_compat` is not offered, so use the Web
  APIs a Worker has (`crypto.subtle`, `crypto.getRandomValues`, `TextEncoder`, `URL`).
- **Code built from text at run time** (`eval`, `new Function`, `importScripts`). xcore reads the finished bundle: a
  call in `server/` is a problem, and a call in a package it bundles is a warning (a package's unused code is often
  dropped from the bundle, and the runtime refuses only a call that runs).
- **Files from outside the game folder.** Packages from `node_modules` are fine.

### One request at a time, between awaits

A Durable Object holds other requests back while it waits on its own storage. An `await` on anything else (`fetch`,
`env.GF.verifyPlayer`, another object) lets the next request in. When you read and update a player's state (a daily
cap, a balance), make only storage calls in between: verify the player first, then read, check and write. Or wrap the
work in `this.ctx.blockConcurrencyWhile(...)`. Test it by sending a burst of requests at once.

### WebAssembly

For a physics engine or a codec, import the `.wasm` file itself: `import wasm from './physics.wasm'`. It is uploaded
next to the bundle as its own module, named by its file name, so two wasm files need two different names.

A Worker cannot compile wasm from bytes at run time. A library's "compat" build, which embeds its wasm in the
JavaScript, fails with `Wasm code generation disallowed by embedder`. Use its plain build's `.wasm` instead.

- wasm-bindgen's `web` build takes that module with `initSync({ module: wasm })`.
- Its `bundler` build (the usual one on npm; its loader does `import * as wasm from './x_bg.wasm'` and has no
  `initSync`) needs its loader replaced. Copy the package into `server/vendor/` (with its license) and make its loader
  file:

  ```js
  import module from './x_bg.wasm';
  import * as bg from './x_bg.js';
  export * from './x_bg.js';
  const { exports } = new WebAssembly.Instance(module, { './x_bg.js': bg });
  bg.__wbg_set_wasm(exports);
  exports.__wbindgen_start?.();
  ```

  Rapier's `rapier_wasm2d.js` is such a loader. A game that ran the same deterministic build in the page and in the
  server got identical results.

### Check the token first

A request without a valid game token comes from a stranger. Check the token before doing any work, and return 401
immediately if there is none. The work your server does for callers without a token (reading the database, waking a
room, calling out) counts toward your game's cap, and a capped game's server is switched off until the month ends (see
[Publishing it](#publishing-it)).

```js
export default {
  async fetch(request, env) {
    // what is truly public (a leaderboard everyone sees) may come before this; nothing else does
    const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) return Response.json({ why: 'Sign in first.' }, { status: 401 }); // no call, no work: cheap
    const player = await env.GF.verifyPlayer(token); // its signature, its audience (this game) and its expiry
    if (!player.ok) return Response.json({ why: 'Sign in again.' }, { status: 401 });
    // from here on, player.sub is who is asking
    return Response.json(await env.GF.saves.get(player.sub));
  },
};
```

- `env.GF.verifyPlayer` checks three things: the token's signature, that it was issued for this game (its audience,
  `game:<slug>`), and that it has not expired.
- A backend of your own can check tokens with any JWT library against `https://<slug>-play.xgames.fun/player/v1/key`
  (issuer `xgames.fun`, audience `game:<slug>`). Check all three, as in
  `jwtVerify(token, keys, { issuer: 'xgames.fun', audience: 'game:<slug>' })`, never the signature alone. Every game's
  tokens are signed with the same key, so a token whose audience is not checked is valid for any game.
- The token's `sub` is the player's account: `x:<X id>`, or `g:<id>` for Google. It is different in every game.
  `wallet` is a separate claim and may be absent. A game that stores a player's data by wallet reads `wallet`.
- xgames.fun rotates its signing key from time to time. A backend that caches the key set must fetch it again when a
  token names a key id (`kid`) it doesn't have: once, not in a loop. Most JWT libraries' remote key sets do this.
- The page sends the token for you: `GamesFun.api(path)` adds `Authorization: Bearer …` for a signed-in player. A
  WebSocket can't carry that header, so send `GamesFun.token` in the address (see below).
- `withPlayer(request, env)` in `server/gf-db.js` does the same check. It returns null without a token, with no call
  made.
- `xcore review` flags a game server whose files do work without ever checking a token, and an entry whose `fetch`
  does work before its first check. The latter is fine for what is truly public; that is your decision.

### A room over a WebSocket

A Durable Object holds the room. Every player's socket is accepted there, and a message from one player is sent to
the others. The page connects to `api/…` on its own origin (`wss://` once published).

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
    if (url.pathname !== '/api/room') return new Response('not found', { status: 404 });
    // the player first, before the room is woken: a WebSocket cannot carry an Authorization header, so the page sends
    // its token in the address
    const token = url.searchParams.get('token');
    if (!token) return new Response('sign in first', { status: 401 });
    const player = await env.GF.verifyPlayer(token);
    if (!player.ok) return new Response('sign in again', { status: 401 });
    return env.ROOM.get(env.ROOM.idFromName('main')).fetch(request);
  },
};
```

```js
// the page
const url = new URL('api/room', document.baseURI);
url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
url.searchParams.set('token', GamesFun.token);
const socket = new WebSocket(url);
```

In `gamesfun.json`: `{ "server": { "objects": [{ "class": "Room", "binding": "ROOM" }] } }`. `xcore check` can't run
the server, so it notes the socket instead of failing on it.

**When you publish an update**, the page's files and the server change within about 30 seconds, not at the same
instant. A room that is already running keeps the previous code for up to about five minutes. Make your messages work
when one version talks to the other. A version number in the first message is enough to tell a player to reload.

### `env.GF`, the platform

Every call returns `{ok: true, …}` or `{ok: false, code, why}`. `why` is text a game may show to players. No call
throws.

| Call                                                                                                                                                                                                           | Returns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GF.verifyPlayer(token)`                                                                                                                                                                                       | `{ok, sub, wallet, x, lvl, exp, banned}`: who the player is, from the sign-in token the page sends. There is no display name: show `x.handle` when the player signed in with X, otherwise a name the page sends, cleaned. `banned` is the creator's ban from the console (`{kind: 'ban' \| 'hide', until}`, or null; always null in `xcore dev`). A token issued before a ban still verifies for its hour, so refuse `kind: 'ban'` yourself.                                                       |
| `GF.saves.get(player, key = 'main')`, `.put(player, key, value)`, `.delete(player, key)`, `.list(player)`                                                                                                      | A player's saves: any JSON value, up to 64 KB each and 16 per player.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GF.scores.submit(board, player, score, {name, order, writer})`, `.setup(board, {order, writer})`, `.top(board, {limit, offset})`, `.best(board, player)`, `.remove(board, player)`, `.drop(board)`, `.list()` | Leaderboards. A player's best score is kept. `order` is `"high"` (default) or `"low"`. `writer: "server"` means only the server writes the board (or every board a pattern matches: `daily-*`, `*`). `drop` deletes the board and frees its place in the plan's board count. `list` returns every board (`made`: `"server"`, or `"page"` with the `player` who made it; its `writer` and `entries`), every rule, and the plan's `limit` (`boards`, and `page`: how many of them pages may create). |
| `GF.loot.report({round, endedAt, winners})`, `GF.loot.status()`                                                                                                                                                | A result that pays prizes by place. xgames.fun's keeper signs it with the game's host key (set up by the owner in Studio, xgames.fun's game builder, which is invite only). For amounts your server calculates, use your own key (see [Paying a result](#paying-a-result-xgamesfuns-keeper-or-a-voucher-key-of-your-own)).                                                                                                                                                                         |
| `GF.info()`                                                                                                                                                                                                    | `{ok, contract, gameId, slug}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `GF.files.put(path, body, {type, public, length})`, `.get(path)`, `.head(path)`, `.list({prefix, after})`, `.delete(path)`, `.usage()`                                                                         | The game's project files (see [Project files](#project-files-envgffiles)): replays, levels, content packs. Public files are served from the files site.                                                                                                                                                                                                                                                                                                                                            |

#### Who the player is

- `sub` is the player's account, never their wallet: `x:<X id>` for a player signed in with X, or `g:<id>` for a
  Google account with no X.
- The id is **different in every game**, so it never identifies the person elsewhere. Don't expect a Google player's
  id to match the same person's id in another game.
- `wallet` is a separate claim: the wallet linked to the account, or null when there is none. It can change (a player
  can link another wallet).
- Key a player's data (saves, rows, rooms) on `sub`. Read `wallet` only for things that concern the wallet itself
  (paying it, what it holds). A game that used to store a player's data by wallet should read `wallet` now.

#### Boards the server owns

`player` is the game's own identifier for a player. Normally it is `verifyPlayer`'s `sub`, so nobody can write another
player's data.

The page writes the same saves and boards for its own signed-in player (`/platform/v1/*`). So a board holds whatever
the page submits until the server takes it over:

- **`GF.scores.setup(board, {writer: 'server'})`** (or `writer: 'server'` in the server's own `submit`) makes a board
  that only the server writes.
- From then on, the page's submits to it are refused (`server-only`, HTTP 403; `GamesFun.scores.submit` returns
  `{error, status: 403, code: 'server-only'}`). The page can still read it (`top` reports `writer: "server"`), and the
  server submits scores it has checked.
- A board that becomes the server's starts empty. What the page wrote while anyone could write is removed (`setup`
  returns how many, as `removed`).
- **A pattern** covers every board whose name starts that way, now and in future.
  `GF.scores.setup('daily-*', {writer: 'server'})` before the first day means nobody can fill a day's board in advance.
  `GF.scores.setup('*', {writer: 'server'})` stops the page from creating boards at all. A board's own rule wins over
  a pattern, and a longer pattern wins over a shorter one.
- A game has 8 boards on Free (16 rules) and 16 on Creator and Scale (32 rules). **`GF.scores.drop(board)`** removes
  one (for example a past day's board, once its prizes are paid) and frees its place.
- Only the server can set or lift a rule (`writer: 'any'`) or drop a board.

### Project files: `env.GF.files`

Project files are files that you or the game's server write, never players: replays, generated levels, a large saved
world, content packs. xgames.fun stores them for the game and serves the public ones from a separate site,
`https://<slug>.xgamesusercontent.com/<path>`.

| Plan    | Storage | Largest file |
| ------- | ------- | ------------ |
| Free    | 100 MB  | 25 MB        |
| Creator | 10 GB   | 25 MB        |
| Scale   | 100 GB  | 25 MB        |

```js
// the server keeps a replay, public: the page loads it from its address
const saved = await env.GF.files.put(`replays/${runId}.json`, JSON.stringify(replay), {
  type: 'application/json',
  public: true,
});
if (!saved.ok) return Response.json({ why: saved.why }, { status: saved.code === 'full' ? 507 : 400 });
return Response.json({ replay: saved.url });

// a file only the server reads
const world = await env.GF.files.get('worlds/main.bin');
if (world.ok) state = new Uint8Array(await new Response(world.body).arrayBuffer());
```

| Call                                                       | Returns                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GF.files.put(path, body, {type, public = false, length})` | `{ok, path, bytes, url?}`. `body` is a string, an ArrayBuffer or a stream of bytes. A stream must be exactly `length` bytes (more or fewer gives `code: "body"` and stores nothing); a stream with no `length` is read up to 1 MB (longer gives `code: "body"`). `url` is returned for a public file. Over the game's cap: `code: "full"`. |
| `GF.files.get(path)`                                       | `{ok, body, type, bytes, public}`. `body` is a stream of the bytes (`await new Response(body).text()`).                                                                                                                                                                                                                                    |
| `GF.files.head(path)`                                      | The same, without `body`.                                                                                                                                                                                                                                                                                                                  |
| `GF.files.list({prefix, after, limit = 100})`              | `{ok, items: [{path, bytes, type, public, updatedAt}], after}`. A prefix is empty or a folder ending in `/`. Pass `after` to get the next page.                                                                                                                                                                                            |
| `GF.files.delete(path)`, `GF.files.usage()`                | `{ok, deleted}`, `{ok, bytes, files, cap}`                                                                                                                                                                                                                                                                                                 |

- **Paths** use letters, digits, `.`, `_` and `-`, with `/` between folders. At most 512 characters, and no `.` or
  `..` segment. Example: `levels/forest-3.json`.
- **The files site is a separate site from the game.** A file there can't use the player's sign-in or call the game's
  `api/`. Every response carries `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox; default-src
'none'`. Pictures (PNG, JPEG, WebP, GIF, AVIF), sounds, videos, fonts, JSON and plain text are served with their own
  type. Anything else (HTML, SVG, JavaScript, CSS, XML, PDF) is served as a download, `application/octet-stream`. The
  game's page may load pictures, sounds and fonts from it and `fetch` from it, but never scripts or styles.
- **From your machine**: `xcore files put <file> [path] [--public]`, `ls`, `get`, `rm`, `usage`. Add `--live` to work
  on the game's files on xgames.fun.
- xgames.fun keeps one copy of each file and no earlier versions. So overwriting a file it has (`put --live` to an
  existing path) or deleting one (`remove --live`) first prints what would be lost, with a code, and changes nothing. Run
  it again with `--yes <code>` to go ahead. A new path is written immediately, and so is every change to the local
  files.
- **Locally**, `xcore dev` keeps project files in `.gamesfun/dev/files/` (never published). It serves the public ones
  on a port of their own (`project files: … http://127.0.0.1:8788`), a different origin from the page, as on
  xgames.fun. Locally both are the same site (`127.0.0.1`). On xgames.fun, `xgamesusercontent.com` is also a different
  site, so cookies and similar state are kept apart there in a way they may not be locally. `xcore files` without
  `--live` reads and writes the same local files.
- Publish refuses a server that uses `env.GF.files` while xgames.fun does not support project files yet. Its
  `GET /api/kit/me` lists `"files"` once it does.

### Secrets

A secret is a key the server needs and no player may see: a voucher-signing key, another API's key, an RPC URL that
contains a key. The server reads it as `env.<NAME>`.

```sh
xcore secret set VOUCHER_SEED --from-file ../voucher-seed.txt   # or piped in, or typed (not shown)
xcore secret list                                               # the names; values are never shown again
xcore secret remove VOUCHER_SEED
```

- xgames.fun keeps the value only on the server's host (Cloudflare). It never stores or shows the value itself, and
  never gives it to the page. Secrets are kept across publishes.
- Set a secret after the game has been published with its `server/`. It takes effect on the server's next request,
  with no new publish.
- Names: A–Z, 0–9 and `_`, starting with a letter; not `GF` or `GF_*`, and not a room's binding. Values up to 5,120
  bytes. Up to 32 secrets per game.
- **Locally**, `xcore dev` reads the same names from `.dev.vars` in the game folder (`NAME=value` lines), and reloads
  the server when the file changes. It is a hidden file, so publish never sends it. Keep it out of git too.

### The economy's own RPC

The shared relay uses `/loot/v1/rpc` on devnet. On mainnet it uses `/loot/v1/rpc?cluster=mainnet` and requires player sign-in.
On mainnet, 100,000 calls use $1 of the included allowance or $2 of Creator credit; a devnet page's calls are not
billed to the game ([FEES.md](FEES.md#hosting)). At one call every five seconds,
$1 of allowance covers about 140 player-hours. Relay calls alone cannot trigger a hosting cap. [Hosting fees](FEES.md#hosting)

To use your own RPC, choose an endpoint for your economy’s network and run these commands.

```sh
xcore add rpc                            # server/rpc.js at api/rpc, routed in server/index.js
xcore publish
xcore secret set XSOLANA_RPC_URL         # the RPC's URL with its key: the server's, never the page's
```

- The page client (`gamesfun.js`) queries `api/rpc` once per page load. When the server has `XSOLANA_RPC_URL`, it
  sends the economy's calls there. Without it, calls keep going to the shared relay, so setting it late breaks
  nothing.
- Each call is one request to the game's server (counted against the plan's rates; about $0.30 per million) and one
  call on your RPC provider's plan.
- `RPC` at the top of `server/rpc.js` defines what it forwards:
  - the calls loot's page client makes, one at a time;
  - `getProgramAccounts` only with filters, and only for loot's own programs (loot, Metaplex Core, lookup tables);
  - `sendTransaction` only for the game's own transactions (one with a loot instruction, or a plain SOL transfer).

  So a stranger calling `api/rpc` can't spend your RPC credits on anything else. The URL must be for the economy's
  cluster: devnet, or mainnet for an economy whose file says `"network": "mainnet"`.

- The server's entry, where `api/rpc` runs, may call only `backend.json`'s origins. `xcore add rpc` adds the RPC's
  origin (`https://host` only, never the key) when `XSOLANA_RPC_URL` is in `.dev.vars` or `.env`, and publish warns
  when it is missing. `xcore secret set XSOLANA_RPC_URL` checks it too: if the origin is not listed yet, it adds the
  origin, does not set the URL, and exits 1 (code `not-set` with `--json`). Run `xcore publish`, then set it again
  with the same value. (Setting it earlier would make the page send its calls to a server that may not be allowed to
  make them.)
- Solana's public `https://api.devnet.solana.com` refuses calls from Cloudflare ("Your IP or provider is blocked").
  Use a provider's URL.
- Under `xcore dev`, put `XSOLANA_RPC_URL` in `.dev.vars` to test this path. In `.env` it configures the dev server's
  own `/loot/v1/rpc` forward instead, which is the path a published page without `api/rpc` takes.

### What a payout rests on

A payout is only as safe as the parts of it a cheater can't fake. This section applies lenses 5 and 3 of
[BEFORE-YOU-BUILD.md](BEFORE-YOU-BUILD.md) to every route that pays, in three steps.

**1. Where each input comes from.** For each paid route, list every input that decides who is paid, how much, and for
which round, and where each comes from: the chain, state your server keeps, or the request. Whatever the request
decides, a cheater decides. A page alone can't prove a score or a win, because anyone can change it in the browser
console. So the result itself depends on how much the server checks. From strongest to weakest:

- **The server decides it.** A turn-based game played on the server, or a room whose Durable Object runs the match
  (the page sends inputs, never results). It pays what a bot that plays well can win.
- **The server replays it.** A deterministic game (fixed time step, seeded randomness, a deterministic physics build
  such as Rapier's): the page sends its inputs and the server runs them.
  - Randomness the page knows in advance is a request input: with the seed and the rules, a script can search for the
    best run offline. Reveal it as the run goes (or keep the seed on the server).
  - It pays the best run a script can find among the ones it is shown.
  - Replay costs CPU: one physics game used about 3 ms per second of play, against 50 ms per request on Free. Replay
    every run that pays and a random sample of the rest.
- **The server bounds it.** Any game the browser simulates. The server starts each run (an id, its own clock), takes
  checkpoints in order, and refuses progress faster than the game allows. Every bound is per unit of play time, never
  per request, so checkpoints sent quickly must not add up. It pays a script that waits and reports at human speed.

On every grant a voucher pays, declare which one `PAY.check` actually does: `"trust": "decides"`, `"replays"` or
`"bounds"`.

**2. The ceiling.** What one person can take = the identities they can create × what each may take × time. On Solana
a wallet is free, so a cap per wallet is multiplied by every wallet. These levers bound it, each enforced by the
platform:

| Lever                                                                                  | What it bounds                                            |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `VOUCHERS.payOnly = 'x'` (or `'account'`: X or Google, easier to make) and `perPerson` | identities: one per X (or Google) account, not per wallet |
| A grant's `perDay` (and `total`) in `xsolana.json`                                     | time: the most the grant pays per day, whoever claims     |
| A grant's `limits.tokens` in `xsolana.json`                                            | the tokens it gives in total: what a leaked key can drain |
| A gate on something the game sells (a pass, a creature)                                | identities: each one costs money                          |
| Pay only a proven wallet (signed in with, or linked by `gf.loot.link()`)               | who is paid: never a wallet the page names                |
| A board the server writes (`env.GF.scores.setup(board, {writer: 'server'})`)           | a ranking: the page's submits to it are refused           |

**3. Decide with the numbers in front of you.** Know the level, the ceiling, and what a cheater gets. Pay a bounded or
replayed result only what you would accept losing to a patient script (small amounts, capped per day). Keep entry fees
and prize pools for results the server decided and for chance (the oracle).

`xcore review` works through these three steps for every route that pays, with one record per route (its payout
ledger: who signs, what decides it, who is paid, the identity its limits count, the trust declared and observed, and
the ceiling). It shows the economy's own review alongside. With `--live`, it also calls each `api/` route with no
sign-in and with a forged one. Its `review.md` opens with "Questions to decide" and "What this build allows", and ends
with "What a cheater gets, and the trade-offs". The skill reference
`skills/xsolana-economy/references/trust-and-cheating.md` in `@xgamesfun/solana` has Solana's own exploit checklist.

`server/gf-loot/` includes @xgamesfun/solana's server helpers for this
(`import { … } from './gf-loot/results/index.js'`):

- `holds({ rpc, spec, wallet, item })` and `collectiblesOf(…)`: the game's collectibles a wallet holds, read from the
  chain;
- `proofRequest` / `verifyProof`: a wallet's signed proof (used by the wallet link);
- `makeCodes` / `codeVoucher`: promo codes with keys nobody can guess (80 bits by default).

### What your server does, declared

Most game economies rely on their server, and that is fine as long as the economy declares it. The economy tools
follow value only through `xsolana.json`, so two kinds of server behaviour must be declared there, or the checks can't
see them:

- **What it converts**, in `"offchain"`: anything the server turns a player's holdings or actions into (a code that
  multiplies earnings, a stake that counts as an entry, a prize bought with farm yield):
  `{ "key", "name", "takes": "<token>" | "item:<key>", "gives": "<token>" | "item:<key>" | "farm:<key>", "rate" }`.
  If it is not declared, every loop through it is invisible: a farm whose yield buys a bigger prize looks safe.
- **What it bounds**, on each grant a voucher pays, in `"serverLimit"`: the most the server signs for one identity per
  window, `{ "per": "person" | "wallet" | "all", "amount", "every": "1h", "total" }`. `amount` is in the prize's own
  units, and `every` defaults to `"1d"`. If it is not declared, the tools calculate with the chain's caps, which only
  bound a leaked voucher key and are often much looser.

`xcore review` checks these declarations against the code in both directions:

- `code-undeclared`: a conversion in `server/` with no declaration;
- `design-unbuilt`: a declaration that no code implements;
- `bound-undeclared`: a grant whose bound is enforced in its check but has no `serverLimit` (with the question to
  decide).

The "Design and code" section of its `review.md` drafts each missing declaration from the code, runs the economy check
on a copy of the spec with the drafts added, and reports what appears only with them (a loop through the server, the
bound the server really enforces). The drafts are inferred from code: confirm each one before you add it.

### Paying a result: xgames.fun's keeper, or a voucher key of your own

A reward for a result (a score, a win, a podium place) is a grant in the game's economy, claimed with a voucher: a
signature stating that this wallet earned it. The page can never sign one, because anyone can change a page in the
browser console. So a voucher comes from one of two signers. Both start from a result your server stands behind (see
above). They differ in who holds the key.

|                      | **xgames.fun's keeper** (`env.GF.loot.report`)                                     | **Your server's own key** (`xcore add vouchers`)                                      |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Who signs            | xgames.fun, with the game's host key (created for the game, never shown to anyone) | your server, with `VOUCHER_SEED` (a secret only it can read)                          |
| What a result pays   | by place: up to 16 winners per result, each paid its grant's own amount            | any amount up to the grant's (by score, by rank), calculated by your server           |
| How often            | 120 reports per hour per game                                                      | your plan's request rates                                                             |
| Setup                | the owner certifies the host key in Studio once; the grant names the keeper's key  | `xcore add vouchers`, `xcore secret set VOUCHER_SEED --new-key`, `xcore loot approve` |
| Under `xcore dev`    | printed, not signed                                                                | signed with the key in `.dev.vars`, against devnet                                    |
| Follows loot updates | when xgames.fun updates the keeper                                                 | when you update xcore (publish keeps `server/gf-loot/` at its loot version)           |

**Use the keeper** when the server already decides who won and the prize is fixed by place: a room's winner, the top
three of a match, a hidden item found first. You have no key to create or keep safe.

**Use your own key** when:

- the amount depends on the result (paid by score);
- you replay or bound runs before paying (any single-player game that pays);
- the game takes entry fees or has a prize pool;
- results come faster than 120 per hour; or
- payouts must not wait on anyone else's upgrade.

A grant can name up to three voucher keys, so both signers can pay the same grant. You can start with the keeper and
add your own key next to it later (`xcore loot approve` puts the change live). Changing a live grant keeps its
incarnation, so vouchers and rounds already paid stay as they were.

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
  `env.GF.loot.status()` reports whether the host key is certified.
- The winner's page claims every win at once:
  `await gf.loot.call('claimWins', { server: new URL('/loot/v1', location.href).href, token: gf.token })`.
- A grant that counts people (`perPerson`) counts each winner by their X account, within that grant. The keeper's key
  is the economy's issuer (Studio's setup configures this). A box, recipe or lottery that counts people is not counted
  this way: it reads the wallet's link, which holds the person from whichever grant's claim wrote it last.

#### Your own key: `xcore add vouchers`

```sh
xcore add vouchers <folder>      # needs the economy (xcore loot add) with a grant that pays results
```

The command:

- writes `server/vouchers.js` (routed at `api/vouchers/`, with its Durable Object `GameVouchers`);
- copies loot's voucher code into `server/gf-loot/` (bundled with the server, never a public file);
- creates a **test key** for `xcore dev`, with its seed as `VOUCHER_SEED` in `.dev.vars` (and, in a folder tracked by
  git, adds `.dev.vars` to `.gitignore`);
- prints the test key's address.

xcore sends the **live key** straight to xgames.fun. Set it up in this order.

1. Run `xcore add vouchers <folder>`, as above.
2. Write `PAY.check` at the top of `server/vouchers.js`: what your server checks before a result pays.
   - It receives the page's JSON, the signed-in player and `env`.
   - It returns `{grant, round, amount}` or `{why}` to refuse. `grant` is the grant's key or id. `round` is the
     result's own id (any text, used once). `amount` is in base units, or `'grant'` for the grant's own amount. The
     amount is always named, so a forgotten amount never pays the maximum.
   - Until you write it, nothing is paid.
   - Count a player's daily total in `PAY.paid`, not in `check`. `PAY.paid` runs once per round, after its voucher is
     signed, and again only if it threw.
   - For rewards worth farming, set `VOUCHERS.payOnly` to `'x'` or `'account'` (see
     [What a payout rests on](#what-a-payout-rests-on)). The grant's `perDay` total caps the rest.
   - Then give the grant its `trust` (what the check does: `decides`, `replays` or `bounds`) and run `xcore review`.

   This step comes before the key because the key is added to the grants that `PAY.check` names. On devnet, run
   `xcore add vouchers` again at this point: it adds the test key to those grants too, so vouchers signed under
   `xcore dev` are paid once step 5 has put it on chain. Never do this on mainnet, because a copy of the folder holds
   the test key.

3. Run `xcore publish` to deploy the server. It needs the live key before it can pay.
4. Run `xcore secret set VOUCHER_SEED --new-key`. A new key is created and sent to the server only. The command:
   - puts the key's address in the grants your server pays in `xsolana.json` (those that name a voucher key, and
     those `PAY.check` names);
   - makes it the economy's issuer where a grant counts people;
   - on mainnet, removes the test key;
   - reports each change.

   From then on, `api/vouchers/key` returns the live key's address.

5. Run `xcore loot approve` to put that on chain, signed by the key file that owns the economy.
6. Run `xcore publish` again. The page and the server both read `xsolana.json`, and this deploys it as it went live.

For a grant added later, or one that `PAY.check` starts to name: run `xcore add vouchers` again to point it at the live
key (it does not create a new one), then `xcore loot approve` and `xcore publish`.

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

- **A voucher pays a proven wallet**: the wallet the player signed in with, the one they linked, or one `PAY.check`
  names itself. Linking goes through `api/vouchers/link`: the wallet signs @xgamesfun/solana's proof text, which names
  the game, the link to this player, a nonce the server accepts once, and an expiry. A wallet named by the page is
  refused. One wallet is linked to one player at a time.
- **One result pays one wallet once.** `GameVouchers` remembers every round it signed. The same result asked again
  gets the same voucher (with no chain read, and a fresh one when it is about to expire). It never gets one for a
  different wallet or amount, and never one after the grant has been closed and created again (a new campaign pays
  new rounds only).
- **Rate:** a player may make `VOUCHERS.perMinute` pay and link requests per minute (20).
- **Keys:** the live key exists only on xgames.fun's server and is never shown again. If it is lost or leaked, run
  `xcore secret set VOUCHER_SEED --new-key` again (it replaces the old address with the new one in the grants, and as
  the issuer if the old one was), then approve. A leaked key can pay no more than the grant's limits (`perDay`,
  `total`, and `limits.tokens`, the tokens it gives in total), so keep them tight. The test key in `.dev.vars` signs
  only what the grant allows it to sign.
- **`person`:** a player signed in with X counts as one person, for a grant with `perPerson` (in total) or
  `perPersonEach` (`{ "count": 1, "every": "1d" }`: a daily bonus). The person is hashed with a key your server keeps,
  never the account itself.
  - A player signed in with a wallet only has no person, so such a grant refuses to pay them (`person`). They need to
    sign in with X.
  - The server derives that hashing key from its voucher key the first time it names a person and stores it in its own
    storage, so a person stays the same person when the voucher key is replaced. There is nothing to set.
  - Under `xcore dev`, each local player stands in for one signed in with X. `XCORE_DEV_SIGNIN=wallet xcore dev` signs
    them in with a wallet only, so you can try what a player without an X account sees.
- **The issuer.** loot (0.29 and later) counts the person a voucher names only when the economy's issuer signed it:
  `"keys": { "issuer": "<the live key's address>" }` in `xsolana.json`, the same key the grant names in `vouchers`.
  - The issuer is a single key, for vouchers that name a person and for any links.
  - With no issuer, `xcore loot check` refuses a grant that counts people. With a different key as the issuer, every
    claim is refused (`NotLinked`), and `xcore review` reports it.
  - A claim the test key signs under `xcore dev` counts a person only while the test key is the issuer, so try a
    per-person grant on a devnet copy of the economy.
  - A grant counts people or wallets, not both: use `perPerson` instead of `perWallet`.
- The person is hashed per grant, so it counts across all of their wallets within one grant. A box, recipe or lottery
  that counts people reads the wallet's link instead, which this server never writes. Count people on the grants it
  pays.
- Each payment is one request to your server and one read of the grant, through xgames.fun's relay or your own RPC
  (`xcore add rpc`).
- A grant's limits count claims, not amounts. For a daily cap on tokens, use the grant's amount with one claim per day,
  or your server's own count in `PAY.check`.
- If your `server/index.js` is your own rather than xcore's (it has no "Written by" line), route `handleVouchers` in it
  and export `GameVouchers`, as `xcore add vouchers` explains. `signVoucher` from `@xgamesfun/solana/results` produces
  the same signature, for a server that signs on its own.

## The game's database

`xcore add database` gives the game **one D1 database** (SQLite, run by Cloudflare). xgames.fun creates it on the
first publish that includes it, and keeps it between publishes. The server reads it as `env.DB`. It holds all of the
game's own data: its records (guilds, match history, shop stock), a player's state with rules (runs left today, gold),
and, for a game with no server, the documents its page saves. Its size is held to the game's plan: 100 MB on Free,
2 GB on Creator, 10 GB on Scale. On Free and Creator, past it, the game is capped and its server stopped until the
database is smaller ([HOSTING.md](HOSTING.md#when-a-game-is-capped)). A Scale game, or one whose plan xgames.fun
granted, is not capped for its database's size.

```json
{
  "database": {
    "engine": "d1",
    "binding": "DB",
    "migrations": "server/migrations",
    "collections": { "*": { "read": "owner", "write": "owner" }, "profiles": { "read": "anyone", "write": "owner" } }
  }
}
```

| Field         | Rule                                                                                                                                                                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine`      | `"d1"`, the only option.                                                                                                                                                                                                                                                                                               |
| `binding`     | Default `"DB"`: its name on `env`. The same rules as a Durable Object's binding (A–Z, 0–9 and `_`, not `GF` or `GF_…`), and it must not clash with one of them.                                                                                                                                                        |
| `migrations`  | Default `"server/migrations"`, a folder inside `server/` (never a public file). Files are named like `0001_init.sql`, `0002_add_guilds.sql`: four digits, `_`, lowercase words. At most 200 files, 1 MB each, and no statement over D1's 100,000 bytes.                                                                |
| `collections` | Who may read and write each collection of the page's documents (`GamesFun.db`, at `api/db/`). Enforced by the stock server, or by `server/gf-docs.js` in a server of your own (below). `read`: `"owner"` or `"anyone"`; `write`: `"owner"` or `"server"`. Without it, each player's documents are their own, as `"*"`. |

**Migrations are append only.**

- Publish applies new migrations, in name order, before the new version goes live.
- A migration that fails stops the publish. The previous version keeps running, and migrations applied before the
  failing one stay applied.
- Once published, a migration never changes. Put the next change in a new file, for example `0002_add_gold.sql`:
  `ALTER TABLE players ADD COLUMN gold INTEGER NOT NULL DEFAULT 0;`.
- A changed or missing migration is refused, both by `xcore publish` before anything is uploaded and by xgames.fun.
  So is an empty one (0 bytes).
- `xcore add database` writes `server/migrations/.gitattributes` (`*.sql -text`), so git on Windows never changes a
  migration's line endings (and therefore its sha256).
- Each database records the migrations it has applied in its own table, `_gf_migrations`, in the same batch as the
  migration. A restore to a point before a migration un-applies it, and the next publish applies it again.

### From a server of its own

In a game with a `server/`, `xcore add database` writes the `database` block, an example first migration
(`server/migrations/0001_init.sql`; change it before you publish) and `server/gf-db.js`:

```js
import { db, withPlayer } from './gf-db.js';

export default {
  async fetch(request, env) {
    const sub = await withPlayer(request, env); // env.GF.verifyPlayer's sub, or null for a guest
    if (!sub) return Response.json({ why: 'Sign in first.' }, { status: 401 });
    await db(env).run('INSERT OR IGNORE INTO players (id) VALUES (?)', sub);
    // a rule is one statement, so a burst of requests cannot spend the same run twice
    const left = await db(env).first(
      'UPDATE players SET runs = runs - 1 WHERE id = ? AND runs > 0 RETURNING runs',
      sub,
    );
    if (!left) return Response.json({ why: 'No runs left today.' }, { status: 409 });
    return Response.json({ runs: left.runs });
  },
};
```

`db(env).all`, `.first`, `.run` and `.batch([[sql, ...params], …])` (all statements or none) are prepared statements.
Pass every value as a `?` and an argument, never inside the SQL text. `env.DB` is D1 itself, for anything else.

**The page's documents in a server of your own.** When the block has `collections`, `xcore add database` (and
`add multiplayer`, `rpc` and `vouchers`) also writes `server/gf-docs.js`. It handles `api/db/*` the same way the
stock server does, from the same table (`gf_docs`), under the `collections` rules (read from `gamesfun.json` when the
server is bundled). xcore's own `server/index.js` routes it first. In an index file of your own, add this at the start
of `fetch`:

```js
import { handleDocs } from './gf-docs.js';
const db = await handleDocs(request, env);
if (db) return db;
```

- `docsOf(env)` gives the server its own access to the documents, bypassing the rules
  (`docsOf(env).put('news', 'today', {…})`).
- A game that used the stock server keeps its documents and rules when it gets a server of its own:
  `xcore add multiplayer` writes the rules it had into `collections`, and `server/gf-docs.js` serves them.
- Publish refuses a game whose block has `collections` while its server does not route `api/db/` (every `GamesFun.db` call
  would return 404), and explains how to fix it.

That check reads only the text of the files in `server/` (not `server/gf-docs.js` or `server/database.js`), looking for
a call to `handleDocs(` (or `handleDatabase(`), or `api/db` in the code. A router outside `server/` (such as a
`src/router.js` the server imports) is not read, so a game whose `api/db/` is routed only there is still refused. Keep
xcore's route in `server/`: the three lines above, at the start of `fetch` in `server/index.js` (or another file in
`server/`), before the request reaches your router.

### With no server: the stock server

A game with the `database` block and no `server/` gets **xcore's stock server** as its server. Publish bundles it
([`lib/client/server/stock.js`](../lib/client/server/stock.js), with `collections` built in). It serves the page's
`api/db/*` from the database, with the same routes and responses as the older `server/database.js`, so `GamesFun.db`
in the page works the same way. Its documents are in a table it creates itself, `gf_docs`.

- **Each player has their own space** in every collection. A document is `{id, owner, value, updatedAt}`, looked up by
  collection, owner and id. So two players can both have a `main` document, and nobody can take another player's id.
  By default, a player reads and writes only their own documents.
- `read: "anyone"`: everyone can read the collection. Read another player's document by naming its owner,
  `GamesFun.db.get('profiles', 'main', { owner: playerId })`, and a player's list with `{ owner: playerId }`.
  - An id alone means the player's own document. A `get` by id alone that finds only another player's document returns
    400 `owner` ("name whose document it is with `{owner}`").
  - `GamesFun.db.get` then returns `data: null` with `code: 'owner'` and logs it once in the console. A page that reads
    another player's document must pass its `owner` (every document includes it).
- `write: "server"`: only a server writes the collection (owner `"server"`). The page reads it without naming an owner:
  first from the server's space, then from the player's own (what the server wrote for that player, with
  `{owner: sub}`). So a `read: "owner"` + `write: "server"` collection (an inbox, a verified record) is read by id
  alone. The stock server runs none of your code, so such a collection needs a server of your own to fill it.
- Lists come newest first, one page at a time: `const page = await GamesFun.db.list('levels')`, then
  `GamesFun.db.list('levels', { after: page.after })`. `after` is `null` on the last page. `offset` has been removed:
  the client and the server refuse it with an error message, so a loop that paged with it stops instead of reading
  page 1 again.
- Lists are ordered by when each document was **last written** (`updatedAt`), so a document written between two pages
  moves to the front. A listing taken while players are writing can show it twice or not at all. To list something
  exactly, fetch it in one page (`limit` up to 100), or keep it in a table of your own (a server with its own
  migrations) with an order that doesn't change.
- Any `read` value other than `"anyone"` lists only the player's own documents (it fails closed). `collections` (or
  `RULES`) is checked when the server starts: a mistyped rule stops it, with an error message.

### On this machine, and on xgames.fun: `xcore db`

`xcore dev` runs a local D1 for the server, stored in `.gamesfun/dev/d1/` (hidden, never published). It applies the
same migrations when it starts and when it reloads. If a migration changes after it was applied locally, the server
stays down and shows the reason, just as xgames.fun would refuse it. Restore the migration, or delete
`.gamesfun/dev/d1/` to start the local database from scratch.

```sh
xcore db info                                     # here: its size, the migrations applied, its tables
xcore db query "SELECT * FROM players LIMIT 10"   # one statement; reads only without --write
xcore db query "UPDATE players SET runs = 3 WHERE id = ?" --params '["dev:ab12"]' --write
xcore db export                                   # SQL into .gamesfun/exports/ (or --out <file>)
xcore db import seed.sql                          # statements of your own, or an export; all or none
xcore db info --live                              # the same on xgames.fun, with --live
xcore db restore 2026-11-08T12:00:00Z --live      # back in time, up to 30 days (D1 Time Travel)
```

- `--live` goes through xgames.fun's owner routes with your sign-in (`xcore login`). Each call is recorded in the
  game's audit log.
- Without `--write`, a query can only be `SELECT`, `EXPLAIN`, `PRAGMA table_info` or `table_list`, both locally and
  live.
- A change to the live database (`query --write --live`, `import --live`, `restore`) first prints what it would change,
  with a code, and changes nothing. To go ahead, run it again with `--yes <code>`, or, at a terminal, type its word
  (`write`, `import`, `restore`). A code printed for a different change is refused.
- `restore` shows what it would go back to. Once done, it prints the command that undoes it:
  `xcore db restore <the moment before it> --live`. That moment comes from this machine's clock, read just before the
  restore is requested, because xgames.fun's restore takes a time, not a bookmark. `restored.previous` (the bookmark
  from before the restore) is printed too, but can't be passed back. If the clock is off by more than the time the
  restore took to start, the undo point lands a little before or after the true moment. Check it with the preview
  (`xcore db restore <time> --live`, without `--yes`) before you go ahead.

**A game with an economy:** a restore puts back the database only. Loot balances, items and payouts on chain stay as
they are, so a player can keep what they won while the database forgets it. Export first. An export contains your
players' data: keep it out of git and off shared drives.

Publish refuses a game with a database while xgames.fun does not run databases yet (its `GET /api/kit/me` lists
`"d1"` once it does), and says so.

**The older database**, `server/database.js` (one Durable Object with SQLite storage), keeps working for games that
have it, and `xcore add database` keeps it up to date. The check reports it as the older approach.

- It has the same owner spaces, rules and paging, with `RULES` at its top and `dataOf(env)` for the server's own code.
- Without an owner, `dataOf(env)` uses the server's own space (`dataOf(env).put('news', 'today', …)`); with one, a
  player's (`dataOf(env).get('profiles', 'main', { owner: sub })`).
- Code written for its first version, which looked a document up by id alone, needs `{ owner }` wherever it reads or
  writes a player's document by id. `xcore add database` and publish list each such call
  ([UPGRADING.md](UPGRADING.md)).

## Running it locally

`xcore dev <folder>` runs `server/` under workerd, the same runtime xgames.fun uses, at the page's `/game/api/*`
(WebSockets included), with the game's page next to it and a local `env.GF`.

- `verifyPlayer` accepts the local sign-in that `gamesfun.js` gets from the dev server. A tab that signed in is signed
  in again, with a new token, after a reload and after `xcore dev` restarts. A token from before it started is
  refused, just as one signed with a rotated key is refused when hosted.
- Saves and scores are the ones the page reads through `/platform/v1/*`, stored in `.gamesfun/dev-platform.json`.
- `env.GF.loot.report` is printed, not signed or paid. A voucher key of your own (`xcore add vouchers`) signs for
  real, with the test key in `.dev.vars`.
- The dev host answers only `localhost`, `127.0.0.1` and `[::1]`, so a page on another site can't reach it.

Local state:

| What                   | Where                                                         |
| ---------------------- | ------------------------------------------------------------- |
| Durable Object storage | `.gamesfun/dev-server/`                                       |
| The game's database    | `.gamesfun/dev/d1/` (a local D1, with its migrations applied) |
| Project files          | `.gamesfun/dev/files/` (public ones on a port of their own)   |
| Secrets                | `.dev.vars`                                                   |

A change under `server/`, to `gamesfun.json` or to `.dev.vars` rebuilds and reloads the server. Miniflare (with
workerd, about 180 MB) is installed on first use, into xcore's state folder. `GAMESFUN_SERVER_DEPS=<folder>` uses a
copy installed elsewhere.

Differences from hosting:

- There are no CPU or request limits. The log reports (in lines starting `limits:`) when the page's requests would
  exceed Free's or Creator's rate, or when a request takes longer than Free's CPU limit allows.
- Outbound `fetch` is not limited to `backend.json`'s origins.

A named export that is a plain value (`export const SEASON = 5`) makes the runtime refuse to start the server. Export
only the default export and the Durable Object classes. The check reports this before you publish.

## Publishing it

`xcore publish` bundles `server/` into **one file** with esbuild (minified, with the contract's own options). It runs
the checks above and the secret scan over each server file and over the bundle, and sends the bundle with the game's
files if xgames.fun accepts server code. Otherwise it publishes the files alone and says so. `xcore publish --check`
shows the bundle without publishing:

```
my-vault: 278 files, 10 MB, nothing refused. Left out: .gamesfun/, .gitignore, gamesfun.json, server/.
  server code: server/index.js bundled from 1 file (server/index.js) into one 4.2 KB file, sha256 98b594a47bc6…,
  Durable Objects Vault (env.VAULT); server/ and gamesfun.json are not public files
```

Once hosted, the game's server is at `https://<slug>-play.xgames.fun/api/…`. A blocked or over-limit server returns
`{error, message}` with status 451, 429, 404, 503 or 502 instead of the server's own response.

**A game that is unpublished, taken down or capped** (over its plan's money for the month, or its database over its
plan's size: see [HOSTING.md](HOSTING.md#plans-xcore-plan)) has its server switched off: every `api/*` request answers
`451 {"error": "stopped", "reason": "unpublished" | "taken-down" | "capped", "message"}`, its Durable Objects' alarms
lapse and their sockets close.

- A running room stops within about five minutes.
- Its rooms' data and its secrets are kept.
- The server comes back on its own when the game is published again (within 30 days, to be sure its data is kept) or
  when its cap lifts (the start of the next month, a Creator account, usage credit or a higher card spending cap, or
  a database made smaller).
- A version published while the game is capped goes live with its pages, and its server waits.
- The page keeps loading in the meantime, so a game whose server can be off should tell players so when `api/`
  returns 451.

While the game's owner has it **paused for maintenance** (xgames.fun/console, the Live tab;
[CLIENT.md](CLIENT.md#live-settings-gamesfunlive)), xgames.fun answers its `api/*` itself with
`503 {ok: false, code: 'maintenance', why, since}` and `retry-after: 60`, WebSocket upgrades included. The server's
code does not run for new requests. Whatever is already running keeps running (an open WebSocket, a Durable Object's
alarm, the `env.GF` calls they make). A server that should stop those can read the game's `GET /platform/v1/live`
(`maintenance` is `{message, since}` while paused). `xcore dev` does the same, from `.gamesfun/live.json`.
