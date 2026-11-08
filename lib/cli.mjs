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

/** Run a command body: prints errors plainly (no stack for expected ones) and maps them to exit codes. */
export async function guard(fn) {
  try {
    return (await fn()) ?? 0;
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(e.message);
      return 2;
    }
    console.error(`xcore: ${e.message}`);
    if (process.env.GAMESFUN_DEBUG) console.error(e.stack);
    return 1;
  }
}

export const printJson = v => {
  process.stdout.write(JSON.stringify(v, null, 2) + '\n');
};
