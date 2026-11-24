# Disclaimer and responsible use

**Use this software at your own risk.** It is provided "as is", without warranty of any kind, express or implied, as
set out in the [LICENSE](../LICENSE). The authors and contributors are not liable for any loss or damage arising from
its use, including lost funds, lost data, account suspensions or legal claims.

## Your legal responsibility

**You are responsible for making sure that everything you build, publish and run with this software is legal** in
every jurisdiction where you operate and where your players are. Depending on what your game does, this may include
laws and rules on:

- **Gambling, lotteries, sweepstakes and prize promotions.** Loot boxes, raffles, lotteries, coin flips, prize pools
  and paid chances to win are restricted or banned in many countries and states.
- **Digital assets and finance.** Tokens, NFTs, staking and rewards may be treated as securities, commodities, payment
  instruments or money transmission. They may require licensing, KYC/AML checks or sanctions screening.
- **Consumer protection, age limits and advertising**, including rules on minors and on disclosing odds.
- **Tax** on sales, prizes and digital-asset income, for you and for your players.
- **Privacy and data protection** (such as GDPR and CCPA) for any player data your game or its backend collects.
- **Intellectual property.** Publish only code, art, music and names that you own or have a license to use.

Nothing in this repository, its documentation or its output is legal, financial, investment or tax advice. Get advice
from a qualified professional before you offer anything of real value.

## On-chain features

- The loot program runs on Solana devnet and on **mainnet**, and **has not been independently audited**.
- An economy runs on devnet, where nothing has value, unless its `xsolana.json` says `"network": "mainnet"`. On
  mainnet, every transaction moves real SOL and real tokens, and anything sent to the program can be lost.
- Try an economy on devnet first. Put it on mainnet only once you accept that risk.
- Blockchain transactions are public and irreversible.
- You alone control your wallet and keys. Never put a private key, seed phrase or secret in a game, and approve only
  transactions you understand.
- The key file an economy goes live with owns that economy until it hands it to another key (`xcore loot handover`,
  which both keys sign). Keep it outside the game's folder, and never paste it anywhere. For real money, a browser
  wallet that keeps its key on a hardware device is the safer owner (docs/ECONOMY.md, "Going live").

## Third-party services

xgames.fun, Cloudflare, Supabase, Railway, GitHub, npm, Solana RPC providers and wallets are run by others under their
own terms and policies, which you must follow. Their availability, fees and rules can change without notice.
