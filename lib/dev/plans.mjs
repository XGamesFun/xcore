// The numbers xgames.fun's platform holds a published game to, as `xcore dev` imitates them: one table, so a change
// on xgames.fun is one edit here. The source is xgames.fun's own plan table, the one its platform enforces (README
// "Plans and limits"; `xcore plan` shows a published game's own numbers). PLANS changes with the game's plan; RULES
// are the same on every plan. `xcore dev --plan <name>` picks the plan the dev host imitates (Free by default).
const deepFreeze = o => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
};
const KB = 1024,
  MB = 1024 * KB,
  GB = 1024 * MB;

export const PLANS = deepFreeze({
  free: {
    name: 'Free',
    cpuMs: 50,
    rate: { player: 120 },
    saves: { valueBytes: 64 * KB, keysPerPlayer: 16, gameBytes: 10 * MB, writesPerMinute: 600 },
    scores: { boards: 8, rules: 16, entriesPerBoard: 10_000, submitsPerMinute: 600 },
    reads: { perMinute: 1_200 },
    files: { bytes: 100 * MB, fileBytes: 25 * MB, opsPerMinute: 120 },
  },
  creator: {
    name: 'Creator',
    cpuMs: 200,
    rate: { player: 600 },
    saves: { valueBytes: 64 * KB, keysPerPlayer: 16, gameBytes: GB, writesPerMinute: 12_000 },
    scores: { boards: 16, rules: 32, entriesPerBoard: 1_000_000, submitsPerMinute: 6_000 },
    reads: { perMinute: 12_000 },
    files: { bytes: 10 * GB, fileBytes: 25 * MB, opsPerMinute: 1_200 },
  },
  scale: {
    name: 'Scale',
    cpuMs: 1_000,
    rate: { player: 1_200 },
    saves: { valueBytes: 64 * KB, keysPerPlayer: 16, gameBytes: 10 * GB, writesPerMinute: 60_000 },
    scores: { boards: 16, rules: 32, entriesPerBoard: 1_000_000, submitsPerMinute: 30_000 },
    reads: { perMinute: 60_000 },
    files: { bytes: 100 * GB, fileBytes: 25 * MB, opsPerMinute: 6_000 },
  },
});
export const PLAN_NAMES = Object.freeze(Object.keys(PLANS));
export const DEFAULT_PLAN = 'free';

export const RULES = deepFreeze({
  saves: {
    playerChars: 128,
    // a page's writes may keep at most 1/128 of the game's save bytes for one player (never less than one save)
    playerShareDivisor: 128,
    // with the game's saves full, a player whose saves stay within 4 KB still writes, up to an eighth past the total
    floorBytes: 4 * KB,
    floorPoolDivisor: 8,
  },
  scores: { nameChars: 32, perPlayerEveryMs: 1_000, topMax: 100, offsetMax: 10_000, rankMax: 10_000 },
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
