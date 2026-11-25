# Fees

Every cost a developer or their players can pay through xcore and xgames.fun. xcore itself is free and open source
([MIT](../LICENSE)).

Amounts in SOL are on Solana mainnet unless a row says devnet. Devnet SOL has no value. On top of every fee below, the
Solana network charges its own transaction fees and rent for new accounts; `xcore loot cost` prices an economy's
transactions, rent included, for its own network.

## Summary

| What                                | Who pays                      | Cost                                                                                                              |
| ----------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Hosting on a Free account           | nobody                        | free: up to 2 games, $1 of use a month included per game                                                          |
| Creator account                     | the developer                 | $15 per 30 days, prepaid in SOL or USDC: every game you own, up to 10, on Creator, with $10 of use a month shared |
| Usage beyond what is included       | the developer                 | usage credit, at the [unit prices](#unit-prices) below; without credit, the games are capped                      |
| Coin launch (`xcore coin launch`)   | the developer's key file      | about 0.03 SOL on the cluster                                                                                     |
| xgames.fun's share of a coin's fees | taken from the creator's fees | up to 10% of the creator's share of trading fees                                                                  |
| loot fee, player action             | the player                    | 0.0005 SOL on mainnet; 0.002 SOL on devnet                                                                        |
| loot fee, project action            | the project's key             | 0.00001 SOL                                                                                                       |
| Randomness (each roll)              | whoever asks for the roll     | 0.0008 SOL to MagicBlock's VRF oracle                                                                             |
| New collectible NFT (Metaplex Core) | paid from the order's SOL     | Metaplex Core's creation fee of 0.0015 SOL, plus rent (about 0.0031 SOL in all)                                   |

## Hosting

A plan is bought for the account, not for a game. The full plan table and its rules are in
[HOSTING.md](HOSTING.md#plans-xcore-plan).

| Account | Price                                 | Games                | Use included a month      |
| ------- | ------------------------------------- | -------------------- | ------------------------- |
| Free    | free                                  | up to 2, on Free     | $1 per game               |
| Creator | $15 per 30 days, prepaid, SOL or USDC | up to 10, on Creator | $10, shared by your games |

Each game keeps its own plan's limits (its own server, saves, scores and files):

| Plan    | Whose games                  | Main limits, per game                                                          |
| ------- | ---------------------------- | ------------------------------------------------------------------------------ |
| Free    | a Free account's             | 50 ms of CPU a request; 600 requests a minute; 10 MB of saves; 100 MB of files |
| Creator | a Creator account's          | 200 ms a request; 6,000 requests a minute; 1 GB of saves; 10 GB of files       |
| Scale   | a game granted by xgames.fun | 1,000 ms a request; 30,000 requests a minute; 10 GB of saves; 100 GB of files  |

### What a game gets on each plan

Every plan has the same services. A Creator account raises their limits for every game it has and adds a domain of
your own to each.

|                                                    | Free (a Free account's games)                                      | Creator (a Creator account's games, $15 per 30 days for the account) |
| -------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Hosting at an xgames.fun link                      | 3,000 files, 100 MiB per game                                      | the same                                                             |
| Player sign-in (X or Google, with a linked wallet) | included                                                           | included                                                             |
| Saves                                              | 10 MB per game                                                     | 1 GB per game                                                        |
| Leaderboards                                       | 8 boards of 10,000 entries                                         | 16 boards of 1,000,000 entries                                       |
| A D1 (SQLite) database                             | one per game                                                       | one per game                                                         |
| Multiplayer rooms                                  | included (each player's connection counts as one server request)   | included                                                             |
| The game's server (a Cloudflare Worker)            | 50 ms of CPU a request; 600 requests a minute, 120 from one player | 200 ms; 6,000 a minute, 600 from one player                          |
| Project files                                      | 100 MB                                                             | 10 GB                                                                |
| Live settings (announcement, remote config)        | included                                                           | included                                                             |
| Sites that may embed the game                      | 3                                                                  | 10                                                                   |
| A domain of your own                               | none                                                               | 1                                                                    |
| Use included a month                               | $1 per game                                                        | $10 for the account, shared by its games                             |
| Past what is included                              | capped until the month ends                                        | usage credit at the unit prices below; without it, capped            |

- **Paying:** a Creator account is prepaid on xgames.fun (your console → Plans) in SOL or USDC, $15 per 30 days, for
  1 to 12 periods at a time. It does not renew automatically. There are no slots to buy or move: every game you own, up to 10, is on Creator.
- **When it lapses:** after a period ends there are 7 days' grace. Then every game drops to Free limits and keeps
  running; nothing is taken down. A new game waits until the account has fewer than 2 games, or is renewed.
- **What counts as use:** everything a game runs up is billed: its server, rooms, saves, database and files, and also
  its page files and every call the published page makes through xgames.fun's shared Solana relay. Relay calls and
  page files use up the included amount, counted at cost ($10 per million relay calls), and past it are charged from
  usage credit at the unit prices below ($20 per million relay calls). They never count toward the cap that switches a
  game's server off: only the game's own server, rooms and stored data do. A game with its own RPC (`xcore add rpc`)
  instead pays one server request per call (about $0.30 per million at cost) plus its RPC provider's own price. See
  [SERVER.md](SERVER.md#the-economys-own-rpc).
- **Over the limit:** a Free game past its $1, and a Creator account's games past their shared $10 without usage
  credit, are capped until the month ends: the server is switched off (every `api/*` request answers 451), the pages
  keep loading, and saves and scores slow down. A Creator account's games are capped together, since their included
  use is shared. Usage credit, bought the same way as the plan, lets them go past what is included instead of being
  capped, at the unit prices below.
- **Account limits** (not priced): 30 publishes and 1 GB of new files a day; 2 games on a Free account, 10 on a
  Creator account.

`xcore plan` shows your account and a game's plan and this month's use; `xcore plan --all` shows every game, and
`xcore plan --verbose` the unit prices xgames.fun publishes.

### Unit prices

Usage credit pays for use past what is included at these prices. Most are twice Cloudflare's list prices for the same
resources. Use inside the included amount is counted at cost, which is half these prices. `xcore plan --verbose`
prints the prices xgames.fun charges now, with the same names.

| What                                                | Price                                |
| --------------------------------------------------- | ------------------------------------ |
| Server requests                                     | $0.60 per million server requests    |
| Server CPU time                                     | $0.04 per million CPU-ms             |
| Room requests                                       | $0.30 per million room requests      |
| Room messages received (WebSocket)                  | $0.015 per million room messages     |
| Room awake time                                     | $3.20 per million room-seconds       |
| Rooms and saves: rows read                          | $0.002 per million rows read         |
| Rooms and saves: rows written                       | $2.00 per million rows written       |
| Rooms and saves storage                             | $0.40 per GB-month                   |
| Database rows read                                  | $0.002 per million rows read         |
| Database rows written                               | $2.00 per million rows written       |
| Database storage                                    | $1.50 per GB-month                   |
| Project files: writes and lists                     | $9.00 per million operations         |
| Project files: reads                                | $0.72 per million operations         |
| Project files storage                               | $0.03 per GB-month                   |
| Page file requests                                  | $0.60 per million page file requests |
| Solana RPC relay calls                              | $20.00 per million relay calls       |
| Edge requests in front of server and platform calls | $0.60 per million edge requests      |
| Edge CPU time                                       | $0.04 per million CPU-ms             |
| Edge key-value reads                                | $1.00 per million reads              |
| Edge file reads                                     | $0.72 per million reads              |

## Coin launch

`xcore coin launch` launches a tradable coin for a published game on Meteora or pump.fun, through xgames.fun's
launchpad ([ECONOMY.md](ECONOMY.md#a-coin-that-trades-xcore-coin)).

- **Launch cost:** the key file that signs the launch pays about 0.03 SOL on the cluster. Part of that, about
  0.02 SOL, is rent the venue's program charges for the coin's own accounts. xcore refuses to sign a launch in which
  the key pays more than 0.1 SOL in fees.
- **Trading fees:** xgames.fun takes at most 10% of a coin's creator fees, and xcore refuses to sign a launch that
  gives it more. The creator's key keeps at least 90%:
  - on Meteora, of the creator's side of the pool's trading fees, after Meteora's own cut;
  - on pump.fun, of the creator fee.
- The venue's own fees (Meteora's cut, pump.fun's fees) are the venue's and are not set by xgames.fun.

## loot (the on-chain economy)

An economy on loot, the shared Solana program behind `xcore loot`, charges two flat fees. They are set in the program's
platform account and documented by [`@xgamesfun/solana`](https://github.com/XGamesFun/solana-kit).

| Fee            | Mainnet     | Devnet      | Paid by           |
| -------------- | ----------- | ----------- | ----------------- |
| Player action  | 0.0005 SOL  | 0.002 SOL   | the player        |
| Project action | 0.00001 SOL | 0.00001 SOL | the project's key |

- The program caps each fee at 0.01 SOL.
- The platform's admin can change the fees. A raise takes effect only after 7 days; a cut applies at once. The tools
  quote the current values, and the program charges what its platform account holds.
- Rent for the accounts an economy creates is extra. `xcore loot cost` gives the totals for the economy's network.

### Randomness

Loot boxes, lotteries, raffles and other rolls use MagicBlock's verifiable randomness. Each random number costs
**0.0008 SOL**, paid to the oracle by whoever asks for it: the player when opening a box, whoever sends a lottery draw,
or the project's key for a roll it asks for.

### New NFTs (Metaplex)

A collectible NFT that loot creates is a Metaplex Core asset. Minting it costs the asset account's rent plus **Metaplex
Core's creation fee of 0.0015 SOL**, which Metaplex collects (it goes to Metaplex's fee collector, not to you or to
loot): about 0.0031 SOL per collectible in all. It is paid from the SOL the order holds, or by whoever gives the
collectible. `xcore loot cost` reports it for an economy.
