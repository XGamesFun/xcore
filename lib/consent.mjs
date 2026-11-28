// A change that can't be undone, made on xgames.fun for the person (a write, an import or a restore of a game's live
// database; replacing or deleting a live secret; writing over or deleting a live project file; a folder's first publish,
// which makes a game on the account), is printed first with a code: eight hex digits. It goes on only when the same
// command runs again with `--yes <code>`, within CODE_MINUTES, once. The code is random, made when the change is
// printed, and kept on this machine (in the user's config folder, readable by them only) with a hash of exactly that
// change: another change (another statement, file, time, secret, value or game) is refused with it, and so is the same
// change run a second time, or after the code ran out. Nothing about the change can be worked out into its code without
// the printout. `consented` below is that step, the same for every command that takes it. The same pattern as
// `xcore coin launch` (./coin.mjs launchCode) and `xcore loot approve`.
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { printJson } from './cli.mjs';
import { CMD, typedPath } from './command.mjs';
import { userConfigDir } from './config-dir.mjs';

/** How long a printed code goes on. */
export const CODE_MINUTES = 15;

/** A change's parts as one hash, in order: what a printed code is kept against (and the code of ./coin.mjs's own). */
export function changeCode(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 8);
}

const codesFile = env => path.join(userConfigDir({ env }), 'consent-codes.json');
const keyOf = (change, salt) =>
  createHash('sha256')
    .update(`${salt}\n${JSON.stringify(change)}`)
    .digest('hex');
function readCodes(env, now) {
  let all = {};
  try {
    all = JSON.parse(readFileSync(codesFile(env), 'utf8'));
  } catch {
    /* none kept, or a file that does not read: no code goes on */
  }
  if (!all || typeof all !== 'object' || Array.isArray(all)) all = {};
  for (const [code, e] of Object.entries(all)) if (!(e?.expires > now)) delete all[code];
  return all;
}
function writeCodes(env, all) {
  const file = codesFile(env);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
}

/**
 * A new code for `change` (anything JSON: the change's parts, and what binds it without being printed, such as a
 * secret's value), kept for CODE_MINUTES. → the code
 */
export function issueCode(change, { env = process.env, now = Date.now() } = {}) {
  const all = readCodes(env, now);
  let code;
  do code = randomBytes(4).toString('hex');
  while (all[code]);
  const salt = randomBytes(16).toString('hex');
  all[code] = { salt, key: keyOf(change, salt), expires: now + CODE_MINUTES * 60_000 };
  writeCodes(env, all);
  return code;
}

/**
 * Does `yes` (what the person passed to --yes) name a code printed for exactly `change`, still good? When it does, it
 * is used up, with every other code printed for the same change, unless `keep` (the caller uses it up once the change
 * is made: spendCode). → true or false
 */
export function takeCode(yes, change, { env = process.env, now = Date.now(), keep = false } = {}) {
  const code = String(yes ?? '')
    .trim()
    .toLowerCase();
  const all = readCodes(env, now);
  const e = all[code];
  if (!/^[0-9a-f]{8}$/.test(code) || !e || keyOf(change, e.salt) !== e.key) return false;
  if (keep) return true;
  for (const [c, other] of Object.entries(all)) if (keyOf(change, other.salt) === other.key) delete all[c];
  writeCodes(env, all);
  return true;
}

/** Does `yes` (what the person passed to --yes) name this code? */
export const codeMatches = (yes, code) =>
  String(yes ?? '')
    .trim()
    .toLowerCase() === code;

/** The refusal for a code that names another change, or was used already, or ran out. */
export function wrongCode() {
  return Object.assign(
    new Error(
      `That code is not for this change: the change differs from the one that was printed with it, or the code was used already, or it is more than ${CODE_MINUTES} minutes old (a code goes on once). Run it without --yes, read what it prints, and use the code it ends with.`,
    ),
    { code: 'code' },
  );
}

/** The command as the person ran it, without --yes and its code (nor --json), for the line that says how to go on. */
export function sameCommand(sub, args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--yes') {
      i++;
      continue;
    }
    if (args[i].startsWith('--yes=') || args[i] === '--json') continue;
    out.push(typedPath(args[i]));
  }
  return `${CMD} ${sub} ${out.join(' ')}`;
}

const changeOf = ({ plan, code = null, bind = null }) => ({ change: code ?? Object.values(plan), bind });

/** Use up the code `yes` for the change consented({keep: true}) let go on (the same plan, code and bind). */
export function spendCode(yes, { plan, code = null, bind = null, env = process.env }) {
  return takeCode(yes, changeOf({ plan, code, bind }), { env });
}

/**
 * The step before such a change. With --yes <code> (`values.yes`) it goes on when the code was printed for this change
 * and is still good (it is then used up), and is refused otherwise. Without it, the change is printed (`lines`, in
 * words; with --json, {ok, planned: true, code, plan, confirm}) with a new code and the command that goes on, and
 * nothing changes. `confirm` is that command: it is for after the person has read the plan and said yes, never one to
 * run unasked.
 * `plan` is the change part by part; the code is kept against `code` (a hash of the change made already) when given,
 * else against the plan's parts, and `bind` (what must match too but is never printed, such as a secret's value).
 * `keep`: a code that goes on is not used up here; the caller spends it (spendCode) once the change is made, so a
 * refusal that made nothing (a first publish stopped for its picture) leaves it good.
 * A command may name a `word`: a person at a terminal may then type it to go on in the same run. A script or an agent
 * has no terminal, and gets the printout.
 * `sub` and `args`: the command and its arguments as they were run. `nothing`: "Nothing was deleted", for the printout.
 * → true to go on, or the exit code to stop with: 0 after the printout, 1 when the person typed anything but the word
 */
export async function consented({
  sub,
  args,
  values,
  plan,
  code = null,
  bind = null,
  lines,
  nothing,
  word = null,
  stdin = process.stdin,
  stderr = process.stderr,
  env = process.env,
  keep = false,
}) {
  const change = changeOf({ plan, code, bind });
  if (values.yes !== undefined) {
    if (!takeCode(values.yes, change, { env, keep })) throw wrongCode();
    return true;
  }
  const printed = issueCode(change, { env });
  const confirm = `${sameCommand(sub, args)} --yes ${printed}`;
  if (values.json) {
    printJson({ ok: true, planned: true, code: printed, plan, confirm });
    return 0;
  }
  console.log(lines.join('\n'));
  if (!word || !stdin.isTTY) {
    console.log(`${nothing}. To go on, run this again with the code:\n  ${confirm}`);
    return 0;
  }
  const rl = createInterface({ input: stdin, output: stderr });
  try {
    const typed = (
      await rl.question(`Type ${word} to go on (or run it again with --yes ${printed}), anything else to stop: `)
    )
      .trim()
      .toLowerCase();
    if (typed === word) {
      // typed here: the code printed for it is not needed any more
      takeCode(printed, change, { env });
      return true;
    }
  } finally {
    rl.close();
  }
  console.log(`${nothing}.`);
  return 1;
}
