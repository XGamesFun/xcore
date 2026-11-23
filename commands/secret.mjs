// `xcore secret set|list|delete`: a game server's own secrets on xgames.fun (../lib/publish/secrets.mjs).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import { deleteSecret, listSecrets, setSecret } from '../lib/publish/secrets.mjs';
import { studioOrigin } from '../lib/publish/client.mjs';
import { CMD } from '../lib/command.mjs';
import { consented } from '../lib/consent.mjs';
import { allowOrigin, newVoucherKey, seedAddress } from '../lib/add.mjs';
import { economyCluster, solanaRpc } from '../lib/solana-rpc.mjs';
import { pointGrantsAt } from '../lib/voucher-key.mjs';
import { readEconomy } from '../lib/economy.mjs';
import { plural } from '../lib/util.mjs';
import { secretNameProblem, secretValueProblem } from '../lib/server/secrets.mjs';

const usage = `Usage: xcore secret set <NAME> [dir] [--from-file <path> | --from-dev-vars | --new-key] [--yes <code>] [--json]
       xcore secret list [dir] [--json]
       xcore secret delete <NAME> [dir] [--yes <code>] [--json]

A key your game's server needs and no player may see (a voucher-signing key, an outside API's key, an RPC URL with
its key): the server reads it as env.<NAME>. xgames.fun keeps the value only on the server's host (Cloudflare), never
shows it again and never gives it to the page. Set it after the game is published with its server/; it reaches the
server's next request, with no publish. On this machine, ${CMD} dev reads the same names from the game folder's
.dev.vars (NAME=value lines; a hidden file, so publish never sends it; keep it out of git).
  set <NAME>         the value from --from-file, or the folder's .dev.vars (--from-dev-vars: the same key as under
                     xcore dev), or --new-key: a new Ed25519 key made here and sent to xgames.fun only, never kept on
                     this machine (it prints the key's address; for VOUCHER_SEED it points the grants the server pays
                     at it in xsolana.json, then xcore loot approve), else from stdin when it is piped, else typed (not
                     shown)
  list               the names (values are never shown)
  delete <NAME>      remove one
A new name is set at once. Replacing a name the server has already, or deleting one, can't be undone (xgames.fun
never shows a value, so nothing brings the old one back): it first prints what it replaces or removes (never a value)
with a code, and changes nothing; it goes on when run again with --yes <code>. With --json, the printout is
{planned: true, code, plan, next}.
Names: A–Z, 0–9 and _, starting with a letter, not GF or GF_*; values up to 5,120 bytes; 32 secrets a game.`;

/** What is wrong with `value` as the server's RPC URL (`name` XSOLANA_RPC_URL or LOOT_RPC_URL), on the economy's cluster. */
function rpcProblem(dir, name, value) {
  if (name !== 'XSOLANA_RPC_URL' && name !== 'LOOT_RPC_URL') return null;
  const rpc = solanaRpc({ XSOLANA_RPC_URL: value }, { file: null, cluster: economyCluster(dir) });
  return rpc.problem
    ? `${name} ${rpc.problem.replace(/^XSOLANA_RPC_URL /, '').replace(/; using .*$/, '')}. Nothing was set.`
    : null;
}

/** Typed with nothing echoed; Ctrl+C stops. */
async function hidden(question) {
  const { stdin, stderr } = process;
  if (!stdin.isTTY)
    throw new UsageError(`no value: pipe it in, use --from-file, or run this in a terminal\n\n${usage}`);
  stderr.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const done = err => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stderr.write('\n');
      if (err) reject(err);
      else resolve(value);
    };
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new UsageError('stopped: nothing was set'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}
/**
 * Replacing or deleting a secret the live server has, asked first (../lib/consent.mjs consented). The code is over the
 * game, the name and where the new value comes from, never the value itself. It goes on with the code only: there is
 * no word to type at a terminal.
 */
const asked = change => consented({ sub: 'secret', ...change });

