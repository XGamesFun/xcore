// `xcore data export`: a published game's player saves and leaderboards, from xgames.fun (../lib/data-export.mjs).
import { guard, parse, printJson, UsageError, notOneOf, verbNamed } from '../lib/cli.mjs';
import { named, resolveGame, shown } from '../lib/games.mjs';
import { exportData } from '../lib/data-export.mjs';
import { sizeText } from '../lib/util.mjs';

const usage = `Usage: xcore data export [--dir <game>] [--out <file> [--force]] [--json]

Download every player's saves and every leaderboard's entries of the published game, from xgames.fun, into one JSON
file. Signed in as the game's owner (xcore login); never from a GitHub Actions run. Each export is kept in the game's
audit log on xgames.fun.

Each player is the game's player id on xgames.fun, as its console shows them, never their X id or wallet. A save's
value is the game's own JSON, whole. Hidden or banned players' board entries are there too, marked "hidden".

The file goes in .gamesfun/exports/ (kept out of git and never published: it holds your players' data), or --out
<file>. It is readable by you only. A file among the game's published files is refused (the next publish would make it
public), and an existing one is written over only with --force.

Options:
  --dir <game>   the game's folder (default: the current directory)
  --out <file>   where to write the file
  --force        write over a file that is there already
  --json         print the result as JSON

The game's database has its own export (xcore db export --live), and its project files theirs (xcore files get --live).`;

export default {
  name: 'data',
  summary: "export the published game's player saves and leaderboards",
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(
        args,
        { dir: { type: 'string' }, out: { type: 'string' }, force: { type: 'boolean' } },
        usage,
      );
      const verbs = ['export'];
      const verb = verbNamed(positionals[0], verbs);
      if (!verb) throw new UsageError(`${notOneOf(positionals[0], verbs)}\n\n${usage}`);
      if (positionals.length > 1) throw new UsageError(`export takes no other words: --dir names the game\n\n${usage}`);
      const dir = await resolveGame(values.dir);
      const r = await exportData(dir, {
        out: values.out ?? null,
        force: !!values.force,
        progress: values.json ? () => {} : line => console.error(line),
      });
      if (values.json) return printJson({ ...r, file: shown(r.file) });
      const entries = r.boards.reduce((n, b) => n + b.entries, 0);
      console.log(
        `${named(dir)}: ${r.saves} save${r.saves === 1 ? '' : 's'} and ${entries} board entr${entries === 1 ? 'y' : 'ies'} (${r.boards.length} board${r.boards.length === 1 ? '' : 's'}) in ${shown(r.file)} (${sizeText(r.bytes)}). It holds your players' data: keep it out of git and anywhere public.`,
      );
      return 0;
    }, args),
};
