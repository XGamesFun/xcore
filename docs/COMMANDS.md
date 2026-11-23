# xcore's commands

`xcore --help` lists the commands, and `xcore <command> --help` gives each one's options: the help is the full word on
flags, and this page does not repeat it. Here is what a command's help has no room for: what it reads and writes, the
steps it takes, and what it prints for scripts. Run it as `npx -y @xgamesfun/xcore <command>`, or install it once
(`npm i -g @xgamesfun/xcore`) and run `xcore <command>` (`xcore` on npm is another package).

- [Every command](#every-command)
- [adopt](#adopt): the game's record, and the list of what to fix
- [check](#check): the page check, and the first session
- [dev](#dev): the game on this machine, as xgames.fun hosts it
- [files](#files): the game's project files
- [login and logout](#login-and-logout)
- [publish](#publish): the steps, and publishing from GitHub Actions
- [card](#card): the preview picture
- [connect](#connect): xcore's skill and the economy's tools for a coding agent
- [For scripts and agents: `--json` and exit codes](#for-scripts-and-agents---json-and-exit-codes)
- [Environment variables](#environment-variables)

## Every command

| Command                    | What it does                                                                        | Told in full                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `xcore adopt [folder]`     | brings a web game you made: its record, and what to fix for the hosting             | [adopt](#adopt), [HOSTING.md](HOSTING.md)                                                    |
| `xcore check <folder>`     | the page check: it builds, fits the hosting, starts clean, stays inside its origins | [check](#check)                                                                              |
| `xcore dev <folder>`       | plays the game here as xgames.fun hosts it: its server, sign-in, rooms, economy RPC | [dev](#dev)                                                                                  |
| `xcore add signin`         | sign-in (X first, or a wallet), saves and leaderboards, from the game's own code    | [CLIENT.md](CLIENT.md)                                                                       |
| `xcore add database`       | a database of the game's own (D1)                                                   | [CLIENT.md](CLIENT.md#the-database-gamesfundb), [SERVER.md](SERVER.md#a-database-of-its-own) |
| `xcore add multiplayer`    | rooms the game owns                                                                 | [CLIENT.md](CLIENT.md#rooms-xcore-add-multiplayer)                                           |
| `xcore add rpc`            | the economy's Solana calls through the game's own RPC                               | [SERVER.md](SERVER.md#the-economys-own-rpc)                                                  |
| `xcore add vouchers`       | the game's own voucher key, so its server pays results it checked                   | [SERVER.md](SERVER.md#your-own-key-xcore-add-vouchers)                                       |
| `xcore db`                 | the game's database: info, query, export, import, restore; here or `--live`         | [SERVER.md](SERVER.md#on-this-machine-and-on-xgamesfun-xcore-db)                             |
| `xcore files`              | the game's project files: ls, put, get, rm, usage; here or `--live`                 | [files](#files), [SERVER.md](SERVER.md#project-files-envgffiles)                             |
| `xcore backend use custom` | a backend you run: `backend.json` names the origins the page may reach              | [HOSTING.md](HOSTING.md#a-backend)                                                           |
| `xcore secret`             | the game server's secrets (`env.<NAME>`): set, list, delete                         | [SERVER.md](SERVER.md#secrets)                                                               |
| `xcore loot`               | a Solana economy on loot: its tools, its page client, going live                    | [ECONOMY.md](ECONOMY.md)                                                                     |
| `xcore review <folder>`    | the security review: what a cheater gets from its economy and server                | [ECONOMY.md](ECONOMY.md#review-xcore-review)                                                 |
| `xcore card <folder>`      | the game's preview picture: what a shared link to it shows                          | [card](#card)                                                                                |
| `xcore login`              | signs this computer in to xgames.fun, to publish                                    | [login and logout](#login-and-logout)                                                        |
| `xcore logout`             | signs this computer out of xgames.fun (revokes its publish token)                   | [login and logout](#login-and-logout)                                                        |
| `xcore publish <folder>`   | puts the game at a link anyone can play (unlisted)                                  | [publish](#publish)                                                                          |
| `xcore plan`               | a game's plan (Free, Creator, Scale): its limits, this month's use, game slots      | [HOSTING.md](HOSTING.md#plans-xcore-plan)                                                    |
| `xcore coin`               | a coin that trades, for a published game                                            | [ECONOMY.md](ECONOMY.md#a-coin-that-trades-xcore-coin)                                       |
| `xcore embed`              | a site of your own may show the published game in a frame                           | [HOSTING.md](HOSTING.md#your-own-site-and-your-own-domain-xcore-embed-xcore-domain)          |
| `xcore domain`             | the published game on a domain of your own                                          | [HOSTING.md](HOSTING.md#your-own-site-and-your-own-domain-xcore-embed-xcore-domain)          |
| `xcore connect`            | gives Claude Code and Codex xcore's skill and the economy's tools                   | [connect](#connect)                                                                          |

`xcore --version` (or `-v`) prints the installed version; `xcore help` and `xcore -h` print the list, as
`xcore --help` does.

## adopt

`xcore adopt [folder]` (default: the folder you are in) reads the folder's shape:

- **Plain static files** (an `index.html` at its root, or in `dist/`, `build/`, `public/`, `www/` …): published as
  they are.
- **A project with a build**: the build runs (install its packages first, `npm ci` or `npm install`: adopt does not),
  and its output is published. Known: Vite (`dist`, its `outDir`; `public/`), Next.js with `output: 'export'` (`out`),
  Astro (`dist`), SvelteKit with `@sveltejs/adapter-static` (`build`), Nuxt with `nuxt generate` (`.output/public`),
  Create React App (`build`), Parcel (`dist`), Gatsby (`public`), React Router in SPA mode (`build/client`). Any other
  `build` script: its output is found after it runs (`dist`, `build`, `out` …), or given: `--build "<cmd>" --out <dir>`.
- **Refused** (nothing is written): a frontend rendered by a server (Next.js without a static export, SvelteKit
  without the static adapter, `nuxt build`, Astro with `output: 'server'`, Remix, an Express app with no static
  page), a folder with no `index.html` and no build, a build that fails. Each comes with what to do.

Frameworks and engines that need a word more (several pages, Nuxt, React Router's framework mode, a monorepo, Godot,
Unity, Unreal, a Node server) are in [HOSTING.md](HOSTING.md#frameworks-and-engines).

It writes the game's record into its `gamesfun.json` (never published):

```json
{ "page": { "build": "npm run build", "out": "dist", "static": "public", "title": "My Game" } }
```

- `build`: the command that makes the published files, run in the game's folder; none for plain files.
- `out`: the folder that is published: `"."` for plain files, else the build's output.
- `static`: the folder the build copies as it is (Vite, Next.js, Astro, CRA: `public`), where xcore puts the files it
  adds (`backend.json`, `xsolana.json`, `gf/loot/`), so every build carries them; for plain files, the folder itself.
- `title`: optional: the game's name on xgames.fun (else `index.html`'s `<title>`, else `package.json`'s name).

`--static <dir>` names that folder when xcore cannot tell; `--no-build` reads what is built already. A `server` part of
`gamesfun.json` (the game's own server) stays as it is.

Then a plain list, each line with its fix:

- **Fix before publishing**: what publish refuses (secrets, `.env` files, links, a `backend.json` the host cannot
  open, files under the host's own paths, no `index.html`) and what breaks once hosted (files over the limits, paths
  from the root, a Vite `base` other than `'./'`, scripts, style sheets, web fonts or frames from other sites, a
  `<base>`, an address on this machine).
- **Worth a look**: other sites the code names that `backend.json` does not list (a library's own documentation links
  need nothing: the page check shows which ones the page really calls), a service worker (allowed; it keeps old files
  after a new version until it updates itself), the camera or location, files served without a type, hidden files
  that do not go up, a tab icon named from the root, no way to go full screen.

Fix the list in the game's own files (the source or the build's config, never the build's output) and adopt again
until it is empty. Adopt reads the files; `xcore check` then runs the page and finds what only shows at run time (a
path from the root built in a script, a request to a site `backend.json` does not list).

**What xcore writes in the game's folder**: `gamesfun.json` (adopt's record; commit it), `evidence/` (each check's
screenshots and record, `evidence/verify-N/`) and `.gamesfun/` (publish's last passing check, the link once published,
the local database and files, and `xcore db export`'s dumps of your players' data). None of them is published.
`.gamesfun/` keeps itself out of git: xcore writes `.gamesfun/.gitignore` (`*`) when it first writes there; add
`evidence/` to the game's `.gitignore`.

## check

`xcore check <folder>` is the page check:

1. **it builds** (skipped for plain files, or with `--no-build`)
2. **it fits the hosting**: everything publish would refuse, and what breaks once hosted, on exactly what would go up
3. **the page starts**: served under a folder with the play host's page policy, in Chrome at a phone's size and a
   desktop's, and at a phone's size inside the play page's frame (its `sandbox` and `allow`, see
   [Inside the play page](HOSTING.md#inside-the-play-page)), opened from a link with a query string as a shared one is:
   no error thrown, nothing in the console's errors, none of its own files missing, nothing asked for from the root,
   something on screen, and (in the frame) no pop-up, form submit or top-level navigation as it loads (screenshots
   `phone.png`, `desktop.png` and `framed.png` in `evidence/verify-N/`). A page whose script never gives the browser
   a turn (a loop with no end) fails here as "the page stopped answering": the check waits 15 s for each answer it
   asks of a page, stops at the first view that gives none, and does not run check 4 or the walk below
4. **it stays inside its origins**: every request is one the hosted page may make; a script, style, font or frame from
   another site, or a connection to an origin `backend.json` does not list, fails it

The report also says whether the game has a [preview picture](#card) (`assets/card.jpg`): a warning when it has none,
or one xgames.fun cannot draw or will crop or blur, never a failed check.

Its last section, **First session (as a first-time player on a phone, in the play frame)**, walks the game's first
minutes as a new player would: in the play page's frame at a phone's size, a touch at a time (up to 6 taps, about 45
s), on what such a player taps (a "Play" or "Start", then a "Claim" or "Open", else the centre of the largest canvas;
never a field to type in, a link out of the game or a settings button), or on the path `gamesfun.json` declares
(`"journey": [{"tap": "#play"}, {"wait": 500}, {"tap": "#claim"}]`). It says what was tapped and what appeared, the
taps until play answered, the first moment a sign-in, a wallet or SOL was needed (a `GamesFun.loot.call` that signs
needs a wallet with SOL for its fee), the wallet prompts, the waits it showed, what failed or the frame blocked on the
way (screenshots `journey-1.png`…), and ends with a few sentences to pass on as they are. A first reward is spoken of
only for a game with an economy; a tap that leaves the page in a loop with no end is said, with the tap, and ends the
walk. It informs and never fails the check; publish's own check does not run it. `--json` has it as `firstSession`.

A backend that does not answer this machine is a note, not a failure. The game's play is its own: the page check says
it starts clean and stays inside what the hosting allows, nothing more. Publish's gate runs the same check, and a game
whose check fails goes up as a private draft only.

## dev

`xcore dev <folder>` serves the game on this machine the way xgames.fun will host it, with everything a published game
has behind it, so the whole game runs before it is published:

- **`http://127.0.0.1:8787/game/`**: the published files (it runs `page.build` first, unless `--no-build`), with the
  play host's headers.
- **`/game/api/*`**: the game's `server/` under workerd, the runtime xgames.fun runs it on: Durable Objects with their
  storage kept, WebSockets, `env.GF`, the game's database (a local D1 in `.gamesfun/dev/d1/`, its migrations applied),
  and its secrets from `.dev.vars`. A change under `server/` or to `.dev.vars` reloads it. Miniflare (with workerd,
  about 180 MB) is installed once, the first time a game with a server runs ([SERVER.md](SERVER.md#running-it-locally)).
- **`/platform/v1/*`**: sign-in, saves and leaderboards: `gamesfun.js` signs in a local player (each tab its own, so two
  tabs play a room together), and `env.GF.verifyPlayer` accepts its token. Saves and scores are kept in
  `.gamesfun/dev-platform.json`, never published, and held to the limits of the plan it imitates (below).
- **`/api/player/v1/*`**: xgames.fun's side of the page's own sign-in, as the published game gets it on its own host:
  the question a page asks with no tap (`session?slug=`: a tab that signed in is signed in again after a reload, and
  after `xcore dev` starts again), Sign out that sticks (`session/forget`), and Sign in's trip to X and back
  (`x/begin`, `google/begin`); and the sign-in client at `/platform/v1/signin/v1.js`.
- **`/platform/v1/live`**: the game's live settings ([`gf.live`](CLIENT.md#live-settings-gflive)): its announcement,
  config and maintenance, from `.gamesfun/live.json` (read again on each request, never published). With maintenance
  on there, the game's pages show the holding page and its `api/` and `/platform/v1/*` answer `503` with code
  `maintenance`, as hosted.
- **`http://127.0.0.1:8788/`**: the game's public project files (`env.GF.files`, `xcore files`), kept in
  `.gamesfun/dev/files/`: another origin, as `<slug>.xgamesusercontent.com` is to the published game.
- **`/loot/v1/rpc`**: the economy's Solana RPC, on its cluster: xgames.fun's shared devnet relay (what a published page
  talks to unless the game brings its own: `xcore add rpc`), or your own with `XSOLANA_RPC_URL` in `.env` (its URL is
  never shown; a call the shared relay would refuse is said in the terminal). An economy on mainnet needs your own here:
  its relay answers a published game's signed-in players only. The economy's calls answer once it is live
  (`xcore loot approve`).

The port is the first free one from 8787 (`--port` for another), and the files are on the port after it.

Games made with any engine get all of it through `gamesfun.js` (`xcore add signin`): on a plain local server it stands
in with this browser's storage; under `xcore dev` it uses the real thing.

### The plan's limits, refused as published

`xcore dev` imitates one plan, Free unless `--plan creator` or `--plan scale` (it says which when it starts), and its
platform refuses what xgames.fun refuses on that plan, with the same codes: the plan's boards (8 on Free) and board
rules (16), entries a board (10,000), save bytes a game (10 MB), and reads (1,200) and writes (600 saves, 600 scores) a
minute, the server's and the pages' counted apart; project files' total and the plan's file calls a minute (120).

What a page may do is the same on every plan: it makes `high` boards only, two a player and half the plan's boards in
all (the game's server makes the rest, `low` ones too, and `GF.scores.list` shows who made each); one player's saves
from the page keep at most 1/128 of the game's save bytes (80 KB on Free), and with the game's saves full a player
still keeps 4 KB; one player writes 60 saves and 30 scores a minute; a body is JSON (`content-type: application/json`)
of at most 96 KB. A board read from the page shows each player as an id of the game's own (16 letters and digits),
never their account, with `me: true` on the caller's entry; without a player token it reads the top 100 only (`offset`
plus `limit` past 100 answers 401), may get the same answer again for 5 seconds, and has its own minute (a tenth of the
plan's reads). Ranks and offsets are counted to 10,000 (past it a rank is `10001` with `rankAtLeast: true`). A public
project file is an image, audio, video, a font, JSON or plain text whose first bytes are that type (else private), and
`env.GF.files.put` holds at most 1 MB of a string or ArrayBuffer body (a bigger file goes as a stream with its
`length`).

What is not imitated, and said instead: one player's requests to the game's server a minute and its CPU a request (the
dev log says when a request would pass them), and one address's reads of `/platform/v1` at the play edge (120 a minute;
here every tab is one address). Not imitated at all: the network's delays, the owner's moderation (bans, blocked
words), the board ids of the published game (these are this machine's own), and the server's outbound `fetch`, which is
not limited to `backend.json`'s origins. The counts a minute start again when `xcore dev` does.

## files

A game with a server keeps files of its own on xgames.fun: replays, generated levels, a large saved world, content
packs (Free 100 MB, Creator 10 GB, Scale 100 GB; 25 MB a file). Its server writes and reads them with `env.GF.files`
([SERVER.md](SERVER.md#project-files-envgffiles)), and you put them from your machine:

```bash
xcore files put ./levels/forest-3.json levels/forest-3.json --public --live   # served at https://<slug>.xgamesusercontent.com/levels/forest-3.json
xcore files ls levels/ --live
xcore files get replays/run-1.json --live --out run-1.json
xcore files rm levels/old.json --live                 # prints what it would delete, with a code, and deletes nothing
xcore files rm levels/old.json --live --yes <code>    # deletes it
xcore files usage --live
```

A public file is served from a site of its own, which the browser treats as a stranger to the game: it cannot use the
player's sign-in or call the game's `api/`, and anything that could carry a script (HTML, SVG, JavaScript) is a
download, never a page. The game's page may load its pictures, sounds and fonts and `fetch` its data. Players never
write here. Without `--live`, `xcore files` works on the files `xcore dev` gives the server, kept in
`.gamesfun/dev/files/` and served on a port of their own.

xgames.fun keeps one copy of a file and no earlier one, so a file written over or deleted there is gone for good. A
new path is put at once. `put --live` to a path xgames.fun has already, and `rm --live`, first print what would be
lost (the file there, its size and type) with a code, and change nothing; the same command with `--yes <code>` goes
on, and a code printed for another change is refused. `xcore files get <path> --live` keeps a copy first.

## login and logout

`xcore login` signs this computer in (your browser signs in to xgames.fun and hands it a publish token for 30 days;
xcore never sees your password). On the approval page you tick the games this computer may work on, or your whole
account, and `xcore login` says which it got (`login --status` says it again). A game you publish as new from that
sign-in is added to it; a command for any other game is refused with code `not-granted` ("your sign-in was not given
this game"): run `xcore login` again and tick it.

**Where the token is kept**: the macOS keychain; on Linux the Secret Service (`secret-tool`) when it runs, else a file
only you can read under `~/.config/gamesfun/secrets/`; on Windows a file encrypted for your user (DPAPI) under
`%APPDATA%\gamesfun\secrets\`. `GAMESFUN_CREDENTIALS=file` always uses the file. Without a browser (SSH, a
container), `xcore login --code` prints a link to open anywhere and asks for the code it shows.

`xcore logout` signs this computer out: the publish token is revoked at xgames.fun and forgotten here. Published games
stay published.

## publish

`xcore publish <folder>` builds the game, checks it (the page check on exactly the files built), and uploads its
published folder with its `server/` bundle:

1. **The files**: the published folder, without hidden files, `evidence/`, `node_modules/`, `server/`, `supabase/` and
   the makers' notes at its top (`README.md`, `NOTES.md`, `LAUNCH.md` and the like). A `.env` file or a link stops it.
   Two small records go up beside them, as xgames.fun keeps them with every version: `foundation.lock.json` (which tool
   published it) and `adaptation-plan.json` (the game's title and a one-line description). Like every published file,
   they can be read at the game's link.
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

Before any of that goes up, it needs the game's **preview picture** ([card](#card)): with none, or one xgames.fun cannot
use, publish stops and says what is wrong, until you make one (`xcore card`) or say it goes without (`--no-card`).

`publish --check` runs steps 1 to 4 above without publishing (and says whether the preview picture is there)
(`--check --verify` adds the check and remembers a pass), `--status` shows the link and the account, `--draft` saves a
private version, `--new` makes a new game with a new link. The limits a publish is held to are in
[HOSTING.md](HOSTING.md#limits).

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
      - run: npx -y @xgamesfun/xcore@<version> publish ./my-game
```

Commit the game's preview picture (`assets/card.jpg`, made once with `xcore card`): a publish without one stops, in a
job as anywhere.

## card

A link to the game shared on X, in a chat or anywhere that shows link previews gets a 960×960 card from xgames.fun: the
game's own picture as the background (scaled to cover the square), darkened a little at the top and bottom, with
"XGames.fun" and the game's title drawn large across the top band and a "Tap to play" button at the bottom left.
Without a picture the card is a plain dark gradient with the title, which is easy to scroll past.

- **The file**: `assets/card.jpg` (else `assets/card.png`) among the published files (for a brought game with a build,
  in what the build makes: `page.out`). `card.jpg` wins when both are there.
- **What xgames.fun can draw** (publish stops for anything else): a JPEG or PNG named for what it is (a PNG in
  `card.jpg`, or a JPEG in `card.png`, fails to draw: rename it), whole (not cut short; a PNG's image data is checked
  too), at most 1,500,000 bytes (it ignores a bigger one), and for a JPEG a baseline or progressive one (other kinds,
  such as lossless or arithmetic-coded, cannot be drawn: `xcore card <folder> --from <it> --force` makes one that can).
- **What looks right** (publish goes on, with a warning and the fix): square, 960×960, as drawn. A side under 600 px is
  scaled up and looks blurry; a picture far from square (the longer side over 1.25 times the shorter) is cropped to
  its middle, and `xcore card <folder> --from assets/card.jpg --force` does that crop here so you can see it. Keep the
  subject clear of the top third (the title) and the bottom left (the button).
- **`xcore card <folder>`** makes one: it serves the game as the page check does, opens it in Chrome at 960×960, waits
  4 seconds (`--wait <seconds>`), and saves a JPEG. `--tap` taps the middle once first (a game that starts on a tap),
  `--path <page?query>` opens another page of the game, and `--from <picture>` makes it from key art or a screenshot
  you have instead (scaled to cover and cropped to its middle; at most 40 MB). It never replaces an `assets/card.jpg`,
  or an `assets/card.png` xgames.fun can draw, without `--force` (and then says which file wins). For a game with a
  build it writes into the folder the build copies as it is (`page.static`, such as `public/`), so the build carries
  it into what is published; a build with no such folder is told where the picture has to live, and nothing is
  written. A page that answers an error makes no picture; one that throws or logs errors makes one, says so, and fails
  unless `--force`. Open the picture and look at it before you publish.
- **Publish asks for it**: with no picture, or one xgames.fun cannot draw, `xcore publish` stops before anything is
  uploaded, says what is wrong, and names the ways on (`--json`: `"code": "card"`, `"card"` what it found, `"next"`
  the command that fixes it). `--draft`, `--status` and `--check` do not stop for it (`--check --json` carries it in
  `card` and `cardWarnings`). `xcore publish --no-card` publishes without one (the link shows the plain card), and
  `"card": false` in `gamesfun.json` says so for good, so the game is not asked again.
- **After a publish** with a picture, xcore prints the card's address, `https://xgames.fun/play/<slug>/card.png`. A
  link shared before can keep its old card for a while: X and chat apps cache it.

## connect

With an agent, the skill in `skills/bring-your-own-game/` walks the same steps: `xcore connect` copies it
into Claude Code's and Codex's skills, adds the economy's tools (what `xcore loot connect` does: the `xsolana_*` MCP
tools and the `xsolana-economy` skill), and prints a few lines for a project's AGENTS.md. For other agents (Cursor,
Copilot, Gemini CLI and more), `npx skills add XGamesFun/xcore` installs the same skill.

## For scripts and agents: `--json` and exit codes

Every command takes `--json`. A failure is then also printed on stdout as
`{ "ok": false, "error", "code", "state", "next" }`: `code` is why (`usage`, `login`, `files`, `secrets`, `build`,
`card`, `size`…; `failed` when it has no word of its own), `next` the command that moves it on; `state` and `next` are
there when the failure has them. `check --json` and `adopt --json` print their whole report, with the same `ok`,
`error` and `code` in it when the check fails or the game is refused. A usage mistake (no such command or flag, a
missing argument) prints its usage on stderr and exits with 2; any other failure exits with 1. `xcore loot <command>
--json` hands on the economy tools' own JSON as it is. `login --status --json` and `publish --status --json` name the
sign-in's `state` (`signed-in`, `signed-out`, `expired`, or `unreadable` when the token is kept where this session
cannot read it, such as the Secret Service over SSH); `publish --status --json` also names the game's `link` (`never`,
`started`, `public`, `draft`, or `draft-over-public`); `adopt --json` gives `state` (`refused`, `fix`, `ready`) and
`next`.

## Environment variables

- `GAMESFUN_STUDIO=<origin>`: publishes to another xgames.fun (a Studio on your own machine while developing it).
- `GAMESFUN_CREDENTIALS=file`: always keeps the publish token in the file ([login and logout](#login-and-logout)).
- `XSOLANA_RPC_URL`: a Solana RPC of your own. In `.env`, for `xcore dev`'s `/loot/v1/rpc` and for going live
  ([ECONOMY.md](ECONOMY.md#going-live)); when set, the RPC a coin launch asks
  ([ECONOMY.md](ECONOMY.md#a-coin-that-trades-xcore-coin)); in `.dev.vars` or as a secret, the game's own RPC
  ([SERVER.md](SERVER.md#the-economys-own-rpc)).
- `GAMESFUN_SERVER_DEPS=<folder>`: a Miniflare installed elsewhere ([SERVER.md](SERVER.md#running-it-locally)).
- `XCORE_DEV_SIGNIN=wallet`: `xcore dev` signs local players in with a wallet only
  ([SERVER.md](SERVER.md#your-own-key-xcore-add-vouchers)).
- `GAMESFUN_DEBUG=1`: prints stack traces for errors.
