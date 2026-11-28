# The page client: `gamesfun.js`, Godot and Unity

xgames.fun signs players in with X or Google, for every game. It also stores each player's saves and the game's
leaderboards. A player can link a Solana wallet to their xgames.fun account; the wallet does not sign anyone in.

The page client is the code in your game that calls these services. `xcore add signin <folder>` installs it
(`xcore add database` and `xcore add multiplayer` install it too). This document lists every call, in JavaScript,
GDScript and C#. For the game's own server code, see [SERVER.md](SERVER.md).

- [Getting it: `xcore add signin`](#getting-it-xcore-add-signin)
- [Sign-in](#sign-in): where it happens, one sign-in for every place, what is stored
- [Calling the game's server: `GamesFun.api`](#calling-the-games-server-gamesfunapi)
- [Saves](#saves)
- [Leaderboards](#leaderboards)
- [Full screen](#full-screen)
- [A wallet app, for a claim](#a-wallet-app-for-a-claim)
- [Live settings: `GamesFun.live`](#live-settings-gamesfunlive)
- [The database: `GamesFun.db`](#the-database-gamesfundb)
- [Rooms: `xcore add multiplayer`](#rooms-xcore-add-multiplayer)
- [The economy: `GamesFun.loot` and `gf/loot/`](#the-economy-gamesfunloot-and-gfloot)

## Getting it: `xcore add signin`

`xcore add signin <folder>` installs the page client in the form your engine uses:

| Engine            | What it installs                                                                                        | Example call                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| A web game        | `gamesfun.js` next to the page (in the folder the build copies unchanged), loaded first in `index.html` | `await GamesFun.signIn()`, `GamesFun.saves.put('main', {...})`     |
| A Godot 4 project | `addons/gamesfun/gamesfun.gd`, autoloaded as `GamesFun`                                                 | `await GamesFun.sign_in()`, `await GamesFun.saves_put("main", {})` |
| A Unity project   | `Assets/Plugins/GamesFun/` (`GamesFun.jslib`, `GamesFun.cs`)                                            | `await GamesFun.SignIn()`, `await GamesFun.SavesPut("main", json)` |

`gamesfun.js` sets one global, `GamesFun`. Examples that start with `const gf = GamesFun;` use `gf` as a short name
for the same object, so `gf.db` and `GamesFun.db` are the same call.

All three have the same calls:

- sign in, sign out, and the current player;
- saves: any JSON, 64 KB each, 16 per player;
- leaderboards: submit, top scores, the player's own entry;
- the game's database (see below);
- the game's own server (`api`).

Return values:

- Saves, leaderboards, the database and `api` return `{data, error, status}`.
- `signIn()` returns the player, or `null` if nobody signed in.
- `signOut()` returns `null` (in Unity, the JSON text `"null"`).

No call throws. Where xgames.fun is not available, the game keeps running and the player plays as a guest.

**The player object** has `id`, `name`, `level`, `wallet`, `x` and `google`:

- `id` is the player's account: `x:<X id>`, or `g:<id>` for a Google account. It is different in every game, and it is
  never the wallet.
- `wallet` is the wallet linked to the account, or empty when there is none.

**Test sign-in with `xcore dev`.** Its `/game/` page works as the game does on its own link: a guest's saves stay in
the browser, and posting a score needs sign-in. Its `/play/` page shows the game in a frame, as xgames.fun's play page
does, and signs the player in from the page above. A plain local server and `xcore check` keep every save and score in
browser storage, signed in or not.

## Sign-in

### Where the sign-in comes from

#### In xgames.fun's play page

The play page (`xgames.fun/play/<name>`) shows the game in a frame. The play page signs the player in and passes the
game a token. The game sends no sign-in requests of its own. `GamesFun.ready` resolves once the play page has said who
is signed in (up to 1.5 s), so a signed-in player is already set when the game reads its save. A save read or written
before `ready` resolves waits for it, and so goes to the account of a player the page names.

#### On its own host, as the whole tab

The game's own host is `https://<name>-play.xgames.fun/`. A post's card on X opens the game there, and so does
xgames.fun's wallet hand-off inside a wallet app's browser. Here the game signs in by itself. A game that loads
`gamesfun.js` 1.9.0 or later needs no changes for this.

- **When the page loads**, the client asks xgames.fun who is signed in
  (`GET https://xgames.fun/api/player/v1/session?slug=<name>`, with xgames.fun's cookie).
  - If the player chose to sign in to this game in this browser (or arrived through a hand-off that carried that
    choice), they are signed in with no tap. `GamesFun.ready` resolves with the player (it waits up to 1.5 s for the
    answer). `GamesFun.player` and `GamesFun.token` (for the game's own server) are set, and `GamesFun.onChange`
    listeners are called, just as after a sign-in.
  - If xgames.fun names nobody, the game is signed out and the client makes no further requests.
  - Godot and Unity have no `ready` to await. Read `GamesFun.player` (Godot) or `GamesFun.Player` (Unity). The
    `player_changed` signal or the `PlayerChanged` event fires when the player is found, like `onChange`.
- **A tap on Sign in** (`GamesFun.signIn()` or `GamesFun.signIn('google')`) sends the game's tab to xgames.fun, then to
  X (or Google), then back to the page's address without its fragment
  (`https://xgames.fun/api/player/v1/x/begin?slug=<name>&back=<this page>`). This works the same on phones and
  computers: one tap, the provider's own screen, and the game again, signed in.
  - **The page reloads on the way back, so the game restarts and loses everything it held in memory.** Anything after
    a `#` in the address is also lost. The player is available when `GamesFun.ready` resolves (in Godot and Unity, when
    `player_changed` or `PlayerChanged` fires).
  - Call `signIn()` directly in the click handler, with no `await` or timer before it. xgames.fun continues straight
    to X only when the browser shows that the navigation came from the player's own tap.
  - If the game must not restart, ask it to stay on the page: `GamesFun.signIn({stay: true})`. For the whole page, set
    `globalThis.GAMESFUN_SIGNIN_STAY = true` before loading `gamesfun.js`, or add `data-signin-stay` to its `<script>`
    tag. The sign-in then opens a small window on xgames.fun instead.
- **A sign-in that ends with nobody signed in** (the player declined at X, or it failed) returns with
  `#gf-signin=cancelled` or `#gf-signin=failed` in the address. `gamesfun.js` removes it when the page loads and sets
  `GamesFun.signInEnded` to `'cancelled'` or `'failed'`. On phones where X's app handles the login and answers in
  another browser, the player returns to the game's tab and is signed in there.
- **A game that draws its own Sign in button as a link** gets the link's address from `GamesFun.signInLink('x')` (or
  `'google'`). It returns `''` where the tab cannot navigate (in a frame, in a game that stays on the page, and
  elsewhere). The link's own click handler calls `GamesFun.signIn({how: 'x', link: true})`. This call navigates
  nothing (the tap on the link does that); it marks the sign-in as the player's own. Never put `rel="noreferrer"` on
  the link.
- **Before the token's hour runs out**, the client renews it with no tap and nothing shown. `onChange` is called with
  the same player, and `GamesFun.token` holds the new token.
- **Request limits.** xgames.fun answers a limited number of these requests per session and game per hour. A tab
  therefore asks only when the page loads, shortly before its token expires, and when the player returns from a
  sign-in. It never asks on a timer, and never more than twelve times an hour. After a `429` answer it asks nothing
  until xgames.fun allows it again (`Retry-After`, or ten minutes).

#### In a frame other than the play page

Examples: X's timeline shows the game in a frame inside X's site; another site, or another xgames.fun page, embeds it.

- The game sends xgames.fun no request when it loads and keeps no sign-in. A frame is never signed in without a tap.
- A frame cannot navigate the tab, so the tap opens a small window on xgames.fun. The window goes on to X (or Google)
  by itself and closes when done.
- Where the frame does not allow windows, the game shows a code to type at xgames.fun/go (`window` is false).
- This sign-in lasts as long as the page. Reloading the frame signs the player out.

#### On the game's own domain, or a shared host

On a domain of the game's own, and on a host shared by several games, the sign-in also opens the small window.
xgames.fun is not asked who is signed in, because a custom domain is a different site from xgames.fun.

#### When no window can open

When a blocker stops the window on a page of its own, `gamesfun.js` draws a small panel over the game:

- one link, "Sign in with X", which the player's tap opens (browsers never block a tap on a link);
- behind "Sign in on another device", the code to type at xgames.fun/go.

The panel closes by itself once the player is signed in, wherever they did it. A second click on Sign in shows the
same sign-in again (its window or the panel); it never starts a new one.

The game is notified through `GamesFun.onCode(({code, site, url, window}) => …)`:

- When `window` is false, no window opened _and_ no panel was drawn. This happens in a frame on another site, or in a
  game that turned the panel off with `globalThis.GAMESFUN_SIGNIN_PANEL = false` or `data-signin-panel="off"`. Show
  the code clearly.
- When `window` is true, the sign-in window or panel is already on screen. Keep the game visible.
  If you show the code too, use a small line of text.

#### On your machine

On a plain local server or in `xcore check`, saves and scores stay in this browser.

Under `xcore dev`:

- a local sign-in (one player per tab) and the platform answer as xgames.fun does;
- the game's `server/` accepts its token;
- the dev server answers the three xgames.fun addresses above for this one game. Sign in sends the tab through the dev
  server's stand-in for X and back, as on the game's own host. `GamesFun.signIn({name: 'Ana'})` signs in a named dev
  player immediately.
- `/play/` shows the game framed as xgames.fun's play page frames it: the same sandbox, and a bar with Sign in and Sign
  out that stand in for the play page's own. Test there what the game does at `GamesFun.ready` and with its first save
  when the play page has already signed the player in.

### One sign-in for every place the game can be

```js
const gf = GamesFun;
const show = player => (player ? showPlayer(player.name) : showSignIn());
show(await gf.ready); // on its own host: the player xgames.fun names, or null
gf.onChange(show); // a sign-in, a sign-out, a renewed token
if (gf.signInEnded) note(gf.signInEnded === 'cancelled' ? 'Sign-in cancelled' : 'Sign-in failed, try again');
signInButton.onclick = () => gf.signIn(); // in the tap itself: on its own host the tab goes to X and back
signOutButton.onclick = () => gf.signOut(); // and xgames.fun is told to forget this game here
// gf.token goes to the game's own server: gf.api() sends it, env.GF.verifyPlayer checks it
```

Godot and Unity have no `ready`. Read `GamesFun.player` (Unity: `GamesFun.Player`) when the game starts, and listen to
`GamesFun.player_changed` (Unity: `GamesFun.PlayerChanged`) instead of `onChange`.

### What is stored, and where

**A reload keeps the sign-in.** Within the token's hour, the tab keeps the sign-in and asks nothing. This applies when
the game is the top window of its own host or its own domain, never in a frame. When the hour is up on a host where
xgames.fun is not asked (the game's own domain), the game is told the player is signed out.

**Sign-out persists.** `GamesFun.signOut()` signs the player out of the game and tells xgames.fun to forget the
sign-in for this game in this browser (`POST https://xgames.fun/api/player/v1/session/forget`). If that request gets no
answer, it is sent again on the next page load, until xgames.fun answers.

- After sign-out, xgames.fun names nobody to the game in that browser, and the browser stops asking, until the player
  taps Sign in again.
- Other tabs of the game sign out the next time they are viewed.
- The player's xgames.fun account stays signed in, and so do their other games. Signing out on xgames.fun's account
  page ends all of it.

**The token** lasts one hour. The tab keeps it in `sessionStorage` until then, and only when it is the top window of a
host that serves this one game (its xgames.fun link, its own domain, `xcore dev`). It is never stored on a host shared
by several games, and never in a frame. A game's own code can always read the token it was given; the token is never
stored where another game's page could read it.

**A newer sign-in client, where the host provides one.** `gamesfun.js` includes its own sign-in code. Under
`xcore dev`, when the page loads as the top window, it also requests a sign-in client from the dev server at
`/platform/v1/signin/v1.js` (the client of the `xcore` version that runs it). xgames.fun does not serve that address
yet, so on the game's own link and its own domain nothing is requested and the built-in client runs. A frame never
requests it. A host that does serve it can have the page ask for it there too: set
`globalThis.GAMESFUN_SIGNIN_SHARED = true` before loading `gamesfun.js`.

- If the hosted client arrives in time, it runs. If the address returns nothing, or not in time, the built-in client
  runs and the game behaves the same.
- `GamesFun.signInClient` reports which one runs: `{version, shared}`.
- It is one request, to the page's own origin only. It delays neither the page nor the game's start:
  `GamesFun.ready` waits for it for at most one second, and the Godot and Unity glue wait on `ready` before they
  report the player to the game.

### The token, for the game's server

The game's `server/` checks the token with `env.GF.verifyPlayer` first, before doing any work. A request without a
token gets `401` immediately, because requests from strangers that do work count toward the limits that cap a game.
See [SERVER.md](SERVER.md#check-the-token-first), "Check the token first", which also explains how a backend of your
own checks it. `gamesfun.js` and the Godot and Unity clients do not check tokens themselves.

## Calling the game's server: `GamesFun.api`

The page calls the game's own server with `GamesFun.api(path, init)` (Godot: `GamesFun.api(path, init)`; Unity:
`GamesFun.Api(path, initJson)`).

- `path` is relative to the game's `api/`: `'finish'` means `api/finish`, both at the published origin and under a
  folder.
- `init` is the same as `fetch`'s. An object `body` is sent as JSON.
- A signed-in player's token is sent as `Authorization: Bearer …`. The server checks it with `env.GF.verifyPlayer`
  before trusting who is asking.
- It returns `{data, error, status}`, like every other call.

## Saves

Each player gets up to 16 named saves, up to 64 KB of JSON each.

```js
const { error } = await GamesFun.saves.put('main', { level: 3 });
if (error) console.warn(error);
const { data: save } = await GamesFun.saves.get('main');
```

A missing save returns `data: null`. Use `GamesFun.saves.list()` to list keys or `GamesFun.saves.delete('main')`
to remove one.

**Signed in**, saves are kept in the player's account and follow them to any browser.

**Guests** (nobody signed in) save in their browser, with the same limits, and `put` returns `{ok: true, guest:
true}`. A guest keeps their progress without signing in, but only in that browser: another device, or clearing site
data, loses it. Saves are written by the player's own page, so a server that pays out never trusts one.

- **Inside a post on X** the game is a frame under x.com, and the browser keeps that frame's storage apart from the
  game's own link. A guest who plays in the post and then opens the game's link, in the same browser, starts from
  nothing there. Signing in keeps progress in both.
- **Where the browser keeps nothing** (storage blocked, as in a frame on another site with third-party storage off, or
  full), a guest's `put` returns `code: 'no-storage'` (status 0) and an error, not `ok`. `saves.guest.kept()` says
  ahead of time whether this browser keeps a guest's saves. Ask the player to sign in to keep their progress.

Each game chooses what guests get:

- **No guest saves:** add `data-guest-saves="off"` to the `<script>` tag, set `GamesFun.saves.guests = false`, or set
  `globalThis.GAMESFUN_GUEST_SAVES = false` before loading `gamesfun.js`. A guest's save then returns `Sign in first.`
  (status 401).
- **At sign-in:** guest saves stay in the browser until the game moves them. `saves.guest.list()` and
  `saves.guest.get(key)` read them, `saves.guest.move(key)` copies one into the account (replacing a save with the
  same key) and removes it from the browser, and `saves.guest.delete(key)` drops it. The game can carry everything
  over, keep the better save, ask the player, or start fresh. Godot: `saves_guest_list`, `saves_guest_get`,
  `saves_guest_move`, `saves_guest_delete`. Unity: `SavesGuestList`, `SavesGuestGet`, `SavesGuestMove`,
  `SavesGuestDelete`.

```js
GamesFun.onChange(async player => {
  if (!player) return;
  const { data: kept } = await GamesFun.saves.guest.list();
  for (const { key } of kept) {
    // carry guest progress over, but never over the account's own save of that key
    const { status } = await GamesFun.saves.get(key);
    if (status === 404) await GamesFun.saves.guest.move(key);
  }
});
```

`move` replaces the account's save of the same key, so check first, as above: a player who played signed in on
another device, or in xgames.fun's play page, may already have progress there.

## Leaderboards

Sign in to post a score. The first submission creates the board and ranks higher scores first. Guests can read the top 100.

```js
const { data: result } = await GamesFun.scores.submit('best', score);
const { data: leaders } = await GamesFun.scores.top('best', { limit: 10 });
```

`result` includes the player's best score and rank. Use `GamesFun.scores.mine('best')` to look them up later.
Each entry in `leaders` has a game-specific player ID. The signed-in player's entry has `me: true`.

Players can submit any score from their browser. For verified scores, have your server create the board with
`env.GF.scores.setup('ranked', { writer: 'server' })` and check each run before submitting it.
Page submissions to that board return HTTP 403 (`server-only`). For fastest-time boards, set `order: 'low'` on the server.
[Server API](SERVER.md#envgf-the-platform) · [Plan limits](COMMANDS.md#the-plans-limits-refused-as-published)

## Full screen

Most players first see a game in a post on X or on a phone, in a small frame. `xcore adopt` warns when a game has no way
to go full screen.

Add a button that calls `GamesFun.fullscreen()` from its click handler (Godot: `await GamesFun.fullscreen()`; Unity:
`Screen.fullScreen`). It works wherever the game runs:

| Where the game runs                                            | What happens                                                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| xgames.fun's play page                                         | the page around the game goes full screen (or fills an in-app browser's screen, including X's) |
| its own link                                                   | the browser goes full screen                                                                   |
| a frame that allows no full screen (a post on X on a computer) | the game opens in its own tab                                                                  |

It returns `{on, how: 'page' | 'browser' | 'tab' | 'none'}`. `none` means full screen is not available (Safari on
iPhone has no full screen for web pages). Pressing the button again exits full screen. `GamesFun.onFullscreen(on => …)`
reports every change.

## A wallet app, for a claim

A player who opens a game from a post in X's app is in X's built-in browser, which has no wallet. The game can reopen
in a wallet app's browser (Phantom or Solflare), or in the player's own browser, already signed in. This works from
the two places a player meets the game:

- **Inside xgames.fun's play page** (`xgames.fun/play/<name>`): the play page opens the app when asked.
- **On its own host, as the whole tab** (`https://<name>-play.xgames.fun/`, where a post's card on X opens the game):
  the tab goes to xgames.fun's wallet page
  (`https://xgames.fun/wallet/open?slug=<name>&app=<app>&back=<this page>`). That page opens the app or shows its
  links, and the wallet's browser returns to this page, signed in.

In any other frame (X's timeline showing the game inside X's site, or another site embedding it), the frame cannot
navigate the tab. Nothing opens, and the game shows its own fallback.

Three calls, the same in both places:

- **`GamesFun.canOpenWallet()`** returns:
  - `true`: there is no wallet in this browser, and the game can be opened in one;
  - `false`: a wallet is available here;
  - `null`: unknown. This happens in a frame other than the play page, with an older play page, or on the game's own
    host before the wallet check has finished.

  On its own host, the wallet check is done by loot's page client (`gf/loot/wallets.js`, as `gf.loot.ready()` asks
  it). It checks once more about 1.5 s after it starts, because a wallet can register late. The first of these three
  calls starts it. A game without `gf/loot/` gets `null` there. `GamesFun.onCanOpenWallet(can => …)` reports each
  change.

- **`GamesFun.walletNeeded()`**: call it when the Claim button appears.
  - In the play page, the page prepares so that the later tap opens the app immediately. It is told once per page
    load. Returns `{data: {told: true}}`.
  - On its own host there is no play page to tell; the call starts the wallet check. Returns `{data: {told: false}}`.
  - In any other frame: `code: 'no-page'`.

- **`GamesFun.openWallet(app = 'phantom', {view, href} = {})`**: `app` is `'phantom'`, `'solflare'` or `'browser'`.
  - In the play page: with no `view`, it opens the play page as it is. With `'claim'` and `href` (an address of this
    game's own play page, `https://xgames.fun/play/<name>?…`), it opens that address. With `'wallet'`, it opens
    xgames.fun's page for adding a wallet. Returns `{data: {asked: true}}`, or `code: 'not-offered'` when
    `canOpenWallet()` is not `true` there.
  - On its own host: the tab goes to the wallet page, and it returns `{data: {asked: true, left: true}}` (the page is
    leaving). The return address is this page's address without its fragment, or `href` with `'claim'` when that
    address is on the same host.
  - Errors, with nothing opened: `code: 'invalid'` (a bad argument) and `'no-page'` (any other frame).

**Call `openWallet` directly in the player's tap handler**, with no `await` or timer before it. The message (or the
tab's navigation) happens inside the call, and browsers open an app only from a tap. One Claim button that works in
both places:

```js
const gf = GamesFun; // walletHere: (await gf.loot.ready()).data.wallets.length > 0, asked before
gf.walletNeeded(); // when the Claim button shows (on its own host it starts the look for a wallet)
claimButton.onclick = () => {
  if (walletHere) return claim(); // a wallet in this browser: the game's own claim
  if (gf.canOpenWallet() === true) {
    gf.openWallet('phantom', { view: 'claim', href: claimLink }); // no await before this line
    return showNote('Opening your wallet app…');
  }
  copyLink(); // no wallet and no way to open one here: the game's own fallback
};
```

`gamesfun.js` does not build wallet app links itself; xgames.fun's pages do. Under `xcore dev` and on your machine
there is no play page and no xgames.fun, so `canOpenWallet()` is `null` and `openWallet` returns `no-page`. Test the
fallback locally, and the wallet app on xgames.fun.

## Live settings: `GamesFun.live`

Announcements, remote config and maintenance mode, without republishing. On xgames.fun/console, a game's **Live** tab
sets three things. xgames.fun's play edge serves them from one cached record per game:

- **Players who open the game** get a change within about 35 seconds.
- **Players already in the game** get it when `gamesfun.js` asks again: about a minute later when the game listens
  with `GamesFun.live.onChange`, and up to about five and a half minutes later when only the banner asks (every five
  minutes, plus the caches). `GamesFun.live.refresh()` asks at once. A pause shows sooner: the game's next call to
  its server, saves or leaderboards answers `maintenance`, and the banner says so.

- **Announcement**: a short line of plain text (up to 280 characters), `info` or `warning`, with an optional start and
  end time.
- **Remote config**: a small JSON object (up to 8 KB) the game reads at run time, such as a difficulty or an event
  switch. The console keeps the last 10 versions and can revert with one click.
- **Maintenance**: pauses the game with a message.
  - Players who open the game get a plain holding page from xgames.fun instead.
  - The server's `api/*` (WebSockets included) and the page's saves and leaderboards return `503` with code
    `maintenance`. The server's code does not run.
  - Turning it off brings the game back within about 35 seconds (up to a minute) for players who open it.
  - Anything already running (an open WebSocket, an alarm) is not stopped.

`gamesfun.js` reads them (since 1.5.0):

```js
const { data: live } = await GamesFun.live.get(); // {announcement, config, version, maintenance}
const hard = live.config.difficulty === 'hard';
GamesFun.live.onChange(live => applyEvent(live.config.event)); // asked again every minute while the page is in view
await GamesFun.live.refresh(); // ask now
```

- `get()` returns the cached value if it is less than a minute old; otherwise it fetches. Like every call, it returns
  `{data, error, status}` and never throws. If xgames.fun is unreachable, it returns the last value, or nothing live.
- `announcement` is `null` outside its start and end times.
- `config` is `{}` when none is set.
- `maintenance` is `null` or `{message, since}`.

**The banner.** By default, `gamesfun.js` shows:

- the announcement, in a small closable bar at the top of the page (each announcement until the player closes it);
- a pause that starts while the game is open (any call that returns `maintenance` shows it immediately).

To show them your own way, turn the banner off with one of:

- `data-live-banner="off"` on `<script src="gamesfun.js">`;
- `globalThis.GAMESFUN_LIVE_BANNER = false` before it loads;
- `GamesFun.live.banner(false)` before the page has loaded.

Without the banner and without `onChange`, nothing is fetched until the game calls `get()`.

**On your machine**, nothing is live on a plain local server. Under `xcore dev`, `.gamesfun/live.json` stands in for the
console. It is read again on every request:

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

- `"maintenance": {"message": "Back at 7pm"}` (or `true`) pauses the game as hosted.
- Times are milliseconds or ISO text.
- Values the console would refuse (a config over 8 KB or not an object, an announcement over 280 characters) are
  reported in the terminal.
- Godot and Unity can reach `gf.live` only through their JavaScript bridge for now.

What maintenance does to the game's server is described in [SERVER.md](SERVER.md#publishing-it).

## The database: `GamesFun.db`

`xcore add database <folder>` adds sign-in and a database that belongs to the game: **one D1 database** (SQLite) per
game. xgames.fun creates it on the first publish and keeps it between publishes. There is nothing to sign up for and no
keys.

- `gamesfun.json` → `database` declares it.
- Its tables come from the migrations in `server/migrations/` (`0001_init.sql`, then `0002_….sql`). Migrations are
  append-only; publish applies them before the new version goes live.
- The server side, the rules and `xcore db` are described in [SERVER.md](SERVER.md#the-games-database).

What you get depends on whether the game has its own server:

- **With a server of its own**, the game gets an example first migration and `server/gf-db.js`, which provides:
  - prepared queries: `db(env).first('SELECT gold FROM players WHERE id = ?', sub)`;
  - `withPlayer(request, env)`: the signed-in player's ID.

  A rule that must hold under a burst of requests should be a single statement:
  `UPDATE players SET runs = runs - 1 WHERE id = ? AND runs > 0 RETURNING runs`.

- **With no server**, the game gets xcore's stock server. It stores the page's documents (any JSON up to 64 KB) in
  collections, under the rules in `database.collections`. If the game later gets a server of its own
  (`xcore add multiplayer`, `rpc`, `vouchers`), `server/gf-docs.js` keeps serving the same documents under the same
  rules. Publish refuses a server that has `collections` but does not route `api/db/`.

The page's documents:

```js
const level = (await GamesFun.db.add('levels', { name: 'Moon', tiles })).data; // {id, owner, value, updatedAt}
await GamesFun.db.put('levels', level.id, { name: 'Moon 2', tiles });
const page = await GamesFun.db.list('levels'); // page.data: the newest 50; page.after: the next page's place
const next = await GamesFun.db.list('levels', { after: page.after }); // page.after is null on the last page
```

**Each player has their own space** in every collection. A document is identified by its collection, its owner and its
ID. Two players can both have a document called `main`, and nobody can take an ID in another player's space.

- By default, a signed-in player reads and writes only their own documents.
- `{"read": "anyone"}` in `database.collections` lets everyone read a collection. Read another player's document by
  its owner with `GamesFun.db.get('levels', id, { owner: playerId })`, and their list with `{ owner: playerId }`.
- `{"write": "server"}` is for data that players must not set themselves. The page reads it without naming an owner,
  and gets the server's document, or the player's own document that the server wrote for them.
- Lists are paged with `after`. `offset` is refused with an explanation.
- Lists are ordered by when each document was last written, so a document written between two page requests can
  appear twice or be skipped.

On a plain local server, the page keeps documents in the browser. Under `xcore dev`, the database is a local D1 in
`.gamesfun/dev/d1/` with the same migrations.

Database calls count toward the game server's requests: a per-minute limit per player and per game, set by its plan
([HOSTING.md](HOSTING.md#plans-xcore-plan)). Read and write when something happens, not on every frame.

A game whose `server/database.js` was written by xcore 0.1.0 (a Durable Object, the older approach) keeps it, and it
keeps working. See [UPGRADING.md](UPGRADING.md).

## Rooms: `xcore add multiplayer`

`xcore add multiplayer <folder>` adds sign-in and rooms that belong to the game. The room server is
`server/rooms.js`, one Durable Object per room. Publish deploys it to xgames.fun with the game, at the game's own
`api/rooms/<CODE>`.

A room is a relay with a host:

- The first player in is the host (ID 1, like Godot's server). Every other player gets their own ID.
- A message goes to one player, to everyone else, or to everyone but one.
- The room never reads messages. The host's game decides what happens.
- When the host leaves, the player who joined next becomes the host. (A Godot game instead sees its server leave,
  `server_disconnected`, as it would over ENet.)

Per engine:

- **Godot 4**: `multiplayer.multiplayer_peer = await GamesFun.join_room(code)`, instead of an `ENetMultiplayerPeer`.
  RPCs, `MultiplayerSpawner` and `MultiplayerSynchronizer` work unchanged (all reliable and ordered). In the editor,
  the same call creates a local ENet game, for Run Multiple Instances.
- **Unity**: `var room = await GamesFun.JoinRoom(code)`, then `room.Send(json, to)`, `room.SendBytes(bytes, to)`,
  `OnMessage`, `OnBytes`, `OnJoin`, `OnLeave`, `OnHost`.
- **Web**: `const { data: room } = await GamesFun.rooms.join(code)`, then `room.send(data, to)`,
  `room.sendBytes(bytes, to)`, `room.on('message', …)`.

Room codes and links:

- A room code is 4 to 8 letters and digits. `rooms.code()` makes one.
- By default, the first player to use a code opens the room, and anyone after joins it. A Host button passes
  `host: true` (refused when someone is already in the room). A Join button passes `host: false` (refused when the room
  is empty, just as joining an address nobody serves fails over ENet).
- `rooms.link(code)` returns the link to share: `https://xgames.fun/play/<slug>?room=<CODE>`. It opens the game in that
  room, on xgames.fun and inside a post on X (the post's card frames the room). `rooms.fromLink()` reads it back.

Settings and limits:

- `ROOM` at the top of `server/rooms.js` sets the maximum number of players (16), whether only signed-in players may
  join (their xgames.fun ID and X handle come with them), and the message limits.
- The default message limit is 120 messages per second per player. Messages over the limit are dropped, and the game
  is notified through the room's `error` event (Godot: `room_error` signal; Unity: `OnError`).
- The page client sends each frame's messages as one, so a game at any frame rate sends at most about 60 a second, no
  matter how many objects it syncs.
- A player's connection counts once toward the game server's requests (its plan's limits:
  [HOSTING.md](HOSTING.md#plans-xcore-plan)), however many messages it carries.

**Porting a Godot game from ENet:**

- `create_server` / `create_client` become `join_room` (with `host: true` / `false` for Host and Join buttons).
- A variable typed `ENetMultiplayerPeer` becomes `MultiplayerPeer`.
- `create_server`'s `max_clients` becomes `ROOM.maxPlayers` (for every room of the game).
- A packet sent unreliable arrives reliable.
- The peer leaves its room on `peer.close()`, or when nothing references it any more.
- The host's game relays every client's packets to the others, as Godot's server does over ENet.

On your machine, tabs of the same browser share a room, so two tabs can play together before the game is published.
Under `xcore dev`, they play through the real room server, as on xgames.fun.

A netcode library with its own server (Netcode for GameObjects, Mirror, a Node server) does not run on xgames.fun
as-is. Move its game logic into the host's game, or run its server on a host of your own
([HOSTING.md](HOSTING.md#a-backend)).

**When the host must not decide.** In a room, the host's game is the referee, and the host's player can read anything
their page holds. That is fine for most games played with friends. It is not fine for a hidden role or word (the host
would see the Impostor), or for a result that pays tokens or prizes (the host could declare any winner).

Such a game keeps the match in a Durable Object of its own, as a Node or Socket.IO server would:

- the room's state, the hidden parts and the result live there;
- players send their moves over a WebSocket;
- it sends each player only what that player may see.

See [SERVER.md](SERVER.md#a-room-over-a-websocket), "A room over a WebSocket". This Durable Object sits next to
`server/rooms.js` (or replaces it). The server that decided the result is the one that pays it: `env.GF.loot.report`
for prizes by place, or a voucher signed with the game's own key (`xcore add vouchers`).

## The economy: `GamesFun.loot` and `gf/loot/`

`xcore loot add` (or `xcore dev`, once `xsolana.json` is there) installs the client beside `xsolana.json`. Publish keeps
`gf/loot/` up to date.

The economy's code is the solana kit's (`@xgamesfun/solana`): its play client is what `gf/loot/` holds, and its
README and apps.md document every call. `GamesFun.loot` sets it up for this game (the economy's file, its cluster,
the wallet, xgames.fun's relay, and the player's sign-in that mainnet's relay needs), so a page does not wire it by
hand. A web page then uses the kit directly; an engine reaches the same calls as JSON.

### A web page: the solana kit, from `GamesFun.loot.app()`

`app()` gives the kit's own app, set up for this game. Before `connect()` it only reads; call `app()` again after
connecting to sign with the wallet. Its calls and answers are the kit's own (`shop()` returns an array), as
`@xgamesfun/solana`'s README and apps.md document them.

```js
let { data, error } = await GamesFun.loot.app();
if (error) throw new Error(error); // for example, the economy is not live yet
const shop = await data.app.shop();
await GamesFun.loot.connect();
({ data } = await GamesFun.loot.app()); // now it signs with the wallet
await data.app.recover(); // finish purchases a closed page left
// When the player chooses a listing, show its price before calling buy.
await data.app.buy('potion', { listing: shop.find(l => l.key === 'potion') });
const boxes = await data.app.boxes();
await data.app.openBox('crate', { listing: boxes.find(l => l.key === 'crate') }); // one prompt
```

`data` also holds `kit` (the play module: `walletStandardSigner`, readers and builders), `wallets` and `cluster`. Use
these instead of the kit examples' public devnet RPC and `node_modules/` paths.

### From Godot, Unity or JSON: `GamesFun.loot.call`

The same calls with JSON in and out (big numbers as text). Sign in to the game first on mainnet.

```js
await GamesFun.loot.connect();
await GamesFun.loot.call('recover');
const { data: items, error } = await GamesFun.loot.call('shop');
if (error) throw new Error(error);
const buy = item => GamesFun.loot.call('buy', item.key, { listing: item });
```

Use `GamesFun.loot.ready()` to list available wallets. Call `GamesFun.loot.link()` when your server needs proof
that the signed-in player owns the connected wallet.

- Godot: `await GamesFun.loot_ready()`, `loot_connect()`, `loot_link()`, `loot_call("shop")`,
  `loot_call("buy", ["sword", {"listing": item}])`.
- Unity: `GamesFun.LootReady()`, `LootConnect()`, `LootLink()`, `LootCall("shop")`,
  `LootCall("buy", "\"sword\", {\"listing\": …}")`.

In a Godot or Unity project, `xcore loot add` keeps `xsolana.json` and `gf/loot/` out of the engine's export. They go
in the project's own `gamesfun/` folder (with a `.gdignore`, so Godot ignores it), set as `gamesfun.json` →
`page.static`. Publish, `xcore check` and `xcore dev` copy that folder over the export, so you export as before. The
file that records the addresses the economy went live at stays in the project: keep it in git.

### Without `gamesfun.js`: `gf/loot/` by hand

Only for a page that does not load `gamesfun.js`. The page loads loot's page client at run time with a page-relative URL, so a bundler leaves it alone:

```js
const { solanaApp, walletStandardSigner } = await import(
  /* @vite-ignore */ new URL('gf/loot/play/index.js', document.baseURI).href
);
const { solanaWallets, connectWallet, PAGE_RPC } = await import(
  /* @vite-ignore */ new URL('gf/loot/wallets.js', document.baseURI).href
);
const spec = await (await fetch('xsolana.json')).json();
```

`solanaApp` takes `rpcUrl: PAGE_RPC`, the page's own `/loot/v1/rpc`. `gf/loot/wallets.js` connects to the player's
wallet through the Wallet Standard, with no package to install. Each call targets devnet unless you pass the
economy's cluster:

| Export                                                | Description                                                                                                                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `solanaWallets({ waitMs = 300, cluster = 'devnet' })` | → the wallets in this browser that can sign Solana transactions on that cluster (an empty list when there are none: tell the player, and keep the game playable) |
| `connectWallet(wallet, { cluster = 'devnet' })`       | → the player's account on that cluster. The wallet shows its own prompt; it throws if the player declines                                                        |
| `PAGE_RPC`                                            | the page's own `/loot/v1/rpc` (xgames.fun's relay once published), for devnet                                                                                    |
| `pageRpc(cluster)`                                    | the same relay for an economy on `cluster`: `PAGE_RPC` on devnet, `PAGE_RPC` with `?cluster=mainnet` on mainnet                                                  |
| `chainOf(cluster)`                                    | the cluster's name as a wallet expects it: `'solana:devnet'` or `'solana:mainnet'`                                                                               |

`walletStandardSigner(wallet, account)` from `gf/loot/play/index.js` turns them into the signer `solanaApp` takes.

**An economy on mainnet** (`"network": "mainnet"` in `xsolana.json`) must name its cluster in every one of those calls:
`solanaWallets({ cluster: 'mainnet' })`, `connectWallet(wallet, { cluster: 'mainnet' })`,
`walletStandardSigner(wallet, account, chainOf('mainnet'))`, and `pageRpc('mainnet')` instead of `PAGE_RPC`. The
mainnet relay answers only players signed in to the game, so every call to it must also carry the player's sign-in.
`GamesFun.loot.app()` handles the network and sign-in token for you.

`@xgamesfun/solana`'s own examples use a public devnet RPC and `node_modules/` paths. On xgames.fun, use `PAGE_RPC` and
`gf/loot/` as shown above.
