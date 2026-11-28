// `xcore plan`'s calls to xgames.fun. A plan is a game's backend tier: Free by default (strict), Creator when its
// owner's account is a Creator account (priced per account for 30 days: every game the owner owns, up to the account's
// game cap, runs on Creator, with the month's included use shared by them), or Scale, which xgames.fun's operator grants.
//   GET  /api/kit/plan                → {ok, slots, used, billing, capCents, monthCents, includedCents, creditCents,
//                                        periodEnd, games, gameSlots?, account?}
//   GET  /api/kit/games/<gameId>/plan → {ok, game, tier, capped, comp, limits, monthCents, includedCents, slots, used,
//                                        account?}
// `account` (an xgames.fun with per-account plans; an older one sends none, and then the slots are said as before):
//   {tier: 'free'|'creator', gameCap, gamesUsed, priceCents, includedCents (per game on Free, shared on Creator),
//    periodEnd, daysLeft (0 in grace), graceUntil (the grace's end, ms; null on Free and for card periods), inGrace,
//    unitPrices: [{line, label, unit, cents}]}
// Moving a game between slots (POST …/plan {"active"}) is gone: xgames.fun answers it 409 `per-account`, and
// `xcore plan activate|deactivate` say so without asking (PER_ACCOUNT).
// The game is the folder's own (its .gamesfun/publish.json for this Studio); the credential is publish's.
import { notPublished, readLinks } from './index.mjs';
import { call, studioOrigin } from './client.mjs';
import { requireCredential } from './oidc.mjs';
import { CMD } from '../command.mjs';
import { sizeText } from '../util.mjs';

async function signedIn(origin, { env, fetchImpl }) {
  return (await requireCredential(origin, { env, fetchImpl })).auth();
}
async function gameId(dir, origin) {
  const known = (await readLinks(dir))[origin];
  if (!known?.projectId) throw notPublished(origin, 'choose its plan', dir);
  return known.projectId;
}
const route = id => `/api/kit/games/${encodeURIComponent(id)}/plan`;

/**
 * What `xcore plan activate|deactivate` say, and what xgames.fun's 409 `per-account` is said as: there are no slots to
 * move any more.
 */
export const PER_ACCOUNT =
  'Plans are per account now: a Creator account runs every game you own (up to 10). Buy or renew it in your console → Plans.';

/** xgames.fun's refusal of a slot move (409 `per-account`) in xcore's words; any other error as it was. */
export function perAccountError(e) {
  if (e?.status === 409 && e.code === 'per-account')
    return Object.assign(new Error(PER_ACCOUNT), { status: 409, code: 'per-account', next: `${CMD} plan --all` });
  return e;
}
const said = e => {
  throw perAccountError(e);
};

