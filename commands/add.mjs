// `xcore add signin|database|multiplayer|rpc|vouchers [folder]`: xgames.fun's player sign-in, saves and leaderboards, a database of
// the game's own, multiplayer rooms, the economy's own Solana RPC or its own voucher key, put into a web game, a Godot 4 project or a Unity project (../lib/add.mjs).
import path from 'node:path';
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { shown } from '../lib/games.mjs';
import { addDatabase, addMultiplayer, addRpc, addSignin, addVouchers } from '../lib/add.mjs';

const usage = `Usage: xcore add signin|database|multiplayer|rpc|vouchers [folder] [--json]

  signin     xgames.fun's player sign-in (X first, or a wallet), each player's saves and leaderboards, from the game's
             own code. A web game gets gamesfun.js beside its page; a Godot 4 project an autoload (GamesFun); a Unity
             project a WebGL plugin (Assets/Plugins/GamesFun). On this machine a local player stands in.
  database   all of signin, and a database of the game's own: server code (server/database.js, SQLite on xgames.fun)
             that publish puts up with the game. Documents in collections; who may read and write each is in its RULES.
  multiplayer
             all of signin, and rooms of the game's own: server code (server/rooms.js) that relays between the players
             of a room, the first in its host. Godot's high-level multiplayer (RPCs, spawners, synchronizers) runs over
             it unchanged (GamesFun.join_room); Unity and web games get a room with send and events.
  rpc        the economy's Solana calls through the game's own devnet RPC (server/rpc.js at api/rpc, its URL a
             secret of the server: xcore secret set XSOLANA_RPC_URL), not xgames.fun's shared relay, which counts
             every call toward the game's plan.
  vouchers   the game's own voucher key, so its server pays the results it checked from a grant in the economy
             (server/vouchers.js at api/vouchers/: PAY.check decides; a Durable Object pays each result once). Makes
             a test key (its seed in .dev.vars; the live key: xcore secret set VOUCHER_SEED --new-key) and says its
             address for the grant. For prizes by place that xgames.fun's keeper can sign instead, docs/SERVER.md.

Run it again to bring the files it wrote up to date. The folder defaults to the one you are in.`;

export default {
  name: 'add',
  summary:
    "give a web, Godot or Unity game xgames.fun's sign-in, saves and leaderboards, a database, multiplayer, its own RPC or voucher key",
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(args, {}, usage);
      const what = positionals[0];
      const add = {
        signin: addSignin,
        database: addDatabase,
        multiplayer: addMultiplayer,
        rpc: addRpc,
        vouchers: addVouchers,
      }[what];
      if (!add) throw new UsageError(usage);
      const dir = path.resolve(positionals[1] ?? '.');
      const r = await add(dir);
      if (values.json) return printJson({ ok: true, what, dir, ...r });
      const kind = { page: 'a web game', godot: 'a Godot project', unity: 'a Unity project' }[r.engine];
      console.log(`${shown(dir)}: ${kind}`);
      for (const w of r.written.length ? r.written : ['already up to date']) console.log(`  ${w}`);
      console.log('\nNext:');
      for (const s of r.steps) console.log(`  - ${s}`);
    }, args),
};
