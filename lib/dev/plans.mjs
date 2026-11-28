// The numbers xgames.fun's platform holds a published game to, as `xcore dev` imitates them. A plan's saves, scores,
// reads, files, database size and CPU are the contract's (../server/contract.mjs PLAN_LIMITS and PLATFORM_LIMITS: a change on
// xgames.fun is one edit there); this file adds what only the dev host uses. The source of both is xgames.fun's own
// plan table, the one its platform enforces (docs/HOSTING.md "Plans"; `xcore plan` shows a published game's own
// numbers). PLANS changes with the game's plan; RULES are the same on every plan. `xcore dev --plan <name>` picks the
// plan the dev host imitates (Free by default).
import { PLAN_LIMITS, PLATFORM_LIMITS } from '../server/contract.mjs';

const deepFreeze = o => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
};
const KB = 1024,
  MB = 1024 * KB,
  GB = 1024 * MB;

/** Beside the contract's numbers for a plan: its name, one player's requests to the game's server a minute, and the
 *  game's file calls a minute. */
const BESIDE = {
  free: { name: 'Free', playerRequests: 120, fileOps: 120 },
  creator: { name: 'Creator', playerRequests: 600, fileOps: 1_200 },
  scale: { name: 'Scale', playerRequests: 1_200, fileOps: 6_000 },
};

export const PLANS = deepFreeze(
  Object.fromEntries(
    Object.entries(PLAN_LIMITS).map(([key, limits]) => {
      const { name, playerRequests, fileOps } = BESIDE[key];
      return [
        key,
        { name, ...limits, rate: { player: playerRequests }, files: { ...limits.files, opsPerMinute: fileOps } },
      ];
    }),
  ),
);
export const PLAN_NAMES = Object.freeze(Object.keys(PLANS));
export const DEFAULT_PLAN = 'free';

export const RULES = deepFreeze({
  saves: {
    playerChars: PLATFORM_LIMITS.saves.playerChars,
    // a page's writes may keep at most 1/128 of the game's save bytes for one player (never less than one save)
    playerShareDivisor: 128,
    // with the game's saves full, a player whose saves stay within 4 KB still writes, up to an eighth past the total
    floorBytes: 4 * KB,
    floorPoolDivisor: 8,
  },
  scores: {
    nameChars: PLATFORM_LIMITS.scores.nameChars,
    perPlayerEveryMs: PLATFORM_LIMITS.scores.perPlayerEveryMs,
    topMax: PLATFORM_LIMITS.scores.topMax,
    offsetMax: 10_000,
    rankMax: 10_000,
  },
  // the page's own calls (/platform/v1/*): the same on every plan
  page: {
    bodyBytes: 96 * KB,
    saveWritesPerPlayerMinute: 60,
    scoreSubmitsPerPlayerMinute: 30,
    // once pages have spent the game's minute, a player with at most this many this minute still writes
    saveWritesFloorPerPlayerMinute: 6,
    scoreSubmitsFloorPerPlayerMinute: 3,
    // boards a page makes: "high" only, two a player, and half the plan's boards for all pages together
    boardsPerPlayer: 2,
    boardsDivisor: 2,
    // a board read with no good player token: the top 100 only, an identical read within 5 s from a cache, and a
    // minute of its own, a tenth of the plan's reads
    anonTopDepth: 100,
    anonReadsDivisor: 10,
    anonReadCacheMs: 5_000,
  },
  // the play edge's own limit on reads of /platform/v1 from one address (xcore dev only says it: see limits.mjs)
  edge: { platformReadsPerCallerMinute: 120 },
  // what GF.files.put holds in memory: a string or ArrayBuffer body, or a stream with no declared length
  files: { unsizedBytes: MB },
});

/** The plan `xcore dev` imitates: 'free', 'creator' or 'scale' (any case). → {key, ...PLANS[key]}; throws on another. */
export function devPlan(name = DEFAULT_PLAN) {
  const key = String(name ?? DEFAULT_PLAN)
    .trim()
    .toLowerCase();
  if (!Object.hasOwn(PLANS, key)) throw new Error(`there is no plan "${name}": ${PLAN_NAMES.join(', ')}`);
  return { key, ...PLANS[key] };
}

const count = n => n.toLocaleString('en-US');
/** A size in words: 10 MB, 1 GB, 80 KB. */
export const size = b =>
  b >= GB ? `${count(b / GB)} GB` : b >= MB ? `${count(b / MB)} MB` : `${count(Math.round(b / KB))} KB`;
export { count };

/** The dev host's first line about the plan it imitates. */
export function planLine(plan) {
  const others = PLAN_NAMES.filter(k => k !== plan.key).join('|');
  return (
    `platform: imitating the ${plan.name} plan (--plan ${others} for another): ${plan.scores.boards} boards, ` +
    `${size(plan.saves.gameBytes)} of saves, ${count(plan.reads.perMinute)} reads and ` +
    `${count(plan.saves.writesPerMinute)} saves a minute, ${size(plan.files.bytes)} of files`
  );
}
