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
    throw new UsageError(`${e.message}\n\n${usage}`);
  }
}

export class UsageError extends Error {}

/**
 * Run a command body: prints errors plainly (no stack for expected ones) and maps them to exit codes. `args`: the
 * command's arguments; with --json among them a failure is also said on stdout, as
 * { ok: false, error, code?, state?, next? }, so a script or an agent reads why from the JSON it asked for (`code` is
 * the refusal's word: 'usage', 'login', 'files', 'secrets', 'build'…; `next`, the command that moves it on).
 */
export async function guard(fn, args = []) {
  const json = args.includes('--json');
  try {
    return (await fn()) ?? 0;
  } catch (e) {
    const usage = e instanceof UsageError;
    console.error(usage ? e.message : `xcore: ${e.message}`);
    if (!usage && process.env.GAMESFUN_DEBUG) console.error(e.stack);
    if (json)
      printJson({
        ok: false,
        error: usage ? e.message.split('\n')[0] : e.message,
        ...(usage
          ? { code: 'usage' }
          : typeof e.code === 'string' && !/^E[A-Z]+$/.test(e.code)
            ? { code: e.code }
            : {}),
        ...(typeof e.state === 'string' ? { state: e.state } : {}),
        ...(typeof e.next === 'string' ? { next: e.next } : {}),
      });
    return usage ? 2 : 1;
  }
}

export const printJson = v => {
  process.stdout.write(JSON.stringify(v, null, 2) + '\n');
};
