// `xcore loot <command>`: a game's Solana economy, on loot (the shared program). Its tools are @xgamesfun/solana's,
// this package's dependency, run as themselves (its `xsolana` command): check, simulate, cost, explain, keygen, approve,
// connect (its MCP tools and its xsolana-economy skill for Claude Code and Codex) and the rest. Every command gets the
// Solana RPC setting (XSOLANA_RPC_URL, ../lib/solana-rpc.mjs) unless the environment already names one; `approve` goes
// to the person's own RPC or to the tools' own default, never to the shared relay (see `rpcFor`). `add` is this package's
// own: the page client into a game where its page is served (a brought game: the folder its build copies as it is;
// ../lib/publish/adopt.mjs addLoot).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { guard, parse, printJson } from '../lib/cli.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import { ECONOMY_FILE, solanaCommand, solanaHas } from '../lib/economy.mjs';
import { addLoot } from '../lib/publish/adopt.mjs';
import { solanaRpc } from '../lib/solana-rpc.mjs';
import { CMD } from '../lib/command.mjs';
import { NO_REVIEW } from '../lib/review.mjs';

const usage = `Usage: xcore loot <command> [options]

A game's economy on loot, one shared Solana program (devnet only until it is audited), with @xgamesfun/solana's tools.
  xcore loot connect               add its tools (xsolana_*) and its xsolana-economy skill to Claude Code and Codex
  xcore loot add [game]            where the game's economy (${ECONOMY_FILE}) and its page client (gf/loot/) go, and the
                                   copy once the economy is there (a brought game: the folder its build copies as it is)
  xcore loot check|simulate|cost|explain [file]   refusals and warnings; where the money goes; what it costs; in words
  xcore loot review [file]         what a cheater gets from each route that pays, and the trade-offs in words (xcore
                                   review adds the game's server and, with --live, the published game)
  xcore loot token <mint>          a coin made elsewhere, read from the chain: its entry for the economy's "tokens",
                                   with what its mint's own keys can do (mint more, freeze, a fee on transfers)
  xcore loot keygen <file>         a key file for the game's economy, outside any repository (~/.config/xsolana/<game>.json):
                                   it prints the key's address to send devnet SOL to, never the key. The key is the
                                   project's owner: whoever can read the file controls it
  xcore loot approve [file] --keypair <keyfile>
                                   in a game's folder: everything putting its economy live would send, signed by that
                                   key file. It sends nothing until it is run again with the code it prints
                                   (--yes <code>), once the person whose game it is has read that and said yes
  xcore loot approve [file] --browser
                                   the same on a page on this computer, signed in a browser wallet: only when asked for
  xcore loot help                  everything else xsolana does (its help says \`xsolana <command>\`: run each as
                                   \`xcore loot <command>\`)
The file is ${ECONOMY_FILE} (loot.json in a game made before it was named so). Its RPC is XSOLANA_RPC_URL (in .env),
else xgames.fun's shared devnet RPC. Published, the page uses the shared relay, which counts every call toward the game's
plan, unless the game brings its own RPC: ${CMD} add rpc (docs/SERVER.md, "The economy's own RPC"). Going live
(approve) sends through XSOLANA_RPC_URL when it is set, else through Solana's public devnet RPC: the shared relay
passes only loot's own transactions, and a setup also makes mints and token accounts.`;

const ADD_USAGE = `Usage: xcore loot add [game] [--json]

Where the game's economy (${ECONOMY_FILE}) goes, and once it is there, its page client copied beside it (gf/loot/, a
copy: never edit it; publish brings it up to date). A brought game with a build keeps both in the folder its build
copies as it is (gamesfun.json page.static), so every build carries them. It prints the next steps.`;

/** xsolana's commands that read an economy file ([file], default xsolana.json). */
const ON_FILE = new Set(['check', 'simulate', 'cost', 'explain', 'review', 'publish', 'status', 'approve']);
/** xsolana's flags that take a value: the value is never the economy file, whatever it ends with. */
const VALUED = new Set(['--keypair', '--yes', '--port', '--host', '--args-file', '--agent', '--scope']);

/** Where each argument stands: the indexes of those that are neither a flag nor a flag's value. */
function plainArgs(args) {
  const plain = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('-')) {
      if (VALUED.has(args[i])) i++;
      continue;
    }
    plain.push(i);
  }
  return plain;
}

/**
 * The arguments as xsolana gets them when it runs in another folder than the person's: a key file named from where
 * they stand (`--keypair keys/game.json`) is given whole. One that starts with ~ is the home folder's, left as it is.
 */
export function fromFolder(args, cwd) {
  const whole = p => (p.startsWith('~') || path.isAbsolute(p) ? p : path.resolve(cwd, p));
  return args.map((a, i) =>
    a.startsWith('--keypair=')
      ? `--keypair=${whole(a.slice('--keypair='.length))}`
      : i > 0 && args[i - 1] === '--keypair'
        ? whole(a)
        : a,
  );
}

/**
 * The RPC a command talks to: what the environment names; else the workspace's setting; else xgames.fun's shared
 * relay, but for `approve`. Going live sends transactions that are not loot's own (a token's mint and name, the token
 * accounts an economy pays into, a lottery's rent) and the relay passes only loot's: so with no RPC of the person's
 * own, `approve` is left to the tools' default, Solana's public devnet RPC. → the URL, or null for that default.
 */
export function rpcFor(command, env = process.env, rpc = solanaRpc(env)) {
  const own = env.XSOLANA_RPC_URL?.trim();
  if (own) return own;
  return command === 'approve' && rpc.shared ? null : rpc.url;
}

export default {
  name: 'loot',
  summary:
    'a Solana economy on loot (@xgamesfun/solana): connect its tools, add its page client, check it, put it live',
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
    // an installed package from before `review`: what to do, instead of its help
    if (args[0] === 'review' && !solanaHas('review')) {
      console.error(`xcore: ${NO_REVIEW}.`);
      return 1;
    }
    // a game made before the file was named xsolana.json keeps loot.json: given to the command when it names no file
    // (a key file's name is a flag's value, never the economy file)
    const at = ON_FILE.has(args[0]) ? plainArgs(args).find(i => i > 0 && args[i].endsWith('.json')) : undefined;
    let rest =
      ON_FILE.has(args[0]) && at === undefined && !existsSync(ECONOMY_FILE) && existsSync('loot.json')
        ? [...args, 'loot.json']
        : args;
    // xsolana reads an economy file inside the folder it runs in: a file named elsewhere runs it in that file's folder
    let cwd = process.cwd();
    const file = at === undefined ? null : args[at];
    if (file && path.dirname(file) !== '.') {
      cwd = path.resolve(path.dirname(file));
      rest = fromFolder(rest, process.cwd()).map((a, i) => (i === at ? path.basename(file) : a));
    }
    const env = { ...process.env };
    const rpc = rpcFor(args[0]);
    if (rpc) env.XSOLANA_RPC_URL = rpc;
    else delete env.XSOLANA_RPC_URL;
    // its words name its own commands (`npx -y @xgamesfun/solana@… approve xsolana.json --keypair …`, `xsolana check`):
    // said here as this package's, with the file as it was named
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
const COMMANDS =
  'guide|examples|check|simulate|cost|explain|review|publish|keygen|approve|status|token|connect|mcp|tool|version|help';
/** Its tools an agent calls (xsolana_check …) that are also a command here. */
const TOOLS = 'guide|examples|check|simulate|cost|explain|review|publish|status|token';

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
