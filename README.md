# xcore

The one place to start with xgames.fun (`@xgamesfun/xcore` on npm, the `xcore` command). What you came for decides where
it takes you:

| You have                                    | xcore                                                                                                                            | Then                                                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **A web game you already made**             | brings it to xgames.fun: checks it as the host serves it, gives it a backend, publishes it at a link anyone can play (this page) |                                                                                                                           |
| **A game that should pay or sell on chain** | adds a Solana economy on loot: shops, loot boxes, raffles, prize pools, staking, rewards (§4)                                    | the economy tools are [`@xgamesfun/solana`](https://github.com/XGamesFun/solana-kit) (`xsolana`), which `xcore loot` runs |
| **An idea for a game, no game yet**         | hands its commands to the kit                                                                                                    | the game-making kit, `@xgamesfun/kit` (coming later)                                                                      |

Nothing about a game you bring changes: it keeps its code, its framework and its build, as long as it fits the hosting
(below): static files a browser runs on its own, plus, if it needs one, a backend that is public on the internet or a
server of its own that xgames.fun runs.

```bash
npx -y @xgamesfun/xcore adopt ./my-game     # its record, and the list of what to fix
```

Or install it once, `npm i -g @xgamesfun/xcore`, and then:

```bash
xcore adopt ./my-game                      # its record, and the list of what to fix
xcore check ./my-game                      # the page in Chrome, as the host serves it
xcore dev ./my-game                        # play it here as xgames.fun hosts it: its server, sign-in, rooms, economy
xcore add signin ./my-game                 # players sign in (X or a wallet); saves and leaderboards
xcore add database ./my-game               # a database of its own (D1), put up with the game
xcore db query "SELECT * FROM players"     # read it here, or --live on xgames.fun
xcore files put ./level.json levels/1.json --public --live   # a file its server and page read
xcore add multiplayer ./my-game            # rooms players share (Godot's own multiplayer runs over them)
xcore backend use custom ./my-game --url https://api.my-game.example   # only if it calls a backend you run
xcore loot add ./my-game                   # only if it gets an economy (a Solana economy on loot)
xcore add vouchers ./my-game               # its server pays results it checked from a grant, with its own key
xcore login && xcore publish ./my-game
xcore embed add https://mygame.com ./my-game     # your own site may show it (an <iframe>)
xcore domain add play.mygame.com ./my-game       # Creator or Scale: it plays at your own domain
```

(`xcore` on npm is another package: always run this one as `npx -y @xgamesfun/xcore …`, or install it.) It needs Node 24
or newer, and Chrome, Edge or Chromium for the check (else it downloads Playwright's Chromium once). With an agent,
the skill in `skills/bring-your-own-game/` walks the same steps, and `xcore loot connect` adds the economy's tools.

**Making a game from an idea** is the kit's (`@xgamesfun/kit`): base worlds, the build loop, the studio page, its six
gates. The kit brings this package, and `xcore` hands the kit every command it does not have itself (`create`,
`verify` …) when the kit is in or above the folder you run it in, or `GAMESFUN_KIT` names it. A game the kit made
publishes, checks and runs (`dev`) through the kit, so its six gates run first. The kit's dev server also serves a
brought game, with the studio around it; its MCP tools for a brought game are `gamesfun_adopt`,
`gamesfun_verify`, `gamesfun_backend_use` (provider `custom`), `gamesfun_loot_add`, `gamesfun_publish_check` and
`gamesfun_publish`.

## What the hosting takes

|                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The page**               | Static files, served as they are (GET and HEAD). `index.html` at the root of what is published is the game's entry. A folder URL ending in `/` serves that folder's `index.html`; any other missing path is a "not found" page, with no fallback to `index.html` (a client-side router works from the entry page; a deep link to `/level/3` reloads to "not found").                                                                                                                                                                                                                                                                   |
| **Where it is served**     | At its own origin's root once published (the link `xcore publish` prints). Under a folder in xgames.fun Studio's preview, in `xcore dev` and in the kit's dev server (`/game/`). A game uses relative URLs (`./assets/x.js`, not `/assets/x.js`), so it works in all of them.                                                                                                                                                                                                                                                                                                                                                          |
| **Its server, if any**     | `server/` and `gamesfun.json` → `server`: a Cloudflare Worker that answers the game's `/api/*`, with up to 8 Durable Objects and the platform binding `env.GF` (sign-in, saves, scores, loot reports). [docs/SERVER.md](docs/SERVER.md). Bundled into one file on publish; never a public file.                                                                                                                                                                                                                                                                                                                                        |
| **A backend of its own**   | Any public `https://` or `wss://` origin, listed in `backend.json` → `origins` (at most 8, public names only, no IP address, no localhost). The play host lets the page reach exactly those.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Solana**                 | Through the game's own devnet RPC (`xcore add rpc`: its server's `api/rpc`), else the play host's `/loot/v1/rpc` (xgames.fun's shared devnet relay, counted toward the game's plan), with the page client in the game (`gf/loot/`, from `@xgamesfun/solana`).                                                                                                                                                                                                                                                                                                                                                                          |
| **What the page may load** | Scripts, style sheets, fonts and frames from its own files only (inline scripts, `eval`, WebAssembly and Web Workers from the game's own files are allowed; a page is not cross-origin isolated, so `SharedArrayBuffer` is not available: export engines single-threaded). Connections to its own origin and to `backend.json`'s origins; pictures and sounds from its own files and from those `https://` origins. No `<base>`, no form posts, no `<object>`. Camera, microphone, location, payments and USB are off; fullscreen, pointer lock, gamepads, audio and WebGL are not limited by the page's headers.                      |
| **Paths the host owns**    | `/api/*` (the game's server, when it has one), `/platform/v1/*`, the multiplayer signaling (`/signal/v1`), the live watch (`/watch/v1`), world saves (`/world/v1/`), player keys (`/player/v1/`) and `/loot/v1/*`. A file of the game under one of them is never served.                                                                                                                                                                                                                                                                                                                                                               |
| **Files**                  | Everything in the published folder goes up except hidden files and folders, and, at its top level, `evidence/`, `node_modules/`, `server/`, `supabase/`, `gamesfun.json` and the makers' notes (`README.md`, `NOTES.md`, `LAUNCH.md`, `FRICTION.md`, `CLAUDE.md`, `AGENTS.md`, `TODO.md`) (`.gitignore` is not read): move development material out of it, or give it a name that starts with a dot. Hidden files and folders never go up. A file whose extension the host does not know is served as `application/octet-stream` with `nosniff` (fine for data read with `fetch()`; a browser will not run it as a script or a style). |
| **Limits**                 | One game: 3,000 files, 100 MiB (104,857,600 bytes; one file may be all of it). One account: 30 publishes and 1 GB of new files a day, 100 games. Publish reads the account's own limits from xgames.fun. The server bundle: 5 MB. What the game's server, saves and scores may use is its plan (§5, `xcore plan`).                                                                                                                                                                                                                                                                                                                     |
| **Refused, always**        | `.env` files, symbolic links, key and certificate files, wallet keypairs, and anything in a text file that looks like a secret (xgames.fun runs the same scan again). A browser game carries only keys made to be public: a Supabase anon or publishable key, a Firebase web config's `apiKey`.                                                                                                                                                                                                                                                                                                                                        |

## 1. Adopt

`xcore adopt [folder]` (default: the folder you are in) reads the folder's shape:

- **Plain static files** (an `index.html` at its root, or in `dist/`, `build/`, `public/`, `www/` …): published as
  they are.
- **A project with a build**: the build runs (install its packages first, `npm ci` or `npm install`: adopt does not), and its output is
  published. Known: Vite (`dist`, its `outDir`; `public/`), Next.js with `output: 'export'` (`out`), Astro (`dist`),
  SvelteKit with `@sveltejs/adapter-static` (`build`), Nuxt with `nuxt generate` (`.output/public`), Create React App
  (`build`), Parcel (`dist`), Gatsby (`public`), React Router in SPA mode (`build/client`). Any other `build` script:
  its output is found after it runs (`dist`, `build`, `out` …), or given: `--build "<cmd>" --out <dir>`.
- **Refused** (nothing is written): a frontend rendered by a server (Next.js without a static export, SvelteKit
  without the static adapter, `nuxt build`, Astro with `output: 'server'`, Remix, an Express app with no static
  page), a folder with no `index.html` and no build, a build that fails. Each comes with what to do.

It writes the kit's record into the game's `gamesfun.json` (never published):

```json
{ "page": { "build": "npm run build", "out": "dist", "static": "public", "title": "My Game" } }
```

| Key      |                                                                                                                                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build`  | the command that makes the published files, run in the game's folder; none for plain files                                                                                                                                   |
| `out`    | the folder that is published: `"."` for plain files, else the build's output                                                                                                                                                 |
| `static` | the folder the build copies as it is (Vite, Next.js, Astro, CRA: `public`), where xcore puts the files it adds (`backend.json`, `xsolana.json`, `gf/loot/`), so every build carries them; for plain files, the folder itself |
| `title`  | optional: the game's name on xgames.fun (else `index.html`'s `<title>`, else `package.json`'s name)                                                                                                                          |

`--static <dir>` names that folder when the kit cannot tell; `--no-build` reads what is built already. A `server`
part of `gamesfun.json` (the game's own server) stays as it is.

Then a plain list, each line with its fix:

- **Fix before publishing**: what publish refuses (secrets, `.env` files, links, a `backend.json` the host cannot
  open, files under the host's own paths, no `index.html`) and what breaks once hosted (files over the limits, paths
  from the root, a Vite `base` other than `'./'`, scripts, style sheets, web fonts or frames from other sites, a
  `<base>`, an address on this machine).
- **Worth a look**: other sites the code names that `backend.json` does not list (a library's own documentation links
  need nothing: the page check shows which ones the page really calls), a service worker (allowed; it keeps old files
  after a new version until it updates itself), the camera or location, files served without a type, hidden files
  that do not go up, a tab icon named from the root.

Fix the list in the game's own files (the source or the build's config, never the build's output) and adopt again
until it is empty. Adopt reads the files; `xcore check` then runs the page and finds what only shows at run time (a
path from the root built in a script, a request to a site `backend.json` does not list).

**A game of several pages** (a Next.js export with routes, Astro pages): such builds link their pages from the root
(`/level/2/`), and Next.js has no relative mode for them. Every page works at the published link, which is the game's
own origin, but not under a folder, so `xcore check` (which serves the game under one, as Studio's preview and the
kit's dev server do) fails them and publish saves a private draft. Until xgames.fun previews games at an origin of their
own, make the game one page that changes screens itself (or uses a hash router), or keep it a single-page export.

**A Nuxt game**: `nuxt generate` with its defaults links every file from the root and routes by path. Make it one
page that is served from any folder: in `nuxt.config`, `ssr: false`, `app: { cdnURL: './' }` and
`router: { options: { hashMode: true } }`; in the game's own code, relative paths (`fetch('levels.json')`, and in a
template `:src="'moth.png'"` for a file in `public/`, since Vue reads `src="./moth.png"` as an import).

**React Router's framework mode** (`react-router.config` with `ssr: false`) builds one page for `/` and routes by
path, with no hash mode and no relative mode (`base: './'` makes it load its routes from `assets/assets/` and reload
for ever). It works at the published link but not under a folder, so `xcore check` fails it as a game of several
pages. For a game that runs everywhere, use React Router as a library in a Vite app, with `createHashRouter`.

**A monorepo** (npm, Yarn or Bun workspaces, `pnpm-workspace.yaml`): adopt the repo's root when its build script builds
the game; the output is found in the workspace it built (`packages/game/dist`). Or adopt the game's own package: its
packages installed at the root count as installed.

**A game exported by an engine** (Godot, Unity, Defold, GameMaker): adopt the project, not the export folder the
engine rewrites, and name the export: `xcore adopt . --out build/web` (or `--build "<export command>" --out …`). A
Godot project never exported for the Web gets its Web preset from `xcore adopt .` (single-threaded, into `build/web/`),
with the one command that exports it; export, then adopt again. Export again before each publish: with no build
command, `check` and `publish` take the export as it is on disk (`check` says when the project changed after it).
`gamesfun.json` and `evidence/` then stay out of the export. A whole export must fit in 100 MB: a stock Godot 4
`index.wasm` is about 36 MB, so the game's own `index.pck` has the rest (compressed textures and Ogg audio keep it small).

- **Godot 4.3 or later**: export for the Web with **Thread Support off**, and `xcore add signin` for sign-in, saves
  and leaderboards from GDScript (§3). A xgames.fun page is not cross-origin
  isolated, so a threaded export stops at "missing features" (Godot 4.0 to 4.2 always use threads: upgrade). Godot's
  ENet does not run in a browser: `xcore add multiplayer` and `GamesFun.join_room` put the game's high-level multiplayer
  on xgames.fun's rooms unchanged (§3), or a `WebSocketMultiplayerPeer` reaches a server of your own (`backend use custom`).
- **Unity** (`xcore add signin` for sign-in, saves and leaderboards from C#, §3): Player Settings → Publishing
  Settings, **Compression Format Disabled** (or keep it and turn on
  **Decompression Fallback**): the play host sends files as they are, with no `Content-Encoding`, so a Brotli or Gzip
  build without the fallback stops at "Unable to parse". Keep Multithreading off for the same reason as Godot's threads.
  A service that connects to many host names (Photon's regional servers, for example) needs each one listed in
  `backend.json` (at most 8, no wildcards).
- **Unreal Engine**: Unreal 5 has no web export (Unreal 4.24 moved HTML5 out of the engine, to a community project
  that is no longer kept up), so there are no files to publish. Pixel Streaming runs the game on a GPU server of your
  own and streams it as video; xgames.fun does not host that server, and a page that shows such a stream is untested.

**A game with its own Node server** (Express, Socket.IO, deployed on Render, Fly or similar), whose page is a folder of
static files (`public/`): adopt publishes that folder, and the server stays where it runs. Declare it with
`backend use custom`, point the page's connections at its address (`io('https://…')` instead of `io()`), and copy any
client file the server hands out (`/socket.io/socket.io.js`) into the game. The server answers CORS for
`https://<slug>-play.xgames.fun`.

**What xcore writes in the game's folder**: `gamesfun.json` (adopt's record; commit it), `evidence/` (each check's
screenshots and record, `evidence/verify-N/`) and `.gamesfun/` (publish's last passing check, the link once
published, the local database and files, and `xcore db export`'s dumps of your players' data). None of them is
published. `.gamesfun/` keeps itself out of git: xcore writes `.gamesfun/.gitignore` (`*`) when it first writes
there; add `evidence/` to the game's `.gitignore`.

## 2. Check

`xcore check <folder>` is the page check (a brought game is never judged by the kit's six gates, which are
about games made on the kit; the kit's `verify` runs this same check for one):

1. **it builds** (skipped for plain files, or with `--no-build`)
2. **it fits the hosting**: everything publish would refuse, and what breaks once hosted, on exactly what would go up
3. **the page starts**: served under a folder with the play host's page policy, in Chrome at a phone's size and a
   desktop's: no error thrown, nothing in the console's errors, none of its own files missing, nothing asked for from
   the root, something on screen (screenshots in `evidence/verify-N/`)
4. **it stays inside its origins**: every request is one the hosted page may make; a script, style, font or frame from
   another site, or a connection to an origin `backend.json` does not list, fails it

A backend that does not answer this machine is a note, not a failure. The game's play is its own: the page check says
it starts clean and stays inside what the hosting allows, nothing more. Publish's gate runs the same check, and a game
whose check fails goes up as a private draft only.

### Play it here: `xcore dev`

`xcore dev <folder>` serves the game on this machine the way xgames.fun will host it, with everything a published game
has behind it, so the whole game runs before it is published:

| On this machine               |                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `http://127.0.0.1:8787/game/` | the published files (it runs `page.build` first, unless `--no-build`), with the play host's headers                                                                                                                                                                                                                                                                                                                |
| `/game/api/*`                 | the game's `server/` under workerd, the runtime xgames.fun runs it on: Durable Objects with their storage kept, WebSockets, `env.GF`, the game's database (a local D1 in `.gamesfun/dev/d1/`, its migrations applied), and its secrets from `.dev.vars`. A change under `server/` or to `.dev.vars` reloads it. Miniflare (with workerd, about 140 MB) is installed once, the first time a game with a server runs |
| `/platform/v1/*`              | sign-in, saves and leaderboards: `gamesfun.js` signs in a local player (each tab its own, so two tabs play a room together), and `env.GF.verifyPlayer` accepts its token. Saves and scores are kept in `.gamesfun/dev-platform.json`, never published                                                                                                                                                              |
| `/platform/v1/live`           | the game's live settings (`gf.live`, below): its announcement, config and maintenance, from `.gamesfun/live.json` (read again on each request, never published). With maintenance on there, the game's pages show the holding page and its `api/` and `/platform/v1/*` answer `503` with code `maintenance`, as hosted                                                                                             |
| `http://127.0.0.1:8788/`      | the game's public project files (`env.GF.files`, `xcore files`), kept in `.gamesfun/dev/files/`: another origin, as `<slug>.xgamesusercontent.com` is to the published game                                                                                                                                                                                                                                        |
| `/loot/v1/rpc`                | the economy's Solana devnet RPC: xgames.fun's shared relay (what a published page talks to unless the game brings its own: `xcore add rpc`), or your own with `XSOLANA_RPC_URL` in `.env` (its URL is never shown; a call the shared relay would refuse is said in the terminal). The economy's calls answer once it is live on devnet (`xcore loot approve`)                                                      |

Games made with any engine get all of it through `gamesfun.js` (`xcore add signin`): on a plain local server it stands
in with this browser's storage; under `xcore dev` it uses the real thing. What is not the same as hosted: no CPU or
request limits, and the server's outbound `fetch` is not limited to `backend.json`'s origins.

## 3. Players, a database, a backend

### Sign-in, saves and leaderboards: `xcore add signin`

xgames.fun signs players in (with X first, or a Solana wallet) for every game, and keeps each player's saves and the
game's leaderboards. `xcore add signin <folder>` gives the game the page client that reaches them, in the shape its
engine takes:

| The game          | What it gets                                                                                        | From its code                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| A web game        | `gamesfun.js` beside the page (in the folder a build copies as it is), loaded first in `index.html` | `await GamesFun.signIn()`, `GamesFun.saves.put('main', {...})`     |
| A Godot 4 project | `addons/gamesfun/gamesfun.gd`, autoloaded as `GamesFun`                                             | `await GamesFun.sign_in()`, `await GamesFun.saves_put("main", {})` |
| A Unity project   | `Assets/Plugins/GamesFun/` (`GamesFun.jslib`, `GamesFun.cs`)                                        | `await GamesFun.SignIn()`, `await GamesFun.SavesPut("main", json)` |

The same calls everywhere: sign in and out, the player (`id`, `name`, `level`, `wallet`, `x`), saves (any JSON, 64 KB
each, 16 a player), leaderboards (submit, top, the player's own), the game's database (below) and its own server
(`api`). Every call answers `{data, error, status}` and none throws, so a game plays on as a guest wherever xgames.fun is
not there.

**A leaderboard is the player's own word until the server takes it.** A signed-in player submits their own scores
from the page, so anyone can submit any score for themselves from the browser's console. A game with its own server
makes a board nobody can write that way: `env.GF.scores.setup('ranked', {writer: 'server'})` (or a pattern for boards
to come, `'daily-*'`), then the page's submits
to it are refused (their answer's `code` is `'server-only'`, HTTP 403) and the server submits each run it checked; the page reads the board as before
([docs/SERVER.md](docs/SERVER.md)).

Where the sign-in comes from:

- **In xgames.fun's play page**, the page signs the player in and hands the game a token.
- **On the game's own link, and inside a post on X**, a small window on xgames.fun signs in; when the browser keeps it
  shut (a phone, X's app), the game is given a code to show ("go to xgames.fun/go and enter ABCD-EFGH") that the player
  types on any device. The code comes with `window`: show it plainly only when `window` is false. When a window did
  open, the player is signing in there (X's login takes a while, and its page hides from the game whether that window
  is still open), so show the code at most as a quiet line for someone who lost the window, never over the game.
- **On this machine** (localhost, `xcore check`), a local player and the browser's own storage stand in, so the game
  can be made and tested before it is published. Under `xcore dev`, a local sign-in (one player a tab) and the
  platform answer as xgames.fun does, and the game's `server/` accepts its token.

The token lasts an hour and stays in the page's memory. The game's `server/` checks it with `env.GF.verifyPlayer`; a
backend of your own checks it with any JWT library against `https://<slug>-play.xgames.fun/player/v1/key` (issuer
`xgames.fun`, audience `game:<slug>`).

The page calls the game's own server with `GamesFun.api(path, init)` (Godot `GamesFun.api(path, init)`, Unity
`GamesFun.Api(path, initJson)`): `path` is relative to the game's `api/` (`'finish'` is `api/finish`, at the
published origin and under a folder alike), `init` is `fetch`'s (an object `body` goes as JSON), and a signed-in
player's token goes with it as `Authorization: Bearer …`, which the server checks with `env.GF.verifyPlayer` before
it trusts who is asking. It answers `{data, error, status}` like every other call.

### Live: an announcement, a remote config and maintenance, with no republish (`gf.live`)

On xgames.fun/console, a game's **Live** tab sets three things its players get within about 35 seconds, with no
republish (xgames.fun's play edge answers them itself from one cached record a game):

- **an announcement**: a short line of plain text (280 characters), `info` or `warning`, with an optional start and end;
- **a remote config**: a small JSON object (8 KB) the game reads at run time: a difficulty, an event on or off. The
  console keeps its last 10 versions and reverts with a click;
- **maintenance**: the game paused with a message. Players who open it get a plain holding page from xgames.fun instead
  of the game, its server's `api/*` (WebSockets too) and the page's saves and leaderboards answer `503` with code
  `maintenance` (the server's code does not run), and turning it off brings the game back within about 35 seconds (up
  to a minute). What is already running (an open WebSocket, an alarm) is not stopped.

`gamesfun.js` (1.5.0) reads them:

```js
const { data: live } = await GamesFun.live.get(); // {announcement, config, version, maintenance}
const hard = live.config.difficulty === 'hard';
GamesFun.live.onChange(live => applyEvent(live.config.event)); // asked again every minute while the page is in view
await GamesFun.live.refresh(); // ask now
```

`get()` answers what it knows if that is under a minute old, else asks; like every call it answers
`{data, error, status}` and never throws (unreachable: the last value, else nothing live). `announcement` is null
outside its start and end, `config` is `{}` when none is set, `maintenance` is null or `{message, since}`.

**The banner.** By default `gamesfun.js` shows the announcement in a small closable line at the top of the page (each
announcement until the player closes it), and a pause that starts while the game is open (any call answering
`maintenance` shows it at once). A game that shows them its own way turns it off with `data-live-banner="off"` on its
`<script src="gamesfun.js">`, `globalThis.GAMESFUN_LIVE_BANNER = false` before it loads, or
`GamesFun.live.banner(false)` before the page has loaded. Without the banner and without `onChange`, nothing is asked
until the game calls `get()`.

**On this machine** nothing is live on a plain local server; under `xcore dev`, `.gamesfun/live.json` stands in for the
console (read again on every request):

```json
{
  "announcement": {
    "text": "Double XP all weekend!",
    "level": "info",
    "startsAt": null,
    "endsAt": "2026-11-12T00:00:00Z"
  },
  "config": { "difficulty": "hard", "event": true },
  "maintenance": null
}
```

`"maintenance": {"message": "Back at 7pm"}` (or `true`) pauses the game as hosted. Times are ms or ISO text; what the
console would refuse (a config over 8 KB or not an object, an announcement over 280 characters) is said in the
terminal. Godot and Unity reach `gf.live` only through their JavaScript bridge for now.

### A database of its own: `xcore add database`

`xcore add database <folder>` adds sign-in, and a database the game owns: **one D1 database** (SQLite) a game, made on
xgames.fun by the first publish and kept between publishes ([docs/SERVER.md](docs/SERVER.md), "A database of its
own"). Nothing to sign up for and no keys. `gamesfun.json` → `database` declares it; its tables come from the
migrations in `server/migrations/` (`0001_init.sql`, then `0002_….sql`: append only, applied by publish before the new
version goes live).

- **A game with a server of its own** gets an example first migration and `server/gf-db.js`: prepared queries
  (`db(env).first('SELECT gold FROM players WHERE id = ?', sub)`), and `withPlayer(request, env)`, the signed-in
  player's id. A rule that must hold under a burst of requests is one statement
  (`UPDATE players SET runs = runs - 1 WHERE id = ? AND runs > 0 RETURNING runs`).
- **A game with no server** gets xcore's stock server, which keeps the page's documents (any JSON up to 64 KB) in
  collections, under the rules in `database.collections`. When it gets a server of its own (`xcore add
multiplayer`, `rpc`, `vouchers`), `server/gf-docs.js` goes on serving the same documents there, under the same
  rules; publish refuses a server that has `collections` and does not route `api/db/`:

```js
const level = (await GamesFun.db.add('levels', { name: 'Moon', tiles })).data; // {id, owner, value, updatedAt}
await GamesFun.db.put('levels', level.id, { name: 'Moon 2', tiles });
const page = await GamesFun.db.list('levels'); // page.data: the newest 50; page.after: the next page's place
const next = await GamesFun.db.list('levels', { after: page.after }); // page.after is null on the last page
```

**Each player has a space of their own** in every collection: a document is found by its collection, its owner and
its id, so two players can both have a `main`, and nobody can take an id in another player's space. By default a
signed-in player reads and writes only their own documents. `{"read": "anyone"}` in `database.collections` lets
everyone read a collection (another player's document by its owner,
`GamesFun.db.get('levels', id, { owner: playerId })`, and their list with `{ owner: playerId }`); `{"write": "server"}`
is for what players must not set themselves (the page reads it without naming an owner: the server's document, or
the player's own that the server wrote for them). Lists page with `after`; `offset` is gone, and refused in words.
The order is by when a document was last written, so one written between two pages can show twice or be skipped.

A game made with xcore 0.1.0: see [Upgrading from 0.1.0](#upgrading-from-010). On a plain local server the
page keeps documents in the browser; under `xcore dev` the database is a local D1 in `.gamesfun/dev/d1/` with the
same migrations. Its calls count toward the game server's requests (600 a minute from one player, 6,000 a minute
shared by all its players): read and write when something happens, not every frame.

`xcore db info|query|export|import` reads and writes the local database, and with `--live` the one on xgames.fun
(each call kept in the game's audit log); a query only reads unless `--write`. `xcore db restore <time> --live` puts
it back as it was up to 30 days ago, after showing what it would do; for a game with an economy it warns that loot
balances and payouts on chain are not rolled back. A game made with xcore 0.1.0 keeps its `server/database.js` (a
Durable Object, the older way), which goes on working.

### Project files: `xcore files`

A game with a server keeps files of its own on xgames.fun: replays, generated levels, a large saved world, content
packs (Free 100 MB, Creator 10 GB, Scale 100 GB; 25 MB a file). Its server writes and reads them with
`env.GF.files` ([docs/SERVER.md](docs/SERVER.md), "Project files"), and you put them from your machine:

```bash
xcore files put ./levels/forest-3.json levels/forest-3.json --public --live   # served at https://<slug>.xgamesusercontent.com/levels/forest-3.json
xcore files ls levels/ --live
xcore files get replays/run-1.json --live --out run-1.json
xcore files rm levels/old.json --live
xcore files usage --live
```

A public file is served from a site of its own, which the browser treats as a stranger to the game: it cannot use the
player's sign-in or call the game's `api/`, and anything that could carry a script (HTML, SVG, JavaScript) is a
download, never a page. The game's page may load its pictures, sounds and fonts and `fetch` its data. Players never
write here. Without `--live`, `xcore files` works on the files `xcore dev` gives the server, kept in
`.gamesfun/dev/files/` and served on a port of their own.

### Multiplayer: `xcore add multiplayer`

`xcore add multiplayer <folder>` adds sign-in, and rooms the game owns: server code (`server/rooms.js`, one Durable
Object a room) that publish puts on xgames.fun with the game, at its own `api/rooms/<CODE>`. A room is a relay with a
host: the first player in is the host (id 1, as Godot's server), every other player gets an id of their own, and a
message goes to one player, to everyone else, or to everyone but one. The room never reads a message: the host's game
decides what happens. When the host leaves, the player who joined next becomes the host (a Godot game instead sees
its server leave, `server_disconnected`, as over ENet).

| The game          | How it joins                                                                                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A Godot 4 project | `multiplayer.multiplayer_peer = await GamesFun.join_room(code)`, in place of an `ENetMultiplayerPeer`: RPCs, `MultiplayerSpawner` and `MultiplayerSynchronizer` work unchanged (all reliable and ordered). In the editor the same call makes a local ENet game, for Run Multiple Instances |
| A Unity project   | `var room = await GamesFun.JoinRoom(code)`: `room.Send(json, to)`, `room.SendBytes(bytes, to)`, `OnMessage`, `OnBytes`, `OnJoin`, `OnLeave`, `OnHost`                                                                                                                                      |
| A web game        | `const { data: room } = await GamesFun.rooms.join(code)`: `room.send(data, to)`, `room.sendBytes(bytes, to)`, `room.on('message', …)`                                                                                                                                                      |

A room's code is 4 to 8 letters and digits (`rooms.code()` makes one). By default the first to a code opens the room
and anyone after joins it; a Host button passes `host: true` (refused when someone is in the room) and a Join button
`host: false` (refused when no one is, as joining an address no one serves fails over ENet). `rooms.link(code)` is the link to share:
`https://xgames.fun/play/<slug>?room=<CODE>`, which opens the game in that room, on xgames.fun and inside a post on X
(its card frames the room), and `rooms.fromLink()` reads it back. `ROOM` at the top of `server/rooms.js` sets the most
players (16), whether only signed-in players may join (their xgames.fun id and X handle come with them), and the
message limits (120 messages a second a player; past it messages are dropped and the game told, through the room's
`error` event, Godot's `room_error` signal and Unity's `OnError`). The page client sends each frame's messages as one,
so a game at any frame rate sends at most about 60 a second, however many objects it syncs. A player's connection
counts once toward the game server's requests (600 a minute from one player, 6,000 a game), however many messages it carries.

Porting a Godot game from ENet: `create_server` / `create_client` become `join_room` (with `host: true` / `false` for
Host and Join buttons), a variable typed `ENetMultiplayerPeer` becomes `MultiplayerPeer`, `create_server`'s
`max_clients` is `ROOM.maxPlayers` (for every room of the game), and a packet sent unreliable arrives reliable. The
peer leaves its room on `peer.close()` or when nothing holds it any more. The host's game relays every client's
packets to the others, as Godot's server does over ENet. On this machine, tabs of the same browser share a room, so two tabs play together before the game
is published; under `xcore dev` they play through the room server itself, as on xgames.fun. A netcode library with a server of its own (Netcode for GameObjects, Mirror, a Node server) does not
run on xgames.fun as it is: its game logic moves to the host's game, or its server runs on a host of your own (below).

**When the host must not decide.** In a room the host's game is the referee, and the host's player can read anything
their page holds. That is fine for most games played with friends, but not for a hidden role or word (the host would
see the Impostor), or a result that pays tokens or prizes (the host could claim any winner). Such a game keeps the
match in a Durable Object of its own, as a Node or Socket.IO server would: the room's state, the hidden parts and the
result live there, players send it their moves over a WebSocket, and it sends each player only what that player may
see ([docs/SERVER.md](docs/SERVER.md), "A room over a WebSocket"). It sits beside `server/rooms.js` (or in place of
it), and the server that decided the result is the one that pays it (`env.GF.loot.report` for prizes by place, or a
voucher it signs with its own key: `xcore add vouchers`).

A database you already have (Postgres, MySQL, a hosted one) stays where it is, behind a backend of your own (below):
the page never holds its address or password.

### A backend

Three ways, any of them, or none:

- **One you already run**: `xcore backend use custom <folder> --url https://api.my-game.example [--origin wss://live.my-game.example]`
  writes `backend.json` with the URL's origin and its `wss://` twin, plus any `--origin` you add (another host, a CDN for its pictures). No client is
  copied: the game's own code calls it. The backend answers CORS for the game's origin (the published link's, and
  `http://127.0.0.1:<port>` in the kit's dev server). No key, unless one made to be public.
- **Supabase or Railway**: needs the game-making kit (`@xgamesfun/kit`) installed. `xcore backend connect supabase|railway`
  hands the command to the kit, which connects one for you. Without the kit, set one up yourself and declare it with
  `backend use custom`.
- **A server xgames.fun runs**: `server/index.js` and `gamesfun.json` → `server` (the `gf-server-v1` contract, [docs/SERVER.md](docs/SERVER.md)): a Worker on the
  game's `/api/*`, with Durable Objects for rooms and state, `env.GF` for sign-in, saves and scores, and your own
  secrets as `env.<NAME>` (`xcore secret set <NAME>`: kept on the server's host only, never shown again, never given
  to the page). `xcore dev` runs it under workerd at `/game/api/*`, with secrets from `.dev.vars`; publish bundles it.
  This is the way to keep server logic without a host of your own.

A brought game with a build keeps `backend.json` in its `static` folder, so the build publishes it.

## 4. An economy (web3)

> **Read [Disclaimer and responsible use](#disclaimer-and-responsible-use) before you build an economy.** Loot boxes,
> raffles, lotteries, prize pools and tokens are regulated in many places, and on-chain transactions cannot be undone.

A game's economy runs on loot, one shared Solana program (devnet only until it is audited): shops, loot boxes, raffles
and lotteries, prize pools, staking, crafting, perks for holders, rewards a player claims. Its tools come with this
package (`@xgamesfun/solana`). `xcore loot connect` adds them to Claude Code or Codex: the `xsolana_*` MCP tools
and the `xsolana-economy` skill, which turn a one-line idea into a checked economy. `xsolana_check` refuses what would
fail or lose money on chain (a prize a pool cannot pay, a pool nothing fills, a farm that empties a lottery, a claim with
no limit), `xsolana_simulate` shows where the money goes day by day, and `xsolana_cost` what going live costs.

`xcore loot add <folder>` says where the economy goes (`xsolana.json` in the `static` folder) and, once it is
there, copies the page client beside it (`gf/loot/`, a copy: never edit it; publish keeps it current). The page loads
it at run time with a page-relative URL, so a bundler leaves it alone:

```js
const { solanaApp, walletStandardSigner } = await import(
  /* @vite-ignore */ new URL('gf/loot/play/index.js', document.baseURI).href
);
const { solanaWallets, connectWallet, PAGE_RPC } = await import(
  /* @vite-ignore */ new URL('gf/loot/wallets.js', document.baseURI).href
);
const spec = await (await fetch('xsolana.json')).json();
```

`solanaApp` takes `rpcUrl: PAGE_RPC`, the page's own `/loot/v1/rpc`. `gf/loot/wallets.js` gives the page the
player's wallet through the Wallet Standard, with no package:

| Export                            |                                                                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `solanaWallets({ waitMs = 300 })` | → the wallets in this browser that can sign Solana devnet transactions (an empty list when there are none: say so, and keep the game playable) |
| `connectWallet(wallet)`           | → the player's account; the wallet shows its own prompt, and it throws if they say no                                                          |
| `PAGE_RPC`                        | the page's own `/loot/v1/rpc` (xgames.fun's relay once published)                                                                              |

`walletStandardSigner(wallet, account)` from `gf/loot/play/index.js` turns them into the signer `solanaApp` takes.

**From Godot, Unity or any page with `gamesfun.js`** (`xcore add signin`), `GamesFun.loot` does all of that with JSON in
and out (big numbers as text), so an engine calls it like the rest of xgames.fun:

```js
await GamesFun.loot.ready(); // {live, project, wallets: [names], spec}
await GamesFun.loot.connect(); // {address, wallet}: the wallet asks the player
await GamesFun.loot.link(); // {wallet}: it signs that it is this player's (a game server that pays needs it)
const shop = await GamesFun.loot.call('shop'); // any method of loot's page client, with its arguments
await GamesFun.loot.call('buy', 'sword', { listing: shop.data[0] }); // a listing goes back as it came
```

Godot: `await GamesFun.loot_ready()`, `loot_connect()`, `loot_link()`, `loot_call("shop")`, `loot_call("buy", ["sword", {"listing": item}])`.
Unity: `GamesFun.LootReady()`, `LootConnect()`, `LootLink()`, `LootCall("shop")`, `LootCall("buy", "\"sword\", {\"listing\": …}")`.
In a Godot or Unity project, `xcore loot add` keeps `xsolana.json` and `gf/loot/` out of the engine's export, in the
project's own `gamesfun/` folder (with a `.gdignore`, so Godot leaves it alone): `gamesfun.json` → `page.static`.
Publish, `xcore check` and `xcore dev` lay that folder over the export, so you export as before, and the file that
holds the addresses the economy went live at stays in the project (keep it in git).

`@xgamesfun/solana`'s own examples use a public devnet RPC and `node_modules/` paths; on xgames.fun use `PAGE_RPC` and
`gf/loot/` as above. Where its help says `xsolana <command>`, run `xcore loot <command>`. `xcore loot check|simulate|cost|explain`
runs the tools from a terminal. Going live is the person's own step, approved in their own wallet: `xcore loot
approve` in the folder with `xsolana.json`.

**When loot is upgraded.** This package pins the tools for one build of loot (0.25.0). loot is upgraded in place on
devnet, and no version so far has carried accounts over: an economy that went live on an earlier build goes live
again (`xcore loot approve`), and the next publish brings `gf/loot/` up to the installed package. **Nothing runs by
itself** on chain: the page client sends what a player needs (settles, refunds, claims, a draw that is due); a
schedule's runs are the project's own steps, and a run nobody sends is missed.

**What a page alone can pay safely.** A game that runs only in the browser can't prove what a player did there: anyone
can change its score in the console. So from the page alone, offer what the player pays for or the chain decides (a
shop, boxes, raffles, lotteries, staking, crafting, perks for holders). A reward for a result (a score, a win, a level)
is a grant claimed with a voucher, and the voucher key must never be in the page (publish refuses a key it finds): the
game's server checks the result, and then one of two signers vouches for it.

**Paying a result: the keeper or your own key.** When the server already decides who won and the prize is fixed by
place (a room's winner, a match's top three), it reports the winners with `env.GF.loot.report` and xgames.fun's keeper
signs, with no key for you to keep. When the amount depends on the result (paid by score), when the server replays or
bounds runs before paying, when there are entry fees or a prize pool, or when results come faster than 120 an hour,
give the server its own key: `xcore add vouchers` writes `server/vouchers.js` (its `PAY.check` is what your server
checks) and a test key in `.dev.vars` for `xcore dev`. In order: `xcore publish`, `xcore secret set VOUCHER_SEED
--new-key` (the live key: made here, sent only to xgames.fun and never kept on your machine; it prints the address), that address into the
grant in `xsolana.json`, `xcore loot approve`, `xcore publish`. A voucher pays only a wallet the player proved is
theirs (signed in with it, or linked with `gf.loot.link()`), and since a wallet is free, pay rewards worth farming
only to players signed in with X (`VOUCHERS.payOnly`). A grant names up to three keys, so the keeper and your own can
pay the same grant while you move from one to the other.
[docs/SERVER.md](docs/SERVER.md), "Paying a result", has both, side by side.

## 5. Publish

`xcore login` signs this computer in (your browser signs in to xgames.fun and hands it a publish token for 30
days; xcore never sees your password). `xcore publish <folder>` then builds the game, checks it (the page
check on exactly the files built), and uploads its published folder with its `server/` bundle:

1. **The files**: the published folder, without hidden files, `evidence/`, `node_modules/`, `server/`, `supabase/` and the makers' notes at its top (`README.md`, `NOTES.md`, `LAUNCH.md` and the like). A `.env` file or a link
   stops it. Two small records go up beside them, as xgames.fun keeps them with every version:
   `foundation.lock.json` (which tool published it) and `adaptation-plan.json` (the game's title and a one-line
   description). Like every published file, they can be read at the game's link.
2. **No secrets**: every text file is scanned for anything that looks like a key (private keys, cloud, payment and AI
   keys, a Supabase service-role key, a database address with a password). xgames.fun scans again on its side.
3. **Its backend**: `backend.json`'s origins are the only other sites the published page may reach.
4. **Its server code** (`server/`, a Worker under the `gf-server-v1` contract): bundled into one file and checked (it
   builds, no code made from text, no Node built-in a Worker lacks, no secrets, its Durable Objects exported, at most
   5 MB). `server/` and `gamesfun.json` are never public files.
5. **The check**: a game whose check fails is saved as a private draft (a version in your xgames.fun Studio, with no
   public link), and you are told which checks failed. A pass is remembered for exactly these files.
6. **Upload**: only the files xgames.fun does not have yet.
7. **The link**: unlisted, and the same through every update. Publishing the folder again makes the next version. The
   play host caches files for up to 30 seconds, so an update can take that long to show at the link, and for that
   time a visitor can get some files of the new version and some of the old. Files the new version no longer has
   are gone at once: a page someone already has open that loads a file later (a lazily loaded chunk with a hashed
   name) can fail to find it, so have the game reload when that happens. A game installed as an app (a web
   manifest and a service worker) installs from its own link, `https://<slug>-play.xgames.fun/`.

`publish --check` runs steps 1 to 4 above without publishing (`--check --verify` adds the check and remembers a pass), `--status`
shows the link and the account, `--draft` saves a private version, `--new` makes a new game with a new link.

**For scripts and agents**: every command takes `--json`. A failure is then also printed on stdout as
`{ "ok": false, "error", "code", "state", "next" }`: `code` is why (`usage`, `login`, `files`, `secrets`, `build`,
`size`…), `next` the command that moves it on. `login --status --json` and `publish --status --json` name the sign-in's
`state` (`signed-in`, `signed-out`, `expired`, or `unreadable` when the token is kept where this session cannot read
it, such as the Secret Service over SSH); `publish --status --json` also names the game's `link` (`never`, `started`,
`public`, `draft`, or `draft-over-public`); `adopt --json` gives `state` (`refused`, `fix`, `ready`) and `next`.

**Where the token is kept**: the macOS keychain; on Linux the Secret Service (`secret-tool`) when it runs, else a file
only you can read under `~/.config/gamesfun/secrets/`; on Windows a file encrypted for your user (DPAPI) under
`%APPDATA%\gamesfun\secrets\`. `GAMESFUN_CREDENTIALS=file` always uses the file. Without a browser (SSH, a
container), `xcore login --code` prints a link to open anywhere and asks for the code it shows.

**From GitHub Actions, no key stored**: the job's own OIDC token signs the publish in place of a login. xgames.fun
accepts it for the repository and branch you linked to the game once in Studio.

```yaml
# .github/workflows/publish.yml
on: { push: { branches: [main] } }
permissions: { id-token: write, contents: read }
jobs:
  publish:
    runs-on: ubuntu-latest # has Chrome, which the check needs
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npx -y @xgamesfun/xcore@<version> publish ./my-game
```

**Limits**: one game 3,000 files, 100 MiB (one file may be all of it); one account 30 publishes and 1 GB of new files a day, 100
games. `GAMESFUN_STUDIO=<origin>` publishes to another xgames.fun (a Studio on your own machine while developing it).

### Its plan: `xcore plan`

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

Past what is included, a game is **capped** until the month ends: its server answers at most 60 requests a minute (20
from one player) and saves and scores slow down, but nothing is lost and the game keeps working. Paid slots are $15 for
30 days, prepaid in SOL or USDC on xgames.fun (your console → Plans; no automatic renewal, 7 days' grace after the period
ends; when they end, their games go back to free slots and nothing is taken down).
Usage credit, bought the same way, lets Creator games go past what their slots include, at twice what xgames.fun pays,
instead of slowing down. A paid slot moves between your games at any time
(`xcore plan deactivate <one>`, `xcore plan activate <another>`) without changing the bill. `xcore plan [folder]`
shows a game's plan, its limits and this month's use; `--all` your free and paid slots and every game. A game's server sees a 429
with `scope` (`"player"` or `"game"`) and `plan` when it goes past a rate.

### Your own site and your own domain: `xcore embed`, `xcore domain`

A published game plays at its xgames.fun link and inside a post on X. Your own website can show it too, and on
Creator and Scale it can live at an address of yours:

```sh
xcore embed add https://mygame.com     # mygame.com may frame the game; prints the <iframe> for its page
xcore domain add play.mygame.com       # Creator or Scale: prints the DNS records to add at your domain's DNS
xcore domain check play.mygame.com     # live once the records are right (xgames.fun also checks by itself)
xcore domain                           # where the game plays, the sites that embed it, its domains
```

- **Embedding** (every plan: 3 sites, 10, 25): a site is its origin (`https://mygame.com`; `http://localhost:<port>`
  while you build it). It applies within about a minute, with no publish. Framed on your site, the game signs players
  in by itself (a small xgames.fun window, or a code), as in a post on X: only xgames.fun's own page can hand it a
  sign-in, so a page that embeds it can't sign players in for it or take their sign-in.
- **A domain of your own** (Creator 1, Scale 5): `domain add` prints two records, a CNAME pointing the domain at
  xgames.fun and a TXT proving you own it. Once they are right the game is served there with its certificate, and
  sign-in, saves, scores, rooms, the server and the economy work there as on its own link. Sign-in still opens a
  small xgames.fun window, Studio stays on xgames.fun, and a post on X still uses the xgames.fun link. A bare domain
  (`mygame.com`) needs your DNS provider's CNAME flattening or ALIAS record; else use `www.` or `play.` and redirect.
  The page must load `gamesfun.js` 1.2.0 or later (it asks the play edge which game it is on a host of its own): an
  older copy can't sign players in there, so `domain add` says when to run `xcore add signin` and publish again. A
  game whose plan drops keeps its domain paused: it sends players to the xgames.fun link until there is room again.
- Custom domains need xgames.fun's operator to have set them up (Cloudflare for SaaS): until then `xcore domain` says so.

## Upgrading from 0.1.0

A game made with xcore 0.1.0 that has `server/database.js` (`xcore add database` then) needs these changes. A game
without one needs none: the D1 database, `xcore db` and `xcore files` are new.

1. **Run `xcore add database` again.** It brings `server/database.js` up to date (your `RULES` and `LIMITS` are
   kept), with `gamesfun.js` (1.4.0) and the Godot or Unity glue, and lists each `dataOf(env)` call in `server/` that
   needs an owner (step 3) as `file:line` with its change; `xcore publish` lists them again until each names its
   owner. On its first start the new `database.js` moves the documents to a table keyed by collection, owner and id,
   each under its owner. After that, do not roll the game back to a version with 0.1.0's `database.js`: its writes
   fail on the new table.
2. **Rules are private by default.** A `RULES` that 0.1.0 wrote and nobody changed
   (`'*': { read: 'anyone', write: 'owner' }`) becomes `'*': { read: 'owner', write: 'owner' }`: each player reads
   only their own documents. Name each collection that is meant to be public:
   `levels: { read: 'anyone', write: 'owner' }`. A rule xcore does not know (`read: 'everyone'`) now stops the server
   when it starts, instead of being read as something else.
3. **`dataOf(env)` takes an owner.** Without one it is the server's own space (owner `"server"`): 0.1.0's
   `dataOf(env).get('profiles', playerId)` answers 404, and `.put('profiles', playerId, …)` writes a copy the player
   never sees. Pass `{ owner: sub }` (the player's id, `env.GF.verifyPlayer`'s `sub`) as the last argument of `get`,
   `put`, `add` and `delete`, or `{ owner: 'server' }` for the server's own documents. A `list` without an owner is
   still everyone's.
4. **A page reads another player's document by its owner.** An id alone is now the player's own document (or, in a
   `write: 'server'` collection, the server's). For someone else's, pass the owner:
   `gf.db.get('levels', id, { owner: doc.owner })`, `GET api/db/<collection>/<id>?owner=<id>`, Godot
   `db_get(collection, id, {"owner": owner})`, Unity `DbGet(collection, id, owner)`. By id alone it gives
   `data: null` with `code: 'owner'` (said once in the console).
5. **Lists page with `after`, not `offset`.** Pass the last answer's `after` for the next page
   (`gf.db.list('levels', { after: page.after })`); it is `null` on the last page, and `more` says whether there is
   another. A real `offset` is refused (0 or none is fine): `code: 'offset'` from `gf.db.list` and Godot's `db_list`,
   400 from `GET api/db/<collection>?offset=` and from `dataOf(env).list`. Unity's
   `DbList(collection, owner, limit, after, order)` takes the `after` text where 0.1.0's took an `int offset`, so a
   call that passed an offset does not compile until it passes `after`. `LIMITS.offset` is gone.
6. **`createData`** (for server code that runs the documents over SQLite of its own): 0.1.0's
   `createData(sql, { rules, limits, now })`, which called `sql.exec`, is
   `createData(exec, { rules, limits, now, table })`, where `exec(query, ...bindings)` answers the rows or a promise
   of them. Every call is async, and the options come before `who`: `get(collection, id, opts, who)`,
   `put(collection, id, value, opts, who)`, `add(collection, value, opts, who)`, `delete(collection, id, opts, who)`,
   `list(collection, opts, who)`.

## What is not supported, and why

- **Server-side rendering** (a page made per request by Node): the host serves files only. Make the page static and
  put what needs a server in `server/` (a Worker) or a backend of your own.
- **A server in Python, Ruby, Go or another language**: xgames.fun runs only `server/` (a Worker, JavaScript or
  WebAssembly). Such a server runs on a host of your own, declared with `backend use custom`; or its logic moves into
  `server/`, or into the page itself (WebAssembly is allowed: Pyodide runs Python in the browser). Each is a change to
  how the game is built: the person who made it decides.
- **A Node server as the backend on xgames.fun**: `server/` is a Worker, not Node (Node built-ins only with
  `nodejs_compat`, and no `fs`, `child_process` or listening sockets). A Node backend runs on a host of your own,
  declared with `backend use custom`.
- **Scripts, style sheets and fonts from a CDN**: the page loads code and styles from its own files only, so a copy goes
  in the game (or the package is bundled).
- **A fallback to `index.html` for every path**: deep links of a client-side router reload to "not found"; use a hash
  router or links that start at the entry page.
- **Keys that are public by design but look like secrets**, other than the two the scan knows (a Supabase anon or
  publishable key, and a Firebase web config's `apiKey`): the host's scan refuses them like any other key. Fetch such a
  configuration at run time from your backend.
- **More than 8 backend origins, IP addresses, localhost, wildcards**: the host opens the page's policy to named
  public origins only.

## Documentation

- [docs/SERVER.md](docs/SERVER.md): a game's own server code (`server/`, the `gf-server-v1` contract)
- [skills/bring-your-own-game/SKILL.md](skills/bring-your-own-game/SKILL.md): the same steps, for a coding agent
- [CHANGELOG.md](https://github.com/XGamesFun/xcore/blob/main/CHANGELOG.md), [CONTRIBUTING.md](https://github.com/XGamesFun/xcore/blob/main/CONTRIBUTING.md), [SECURITY.md](https://github.com/XGamesFun/xcore/blob/main/SECURITY.md)

## Disclaimer and responsible use

**Use this software at your own risk.** It is provided "as is", without warranty of any kind, express or implied, as
set out in the [LICENSE](LICENSE). The authors and contributors are not liable for any loss or damage arising from its
use, including lost funds, lost data, account suspensions or legal claims.

**You are responsible for making sure everything you build, publish and run with it is legal** in every jurisdiction
where you operate and where your players are. Depending on what your game does, that may include laws and rules on:

- **Gambling, lotteries, sweepstakes and prize promotions.** Loot boxes, raffles, lotteries, coin flips, prize pools
  and paid chances to win are restricted or banned in many countries and states.
- **Digital assets and finance.** Tokens, NFTs, staking and rewards may be treated as securities, commodities,
  payment instruments or money transmission, and may require licensing, KYC/AML checks or sanctions screening.
- **Consumer protection, age limits and advertising**, including rules on minors and on disclosing odds.
- **Tax** on sales, prizes and digital-asset income, for you and for your players.
- **Privacy and data protection** (such as GDPR and CCPA) for any player data your game or its backend collects.
- **Intellectual property.** Publish only code, art, music and names that you own or have a license to use.

Nothing in this repository, its documentation or its output is legal, financial, investment or tax advice. Get advice
from a qualified professional before you offer anything of real value.

**On-chain features.** The loot program runs on Solana **devnet** and **has not been audited**: do not use it with
real value. Blockchain transactions are public and irreversible. You alone control your wallet and keys. Never put a
private key, seed phrase or secret in a game, and approve only transactions you understand.

**Third-party services.** xgames.fun, Cloudflare, Supabase, Railway, GitHub, npm, Solana RPC providers and wallets are
run by others under their own terms and policies, which you must follow. Their availability, fees and rules can change
without notice.

## License

[MIT](LICENSE) © xgames.fun
