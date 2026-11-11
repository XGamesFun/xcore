// `xcore check [dir]`: the page check (../lib/check.mjs) on a game you brought: it builds, fits xgames.fun's hosting,
// starts clean in Chrome as the play host serves it, and stays inside its origins. publish runs the same check first.
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import { madeByKit } from '../lib/publish/index.mjs';
import { CMD } from '../lib/command.mjs';
import { cardPrinted } from '../lib/card.mjs';

const usage = `Usage: xcore check [dir] [--no-build] [--out <dir>] [--port <n>] [--json]

The page check, as xgames.fun hosts the game: 1 it builds (gamesfun.json page.build), 2 it fits the hosting (what
publish would refuse, and what breaks once hosted: paths from the root, scripts, styles, fonts or frames from other
sites), 3 it starts clean in Chrome at a phone's size and a desktop's under the play host's page policy, 4 it stays
inside its origins (its own files, the host's own paths, backend.json's origins). It does not check that the game plays
as it should: that is your own game's tests. Run ${CMD} adopt <dir> first. It also says whether the game has a preview
picture (assets/card.jpg, what a shared link shows; ${CMD} card makes one): a warning when it has none, or one that
will not draw, or be cropped or blurry; never a failed check.
  --no-build   check what is built already; do not run the build
  --out <dir>  where the record and the screenshots go (default: <dir>/evidence/verify-N/)
  --port <n>   the port the check serves the page on (default: any free one)
  --json       the record as JSON`;

export default {
  name: 'check',
  summary: 'the page check: it builds, fits xgames.fun hosting, starts clean, stays inside its origins',
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(
        args,
        { 'no-build': { type: 'boolean' }, out: { type: 'string' }, port: { type: 'string' } },
        usage,
      );
      const dir = await resolveGame(positionals[0]);
      if (madeByKit(dir)) {
        console.error(
          `${shown(dir)} was made with the kit: its check is the kit's six gates (${CMD} verify, with @xgamesfun/kit installed).`,
        );
        return 1;
      }
      const port = values.port === undefined ? 0 : Number(values.port);
      if (values.port !== undefined && !(Number.isInteger(port) && port >= 1 && port <= 65535))
        throw new UsageError(`--port takes a port number (1–65535)\n\n${usage}`);
      const { pageVerify } = await import('../lib/check.mjs');
      const r = await pageVerify(dir, {
        noBuild: values['no-build'] === true,
        out: values.out ?? null,
        port,
        log: l => (values.json ? console.error : console.log)(l),
      });
      if (values.json) printJson(r);
      else {
        for (const n of r.notes) console.log(`note: ${n}`);
        // a warning when it is missing, cannot be drawn, or will be cropped or blurry; never a failed check
        if (r.card) console.log(cardPrinted(r.card));
        const ran = r.checks.filter(c => c.ok !== null),
          skipped = r.checks.length - ran.length;
        console.log(
          `\ncheck: ${r.pass ? 'PASS' : 'FAIL'} ${ran.filter(c => c.ok).length}/${ran.length}` +
            `${skipped ? ` (${skipped} skipped)` : ''} · evidence ${shown(r.outDir)}`,
        );
      }
      return r.pass ? 0 : 1;
    }, args),
};
