// Small helpers shared by commands/*.mjs.
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

/** util.parseArgs with positionals allowed; a bad flag becomes a UsageError carrying the command's usage text. */
export function parse(args, options, usage) {
  try {
    return parseArgs({
      args,
      options: { json: { type: 'boolean' }, ...options },
      allowPositionals: true,
      strict: true,
    });
  } catch (e) {
    // Node's own words, to their first sentence ("Unknown option '--x'."; the rest is about '--' and positionals)
    const why = /^Unknown option '[^']*'\./.exec(e.message)?.[0] ?? e.message;
    throw new UsageError(`${why}\n\n${usage}`);
  }
}

export class UsageError extends Error {}

/** Edit distance (insertions, deletions, substitutions and swaps of two letters side by side). */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/** The command a mistyped name most likely meant: the nearest of `names` within a couple of letters, or null. */
export function nearest(name, names) {
  const word = name.toLowerCase();
  let best = null;
  for (const n of names) {
    const dist = distance(word, n);
    if (dist <= Math.max(1, Math.floor(n.length / 3)) && (!best || dist < best.dist)) best = { n, dist };
  }
  return best?.n ?? null;
}

/** The game's folder, given as a word or as --dir (both, and different: a usage mistake). → it, or undefined */
export function folderArg(dir, word, usage) {
  if (dir !== undefined && word !== undefined && dir !== word)
    throw new UsageError(`Give the game's folder once: ${word} or --dir ${dir}\n\n${usage}`);
  return dir ?? word;
}

/** Other names a subcommand answers to, in every group that has it: list (ls) and remove (rm, delete). */
export const VERB_ALIASES = Object.freeze({ ls: 'list', rm: 'remove', delete: 'remove' });

/** The subcommand `word` names among `verbs` (their canonical names), aliases included. → its canonical name, or null */
export function verbNamed(word, verbs) {
  const w = String(word ?? '').toLowerCase();
  const name = VERB_ALIASES[w] ?? w;
  return verbs.includes(name) ? name : null;
}

/** What an unknown subcommand is told: the subcommands there are, and the nearest one (or, with no word, what to name). */
export function notOneOf(word, names) {
  const list = `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
  if (!word) return `Name a subcommand: ${list}.`;
  const aliases = Object.keys(VERB_ALIASES).filter(a => names.includes(VERB_ALIASES[a]));
  const near = nearest(String(word), [...names, ...aliases]);
  return `Unknown subcommand "${word}": use ${list}.${near ? ` Did you mean "${VERB_ALIASES[near] ?? near}"?` : ''}`;
}

/**
 * The subcommand of a group whose subcommand may be left out (embed, domain, coin: `xcore embed` lists): the first
 * word names one, or is the game's folder when it is a folder; a word that is neither is an unknown subcommand, never
 * "no such folder". → {verb, rest} (`rest`: the words after the subcommand)
 */
export function verbOrFolder(positionals, verbs, fallback, usage) {
  const [first, ...more] = positionals;
  const verb = verbNamed(first, verbs);
  if (verb) return { verb, rest: more };
  if (first === undefined || existsSync(first)) return { verb: fallback, rest: positionals };
  throw new UsageError(`${notOneOf(first, verbs)}\n\n${usage}`);
}
/** `Too many arguments: x y` for positionals past the ones a command takes. */
export const tooMany = extra => `Too many arguments: ${extra.join(' ')}.`;

/**
 * Run a command body: prints errors plainly (no stack for expected ones) and maps them to exit codes. `args`: the
 * command's arguments; with --json among them a failure is also said on stdout, as
 * { ok: false, error, code, state?, next?, card? }, so a script or an agent reads why from the JSON it asked for (`code` is
 * the refusal's word: 'usage', 'login', 'files', 'secrets', 'build'…, and 'failed' for one that has no word of its
 * own; `next`, the command that moves it on). failureJson is that shape, for a command that prints a report of its own.
 */
export async function guard(fn, args = []) {
  const json = args.includes('--json');
  try {
    return (await fn()) ?? 0;
  } catch (e) {
    // xgames.fun refused a game this computer's sign-in was not given: said as that, with what to do
    if (e?.code === 'not-granted') await (await import('./login-reach.mjs')).explainNotGranted(e).catch(() => {});
    // a usage mistake: a UsageError, or a refusal a library coded as one (lib/coin.mjs): one exit code for both
    const usage = e instanceof UsageError || e?.code === 'usage';
    console.error(usage ? shortUsage(e.message) : `xcore: ${e.message}`);
    if (!usage && process.env.GAMESFUN_DEBUG) console.error(e.stack);
    if (json)
      printJson({
        ...failureJson(
          usage ? e.message.split('\n')[0] : e.message,
          // (a system's own code, such as ENOENT, is no word of the command's)
          usage ? 'usage' : typeof e.code === 'string' && !/^E[A-Z]+$/.test(e.code) ? e.code : undefined,
        ),
        ...(typeof e.state === 'string' ? { state: e.state } : {}),
        ...(typeof e.next === 'string' ? { next: e.next } : {}),
        // publish's refusal for the preview picture carries what it found (../lib/card.mjs cardJson)
        ...(e.card && typeof e.card === 'object' ? { card: e.card } : {}),
      });
    return usage ? 2 : 1;
  }
}

/**
 * A usage mistake as it is printed: what was wrong, the command's usage lines (not its whole help), and where the help
 * is. The top-level help (no command) is printed whole.
 */
export function shortUsage(text) {
  const at = text.indexOf('Usage: xcore ');
  if (at < 0) return text;
  const synopsis = text.slice(at).split('\n\n')[0];
  const command = /^Usage: xcore ([a-z]+(?: (?:add|use custom))?)\b/.exec(synopsis)?.[1];
  if (!command || command === 'command') return text;
  const why = text.slice(0, at).trim();
  return [why, synopsis, `Run \`xcore ${command} --help\` for the options.`].filter(Boolean).join('\n\n');
}

/** A failure as every command's --json says one: { ok: false, error, code } (`code`: 'failed' when it has no word). */
export const failureJson = (error, code = 'failed') => ({ ok: false, error, code });

export const printJson = v => {
  process.stdout.write(JSON.stringify(v, null, 2) + '\n');
};