/** The account's plan and every game's. */
export async function accountPlan({ origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {}) {
  return call(origin, '/api/kit/plan', { ...(await signedIn(origin, { env, fetchImpl })), fetchImpl }).catch(said);
}

/** The folder's game's plan. */
export async function gamePlan(dir, { origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {}) {
  const id = await gameId(dir, origin);
  return call(origin, route(id), { ...(await signedIn(origin, { env, fetchImpl })), fetchImpl }).catch(said);
}

const TIER_NAMES = { free: 'Free', creator: 'Creator', scale: 'Scale' };
export const tierName = t => TIER_NAMES[t] ?? String(t);
export const dollars = cents => `$${(Math.max(0, Number(cents) || 0) / 100).toFixed(2)}`;
/** A unit price: cents to the cent, or finer when it is a fraction of one ($0.60, $0.015, $0.002). */
export const unitDollars = cents =>
  `$${(Math.max(0, Number(cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
const day = t => new Date(t).toISOString().slice(0, 10);
const days = n => `${n} day${n === 1 ? '' : 's'}`;
const DAY = 86_400_000;
/** The days of grace left: from graceUntil, else the period's end and its 7 days (an xgames.fun that sends no graceUntil). */
export function graceDaysLeft(a, now = Date.now()) {
  const until = Number.isFinite(a?.graceUntil)
    ? a.graceUntil
    : Number.isFinite(a?.periodEnd)
      ? a.periodEnd + 7 * DAY
      : null;
  return until == null ? null : Math.max(0, Math.ceil((until - now) / DAY));
}
/** An account xgames.fun described (per-account plans), else null (an older xgames.fun: slots). */
const accountOf = r => (r?.account && typeof r.account === 'object' && r.account.tier ? r.account : null);

/**
 * What being capped does to a game (../server/contract.mjs "Off"; docs/HOSTING.md "Plans"; docs/SERVER.md "Publishing
 * it"): `xcore plan` says it of a capped game in the words its help uses (tests/plan.test.mjs holds the two together).
 */
export const CAPPED =
  'its server is switched off (every api/ request answers 451), its pages keep loading, and saves and scores slow down';

/** Where a plan is bought, as the account's answer names it. */
function whereToBuy(r) {
  const p = r?.payments;
  // (a game's answer says nothing of payments: then the console is named as it is)
  const told = r && (Object.hasOwn(r, 'payments') || Object.hasOwn(r, 'billing'));
  if (told && !(p?.on || r.billing)) return 'buying a plan is not open on this xgames.fun yet';
  const coins = (p?.currencies ?? ['SOL', 'USDC']).join(' or ');
  return `your console → Plans, in ${coins}${p?.cluster === 'devnet' ? ', devnet test payments' : ''}`;
}

/**
 * The account in a few lines (per-account plans): its tier, its games against the cap, what is included and this
 * month's use, usage credit, and the period. `r`: GET /api/kit/plan's answer (or a game's, whose account carries no
 * month of its own: `pool` is then the account's answer, when it was read).
 */
export function describeAccountHead(a, r = {}, { pool = r, now = Date.now() } = {}) {
  const creator = a.tier === 'creator';
  const price = dollars(a.priceCents ?? 1500);
  const lines = [];
  const atCap = Number.isFinite(a.gameCap) && Number.isFinite(a.gamesUsed) && a.gamesUsed >= a.gameCap;
  let head = `Account: ${tierName(a.tier)}, ${a.gamesUsed ?? '?'} of ${a.gameCap ?? '?'} games`;
  if (creator && a.inGrace) {
    const left = graceDaysLeft(a, now);
    head += `; its period ended${a.periodEnd ? ` ${day(a.periodEnd)}` : ''} and it is in its 7 days' grace${left == null ? '' : ` (${days(left)} left)`}: renew it, or every game drops to Free limits (nothing is taken down)`;
  } else if (creator && a.periodEnd)
    head += `, paid through ${day(a.periodEnd)}${Number.isFinite(a.daysLeft) ? ` (${days(a.daysLeft)} left)` : ''}`;
  lines.push(head);
  const month = pool && pool.monthCents != null ? dollars(pool.monthCents) : null;
  const credit = pool?.creditCents ? `; usage credit ${dollars(pool.creditCents)}` : '';
  const cap = pool?.capCents ? `; spending cap ${dollars(pool.capCents)}` : '';
  if (creator)
    lines.push(
      `  this month: ${month ? `${month} of ` : ''}${dollars(a.includedCents)} included, shared by your games${credit}${cap}`,
    );
  else
    lines.push(
      `  this month: ${month ? `${month} in all; ` : ''}${dollars(a.includedCents ?? 100)} of use included per game${credit}`,
    );
  if (atCap)
    lines.push(
      creator
        ? `  every game the account may have is in use: a new game is refused until you archive one (your console)`
        : `  all ${a.gameCap} games Free allows are in use: a new game is refused until you archive one (your console) or buy a Creator account`,
    );
  lines.push(
    creator
      ? `  renew: ${whereToBuy(pool ?? r)} (${price} per 30 days; it does not renew by itself)`
      : `  Creator: ${price} per 30 days runs every game you own (up to 10) at Creator limits, with $10.00 of use a month shared: ${whereToBuy(pool ?? r)}`,
  );
  return lines;
}

/** The unit prices that usage credit pays past what is included (--verbose). */
export function describeUnitPrices(a) {
  const list = Array.isArray(a?.unitPrices) ? a.unitPrices.filter(p => p && p.label) : [];
  if (!list.length) return ['Unit prices: xgames.fun did not list them (docs/FEES.md has them).'];
  const width = Math.max(...list.map(p => String(p.label).length));
  return [
    'Past what is included, usage credit pays for use at these prices:',
    ...list.map(p => `  ${String(p.label).padEnd(width)}  ${unitDollars(p.cents)} per ${p.unit}`),
  ];
}

