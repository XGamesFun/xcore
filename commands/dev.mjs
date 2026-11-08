// `xcore dev [dir]`: the game as xgames.fun hosts it, on this machine, with its server, sign-in, saves, rooms and
// economy RPC (../lib/dev/index.mjs). Runs until Ctrl+C.
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import { madeByKit } from '../lib/publish/index.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore dev [dir] [--port <n>] [--no-build] [--open] [--json]

Play the game on this machine as xgames.fun will host it, with everything a published game has behind it:
  http://127.0.0.1:<port>/game/   the published files, with the play host's headers
  /game/api/*                     the game's own server/ (Durable Objects, WebSockets, env.GF), reloaded on change
  /platform/v1/*                  sign-in (a local player), saves and leaderboards, the same store env.GF uses
  /loot/v1/rpc                    the economy's Solana devnet RPC (XSOLANA_RPC_URL in .env, else xgames.fun's relay)
gamesfun.js (${CMD} add signin|database|multiplayer) uses all of it here, from any engine: open the page in two
windows to play a room together. Running server/ needs Miniflare (workerd), installed once on first use (~140 MB).
Saves, scores and Durable Object storage are kept in <dir>/.gamesfun/ (never published).
  --port <n>   the port (default 8787)
  --no-build   serve what is built already; do not run gamesfun.json page.build first
  --open       open the page in your browser
  --json       print where it runs as JSON, then keep running`;

export default {
  name: 'dev',
  summary: 'play the game here as xgames.fun hosts it: its server, sign-in, saves, rooms and economy RPC',
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(
        args,
        { port: { type: 'string' }, 'no-build': { type: 'boolean' }, open: { type: 'boolean' } },
        usage,
      );
      const port = values.port === undefined ? 8787 : Number(values.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535)
        throw new UsageError(`--port is a port number\n\n${usage}`);
      const dir = await resolveGame(positionals[0]);
      if (madeByKit(dir)) {
        console.error(
          `${shown(dir)} was made with the kit: its dev server is the kit's (${CMD} dev, with @xgamesfun/kit).`,
        );
        return 1;
      }
      const say = values.json ? m => console.error(m) : m => console.log(m);
      const { startDev } = await import('../lib/dev/index.mjs');
      let dev;
      try {
        dev = await startDev(dir, { port, noBuild: values['no-build'] === true, log: say });
      } catch (e) {
        if (e.code === 'EADDRINUSE')
          throw new Error(`port ${port} is in use: pick another with --port <n>`, { cause: e });
        throw e;
      }
      if (values.json)
        printJson({ url: dev.url, origin: dev.origin, files: dev.files, server: dev.server, rpc: dev.rpc });
      else {
        say(`\n${shown(dir)} on this machine: ${dev.url}`);
        say(`  server: ${dev.server ? (dev.server.running ? 'running' : 'not running (above)') : 'none (no server/)'}`);
        say(`  sign-in, saves, scores: a local player; kept in ${shown(dev.store.file)}`);
        say(`  project files (env.GF.files, xcore files): public ones at ${dev.files}/, a site of their own`);
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
