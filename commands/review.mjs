// `xcore review [game] [--live [origin]]`: the pattern-based payout and key review of a brought game (../lib/review.mjs): its economy by
// @xgamesfun/solana's own review, its server and page by this package's reading, and with --live the published game
// asked as a stranger. The record goes in <game>/evidence/review-N/; any high finding exits 1.
import { guard, parse, printJson, UsageError, folderArg, tooMany } from '../lib/cli.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import { readLinks } from '../lib/publish/index.mjs';
import { studioOrigin } from '../lib/publish/client.mjs';
import { CMD } from '../lib/command.mjs';
import { designCodeLine } from '../lib/design-code.mjs';
import { plural } from '../lib/util.mjs';
import { ASK_HEADING, TELL_HEADING } from '../lib/review/record.mjs';
import { liveWords } from '../lib/review/live.mjs';

const usage = `Usage: xcore review [game | --dir <game>] [--live [origin]] [--out <dir>] [--verbose] [--json]

A pattern-based check of a game's economy and server code for payout and key-handling mistakes, read the way a
cheater would: what a script can get without playing, and what to fix first. It is not a security audit.

How it works: it reads the game's code as text, by patterns, and runs none of it. Verdicts:
  PASS          no high finding in what it read, and every payout read through. Never proof that the game is safe
                to pay from: every result says this and lists what it could not read.
  FAIL          a high finding.
  INCONCLUSIVE  no high finding, but a part it could not read through: a payout in code it did not follow (or one
                read by a computed key: ctx[k], Reflect.get(ctx, k); write the field by name, ctx.body, ctx.env.X),
                server code that signs or sends a transaction itself, a file it could not open, or with --live a
                game that did not answer. Make it readable, or check that part yourself. Never a pass.

What it reads:
  the economy  @xgamesfun/solana's own review of the economy file, when the installed version has one: each route
               that pays, what it trusts, its ceiling, its findings, and the trade-offs in plain words
  the server   two analyses:
               - The payout ledger: each route that pays, who signs it, what decides it (the request, or state the
                 server keeps), who is paid, the identity its limits count, its trust level (declared and
                 observed), and its ceiling (identities one person can make × the limit for each × time).
               - Key custody: each key (the test key in .dev.vars, the live key, any key in the page's files or
                 written in the server's code, a secret of env a route answers or a log line prints), every place
                 its bytes are, and who can read them. Key-shaped bytes under no name (64 hex characters, 32 or 64
                 numbers made into bytes) are a medium: a key, or not, is yours to say.
               It also flags a server that does work before checking a player's token, and lists every api/ route.
  design/code  what the economy declares the server does off chain ("offchain", a grant's "serverLimit") compared
               with what server/ does: conversions it does not declare, declarations no code implements, and
               bounds kept only in code. It drafts a declaration for each, and runs the economy check on a copy of
               the spec with the drafts added.

Options:
  --live [origin]  also query the published game as a stranger would: each api/ route with no sign-in and with a
                   forged one (GET and POST; a route that pays gets an empty body, so nothing it sends can spend or
                   sign); api/vouchers/key against the grants' keys; and the published economy's "live" field
                   against this folder's. The origin defaults to the game's link from its last publish. Under
                   ${CMD} dev, give its address (--live http://127.0.0.1:<port>/game/).
  --out <dir>      where the record goes (default: <game>/evidence/review-N/, with review.md and review.json)
  --verbose        print how it reads, every finding with its fix, every question, and the trade-offs (review.md and
                   --json always have all of it)
  --json           print the record as JSON

The record:
  review.md opens with two lists. "Questions to decide" holds questions whose answers change the design. "What this
  build allows" holds the economy check's own sentences, each paid route's ceiling, keys found in the wrong place,
  and what stops when the plan caps the server. review.json has them as ask and tell, each with its source (from).
  review.md ends with the trade-offs: for each route that pays, how the server checks it (decides, replays or
  bounds), what a cheater gets, and what the stronger level would cost.

Exit code: 0 PASS, 1 FAIL, 3 INCONCLUSIVE, also when the review itself could not finish (2 is a usage mistake, as
for every command).
Guide: docs/SERVER.md, "What a payout rests on".`;

