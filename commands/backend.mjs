// `xcore backend use custom`: a backend you already run on the public internet (an API, a WebSocket server). It
// writes backend.json with its URL and the origins the page talks to, so xgames.fun's play host lets the published page
// reach them (its page policy opens to exactly those). Nothing is signed in to or deployed; its keys stay on its
// server. A backend the kit connects for you (Supabase, Railway) is the kit's: `backend connect` with @xgamesfun/kit.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { folderArg, guard, parse, printJson, tooMany, UsageError } from '../lib/cli.mjs';
import { resolveGame, shown, typedDir } from '../lib/games.mjs';
import { backendOrigins, BACKEND_FILE } from '../lib/publish/scan.mjs';
import { pageRoots } from '../lib/publish/page.mjs';
import { CMD } from '../lib/command.mjs';
import { ownOrigins, studioOrigin } from '../lib/publish/client.mjs';
import { readOwnJson } from '../lib/util.mjs';

const usage = `Usage: xcore backend use custom [dir] --url <https://…> [--origin <wss://…>]… [--json]

Let the published game call a backend you already run. The game's folder is the word after custom, or --dir <folder>
(default: the current directory).

This writes backend.json with the origin of the backend's public URL, its wss:// counterpart, and every other origin
the page connects to (--origin; at most 8 origins in all). The published page may reach these origins and no other
site. Run again with another --url, it replaces the backend the file named (its origin and wss:// counterpart); the
file's other origins are kept, and said.

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
        { url: { type: 'string' }, origin: { type: 'string', multiple: true }, dir: { type: 'string' } },
        usage,
      );
      if (positionals[0] !== 'use' || positionals[1] !== 'custom')
        throw new UsageError(
          `${positionals.length ? `"backend ${positionals.slice(0, 2).join(' ')}" is not a command here` : 'Name a command'}: xcore has "backend use custom".\n\n${usage}`,
        );
      if (!values.url) throw new UsageError(`backend use custom needs --url <https://…>\n\n${usage}`);
      if (positionals.length > 3) throw new UsageError(`${tooMany(positionals.slice(3))}\n\n${usage}`);
      const dir = await resolveGame(folderArg(values.dir, positionals[2], usage));
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
      const home = roots.brought && roots.static ? roots.static : dir,
        file = path.join(home, BACKEND_FILE);
      // the file there now: one that does not read is refused, named, as every other command refuses it; its other
      // origins (added by hand, or by an earlier --origin) are kept, and said
      const before = readOwnJson(file, shown(file));
      if (existsSync(file) && (before === null || typeof before !== 'object' || Array.isArray(before)))
        throw Object.assign(new Error(`${shown(file)} is not a JSON object; fix it or delete it first`), {
          code: 'not-json',
        });
      // an https backend's WebSocket twin comes with it (wss:// on the same host): a game that talks to its server often uses both
      const withTwin = origin => [origin, ...(origin.startsWith('https:') ? [origin.replace(/^https:/, 'wss:')] : [])];
      // the backend the file named before is the one this replaces: its origin and its twin go with it
      let was = [];
      try {
        if (typeof before?.url === 'string') was = withTwin(new URL(before.url).origin);
      } catch {
        // (a url that does not read names no origin to take out)
      }
      const had = Array.isArray(before?.origins)
        ? before.origins.filter(o => typeof o === 'string' && !was.includes(o))
        : [];
      const asked = [...new Set([...withTwin(main), ...(values.origin ?? [])])];
      const config = {
        ...(before ?? {}),
        version: 1,
        provider: 'custom',
        url: values.url,
        origins: [...new Set([...asked, ...had])],
      };
      const checked = backendOrigins(config, { own: ownOrigins(studioOrigin()) });
      if (checked.problems.length) {
        const fromFile = had.filter(o => !asked.includes(o));
        throw new Error(
          `backend.json would be refused:\n  - ${checked.problems.join('\n  - ')}${fromFile.length ? `\n${shown(file)} has ${fromFile.join(', ')} already, and they are kept: take the ones the page no longer needs out of its "origins", then run this again.` : ''}`,
        );
      }
      config.origins = checked.origins;
      const askedOrigins = backendOrigins({ origins: asked }, { own: ownOrigins(studioOrigin()) }).origins;
      const kept = config.origins.filter(o => !askedOrigins.includes(o));
      await mkdir(home, { recursive: true });
      await writeFile(file, JSON.stringify(config, null, 2) + '\n');
      if (values.json) printJson({ ok: true, file: shown(file), ...config, kept });
      else
        console.log(
          `Wrote ${shown(file)}: the published page may reach ${config.origins.join(', ')}.${kept.length ? ` (${kept.join(', ')} ${kept.length === 1 ? 'was' : 'were'} in it already and ${kept.length === 1 ? 'is' : 'are'} kept: take ${kept.length === 1 ? 'it' : 'them'} out of its "origins" if the page no longer needs ${kept.length === 1 ? 'it' : 'them'}.)` : ''} Next: ${CMD} check ${typedDir(dir)}, which fails on a request to any other origin.`,
        );
      return 0;
    }, args),
};
