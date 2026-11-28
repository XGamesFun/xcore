#!/usr/bin/env node
// The `xcore` command (@xgamesfun/xcore): xgames.fun's own (sign in, bring a game, check it as the host serves it, its
// backend and economy, publish). Each command is a module in ../commands/<name>.mjs exporting `default { name,
// summary, usage, run(args) }`, and optionally `helpFor(args)`, the --help text of a subcommand. Everything else is the
// kit's (@xgamesfun/kit: create, verify, the build loop and the rest): when the kit is here, those go to it as
// they are, and so do publish and check for a game the kit made (its six gates) and every backend the kit connects;
// without it, the command says how to get it.
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { guard, nearest, printJson, UsageError } from '../lib/cli.mjs';
import { CMD } from '../lib/command.mjs';
import { readJson } from '../lib/util.mjs';
import { madeByKit } from '../lib/games.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = path.join(HERE, '..', 'commands');
const KIT = '@xgamesfun/kit';

/** The kit's folder: GAMESFUN_KIT, else a kit in or above the folder this runs in (its checkout, or installed in a
 *  project), else the kit this package was installed with. → its folder, or null */
export function findKit({ cwd = process.cwd(), env = process.env, here = HERE } = {}) {
  const isKit = d => readJson(path.join(d, 'package.json'))?.name === KIT;
  if (env.GAMESFUN_KIT && isKit(path.resolve(env.GAMESFUN_KIT))) return path.resolve(env.GAMESFUN_KIT);
  for (const start of [cwd, here]) {
    for (let d = path.resolve(start); ; d = path.dirname(d)) {
      if (isKit(d)) return d;
      const installed = path.join(d, 'node_modules', ...KIT.split('/'));
      if (isKit(installed)) return installed;
      if (path.dirname(d) === d) break;
    }
  }
  return null;
}

// the flags of check, publish, dev and backend that take a value: their value is never the game's folder
// (tests/states-cli.test.mjs holds this list to the flags those commands' usage names)
const VALUE_FLAGS = Object.fromEntries(
  ['out', 'port', 'plan', 'title', 'url', 'origin', 'yes'].map(f => [f, { type: 'string', multiple: true }]),
);

/** The kit's `backend` subcommands (its builder/commands/backend.mjs). */
const KIT_BACKEND = new Set(['agents', 'check', 'connect', 'disconnect', 'password', 'status', 'use']);

/** Does this command, with these arguments, belong to the kit even though this package has a command by its name?
 *  (`connect`: the kit's own connect where there is a kit, this package's where there is none.) */
export function kitsTurn(name, args) {
  if (name === 'connect') return true;
  const { positionals } = parseArgs({ args, options: VALUE_FLAGS, strict: false, allowPositionals: true });
  // the kit's backend commands (connect, use supabase, check …); any other word is a usage mistake of ours
  if (name === 'backend')
    return KIT_BACKEND.has(positionals[0]) && !(positionals[0] === 'use' && positionals[1] === 'custom');
  if (name === 'publish' || name === 'check' || name === 'dev') {
    const dir = path.resolve(positionals[0] ?? '.');
    return madeByKit(dir);
  }
  return false;
}

async function loadCommands() {
  const commands = new Map();
  for (const file of (await readdir(COMMANDS_DIR)).filter(f => f.endsWith('.mjs')).sort()) {
    const mod = await import(pathToFileURL(path.join(COMMANDS_DIR, file)).href);
    if (mod.default?.name && typeof mod.default.run === 'function') commands.set(mod.default.name, mod.default);
  }
  return commands;
}

/** Run the kit's own command line with these arguments. → its exit code */
function runKit(kit, args) {
  const bin = readJson(path.join(kit, 'package.json'))?.bin?.['gamesfun-kit'] ?? 'bin/gamesfun.mjs';
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(kit, bin), ...args], { stdio: 'inherit', windowsHide: true });
    child.on('error', e => {
      console.error(`xcore: the kit at ${kit} did not start: ${e.message}`);
      resolve(1);
    });
    child.on('close', code => resolve(code ?? 1));
  });
}

const NO_KIT = `That command belongs to the game-making kit (making a game from an idea, the studio page, verify and the
build loop). The kit is not released yet, so the command is not available here. With a copy of the kit, run xcore
inside its folder, or set GAMESFUN_KIT=<folder>.`;

/** The kit's own commands (@xgamesfun/kit's builder/commands, less those this package has): only these are said to be
 *  the kit's when there is no kit. */
