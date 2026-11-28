// `xcore backend use custom`: a backend you already run on the public internet (an API, a WebSocket server). It
// writes backend.json with its URL and the origins the page talks to, so xgames.fun's play host lets the published page
// reach them (its page policy opens to exactly those). Nothing is signed in to or deployed; its keys stay on its
// server. A backend the kit connects for you (Supabase, Railway) is the kit's: `backend connect` with @xgamesfun/kit.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame, shown, typedDir } from '../lib/games.mjs';
import { backendOrigins, BACKEND_FILE } from '../lib/publish/scan.mjs';
import { pageRoots } from '../lib/publish/page.mjs';
import { CMD } from '../lib/command.mjs';
import { ownOrigins, studioOrigin } from '../lib/publish/client.mjs';

const usage = `Usage: xcore backend use custom [dir] --url <https://…> [--origin <wss://…>]… [--json]

Let the published game call a backend you already run.

This writes backend.json with the origin of the backend's public URL, its wss:// counterpart, and every other origin
the page connects to (--origin; at most 8 origins in all). The published page may reach these origins and no other
site.

  - Keep the backend's keys on the backend. A game may only contain keys that are meant to be public.
  - The backend must answer CORS requests from the game's origin (https://<slug>-play.xgames.fun once published).
  - For an adopted game with a build, backend.json goes in the folder the build copies unchanged (gamesfun.json
    page.static).`;

export default {
  name: 'backend',
  summary: 'let the published page reach a backend you run (writes backend.json)',
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(
        args,
        { url: { type: 'string' }, origin: { type: 'string', multiple: true } },
        usage,
      );
      if (positionals[0] !== 'use' || positionals[1] !== 'custom')
        throw new UsageError(
          `${positionals.length ? `"backend ${positionals.slice(0, 2).join(' ')}" is not a command here` : 'Name a command'}: xcore has "backend use custom".\n\n${usage}`,
        );
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
        throw new UsageError(`--url ${values.url} is not an address (https://…)\n\n${usage}`);
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
          `Wrote ${shown(file)}: the published page may reach ${config.origins.join(', ')}. Next: ${CMD} check ${typedDir(dir)}, which fails on a request to any other origin.`,
        );
      return 0;
    }, args),
};
