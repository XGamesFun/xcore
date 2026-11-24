// `xcore adopt [folder]`: bring a web game made anywhere, to check it, add an economy and publish it on xgames.fun
// (../lib/publish/adopt.mjs; docs/COMMANDS.md).
import { failureJson, guard, parse, printJson } from '../lib/cli.mjs';
import path from 'node:path';
import { shown } from '../lib/games.mjs';
import { adopt, adoptNext, reportLines } from '../lib/publish/adopt.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore adopt [folder] [--build "<command>"] [--out <dir>] [--static <dir>] [--no-build] [--json]

Prepare a web game you already made for xgames.fun: record how it builds, and list what to fix before publishing.

It takes plain static files, or a project whose build produces them: Vite, Next.js static export, Astro, SvelteKit's
static adapter, Nuxt generate, Create React App, Parcel, Gatsby, or any build script.

adopt reads the folder, runs the build, and writes the game's record to gamesfun.json ("page": how it builds and which
folder is published; gamesfun.json itself is never published). It then lists everything that does not fit xgames.fun
hosting, each with a fix:
  - no static index.html (server-side rendering, or a Node server as the frontend)
  - secrets, .env files and symbolic links
  - files over the size limits
  - paths from the root (/assets/x.js instead of ./assets/x.js)
  - scripts, styles, fonts or frames loaded from other sites
  - sites the code calls that backend.json does not list

Options:
  --build "<cmd>"  the command that builds the published files (default: the project's build script)
  --out <dir>      the folder that is published (default: the build's output, or the folder itself)
  --static <dir>   the folder the build copies unchanged (default for Vite, Next.js, Astro and CRA: public). xcore
                   puts the files it adds there (backend.json, xsolana.json, gf/loot/). With no build: a separate
                   folder whose files are laid over --out (for an engine's export; xcore loot add creates gamesfun/)
  --no-build       use what is already built; do not run the build
  --json           print the report as JSON

The folder defaults to the current directory and can be anywhere.
Exit code: 0 when nothing is refused or left to fix, otherwise 1.

Next steps:
  ${CMD} check                 run the page in Chrome as xgames.fun serves it
  ${CMD} backend use custom    use a backend you run yourself
  ${CMD} loot add              add an economy
  ${CMD} publish`;

export default {
  name: 'adopt',
  summary: 'prepare a game you already made: write its record and list what to fix for hosting',
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(
        args,
        {
          build: { type: 'string' },
          out: { type: 'string' },
          static: { type: 'string' },
          'no-build': { type: 'boolean' },
        },
        usage,
      );
      const dir = path.resolve(positionals[0] ?? '.'); // this folder, as check and publish read it
      const r = await adopt(dir, {
        build: values.build ?? null,
        out: values.out ?? null,
        static: values.static ?? null,
        noBuild: values['no-build'] === true,
        onLine: values.json ? () => {} : l => console.error(`  build: ${l}`),
      });
      if (values.json) {
        const { state, next } = adoptNext(r, { shown });
        // the report, and one that is refused or has something to fix said as every command's --json says a failure
        const why = r.refused.length
          ? `cannot be hosted as it is: ${r.refused.map(i => i.what).join('; ')}`
          : `fix before publishing: ${r.fix.map(i => i.what).join('; ')}`;
        printJson({ ...r, ...(r.ok ? {} : failureJson(why, state)), dir: shown(r.dir), state, next });
      } else console.log(reportLines(r, { shown }).join('\n'));
      // 1 while anything is refused or left to fix (for scripts and agents); 0 when only "worth a look" remains
      return r.refused.length || r.fix.length ? 1 : 0;
    }, args),
};
