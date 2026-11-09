// `xcore loot <command>`: a game's Solana economy, on loot (the shared program). Its tools are @xgamesfun/solana's,
// this package's dependency, run as themselves (its `xsolana` command): check, simulate, cost, explain, approve, connect
// (its MCP tools and its xsolana-economy skill for Claude Code and Codex) and the rest. Every command gets the Solana RPC
// setting (XSOLANA_RPC_URL, ../lib/solana-rpc.mjs) unless the environment already names one. `add` is this package's
// own: the page client into a game where its page is served (a brought game: the folder its build copies as it is;
// ../lib/publish/adopt.mjs addLoot).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { guard, parse, printJson } from '../lib/cli.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import { ECONOMY_FILE, solanaCommand } from '../lib/economy.mjs';
import { addLoot } from '../lib/publish/adopt.mjs';
import { solanaRpc } from '../lib/solana-rpc.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore loot <command> [options]

A game's economy on loot, one shared Solana program (devnet only until it is audited), with @xgamesfun/solana's tools.
  xcore loot connect               add its tools (xsolana_*) and its xsolana-economy skill to Claude Code and Codex
  xcore loot add [game]            where the game's economy (${ECONOMY_FILE}) and its page client (gf/loot/) go, and the
                                   copy once the economy is there (a brought game: the folder its build copies as it is)
  xcore loot check|simulate|cost|explain [file]   refusals and warnings; where the money goes; what it costs; in words
  xcore loot approve [file]        in a game's folder: put its economy live, approved in your own wallet
  xcore loot help                  everything else xsolana does (its help says \`xsolana <command>\`: run each as
                                   \`xcore loot <command>\`)
The file is ${ECONOMY_FILE} (loot.json in a game made before it was named so). Its RPC is XSOLANA_RPC_URL (in .env),
else xgames.fun's shared devnet RPC. Published, the page uses the shared relay, which counts every call toward the game's
plan, unless the game brings its own RPC: ${CMD} add rpc (docs/SERVER.md, "The economy's own RPC").`;

const ADD_USAGE = `Usage: xcore loot add [game] [--json]

Where the game's economy (${ECONOMY_FILE}) goes, and once it is there, its page client copied beside it (gf/loot/, a
copy: never edit it; publish brings it up to date). A brought game with a build keeps both in the folder its build
copies as it is (gamesfun.json page.static), so every build carries them. It prints the next steps.`;

/** xsolana's commands that read an economy file ([file], default xsolana.json). */
const ON_FILE = new Set(['check', 'simulate', 'cost', 'explain', 'publish', 'status', 'approve']);

export default {
  name: 'loot',
  summary:
    'a Solana economy on loot (@xgamesfun/solana): connect its tools, add its page client, check it, approve going live',
  usage,
  helpFor: args => (args[0] === 'add' ? ADD_USAGE : usage),
  run: async args => {
    if (!args.length || args[0] === '--help' || args[0] === '-h') {
      console.log(usage);
      return args.length ? 0 : 2;
    }
    if (args[0] === 'add')
      return guard(async () => {
        const { values, positionals } = parse(args.slice(1), {}, usage);
        const dir = await resolveGame(positionals[0]);
        const r = await addLoot(dir);
        if (values.json)
          return printJson({ game: shown(dir), home: shown(r.home), economy: r.economy, page: r.page, steps: r.steps });
        console.log(
          r.economy
            ? `${shown(dir)}: its economy is ${shown(r.economy)}; ${r.page?.changed ? `copied ${r.page.package} ${r.page.version}'s page client (${r.page.files} files)` : "loot's page client is current"} in ${shown(path.join(r.home, 'gf', 'loot'))}.`
            : `${shown(dir)} has no economy yet: its ${ECONOMY_FILE} goes in ${shown(r.home) === '.' ? 'this folder' : `${shown(r.home)}/`}.`,
        );
        for (const s of r.steps) console.log(`  - ${s}`);
        return 0;
      }, args);
    const xsolana = solanaCommand();
    if (!xsolana) {
      console.error(
        'The economy tools (@xgamesfun/solana) are not installed here: reinstall @xgamesfun/xcore (npm i @xgamesfun/xcore), or set GAMESFUN_SOLANA to a solana-kit checkout.',
      );
      return 1;
    }
    // a game made before the file was named xsolana.json keeps loot.json: given to the command when it names no file
    const named = args.slice(1).some(a => a.endsWith('.json'));
    let rest =
      ON_FILE.has(args[0]) && !named && !existsSync(ECONOMY_FILE) && existsSync('loot.json')
        ? [...args, 'loot.json']
        : args;
    // xsolana reads an economy file inside the folder it runs in: a file named elsewhere runs it in that file's folder
    let cwd = process.cwd();
    const file = ON_FILE.has(args[0]) ? rest.slice(1).find(a => a.endsWith('.json') && !a.startsWith('-')) : null;
    if (file && path.dirname(file) !== '.') {
      cwd = path.resolve(path.dirname(file));
      rest = rest.map(a => (a === file ? path.basename(file) : a));
    }
    const env = { ...process.env, XSOLANA_RPC_URL: process.env.XSOLANA_RPC_URL?.trim() || solanaRpc().url };
    // its words name its own commands (`npx -y @xgamesfun/solana@… approve xsolana.json`, `xsolana check`): said here
    // as this package's, with the file as it was named
    const say = ownWords({ file, named: file ? path.basename(file) : null });
    const child = spawn(xsolana[0], [xsolana[1], ...rest], { stdio: ['inherit', 'pipe', 'pipe'], env, cwd });
    const done = [relay(child.stdout, process.stdout, say), relay(child.stderr, process.stderr, say)];
    return new Promise(resolve =>
      child.on('close', async code => {
        await Promise.all(done);
        resolve(code ?? 1);
      }),
    );
  },
};

/** xsolana's commands a person runs as `xcore loot <command>`. */
const COMMANDS = 'guide|examples|check|simulate|cost|explain|publish|approve|status|connect|mcp|tool|version|help';
/** Its tools an agent calls (xsolana_check …) that are also a command here. */
const TOOLS = 'guide|examples|check|simulate|cost|explain|publish|status';

/**
 * xsolana's text as xcore's: its pinned npx forms and its `xsolana <command>` become `xcore loot <command>`, and the
 * file it was given by its plain name (it runs in that file's folder) is the file as the person named it.
 */
export function ownWords({ file = null, named = null } = {}) {
  const npx = new RegExp(String.raw`npx -y (?:--package=)?@xgamesfun/solana@[\w.-]+(?: xsolana)? (${COMMANDS})\b`, 'g');
  const own = new RegExp(String.raw`(^|[\s\`'"(])xsolana (${COMMANDS})\b`, 'gm');
  const tool = new RegExp(String.raw`\bxsolana_(${TOOLS})\b`, 'g');
  const asNamed =
    file && named && file !== named
      ? new RegExp(String.raw`(xcore loot \w+) ${named.replace(/[.]/g, '\\.')}\b`, 'g')
      : null;
  return text => {
    let t = text.replace(npx, 'xcore loot $1').replace(own, '$1xcore loot $2').replace(tool, 'xcore loot $1');
    if (asNamed) t = t.replace(asNamed, `$1 ${file}`);
    // its help's columns: the three letters `xcore loot` adds are taken from the gap after
    t = t.replace(/^( {2}xcore loot \S.*?\S)( {5,})/gm, (_, a, gap) => a + gap.slice(3));
    return t;
  };
}

/** Copies a child's stream to `out` a line at a time, through `say`. Resolves at its end. */
function relay(stream, out, say) {
  let rest = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    const lines = (rest + chunk).split('\n');
    rest = lines.pop();
    if (lines.length) out.write(say(lines.join('\n') + '\n'));
  });
  return new Promise(resolve =>
    stream.on('end', () => {
      if (rest) out.write(say(rest));
      resolve();
    }),
  );
}
