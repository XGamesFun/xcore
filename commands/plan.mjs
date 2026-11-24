// `xcore plan`: a game's backend plan on xgames.fun (../lib/publish/plans.mjs).
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame } from '../lib/games.mjs';
import { accountPlan, describeAccount, describeGame, gamePlan, setActive } from '../lib/publish/plans.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore plan [dir] [--json]
       xcore plan --all [--json]
       xcore plan activate [dir] [--json]
       xcore plan deactivate [dir] [--json]

Show what a game's backend may use on xgames.fun (its server, saves and scores), and what it used this month.

Plans:
  Free       The default for every game. A small server (50 ms of CPU per request, 600 requests a minute) and $1 of
             use a month. Past that, the game is capped until the month ends: its server is switched off (every
             api/ request answers 451), its pages keep loading, and saves and scores slow down.
  Creator    A game in one of your paid slots. 200 ms per request, 6,000 requests a minute, 1 GB of saves, and $10
             of use a month per paid slot, shared by your Creator games.
  Scale      Granted by xgames.fun to a game that needs more.

Every plan lets your own sites embed the game (Free 3, Creator 10, Scale 25: ${CMD} embed). Creator and Scale also
serve it on your own domains (1 and 5: ${CMD} domain).

Slots and prices:
  - Every game uses a slot. Everyone gets 2 free slots; games in them run on Free.
  - Each further game needs a paid slot: $15 for 30 days, prepaid in SOL or USDC on xgames.fun (your console →
    Plans). It does not renew automatically. A game in a paid slot runs on Creator.
  - You can move a paid slot between your games at any time; the bill does not change.
  - Usage credit, bought the same way, lets Creator games go past what their slots include instead of being capped.
    It is charged at twice what xgames.fun pays.
  - Every cost in one table: docs/FEES.md.

Commands:
  activate     move this folder's game to a paid slot (its free slot becomes available for another game)
  deactivate   move it back to a free slot (one must be available; its paid slot becomes available for another game)

Options:
  --all        list your free and paid slots and every game's plan
  --json       print the result as JSON`;

export default {
  name: 'plan',
  summary: "show a game's plan, limits and this month's use; move it between slots",
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(args, { all: { type: 'boolean' } }, usage);
      const [first, second] = positionals;
      const verb = first === 'activate' || first === 'deactivate' ? first : null;
      if (positionals.length > (verb ? 2 : 1)) throw new UsageError(usage);
      const out = values.json ? printJson : null;
      const plain = e => {
        if (e?.status === 404)
          throw Object.assign(
            new Error(`this xgames.fun does not offer plans yet (${CMD} plan needs a newer xgames.fun).`),
            { code: 'no-plans' },
          );
        throw e;
      };
      if (values.all) {
        if (verb) throw new UsageError(`--all lists; activate and deactivate take a game folder\n\n${usage}`);
        const r = await accountPlan().catch(plain);
        if (out) out(r);
        else console.log(describeAccount(r));
        return 0;
      }
      const dir = await resolveGame(verb ? second : first);
      if (!verb) {
        const r = await gamePlan(dir).catch(plain);
        if (out) out(r);
        else console.log(describeGame(r));
        return 0;
      }
      const r = await setActive(dir, verb === 'activate').catch(e => {
        // which games sit in which slots is what the person needs next, whichever slot is missing
        if (e?.status === 409)
          throw Object.assign(
            new Error(
              e.code === 'no-free-slot'
                ? `${e.message} Archive a game you no longer need on your console (xgames.fun/console), or move another game to a paid slot.`
                : `${e.message} Open one with ${CMD} plan deactivate <another game>, or buy a paid slot on xgames.fun (your console → Plans, in SOL or USDC).`,
            ),
            { code: e.code ?? 'no-slot', next: `${CMD} plan --all` },
          );
        return plain(e);
      });
      if (out) out(r);
      else {
        const what =
          verb === 'activate'
            ? r.changed
              ? 'In a paid slot: Creator from its next request; its free slot is open for another game.'
              : 'Already in a paid slot.'
            : r.changed
              ? 'Back in a free slot: Free from its next request, and its paid slot is open for another game.'
              : 'It was not in a paid slot.';
        console.log(`${what}\n${describeGame(r)}`);
      }
      return 0;
    }, args),
};