/** Where a set's value comes from, as a word in its plan (never the value). */
function sourceOf(values) {
  if (values['new-key']) return 'a new key made here (--new-key)';
  if (values['from-dev-vars']) return 'the folder’s .dev.vars';
  if (values['from-file']) return `the file ${path.resolve(values['from-file'])}`;
  return process.stdin.isTTY ? 'typed here' : 'piped in';
}

async function piped() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}

/** NAME's value in the game folder's .dev.vars (what xcore dev gives the server). */
async function fromDevVars(dir, name) {
  const { readDevVars, DEV_VARS } = await import('../lib/dev/server.mjs');
  const { secrets } = await readDevVars(dir);
  if (!secrets[name]) throw new UsageError(`${DEV_VARS} in ${shown(dir)} has no ${name}`);
  return secrets[name];
}

export default {
  name: 'secret',
  summary: "a game server's secrets on xgames.fun (env.<NAME>): set, list, delete; never the page's",
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(
        args,
        {
          'from-file': { type: 'string' },
          'from-dev-vars': { type: 'boolean' },
          'new-key': { type: 'boolean' },
          yes: { type: 'string' },
        },
        usage,
      );
      const [verb, ...rest] = positionals;
      const needsName = verb === 'set' || verb === 'delete';
      if (!['set', 'list', 'delete'].includes(verb)) throw new UsageError(usage);
      if (needsName && !rest[0]) throw new UsageError(`${verb} needs a NAME\n\n${usage}`);
      const name = needsName ? rest[0] : null;
      const dir = await resolveGame(needsName ? rest[1] : rest[0]);
      const out = values.json ? printJson : null;
      if (verb === 'list') {
        const r = await listSecrets(dir);
        if (out) out(r);
        else
          console.log(
            r.names.length
              ? `${shown(dir)}'s server has ${r.names.length} secret${r.names.length === 1 ? '' : 's'}: ${r.names.join(', ')}`
              : `${shown(dir)}'s server has no secrets yet (${CMD} secret set <NAME>).`,
          );
        return 0;
      }
      if (verb === 'delete') {
        const bad = secretNameProblem(name);
        if (bad) throw new Error(bad);
        const { game, names } = await listSecrets(dir);
        if (!names.includes(name)) {
          if (out) out({ ok: true, game, name, removed: false, names });
          else console.log(`${name} was not set: nothing to delete.`);
          return 0;
        }
        const go = await asked({
          plan: { action: 'delete', origin: studioOrigin(), game, name },
          lines: [
            `This deletes ${name} from ${shown(dir)}'s server on xgames.fun (game ${game}). From its next request the server has no env.${name}, and the value is gone for good: xgames.fun never shows a secret, so nothing can bring it back.`,
          ],
          nothing: 'Nothing was deleted',
          values,
          args,
        });
        if (go !== true) return go;
        const r = await deleteSecret(dir, name);
        if (out) out(r);
        else
          console.log(
            r.removed
              ? `Deleted ${name}: the server's next request no longer has env.${name}.`
              : `${name} was not set.`,
          );
        return 0;
      }
      if ([values['from-file'], values['from-dev-vars'], values['new-key']].filter(Boolean).length > 1)
        throw new UsageError(`one of --from-file, --from-dev-vars and --new-key\n\n${usage}`);
      // the economy file is read for these (a voucher key's address is written into it, an RPC is held to its cluster):
      // one that does not read refuses here, before the value the live server has is replaced
      if (['VOUCHER_SEED', 'XSOLANA_RPC_URL', 'LOOT_RPC_URL'].includes(name)) readEconomy(dir);
      // what this machine can refuse is refused before xgames.fun is asked: the name, and a value read from a file
      const early = values['from-dev-vars']
        ? await fromDevVars(dir, name)
        : values['from-file']
          ? (await readFile(values['from-file'], 'utf8')).replace(/\r?\n$/, '')
          : null;
      const problem =
        secretNameProblem(name) ??
        (early === null ? null : (secretValueProblem(early) ?? rpcProblem(dir, name, early)));
      if (problem) throw new Error(problem);
      // a name the live server has already: replaced only after a yes to what it replaces (a new one is set at once)
      const { game, names } = await listSecrets(dir);
      if (names.includes(name)) {
        const key = !!values['new-key'];
        const go = await asked({
          plan: { action: 'replace', origin: studioOrigin(), game, name, from: sourceOf(values) },
          lines: [
            `${shown(dir)}'s server on xgames.fun (game ${game}) has ${name} already. This replaces its value with ${sourceOf(values)}, from the server's next request.`,
            key
              ? `The key in ${name} now is gone for good: it was kept only on xgames.fun, which never shows it, so nothing restores it. The grants the server pays are pointed at the new key in xsolana.json as it is made; what the server signs with it is refused on chain until that change goes live (${CMD} loot approve, signed by the key file that owns the economy), and from then vouchers the old key signed that nobody redeemed yet stop paying.`
              : `The value it has now is gone for good: xgames.fun never shows a secret, so nothing brings it back. Anything that still needs the old value (a voucher key's address in a grant, an outside service's old key) stops working with this server.`,
          ],
          nothing: 'Nothing was replaced',
          values,
          args,
        });
        if (go !== true) return go;
      }
      const made = values['new-key'] ? await newVoucherKey() : null;
      const value = made
        ? made.seed
        : (early ?? (process.stdin.isTTY ? await hidden(`Value for ${name} (not shown): `) : await piped()));
      // the server's RPC: a URL on the economy's cluster, whose origin backend.json lets the server call. An origin not
      // there yet is added, and the URL waits for the publish that sends it: set before, the page would send its
      // calls to a server that may not make them
      if (name === 'XSOLANA_RPC_URL' || name === 'LOOT_RPC_URL') {
        const bad = rpcProblem(dir, name, value);
        if (bad) throw new Error(bad);
        const origin = new URL(value.trim()).origin;
        const { file, added } = await allowOrigin(dir, origin);
        if (added) {
          const where = path.relative(process.cwd(), file) || file;
          if (out) out({ ok: false, game, name, set: false, added: origin, file: where, next: `${CMD} publish` });
          else
            console.log(
              `Not set yet: the game's server may call only the origins in ${where}, and ${origin} was not one. It is now: publish (${CMD} publish), then run this again, and the server takes the URL with leave to call it.`,
            );
          return 0;
        }
      }
      const r = await setSecret(dir, name, value);
      // a voucher key: the grants the server pays point at it in the economy, so no address is copied by hand. A new
      // one's address is known; a seed brought from elsewhere (.dev.vars, a file, typed) gives its own
      const seed = !made && name === 'VOUCHER_SEED' && /^[0-9a-fA-F]{64}$/.test(value.trim()) ? value.trim() : null;
      const live = made ?? (seed ? { address: await seedAddress(seed.toLowerCase()) } : null);
      const pointed = live && name === 'VOUCHER_SEED' ? await pointGrantsAt(dir, live.address) : null;
      if (out) out(live ? { ...r, address: live.address, ...(pointed ? { economy: pointed } : {}) } : r);
      else {
        console.log(
          `Set ${name} on ${shown(dir)}'s server: env.${name} from its next request. (${plural(r.names.length, 'secret')}.)`,
        );
        if (made)
          console.log(`It is a new key, made here and kept only on xgames.fun's server. Its address: ${made.address}`);
        else if (live) console.log(`Its address: ${live.address}`);
        if (pointed?.changed.length)
          console.log(
            `In ${path.relative(process.cwd(), pointed.economy) || pointed.economy}:\n${pointed.changed.map(l => `  ${l}`).join('\n')}\nThe chain takes it once you approve it: ${CMD} loot approve (signed by the key file that owns the economy).`,
          );
        else if (live && name === 'VOUCHER_SEED' && !pointed?.economy)
          console.log(
            `The game has no economy yet: ${CMD} add vouchers points its grants at this key once it has one.`,
          );
        for (const line of pointed?.left ?? []) console.log(`Left as it is: ${line}`);
      }
      return 0;
    }, args),
};
