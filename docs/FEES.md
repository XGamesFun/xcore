# Fees

Every cost a developer or their players can pay through xcore and xgames.fun. xcore itself is free and open source
([MIT](../LICENSE)).

Amounts in SOL are on Solana mainnet unless a row says devnet. Devnet SOL has no value. On top of every fee below, the
Solana network charges its own transaction fees and rent for new accounts; `xcore loot cost` prices an economy's
transactions, rent included, for its own network.

## Summary

| What                                | Who pays                      | Cost                                                                                   |
| ----------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| Hosting in a free slot (Free plan)  | nobody                        | free: 2 slots per account, $1 of use a month included per game                         |
| Paid slot (Creator plan)            | the developer                 | $15 per game per 30 days, prepaid in SOL or USDC; $10 of use a month included per slot |
| Usage beyond what is included       | the developer                 | usage credit, at twice what xgames.fun pays; without credit, the game is capped        |
| Coin launch (`xcore coin launch`)   | the developer's key file      | about 0.03 SOL on the cluster                                                          |
| xgames.fun's share of a coin's fees | taken from the creator's fees | up to 10% of the creator's share of trading fees                                       |
| loot fee, player action             | the player                    | 0.0005 SOL on mainnet; 0.002 SOL on devnet                                             |
| loot fee, project action            | the project's key             | 0.00001 SOL                                                                            |
| Randomness (each roll)              | whoever asks for the roll     | 0.0008 SOL to MagicBlock's VRF oracle                                                  |
| New collectible NFT (Metaplex Core) | paid from the order's SOL     | Metaplex Core's creation fee of 0.0015 SOL, plus rent (about 0.0031 SOL in all)        |

## Hosting

Every game sits in a slot. The full plan table and its rules are in [HOSTING.md](HOSTING.md#plans-xcore-plan).

| Plan    | How you get it                 | Price                                 | Use included a month | Main limits                                                                    |
| ------- | ------------------------------ | ------------------------------------- | -------------------- | ------------------------------------------------------------------------------ |
| Free    | 2 free slots for every account | free                                  | $1 per game          | 50 ms of CPU a request; 600 requests a minute; 10 MB of saves; 100 MB of files |
| Creator | a paid slot                    | $15 per game per 30 days, SOL or USDC | $10 per paid slot    | 200 ms a request; 6,000 requests a minute; 1 GB of saves; 10 GB of files       |
| Scale   | granted by xgames.fun          | as granted                            | as granted           | 1,000 ms a request; 30,000 requests a minute; 10 GB of saves; 100 GB of files  |

### What a game gets on each plan

Every plan has the same services. A paid slot (Creator) raises their limits and adds a domain of your own.

|                                                    | Free (free slot)                                                   | Creator ($15 per game per 30 days)              |
| -------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| Hosting at an xgames.fun link                      | 3,000 files, 100 MiB per game                                      | the same                                        |
| Player sign-in (X or Google, with a linked wallet) | included                                                           | included                                        |
| Saves                                              | 10 MB per game                                                     | 1 GB per game                                   |
| Leaderboards                                       | 8 boards of 10,000 entries                                         | 16 boards of 1,000,000 entries                  |
| A D1 (SQLite) database                             | one per game                                                       | one per game                                    |
| Multiplayer rooms                                  | included (each player's connection counts as one server request)   | included                                        |
| The game's server (a Cloudflare Worker)            | 50 ms of CPU a request; 600 requests a minute, 120 from one player | 200 ms; 6,000 a minute, 600 from one player     |
| Project files                                      | 100 MB                                                             | 10 GB                                           |
| Live settings (announcement, remote config)        | included                                                           | included                                        |
| Sites that may embed the game                      | 3                                                                  | 10                                              |
| A domain of your own                               | none                                                               | 1                                               |
| Use included a month                               | $1                                                                 | $10 per paid slot, shared by your Creator games |
| Past what is included                              | capped until the month ends                                        | usage credit at twice cost; without it, capped  |

- **Paying:** paid slots are prepaid on xgames.fun (your console → Plans) in SOL or USDC. They do not renew
  automatically. After a period ends there are 7 days' grace; then the game moves back to a free slot and nothing is
  taken down.
- **Moving a slot:** a paid slot can move between your games at any time without changing the bill
  (`xcore plan deactivate`, then `xcore plan activate`).
- **What counts as use:** the game's server requests, and every call the published page makes through xgames.fun's
  shared Solana relay ($10 per million calls). A game with its own RPC (`xcore add rpc`) instead pays one server
  request per call (about $0.30 per million) plus its RPC provider's own price. See
  [SERVER.md](SERVER.md#the-economys-own-rpc).
- **Over the limit:** a Free game, or a Creator game without usage credit, is capped until the month ends: its server
  is switched off (every `api/*` request answers 451), its pages keep loading, and saves and scores slow down. Usage
  credit, bought the same way as slots, lets Creator games go past what their slots include instead of being capped.
  It is charged at twice what xgames.fun pays.
- **Account limits** (not priced): 30 publishes and 1 GB of new files a day, and 100 games per account.

`xcore plan` shows a game's plan and this month's use; `xcore plan --all` shows every slot.

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
