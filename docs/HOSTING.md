# What xgames.fun hosting takes

This document covers what a game needs to be hosted at an xgames.fun link, what the host does with it, and its limits.

- `xcore adopt` lists what does not fit.
- `xcore check` runs the page the way the host serves it.
- `xcore publish` refuses everything this document lists as refused.

Contents:

- [The rules](#the-rules): the page, where it is served, the play page's frame, a server, a backend, Solana, what the
  page may load, the host's paths, which files are uploaded, what is always refused
- [Limits](#limits)
- [Plans: `xcore plan`](#plans-xcore-plan): Free and Creator accounts, the plan table, what happens when a game is
  capped
- [A backend](#a-backend): one you run, a hosted service, or a server xgames.fun runs
- [Frameworks and engines](#frameworks-and-engines): several pages, Nuxt, React Router, monorepos, Godot, Unity,
  Unreal, a Node server
- [Your own site and your own domain](#your-own-site-and-your-own-domain-xcore-embed-xcore-domain)
- [Your game's data, and getting it out](#your-games-data-and-getting-it-out)
- [What is not supported, and why](#what-is-not-supported-and-why)

For every cost in one table (hosting, the paid plan, coin launch, loot fees, randomness, Metaplex), see
[FEES.md](FEES.md).

## The rules

You don't need to change how your game is built. It keeps its code, its framework and its build, as long as it fits
the hosting:

- static files that a browser runs on its own;
- optionally, a backend that is public on the internet, or a server of its own that xgames.fun runs.

### The page

The host serves static files as they are (GET and HEAD).

- `index.html` at the root of the published folder is the game's entry point.
- A folder URL ending in `/` serves that folder's `index.html`.
- Any other missing path returns a "not found" page. There is no fallback to `index.html`. A client-side router works
  from the entry page, but a deep link such as `/level/3` returns "not found" on reload.

### Where it is served

- Once published: at the root of the game's own origin (the link `xcore publish` prints).
- In xgames.fun Studio's preview: under a folder.
- In `xcore dev`: under `/game/`.

Use relative URLs (`./assets/x.js`, not `/assets/x.js`) so the game works in all three.

### Paths from the root

`xcore adopt` and `xcore check` name each file the page loads by a path from the root (`/assets/x.js`), with the
setting for the framework adopt detected. Every framework's setting:

| Framework             | Setting for relative paths                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plain HTML            | `./x` instead of `/x`                                                                                                                                                                                  |
| Vite                  | `base: './'` in `vite.config` (not with React Router's framework mode: see [React Router's framework mode](#react-routers-framework-mode))                                                             |
| Next.js static export | `assetPrefix: '.'` in `next.config`, production builds only, so `next dev` keeps working. One page only: with more, Next.js has no relative mode ([A game of several pages](#a-game-of-several-pages)) |
| Astro                 | `build: { assetsPrefix: '.' }` in `astro.config` (`base: './'` does not do it). One page only                                                                                                          |
| Nuxt                  | `ssr: false`, `app: { cdnURL: './' }` and `router: { options: { hashMode: true } }` in `nuxt.config`; in templates, `:src="'x.png'"` for a file in `public/` (`src="./x.png"` is read as an import)    |
| Create React App      | `"homepage": "."` in `package.json`                                                                                                                                                                    |
| Parcel                | build with the option --public-url ./                                                                                                                                                                  |

### Routing by path

The host serves files only, with no fallback to `index.html`. A route such as `/level/2` answers "not found" when it
is opened or reloaded, and under a folder (the preview, `xcore dev`) no route matches. A `<base href>` is refused too.
Use hash routing (`#/level/2`); links people already shared keep their old paths.

| Router       | Hash routing                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Vue Router   | `createWebHashHistory()`                                                                                   |
| Nuxt         | `router: { options: { hashMode: true } }` in `nuxt.config`                                                 |
| React Router | `createHashRouter` or `<HashRouter>` (framework mode has none: [see below](#react-routers-framework-mode)) |
| Angular      | `withHashLocation()` in `provideRouter` (or `useHash: true`), and no `<base href>` in `src/index.html`     |

### Inside the play page

xgames.fun shows the game in a frame with `sandbox="allow-scripts allow-same-origin allow-pointer-lock"` and
`allow="autoplay; fullscreen; gamepad; clipboard-write"`. Inside this frame there are no form submits, no pop-ups and
no top-level navigation, so a `<form>`, `window.open` or a link that leaves the game does nothing.

Sign-in, the wallet and full screen go through `gamesfun.js`, and the play page handles them. `xcore check` also loads
the game in this frame, and fails a page that tries any of these while it loads. Test each flow inside the play page,
not only in the bare game.

### Its server, if any

A game can have a server: `server/` plus `gamesfun.json` → `server`. It is a Cloudflare Worker that answers the game's
`/api/*`. It can use up to 8 Durable Objects and the platform binding `env.GF` (sign-in, saves, scores, loot reports).
See [SERVER.md](SERVER.md). It is bundled into one file when you publish, and it is never a public file.

### A backend of its own

The page may reach any public `https://` or `wss://` origin listed in `backend.json` → `origins`:

- at most 8 origins;
- public host names only (no IP addresses, no localhost).

The play host lets the page reach exactly those origins. [A backend](#a-backend), below, shows how to declare one.

### Solana

The page client in the game (`gf/loot/`, from `@xgamesfun/solana`) sends Solana calls to one of these:

- the game's own RPC on the economy's cluster (`xcore add rpc`: the server's `api/rpc`);
- otherwise, the play host's `/loot/v1/rpc`. This is xgames.fun's shared relay. Its calls are billed: they use up the
  included amount, counted at cost ($10 a million), and past it are charged from usage credit at $20 a million. They
  never count toward the cap that switches a game's server off. On devnet it is the devnet relay. For an economy on
  mainnet, it answers only the game's signed-in players.

See [ECONOMY.md](ECONOMY.md).

### What the page may load

- **Scripts, style sheets, fonts and frames**: from the game's own files only. Inline scripts, `eval`, WebAssembly and
  Web Workers from the game's own files are allowed.
- **No `SharedArrayBuffer`**: the page is not cross-origin isolated. Export engines single-threaded.
- **Connections**: to the game's own origin and to `backend.json`'s origins.
- **Pictures and sounds**: from the game's own files and from those `https://` origins.
- **Not allowed**: `<base>`, form posts, `<object>`.
- **Device features**: camera, microphone, location, payments and USB are off. Fullscreen, pointer lock, gamepads,
  audio and WebGL are not limited by the page's headers.

### Paths the host owns

The host answers these paths itself:

- `/api/*` (the game's server, when it has one)
- `/platform/v1/*`
- `/signal/v1` (multiplayer signaling)
- `/watch/v1` (the live watch)
- `/world/v1/` (world saves)
- `/player/v1/` (player keys)
- `/loot/v1/*`

A game file under one of these paths is never served.

### Files

Everything in the published folder is uploaded, except:

- hidden files and folders (names starting with a dot), at any level;
- at the top level: `evidence/`, `node_modules/`, `server/`, `supabase/`, `gamesfun.json`, and the makers' notes
  (`README.md`, `NOTES.md`, `LAUNCH.md`, `FRICTION.md`, `CLAUDE.md`, `AGENTS.md`, `TODO.md`).

`.gitignore` is not read. Move development material out of the published folder, or give it a name that starts with a
dot.

A file with an extension the host does not recognize is served as `application/octet-stream` with `nosniff`. That is
fine for data read with `fetch()`, but a browser will not run it as a script or a style sheet.

Two small records are uploaded with every version, because xgames.fun keeps them with each one:

- `foundation.lock.json`: which tool published it;
- `adaptation-plan.json`: the game's title and a one-line description.

Like every published file, both can be read at the game's link.

### Refused, always

- `.env` files
- symbolic links
- key and certificate files
- wallet keypairs
- anything in a text file that looks like a secret: private keys; cloud, payment and AI keys; a Supabase service-role
  key; a database address with a password. xgames.fun runs the same scan again on its side.

A browser game may only carry keys that are made to be public: a Supabase anon or publishable key, or a Firebase web
config's `apiKey`.

## Limits

| What                             | Limit                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| One game                         | 3,000 files, 100 MiB (104,857,600 bytes); a single file may use all of it                                                         |
| One account                      | 30 publishes and 1 GB of new files a day; 2 games on Free, 10 on Creator. Publish reads your account's own limits from xgames.fun |
| The server bundle                | 5 MB                                                                                                                              |
| The game's server, saves, scores | set by its plan ([below](#plans-xcore-plan), `xcore plan`)                                                                        |

## Plans: `xcore plan`

A plan is bought for your **account**, and every game you own takes its plan from it:

- A **Free** account (everyone's to start with) has up to **2 games**, each on the Free plan with $1 of use a month.
- A **Creator** account ($15 per 30 days) has up to **10 games**, all on the Creator plan, with **$10 of use a month
  shared** by them. There are no slots to buy or move: a game you publish is on Creator from the start.
- A new game is refused while the account has all its games. Archive a game you no longer need (on your console at
  xgames.fun/console; unpublish it first), or, on Free, buy a Creator account. `xcore publish` says so before it
  uploads anything.
- An archived game no longer counts, unless its link or its server is still live.

The plan sets what the game's server, saves and scores may use:

|                      | Free                                                               | Creator                                     | Scale                   |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------- | ----------------------- |
| For                  | the games of a Free account (up to 2)                              | the games of a Creator account (up to 10)   | granted by xgames.fun   |
| Server               | 50 ms of CPU a request; 600 requests a minute, 120 from one player | 200 ms; 6,000 a minute, 600 from one player | 1,000 ms; 30,000, 1,200 |
| Saves and scores     | 10 MB of saves; 8 boards of 10,000 entries                         | 1 GB; 16 boards of 1,000,000                | 10 GB; 16 of 1,000,000  |
| Use included a month | $1 a game                                                          | $10 for the account, shared by its games    | as granted              |
| Sites that embed it  | 3 (`xcore embed`)                                                  | 10                                          | 25                      |
| Domains of your own  | none                                                               | 1 (`xcore domain`)                          | 5                       |

All costs, including the Creator account, usage credit and its unit prices, are listed in [FEES.md](FEES.md).

### When a game is capped

Past what is included, a game is **capped** until the month ends: **its server is switched off** (every `api/*` request
answers 451 with `reason: "capped"`, and a room that is running stops within about five minutes), and saves and scores
slow down (60 save writes, 30 score submits and 60 reads a minute). Its pages keep loading and nothing is lost. The
server comes back on by itself when the cap lifts ([SERVER.md](SERVER.md#publishing-it), "Publishing it"). The server of
an unpublished or taken-down game is switched off the same way. A Creator account's games share their included use,
so they are capped together, and come back on together.

A game's server gets a 429 with `scope` (`"player"` or `"game"`) and `plan` when it goes past a rate limit.

### Paying for a Creator account and usage

- A Creator account costs $15 per 30 days, prepaid in SOL or USDC on xgames.fun (your console → Plans), for 1 to 12
  periods at a time.
- There is no automatic renewal. After the period ends there are 7 days' grace. Then every game drops to Free limits
  and keeps running; nothing is taken down. A new game waits until the account has fewer than 2 games, or is renewed.
- A Creator account's games are capped together when they pass the $10 they share, since the included use is the
  account's.
- Usage credit, bought the same way, lets them go past what is included instead of being capped, at published unit
  prices ([FEES.md](FEES.md#unit-prices); `xcore plan --verbose` prints xgames.fun's).

### Seeing a plan

- `xcore plan [folder]` shows your account (its plan, games, included use and period), then the game's plan, its
  limits and this month's use.
- `xcore plan --all` shows your account and every game; `--verbose` adds the unit prices.
- `xcore dev` imitates a plan's limits on your machine: see
  [COMMANDS.md](COMMANDS.md#the-plans-limits-refused-as-published).

## A backend

There are three ways to give a game a backend. You can use any of them, or none.

- **One you already run**:

  ```sh
  xcore backend use custom <folder> --url https://api.example.com [--origin wss://live.example.com]
  ```

  This writes `backend.json` with the URL's origin and its `wss://` counterpart, plus any `--origin` you add (another
  host, or a CDN for its pictures). No client is copied: the game's own code calls the backend. The backend must answer
  CORS for the game's origin: the published link's, and `http://127.0.0.1:<port>` under `xcore dev`. Don't put keys in
  the game, except keys made to be public.

- **Supabase, Railway or another hosted service**: set it up on that service, then declare its URL with
  `backend use custom`, as above.
- **A server xgames.fun runs**: `server/index.js` and `gamesfun.json` → `server` (the `gf-server-v1` contract, see
  [SERVER.md](SERVER.md)). It is a Worker on the game's `/api/*`, with:
  - Durable Objects for rooms and state;
  - `env.GF` for sign-in, saves and scores;
  - your own secrets as `env.<NAME>` (`xcore secret set <NAME>`). Secrets are kept on the server's host only, are never
    shown again, and are never given to the page.

  `xcore dev` runs it under workerd at `/game/api/*`, with secrets from `.dev.vars`. Publish bundles it. This is the
  way to have server logic without running a host of your own.

A brought game with a build keeps `backend.json` in its `static` folder, so the build includes it in what is
published.

A database you already have (Postgres, MySQL, a hosted one) stays where it is, behind a backend of your own. The page
never holds its address or password.

A backend of your own should check a player's sign-in token as described in
[SERVER.md](SERVER.md#check-the-token-first).

## Frameworks and engines

`xcore adopt` recognizes the common builds ([COMMANDS.md](COMMANDS.md#adopt)). The cases below need extra steps.

### A game of several pages

Examples: a Next.js export with routes, or Astro pages. These builds link their pages from the root (`/level/2/`), and
Next.js has no relative mode for them.

- Every page works at the published link, which is the game's own origin.
- They do not work under a folder. `xcore check` serves the game under a folder, as Studio's preview does, so it fails
  them, and publish saves a private draft.

Until xgames.fun previews games at an origin of their own, make the game a single page that changes screens itself
(or uses a hash router), or keep it a single-page export.

### A Nuxt game

With its defaults, `nuxt generate` links every file from the root and routes by path. Make it a single page that can
be served from any folder:

- in `nuxt.config`: `ssr: false`, `app: { cdnURL: './' }` and `router: { options: { hashMode: true } }`;
- in the game's own code, use relative paths: `fetch('levels.json')`, and in a template `:src="'moth.png'"` for a file
  in `public/` (Vue reads `src="./moth.png"` as an import).

### React Router's framework mode

`react-router.config` with `ssr: false` builds one page for `/` and routes by path. It has no hash mode and no relative
mode: with `base: './'` it loads its routes from `assets/assets/` and reloads forever. It works at the published link
but not under a folder, so `xcore check` fails it like a game of several pages.

For a game that works everywhere, use React Router as a library in a Vite app, with `createHashRouter`.

### A monorepo

For npm, Yarn or Bun workspaces, or `pnpm-workspace.yaml`:

- Adopt the repository's root when its build script builds the game. The output is found in the workspace it built
  (for example `packages/game/dist`).
- Or adopt the game's own package. Packages installed at the root count as installed.

### A game exported by an engine

This covers Godot, Unity, Defold and GameMaker. Adopt the project, not the export folder the engine rewrites, and name
the export:

```sh
xcore adopt . --out build/web
# or, with an export command:
xcore adopt . --build "<export command>" --out build/web
```

- A Godot project that was never exported for the Web gets a Web preset from `xcore adopt .` (single-threaded, into
  `build/web/`), plus the one command that exports it. Export, then adopt again.
- Export again before each publish. With no build command, `check` and `publish` take the export as it is on disk.
  `check` tells you when the project changed after the export.
- `gamesfun.json` and `evidence/` then stay out of the export.
- A whole export must fit in 100 MiB. A stock Godot 4 `index.wasm` is about 36 MB, so the game's own `index.pck` has
  the rest. Compressed textures and Ogg audio keep it small.

Engine notes:

- **Godot 4.3 or later**:
  - Export for the Web with **Thread Support off**. An xgames.fun page is not cross-origin isolated, so a threaded
    export stops at "missing features". Godot 4.0 to 4.2 always use threads: upgrade.
  - `xcore add signin` gives sign-in, saves and leaderboards from GDScript ([CLIENT.md](CLIENT.md)).
  - Godot's ENet does not run in a browser. Use `xcore add multiplayer` and `GamesFun.join_room` to run the game's
    high-level multiplayer on xgames.fun's rooms unchanged ([CLIENT.md](CLIENT.md#rooms-xcore-add-multiplayer)), or use
    a `WebSocketMultiplayerPeer` to reach a server of your own (`backend use custom`).
- **Unity**:
  - `xcore add signin` gives sign-in, saves and leaderboards from C# ([CLIENT.md](CLIENT.md)).
  - In Player Settings → Publishing Settings, set **Compression Format** to **Disabled**, or keep compression and turn
    on **Decompression Fallback**. The play host sends files as they are, with no `Content-Encoding`, so a Brotli or
    Gzip build without the fallback stops at "Unable to parse".
  - Keep Multithreading off, for the same reason as Godot's threads.
  - A service that connects to many host names (Photon's regional servers, for example) needs each one listed in
    `backend.json` (at most 8, no wildcards).
- **Unreal Engine**: Unreal 5 has no web export. Unreal 4.24 moved HTML5 out of the engine to a community project that
  is no longer maintained. So there are no files to publish. Pixel Streaming runs the game on a GPU server of your own
  and streams it as video. xgames.fun does not host that server, and a page that shows such a stream is untested.

### A game with its own Node server

This covers a server such as Express or Socket.IO, deployed on Render, Fly or similar, whose page is a folder of
static files (`public/`). Adopt publishes that folder, and the server stays where it runs:

1. Declare the server with `backend use custom`.
2. Point the page's connections at its address (`io('https://…')` instead of `io()`).
3. Copy any client file the server hands out (such as `/socket.io/socket.io.js`) into the game.
4. Make the server answer CORS for `https://<slug>-play.xgames.fun`.

## Your own site and your own domain: `xcore embed`, `xcore domain`

A published game plays at its xgames.fun link and inside a post on X. Your own website can show it too. On Creator and
Scale, it can also be hosted at a domain of yours.

```sh
xcore embed add https://mygame.com     # mygame.com may frame the game; prints the <iframe> for its page
xcore domain add play.mygame.com       # Creator or Scale: prints the DNS records to add at your domain's DNS
xcore domain check play.mygame.com     # live once the records are right (xgames.fun also checks by itself)
xcore domain                           # where the game plays, the sites that embed it, its domains
```

### Embedding

- Available on every plan: 3 sites on Free, 10 on Creator, 25 on Scale.
- A site is its origin: `https://mygame.com`, or `http://localhost:<port>` while you build it.
- A change applies within about a minute, with no publish.
- Framed on your site, the game signs players in by itself (with a small xgames.fun window, or a code), as it does in
  a post on X. Only xgames.fun's own page can hand the game a sign-in, so a page that embeds it can't sign players in
  for it or take their sign-in.
- A framed game never asks xgames.fun who the visitor is and keeps no sign-in. A player taps Sign in there, and after a
  reload of the page they are signed out.

### A domain of your own

- Available on Creator (1 domain) and Scale (5).
- `domain add` prints two DNS records: a CNAME pointing the domain at xgames.fun, and a TXT record that proves you own
  it.
- Once the records are right, the game is served there with its own certificate. Sign-in, saves, scores, rooms, the
  server and the economy work there as they do on its xgames.fun link.
- Sign-in still opens a small xgames.fun window, on a phone too. Your domain is a different site from xgames.fun, so a
  returning player clicks Sign in once per visit there, and a reload keeps the sign-in for the hour.
- Studio stays on xgames.fun, and a post on X still uses the xgames.fun link.
- A bare domain (`mygame.com`) needs your DNS provider's CNAME flattening or an ALIAS record. Otherwise use `www.` or
  `play.` and redirect.
- The page must load `gamesfun.js` 1.2.0 or later, which asks the play edge which game it is on when it runs on a host
  of its own. An older copy can't sign players in there, so `domain add` tells you when to run `xcore add signin` and
  publish again.
- If the game's plan drops, its domain is paused: it sends players to the xgames.fun link until there is room again.
- Custom domains work only once xgames.fun's operator has set them up (Cloudflare for SaaS). Until then,
  `xcore domain` says so.

## Your game's data, and getting it out

A published game's data is kept in three places. Only the first two can be exported in full today.

| Data                                                                                                                      | Where it is kept                                  | How to get it out                                                                 |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| The game's database: your server's tables, and the page's `GamesFun.db` documents                                         | the game's own D1 database on xgames.fun          | `xcore db export --live` writes all of it as SQL; `xcore db import` loads it back |
| Project files (`env.GF.files`)                                                                                            | xgames.fun's file store for the game              | `xcore files list --live`, then `xcore files get <path> --live` for each file     |
| Player saves and leaderboards (`GamesFun.saves`, `GamesFun.scores`, and `env.GF.saves` and `env.GF.scores` on the server) | xgames.fun's player services, not the D1 database | no bulk export yet; see below                                                     |

`xcore db export` does not include saves or leaderboards. A game's own server can read them through `env.GF`
([SERVER.md](SERVER.md#envgf-the-platform)), within these limits:

- **Saves:** `saves.list(player)` and `saves.get(player, key)` read one player's saves. Nothing lists every player, so
  a server can only export the players it already knows (for example, from its own database or a leaderboard).
- **Leaderboards:** `scores.list()` lists the game's boards, and `scores.top(board, {limit, offset})` reads a board in
  pages of up to 100 entries. `xcore dev` stops at an offset of 10,000, so the full contents of a larger board can't
  be read this way. Player ids are specific to each game.

The local copies that `xcore dev` uses are files in the game's folder: `.gamesfun/dev/d1/` (the database),
`.gamesfun/dev/files/` (project files) and `.gamesfun/dev-platform.json` (saves and scores).

## What is not supported, and why

- **Server-side rendering** (a page built per request by Node): the host serves files only. Make the page static, and
  put what needs a server in `server/` (a Worker) or in a backend of your own.
- **A server in Python, Ruby, Go or another language**: xgames.fun runs only `server/` (a Worker, in JavaScript or
  WebAssembly). Your options:
  - run that server on a host of your own, declared with `backend use custom`;
  - move its logic into `server/`;
  - move its logic into the page (WebAssembly is allowed; Pyodide runs Python in the browser).

  Each option changes how the game is built, so the game's maker decides.

- **A Node server as the backend on xgames.fun**: `server/` is a Worker, not Node. There are no Node built-ins
  (`nodejs_compat` is not offered): no `fs`, `child_process`, raw sockets or listening sockets. A Node backend runs on
  a host of your own, declared with `backend use custom`.
- **Scripts, style sheets and fonts from a CDN**: the page loads code and styles from its own files only. Put a copy in
  the game, or bundle the package.
- **A fallback to `index.html` for every path**: deep links of a client-side router return "not found" on reload. Use a
  hash router, or links that start at the entry page.
- **Keys that are public by design but look like secrets**, other than the two the scan recognizes (a Supabase anon or
  publishable key, and a Firebase web config's `apiKey`): the host's scan refuses them like any other key. Fetch such a
  configuration at run time from your backend.
- **More than 8 backend origins, IP addresses, localhost, wildcards**: the host opens the page's policy to named public
  origins only.
- **A threaded engine export, or a Brotli or Gzip build without a fallback**: the page is not cross-origin isolated,
  and the play host sends files with no `Content-Encoding` ([A game exported by an engine](#a-game-exported-by-an-engine)).
- **Unreal Engine**: Unreal 5 has no web export ([above](#a-game-exported-by-an-engine)).
