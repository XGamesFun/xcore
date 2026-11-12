# Sign-in, saves, a database and rooms

Open this when the game has (or needs) a login, progress kept between visits, a high-score table, data shared by all
players, or multiplayer. `xcore add <signin|database|multiplayer> <folder>` writes the files; the calls are listed at the
top of the file it writes.

## Sign-in, saves, leaderboards

`xcore add signin <folder>` works out the engine: a web game gets `gamesfun.js` loaded in its page, a Godot 4 project
the `GamesFun` autoload, a Unity project `Assets/Plugins/GamesFun/`. Replace the game's own login, local save file or
localhost leaderboard with these calls. Players sign in with X (or a wallet), so the game asks for no password and keeps
no accounts of its own: xgames.fun holds them.

- **Start sign-in from a click.** When `onCode` / `sign_in_code` / `SignInCode` fires with `window: false`, show the
  code and the site; with `window: true` the player already has a way to sign in on screen (a window, or the small
  panel `gamesfun.js` draws where none opens), so a quiet line is enough and an overlay would cover the game.
- **Read the player after `GamesFun.ready`, and follow `onChange` / `player_changed` / `PlayerChanged`**, not only
  the sign-in call's answer. On the game's own host (`<name>-play.xgames.fun`, where a post's card on X and xgames.fun's
  wallet hand-off open it) xgames.fun is asked who is here as the page loads, and a player who chose this game in this
  browser is signed in with no tap.
- **On its own host, the Sign in tap takes the tab to X and back** (phone and computer), so the game starts again,
  signed in. Call `signIn` in the click handler itself with nothing awaited before it, because a browser opens X only
  from the tap. `GamesFun.signInEnded` says `'cancelled'` or `'failed'` when it came back with nobody. Tell the person.
  A game that can't start again at that moment (a run in progress with nothing saved) signs in before play starts, or
  passes `stay: true` (`GamesFun.signIn({stay: true})`, `sign_in("x", true)`, `SignIn("x", true)`), which opens a
  window instead.
- `GamesFun.signOut()` tells xgames.fun to forget the game in that browser. A game that draws its own button as a link
  takes the address from `GamesFun.signInLink('x')`.
- A game whose `gamesfun.js` is older than 1.9.0 gets none of this until `xcore add signin` brings the file up to date
  and it is published again.

## Data the game keeps for everyone

Levels players make, profiles, a world's state, where the game used a localhost database or a JSON file:
`xcore add database <folder>`, then `GamesFun.db` calls. Read RULES at the top of `server/database.js` with the person:
anything a player must not set for themselves (a prize, a verified score) gets `write: 'server'` and is written by the
game's server code, because the page is the player's to change. A database they already host stays behind their own
backend, with its address and password out of the page. `xcore db` reads it here or live (`--live`).

## Multiplayer

A localhost Socket.IO or ENet server, a Godot game with `ENetMultiplayerPeer`, a Unity game with its own relay:
`xcore add multiplayer <folder>`.

- Godot: replace `create_server`/`create_client` with `var peer = await GamesFun.join_room(code)` and
  `multiplayer.multiplayer_peer = peer`; keep its RPCs, spawners and synchronizers.
- Elsewhere the host's game (the first player in, id 1) runs what the server ran, and the others send it their input
  with `room.send`. Codes: `rooms.fromLink()` first (a shared link), else `rooms.code()`; offer `rooms.link(code)` to
  share.
- Moving server logic into the host's game changes their architecture: ask the person first.

## Full screen

When adopt warns that the game has no way to go full screen, offer a button (their game, their call): most players meet
a game in a post on X or on a phone, in a small frame. A small button in a corner of the first screen, big enough for a
thumb, calls `GamesFun.fullscreen()` from the click (`gamesfun.js`; Godot `await GamesFun.fullscreen()`; Unity
`Screen.fullScreen`). Pressed again it comes back. It answers `{on, how}`:

- on xgames.fun the page around the game goes full screen, or fills the screen in an app's own browser (X's on a phone);
- on the game's own link the browser does;
- in a frame that allows none (a post on X on a computer) the game opens in a tab of its own (`how: 'tab'`);
- an iPhone's Safari has no full screen for a page (`how: 'none'`): the button can hide, or say "Add to Home Screen".

`GamesFun.onFullscreen(on => …)` follows it (Esc, the browser's own controls). A game that already goes full screen
needs nothing.
