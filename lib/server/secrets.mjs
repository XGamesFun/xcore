// A game server's own secrets (gf-server-v1, xgames.fun's hosting contract): `xcore secret set|list|delete`.
// The owner sets a name and a value; xgames.fun hands the value to Cloudflare as a secret on the game's server script
// and never stores, logs or answers it; the server reads env.<NAME> from the next request. Never the page: a page's
// files are public. Locally, `xcore dev` gives the server the same names from the game folder's .dev.vars.
// This file is the rules (shared with xcore dev's .dev.vars); the calls to xgames.fun are ../publish/secrets.mjs.

/** xgames.fun's limits for a game's secrets. */
export const SECRET_LIMITS = Object.freeze({ perGame: 32, valueBytes: 5120, nameChars: 64 });
const NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

/** The name's problem in plain words, or null (xgames.fun's rule). `taken`: the server's room bindings. */
export function secretNameProblem(name, taken = []) {
  if (typeof name !== 'string' || !NAME.test(name))
    return 'a secret’s name is 1–64 of A–Z, 0–9 and _, starting with a letter (for example VOUCHER_KEY)';
  if (name === 'GF' || name.startsWith('GF_'))
    return `${name} is xgames.fun’s own (env.GF and GF_*): pick another name`;
  if (taken.includes(name)) return `${name} is already one of the server's rooms (a Durable Object binding)`;
  return null;
}

/** The value's problem in plain words, or null. */
export function secretValueProblem(value) {
  if (typeof value !== 'string' || value === '') return 'the value is empty';
  if (Buffer.byteLength(value) > SECRET_LIMITS.valueBytes)
    return `a value is at most ${SECRET_LIMITS.valueBytes} bytes`;
  return null;
}