/**
 * One game's plan in a few lines of plain words. With per-account plans the account comes first (`pool`: the
 * account's own answer, for this month's shared use; `verbose`: the unit prices too).
 */
export function describeGame(r, { pool = null, verbose = false, now = Date.now() } = {}) {
  const lines = [];
  const a = accountOf(r);
  if (a) lines.push(...describeAccountHead(a, r, { pool, now }), '');
  const name = r.game?.title || r.game?.slug || 'This game';
  lines.push(
    `${name}: ${tierName(r.tier)}${r.comp ? ' (granted by xgames.fun)' : ''}${r.capped ? ', capped for the rest of the month' : ''}`,
  );
  // on a Creator account the included use is the account's, shared: the game's own month is its part of it
  const shared = a && a.tier === 'creator' && r.tier === 'creator' && !r.comp;
  const included = shared
    ? ' (its part of what the account includes)'
    : r.includedCents == null
      ? ''
      : ` of ${dollars(r.includedCents)} included`;
  lines.push(`  this month: ${dollars(r.monthCents)}${included}`);
  const l = r.limits;
  if (l) {
    lines.push(
      `  server: ${l.cpuMs} ms of CPU a request, ${l.rate?.game} requests a minute (${l.rate?.player} from one player)`,
    );
    if (l.saves && l.scores)
      lines.push(
        `  saves: ${sizeText(l.saves.gameBytes)} a game; scores: ${l.scores.boards} boards of ${l.scores.entriesPerBoard} entries`,
      );
  }
  if (r.capped) lines.push(`  capped: ${CAPPED}, until the month ends or it gets more room`);
  if (!a && r.slots !== undefined) lines.push(`  paid slots: ${r.used ?? 0} of ${r.slots} in use`);
  if (a && verbose) lines.push('', ...describeUnitPrices(a));
  return lines.join('\n');
}

/** The account and every game, in a few lines (`verbose`: the unit prices too). */
export function describeAccount(r, { verbose = false, now = Date.now() } = {}) {
  const a = accountOf(r);
  const lines = a ? describeAccountHead(a, r, { now }) : slotLines(r);
  if (a && (r.games ?? []).length) lines.push('Games:');
  for (const g of r.games ?? [])
    lines.push(
      `  ${tierName(g.tier).padEnd(8)}${g.capped ? 'capped ' : ''}${g.title || g.slug}  ${dollars(g.monthCents)}${g.comp ? '  (granted)' : ''}`,
    );
  if (a && verbose) lines.push('', ...describeUnitPrices(a));
  return lines.join('\n');
}

/** The account as an xgames.fun without per-account plans answers it: free and paid slots. */
function slotLines(r) {
  const open = r.payments?.on || r.billing;
  const until = r.periodEnd ? `, paid through ${day(r.periodEnd)}` : '';
  const how = r.payments?.on
    ? ` (buy or renew on xgames.fun: your console → Plans, in ${(r.payments.currencies ?? ['SOL', 'USDC']).join(' or ')}${r.payments.cluster === 'devnet' ? ', devnet test payments' : ''})`
    : open
      ? ''
      : ' (buying slots is not open on this xgames.fun yet)';
  const s = r.gameSlots;
  return [
    ...(s
      ? [
          `Free slots: ${s.free.used} of ${s.free.slots} in use (their games run on Free)${s.open === 0 ? '; a new game needs one: archive a game you no longer need (your console)' : ''}`,
        ]
      : []),
    `${s ? 'Paid slots' : 'Game slots'}: ${r.used ?? 0} of ${r.slots ?? 0} in use${s ? ' (their games run on Creator)' : ''}${until}${how}`,
    `This month: ${dollars(r.monthCents)}${r.includedCents == null ? '' : ` of ${dollars(r.includedCents)} included`}${r.creditCents ? `; usage credit ${dollars(r.creditCents)}` : ''}${r.capCents ? `; spending cap ${dollars(r.capCents)}` : ''}`,
  ];
}
