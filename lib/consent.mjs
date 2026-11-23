// A change that can't be undone, made on xgames.fun for the person (a write, an import or a restore of a game's live
// database; replacing or deleting a live secret; writing over or deleting a live project file), is printed first with a
// code: eight hex digits over exactly that change. It goes on only when the same command runs again with
// `--yes <code>`; a code made for another change is refused. The code is a hash of the printed change and nothing else,
// so nothing is kept between the two runs: a change that differs in any part (another statement, file, time, secret or
// game) has another code. `consented` below is that step, the same for every command that takes it. The same pattern
// as `xcore coin launch` (./coin.mjs launchCode) and `xcore loot approve`.
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { printJson } from './cli.mjs';
import { CMD, typedPath } from './command.mjs';

/** The code of a change: eight hex digits over its parts, in order. */
export function changeCode(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 8);
}

/** Does `yes` (what the person passed to --yes) name this code? */
export const codeMatches = (yes, code) =>
  String(yes ?? '')
    .trim()
    .toLowerCase() === code;

/** The refusal for a code that names another change. */
export function wrongCode() {
  return Object.assign(
    new Error(
      'That code is not for this change: the change differs from the one that was printed with it. Run it without --yes, read what it prints, and use the code it ends with.',
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

/**
 * The step before such a change. With --yes <code> (`values.yes`) it goes on when the code is this change's, and is
 * refused when it is another's. Without it, the change is printed (`lines`, in words; with --json,
 * {ok, planned: true, code, plan, next}) with its code and the command that goes on, and nothing changes.
 * `plan` is the change part by part, and its code is over those parts unless `code` gives one made already.
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
  code = changeCode(Object.values(plan)),
  lines,
  nothing,
  word = null,
  stdin = process.stdin,
  stderr = process.stderr,
}) {
  if (values.yes !== undefined) {
    if (!codeMatches(values.yes, code)) throw wrongCode();
    return true;
  }
  const next = `${sameCommand(sub, args)} --yes ${code}`;
  if (values.json) {
    printJson({ ok: true, planned: true, code, plan, next });
    return 0;
  }
  console.log(lines.join('\n'));
  if (!word || !stdin.isTTY) {
    console.log(`${nothing}. To go on, run this again with the code:\n  ${next}`);
    return 0;
  }
  const rl = createInterface({ input: stdin, output: stderr });
  try {
    const typed = (
      await rl.question(`Type ${word} to go on (or run it again with --yes ${code}), anything else to stop: `)
    )
      .trim()
      .toLowerCase();
    if (typed === word) return true;
  } finally {
    rl.close();
  }
  console.log(`${nothing}.`);
  return 1;
}
