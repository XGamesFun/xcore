# The page client: `gamesfun.js`, Godot and Unity

xgames.fun signs players in (with X first, or a Solana wallet) for every game, and keeps each player's saves and the
game's leaderboards. `xcore add signin <folder>` gives the game the page client that reaches them (`xcore add database`
and `xcore add multiplayer` bring it too). This page is every call it has, in JavaScript, GDScript and C#. The game's
own server code is [SERVER.md](SERVER.md).

- [Getting it: `xcore add signin`](#getting-it-xcore-add-signin)
- [Sign-in](#sign-in): where it comes from, one sign-in for every place, what is kept
- [Calling the game's server: `GamesFun.api`](#calling-the-games-server-gamesfunapi)
- [Leaderboards](#leaderboards)
- [Full screen](#full-screen)
- [A wallet app, for a claim](#a-wallet-app-for-a-claim)
- [Live settings: `gf.live`](#live-settings-gflive)
- [The database: `GamesFun.db`](#the-database-gamesfundb)
- [Rooms: `xcore add multiplayer`](#rooms-xcore-add-multiplayer)
- [The economy: `GamesFun.loot` and `gf/loot/`](#the-economy-gamesfunloot-and-gfloot)

## Getting it: `xcore add signin`

`xcore add signin <folder>` gives the game the page client in the shape its engine takes:

| The game          | What it gets                                                                                        | From its code                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| A web game        | `gamesfun.js` beside the page (in the folder a build copies as it is), loaded first in `index.html` | `await GamesFun.signIn()`, `GamesFun.saves.put('main', {...})`     |
| A Godot 4 project | `addons/gamesfun/gamesfun.gd`, autoloaded as `GamesFun`                                             | `await GamesFun.sign_in()`, `await GamesFun.saves_put("main", {})` |
| A Unity project   | `Assets/Plugins/GamesFun/` (`GamesFun.jslib`, `GamesFun.cs`)                                        | `await GamesFun.SignIn()`, `await GamesFun.SavesPut("main", json)` |

The same calls everywhere: sign in and out, the player, saves (any JSON, 64 KB each, 16 a player), leaderboards
(submit, top, the player's own), the game's database (below) and its own server (`api`). Saves, leaderboards, the
database and `api` answer `{data, error, status}`; `signIn()` answers the player, or null for nobody, and `signOut()`
answers null (in Unity, JSON text: `"null"`). None throws, so a game plays on as a guest wherever xgames.fun is not
there.

**The player** has `id`, `name`, `level`, `wallet` and `x`. `id` is the player's account, `x:<X id>` or for a Google
account `g:<id>`, an id different in every game, and never the wallet. The wallet is `wallet`, empty when the account
has none.

Under `xcore dev` the client uses the dev host's sign-in, saves and leaderboards; on a plain local server it stands in
with this browser's storage ([COMMANDS.md](COMMANDS.md#dev)).

## Sign-in

### Where the sign-in comes from

- **In xgames.fun's play page** (`xgames.fun/play/<name>`, which frames the game), the page signs the player in and
  hands the game a token. The game asks xgames.fun nothing of its own there.
- **On its own host, as the whole tab** (`https://<name>-play.xgames.fun/`: a post's card on X opens the game there,
  and so does xgames.fun's wallet hand-off, inside a wallet app's browser), the game signs in by itself, and a game
  that loads `gamesfun.js` 1.9.0 needs no change for it:
  - **As the page loads** it asks xgames.fun who is here (`GET https://xgames.fun/api/player/v1/session?slug=<name>`,
    with xgames.fun's cookie). A player who chose to sign in to this game in this browser (or arrived by a hand-off
    that carried that choice) is signed in with no tap: `GamesFun.ready` answers with them (it waits for the answer,
    1.5 s at most), `GamesFun.player` and `GamesFun.token` (for the game's own server) are set, and
    `GamesFun.onChange` is told, exactly as after a sign-in. When xgames.fun names nobody, the game is signed out and
    nothing more is asked. Godot and Unity have no `ready` to await: the player is `GamesFun.player` (Godot) or
    `GamesFun.Player` (Unity), and the `player_changed` signal or the `PlayerChanged` event says when they are found,
    as `onChange` does.
  - **The tap on Sign in** (`GamesFun.signIn()`, `GamesFun.signIn('google')`) takes the game's own tab to xgames.fun,
    on to X (or Google) and back to this page's address without its fragment
    (`https://xgames.fun/api/player/v1/x/begin?slug=<name>&back=<this page>`), on a phone and a computer alike: one
    tap, the provider's own screen, and the game again, signed in. The page loads afresh on the way back, so **the
    game starts again and what it held in memory is gone** (and so is anything after a `#` in its address); the player
    is there when `GamesFun.ready` answers (in Godot and Unity, when `player_changed` or `PlayerChanged` comes). Call it
    in the click handler itself, with no `await` or timer before it: xgames.fun goes straight on to X only when the
    browser shows the move was the player's own tap. A game that must not start again asks to stay,
    `GamesFun.signIn({stay: true})` (or for the whole page, `globalThis.GAMESFUN_SIGNIN_STAY = true` before
    `gamesfun.js`, or `data-signin-stay` on its `<script>`), and gets a small window on xgames.fun instead.
  - **A sign-in that ends with nobody** (the player said no at X, or it failed) comes back with `#gf-signin=cancelled`
    or `#gf-signin=failed` in the address: `gamesfun.js` takes it out as the page loads and sets
    `GamesFun.signInEnded` to `'cancelled'` or `'failed'`. Where a phone hands the login to X's app and the app answers
    in another browser, the player comes back to the game's tab and is signed in there.
  - **A game that draws its own Sign in button as a link** gets the real link's address from
    `GamesFun.signInLink('x')` (or `'google'`), `''` where the tab cannot go (framed, a game that stays, elsewhere); the
    link's own click calls `GamesFun.signIn({how: 'x', link: true})`, which moves nothing (the tap on the link does)
    and marks the sign-in as the player's own. Never `rel="noreferrer"` on it.
  - **Before the token's hour ends** it is asked again, with no tap and nothing shown (`onChange` is told the same
    player again, with the new token in `GamesFun.token`).
  - **No more questions than xgames.fun allows.** It answers a number of them a session and game an hour, so a tab asks
    only as the page loads, shortly before its token ends and when the player is back from a sign-in, never on a timer
    and never more than twelve times an hour; after an answer of `429` it asks nothing until xgames.fun allows again
    (`Retry-After`, or ten minutes).
- **Framed by anything that is not the play page** (X's timeline shows the game in a frame inside X's own site; another
  site, or another page of xgames.fun's, embeds it), the game asks xgames.fun nothing as it loads and keeps no
  sign-in: a frame is never signed in with no tap. A frame cannot move the tab either, so the tap opens a small window
  on xgames.fun, which goes on to X (or Google) by itself and closes when it is done, and where the frame lets no
  window open, the code to type at xgames.fun/go, which the game shows (`window` is false). That sign-in lasts as long
  as the page: a reload of the frame is signed out.
- **On a domain of the game's own**, and on a host games share, the sign-in opens the small window too, and
  xgames.fun is not asked who is here (a domain of the game's own is another site than xgames.fun).
- **Where no window opens** on a page of its own (a blocker), `gamesfun.js` draws a small panel of its own over the
  game: one link, "Sign in with X", which the player's tap opens (a browser never blocks a tap on a link), and behind
  "Sign in on another device" the code to type at xgames.fun/go. It closes by itself once the player is signed in,
  wherever they did it. A second click on Sign in shows the same sign-in again (its window, or the panel), never a new
  one. The game is told with `GamesFun.onCode(({code, site, url, window}) => …)`: show the code plainly only when
  `window` is false, which means that no window opened _and_ no panel was drawn (a frame on another site, or a game
  that turned the panel off with `globalThis.GAMESFUN_SIGNIN_PANEL = false` or `data-signin-panel="off"`). When
  `window` is true the player has a way to sign in on screen (X's login takes a while, and its page hides from the game
  whether that window is still open), so show the code at most as a quiet line, never over the game.
- **On this machine** (localhost, `xcore check`), a local player and the browser's own storage stand in, so the game
  can be made and tested before it is published. Under `xcore dev`, a local sign-in (one player a tab) and the
  platform answer as xgames.fun does, the game's `server/` accepts its token, and the dev host answers the three
  addresses above for this one game: Sign in takes the tab round its stand-in for X and back, as on the game's own
  host (`GamesFun.signIn({name: 'Ana'})` signs a named dev player in at once).

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

In Godot and Unity, which have no `ready`, the same is reading `GamesFun.player` (Unity `GamesFun.Player`) as the game
starts and following `GamesFun.player_changed` (Unity `GamesFun.PlayerChanged`) in place of `onChange`.

### What is kept, and where

**A reload keeps the sign-in.** Inside the token's hour the tab keeps it, as the top window of the game's own host or
its own domain (never in a frame), and asks nothing; when the hour is up where xgames.fun is not asked (a domain of the
game's own), the game is told the player is signed out.

**Sign out sticks.** `GamesFun.signOut()` signs the player out of the game and tells xgames.fun to forget it here
(`POST https://xgames.fun/api/player/v1/session/forget`; a forget that gets no answer is posted again as the next page
loads, until xgames.fun answers it): after it xgames.fun names nobody to the game in that browser, and the browser
itself asks no more, until they tap Sign in again (other tabs of the game sign out when they are next looked at). Their
xgames.fun account stays signed in, and so do their other games; signing out on xgames.fun's account page ends all of
it.

**The token** lasts an hour. The tab keeps it until then (`sessionStorage`), and only as the top window of a host that
serves this one game (its xgames.fun link, its own domain, `xcore dev`): never where games share a host, and never in a
frame. A game's own code could always read the token it was handed; nothing is kept where another game's page could.

**A newer sign-in client, where the host serves one.** `gamesfun.js` carries its sign-in, and as the page loads in the
top window it also asks its own host for a sign-in client at one address, `/platform/v1/signin/v1.js` (`xcore dev`
answers it with the client of the `xcore` that runs it); a frame does not ask for it, and runs the carried one. When a
client comes there in time, it runs; where the address answers nothing, or not in time, the carried one runs and the
game behaves the same. `GamesFun.signInClient` says which: `{version, shared}`. It is one request, to the page's own
origin only, and it holds up neither the page nor the game's start: `GamesFun.ready` waits a second for it at most,
and the Godot and Unity glue wait on `ready` before they tell the game who is here.

### The token, for the game's server

The game's `server/` checks the token with `env.GF.verifyPlayer`, first thing, before any work: a request without one
answers 401 at once, since strangers' requests that do work count toward what caps a game
([SERVER.md](SERVER.md#check-the-token-first), "Check the token first", which also says how a backend of your own
checks it). `gamesfun.js` and the Godot and Unity clients check no token themselves.

## Calling the game's server: `GamesFun.api`

The page calls the game's own server with `GamesFun.api(path, init)` (Godot `GamesFun.api(path, init)`, Unity
`GamesFun.Api(path, initJson)`): `path` is relative to the game's `api/` (`'finish'` is `api/finish`, at the published
origin and under a folder alike), `init` is `fetch`'s (an object `body` goes as JSON), and a signed-in player's token
goes with it as `Authorization: Bearer …`, which the server checks with `env.GF.verifyPlayer` before it trusts who is
asking. It answers `{data, error, status}` like every other call.

## Leaderboards

**A leaderboard is the player's own word until the server takes it.** A signed-in player submits their own scores from
the page, so anyone can submit any score for themselves from the browser's console. A game with its own server makes a
board nobody can write that way: `env.GF.scores.setup('ranked', {writer: 'server'})` (or a pattern for boards to come,
`'daily-*'`), then the page's submits to it are refused (their answer's `code` is `'server-only'`, HTTP 403) and the
server submits each run it checked; the page reads the board as before ([SERVER.md](SERVER.md#envgf-the-platform)). A
board a page makes ranks higher first; a lower-first board (a time) is made by the game's server, and a page's
`order: 'low'` for a new board is refused (`code: 'order'`). `scores.top` gives each entry's `player` as an id of this
game's own and marks the signed-in player's own entry `me: true`.

What a page may write and read, on every plan, is in [COMMANDS.md](COMMANDS.md#the-plans-limits-refused-as-published).

## Full screen

Most players meet a game in a post on X or on a phone, where it shows in a small frame first; `xcore adopt` warns when a
game has no way to go full screen. A button that calls `GamesFun.fullscreen()` from the click
(`await GamesFun.fullscreen()` in Godot; `Screen.fullScreen` in Unity) does it wherever the game is: in xgames.fun's
play page the page around the game goes full screen (or fills the screen in an app's own browser, X's among them), on
its own link the browser does, and in a frame that allows none (a post on X on a computer) the game opens in a tab of
its own. It answers `{on, how: 'page' | 'browser' | 'tab' | 'none'}` (`none`: an iPhone's Safari, which has no full
screen for a page); pressed again it comes back, and `GamesFun.onFullscreen(on => …)` follows every change.

## A wallet app, for a claim

A player who opens a game from a post in X's app is in X's own browser, which has no wallet. The game can be opened in a
wallet app's browser (Phantom or Solflare), or in the person's own browser, already signed in, from either of the two
places a player meets it:

- **inside xgames.fun's play page** (`xgames.fun/play/<name>`): the page around the game opens the app when asked;
- **on its own host, as the whole tab** (`https://<name>-play.xgames.fun/`: a post's card on X opens the game there
  by itself): the tab goes to xgames.fun's wallet page
  (`https://xgames.fun/wallet/open?slug=<name>&app=<app>&back=<this page>`), which opens the app or shows its links,
  and the wallet's browser comes back to this page signed in.

Framed by anything else (X's timeline shows the game in a frame inside X's own site; another site embeds it) a frame
cannot move the tab, so nothing opens and the game shows its own fallback. Three calls, the same in both places:

- `GamesFun.canOpenWallet()` → `true` (no wallet in this browser, and the game can be opened in one), `false` (a wallet
  is here), or `null` (not known: framed by something other than the play page, an older play page, or on its own host
  before the look for a wallet has settled). On its own host the look is loot's page client's (`gf/loot/wallets.js`,
  as `gf.loot.ready()` asks it, once more about 1.5 s after it starts: a wallet can register late), started by the
  first of these calls; a game without `gf/loot/` gets `null` there. `GamesFun.onCanOpenWallet(can => …)` follows each
  change.
- `GamesFun.walletNeeded()`: call it when the Claim button shows. In the play page, the page gets ready so the later tap
  opens the app at once (it is told once a page load): `{data: {told: true}}`. On its own host there is nobody to
  tell, and it starts the look for a wallet: `{data: {told: false}}`. Framed by anything else: `code: 'no-page'`.
- `GamesFun.openWallet(app = 'phantom', {view, href} = {})`: `app` is `'phantom'`, `'solflare'` or `'browser'`. In the
  play page, `view` left out opens the play page as it is, `'claim'` with `href` (an address of this game's own play
  page, `https://xgames.fun/play/<name>?…`) that address, `'wallet'` xgames.fun's page that adds a wallet; it answers
  `{data: {asked: true}}`, or `code: 'not-offered'` when `canOpenWallet()` is not `true` there. On its own host the
  tab goes to the wallet page and it answers `{data: {asked: true, left: true}}` (the page is leaving); the way back
  is this page's address without its fragment, or `href` with `'claim'` when that is an address on this same host.
  Errors, with nothing opened: `code: 'invalid'` (a bad argument), `'no-page'` (framed by something else).

**Call `openWallet` inside the player's tap**, in the click handler itself, with no `await` or timer before it: the
message (or the tab's move) goes in the call, and a browser opens an app only from a tap. One Claim button for both
places:

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

`gamesfun.js` builds no wallet app's links itself: xgames.fun's pages do. Under `xcore dev` and on this machine there is
no play page and no xgames.fun, so `canOpenWallet()` is `null` and `openWallet` answers `no-page`: test the fallback
there, and the wallet app on xgames.fun.

## Live settings: `gf.live`

An announcement, a remote config and maintenance, with no republish. On xgames.fun/console, a game's **Live** tab sets
three things its players get within about 35 seconds, with no republish (xgames.fun's play edge answers them itself
from one cached record a game):

- **an announcement**: a short line of plain text (280 characters), `info` or `warning`, with an optional start and end;
- **a remote config**: a small JSON object (8 KB) the game reads at run time: a difficulty, an event on or off. The
  console keeps its last 10 versions and reverts with a click;
- **maintenance**: the game paused with a message. Players who open it get a plain holding page from xgames.fun instead
  of the game, its server's `api/*` (WebSockets too) and the page's saves and leaderboards answer `503` with code
  `maintenance` (the server's code does not run), and turning it off brings the game back within about 35 seconds (up
  to a minute). What is already running (an open WebSocket, an alarm) is not stopped.

`gamesfun.js` reads them (since 1.5.0):

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
terminal. Godot and Unity reach `gf.live` only through their JavaScript bridge for now. What maintenance does to the
game's server is in [SERVER.md](SERVER.md#publishing-it).

## The database: `GamesFun.db`

`xcore add database <folder>` adds sign-in, and a database the game owns: **one D1 database** (SQLite) a game, made on
xgames.fun by the first publish and kept between publishes. Nothing to sign up for and no keys. `gamesfun.json` →
`database` declares it; its tables come from the migrations in `server/migrations/` (`0001_init.sql`, then
`0002_….sql`: append only, applied by publish before the new version goes live). The server side, the rules and
`xcore db` are in [SERVER.md](SERVER.md#a-database-of-its-own).

- **A game with a server of its own** gets an example first migration and `server/gf-db.js`: prepared queries
  (`db(env).first('SELECT gold FROM players WHERE id = ?', sub)`), and `withPlayer(request, env)`, the signed-in
  player's id. A rule that must hold under a burst of requests is one statement
  (`UPDATE players SET runs = runs - 1 WHERE id = ? AND runs > 0 RETURNING runs`).
- **A game with no server** gets xcore's stock server, which keeps the page's documents (any JSON up to 64 KB) in
  collections, under the rules in `database.collections`. When it gets a server of its own
  (`xcore add multiplayer`, `rpc`, `vouchers`), `server/gf-docs.js` goes on serving the same documents there, under
  the same rules; publish refuses a server that has `collections` and does not route `api/db/`.

The page's documents:

```js
const level = (await GamesFun.db.add('levels', { name: 'Moon', tiles })).data; // {id, owner, value, updatedAt}
await GamesFun.db.put('levels', level.id, { name: 'Moon 2', tiles });
const page = await GamesFun.db.list('levels'); // page.data: the newest 50; page.after: the next page's place
const next = await GamesFun.db.list('levels', { after: page.after }); // page.after is null on the last page
```

**Each player has a space of their own** in every collection: a document is found by its collection, its owner and its
id, so two players can both have a `main`, and nobody can take an id in another player's space. By default a signed-in
player reads and writes only their own documents. `{"read": "anyone"}` in `database.collections` lets everyone read a
collection (another player's document by its owner, `GamesFun.db.get('levels', id, { owner: playerId })`, and their
list with `{ owner: playerId }`); `{"write": "server"}` is for what players must not set themselves (the page reads it
without naming an owner: the server's document, or the player's own that the server wrote for them). Lists page with
`after`; `offset` is refused in words. The order is by when a document was last written, so one written between two
pages can show twice or be skipped.

On a plain local server the page keeps documents in the browser; under `xcore dev` the database is a local D1 in
`.gamesfun/dev/d1/` with the same migrations. Its calls count toward the game server's requests (a minute's limit per
player and per game, set by its plan: [HOSTING.md](HOSTING.md#plans-xcore-plan)): read and write when something
happens, not every frame. A game whose `server/database.js` was written by xcore 0.1.0 (a Durable Object, the older
way) keeps it, and it goes on working: see [UPGRADING.md](UPGRADING.md).

## Rooms: `xcore add multiplayer`

`xcore add multiplayer <folder>` adds sign-in, and rooms the game owns: server code (`server/rooms.js`, one Durable
Object a room) that publish puts on xgames.fun with the game, at its own `api/rooms/<CODE>`. A room is a relay with a
host: the first player in is the host (id 1, as Godot's server), every other player gets an id of their own, and a
message goes to one player, to everyone else, or to everyone but one. The room never reads a message: the host's game
decides what happens. When the host leaves, the player who joined next becomes the host (a Godot game instead sees its
server leave, `server_disconnected`, as over ENet).

- **A Godot 4 project**: `multiplayer.multiplayer_peer = await GamesFun.join_room(code)`, in place of an
  `ENetMultiplayerPeer`: RPCs, `MultiplayerSpawner` and `MultiplayerSynchronizer` work unchanged (all reliable and
  ordered). In the editor the same call makes a local ENet game, for Run Multiple Instances.
- **A Unity project**: `var room = await GamesFun.JoinRoom(code)`: `room.Send(json, to)`, `room.SendBytes(bytes, to)`,
  `OnMessage`, `OnBytes`, `OnJoin`, `OnLeave`, `OnHost`.
- **A web game**: `const { data: room } = await GamesFun.rooms.join(code)`: `room.send(data, to)`,
  `room.sendBytes(bytes, to)`, `room.on('message', …)`.

A room's code is 4 to 8 letters and digits (`rooms.code()` makes one). By default the first to a code opens the room and
anyone after joins it; a Host button passes `host: true` (refused when someone is in the room) and a Join button
`host: false` (refused when no one is, as joining an address no one serves fails over ENet). `rooms.link(code)` is the
link to share: `https://xgames.fun/play/<slug>?room=<CODE>`, which opens the game in that room, on xgames.fun and inside
a post on X (its card frames the room), and `rooms.fromLink()` reads it back. `ROOM` at the top of `server/rooms.js`
sets the most players (16), whether only signed-in players may join (their xgames.fun id and X handle come with them),
and the message limits (120 messages a second a player; past it messages are dropped and the game told, through the
room's `error` event, Godot's `room_error` signal and Unity's `OnError`). The page client sends each frame's messages as
one, so a game at any frame rate sends at most about 60 a second, however many objects it syncs. A player's connection
counts once toward the game server's requests (its plan's limits: [HOSTING.md](HOSTING.md#plans-xcore-plan)), however
many messages it carries.

Porting a Godot game from ENet: `create_server` / `create_client` become `join_room` (with `host: true` / `false` for
Host and Join buttons), a variable typed `ENetMultiplayerPeer` becomes `MultiplayerPeer`, `create_server`'s
`max_clients` is `ROOM.maxPlayers` (for every room of the game), and a packet sent unreliable arrives reliable. The peer
leaves its room on `peer.close()` or when nothing holds it any more. The host's game relays every client's packets to
the others, as Godot's server does over ENet. On this machine, tabs of the same browser share a room, so two tabs play
together before the game is published; under `xcore dev` they play through the room server itself, as on xgames.fun. A
netcode library with a server of its own (Netcode for GameObjects, Mirror, a Node server) does not run on xgames.fun as
it is: its game logic moves to the host's game, or its server runs on a host of your own
([HOSTING.md](HOSTING.md#a-backend)).

**When the host must not decide.** In a room the host's game is the referee, and the host's player can read anything
their page holds. That is fine for most games played with friends, but not for a hidden role or word (the host would
see the Impostor), or a result that pays tokens or prizes (the host could claim any winner). Such a game keeps the match
in a Durable Object of its own, as a Node or Socket.IO server would: the room's state, the hidden parts and the result
live there, players send it their moves over a WebSocket, and it sends each player only what that player may see
([SERVER.md](SERVER.md#a-room-over-a-websocket), "A room over a WebSocket"). It sits beside `server/rooms.js` (or in
place of it), and the server that decided the result is the one that pays it (`env.GF.loot.report` for prizes by
place, or a voucher it signs with its own key: `xcore add vouchers`).

## The economy: `GamesFun.loot` and `gf/loot/`

`xcore loot add` copies loot's page client beside the game's economy (`gf/loot/`, a copy: never edit it; publish keeps
it current). What the economy is and how it goes live: [ECONOMY.md](ECONOMY.md).

### From any engine: `GamesFun.loot`

From Godot, Unity or any page with `gamesfun.js` (`xcore add signin`), `GamesFun.loot` does all of what the next
section wires by hand, with JSON in and out (big numbers as text), so an engine calls it like the rest of xgames.fun.
It reads the cluster from the economy's file: on mainnet, wire the economy through it.

```js
await GamesFun.loot.ready(); // {live, project, wallets: [names], spec}
await GamesFun.loot.connect(); // {address, wallet}: the wallet asks the player
await GamesFun.loot.link(); // {wallet}: it signs that it is this player's (a game server that pays needs it)
const shop = await GamesFun.loot.call('shop'); // any method of loot's page client, with its arguments
await GamesFun.loot.call('buy', 'sword', { listing: shop.data[0] }); // a listing goes back as it came
```

Godot: `await GamesFun.loot_ready()`, `loot_connect()`, `loot_link()`, `loot_call("shop")`,
`loot_call("buy", ["sword", {"listing": item}])`. Unity: `GamesFun.LootReady()`, `LootConnect()`, `LootLink()`,
`LootCall("shop")`, `LootCall("buy", "\"sword\", {\"listing\": …}")`. In a Godot or Unity project, `xcore loot add`
keeps `xsolana.json` and `gf/loot/` out of the engine's export, in the project's own `gamesfun/` folder (with a
`.gdignore`, so Godot leaves it alone): `gamesfun.json` → `page.static`. Publish, `xcore check` and `xcore dev` lay that
folder over the export, so you export as before, and the file that holds the addresses the economy went live at stays
in the project (keep it in git).

### A web page, by hand: `gf/loot/`

The page loads loot's page client at run time with a page-relative URL, so a bundler leaves it alone:

```js
const { solanaApp, walletStandardSigner } = await import(
  /* @vite-ignore */ new URL('gf/loot/play/index.js', document.baseURI).href
);
const { solanaWallets, connectWallet, PAGE_RPC } = await import(
  /* @vite-ignore */ new URL('gf/loot/wallets.js', document.baseURI).href
);
const spec = await (await fetch('xsolana.json')).json();
```

`solanaApp` takes `rpcUrl: PAGE_RPC`, the page's own `/loot/v1/rpc`. `gf/loot/wallets.js` gives the page the player's
wallet through the Wallet Standard, with no package. Each call is for devnet unless it is told the economy's cluster:

| Export                                                |                                                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `solanaWallets({ waitMs = 300, cluster = 'devnet' })` | → the wallets in this browser that can sign Solana transactions on that cluster (an empty list when there are none: say so, and keep the game playable) |
| `connectWallet(wallet, { cluster = 'devnet' })`       | → the player's account on that cluster; the wallet shows its own prompt, and it throws if they say no                                                   |
| `PAGE_RPC`                                            | the page's own `/loot/v1/rpc` (xgames.fun's relay once published), for devnet                                                                           |
| `pageRpc(cluster)`                                    | the same relay for an economy on `cluster`: `PAGE_RPC` on devnet, `PAGE_RPC` with `?cluster=mainnet` on mainnet                                         |
| `chainOf(cluster)`                                    | the cluster's name as a wallet takes it: `'solana:devnet'` or `'solana:mainnet'`                                                                        |

`walletStandardSigner(wallet, account)` from `gf/loot/play/index.js` turns them into the signer `solanaApp` takes.

**An economy on mainnet** (`"network": "mainnet"` in `xsolana.json`) names its cluster in every one of those:
`solanaWallets({ cluster: 'mainnet' })`, `connectWallet(wallet, { cluster: 'mainnet' })`,
`walletStandardSigner(wallet, account, chainOf('mainnet'))` and `pageRpc('mainnet')` in place of `PAGE_RPC`. Its relay
answers only a player signed in to the game, so every call to it carries the player's sign-in as well. `GamesFun.loot`
(above) reads the cluster from the economy's file and does all of this: on mainnet, wire the economy through it.

`@xgamesfun/solana`'s own examples use a public devnet RPC and `node_modules/` paths; on xgames.fun use `PAGE_RPC` and
`gf/loot/` as above.
