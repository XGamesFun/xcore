// The first publish of a folder makes a new game under the account this computer is signed in to, and takes one of
// that account's game slots. So it is confirmed first: the account, the game's name and the slot are printed, and it
// goes on when the person types "publish" at a terminal, or runs it again with --yes <code> (lib/consent.mjs, the
// pattern every change that can't be undone uses). Publishing a folder already linked to a game is not asked about.
// A GitHub Actions job (its OIDC token) publishes only the game its repository was linked to in Studio, so it is not
// asked either.
import path from 'node:path';
import { changeCode, consented } from '../consent.mjs';
import { call } from './client.mjs';
import { readLinks } from './index.mjs';
import { requireCredential } from './oidc.mjs';
import { pageTitle } from './page.mjs';

/** The slot a new game takes, in words, from GET /api/kit/plan (null: xgames.fun did not say). */
export function slotWords(plan) {
  const free = plan?.gameSlots?.free;
  if (!free || !Number.isFinite(free.slots) || !Number.isFinite(free.used)) return null;
  if (free.used >= free.slots)
    return `none: all ${free.slots} free slots are in use, so xgames.fun will refuse a new game until one is open`;
  return `one of your ${free.slots} free slots (${free.used} in use now, ${free.used + 1} after this)`;
}

/**
 * What the first publish of `dir` would create, or null when it creates nothing new (the folder is linked to a game on
 * `origin`, or the credential is a CI job's) or when it can't be said yet (not signed in: publish says so itself).
 * → {plan: {studio, account, game, folder, slot}, code}
 */
export async function firstPublish(dir, { origin, newGame = false, title = null, env, fetchImpl = fetch }) {
  const known = newGame ? null : ((await readLinks(dir))[origin] ?? null);
  if (known?.projectId) return null;
  const cred = await requireCredential(origin, { env, fetchImpl }).catch(() => null);
  if (!cred || cred.kind !== 'login') return null;
  const auth = await cred.auth();
  const me = await call(origin, '/api/kit/me', { ...auth, fetchImpl }).catch(() => null);
  if (!me) return null;
  const plan = await call(origin, '/api/kit/plan', { ...auth, fetchImpl }).catch(() => null);
  const folder = path.basename(path.resolve(dir));
  const game = title ?? pageTitle(dir) ?? folder;
  const account = me.email ?? cred.label ?? 'this sign-in';
  return {
    plan: {
      studio: origin,
      account,
      game,
      folder,
      slot: slotWords(plan) ?? 'one of your free slots (xgames.fun did not say how many are in use)',
    },
    code: changeCode([origin, account, game, folder]),
  };
}

/**
 * The confirmation before a first publish: → true to go on, or the exit code to stop with (0 after the printout).
 * `first`: firstPublish's answer.
 */
export function confirmFirstPublish(first, { args, values, stdin, stderr }) {
  const { plan, code } = first;
  return consented({
    sub: 'publish',
    args,
    values,
    plan,
    code,
    word: 'publish',
    nothing: 'Nothing was published',
    stdin,
    stderr,
    lines: [
      `This creates a new game on ${plan.studio}:`,
      `  account: ${plan.account}`,
      `  game:    “${plan.game}” (from the folder ${plan.folder})`,
      `  slot:    ${plan.slot}`,
      'Publishing this folder again later updates the same game, with no question.',
    ],
  });
}
