// `xcore plan`: a game's backend plan on xgames.fun, and the account's (../lib/publish/plans.mjs).
import { guard, parse, printJson, failureJson, UsageError, tooMany, folderArg } from '../lib/cli.mjs';
import { resolveGame } from '../lib/games.mjs';
import { accountPlan, describeAccount, describeGame, gamePlan, PER_ACCOUNT } from '../lib/publish/plans.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore plan [dir] [--verbose] [--json]
       xcore plan --all [--verbose] [--json]

The game's folder is the last word or --dir <folder> (default: the current directory).

Show your account's plan, then what a game's backend may use on xgames.fun (its server, saves and scores), and what
it used this month.

Accounts:
  Free       Every account starts here: up to 2 games, each on the Free plan with $1 of use a month.
  Creator    $15 per 30 days, bought in your console → Plans one of two ways, one way at a time:
               - by card: it renews automatically every 30 days, charging the card, until you cancel it in
                 Manage billing (it then runs to the end of the period paid for);
               - prepaid in SOL or USDC, 1 to 12 periods at a time: it does not renew by itself.
             Every game you own, up to 10, runs on the Creator plan, with $10 of use a month shared by them.
             There are no slots to buy or move. After a period ends there are 7 days' grace; then every game drops
             to Free limits and keeps running (nothing is taken down).

Plans (per game):
  Free       A small server (50 ms of CPU per request, 600 requests a minute) and $1 of use a month. Past that, the
             game is capped until the month ends: its server is switched off (every api/ request answers 451), its
             pages keep loading, and saves and scores slow down.
  Creator    Every game of a Creator account. 200 ms per request, 6,000 requests a minute, 1 GB of saves. Past the
             account's included use, more is paid at published unit prices (--verbose lists them): paid by card, it
             goes on the card's invoice, up to the monthly spending cap you set; prepaid, usage credit (bought in SOL
             or USDC) pays for it. Without enough cap or credit, the account's games are capped together.
  Scale      Granted by xgames.fun to a game that needs more.

Every plan lets your own sites embed the game (Free 3, Creator 10, Scale 25: ${CMD} embed). Creator and Scale also
serve it on your own domains (1 and 5: ${CMD} domain). Prices: docs/FEES.md.
Page files and shared relay calls count toward usage. Only server work, rooms and stored data can trigger a cap.

Options:
  --all        your account and every game's plan
  --verbose    also the unit prices of use past what is included
  --json       print xgames.fun's answer as JSON (its account, and the fields older versions printed)`;

export default {
  name: 'plan',
  summary: "show your account's plan, a game's limits and this month's use",
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(
        args,
        { all: { type: 'boolean' }, dir: { type: 'string' }, verbose: { type: 'boolean' } },
        usage,
      );
      // Moving a game between slots is gone (one release keeps the words, to say so): nothing is asked of xgames.fun.
      if (positionals[0] === 'activate' || positionals[0] === 'deactivate') {
        console.error(`xcore: ${PER_ACCOUNT}`);
        if (values.json) printJson({ ...failureJson(PER_ACCOUNT, 'per-account'), next: `${CMD} plan --all` });
        return 2;
      }
      if (positionals.length > 1) throw new UsageError(`${tooMany(positionals.slice(1))}\n\n${usage}`);
      const out = values.json ? printJson : null;
      const plain = e => {
        if (e?.status === 404)
          throw Object.assign(
            new Error(`this xgames.fun does not offer plans yet (${CMD} plan needs a newer xgames.fun).`),
            { code: 'no-plans' },
          );
        throw e;
      };
      const verbose = Boolean(values.verbose);
      if (values.all) {
        const r = await accountPlan().catch(plain);
        if (out) out(r);
        else console.log(describeAccount(r, { verbose }));
        return 0;
      }
      const dir = await resolveGame(folderArg(values.dir, positionals[0], usage));
      const r = await gamePlan(dir).catch(plain);
      if (out) out(r);
      else {
        // the account's month and credit are on its own answer, not the game's: read it too, and go on without it
        const pool = r?.account ? await accountPlan().catch(() => null) : null;
        console.log(describeGame(r, { pool, verbose }));
      }
      return 0;
    }, args),
};
