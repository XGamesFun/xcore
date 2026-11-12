# Before you build

For the agent building with xcore, and the person it builds for. One method, applied to every design that touches
money, a token, a flow a player taps through, or anything that can't be undone. It is short on purpose: the method
finds the problems, so there is no list of rules to keep up with.

## Challenge before you build

The person names a mechanism; what they want is an outcome. Before building what they asked:

1. **Name the simplest version that gets most of the outcome.** Often it is 90% of the request and far smoother.
2. **Run the six lenses (below) on both versions.**
3. **Recommend one, in a sentence, with its trade.** Not a survey of options.
4. **Build what they asked only once they have seen the trade and still want it**, and then build it well.

Challenge the economy, the flow and anything irreversible. Don't challenge taste, and don't challenge a decision twice:
once they have heard the trade, it is theirs.

What makes one version better than another, in this order of weight:

- **How it feels to play.** The player's experience is a first-class requirement, not a polish step: a design that is
  safe but confusing, slow or full of prompts is not the better design.
- **Clean.** Fewer parts, fewer tokens, fewer steps that someone must remember to send.
- **Secure where it counts.** Use an on-chain guard when there is a clear one that costs the player nothing (a cap the
  program keeps, a gate, a refund it enforces). When the only guard on chain would make playing worse, hold the rule on
  the server instead and say so: most game economies lean on their server, and that is fine when it is said plainly.
  A small loss of security for a large gain in smoothness is usually the right trade; name it when you make it.

## The six lenses

Run them before you build, and again before you say it is done. Each one is a question you answer for the design in
front of you, in every state it can reach: before it opens, while it runs, completed, won, lost, cancelled or failed,
abandoned half-way, undone ("I changed my mind"), and after it ends. Answer each as a player, as the owner and as a
cheater.

1. **Follow the value.** For everything a player puts in (a token, SOL, an NFT, their time), what do they hold in each
   state, and what can they turn it into? A problem is something that comes back as something other than what went
   in, something that can be turned back once the outcome is known, something of value made from nothing, something
   paid out twice along two paths, or something still produced after its use has ended.
2. **One intent, one step.** For everything a player means to do, count the prompts, signatures and taps, and say what
   each one shows. A problem is more than one step for one intent, a step that doesn't look like what they asked for,
   or one the place it runs in won't allow (xgames.fun's play frame takes no forms, pop-ups or top navigation).
3. **Check every assumption.** Every number that depends on people (minimums, caps, rates, pool sizes, durations)
   against the participation you actually have or expect, and against the worst single participant (a script, one
   account at its cap all day). Say which numbers can change only before a first sale, claim or launch: those are
   deadlines.
4. **Who makes it happen.** Every step after a player acts (a reveal, a refund, a payout, a close, a switch, a prize
   shipped): who sends it, who pays, from which key, and what happens if nobody does or their machine is off.
5. **Where each rule is enforced.** For every rule the design relies on: is it held by the chain, by the server, or
   only by the page? A rule only the page holds is a suggestion to a script. Anything shown as true (a winner, a
   balance, a limit) is read from where it is enforced. Prefer the chain when it costs the player nothing; otherwise the
   server, said plainly.
6. **How the player experiences it.** Walk it as a first-time player on a phone, from the link to the first reward:
   what they need before they can start (a wallet, devnet SOL, a sign-in), every wait (a cooldown, a draw time, a
   voucher's life), every prompt and what it says, and what they see when something fails or ends. A problem is a step
   that surprises them, a wait they don't understand, a prerequisite they can't meet in the place they are (an app's
   own browser), or an ending they never hear about.

Bring what you find with a recommendation for each. A deadline goes first.

## Worked examples

From one day running a promo on xgames.fun: a bubble popper whose players earn BUBL, swap it for raffle entries, and
win a physical card. Each was built exactly as asked and found by the person after it shipped; one lens would have
found it first. They illustrate the lenses; they are not rules to check one by one.

| What was built                                                                | Lens | What the lens says                                                                     |
| ----------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------- |
| Entries made by burning BUBL; a draw short of its minimum refunds entries     | 1    | Cancelled: the player holds entries, not the BUBL they put in.                         |
| A swap from entries back to BUBL, open at any time                            | 1    | Lost: the player turns their entries back once the outcome is known.                   |
| A free entry that is the same token as a bought one                           | 1    | Made from nothing, and worth what a paid one is once it converts.                      |
| A voucher abandoned for one wallet, asked again for another                   | 1    | Abandoned half-way, then completed on chain: paid twice along two paths.               |
| "Buy 10 tickets" that first opens a prompt for 4 (making the missing entries) | 2    | Two steps for one intent, and the first doesn't look like it.                          |
| A raffle needing 100 tickets, with two players                                | 3    | Against real participation: cancelled. And it can change only before the first ticket. |
| A cap of 1,750 an hour                                                        | 3    | Worst participant: 42,000 a day from one account.                                      |
| Refunds each player must pull; a swap back opened by a timer on one computer  | 4    | Nobody pulls, nothing comes back; the machine is off, the swap stays shut.             |
| A token still earned after the last draw; a prize with no shipping step       | 4    | After it ends: who tells players it's over, and who reaches the winner?                |
| Human checks with a few answers and no cost for a wrong one                   | 5    | Held only by guessing being slow: a blind script passes in about 15 tries.             |
| A button hidden on the page as the only bar to an action                      | 5    | A script calls the program directly.                                                   |
| Every player claim and entry paid by the player in devnet SOL                 | 6    | A first-time player must find a faucet before anything works, and many stop there.     |
| An on-chain cap on claims per person, against players who claim every 4 min   | 6, 5 | The most engaged players are locked out first: hold that rule on the server instead.   |

## Where this lives

- This page is the method. The skill in `skills/bring-your-own-game/` says it in its first lines.
- `@xgamesfun/solana` (the economy tools) runs the lenses on an economy spec: `xsolana explain` and `xsolana review`
  end with "Each route, state by state", the walk-through for the spec in front of them, and its skill says "Challenge
  before you build".
