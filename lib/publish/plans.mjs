// `xcore plan`'s calls to xgames.fun. A plan is a game's backend tier: Free by default (strict), or
// Creator when its owner puts it in one of their paid game slots (priced per game slot a month; a slot moves between
// games at any time without changing the bill), or Scale, which xgames.fun's operator grants.
// Every game sits in a slot: 2 free ones for everyone (their games on Free), any more are paid (their games on Creator).
//   GET  /api/kit/plan                                  → {ok, slots, used, billing, capCents, monthCents, includedCents, games,
//                                                          gameSlots?: {free: {slots, used}, paid: {slots, used}, granted, open}}
//                                                          (slots/used: the paid slots; gameSlots: from xgames.fun 2026-11-08)
//   GET  /api/kit/games/<gameId>/plan                   → {ok, game, tier, capped, comp, limits, monthCents, includedCents, slots, used}
//   POST /api/kit/games/<gameId>/plan  {"active": bool} → the same, and changed
// The game is the folder's own (its .gamesfun/publish.json for this Studio); the credential is publish's.
import { readLinks } from './index.mjs';
import { call, studioOrigin } from './client.mjs';
import { requireCredential } from './oidc.mjs';
import { CMD, typedPath } from '../command.mjs';
import { shown } from '../games.mjs';

async function signedIn(origin, { env, fetchImpl }) {
  return (await requireCredential(origin, { env, fetchImpl })).auth();
}
async function gameId(dir, origin) {
  const known = (await readLinks(dir))[origin];
  if (!known?.projectId) {
    const where = shown(dir);
    const next = `${CMD} publish${where === '.' ? '' : ` ${typedPath(where)}`}`;
    throw Object.assign(
      new Error(`this folder's game is not on ${origin} yet: publish it first (${next}), then choose its plan`),
      { code: 'not-published', next },
    );
  }
  return known.projectId;
}
const route = id => `/api/kit/games/${encodeURIComponent(id)}/plan`;

/** The account's slots and every game's plan. */
export async function accountPlan({ origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {}) {
  return call(origin, '/api/kit/plan', { ...(await signedIn(origin, { env, fetchImpl })), fetchImpl });
}

/** The folder's game's plan. */
export async function gamePlan(dir, { origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {}) {
  const id = await gameId(dir, origin);
  return call(origin, route(id), { ...(await signedIn(origin, { env, fetchImpl })), fetchImpl });
}

/** Put the folder's game in one of the account's slots (active true) or take it out (false). */
export async function setActive(dir, active, { origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {}) {
  const id = await gameId(dir, origin);
  const auth = await signedIn(origin, { env, fetchImpl });
  return call(origin, route(id), { method: 'POST', body: { active: Boolean(active) }, ...auth, fetchImpl });
}

const TIER_NAMES = { free: 'Free', creator: 'Creator', scale: 'Scale' };
export const tierName = t => TIER_NAMES[t] ?? String(t);
const size = b => (b >= 1073741824 ? `${+(b / 1073741824).toFixed(1)} GB` : `${Math.round(b / 1048576)} MB`);
export const dollars = cents => `$${(Math.max(0, Number(cents) || 0) / 100).toFixed(2)}`;

/** One game's plan in a few lines of plain words. */
export function describeGame(r) {
  const lines = [];
  const name = r.game?.title || r.game?.slug || 'This game';
  lines.push(
    `${name}: ${tierName(r.tier)}${r.comp ? ' (granted by xgames.fun)' : ''}${r.capped ? ', capped for the rest of the month' : ''}`,
  );
  const included = r.includedCents == null ? '' : ` of ${dollars(r.includedCents)} included`;
  lines.push(`  this month: ${dollars(r.monthCents)}${included}`);
  const l = r.limits;
  if (l) {
    lines.push(
      `  server: ${l.cpuMs} ms of CPU a request, ${l.rate?.game} requests a minute (${l.rate?.player} from one player)`,
    );
    if (l.saves && l.scores)
      lines.push(
        `  saves: ${size(l.saves.gameBytes)} a game; scores: ${l.scores.boards} boards of ${l.scores.entriesPerBoard} entries`,
      );
  }
  if (r.capped)
    lines.push(
      '  capped: its server answers slowly (60 requests a minute) until the month ends, or until it gets more room',
    );
  if (r.slots !== undefined) lines.push(`  paid slots: ${r.used ?? 0} of ${r.slots} in use`);
  return lines.join('\n');
}

/** The account in a few lines. */
export function describeAccount(r) {
  const open = r.payments?.on || r.billing;
  const until = r.periodEnd ? `, paid through ${new Date(r.periodEnd).toISOString().slice(0, 10)}` : '';
  const how = r.payments?.on
    ? ` (buy or renew on xgames.fun: your console → Plans, in ${(r.payments.currencies ?? ['SOL', 'USDC']).join(' or ')}${r.payments.cluster === 'devnet' ? ', devnet test payments' : ''})`
    : open
      ? ''
      : ' (buying slots is not open on this xgames.fun yet)';
  const s = r.gameSlots;
  const lines = [
    ...(s
      ? [
          `Free slots: ${s.free.used} of ${s.free.slots} in use (their games run on Free)${s.open === 0 ? '; a new game needs one: archive a game or move one to a paid slot' : ''}`,
        ]
      : []),
    `${s ? 'Paid slots' : 'Game slots'}: ${r.used ?? 0} of ${r.slots ?? 0} in use${s ? ' (their games run on Creator)' : ''}${until}${how}`,
    `This month: ${dollars(r.monthCents)}${r.includedCents == null ? '' : ` of ${dollars(r.includedCents)} included`}${r.creditCents ? `; usage credit ${dollars(r.creditCents)}` : ''}${r.capCents ? `; spending cap ${dollars(r.capCents)}` : ''}`,
  ];
  for (const g of r.games ?? [])
    lines.push(
      `  ${tierName(g.tier).padEnd(8)}${g.capped ? 'capped ' : ''}${g.title || g.slug}  ${dollars(g.monthCents)}${g.comp ? '  (granted)' : ''}`,
    );
  return lines.join('\n');
}
