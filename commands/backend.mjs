// `xcore backend use custom`: a backend you already run on the public internet (an API, a WebSocket server). It
// writes backend.json with its URL and the origins the page talks to, so games.fun's play host lets the published page
// reach them (its page policy opens to exactly those). Nothing is signed in to or deployed; its keys stay on its
// server. A backend the kit connects for you (Supabase, Railway) is the kit's: `backend connect` with @xgamesfun/kit.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import { backendOrigins, BACKEND_FILE } from '../lib/publish/scan.mjs';
import { pageRoots } from '../lib/publish/page.mjs';
import { CMD } from '../lib/command.mjs';
import { ownOrigins, studioOrigin } from '../lib/publish/client.mjs';

const usage = `Usage: xcore backend use custom [dir] --url <https://…> [--origin <wss://…>]… [--json]

Your own backend, already running: backend.json names its public URL's origin, its wss:// twin, and every other origin
the page talks to (--origin, at most 8 in all), so the published page may reach them; any other site stays out of reach. Its keys stay on its server: a game carries
only a key made to be public. It answers CORS for the game's origin (https://<slug>-play.xgames.fun once published).
A brought game with a build keeps backend.json in the folder its build copies as it is (gamesfun.json page.static).
A backend made for you (Supabase, Railway) is the kit's: ${CMD} backend connect supabase, with @xgamesfun/kit.`;

export default {
  name: 'backend',
  summary: 'use your own backend: backend.json names the origins the published page may reach',
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(
        args,
        { url: { type: 'string' }, origin: { type: 'string', multiple: true } },
        usage,
      );
      if (positionals[0] !== 'use' || positionals[1] !== 'custom') throw new UsageError(usage);
      if (!values.url) throw new UsageError(`backend use custom needs --url <https://…>\n\n${usage}`);
      const dir = await resolveGame(positionals[2]);
      const roots = pageRoots(dir);
      if (roots.brought && roots.build && !roots.static)
        throw new Error(
          `${shown(dir)} has a build, and xcore does not know the folder it copies as it is: adopt it again with --static <dir> (Vite, Next.js, Astro: public), so backend.json is published.`,
        );
      let main;
      try {
        main = new URL(values.url).origin;
      } catch {
        throw new Error(`--url ${values.url} is not an address`);
      }
      // an https backend's WebSocket twin comes with it (wss:// on the same host): a game that talks to its server often uses both
      const twin = main.startsWith('https:') ? main.replace(/^https:/, 'wss:') : null;
      const config = {
        version: 1,
        provider: 'custom',
        url: values.url,
        origins: [...new Set([main, ...(twin ? [twin] : []), ...(values.origin ?? [])])],
      };
      const checked = backendOrigins(config, { own: ownOrigins(studioOrigin()) });
      if (checked.problems.length)
        throw new Error(`backend.json would be refused:\n  - ${checked.problems.join('\n  - ')}`);
      config.origins = checked.origins;
      const home = roots.brought && roots.static ? roots.static : dir,
        file = path.join(home, BACKEND_FILE);
      await mkdir(home, { recursive: true });
      await writeFile(file, JSON.stringify(config, null, 2) + '\n');
      if (values.json) printJson({ file: shown(file), ...config });
      else
        console.log(
          `Wrote ${shown(file)}: the published page may reach ${config.origins.join(', ')}. Next: ${CMD} check, which fails on a request to any other origin.`,
        );
      return 0;
    }),
};
