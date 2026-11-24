// Small helpers shared by commands/*.mjs.
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

/** `"<word>" is not one of: a, b or c` (or, with no word, what to name), for a subcommand a command does not have. */
export function notOneOf(word, names, what = 'command') {
  const list = `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
  return word ? `"${word}" is not a ${what} here: use ${list}.` : `Name a ${what}: ${list}.`;
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
