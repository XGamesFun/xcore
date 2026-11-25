# xcore's commands

`xcore --help` lists the commands, and `xcore <command> --help` lists each command's options. The help is the
reference for flags, so they are not repeated here. This document covers what the help has no room for: what each
command reads and writes, the steps it takes, and what it prints for scripts.

Run a command without installing it, as `npx -y @xgamesfun/xcore@0.12.0 <command>`. Or install it once with
`npm i -g @xgamesfun/xcore` and run `xcore <command>`.

The unscoped `xcore` package on npm is a different package. Always use `@xgamesfun/xcore`.

Contents:

- [Every command](#every-command)
- [adopt](#adopt): the game's record, and the list of what to fix
- [check](#check): the page check, and the first session
- [dev](#dev): the game on your machine, as xgames.fun hosts it
- [files](#files): the game's project files
- [login and logout](#login-and-logout)
- [publish](#publish): the steps, and publishing from GitHub Actions
- [card](#card): the preview picture
- [connect](#connect): xcore's skill and the economy's tools for a coding agent
- [For scripts and agents: `--json` and exit codes](#for-scripts-and-agents---json-and-exit-codes)
- [Environment variables](#environment-variables)

## Every command

Commands with subcommands (`files`, `secret`, `db`, `embed`, `domain`, `plan`, `coin`) take them the same way:

- `list` and `remove` are the names this reference uses; `ls`, and `rm` or `delete`, are the same subcommands.
- The game's folder is the last word, or `--dir <folder>`; either works, and both must agree. `files` takes
  `--dir <folder>` only, because its words are file paths. The default is the current directory.
- A word that is no subcommand is a usage mistake (exit code 2) that names the subcommands there are, never "no such
  folder".

| Command                    | What it does                                                                                                    | Details                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `xcore adopt [folder]`     | brings in a web game you made: writes its record and lists what to fix for the hosting                          | [adopt](#adopt), [HOSTING.md](HOSTING.md)                                                 |
| `xcore check <folder>`     | the page check: it builds, fits the hosting, starts clean, stays inside its origins                             | [check](#check)                                                                           |
| `xcore dev <folder>`       | runs the game locally as xgames.fun hosts it: its server, sign-in, rooms, economy RPC                           | [dev](#dev)                                                                               |
| `xcore add signin`         | sign-in (X or Google), saves and leaderboards, from the game's own code                                         | [CLIENT.md](CLIENT.md)                                                                    |
| `xcore add database`       | a database for the game (D1)                                                                                    | [CLIENT.md](CLIENT.md#the-database-gamesfundb), [SERVER.md](SERVER.md#the-games-database) |
| `xcore add multiplayer`    | rooms the game owns                                                                                             | [CLIENT.md](CLIENT.md#rooms-xcore-add-multiplayer)                                        |
| `xcore add rpc`            | sends the economy's Solana calls through the game's own RPC                                                     | [SERVER.md](SERVER.md#the-economys-own-rpc)                                               |
| `xcore add vouchers`       | the game's own voucher key, so its server pays results it checked                                               | [SERVER.md](SERVER.md#your-own-key-xcore-add-vouchers)                                    |
| `xcore db`                 | the game's database: info, query, export, import, restore; locally or `--live`                                  | [SERVER.md](SERVER.md#on-this-machine-and-on-xgamesfun-xcore-db)                          |
| `xcore files`              | the game's project files: ls, put, get, rm, usage; locally or `--live`                                          | [files](#files), [SERVER.md](SERVER.md#project-files-envgffiles)                          |
| `xcore backend use custom` | a backend you run: `backend.json` lists the origins the page may reach                                          | [HOSTING.md](HOSTING.md#a-backend)                                                        |
| `xcore secret`             | the game server's secrets (`env.<NAME>`): set, list, delete                                                     | [SERVER.md](SERVER.md#secrets)                                                            |
| `xcore loot`               | a Solana economy on loot: its tools, its page client, going live                                                | [ECONOMY.md](ECONOMY.md)                                                                  |
| `xcore review <folder>`    | a pattern-based check of the economy and server code for payout and key-handling mistakes; not a security audit | [ECONOMY.md](ECONOMY.md#review-xcore-review)                                              |
| `xcore card <folder>`      | the game's preview picture: what a shared link to it shows                                                      | [card](#card)                                                                             |
| `xcore login`              | signs this computer in to xgames.fun, so you can publish                                                        | [login and logout](#login-and-logout)                                                     |
| `xcore logout`             | signs this computer out of xgames.fun (revokes its publish token)                                               | [login and logout](#login-and-logout)                                                     |
| `xcore publish <folder>`   | publishes the game at a link anyone can play (unlisted)                                                         | [publish](#publish)                                                                       |
| `xcore plan`               | your account (Free or Creator) and a game's plan: its limits, this month's use, the unit prices (`--verbose`)   | [HOSTING.md](HOSTING.md#plans-xcore-plan)                                                 |
| `xcore coin`               | a coin that trades, for a published game                                                                        | [ECONOMY.md](ECONOMY.md#a-coin-that-trades-xcore-coin)                                    |
| `xcore embed`              | lets a site of your own show the published game in a frame                                                      | [HOSTING.md](HOSTING.md#your-own-site-and-your-own-domain-xcore-embed-xcore-domain)       |
| `xcore domain`             | serves the published game on a domain of your own                                                               | [HOSTING.md](HOSTING.md#your-own-site-and-your-own-domain-xcore-embed-xcore-domain)       |
| `xcore connect`            | gives Claude Code and Codex xcore's skill and the economy's tools                                               | [connect](#connect)                                                                       |

`xcore --version` (or `-v`) prints the installed version. `xcore help` and `xcore -h` print the command list, the same
as `xcore --help`.

## adopt

`xcore adopt [folder]` reads the folder's shape. The folder defaults to the current one.

- **Plain static files** (an `index.html` at the root, or in `dist/`, `build/`, `public/`, `www/` …): published as
  they are.
- **A project with a build**: the build runs and its output is published. Install the project's packages first
  (`npm ci` or `npm install`); adopt does not install them. Recognized builds:

  | Build                                     | Output folder                                         |
  | ----------------------------------------- | ----------------------------------------------------- |
  | Vite                                      | `dist` (its `outDir`); `public/` is the static folder |
  | Next.js with `output: 'export'`           | `out`                                                 |
  | Astro                                     | `dist`                                                |
  | SvelteKit with `@sveltejs/adapter-static` | `build`                                               |
  | Nuxt with `nuxt generate`                 | `.output/public`                                      |
  | Create React App                          | `build`                                               |
  | Parcel                                    | `dist`                                                |
  | Gatsby                                    | `public`                                              |
  | React Router in SPA mode                  | `build/client`                                        |

  For any other `build` script, adopt finds the output after it runs (`dist`, `build`, `out` …), or you name it:
  `--build "<cmd>" --out <dir>`.

- **Refused** (nothing is written), each with what to do instead:
  - a frontend rendered by a server: Next.js without a static export, SvelteKit without the static adapter,
    `nuxt build`, Astro with `output: 'server'`, Remix, an Express app with no static page;
  - a folder with no `index.html` and no build;
  - a build that fails.

Frameworks and engines that need extra steps (several pages, Nuxt, React Router's framework mode, a monorepo, Godot,
Unity, Unreal, a Node server) are covered in [HOSTING.md](HOSTING.md#frameworks-and-engines).

Adopt writes the game's record into its `gamesfun.json` (which is never published):

```json
{ "page": { "build": "npm run build", "out": "dist", "static": "public", "title": "My Game" } }
```

- `build`: the command that makes the published files, run in the game's folder. Absent for plain files.
- `out`: the folder that is published: `"."` for plain files, otherwise the build's output.
- `static`: the folder the build copies as it is (Vite, Next.js, Astro, CRA: `public`). xcore puts the files it adds
  there (`backend.json`, `xsolana.json`, `gf/loot/`), so every build includes them. For plain files, this is the folder
  itself.
- `title`: optional. The game's name on xgames.fun. Defaults to `index.html`'s `<title>`, then `package.json`'s name.

Use `--static <dir>` to name the static folder when xcore cannot tell, and `--no-build` to read what is already
built. A `server` section of `gamesfun.json` (the game's own server) is left as it is.

Adopt then prints a list, with a fix for each line:

- **Fix before publishing**:
  - what publish refuses: secrets, `.env` files, links, a `backend.json` the host cannot open, files under the host's
    own paths, no `index.html`;
  - what breaks once hosted: files over the limits, paths from the root, a Vite `base` other than `'./'`, scripts,
    style sheets, web fonts or frames from other sites, a `<base>`, an address on your machine.
- **Worth a look**:
  - other sites the code names that `backend.json` does not list. A library's own documentation links need nothing;
    the page check shows which sites the page really calls;
  - a service worker (allowed, but it keeps serving old files after a new version until it updates itself);
  - use of the camera or location;
  - files served without a type;
  - hidden files, which are not uploaded;
  - a tab icon referenced from the root;
  - no way to go full screen.

Fix the items in the game's own files (the source or the build's config, never the build's output) and run adopt
again until the list is empty. Adopt only reads the files. `xcore check` then runs the page and finds what only shows
at run time, such as a path from the root built in a script, or a request to a site `backend.json` does not list.

**What xcore writes in the game's folder** (none of it is published):

- `gamesfun.json`: adopt's record. Commit it.
- `evidence/`: each check's screenshots and record (`evidence/verify-N/`). Add `evidence/` to the game's
  `.gitignore`.
- `.gamesfun/`: publish's last passing check, the link once published, the local database and files, and
  `xcore db export`'s dumps of your players' data. xcore writes `.gamesfun/.gitignore` (`*`) the first time it writes
  there, so this folder stays out of git.

## check

`xcore check <folder>` runs the page check in four steps:

1. **It builds.** Skipped for plain files, or with `--no-build`.
2. **It fits the hosting.** Everything publish would refuse, and everything that breaks once hosted, checked on
   exactly the files that would be uploaded.
3. **The page starts.** The page is served under a folder with the play host's page policy, and opened in Chrome:
   - at a phone's size and a desktop's size;
   - at a phone's size inside the play page's frame (with its `sandbox` and `allow`; see
     [Inside the play page](HOSTING.md#inside-the-play-page));
   - from a link with a query string, as a shared link is.

   It passes when no error is thrown, the console shows no errors, none of the game's own files are missing, nothing
   is requested from the root, something is on screen, and (in the frame) nothing tries a pop-up, form submit or
   top-level navigation while loading. Screenshots: `phone.png`, `desktop.png` and `framed.png` in
   `evidence/verify-N/`.

   A page whose script never yields to the browser (an endless loop) fails here as "the page stopped answering". The
   check waits 15 s for each answer it asks of a page, stops at the first view that gives none, and then skips step 4
   and the first-session walk below.

4. **It stays inside its origins.** Every request must be one the hosted page may make. A script, style, font or frame
   from another site, or a connection to an origin `backend.json` does not list, fails this step.

The report also says whether the game has a [preview picture](#card) (`assets/card.jpg`). A missing picture, or one
xgames.fun cannot draw or will crop or blur, is a warning, never a failed check.

### First session

The report's last section, **First session (as a first-time player on a phone, in the play frame)**, walks through
the game's first minutes as a new player would:

- in the play page's frame, at a phone's size, one touch at a time (up to 6 taps, about 45 s);
- on what such a player taps: a "Play" or "Start", then a "Claim" or "Open", otherwise the centre of the largest
  canvas. It never taps a text field, a link out of the game, or a settings button;
- or on the path `gamesfun.json` declares: `"journey": [{"tap": "#play"}, {"wait": 500}, {"tap": "#claim"}]`.

It reports:

- what was tapped and what appeared;
- the number of taps until play started;
- the first moment a sign-in, a wallet or SOL was needed (a `GamesFun.loot.call` that signs needs a wallet with SOL
  for its fee);
- the wallet prompts and the waits it showed;
- what failed, or what the frame blocked, on the way (screenshots `journey-1.png`…);
- a short summary at the end ("In short").

A first reward is mentioned only for a game with an economy. A tap that leaves the page in an endless loop is reported
with that tap, and ends the walk. The walk is informational and never fails the check. Publish's own check does not
run it. With `--json`, it is the `firstSession` field.

A backend that does not answer your machine is a note, not a failure. The page check only shows that the game starts
cleanly and stays inside what the hosting allows. It does not test gameplay. Publish's gate runs the same check, and
a game whose check fails is uploaded as a private draft only.

## dev

`xcore dev <folder>` serves the game on your machine the way xgames.fun will host it, with everything a published game
has behind it, so you can run the whole game before you publish:

- **`http://127.0.0.1:8787/game/`**: the published files, with the play host's headers. It runs `page.build` first,
  unless you pass `--no-build`.
- **`/game/api/*`**: the game's `server/`, under workerd (the runtime xgames.fun uses). It includes Durable Objects
  with persistent storage, WebSockets, `env.GF`, the game's database (a local D1 in `.gamesfun/dev/d1/`, with its
  migrations applied), and secrets from `.dev.vars`. A change under `server/` or to `.dev.vars` reloads it. Miniflare
  (with workerd, about 180 MB) is installed once, the first time a game with a server runs
  ([SERVER.md](SERVER.md#running-it-locally)).
- **`/platform/v1/*`**: sign-in, saves and leaderboards. `gamesfun.js` signs in a local player (each tab has its own,
  so two tabs can play a room together), and `env.GF.verifyPlayer` accepts its token. Saves and scores are kept in
  `.gamesfun/dev-platform.json` (never published) and held to the limits of the plan being imitated (below).
- **`/api/player/v1/*`**: xgames.fun's side of the page's own sign-in, as the published game gets it on its own host:
  - the check a page makes without a tap (`session?slug=`): a tab that signed in is signed in again after a reload,
    and after `xcore dev` restarts;
  - a Sign out that persists (`session/forget`);
  - Sign in's round trip to X or Google (`x/begin`, `google/begin`);
  - the sign-in client at `/platform/v1/signin/v1.js`.
- **`/platform/v1/live`**: the game's live settings ([`GamesFun.live`](CLIENT.md#live-settings-gamesfunlive)): its announcement,
  config and maintenance mode, from `.gamesfun/live.json` (read again on each request, never published). With
  maintenance on, the game's pages show the holding page, and its `api/` and `/platform/v1/*` answer `503` with code
  `maintenance`, as they do when hosted.
- **`http://127.0.0.1:8788/`**: the game's public project files (`env.GF.files`, `xcore files`), kept in
  `.gamesfun/dev/files/`. This is a separate origin, as `<slug>.xgamesusercontent.com` is for the published game.
- **`/loot/v1/rpc`**: the economy's Solana RPC, on its cluster. By default this is xgames.fun's shared devnet relay
  (what a published page uses unless the game has its own RPC: `xcore add rpc`). Set `XSOLANA_RPC_URL` in `.env` to use
  your own; its URL is never shown, and a call the shared relay would refuse is reported in the terminal. An economy on
  mainnet needs your own RPC here, because the mainnet relay only answers a published game's signed-in players. The
  economy's calls work once it is live (`xcore loot approve`).

The port is the first free one from 8787 (use `--port` for another), and the project files are on the next port.

Games made with any engine get all of this through `gamesfun.js` (`xcore add signin`). On a plain local server,
`gamesfun.js` falls back to the browser's storage. Under `xcore dev`, it uses the real services.

### The plan's limits, refused as published

`xcore dev` imitates one plan: Free, unless you pass `--plan creator` or `--plan scale`. It says which plan when it
starts. Its platform refuses what xgames.fun refuses on that plan, with the same error codes:

- the plan's boards (8 on Free) and board rules (16);
- entries per board (10,000);
- save bytes per game (10 MB);
- reads (1,200) and writes (600 saves, 600 scores) a minute, with the server's and the pages' counted separately;
- project files' total size, and the plan's file calls a minute (120).

These rules for the page are the same on every plan:

- A page makes `high` boards only: two per player, and half the plan's boards in all. The game's server makes the
  rest, including `low` ones, and `GF.scores.list` shows who made each.
- One player's saves from the page keep at most 1/128 of the game's save bytes (80 KB on Free). When the game's saves
  are full, a player can still keep 4 KB.
- One player writes at most 60 saves and 30 scores a minute.
- A request body is JSON (`content-type: application/json`) of at most 96 KB.
- A board read from the page shows each player as an id of the game's own (16 letters and digits), never their
  account, with `me: true` on the caller's entry.
- Without a player token, a board read gets the top 100 only (`offset` plus `limit` past 100 answers 401), may get the
  same answer again for 5 seconds, and has its own limit a minute (a tenth of the plan's reads).
- Ranks and offsets are counted to 10,000. Past that, a rank is `10001` with `rankAtLeast: true`.
- A public project file is an image, audio, video, a font, JSON or plain text whose first bytes match that type.
  Anything else is private.
- `env.GF.files.put` holds at most 1 MB of a string or ArrayBuffer body. Send a bigger file as a stream with its
  `length`.

Reported, but not imitated:

- one player's requests to the game's server a minute, and its CPU per request (the dev log says when a request would
  exceed them);
- one address's reads of `/platform/v1` at the play edge (120 a minute). Locally, every tab is the same address.

Not imitated at all:

- network delays;
- the owner's moderation (bans, blocked words);
- the board ids of the published game (the local ones are your machine's own);
- limits on the server's outbound `fetch`, which locally is not limited to `backend.json`'s origins.

The per-minute counts reset when `xcore dev` restarts.

## files

A game with a server can keep its own files on xgames.fun: replays, generated levels, a large saved world, content
packs. Storage is 100 MB on Free, 10 GB on Creator and 100 GB on Scale, with at most 25 MB per file. The game's server
writes and reads them with `env.GF.files` ([SERVER.md](SERVER.md#project-files-envgffiles)), and you upload them from
your machine:

```bash
xcore files put ./levels/forest-3.json levels/forest-3.json --public --live   # served at https://<slug>.xgamesusercontent.com/levels/forest-3.json
xcore files list levels/ --live
xcore files get replays/run-1.json --live --out run-1.json
xcore files remove levels/old.json --live                 # prints what it would delete, with a code, and deletes nothing
xcore files remove levels/old.json --live --yes <code>    # deletes it
xcore files usage --live
```

A public file is served from a separate site, which the browser treats as unrelated to the game: it cannot use the
player's sign-in or call the game's `api/`. Anything that could carry a script (HTML, SVG, JavaScript) is served as a
download, never as a page. The game's page may load pictures, sounds and fonts from it and `fetch` its data. Players
never write here.

Without `--live`, `xcore files` works on the files `xcore dev` gives the server. They are kept in
`.gamesfun/dev/files/` and served on a port of their own.

**Overwrites and deletes are permanent.** xgames.fun keeps one copy of each file and no earlier versions, so a file
that is overwritten or deleted there is gone for good.

- Uploading to a new path happens at once.
- `put --live` to a path xgames.fun already has, and `remove --live`, first print what would be lost (the file there, its
  size and type) with a code, and change nothing. Run the same command with `--yes <code>` to go ahead. A code printed
  for a different change is refused.
- `xcore files get <path> --live` keeps a local copy first.

## login and logout

`xcore login` signs this computer in. Your browser signs in to xgames.fun and hands xcore a publish token valid for 30
days. xcore never sees your password.

- On the approval page, tick the games this computer may work on, or your whole account. `xcore login` says what it
  was given, and `login --status` says it again.
- A game you publish as new from that sign-in is added to it.
- A command for any other game is refused with code `not-granted` ("your sign-in was not given this game"). Run
  `xcore login` again and tick that game.
- Without a browser (SSH, a container), `xcore login --code` prints a link to open on any device and asks for the code
  it shows.

**Where the token is kept**:

| System  | Store                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------- |
| macOS   | the keychain                                                                                                            |
| Linux   | the Secret Service (`secret-tool`) when it runs; otherwise a file only you can read under `~/.config/gamesfun/secrets/` |
| Windows | a file encrypted for your user (DPAPI) under `%APPDATA%\gamesfun\secrets\`                                              |

`GAMESFUN_CREDENTIALS=file` always uses the file.

`xcore logout` signs this computer out: the publish token is revoked at xgames.fun and deleted locally. Published
games stay published.

## publish

`xcore publish <folder>` builds the game, runs the page check on exactly the files built, and uploads the published
folder with its `server/` bundle.

### The first publish of a folder

A folder's first publish creates a new game on the account this computer is signed in to, and the game counts toward
that account's games: 2 on a Free account, 10 on a Creator account ([HOSTING.md](HOSTING.md#plans-xcore-plan)). So it
is confirmed first. `xcore publish` prints:

```text
This creates a new game on https://xgames.fun:
  account: you@example.com
  game:    “Click the Moth” (from the folder my-game)
  slot:    one of your 2 free slots (0 in use now, 1 after this)
```

and changes nothing. On a Creator account, the last line is `plan:    your Creator account (3 of 10 games now, 4 after
this)`. An account that already has all its games is told so instead, and nothing is uploaded: archive a game you no
longer need on your console, or, on Free, buy a Creator account (`--json`: `code: "game-cap"`).

- At a terminal, type `publish` to go on.
- Without a terminal (a script, an agent), run the same command again with `--yes <code>`, using the code it printed.
  With `--json`, the printout is `{ok: true, planned: true, code, plan, next}`, and `next` is the command to run.
- The code covers the site, the account, the game's name and the folder. A code printed for anything else is refused.
- Publishing a folder that is already linked to its game (`.gamesfun/publish.json`) updates that game with no question.
  `--new` makes another game, and asks again.
- A GitHub Actions job signed in with its OIDC token is not asked: it publishes only the game its repository was linked
  to in Studio.

The steps of every publish:

1. **The files**: the published folder, without hidden files, `evidence/`, `node_modules/`, `server/`, `supabase/` and
   the makers' notes at its top level (`README.md`, `NOTES.md`, `LAUNCH.md` and similar). A `.env` file or a symbolic
   link stops the publish. Two small records are uploaded with them, because xgames.fun keeps them with every version:
   `foundation.lock.json` (which tool published it) and `adaptation-plan.json` (the game's title and a one-line
   description). Like every published file, both can be read at the game's link.
2. **No secrets**: every text file is scanned for anything that looks like a key (private keys; cloud, payment and AI
   keys; a Supabase service-role key; a database address with a password). xgames.fun scans again on its side.
3. **Its backend**: `backend.json`'s origins are the only other sites the published page may reach.
4. **Its server code** (`server/`, a Worker under the `gf-server-v1` contract): bundled into one file and checked. It
   must build, contain no code generated from text, use no Node built-in a Worker lacks, contain no secrets, export
   its Durable Objects, and be at most 5 MB. `server/` and `gamesfun.json` are never public files.
5. **The check**: a game whose check fails is saved as a private draft (a version in your xgames.fun Studio, with no
   public link), and you are told which checks failed. A pass is remembered for exactly these files.
6. **Upload**: only the files xgames.fun does not already have.
7. **The link**: unlisted, and the same across every update. Publishing the folder again makes the next version.
   - The play host caches files for up to 30 seconds, so an update can take that long to appear at the link. During
     that time a visitor can get some files from the new version and some from the old.
   - Files the new version no longer has are removed at once. A page someone already has open that loads a file later
     (such as a lazily loaded chunk with a hashed name) can fail to find it, so have the game reload when that happens.
   - A game installed as an app (a web manifest and a service worker) installs from its own link,
     `https://<slug>-play.xgames.fun/`.

Before anything is uploaded, publish needs the game's **preview picture** ([card](#card)). If there is none, or
xgames.fun cannot use it, publish stops and says what is wrong. Make one (`xcore card`), or publish without one
(`--no-card`).

Other modes:

- `publish --check` runs steps 1 to 4 without publishing, and says whether the preview picture is there.
  `--check --verify` also runs the check and remembers a pass.
- `--status` shows the link and the account.
- `--draft` saves a private version.
- `--new` makes a new game with a new link.

The limits a publish is held to are in [HOSTING.md](HOSTING.md#limits).

### From GitHub Actions, no key stored

The job's own OIDC token signs the publish in place of a login. xgames.fun accepts it for the repository and branch you
linked to the game once in Studio.

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
      - run: npx -y @xgamesfun/xcore@0.12.0 publish ./my-game
```

Commit the game's preview picture (`assets/card.jpg`, made once with `xcore card`). A publish without one stops, in a
CI job as anywhere else.

## card

When a link to the game is shared on X, in a chat, or anywhere that shows link previews, xgames.fun serves a 960×960
card for it:

- the game's own picture as the background (scaled to cover the square), darkened a little at the top and bottom;
- "XGames.fun" and the game's title drawn large across the top band;
- a "Tap to play" button at the bottom left.

Without a picture, the card is a plain dark gradient with the title, which is easy to scroll past.

### The file

`assets/card.jpg` (or else `assets/card.png`) among the published files. For a brought game with a build, it must be
in what the build makes (`page.out`). If both exist, `card.jpg` is used.

### What xgames.fun can draw

Publish stops for anything else:

- a JPEG or PNG whose name matches its format (a PNG named `card.jpg`, or a JPEG named `card.png`, fails to draw:
  rename it);
- a complete file (not truncated; a PNG's image data is checked too);
- at most 1,500,000 bytes (a bigger file is ignored);
- for a JPEG, a baseline or progressive one. Other kinds, such as lossless or arithmetic-coded JPEGs, cannot be drawn.
  `xcore card <folder> --from <it> --force` makes one that can.

### What looks right

Publish goes on for these, with a warning and the fix:

- The ideal is square, 960×960, as drawn.
- A side under 600 px is scaled up and looks blurry.
- A picture far from square (the longer side over 1.25 times the shorter) is cropped to its middle.
  `xcore card <folder> --from assets/card.jpg --force` makes that crop locally so you can see it.
- Keep the subject clear of the top third (the title) and the bottom left (the button).

### `xcore card <folder>`

This makes a picture. It serves the game as the page check does, opens it in Chrome at 960×960, waits 4 seconds
(`--wait <seconds>`), and saves a JPEG.

- `--tap` taps the middle once first (for a game that starts on a tap).
- `--path <page?query>` opens another page of the game.
- `--from <picture>` makes the card from key art or a screenshot you have instead (scaled to cover and cropped to its
  middle; at most 40 MB).
- It never replaces an existing `assets/card.jpg`, or an `assets/card.png` xgames.fun can draw, without `--force`.
  With `--force`, it says which file is used.
- For a game with a build, it writes into the folder the build copies as it is (`page.static`, such as `public/`), so
  the build includes it in what is published. For a build with no such folder, it tells you where the picture has to
  go, and writes nothing.
- A page that answers with an error produces no picture. A page that throws or logs errors produces one, says so, and
  fails unless you pass `--force`.

Open the picture and look at it before you publish.

### Publish asks for it

- With no picture, `xcore publish` makes one from the newest page check screenshot (`evidence/verify-N/desktop.png`,
  else `phone.png`), as `xcore card --from <screenshot>` would: 960×960, a JPEG of at most 1,500,000 bytes. It says so in
  one line; replace it with `xcore card <folder> --force`. It writes the picture where `xcore card` does, before the
  build, so the build includes it.
- With no picture and no screenshot (run `xcore check` first), or with a picture xgames.fun cannot draw, `xcore publish`
  stops before anything is uploaded, says what is wrong, and names the ways forward. With `--json`: `"code": "card"`, `"card"` (what it found) and `"next"` (the
  command that fixes it).
- `--draft`, `--status` and `--check` do not stop for it. `--check --json` reports it in `card` and `cardWarnings`.
- `xcore publish --no-card` publishes without a picture (the link shows the plain card). `"card": false` in
  `gamesfun.json` makes that permanent, so the game is not asked again.
- After a publish with a picture, xcore prints the card's address, `https://xgames.fun/play/<slug>/card.png`. A link
  shared earlier can keep its old card for a while, because X and chat apps cache it.

## connect

For use with a coding agent, the skill in `skills/bring-your-own-game/` walks through the same steps. `xcore connect`:

- copies the skill into Claude Code's and Codex's skills;
- adds the economy's tools, as `xcore loot connect` does (the `xsolana_*` MCP tools and the `xsolana-economy` skill);
- prints a few lines for a project's AGENTS.md (it never writes AGENTS.md or CLAUDE.md).

By default it does this for the folder it runs in only: the skills go in that folder's `.claude/skills/` and
`.agents/skills/`, and Claude Code registers the tools for that project. `xcore connect --scope user` does it for every
project of this user (`~/.claude/skills/`, `~/.agents/skills/` and the user's MCP settings). Codex registers MCP
servers only for the whole user, so with the default scope its tools are left out (run `--scope user` for them).
`--dry-run` shows what it would do, starts no agent's program (it looks for `claude` and `codex` on PATH instead), and
changes nothing.

For other agents (Cursor, Copilot, Gemini CLI and more), `npx skills add XGamesFun/xcore` installs the same skill.

## For scripts and agents: `--json` and exit codes

Every command takes `--json`. By default the commands print a short result: a verdict, one line per finding, and at
most three next steps. `--verbose` prints the rest, and `--json` always has everything:

- `xcore add` and `xcore loot add`: every note on using what was added (`--json`: `next` and `steps`);
- `xcore check`: each check's detail and every tap of the first-session walk (also in `record.json`);
- `xcore review`: how it reads, every finding with its fix, every question and the trade-offs (also in `review.md`);
- `xcore dev`: where saves are kept, the economy's RPC, and what the stand-in does not imitate.

- A failure is then also printed on stdout as `{ "ok": false, "error", "code", "state", "next" }`:
  - `code` is the reason (`usage`, `login`, `files`, `secrets`, `build`, `card`, `size`…; `failed` when there is no
    more specific code);
  - `next` is the command that moves it on;
  - `state` and `next` are present only when the failure has them.
- `check --json` and `adopt --json` print their whole report, with the same `ok`, `error` and `code` in it when the
  check fails or the game is refused.
- `xcore loot <command> --json` passes on the economy tools' own JSON unchanged.
- `login --status --json` and `publish --status --json` give the sign-in's `state`: `signed-in`, `signed-out`,
  `expired`, or `unreadable` (the token is kept where this session cannot read it, such as the Secret Service over
  SSH).
- `publish --status --json` also gives the game's `link`: `never`, `started`, `public`, `draft`, or
  `draft-over-public`.
- `adopt --json` gives `state` (`refused`, `fix`, `ready`) and `next`.

Exit codes:

| Code | Meaning                                                                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | success                                                                                                                                        |
| 1    | any failure other than a usage mistake                                                                                                         |
| 2    | a usage mistake (no such command, subcommand or flag; a missing or extra argument): stderr says what was wrong, then the command's usage lines |
| 3    | `xcore review` only: INCONCLUSIVE, no high finding but a payout the review could not read                                                      |

## Environment variables

| Variable                        | Effect                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GAMESFUN_STUDIO=<origin>`      | publishes to another xgames.fun (a Studio on your own machine while developing it)                                                                                                                                                                                                                                                        |
| `GAMESFUN_CREDENTIALS=file`     | always keeps the publish token in the file ([login and logout](#login-and-logout))                                                                                                                                                                                                                                                        |
| `XSOLANA_RPC_URL`               | a Solana RPC of your own. In `.env`: for `xcore dev`'s `/loot/v1/rpc` and for going live ([ECONOMY.md](ECONOMY.md#going-live)). When set, it is also the RPC a coin launch uses ([ECONOMY.md](ECONOMY.md#a-coin-that-trades-xcore-coin)). In `.dev.vars` or as a secret: the game's own RPC ([SERVER.md](SERVER.md#the-economys-own-rpc)) |
| `GAMESFUN_SERVER_DEPS=<folder>` | a Miniflare installed elsewhere ([SERVER.md](SERVER.md#running-it-locally))                                                                                                                                                                                                                                                               |
| `XCORE_DEV_SIGNIN=wallet`       | `xcore dev` signs local players in with a wallet only ([SERVER.md](SERVER.md#your-own-key-xcore-add-vouchers))                                                                                                                                                                                                                            |
| `GAMESFUN_DEBUG=1`              | prints stack traces for errors                                                                                                                                                                                                                                                                                                            |
