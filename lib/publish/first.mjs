// The first publish of a folder makes a new game under the account this computer is signed in to, and counts toward
// that account's games (2 on Free, up to 10 on a Creator account; an xgames.fun before per-account plans: one of its
// game slots). So it is confirmed first: the account, the game's name and where it goes are printed, and it goes on
// when the person types "publish" at a terminal, or runs it again with --yes <code> (lib/consent.mjs, the pattern every
// change that can't be undone uses). An account with no room for another game is told so before anything is uploaded.
// Publishing a folder already linked to a game is not asked about. A GitHub Actions job (its OIDC token) publishes
// only the game its repository was linked to in Studio, so it is not asked either.
import path from 'node:path';
import { changeCode, consented } from '../consent.mjs';
import { CMD } from '../command.mjs';
import { call } from './client.mjs';
import { readLinks } from './index.mjs';
import { requireCredential } from './oidc.mjs';
import { kitRecords } from './tree.mjs';

/**
 * The slot a new game takes, in words, from GET /api/kit/plan's gameSlots (an xgames.fun before per-account plans; null:
 * it did not say).
 */
export function slotWords(plan) {
  const free = plan?.gameSlots?.free;
  if (!free || !Number.isFinite(free.slots) || !Number.isFinite(free.used)) return null;
  if (free.used >= free.slots)
    return `none: all ${free.slots} free slots are in use, so xgames.fun will refuse a new game until one is open`;
  return `one of your ${free.slots} free slots (${free.used} in use now, ${free.used + 1} after this)`;
}

/**
 * A Creator account at its cap, in words: said before a first publish (newGameWords), and for xgames.fun's own 409
 * `game-cap` (commands/publish.mjs). `then`: what did not happen.
 */
export const creatorCapWords = (cap, { origin = 'xgames.fun', then = 'Nothing was uploaded.' } = {}) =>
  `Your Creator account has all ${cap} of its games, so xgames.fun would refuse a new one. Archive a game you no longer need on ${origin}/console (unpublish it first), then publish again, or write to xgames.fun for more. ${then}`;

/**
 * Where a new game goes, from GET /api/kit/plan: → {label, words, full} (`full`: the refusal to say before anything
 * is uploaded, when the account has no room), or null when xgames.fun did not say. A Free account keeps the slot's
 * words; a Creator account counts its games against its cap; an xgames.fun without `account` is said as before.
 */
export function newGameWords(plan, { origin = 'xgames.fun' } = {}) {
  const a = plan?.account;
  const used = a?.gamesUsed,
    cap = a?.gameCap;
  if (!a?.tier || !Number.isFinite(used) || !Number.isFinite(cap)) {
    const words = slotWords(plan);
    return words ? { label: 'slot', words, full: null } : null;
  }
  const desk = `${origin}/console`;
  if (a.tier === 'creator') {
    if (used >= cap)
      return {
        label: 'plan',
        words: `none: your Creator account has all ${cap} of its games`,
        full: creatorCapWords(cap, { origin }),
      };
    return {
      label: 'plan',
      words: `your Creator account (${used} of ${cap} games now, ${used + 1} after this)`,
      full: null,
    };
  }
  if (used >= cap)
    return {
      label: 'slot',
      words: `none: all ${cap} free slots are in use`,
      full: `Your Free account has all ${cap} of its games, so xgames.fun would refuse a new one. Archive a game you no longer need on ${desk} (unpublish it first), or buy a Creator account there (your console → Plans: every game you own, up to 10, at Creator limits, for $15 per 30 days). Nothing was uploaded.`,
    };
  return {
    label: 'slot',
    words: `one of your ${cap} free slots (${used} in use now, ${used + 1} after this)`,
    full: null,
  };
}

/**
 * What the first publish of `dir` would create, or null when it creates nothing new: the folder is linked to a game on
 * `origin`, or the credential is a CI job's. Anything else that keeps it from being said (not signed in, xgames.fun
 * not answering who the account is) refuses here, in words, with nothing published: the printout comes first or
 * nothing does.
 * → {plan: {studio, account, game, folder, slot, tier?}, code, full} (`slot`: where it goes, in words, whatever the
 * account; `tier`: the account's, when xgames.fun said; `full`: an Error to stop with before anything is uploaded, or
 * null)
 */
export async function firstPublish(dir, { origin, newGame = false, title = null, env, fetchImpl = fetch }) {
  const known = newGame ? null : ((await readLinks(dir))[origin] ?? null);
  if (known?.projectId) return null;
  const cred = await requireCredential(origin, { env, fetchImpl });
  if (cred.kind !== 'login') return null;
  const auth = await cred.auth();
  const me = await call(origin, '/api/kit/me', { ...auth, fetchImpl }).catch(e => {
    if (e.status === 401) throw Object.assign(new Error(e.message), { code: 'login', next: `${CMD} login` });
    throw Object.assign(
      new Error(
        `Nothing was published: this folder's first publish makes a new game, and xgames.fun did not say which account this computer is signed in to (${e.message.replace(/\.$/, '')}). Run the same command again in a minute; it prints the account and the game before anything is made.`,
      ),
      { code: e.code === 'unreachable' ? 'unreachable' : 'account', status: e.status },
    );
  });
  const plan = await call(origin, '/api/kit/plan', { ...auth, fetchImpl }).catch(() => null);
  const folder = path.basename(path.resolve(dir));
  // the name publish sends (./tree.mjs kitRecords), so the game confirmed is the game made
  const game = title ?? (await kitRecords(dir)).title ?? folder;
  const account = me.email ?? cred.label ?? 'this sign-in';
  const where = newGameWords(plan, { origin });
  return {
    plan: {
      studio: origin,
      account,
      game,
      folder,
      slot: where?.words ?? 'one of your free slots (xgames.fun did not say how many are in use)',
      ...(plan?.account?.tier ? { tier: plan.account.tier } : {}),
    },
    code: changeCode([origin, account, game, folder]),
    full: where?.full ? Object.assign(new Error(where.full), { code: 'game-cap', next: `${CMD} plan --all` }) : null,
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
      `  ${plan.tier === 'creator' ? 'plan:' : 'slot:'}    ${plan.slot}`,
      'Publishing this folder again later updates the same game, with no question.',
    ],
  });
}
