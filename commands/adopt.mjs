// `xcore adopt [folder]`: bring a web game made anywhere, to check it, add an economy and publish it on games.fun
// (../lib/publish/adopt.mjs; README.md).
import { guard, parse, printJson } from '../lib/cli.mjs';
import path from 'node:path';
import { shown } from '../lib/games.mjs';
import { adopt, adoptNext, reportLines } from '../lib/publish/adopt.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore adopt [folder] [--build "<command>"] [--out <dir>] [--static <dir>] [--no-build] [--json]

Bring a web game you already made (plain static files, or a project whose build makes them: Vite, Next.js static
export, Astro, SvelteKit's static adapter, Nuxt generate, Create React App, Parcel, Gatsby, any build script). It reads
the folder's shape, builds it, writes its record (gamesfun.json → page: how it builds and what is published; never
published itself) and lists everything that does not fit games.fun's hosting, each with its fix: no static index.html
(server-side rendering, a Node server as the frontend), secrets, .env files, links, files over the limits, paths from
the root, scripts, styles, fonts or frames from other sites, sites the code names that backend.json does not list.
Then: ${CMD} check (the page in Chrome as the host serves it), ${CMD} backend use custom (a backend you
run), ${CMD} loot add (an economy), ${CMD} publish.
  --build "<cmd>"  the command that makes the published files (default: the project's build script)
  --out <dir>      the folder that is published (default: the build's output, or the folder itself)
  --static <dir>   the folder the build copies as it is (default for Vite, Next.js, Astro, CRA: public), where xcore
                   puts the files it adds (backend.json, xsolana.json, gf/loot/); with no build, a folder apart
                   from --out whose files are laid over it (an engine's export: xcore loot add makes gamesfun/)
  --no-build       read what is built already; do not run the build
  --json           the report as JSON
The folder (default: the one you are in) may be anywhere: in games/ or outside it. Exit code: 0 when nothing is refused or left to fix, else 1.`;

export default {
  name: 'adopt',
  summary: 'bring a web game you already made: its record, and what to fix for games.fun hosting',
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
        printJson({ ...r, dir: shown(r.dir), state, next });
      } else console.log(reportLines(r, { shown }).join('\n'));
      // 1 while anything is refused or left to fix (for scripts and agents); 0 when only "worth a look" remains
      return r.refused.length || r.fix.length ? 1 : 0;
    }, args),
};
