# Before you build: challenge first, then walk it through

This page is for the agent building with xcore, and for the person it builds for. It comes from one day of running a
real promo on xgames.fun (a bubble popper whose players earn a token, buy raffle tickets with it, and win a physical
card). Every trap below was built exactly as asked, worked as built, and was still wrong. The person found each one
after it shipped. None of them needed the person to find it.

Two habits catch them: **challenge before you build**, and **walk it through before you say it is done**.

## 1. Challenge before you build

The person tells you what they want. Your job is the outcome they want, not the mechanism they named. Before building
a request that touches money, a token, a flow a player taps through, or anything that can't be undone:

1. **Name the simplest version that gets most of it.** Often it is 90% of what they asked and far smoother: one
   currency instead of two, one wallet prompt instead of three, a rule the chain already keeps instead of one a server
   has to remember.
2. **Say what each version costs.** Wallet prompts a player sees, moving parts, states it can end up in (cancelled,
   refunded, half-done), and who must act after it happens (and what happens if nobody does).
3. **Recommend one, and say why in a sentence.** Not a survey of options.
4. **Build what they asked only after they have seen that trade and still want it.** If they still want it, build it
   well; you have done your part.

Challenge the economy, the flow and anything irreversible. Don't challenge taste (colours, names, copy they wrote),
and don't challenge the same decision twice: once they have heard the trade, it is theirs.

What it sounds like:

> Burning the BUBL when a player buys an entry means a cancelled draw refunds entries, not BUBL: players get back the
> token they bought, never the one they earned. Pricing tickets in BUBL directly refunds BUBL and drops a token, but
> then the free ticket needs another shape. I'd keep entries and not burn at purchase: the BUBL goes back to the pool,
> and a cancelled draw can be swapped back. Want that instead?

## 2. Walk it through before you say it is done

Before you report a feature finished, play it in your head through every state it can reach, as three people:

| State                    | As a player                                                                 | As the owner                                              | As a cheater                                                |
| ------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| Before it opens          | What do I see? What can I do yet?                                           | What must be set up, funded, switched on?                 | Can I act early?                                            |
| While it runs            | What does each tap do? What does each wallet prompt show?                   | What do I watch? What can I still change, and until when? | What does a script get without playing?                     |
| It fails or is cancelled | What do I get back, in which token, and do I have to do anything?           | Who sends the refund or the cancel? From which key?       | Can I make it fail on purpose, or profit from it failing?   |
| It succeeds              | What did I win, and how do I get it (a physical prize: who ships it where)? | How do I reach the winner?                                | Can I make myself look like the winner?                     |
| After it ends            | Does the game still tell me to earn something I can no longer use?          | What runs next, or what says it is over?                  | Can I undo what I paid (a swap back, a refund) once I lost? |
| I changed my mind        | Can I undo it? Should I be able to?                                         | Do I want undos at all?                                   | Is the undo a free option on the outcome?                   |

Write down each problem you find with a recommendation, and bring them with the result. A deadline (something that
can only change before the first sale, the first claim, going live) goes first.

## 3. The traps, and what catches each

Each trap is what was built, why it went wrong, and the question that would have caught it.

### Money and tokens

- **Burn at purchase, refund at cancel.** Entries were made by burning BUBL; a raffle short of its minimum cancelled
  and refunded entries. Players never got their BUBL back. _A refund returns what the ticket cost, not what the
  player paid to get it._ Ask: if this is cancelled, what does the player hold afterwards, and is that what they put
  in?
- **A two-way swap is a free option.** Making entries swappable back to BUBL at any time let anyone who lost (or
  changed their mind) undo the purchase. _An undo that is open after the outcome is known undoes the outcome._ Open
  it only for the case it is for (a cancelled draw), and let the chain enforce that (a recipe switched off is refused
  on chain).
- **A free token that is the same token as a paid one.** The free login entry was the same token as a bought one, so
  once entries could be swapped back, the free one was worth 100 BUBL. _Fungible means the chain can't tell which is
  which._ Ask: should the free thing ever become the paid thing?
- **Two currencies where one does.** BUBL, then an entry made from BUBL, then a ticket bought with the entry: three
  things for the player to understand, and a refund in the middle one. Ask whether the intermediate token earns its
  place; often a ticket priced in the earned token is simpler, and the reason to keep two should be said aloud.
- **A cap per hour is not a cap per day.** An hourly cap of 1,750 still lets one account take 42,000 a day. Say the
  daily figure, and the pool's life at the worst case, when you set a rate.
- **Limits that count claims, not amounts.** A grant's `perDay` counted claims; the amount was bounded elsewhere. Say
  which number bounds the value.

### Draws and events

- **A minimum nobody can reach.** A raffle needed 100 tickets; the game had two players. It was cancelled, then the
  next one was headed the same way. The minimum can only change before the first ticket. _Compare every threshold
  with the players you actually have, and say so before it opens._
- **Steps that wait for someone.** A cancelled raffle's refunds are pulled one by one; a draw is revealed by someone
  sending it; a swap back was opened by a timer on one computer. For each: who sends it, from which key, who pays, and
  what happens if their machine is off.
- **Nothing after the end.** Once the draw is done, the game still asks players to earn a token with no use left. Plan
  the next event, or the "it's over" state, before the first one ends.
- **A physical prize with no hand-off.** The winner's handle shows; nothing collects where to ship. Decide how you
  reach the winner before anyone wins.

### What the player taps

- **Every wallet prompt must look like what the player asked for.** "Buy 10 tickets" opened a prompt for 4 (making
  the 4 entries they lacked, before a second prompt for the 10). It looked like a bug. One transaction for one intent
  (loot's `buyTickets` takes `make` for this), or say "2 approvals" before the first one opens.
- **The play frame has rules.** xgames.fun frames a game with no forms, no pop-ups and no top-level navigation: a
  `<form>` submit or `window.open` silently does nothing there. Test inside the frame, not the bare game.
- **Permanent UI must belong.** A floating chip added for one number didn't match anything else on screen; a pop-up
  card for a milestone looked unlike the game. Place a new element where the existing layout already has a slot (a
  line under a pill, mirroring the line under the score) before inventing a new one.
- **A rule the page shows is not a rule.** Anything only the page enforces (a button hidden, a count checked in the
  browser) is a suggestion to a script. Put the rule on chain or on the server, and let the page mirror it.

### Bots and trust

- **A check a script can guess.** Human checks with a handful of possible answers, no penalty for a wrong one and a
  free "another one" let a blind script pass in about 15 tries. Count wrong answers across checks, lock out after a
  few, and make every check look alike to the page.
- **The claim that pays twice.** A voucher for a wallet, abandoned and asked again for another wallet, paid twice
  when the first was claimed on chain. Before giving value back from an unclaimed voucher, ask the chain whether it
  was claimed, and close it first (on the chain's clock, not the server's).
- **Who is the winner.** Anything a page says about who holds a prize must be checked on chain before it is shown.

### Setting up

- **Sign setup with a key file, not a wallet page.** A browser wallet may change a transaction before signing it (an
  extra instruction), and a long setup in a web page fails half-way. Setup and owner changes sign with a local key
  file; a page opens only if the person asks for one.
- **Check the clock before you write a time.** Times estimated from memory ran hours off; run `date -u` before
  writing a time or acting on a deadline.

## Where this lives

- This page is the reference. The skill in `skills/bring-your-own-game/` says the two habits in its first lines.
- `@xgamesfun/solana` (the economy tools) is asked to raise the economy traps as checker warnings and to end
  `xsolana explain` with the walk-through for the spec in front of it, so an agent sees them at the moment it decides.