/** The exit code of each verdict: PASS 0, FAIL 1 (a high finding), INCONCLUSIVE 3 (a part not read through). */
export const EXIT = { PASS: 0, FAIL: 1, INCONCLUSIVE: 3 };

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
  summary: 'check economy and server code for payout and key mistakes (pattern-based; not an audit)',
  usage,
  run: args =>
    guard(async () => {
      const { rest, live } = liveFlag(args);
      const { values, positionals } = parse(
        rest,
        { out: { type: 'string' }, verbose: { type: 'boolean' }, dir: { type: 'string' } },
        usage,
      );
      if (positionals.length > 1) throw new UsageError(`${tooMany(positionals.slice(1))}\n\n${usage}`);
      const dir = await resolveGame(folderArg(values.dir, positionals[0], usage));
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
      const { reviewGame, unreadWords } = await import('../lib/review.mjs');
      if (base && !values.json) console.error(`Asking ${base} as a stranger (no sign-in, and a forged one)…`);
      let r;
      try {
        r = await reviewGame(dir, { live: base, liveWhy, out: values.out ?? null });
      } catch (e) {
        // a review that could not finish read nothing through: INCONCLUSIVE (3), never FAIL's code or a pass
        const why = String(e?.message ?? e).split('\n')[0];
        // where it stopped, for telling a game it could not read from a fault in the review itself
        const stack = values.verbose && e?.stack ? String(e.stack) : null;
        if (values.json)
          printJson({
            ok: false,
            verdict: 'INCONCLUSIVE',
            error: `the review could not finish: ${why}`,
            code: 'review-unfinished',
            unread: [{ what: shown(dir), why: `the review stopped: ${why}` }],
            ...(stack ? { stack } : {}),
          });
        else {
          console.error(
            `review: INCONCLUSIVE: the review could not finish (${why}). Nothing was read through: fix that, then run ${CMD} review again.`,
          );
          console.error(
            stack
              ? `Where it stopped:\n${stack}`
              : `(${CMD} review --verbose says where it stopped, for a report when the fault is xcore's.)`,
          );
        }
        return EXIT.INCONCLUSIVE;
      }
      if (values.json) printJson(r);
      else console.log(summary(r, shown(dir), unreadWords(r), values.verbose === true));
      return EXIT[r.verdict];
    }, args),
};

/** What the command prints by default: the verdict, what it could not read, high and medium findings with their fix,
 *  low and info findings by name, what was read in one line, and at most three next steps. `verbose`: everything. */
function summary(r, where, unread, verbose = false) {
  if (verbose) return fullSummary(r, where, unread);
  const c = r.counts;
  const lines = [
    `review: ${r.verdict} ${c.high} high, ${c.medium} medium, ${c.low} low, ${c.info} info${unread} · evidence ${shown(r.outDir)}`,
    `  Pattern-based, not a security audit: a PASS is not proof (--verbose says how it reads).`,
    ...r.unread.map(u => `  not read: ${u.what}: ${u.why}`),
  ];
  for (const f of r.findings.filter(f => f.severity === 'high' || f.severity === 'medium')) {
    lines.push(`  ${f.severity.padEnd(6)} ${f.id}${f.route ? ` (${f.route})` : ''}: ${f.message}`);
    if (f.fix) lines.push(`         fix: ${f.fix}`);
  }
  const minor = new Map();
  for (const f of r.findings.filter(f => f.severity === 'low' || f.severity === 'info')) {
    const key = `${f.severity} ${f.id}`;
    minor.set(key, (minor.get(key) ?? 0) + 1);
  }
  for (const [key, n] of minor) lines.push(`  ${key}${n > 1 ? ` ×${n}` : ''}`);
  const read = [
    r.economy.file
      ? r.economy.available
        ? `${r.economy.file} (${plural(r.economy.routes.length, 'route')})`
        : `${r.economy.file} (not reviewed: ${r.economy.why})`
      : 'no economy',
    `server/ (${plural(r.ledger.length, 'paid route')}, ${plural(r.custody.length, 'key')}, ${plural(r.server.routes.length, 'api/ route')})`,
    r.live ? `live: ${liveWords(r.live)}` : 'live: not asked',
  ];
  lines.push(`read: ${read.join('; ')}`);
  const ask = r.ask ?? [];
  const next = [
    ...(c.high ? ['Fix every high finding, then run review again.'] : []),
    ...(ask.length
      ? [`Decide the ${plural(ask.length, 'question')} in ${shown(r.outDir)}/review.md ("${ASK_HEADING}").`]
      : []),
    ...(r.tradeoffs.length ? [`Choose each paid route's level: review.md ends with the trade-offs.`] : []),
    ...(r.live ? [] : [`After publishing: ${CMD} review ${where === '.' ? '.' : where} --live`]),
  ].slice(0, 3);
  if (next.length) lines.push('Next:', ...next.map((n, i) => `  ${i + 1}. ${n}`));
  return lines.join('\n');
}

