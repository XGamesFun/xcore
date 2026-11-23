# What xgames.fun hosting takes

What a game has to be to play at an xgames.fun link, what the host does with it, and its limits. `xcore adopt` lists
what does not fit, `xcore check` runs the page as the host serves it, and `xcore publish` refuses what is refused here.

- [The rules](#the-rules): the page, where it is served, the play page's frame, a server, a backend, Solana, what the
  page may load, the host's paths, which files go up, what is always refused
- [Limits](#limits)
- [Plans: `xcore plan`](#plans-xcore-plan): slots, the plan table, what being capped does
- [A backend](#a-backend): one you run, a hosted service, or a server xgames.fun runs
- [Frameworks and engines](#frameworks-and-engines): several pages, Nuxt, React Router, monorepos, Godot, Unity,
  Unreal, a Node server
- [Your own site and your own domain](#your-own-site-and-your-own-domain-xcore-embed-xcore-domain)
- [What is not supported, and why](#what-is-not-supported-and-why)

## The rules

Nothing about a game you bring changes: it keeps its code, its framework and its build, as long as it fits the hosting:
static files a browser runs on its own, plus, if it needs one, a backend that is public on the internet or a server of
its own that xgames.fun runs.

### The page

Static files, served as they are (GET and HEAD). `index.html` at the root of what is published is the game's entry. A
folder URL ending in `/` serves that folder's `index.html`; any other missing path is a "not found" page, with no
fallback to `index.html` (a client-side router works from the entry page; a deep link to `/level/3` reloads to "not
found").

### Where it is served

At its own origin's root once published (the link `xcore publish` prints). Under a folder in xgames.fun Studio's
preview, and in `xcore dev` (`/game/`). A game uses relative URLs (`./assets/x.js`, not `/assets/x.js`), so it works in
all of them.

### Inside the play page

xgames.fun shows the game in a frame (`sandbox="allow-scripts allow-same-origin allow-pointer-lock"`,
`allow="autoplay; fullscreen; gamepad; clipboard-write"`): no form submits, no pop-ups and no top-level navigation, so a
`<form>`, `window.open` or a link that leaves does nothing there. Sign-in, the wallet and full screen go through
`gamesfun.js`, which the play page answers. `xcore check` loads the game in this frame too, and fails a page that tries
one of them as it loads. Test a flow inside the play page, not only the bare game.

### Its server, if any

`server/` and `gamesfun.json` → `server`: a Cloudflare Worker that answers the game's `/api/*`, with up to 8 Durable
Objects and the platform binding `env.GF` (sign-in, saves, scores, loot reports). [SERVER.md](SERVER.md). Bundled into
one file on publish; never a public file.

### A backend of its own

Any public `https://` or `wss://` origin, listed in `backend.json` → `origins` (at most 8, public names only, no IP
address, no localhost). The play host lets the page reach exactly those. [A backend](#a-backend), below, has the ways
to declare one.

### Solana

Through the game's own RPC on the economy's cluster (`xcore add rpc`: its server's `api/rpc`), else the play host's
`/loot/v1/rpc` (xgames.fun's shared relay, counted toward the game's plan: devnet's, and for an economy on mainnet one
that answers only the game's signed-in players), with the page client in the game (`gf/loot/`, from
`@xgamesfun/solana`). [ECONOMY.md](ECONOMY.md).

### What the page may load

Scripts, style sheets, fonts and frames from its own files only (inline scripts, `eval`, WebAssembly and Web Workers
from the game's own files are allowed; a page is not cross-origin isolated, so `SharedArrayBuffer` is not available:
export engines single-threaded). Connections to its own origin and to `backend.json`'s origins; pictures and sounds
from its own files and from those `https://` origins. No `<base>`, no form posts, no `<object>`. Camera, microphone,
location, payments and USB are off; fullscreen, pointer lock, gamepads, audio and WebGL are not limited by the page's
headers.

### Paths the host owns

`/api/*` (the game's server, when it has one), `/platform/v1/*`, the multiplayer signaling (`/signal/v1`), the live
watch (`/watch/v1`), world saves (`/world/v1/`), player keys (`/player/v1/`) and `/loot/v1/*`. A file of the game under
one of them is never served.

### Files

Everything in the published folder goes up except hidden files and folders, and, at its top level, `evidence/`,
`node_modules/`, `server/`, `supabase/`, `gamesfun.json` and the makers' notes (`README.md`, `NOTES.md`, `LAUNCH.md`,
`FRICTION.md`, `CLAUDE.md`, `AGENTS.md`, `TODO.md`) (`.gitignore` is not read): move development material out of it,
or give it a name that starts with a dot. Hidden files and folders never go up. A file whose extension the host does
not know is served as `application/octet-stream` with `nosniff` (fine for data read with `fetch()`; a browser will not
run it as a script or a style).

Two small records go up beside them, as xgames.fun keeps them with every version: `foundation.lock.json` (which tool
published it) and `adaptation-plan.json` (the game's title and a one-line description). Like every published file,
they can be read at the game's link.

### Refused, always

`.env` files, symbolic links, key and certificate files, wallet keypairs, and anything in a text file that looks like a
secret (private keys, cloud, payment and AI keys, a Supabase service-role key, a database address with a password;
xgames.fun runs the same scan again). A browser game carries only keys made to be public: a Supabase anon or
publishable key, a Firebase web config's `apiKey`.

## Limits

- **One game**: 3,000 files, 100 MiB (104,857,600 bytes; one file may be all of it).
- **One account**: 30 publishes and 1 GB of new files a day, 100 games. Publish reads the account's own limits from
  xgames.fun.
- **The server bundle**: 5 MB.
- **What the game's server, saves and scores may use** is its plan (below, `xcore plan`).

## Plans: `xcore plan`

Every game sits in a **slot**. Everyone gets **2 free slots**, whose games run on Free; any more games need a **paid
slot** ($15 for 30 days), whose game runs on Creator. A new game is refused while both free slots are taken: archive one
you no longer need (on your console, xgames.fun/console; unpublish it first) or move one to a paid slot. Archived games
free their slot unless their link is still live. What the game's server, saves and scores may use is its plan:

|                      | Free                                                               | Creator                                              | Scale                   |
| -------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- | ----------------------- |
| For                  | a game in one of your 2 free slots                                 | a game in one of your paid slots (per game, a month) | granted by xgames.fun   |
| Server               | 50 ms of CPU a request; 600 requests a minute, 120 from one player | 200 ms; 6,000 a minute, 600 from one player          | 1,000 ms; 30,000, 1,200 |
| Saves and scores     | 10 MB of saves; 8 boards of 10,000 entries                         | 1 GB; 16 boards of 1,000,000                         | 10 GB; 16 of 1,000,000  |
| Use included a month | $1                                                                 | $10 a slot, shared by your Creator games             | as granted              |
| Sites that embed it  | 3 (`xcore embed`)                                                  | 10                                                   | 25                      |
| Domains of your own  | none                                                               | 1 (`xcore domain`)                                   | 5                       |

Past what is included, a game is **capped** until the month ends: **its server is switched off** (every `api/*` request
answers 451 with `reason: "capped"`, and a room that is running stops within about five minutes), and saves and scores
slow down (60 save writes, 30 score submits and 60 reads a minute). Its pages keep loading and nothing is lost: the
server comes back by itself when the cap lifts ([SERVER.md](SERVER.md#publishing-it), "Publishing it"). An unpublished
or taken-down game's server is switched off the same way. Paid slots are $15 for 30 days, prepaid in SOL or USDC on
xgames.fun (your console → Plans; no automatic renewal, 7 days' grace after the period ends; when they end, their games
go back to free slots and nothing is taken down). Usage credit, bought the same way, lets Creator games go past what
their slots include, at twice what xgames.fun pays, instead of being capped. A paid slot moves between your games at any
time (`xcore plan deactivate <one>`, `xcore plan activate <another>`) without changing the bill. `xcore plan [folder]`
shows a game's plan, its limits and this month's use; `--all` your free and paid slots and every game. A game's server
sees a 429 with `scope` (`"player"` or `"game"`) and `plan` when it goes past a rate.

`xcore dev` imitates a plan's limits on this machine: [COMMANDS.md](COMMANDS.md#the-plans-limits-refused-as-published).

## A backend

Three ways, any of them, or none:

- **One you already run**:
  `xcore backend use custom <folder> --url https://api.example.com [--origin wss://live.example.com]` writes
  `backend.json` with the URL's origin and its `wss://` twin, plus any `--origin` you add (another host, a CDN for its
  pictures). No client is copied: the game's own code calls it. The backend answers CORS for the game's origin (the
  published link's, and `http://127.0.0.1:<port>` under `xcore dev`). No key, unless one made to be public.
- **Supabase, Railway or another hosted service**: set it up there, then declare its URL with `backend use custom`, as
  above.
- **A server xgames.fun runs**: `server/index.js` and `gamesfun.json` → `server` (the `gf-server-v1` contract,
  [SERVER.md](SERVER.md)): a Worker on the game's `/api/*`, with Durable Objects for rooms and state, `env.GF` for
  sign-in, saves and scores, and your own secrets as `env.<NAME>` (`xcore secret set <NAME>`: kept on the server's host
  only, never shown again, never given to the page). `xcore dev` runs it under workerd at `/game/api/*`, with secrets
  from `.dev.vars`; publish bundles it. This is the way to keep server logic without a host of your own.

A brought game with a build keeps `backend.json` in its `static` folder, so the build publishes it.

A database you already have (Postgres, MySQL, a hosted one) stays where it is, behind a backend of your own: the page
never holds its address or password.

A backend of your own checks a player's sign-in token as [SERVER.md](SERVER.md#check-the-token-first) says.

## Frameworks and engines

`xcore adopt` knows the common builds ([COMMANDS.md](COMMANDS.md#adopt)). These need a word more.

### A game of several pages

A Next.js export with routes, Astro pages: such builds link their pages from the root (`/level/2/`), and Next.js has
no relative mode for them. Every page works at the published link, which is the game's own origin, but not under a
folder, so `xcore check` (which serves the game under one, as Studio's preview does) fails them and publish saves a
private draft. Until xgames.fun previews games at an origin of their own, make the game one page that changes screens
itself (or uses a hash router), or keep it a single-page export.

### A Nuxt game

`nuxt generate` with its defaults links every file from the root and routes by path. Make it one page that is served
from any folder: in `nuxt.config`, `ssr: false`, `app: { cdnURL: './' }` and `router: { options: { hashMode: true } }`;
in the game's own code, relative paths (`fetch('levels.json')`, and in a template `:src="'moth.png'"` for a file in
`public/`, since Vue reads `src="./moth.png"` as an import).

### React Router's framework mode

`react-router.config` with `ssr: false` builds one page for `/` and routes by path, with no hash mode and no relative
mode (`base: './'` makes it load its routes from `assets/assets/` and reload for ever). It works at the published link
but not under a folder, so `xcore check` fails it as a game of several pages. For a game that runs everywhere, use React
Router as a library in a Vite app, with `createHashRouter`.

### A monorepo

npm, Yarn or Bun workspaces, `pnpm-workspace.yaml`: adopt the repo's root when its build script builds the game; the
output is found in the workspace it built (`packages/game/dist`). Or adopt the game's own package: its packages
installed at the root count as installed.

### A game exported by an engine

Godot, Unity, Defold, GameMaker: adopt the project, not the export folder the engine rewrites, and name the export:
`xcore adopt . --out build/web` (or `--build "<export command>" --out …`). A Godot project never exported for the Web
gets its Web preset from `xcore adopt .` (single-threaded, into `build/web/`), with the one command that exports it;
export, then adopt again. Export again before each publish: with no build command, `check` and `publish` take the
export as it is on disk (`check` says when the project changed after it). `gamesfun.json` and `evidence/` then stay
out of the export. A whole export must fit in 100 MB: a stock Godot 4 `index.wasm` is about 36 MB, so the game's own
`index.pck` has the rest (compressed textures and Ogg audio keep it small).

- **Godot 4.3 or later**: export for the Web with **Thread Support off**, and `xcore add signin` for sign-in, saves and
  leaderboards from GDScript ([CLIENT.md](CLIENT.md)). A xgames.fun page is not cross-origin isolated, so a threaded
  export stops at "missing features" (Godot 4.0 to 4.2 always use threads: upgrade). Godot's ENet does not run in a
  browser: `xcore add multiplayer` and `GamesFun.join_room` put the game's high-level multiplayer on xgames.fun's rooms
  unchanged ([CLIENT.md](CLIENT.md#rooms-xcore-add-multiplayer)), or a `WebSocketMultiplayerPeer` reaches a server of
  your own (`backend use custom`).
- **Unity** (`xcore add signin` for sign-in, saves and leaderboards from C#, [CLIENT.md](CLIENT.md)): Player Settings →
  Publishing Settings, **Compression Format Disabled** (or keep it and turn on **Decompression Fallback**): the play
  host sends files as they are, with no `Content-Encoding`, so a Brotli or Gzip build without the fallback stops at
  "Unable to parse". Keep Multithreading off for the same reason as Godot's threads. A service that connects to many
  host names (Photon's regional servers, for example) needs each one listed in `backend.json` (at most 8, no
  wildcards).
- **Unreal Engine**: Unreal 5 has no web export (Unreal 4.24 moved HTML5 out of the engine, to a community project that
  is no longer kept up), so there are no files to publish. Pixel Streaming runs the game on a GPU server of your own and
  streams it as video; xgames.fun does not host that server, and a page that shows such a stream is untested.

### A game with its own Node server

Express, Socket.IO, deployed on Render, Fly or similar, whose page is a folder of static files (`public/`): adopt
publishes that folder, and the server stays where it runs. Declare it with `backend use custom`, point the page's
connections at its address (`io('https://…')` instead of `io()`), and copy any client file the server hands out
(`/socket.io/socket.io.js`) into the game. The server answers CORS for `https://<slug>-play.xgames.fun`.

## Your own site and your own domain: `xcore embed`, `xcore domain`

A published game plays at its xgames.fun link and inside a post on X. Your own website can show it too, and on Creator
and Scale it can live at an address of yours:

```sh
xcore embed add https://mygame.com     # mygame.com may frame the game; prints the <iframe> for its page
xcore domain add play.mygame.com       # Creator or Scale: prints the DNS records to add at your domain's DNS
xcore domain check play.mygame.com     # live once the records are right (xgames.fun also checks by itself)
xcore domain                           # where the game plays, the sites that embed it, its domains
```

- **Embedding** (every plan: 3 sites, 10, 25): a site is its origin (`https://mygame.com`; `http://localhost:<port>`
  while you build it). It applies within about a minute, with no publish. Framed on your site, the game signs players
  in by itself (a small xgames.fun window, or a code), as in a post on X: only xgames.fun's own page can hand it a
  sign-in, so a page that embeds it can't sign players in for it or take their sign-in. A framed game never asks
  xgames.fun who the visitor is and keeps no sign-in: a player taps Sign in there, and a reload of the page is signed
  out.
- **A domain of your own** (Creator 1, Scale 5): `domain add` prints two records, a CNAME pointing the domain at
  xgames.fun and a TXT proving you own it. Once they are right the game is served there with its certificate, and
  sign-in, saves, scores, rooms, the server and the economy work there as on its own link. Sign-in still opens a small
  xgames.fun window, on a phone too (your domain is another site than xgames.fun, so a returning player clicks Sign in
  once a visit there, and a reload keeps it for the hour), Studio stays on xgames.fun, and a post on X still uses the
  xgames.fun link. A bare domain (`mygame.com`) needs your DNS provider's CNAME flattening or ALIAS record; else use
  `www.` or `play.` and redirect. The page must load `gamesfun.js` 1.2.0 or later (it asks the play edge which game it
  is on a host of its own): an older copy can't sign players in there, so `domain add` says when to run
  `xcore add signin` and publish again. A game whose plan drops keeps its domain paused: it sends players to the
  xgames.fun link until there is room again.
- Custom domains need xgames.fun's operator to have set them up (Cloudflare for SaaS): until then `xcore domain` says
  so.

## What is not supported, and why

- **Server-side rendering** (a page made per request by Node): the host serves files only. Make the page static and
  put what needs a server in `server/` (a Worker) or a backend of your own.
- **A server in Python, Ruby, Go or another language**: xgames.fun runs only `server/` (a Worker, JavaScript or
  WebAssembly). Such a server runs on a host of your own, declared with `backend use custom`; or its logic moves into
  `server/`, or into the page itself (WebAssembly is allowed: Pyodide runs Python in the browser). Each is a change to
  how the game is built: the person who made it decides.
- **A Node server as the backend on xgames.fun**: `server/` is a Worker, not Node (no Node built-ins: `nodejs_compat`
  is not offered; no `fs`, `child_process`, raw sockets or listening sockets). A Node backend runs on a host of your
  own, declared with `backend use custom`.
- **Scripts, style sheets and fonts from a CDN**: the page loads code and styles from its own files only, so a copy goes
  in the game (or the package is bundled).
- **A fallback to `index.html` for every path**: deep links of a client-side router reload to "not found"; use a hash
  router or links that start at the entry page.
- **Keys that are public by design but look like secrets**, other than the two the scan knows (a Supabase anon or
  publishable key, and a Firebase web config's `apiKey`): the host's scan refuses them like any other key. Fetch such a
  configuration at run time from your backend.
- **More than 8 backend origins, IP addresses, localhost, wildcards**: the host opens the page's policy to named
  public origins only.
- **A threaded engine export, or a Brotli or Gzip build without a fallback**: a page is not cross-origin isolated, and
  the play host sends files with no `Content-Encoding` ([A game exported by an engine](#a-game-exported-by-an-engine)).
- **Unreal Engine**: Unreal 5 has no web export ([above](#a-game-exported-by-an-engine)).
