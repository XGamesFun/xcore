#!/usr/bin/env node
// The `xcore` command (@xgamesfun/xcore): xgames.fun's own (sign in, bring a game, check it as the host serves it, its
// backend and economy, publish). Each command is a module in ../commands/<name>.mjs exporting `default { name,
// summary, usage, run(args) }`, and optionally `helpFor(args)`, the --help text of a subcommand. Everything else is the
// kit's (@xgamesfun/kit: create, verify, the build loop and the rest): when the kit is here, those go to it as
// they are, and so do publish and check for a game the kit made (its six gates) and every backend the kit connects;
// without it, the command says how to get it.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CMD } from '../lib/command.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = path.join(HERE, '..', 'commands');
const KIT = '@xgamesfun/kit';
const readJson = file => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

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
const VALUE_FLAGS = Object.fromEntries(
  ['out', 'port', 'title', 'url', 'origin'].map(f => [f, { type: 'string', multiple: true }]),
);

/** Does this command, with these arguments, belong to the kit even though this package has a command by its name? */
export function kitsTurn(name, args) {
  const { positionals } = parseArgs({ args, options: VALUE_FLAGS, strict: false, allowPositionals: true });
  if (name === 'backend') return !(positionals[0] === 'use' && positionals[1] === 'custom');
  if (name === 'publish' || name === 'check' || name === 'dev') {
    const dir = path.resolve(positionals[0] ?? '.');
    return existsSync(path.join(dir, 'gf-three.json'));
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

const NO_KIT = `That is the kit's (@xgamesfun/kit): it makes games, the studio page, verify and the build loop. The kit is
not released yet; with a checkout of it, run xcore inside that folder, or set GAMESFUN_KIT=<folder> to use it from anywhere.`;

function help(commands, kit) {
  const lines = ['Usage: xcore <command> [options]', '', 'xgames.fun:'];
  for (const c of commands.values()) lines.push(`  ${c.name.padEnd(10)} ${c.summary}`);
  lines.push(
    '',
    kit
      ? `With the kit (${kit}): create, verify, slots, build and the rest; ${CMD} help there lists them.`
      : "Making a game from an idea, the studio page and verify are the kit's (@xgamesfun/kit).",
    '',
    `Run \`xcore <command> --help\` for a command's options. Already have a game? ${CMD} adopt <folder>.`,
  );
  return lines.join('\n');
}

export async function main([name, ...args]) {
  const commands = await loadCommands();
  const kit = findKit();
  if (!name || name === '--help' || name === '-h') {
    console.log(help(commands, kit));
    return name ? 0 : 1;
  }
  if (name === '--version' || name === '-v') {
    console.log(readJson(path.join(HERE, '..', 'package.json')).version);
    return 0;
  }
  const own = commands.get(name);
  const wantsHelp = args.includes('--help') || args.includes('-h');
  if (name === 'help' || !own || kitsTurn(name, args)) {
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
      own
        ? `${NO_KIT}\n\n${own.usage ?? ''}`
        : `"${name}" is not a xgames.fun command. ${NO_KIT}\n\n${help(commands, null)}`,
    );
    return 1;
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
