// `xcore secret set|list|delete`: a game server's own secrets on xgames.fun (../lib/publish/secrets.mjs).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import { deleteSecret, listSecrets, setSecret } from '../lib/publish/secrets.mjs';
import { studioOrigin } from '../lib/publish/client.mjs';
import { CMD } from '../lib/command.mjs';
import { changeCode, codeMatches, sameCommand, wrongCode } from '../lib/consent.mjs';
import { newVoucherKey } from '../lib/add.mjs';
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
                     this machine (it prints the key's address: a voucher key's goes in the grant), else from stdin
                     when it is piped, else typed (not shown)
  list               the names (values are never shown)
  delete <NAME>      remove one
A new name is set at once. Replacing a name the server has already, or deleting one, can't be undone (xgames.fun
never shows a value, so nothing brings the old one back): it first prints what it replaces or removes (never a value)
with a code, and changes nothing; it goes on when run again with --yes <code>. With --json, the printout is
{planned: true, code, plan, next}.
Names: A–Z, 0–9 and _, starting with a letter, not GF or GF_*; values up to 5,120 bytes; 32 secrets a game.`;

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
 * Replacing or deleting a secret the live server has: with --yes <code>, it goes on when the code is this change's and
 * is refused when it is another's; without it, the printout and its code, and nothing changes. The code is over the
 * game, the name and where the new value comes from, never the value itself. → true to go on, or the exit code
 */
function consented({ plan, lines, nothing, values, args }) {
  const code = changeCode(Object.values(plan));
  if (values.yes !== undefined) {
    if (!codeMatches(values.yes, code)) throw wrongCode();
    return true;
  }
  const next = `${sameCommand('secret', args)} --yes ${code}`;
  if (values.json) printJson({ ok: true, planned: true, code, plan, next });
  else console.log(`${lines.join('\n')}\n${nothing}. To go on, run this again with the code:\n  ${next}`);
  return 0;
}

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
        const go = consented({
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
      // what this machine can refuse is refused before xgames.fun is asked: the name, and a value read from a file
      const early = values['from-dev-vars']
        ? await fromDevVars(dir, name)
        : values['from-file']
          ? (await readFile(values['from-file'], 'utf8')).replace(/\r?\n$/, '')
          : null;
      const problem = secretNameProblem(name) ?? (early === null ? null : secretValueProblem(early));
      if (problem) throw new Error(problem);
      // a name the live server has already: replaced only after a yes to what it replaces (a new one is set at once)
      const { game, names } = await listSecrets(dir);
      if (names.includes(name)) {
        const key = !!values['new-key'];
        const go = consented({
          plan: { action: 'replace', origin: studioOrigin(), game, name, from: sourceOf(values) },
          lines: [
            `${shown(dir)}'s server on xgames.fun (game ${game}) has ${name} already. This replaces its value with ${sourceOf(values)}, from the server's next request.`,
            key
              ? `The key in ${name} now is gone for good: it was kept only on xgames.fun, which never shows it, so nothing restores it. The economy's grant names the old key's address, so what the server signs with the new one is refused on chain until the grant's "vouchers" in xsolana.json lists the new address and that change goes live (${CMD} loot approve, signed by the key file that owns the economy); from then, vouchers the old key signed that nobody redeemed yet stop paying.`
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
      const r = await setSecret(dir, name, value);
      if (out) out(made ? { ...r, address: made.address } : r);
      else {
        console.log(
          `Set ${name} on ${shown(dir)}'s server: env.${name} from its next request. (${r.names.length} secrets.)`,
        );
        if (made)
          console.log(
            `It is a new key, made here and kept only on xgames.fun's server. Its address: ${made.address}\nA voucher key's address goes in the grant's "vouchers" in xsolana.json (then ${CMD} loot approve).`,
          );
      }
      return 0;
    }, args),
};