export const KIT_COMMANDS = new Set([
  'art',
  'build',
  'catalog',
  'create',
  'doctor',
  'examples',
  'mcp',
  'meshy',
  'play',
  'promises',
  'reference',
  'rig-check',
  'session',
  'slots',
  'tool',
  'update',
  'verify',
  'voice-room',
]);

/** (the nearest name: ../lib/cli.mjs, which every command's subcommands use too) */
export { nearest };

/** What an unknown command is told: the kit's (only for one of its commands), else the nearest of ours. */
export function unknownCommand(name, commands) {
  if (KIT_COMMANDS.has(name)) return `"${name}" is a command of the game-making kit. ${NO_KIT}`;
  const near = nearest(name, [...commands.keys(), 'help']);
  return `"${name}" is not an xcore command.${near ? ` Did you mean "${near}"? ${CMD} ${near} --help says what it does.` : ''}`;
}

function help(commands, kit) {
  const lines = [
    'Usage: xcore <command> [options]',
    ...(CMD === 'xcore' ? [] : [`       (here: ${CMD} <command> [options])`]),
    '',
    'Host a web game you already made on xgames.fun, with a backend and an optional Solana economy.',
    '',
    'Commands:',
  ];
  for (const c of commands.values()) lines.push(`  ${c.name.padEnd(10)} ${c.summary}`);
  lines.push(
    '',
    ...(kit
      ? [
          `The game-making kit is installed (${kit}): create, verify, slots, build and its other commands run there. \`${CMD} help\` lists them.`,
          '',
        ]
      : []),
    `Run \`${CMD} <command> --help\` for a command's options. To start with a game you have: ${CMD} adopt <folder>`,
  );
  return lines.join('\n');
}

export async function main(argv) {
  const [name, ...args] = argv;
  const commands = await loadCommands();
  const kit = findKit();
  if (name === '--help' || name === '-h') {
    console.log(help(commands, kit));
    return 0;
  }
  if (name === '--version' || name === '-v') {
    console.log(readJson(path.join(HERE, '..', 'package.json')).version);
    return 0;
  }
  // no command (or a flag where one belongs) is a usage mistake, answered as every command answers one
  // (lib/cli.mjs guard): the help on stderr, exit code 2, and with --json the failure as JSON too
  if (!name || name.startsWith('-'))
    return guard(() => {
      throw new UsageError(
        `${name ? `No command before ${name}: xcore <command> [options].\n\n` : ''}${help(commands, kit)}`,
      );
    }, argv);
  // `xcore help <command>`: that command's help, as `xcore <command> --help` gives it
  const asked = name === 'help' && args[0] ? commands.get(args[0]) : null;
  if (asked) {
    console.log(asked.helpFor?.(args.slice(1)) ?? asked.usage ?? asked.summary);
    return 0;
  }
  const own = commands.get(name);
  const wantsHelp = args.includes('--help') || args.includes('-h');
  // `connect` with no kit here is this package's own; every other kit's turn without the kit says how to get it
  const kitTurn = name === 'help' || !own || kitsTurn(name, args);
  if (kitTurn && (kit || name !== 'connect')) {
    // a game the kit made is checked by the kit's verify (its six gates), the kit's own word for a check
    if (kit)
      return runKit(kit, name === 'help' ? ['help'] : name === 'check' && own ? ['verify', ...args] : [name, ...args]);
    if (name === 'help') {
      console.log(help(commands, null));
      return 0;
    }
    // without the kit, a command of ours still answers --help with what it does here (`backend use custom`)
    if (own && wantsHelp) {
      console.log(own.helpFor?.(args) ?? own.usage ?? own.summary);
      return 0;
    }
    console.error(
      own ? `${NO_KIT}\n\n${own.usage ?? ''}` : `${unknownCommand(name, commands)}\n\n${help(commands, null)}`,
    );
    // --json: the same failure as JSON on stdout, as every command's own failures are (lib/cli.mjs guard)
    if (args.includes('--json'))
      printJson({
        ok: false,
        error: (own ? NO_KIT : unknownCommand(name, commands)).replace(/\s*\n\s*/g, ' '),
        code: own || KIT_COMMANDS.has(name) ? 'no-kit' : 'unknown-command',
      });
    // the kit's command with no kit here is a refusal (1); a name that is no command is a usage mistake (2)
    return own || KIT_COMMANDS.has(name) ? 1 : 2;
  }
  if (wantsHelp) {
    console.log(own.helpFor?.(args) ?? own.usage ?? own.summary);
    return 0;
  }
  return (await own.run(args)) ?? 0;
}

// run as the command (npx and npm link start it through a symlink); imported by a test, it only exports
const entry = (() => {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return null;
  }
})();
if (import.meta.url === entry) process.exit(await main(process.argv.slice(2)));
