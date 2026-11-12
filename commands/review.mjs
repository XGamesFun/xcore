// `xcore review [game] [--live [origin]]`: the security review of a brought game (../lib/review.mjs): its economy by
// @xgamesfun/solana's own review, its server and page by this package's reading, and with --live the published game
// asked as a stranger. The record goes in <game>/evidence/review-N/; any high finding exits 1.
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import { readLinks } from '../lib/publish/index.mjs';
import { studioOrigin } from '../lib/publish/client.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore review [game] [--live [origin]] [--out <dir>] [--json]

The security review of a game, read as a cheater would: what a script gets without playing, and what to fix first.
  the economy  @xgamesfun/solana's own review of the economy file (each route that pays: what it trusts, its ceiling,
               its findings, the trade-offs in words), when the installed one has it
  the server   two analyses. The payout ledger: each route that pays, who signs it, what decides it (the request
               or state the server keeps), who is paid, the identity its limits count, its trust declared and
               observed, and its ceiling (identities one person makes × the limit for each × time). Key custody:
               each key (the test key in .dev.vars, the live key, any in the page's files), every place its bytes
               are and who can read it. Also a server that works before checking a token, and every api/ route
  --live       the published game asked as a stranger: each api/ route with no sign-in and with a forged one (GET
               and POST; a route that pays gets an empty body, so nothing it sends can spend or sign);
               api/vouchers/key against the grants' keys; the published economy's "live" against this folder's.
               The origin defaults to the game's link from its last publish; under ${CMD} dev, give its address
               (--live http://127.0.0.1:<port>/game/).
  --out <dir>  where the record goes (default: <game>/evidence/review-N/: review.md and review.json)
  --json       the record as JSON
review.md opens with two blocks for the person: "Ask the person" (questions whose answers change the design) and
"Tell the person, as written" (final sentences: the economy check's own, each paid route's ceiling, keys out of place,
and what stops when the plan caps the server); review.json has them as ask and tell, each with its from. It ends with
the trade-offs: for each route that pays, how the server checks it (decides, replays or bounds), what a cheater gets,
and what the stronger level would cost. Any high finding exits 1.
docs/SERVER.md, "What a payout rests on", is the guide.`;

/** --live takes an origin or nothing: `--live`, `--live <http…>`, `--live=<http…>`. → {args without it, live} */
export function liveFlag(args) {
  const rest = [];
  let live = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--live') {
      live = true;
      if (/^https?:\/\//i.test(args[i + 1] ?? '')) live = args[++i];
    } else if (a.startsWith('--live=')) live = a.slice('--live='.length) || true;
    else rest.push(a);
  }
  return { rest, live };
}

export default {
  name: 'review',
  summary: 'the security review: what a cheater gets from its economy and server, with --live the published game',
  usage,
  run: args =>
    guard(async () => {
      const { rest, live } = liveFlag(args);
      const { values, positionals } = parse(rest, { out: { type: 'string' } }, usage);
      const dir = await resolveGame(positionals[0]);
      let base = null,
        liveWhy = `not asked for (${CMD} review --live)`;
      if (typeof live === 'string') {
        try {
          base = new URL(live).href;
        } catch {
          throw new UsageError(`--live takes an address (https://… or http://127.0.0.1:<port>/game/)\n\n${usage}`);
        }
      } else if (live) {
        const known = (await readLinks(dir))[studioOrigin()];
        base = known?.gameUrl ?? null;
        if (!base) {
          liveWhy = `${shown(dir)} has no published link here: publish it, or run ${CMD} dev and give its address (--live http://127.0.0.1:<port>/game/)`;
          if (!values.json) console.error(`Not asked live: ${liveWhy}.`);
        }
      }
      const { reviewGame } = await import('../lib/review.mjs');
      if (base && !values.json) console.error(`Asking ${base} as a stranger (no sign-in, and a forged one)…`);
      const r = await reviewGame(dir, { live: base, liveWhy, out: values.out ?? null });
      if (values.json) printJson(r);
      else console.log(summary(r, shown(dir)));
      return r.ok ? 0 : 1;
    }, args),
};

/** What the command prints: the verdict, each finding, and where the record and the trade-offs are. */
function summary(r, where) {
  const c = r.counts;
  const lines = [
    `review: ${r.ok ? 'PASS' : 'FAIL'} ${c.high} high, ${c.medium} medium, ${c.low} low, ${c.info} info · evidence ${shown(r.outDir)}`,
  ];
  for (const f of r.findings) {
    lines.push(`  ${f.severity.padEnd(6)} ${f.id}${f.route ? ` (${f.route})` : ''}: ${f.message}`);
    if (f.fix && f.severity !== 'info') lines.push(`         fix: ${f.fix}`);
  }
  lines.push(
    r.economy.file
      ? r.economy.available
        ? `economy: ${r.economy.file}, ${r.economy.routes.length} routes reviewed by @xgamesfun/solana ${r.economy.version}`
        : `economy: ${r.economy.file} not reviewed: ${r.economy.why}`
      : `economy: ${where} has none`,
    `server: ${r.ledger.length} paid routes in the ledger, ${r.custody.length} keys in custody; ${r.server.routes.length} api/ routes named${r.server.facts.vouchers ? `; PAY.check ${r.server.facts.pay === 'template' ? 'is still the template' : r.server.facts.pay}, payOnly ${r.server.facts.payOnly ?? '?'}` : ''}`,
    r.live ? `live: ${r.live.base}, ${r.live.probes.length} requests` : `live: ${r.liveWhy}`,
  );
  for (const t of r.tradeoffs)
    lines.push(
      `paid route ${t.route}: ${t.trust ? `${t.trust}${t.declared ? '' : ' (read so by the economy review; not declared)'}` : 'trust not declared'}${t.observed === 'request' ? ', observed: the request alone' : ''}; ${t.bounded ? 'bounded' : 'unbounded'}`,
    );
  if (r.tradeoffs.length)
    lines.push(
      `For the person: ${shown(r.outDir)}/review.md ends with each paid route's level, what a cheater gets and what the stronger level costs. Tell them, and let them choose.`,
    );
  const ask = r.ask ?? [],
    tell = r.tell ?? [];
  const fromEconomy = list => list.filter(x => x.from === 'economy').length;
  lines.push(
    `ask the person: ${ask.length} question${ask.length === 1 ? '' : 's'} (${fromEconomy(ask)} from the economy); tell the person: ${tell.length} sentence${tell.length === 1 ? '' : 's'} (${fromEconomy(tell)} from the economy)${r.told?.why ? `; the economy's own: none (${r.told.why})` : ''}`,
  );
  if (ask.length || tell.length)
    lines.push(
      `Pass them on as written: review.md's "Tell the person, as written" lines ("> ") said as they are, its "Ask the person" questions ("? ") asked before building on the answers; neither kept in private notes.`,
    );
  return lines.join('\n');
}
