// A change that can't be undone, made on xgames.fun for the person (a write, an import or a restore of a game's live
// database; replacing or deleting a live secret), is printed first with a code: eight hex digits over exactly that
// change. It goes on only when the same command runs again with `--yes <code>`; a code made for another change is
// refused. The code is a hash of the printed change and nothing else, so nothing is kept between the two runs: a
// change that differs in any part (another statement, file, time, secret or game) has another code. The same pattern
// as `xcore coin launch` (./coin.mjs launchCode) and `xcore loot approve`.
import { createHash } from 'node:crypto';
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
