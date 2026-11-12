// `xcore plan`: a game's backend plan on xgames.fun (../lib/publish/plans.mjs).
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame } from '../lib/games.mjs';
import { accountPlan, describeAccount, describeGame, gamePlan, setActive } from '../lib/publish/plans.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore plan [dir] [--json]
       xcore plan --all [--json]
       xcore plan activate [dir] [--json]
       xcore plan deactivate [dir] [--json]

What a game's backend may use on xgames.fun (its server, saves and scores), and what it used this month.
  Free       every game, by default: a small server (50 ms of CPU a request, 600 requests a minute) and $1 of use a
             month; past that its server is capped (slow) until the month ends
  Creator    a game in one of your paid slots: 200 ms a request, 6,000 requests a minute, 1 GB of saves, and
             $10 of use a month per paid slot, shared by your Creator games
  Scale      granted by xgames.fun for a game that needs more
Every plan lets sites of yours embed the game (Free 3, Creator 10, Scale 25: ${CMD} embed); Creator and Scale serve
it on domains of your own (1 and 5: ${CMD} domain).
Every game sits in a slot. Everyone gets 2 free slots, whose games run on Free; any more games need a paid slot,
$15 for 30 days, prepaid in SOL or USDC on xgames.fun (your console → Plans; no automatic renewal), whose game runs on
Creator. A paid slot moves between your games at any time without changing the bill. Usage credit, bought the same way,
lets Creator games go past what their slots include (at twice what xgames.fun pays) instead of slowing down.
  activate     move this folder's game to a paid slot (its free slot opens for another game)
  deactivate   move it back to a free slot (one must be open; its paid slot opens for another game)
  --all        your free and paid slots and every game's plan`;

export default {
  name: 'plan',
  summary: "a game's backend plan on xgames.fun (Free, Creator, Scale): its limits, this month's use, game slots",
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
