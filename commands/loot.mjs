// `xcore loot <command>`: a game's Solana economy, on loot (the shared program). Its tools are @xgamesfun/solana's,
// this package's dependency, run as themselves (its `xsolana` command): check, simulate, cost, explain, keygen, approve,
// connect (its MCP tools and its xsolana-economy skill for Claude Code and Codex) and the rest. Every command gets the
// Solana RPC setting (XSOLANA_RPC_URL, ../lib/solana-rpc.mjs) unless the environment already names one; `approve` goes
// to the person's own RPC or to the tools' own default, never to the shared relay (see `rpcFor`). `add` is this package's
// own: the page client into a game where its page is served (a brought game: the folder its build copies as it is;
// ../lib/loot-add.mjs).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import { ECONOMY_FILE, NO_SOLANA, solanaCommand, solanaHas, solanaRoot } from '../lib/economy.mjs';
import { addLoot } from '../lib/loot-add.mjs';
import { economyCluster, solanaRpc } from '../lib/solana-rpc.mjs';
import { CMD } from '../lib/command.mjs';
import { NO_REVIEW } from '../lib/review.mjs';

const usage = `Usage: xcore loot <command> [options]

Build and run a game's economy on loot, one shared Solana program, with @xgamesfun/solana's tools (xsolana). The
economy runs on devnet by default. It runs on mainnet (real money; loot is not independently audited) only when its
xsolana.json says "network": "mainnet". Fees: see docs/FEES.md.

xcore's own:
  xcore loot add [game]   say where the game's economy (${ECONOMY_FILE}) and its page client (gf/loot/) go, and copy
                          the client once the economy exists (for an adopted game: into the folder its build copies
                          unchanged)

Every other command is the economy tools' own, run here as xcore loot <command> (the list below comes from the installed
@xgamesfun/solana; xcore loot <command> --help shows one command's help). Going live (approve) and handing a project to
a new owner (handover) print what they would send with a code and send nothing until you run them again with
--yes <code>, after the game's owner has read the printout and agreed. For real money, signing with a browser wallet
(approve --browser), which can keep its key on a hardware device, is the safer choice: see docs/ECONOMY.md, "Going
live". Every tool command accepts --json and passes on the tools' full answer unchanged. ${CMD} connect adds these
tools and xcore's own skill in one step.

The economy file is ${ECONOMY_FILE} (loot.json in games made before the rename).

RPC:
  - Locally, the tools use XSOLANA_RPC_URL (from .env), else xgames.fun's shared devnet RPC.
  - Once published, the page uses xgames.fun's shared relay unless the game has its own RPC: ${CMD} add rpc
    (docs/SERVER.md, "The economy's own RPC"). Relay calls are billed: they use up the included amount, counted at
    cost ($10 a million), and past it are charged from usage credit at $20 a million. They never count toward the cap
    that switches the game's server off.
  - Going live (approve) sends through XSOLANA_RPC_URL when it is set, else through Solana's public devnet RPC. The
    shared relay only passes loot's own transactions, and a setup also creates mints and token accounts. If the
    public RPC refuses your requests, set XSOLANA_RPC_URL to a devnet RPC of your own.`;

const ADD_USAGE = `Usage: xcore loot add [game] [--verbose] [--json]

Show where the game's economy file (${ECONOMY_FILE}) goes. Once the file exists, copy the economy's page client next
to it (gf/loot/: the client bundled and minified, play/index.js and chain/rpc.js, with wallets.js). It is a managed
copy: do not edit it. Run loot add again to refresh it after @xgamesfun/solana changes; publish does too.

For an adopted game with a build, both go in the folder the build copies unchanged (gamesfun.json page.static), so
every build includes them. It prints the next steps in short; --verbose prints every note, and --json has both
(next and steps).`;

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
 * own, `approve` is left to the tools' default, Solana's public devnet RPC. On mainnet (the economy's file says
 * "network": "mainnet") the relay answers a published game's signed-in players only, so with no RPC of the person's own
 * every command is left to the tools, which then ask for one. → the URL, or null for the tools' default.
 */
export function rpcFor(command, env = process.env, rpc = solanaRpc(env)) {
  const own = env.XSOLANA_RPC_URL?.trim();
  if (own) return own;
  if (rpc.shared && rpc.cluster === 'mainnet') return null;
  return command === 'approve' && rpc.shared ? null : rpc.url;
}

