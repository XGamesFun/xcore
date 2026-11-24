// `xcore dev [dir]`: the game as xgames.fun hosts it, on this machine, with its server, sign-in, saves, rooms and
// economy RPC (../lib/dev/index.mjs). Runs until Ctrl+C.
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import { madeByKit } from '../lib/publish/index.mjs';
import { CMD } from '../lib/command.mjs';
import { PLAN_NAMES } from '../lib/dev/plans.mjs';

const usage = `Usage: xcore dev [dir] [--port <n>] [--plan <name>] [--no-build] [--open] [--json]

Run the game on this machine as xgames.fun hosts it, with the same services a published game has:
  http://127.0.0.1:<port>/game/   the published files, with the play host's headers
  /game/api/*                     the game's own server/ (Durable Objects, WebSockets, env.GF), reloaded on change
  /platform/v1/*                  sign-in (as a local player), saves and leaderboards: the same store env.GF uses,
                                  with xgames.fun's limits for the plan it imitates (Free unless --plan)
  /loot/v1/rpc                    the economy's Solana devnet RPC (XSOLANA_RPC_URL in .env, else xgames.fun's relay)

gamesfun.js (${CMD} add signin|database|multiplayer) uses all of these locally, from any engine. To play a room
together, open the page in two windows.

Running server/ needs Miniflare (workerd), which is installed on first use (about 180 MB). Saves, scores and Durable
Object storage are kept in <dir>/.gamesfun/, which is never published.

Options:
  --port <n>      the port (default: the first free port from 8787)
  --plan <name>   the plan to imitate: free (the default), creator or scale. It sets the boards, saves, reads and
                  writes per minute, and file sizes that xgames.fun allows on that plan (${CMD} plan shows a
                  game's own plan)
  --no-build      serve what is already built; do not run gamesfun.json page.build first
  --open          open the page in your browser
  --json          print where it runs as JSON, then keep running`;

/** The first port from `from` (step 2: the page's, and the next for its files) free on 127.0.0.1, or null. */
async function freePort(from, tries = 10) {
  const { createServer } = await import('node:net');
  const free = p =>
    new Promise(resolve => {
      const s = createServer()
        .once('error', () => resolve(false))
        .listen(p, '127.0.0.1', () => s.close(() => resolve(true)));
    });
  for (let p = from; p < from + 2 * tries; p += 2) if ((await free(p)) && (await free(p + 1))) return p;
  return null;
}

/**
 * A port the system would not let `xcore dev` listen on, in words: the port the person gave, the one that was refused
 * (theirs, or the next, which the game's files take) and why. → an Error, or null when `e` is no such refusal
 */
export function listenRefusal(e, port) {
  if (e?.syscall !== 'listen') return null;
  if (e.code === 'EADDRINUSE') return new Error(`port ${port} is in use: pick another with --port <n>`, { cause: e });
  const which =
    e.port && e.port !== port
      ? `port ${e.port}, the one after ${port}, which it takes for the game's files`
      : `port ${port}`;
  const why =
    e.code === 'EACCES'
      ? 'this system lets only an administrator use a port under 1024'
      : `the system answered ${e.code ?? e.message}`;
  return new Error(
    `${CMD} dev cannot listen on ${which}: ${why}. Pick another with --port <n> (without --port it takes the first free one from 8787).`,
    { cause: e },
  );
}

export default {
  name: 'dev',
  summary: 'run the game locally as xgames.fun hosts it, with its server, sign-in and rooms',
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(
        args,
        {
          port: { type: 'string' },
          plan: { type: 'string' },
          'no-build': { type: 'boolean' },
          open: { type: 'boolean' },
        },
        usage,
      );
      let port = values.port === undefined ? 8787 : Number(values.port);
      // (the game's files take the next port, so the last one cannot be the page's)
      if (!Number.isInteger(port) || port < 0 || port > 65534)
        throw new UsageError(
          `--port takes a port number (0–65534: the next one is taken for the game's files)\n\n${usage}`,
        );
      // no --port: the first free one from 8787 (each game takes two, its page and its files), so a second game in dev
      // starts beside the first instead of failing
      if (values.port === undefined) port = (await freePort(port)) ?? port;
      const plan = String(values.plan ?? 'free').toLowerCase();
      if (!PLAN_NAMES.includes(plan))
        throw new UsageError(`--plan is ${PLAN_NAMES.slice(0, -1).join(', ')} or ${PLAN_NAMES.at(-1)}\n\n${usage}`);
      const dir = await resolveGame(positionals[0]);
      if (madeByKit(dir))
        throw new Error(
          `${shown(dir)} was made with the game-making kit. Its dev server is the kit's own, which runs only where the kit is installed. The kit is not released yet.`,
        );
      const say = values.json ? m => console.error(m) : m => console.log(m);
      const { startDev } = await import('../lib/dev/index.mjs');
      let dev;
      try {
        dev = await startDev(dir, { port, plan, noBuild: values['no-build'] === true, log: say });
      } catch (e) {
        throw listenRefusal(e, port) ?? e;
      }
      if (values.json)
        printJson({
          url: dev.url,
          origin: dev.origin,
          files: dev.files,
          server: dev.server,
          rpc: dev.rpc,
          plan: dev.plan,
        });
      else {
        say(`\n${shown(dir)} on this machine: ${dev.url}`);
        say(`  server: ${dev.server ? (dev.server.running ? 'running' : 'not running (above)') : 'none (no server/)'}`);
        say(
          `  sign-in, saves, scores: a local player, with the ${dev.store.plan.name} plan's limits; kept in ${shown(dev.store.file)}`,
        );
        say(`  project files (env.GF.files, xcore files): public ones at ${dev.files}/, an origin of their own`);
        say(`  economy RPC: ${dev.rpc}`);
        say('Ctrl+C stops it.');
      }
      if (values.open) {
        const { openUrl } = await import('../lib/open.mjs');
        openUrl(dev.url);
      }
      await new Promise(resolve => {
        const stop = () => resolve();
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
      await dev.close();
      return 0;
    }, args),
};