/** What the command prints with --verbose: the verdict, how it was reached, each finding, and where the record and the trade-offs are. */
function fullSummary(r, where, unread) {
  const c = r.counts;
  const lines = [
    `review: ${r.verdict} ${c.high} high, ${c.medium} medium, ${c.low} low, ${c.info} info${unread} · evidence ${shown(r.outDir)}`,
    ...r.method.map(l => `  ${l}`),
    ...r.unread.map(u => `  not read: ${u.what}: ${u.why}`),
  ];
  for (const f of r.findings) {
    lines.push(`  ${f.severity.padEnd(6)} ${f.id}${f.route ? ` (${f.route})` : ''}: ${f.message}`);
    if (f.fix && f.severity !== 'info') lines.push(`         fix: ${f.fix}`);
  }
  lines.push(
    r.economy.file
      ? r.economy.available
        ? `economy: ${r.economy.file}, ${plural(r.economy.routes.length, 'route')} reviewed by @xgamesfun/solana ${r.economy.version}`
        : `economy: ${r.economy.file} not reviewed: ${r.economy.why}`
      : `economy: ${where} has none`,
    `server: ${plural(r.ledger.length, 'paid route')} in the ledger, ${plural(r.custody.length, 'key')} in custody; ${plural(r.server.routes.length, 'api/ route')} named${r.server.facts.vouchers ? `; PAY.check ${r.server.facts.pay === 'template' ? 'is still the template' : r.server.facts.pay}, payOnly ${r.server.facts.payOnly ?? '?'}` : ''}`,
    designCodeLine(r.designCode),
    r.live ? `live: ${liveWords(r.live)}, ${r.live.asked ?? r.live.probes.length} requests` : `live: ${r.liveWhy}`,
  );
  for (const t of r.tradeoffs)
    lines.push(
      `paid route ${t.route}: ${t.trust ? `${t.trust}${t.declared ? '' : ' (read so by the economy review; not declared)'}` : 'trust not declared'}${t.observed === 'request' ? ', observed: the request alone' : ''}; ${t.bounded ? 'bounded' : 'unbounded'}`,
    );
  if (r.tradeoffs.length)
    lines.push(
      `Trade-offs: ${shown(r.outDir)}/review.md ends with each paid route's level, what a cheater gets and what a stronger level costs. Which to take is your decision.`,
    );
  const ask = r.ask ?? [],
    tell = r.tell ?? [];
  const fromEconomy = list => list.filter(x => x.from === 'economy').length;
  lines.push(
    `questions to decide: ${ask.length} (${fromEconomy(ask)} from the economy); facts about this build: ${tell.length} (${fromEconomy(tell)} from the economy)${r.told?.why ? `; the economy's own: none (${r.told.why})` : ''}`,
  );
  // the questions themselves, here, so a reader of this summary alone still sees what is theirs to decide
  for (const a of ask) lines.push(`  ? ${String(a.text ?? a).replace(/^\?\s*/, '')}`);
  if (ask.length || tell.length)
    lines.push(
      `review.md lists both: "${ASK_HEADING}" ("? ") and "${TELL_HEADING}" ("> "). Decide the questions before building on the answers.`,
    );
  return lines.join('\n');
}
