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
  the server   PAY.check written or still the template, or paying from the request alone; VOUCHERS.payOnly against
               the grants; the voucher key and the grants that name it; "trust" on every grant a voucher pays;
               .dev.vars in git or in the published folder; a seed or key in the page's files; every api/ route
  --live       the published game asked as a stranger: each api/ route with no sign-in and with a forged one (GET
               and POST; a route that pays gets an empty body, so nothing it sends can spend or sign);
               api/vouchers/key against the grants' keys; the published economy's "live" against this folder's.
               The origin defaults to the game's link from its last publish; under ${CMD} dev, give its address
               (--live http://127.0.0.1:<port>/game/).
  --out <dir>  where the record goes (default: <game>/evidence/review-N/: review.md and review.json)
  --json       the record as JSON
review.md ends with the trade-offs for the person: for each route that pays, how the server checks it (decides,
replays or bounds), what a cheater gets, and what the stronger level would cost. Any high finding exits 1.
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
    `server: ${r.server.routes.length} api/ routes named${r.server.facts.vouchers ? `; PAY.check ${r.server.facts.pay === 'template' ? 'is still the template' : r.server.facts.pay}, payOnly ${r.server.facts.payOnly ?? '?'}` : ''}`,
    r.live ? `live: ${r.live.base}, ${r.live.probes.length} requests` : `live: ${r.liveWhy}`,
  );
  for (const t of r.tradeoffs)
    lines.push(
      `paid route ${t.route}: ${t.trust ? `${t.trust}${t.declared ? '' : ' (read so by the economy review; not declared)'}` : 'trust not declared'}`,
    );
  if (r.tradeoffs.length)
    lines.push(
      `For the person: ${shown(r.outDir)}/review.md ends with each paid route's level, what a cheater gets and what the stronger level costs. Tell them, and let them choose.`,
    );
  return lines.join('\n');
}
