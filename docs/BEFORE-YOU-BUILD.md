# Before you build

This is one method for reviewing a design before you build it. Apply it to every design that touches money, a token,
a flow a player taps through, or anything that cannot be undone. It is for you, whether you build by hand or with a
coding agent. The method finds the problems, so there is no separate list of rules to maintain.

## Challenge before you build

A request usually names a mechanism, but what is wanted is an outcome. Before you build what was asked for:

1. **Name the simplest version that gets most of the outcome.** Often it is 90% of the request and far smoother.
2. **Run the six lenses (below) on both versions.**
3. **Recommend one, in a sentence, with its trade-off.** Not a survey of options.
4. **Build the original request only once the trade-off is known and it is still wanted**, and then build it well.

Challenge the economy, the flow and anything irreversible. Do not challenge taste, and do not challenge a decision
twice: once the trade-off has been heard, the decision stands.

What makes one version better than another, in order of importance:

- **How it feels to play.** The player's experience is a first-class requirement, not a final polish step. A design
  that is safe but confusing, slow or full of prompts is not the better design.
- **Clean.** Fewer parts, fewer tokens, fewer steps that someone must remember to send.
- **Secure where it counts.** Use an on-chain guard when there is a clear one that costs the player nothing (a cap the
  program keeps, a gate, a refund it enforces). When the only on-chain guard would make playing worse, enforce the rule
  on the server instead, and say so. Most game economies rely on their server, and that is fine when it is stated
  plainly. A small loss of security for a large gain in smoothness is usually the right trade-off; name it when you
  make it.

## The six lenses

Run them before you build, and again before you call it done. Each lens is a question you answer for the design, in
every state it can reach: before it opens, while it runs, completed, won, lost, cancelled or failed, abandoned half-way,
undone ("I changed my mind"), and after it ends. Answer each one as a player, as the owner and as a cheater.

1. **Follow the value.** For everything a player puts in (a token, SOL, an NFT, their time), what do they hold in each
   state, and what can they turn it into? Problems to look for:
   - it comes back as something other than what went in;
   - it can be reversed once the outcome is known;
   - something of value is made from nothing;
   - it is paid out twice, along two paths;
   - it is still produced after its use has ended.
2. **One intent, one step.** For everything a player means to do, count the prompts, signatures and taps, and say what
   each one shows. A problem is more than one step for one intent, a step that does not look like what they asked for,
   or a step the environment does not allow (xgames.fun's play frame allows no forms, pop-ups or top-level
   navigation).
3. **Check every assumption.** Test every number that depends on people (minimums, caps, rates, pool sizes,
   durations) against the participation you actually have or expect, and against the worst single participant (a
   script, or one account at its cap all day). Say which numbers can change only before the first sale, claim or
   launch: those are deadlines.
4. **Who makes it happen.** Every step after a player acts (a reveal, a refund, a payout, a close, a switch, a prize
   shipped): who sends it, who pays, from which key, and what happens if nobody sends it or their machine is off.
5. **Where each rule is enforced.** For every rule the design relies on: is it enforced by the chain, by the server,
   or only by the page? A rule that only the page enforces is no barrier to a script. Read anything shown as true (a
   winner, a balance, a limit) from where it is enforced. Prefer the chain when it costs the player nothing; otherwise
   use the server, and say so.
6. **How the player experiences it.** Walk it as a first-time player on a phone, from the link to the first reward:
   what they need and when they are asked for it (a sign-in, a wallet, SOL), every wait (a cooldown, a draw time, a
   voucher's lifetime), every prompt and what it says, how they find out something is waiting for them, and what they
   see when something fails or ends. A problem is a step that surprises them, a wait they do not understand, a
   prerequisite they cannot meet where they are (for example, inside an app's built-in browser), or an ending they
   never hear about. Two problems are the most common:
   - **A sign-in that is never asked for.** When the game does not sign players in up front, it should ask at the
     moment their progress or reward starts to depend on it, and then bring them back to where they were.
   - **Something waiting where the player is not looking** (a reward, a claim, a next step). Point them to it with a
     notification, a highlight or motion.

Report what you find with a recommendation for each problem. Put deadlines first.

## Worked examples

A promotion game: players pop bubbles to earn a token (POP), swap it for raffle entries, and can win a physical card.
Each row was built exactly as asked, and a single lens finds each problem before it ships. The rows illustrate the
lenses; they are not rules to check one by one.

| What was built                                                                | Lens | What the lens says                                                                     |
| ----------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------- |
| Entries made by burning POP; a draw short of its minimum refunds entries      | 1    | Cancelled: the player holds entries, not the POP they put in.                          |
| A swap from entries back to POP, open at any time                             | 1    | Lost: the player turns their entries back once the outcome is known.                   |
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

## Where else the method appears

- The skill in `skills/bring-your-own-game/` states the same method in its first lines.
- `@xgamesfun/solana` (the economy tools) runs the lenses on an economy spec. `xsolana explain` and `xsolana review`
  end with "Each route, state by state", a walk-through of the spec, and its skill includes "Challenge before you
  build".
