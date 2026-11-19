# The economy in the page

Open this when wiring a loot economy into a brought game's page, or adding a claim button. Designing the economy
itself (what it is made of, its checks, going live with a key file) is the xsolana-economy skill's: start there.

## The page client

`xcore loot add <folder>` says where `xsolana.json` goes (the `static` folder of a build project). Once the economy is
saved there, run it again: it copies the page client into `gf/loot/` beside it. That folder is a copy that publish
brings up to date, so edits there are lost.

- A web page wires it as xcore's README §4, "An economy (web3)", shows: a run-time import with a page-relative URL,
  `solanaApp` with `rpcUrl: PAGE_RPC`.
- A Godot or Unity game, or any page with `gamesfun.js`, uses `GamesFun.loot` (`loot_ready` / `loot_connect` /
  `loot_call` in Godot, `LootReady` / `LootConnect` / `LootCall` in Unity).
- A browser with no wallet is told so, with the game still playable.
- `xcore dev <folder>` runs the page and `server/` against devnet. The economy's calls answer only once it is live
  there; devnet's test SOL means an economy put live to try it can be put live again later.

## A claim button and the wallet app

A game with a claim (anything the player claims to their wallet) calls `GamesFun.walletNeeded()` when it shows the
Claim button. When no wallet is in the browser (X's own browser, from a post in X's app) and `GamesFun.canOpenWallet()`
is `true`, the button calls `GamesFun.openWallet('phantom', {view: 'claim', href})` (or `'solflare'`) inside the tap
itself, with no `await` or timer before it, because a browser opens an app only from the tap.

The same button works in both places a player meets the game: inside xgames.fun's play page, the page opens the wallet
app; on the game's own host as the whole tab (a post's card on X opens it there), the tab goes to xgames.fun's wallet
page and comes back signed in. When `canOpenWallet()` is not `true` (a frame inside X's timeline, another site), the
game shows its own fallback, such as its link to copy. xgames.fun builds the wallet links, so the game builds none.
xcore's README §3 ("A wallet app, for a claim") has the button.

## Tokens

The xsolana-economy skill's "When they ask for a token" says which kind it is:

- a token the economy makes, named on chain as it goes live (ask for its name, ticker and a picture's link first);
- a coin made elsewhere: `xcore loot token <mint>` reads its whole entry from the chain, decimals and powers included;
- a coin people trade, which loot does not make: once the game is published, `xcore coin launch` launches one, and it is
  then a coin made elsewhere.

## A coin that trades

Only when the person asks for one. `xcore coin` says where the game's coin stands and what a launch can choose from
(Meteora or pump.fun, what each pairs a coin with, the pictures among the published files). Ask for the coin's name,
its ticker (2 to 10 letters or digits) and which picture; then
`xcore coin launch --name … --ticker … --picture <file> --keypair <key file>` prints the whole launch with a code and
sends nothing. The key file is one made on their machine (`xcore loot keygen`, or the one their economy went live
with) holding about 0.03 devnet SOL; the coin's creator fees belong to its address. The game's console (Token tab) is
the browser wallet's way, for the person to use themselves. Then `xcore loot token <mint>` gives the coin's entry for
`xsolana.json`.