export default {
  name: 'loot',
  summary: "build and run a Solana economy on loot (@xgamesfun/solana's tools)",
  usage,
  helpFor: args => lootHelp(args),
  run: async args => {
    if (args[0] === '--help' || args[0] === '-h') {
      console.log(lootHelp([]));
      return 0;
    }
    // no subcommand (--json alone names none): a usage mistake, said as every command says one
    if (args.every(a => a === '--json'))
      return guard(() => {
        throw new UsageError(
          `Name a command: add, connect, check, simulate, cost, explain, review, token, keygen, approve or help.\n\n${usage}`,
        );
      }, args);
    if (args[0] === 'add')
      return guard(async () => {
        const { values, positionals } = parse(args.slice(1), { verbose: { type: 'boolean' } }, ADD_USAGE);
        const dir = await resolveGame(positionals[0]);
        const r = await addLoot(dir);
        if (values.json)
          return printJson({
            game: shown(dir),
            home: shown(r.home),
            economy: r.economy,
            page: r.page,
            next: r.next,
            steps: r.steps,
          });
        console.log(
          r.economy
            ? `${shown(dir)}: its economy is ${shown(r.economy)}; ${r.page?.changed ? `copied ${r.page.package} ${r.page.version}'s page client (${r.page.files} files)` : "loot's page client is current"} in ${shown(path.join(r.home, 'gf', 'loot'))}.`
            : `${shown(dir)} has no economy yet: its ${ECONOMY_FILE} goes in ${shown(r.home) === '.' ? 'this folder' : `${shown(r.home)}/`}.`,
        );
        const steps = values.verbose ? r.steps : r.next;
        console.log(['', 'Next:', ...steps.map((s, i) => `  ${i + 1}. ${s}`)].join('\n'));
        if (!values.verbose && r.steps.length > r.next.length)
          console.log(`\nDetails (${r.steps.length} notes): ${CMD} loot add ${shown(dir)} --verbose`);
        return 0;
      }, args);
    // --json goes to the kit as it is, and its answer comes back untouched: the kit's JSON is the contract
    const json = args.includes('--json');
    // a refusal before the kit runs is this command's own, said as every command says one (with --json, as JSON too)
    const refuse = (error, code) =>
      guard(() => {
        throw Object.assign(new Error(error), { code });
      }, args);
    const xsolana = solanaCommand();
    if (!xsolana) return refuse(NO_SOLANA, 'no-solana');
    // an installed package without `review`: what to do, instead of its help
    if (args[0] === 'review' && !solanaHas('review')) return refuse(`${NO_REVIEW}.`, 'no-review');
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
    // (on the cluster of the economy in the folder it runs in: devnet unless its file says mainnet)
    const rpc = rpcFor(
      args[0],
      process.env,
      solanaRpc(process.env, { cluster: economyCluster(file ? path.resolve(file) : cwd) }),
    );
    if (rpc) env.XSOLANA_RPC_URL = rpc;
    else delete env.XSOLANA_RPC_URL;
    // its words name its own commands (`npx -y @xgamesfun/solana@… approve xsolana.json --keypair …`, `xsolana check`):
    // said here as this package's, with the file as it was named
    const say = ownWords({ file, named: file ? path.basename(file) : null });
    // the MCP server and `tool` talk to an agent, which calls the tools by the names they list (xsolana_check): their
    // output goes through as it is, and their notes on stderr keep the tools' names
    const asTools = args[0] === 'mcp' || args[0] === 'tool';
    const note = asTools ? ownWords({ file, named: file ? path.basename(file) : null, tools: false }) : say;
    const child = spawn(xsolana[0], [xsolana[1], ...rest], { stdio: ['inherit', 'pipe', 'pipe'], env, cwd });
    // a reader that stops early (`| head`) closes our output: stop the tools and end quietly, as a pipe expects
    const gone = { yes: false };
    const closed = err => {
      if (err.code !== 'EPIPE') throw err;
      gone.yes = true;
      child.kill();
    };
    process.stdout.on('error', closed);
    process.stderr.on('error', closed);
    const done = [
      relay(child.stdout, process.stdout, json || asTools ? t => t : say, gone),
      relay(child.stderr, process.stderr, note, gone),
    ];
    return new Promise(resolve =>
      child.on('close', async code => {
        await Promise.all(done);
        process.stdout.off('error', closed);
        process.stderr.off('error', closed);
        resolve(gone.yes ? 0 : (code ?? 1));
      }),
    );
  },
};

/** xsolana's commands a person runs as `xcore loot <command>`: the ones its own help lists (read from the installed
 *  package's bin, where each is a key of its COMMANDS table), else these. */
const KNOWN =
  'guide|examples|check|simulate|cost|explain|review|publish|keygen|approve|handover|status|token|client|connect|mcp|tool|version|help';
