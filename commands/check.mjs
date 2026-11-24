// `xcore check [dir]`: the page check (../lib/check.mjs) on a game you brought: it builds, fits xgames.fun's hosting,
// starts clean in Chrome as the play host serves it, and stays inside its origins. publish runs the same check first.
import { failureJson, guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import { madeByKit } from '../lib/publish/index.mjs';
import { CMD } from '../lib/command.mjs';
import { cardPrinted } from '../lib/card.mjs';

const usage = `Usage: xcore check [dir] [--no-build] [--out <dir>] [--port <n>] [--json]

Check the game's page as xgames.fun hosts it. Run ${CMD} adopt <dir> first.

The check has four steps:
  1. It builds (gamesfun.json page.build).
  2. It fits the hosting: nothing publish would refuse, and nothing that breaks once hosted (paths from the root;
     scripts, styles, fonts or frames from other sites).
  3. It starts without errors in Chrome, at a phone's size and a desktop's, under the play host's page policy.
  4. It stays inside its origins: its own files, the host's own paths, and the origins in backend.json.

It does not check that the game plays correctly; that is for your game's own tests.

It also reports on the preview picture (assets/card.jpg, shown when a link to the game is shared; ${CMD} card makes
one). A missing picture, or one that will not draw or will be cropped or blurry, is a warning, never a failure.

Options:
  --no-build   check what is already built; do not run the build
  --out <dir>  where the record and screenshots go (default: <dir>/evidence/verify-N/)
  --port <n>   the port to serve the page on (default: any free port)
  --json       print the record as JSON`;

/** The checks' results in words: "3 passed, 1 skipped", "1 passed, 2 failed, 1 skipped". */
export function checkCounts(checks) {
  const n = ok => checks.filter(c => c.ok === ok).length;
  const parts = [`${n(true)} passed`];
  if (n(false)) parts.push(`${n(false)} failed`);
  if (n(null)) parts.push(`${n(null)} skipped`);
  return parts.join(', ');
}

export default {
  name: 'check',
  summary: 'check the page as xgames.fun hosts it: build, hosting rules, a clean start in Chrome',
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(
        args,
        { 'no-build': { type: 'boolean' }, out: { type: 'string' }, port: { type: 'string' } },
        usage,
      );
      const dir = await resolveGame(positionals[0]);
      if (madeByKit(dir))
        throw new Error(
          `${shown(dir)} was made with the game-making kit. Its check is the kit's own (\`${CMD} verify\`, six gates), which runs only where the kit is installed. The kit is not released yet.`,
        );
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
      // the record, and a failed check said as every command's --json says a failure (ok, error, code)
      const failed = r.checks.filter(c => c.ok === false);
      if (values.json)
        printJson({
          ...(r.pass
            ? { ok: true }
            : failureJson(
                failed.length
                  ? `the page check failed: ${failed.map(c => `${c.n} ${c.name}`).join('; ')}`
                  : 'the page check did not run',
                'check',
              )),
          ...r,
        });
      else {
        for (const n of r.notes) console.log(`note: ${n}`);
        // a warning when it is missing, cannot be drawn, or will be cropped or blurry; never a failed check
        if (r.card) console.log(cardPrinted(r.card));
        console.log(`\ncheck: ${r.pass ? 'PASS' : 'FAIL'}, ${checkCounts(r.checks)} · evidence ${shown(r.outDir)}`);
      }
      return r.pass ? 0 : 1;
    }, args),
};
