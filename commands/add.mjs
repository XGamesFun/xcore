// `xcore add signin|database|multiplayer|rpc|vouchers [folder]`: xgames.fun's player sign-in, saves and leaderboards, a database of
// the game's own, multiplayer rooms, the economy's own Solana RPC or its own voucher key, put into a web game, a Godot 4 project or a Unity project (../lib/add.mjs).
import path from 'node:path';
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { shown } from '../lib/games.mjs';
import { addDatabase, addMultiplayer, addRpc, addSignin, addVouchers } from '../lib/add.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore add signin|database|multiplayer|rpc|vouchers [folder] [--verbose] [--json]

Add xgames.fun services to a web, Godot 4 or Unity game. Each one writes files into the game; run the same command
again to update the files it wrote. The folder defaults to the current directory.
It prints what it wrote and the next steps in short; --verbose prints every note, and --json has both.

  signin       Player sign-in through xgames.fun (X or Google; a Solana wallet the player linked comes with the
               sign-in), plus each player's saves and the game's leaderboards, called from the game's own code.
               A web game gets gamesfun.js next to its page, a Godot 4 project an autoload (GamesFun), and a Unity
               project a WebGL plugin (Assets/Plugins/GamesFun). On this machine, a local player stands in.
  database     Everything signin adds, plus a database for the game: one D1 database per game, created on
               xgames.fun by the first publish (gamesfun.json → database).
               - With its own server, the game's code reads and writes it (server/gf-db.js; tables come from
                 server/migrations/).
               - Without one, xcore's stock server stores the page's documents in it (GamesFun.db), each player's own,
                 under gamesfun.json → database.collections.
               xcore db queries, exports and restores it.
  multiplayer  Everything signin adds, plus rooms for the game: server code (server/rooms.js) that relays messages
               between the players in a room; the first player to join is the host. Godot's high-level multiplayer
               (RPCs, spawners, synchronizers) runs over it unchanged (GamesFun.join_room). Unity and web games get a
               room with send and events.
  rpc          Send the economy's Solana calls through the game's own devnet RPC (server/rpc.js at api/rpc; its URL
               is a server secret: ${CMD} secret set XSOLANA_RPC_URL) instead of xgames.fun's shared relay, which
               counts every call toward the game's plan.
  vouchers     A voucher key for the game, so its server can pay results it has checked from a grant in the
               economy (server/vouchers.js at api/vouchers/; PAY.check decides, and a Durable Object pays each
               result once). It creates a test key (its seed goes in .dev.vars; set the live key with
               ${CMD} secret set VOUCHER_SEED --new-key) and prints its address for the grant. For prizes by
               place, which xgames.fun's keeper can sign instead, see docs/SERVER.md.

Options:
  --verbose    print every note on using what was added, not only the next steps
  --json       print the result as JSON (what was written, next, and every note in steps)`;

const KINDS = {
  signin: addSignin,
  database: addDatabase,
  multiplayer: addMultiplayer,
  rpc: addRpc,
  vouchers: addVouchers,
};

/** What `xcore add` says when it is not told which part, or told one it does not have. */
export function unknownKind(what) {
  const names = Object.keys(KINDS);
  const list = `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
  if (!what) return `Say what to add: ${list}.`;
  const near = names.find(n => n.startsWith(String(what).toLowerCase().slice(0, 3)));
  return `"${what}" is not something xcore can add. It adds ${list}.${near ? ` Did you mean "${near}"?` : ''}`;
}

/**
 * What `xcore add` prints: what it wrote, the next steps in short, and where the rest is. With verbose, every note
 * (r.steps) in place of the short steps. --json has both (next and steps).
 */
export function addedLines(what, where, r, { verbose = false } = {}) {
  const kind = { page: 'a web game', godot: 'a Godot project', unity: 'a Unity project' }[r.engine];
  const lines = [`Added ${what} to ${where} (${kind}):`];
  for (const w of r.written.length ? r.written : ['already up to date']) lines.push(`  ${w}`);
  const steps = verbose ? r.steps : (r.next ?? r.steps);
  if (steps.length) lines.push('', 'Next:', ...steps.map((s, i) => `  ${i + 1}. ${s}`));
  if (!verbose && r.next && r.steps.length)
    lines.push('', `Details (${r.steps.length} notes): ${CMD} add ${what} ${where === '.' ? '.' : where} --verbose`);
  return lines;
}

export default {
  name: 'add',
  summary: 'add sign-in, saves, leaderboards, a database, multiplayer, an RPC or a voucher key',
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(args, { verbose: { type: 'boolean' } }, usage);
      const what = positionals[0];
      const add = KINDS[what];
      if (!add) throw new UsageError(`${unknownKind(what)}\n\n${usage}`);
      const dir = path.resolve(positionals[1] ?? '.');
      const r = await add(dir);
      if (values.json) return printJson({ ok: true, what, dir, ...r });
      console.log(addedLines(what, shown(dir), r, { verbose: values.verbose === true }).join('\n'));
    }, args),
};