let commands = null;
export function toolCommands(env = process.env) {
  if (commands) return commands;
  const found = new Set(KNOWN.split('|'));
  const root = solanaRoot(env);
  try {
    const bin = readFileSync(path.join(root, 'bin', 'xsolana.mjs'), 'utf8');
    for (const m of bin.matchAll(/^ {2}([a-z][a-z-]*): \{\s*\n\s+group:/gm)) found.add(m[1]);
  } catch {
    /* no package here: the known list */
  }
  return (commands = [...found]);
}
/** The tools' own text for `args` (`help`, `<command> --help`), said as xcore's, or null when they are not here. */
function toolsText(args) {
  const xsolana = solanaCommand();
  if (!xsolana) return null;
  const r = spawnSync(xsolana[0], [xsolana[1], ...args], { encoding: 'utf8' });
  return r.status === 0 && r.stdout ? ownWords()(r.stdout).trimEnd() : null;
}
/** `xcore loot --help` and `xcore loot <command> --help`: ours for add; the tools' own for theirs; else ours with the
 *  tools' list of commands under it. */
export function lootHelp(args) {
  if (args[0] === 'add') return ADD_USAGE;
  if (args[0] && toolCommands().includes(args[0])) return toolsText([args[0], '--help']) ?? `${NO_SOLANA}\n\n${usage}`;
  // (its own first lines name it xsolana; the commands below them are said as xcore's)
  const list = toolsText(['help'])
    ?.split('\n')
    .filter(l => !/^(xsolana: |Usage: xsolana )/.test(l))
    .join('\n')
    .trim();
  return list ? `${usage}\n\nThe economy tools' commands:\n\n${list}` : `${usage}\n\n${NO_SOLANA}`;
}
/** Its tools an agent calls (xsolana_check …) that are also a command here. */
const TOOLS = 'guide|examples|check|simulate|cost|explain|review|publish|status|token';

/**
 * xsolana's text as xcore's: its pinned npx forms and its `xsolana <command>` become `xcore loot <command>`, and the
 * file it was given by its plain name (it runs in that file's folder) is the file as the person named it. The MCP
 * server's own command (`npx -y --package=@xgamesfun/solana@… xsolana mcp`, what connect registers in an agent) is
 * said as it is: it is the command the agent runs, so a dry run shows exactly what is registered. `tools`: false keeps
 * the MCP tools' names (xsolana_check) as they are, for text an agent reads to call them.
 */
export function ownWords({ file = null, named = null, tools = true } = {}) {
  const COMMANDS = toolCommands().join('|');
  const npx = new RegExp(String.raw`npx -y (?:--package=)?@xgamesfun/solana@[\w.-]+(?: xsolana)? (${COMMANDS})\b`, 'g');
  const own = new RegExp(String.raw`(^|[\s\`'"(])(?<!@xgamesfun/solana@[\w.-]+ )xsolana (${COMMANDS})\b`, 'gm');
  const tool = new RegExp(String.raw`\bxsolana_(${TOOLS})\b`, 'g');
  const asNamed =
    file && named && file !== named
      ? new RegExp(String.raw`(xcore loot \w+) ${named.replace(/[.]/g, '\\.')}\b`, 'g')
      : null;
  return text => {
    let t = text
      .replace(npx, (all, command) => (command === 'mcp' ? all : `xcore loot ${command}`))
      .replace(own, '$1xcore loot $2')
      .replaceAll('xsolana <command> --help', 'xcore loot <command> --help')
      .replace(tool, all => (tools ? `xcore loot ${all.slice('xsolana_'.length)}` : all));
    if (asNamed) t = t.replace(asNamed, `$1 ${file}`).replaceAll(`(${named})`, `(${file})`);
    // its help's columns: the three letters `xcore loot` adds are taken from the gap after
    t = t.replace(/^( {2}xcore loot \S.*?\S)( {5,})/gm, (_, a, gap) => a + gap.slice(3));
    return t;
  };
}

/** Copies a child's stream to `out` a line at a time, through `say`, until the reader has gone (`gone.yes`).
 *  Resolves at its end. */
function relay(stream, out, say, gone = { yes: false }) {
  let rest = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    const lines = (rest + chunk).split('\n');
    rest = lines.pop();
    if (lines.length && !gone.yes) out.write(say(lines.join('\n') + '\n'));
  });
  return new Promise(resolve =>
    stream.on('end', () => {
      if (rest && !gone.yes) out.write(say(rest));
      resolve();
    }),
  );
}
