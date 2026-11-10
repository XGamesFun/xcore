// What `xcore dev` says about xgames.fun's limits that depend on the network, not on the game's store: one player's
// requests to the game's server a minute and the CPU each may take (by plan), and one address's reads of the page's
// /platform/v1 at the play edge. The local server runs with no CPU or request limits, and here every tab is the same
// address, so these are said in the dev log, never refused: once a minute at most for a rate, once per route for the
// time. The platform's own limits (saves, scores, reads and writes a minute) are refused as published: ./platform.mjs.
//
// The numbers are ./plans.mjs's, one table with the rest.
import { PLANS, PLAN_NAMES, RULES, devPlan } from './plans.mjs';

/** The plans' request numbers, as this watch reads them (kept for callers of an earlier version). */
export const PLAN_LIMITS = Object.freeze(
  Object.fromEntries(
    PLAN_NAMES.map(k => [
      k,
      Object.freeze({ name: PLANS[k].name, perPlayer: PLANS[k].rate.player, cpuMs: PLANS[k].cpuMs }),
    ]),
  ),
);
const MINUTE = 60_000;

/**
 * A watch over one dev session's server requests. `log(line)` takes what it has to say; `plan`: the plan imitated.
 * → {request(method, pathname) → done(), upgrade(pathname), platformRead(what)}: request() before the server is
 *   called, done() when it has answered (its headers).
 */
export function createLimitWatch({ log, now = () => Date.now(), plan = 'free' }) {
  const key = typeof plan === 'object' && plan?.key ? plan.key : devPlan(plan).key;
  const here = PLAN_LIMITS[key];
  const up = PLAN_LIMITS[PLAN_NAMES[PLAN_NAMES.indexOf(key) + 1]] ?? null;
  let start = now();
  let count = 0;
  let said = 0; // what is already said this minute: 0 nothing, 1 past this plan's, 2 past the next plan's too
  const slow = new Set();
  let readStart = now(),
    reads = 0,
    readSaid = false;

  function count1(what) {
    const t = now();
    if (t - start >= MINUTE) {
      start = t;
      count = 0;
      said = 0;
    }
    count++;
    if (up && count > up.perPlayer && said < 2) {
      said = 2;
      log(
        `limits: ${count} requests to the game's server within a minute (the last: ${what}). Published, one player's ` +
          `requests past ${up.perPlayer} a minute are refused even on ${up.name} (${here.perPlayer} on ${here.name}): its ` +
          `server answers 429 with retry-after 60. Send frequent updates (positions, state) over a WebSocket ` +
          `(docs/SERVER.md, "A room over a WebSocket"); a socket is one request for its whole life.`,
      );
    } else if (count > here.perPlayer && said < 1) {
      said = 1;
      log(
        `limits: ${count} requests to the game's server within a minute (the last: ${what}). Published on ` +
          `${here.name}, one player's requests past ${here.perPlayer} a minute are refused (429, retry-after 60)` +
          `${up ? `; ${up.name} allows ${up.perPlayer}` : ''}. Poll less often, or send frequent updates over a ` +
          `WebSocket (docs/SERVER.md). Two tabs here count as one player.`,
      );
    }
  }

  return {
    request(method, pathname) {
      const what = `${method} ${pathname}`;
      count1(what);
      const t0 = now();
      return () => {
        const ms = now() - t0;
        if (ms <= here.cpuMs || slow.has(what)) return;
        slow.add(what);
        log(
          `limits: ${what} took ${ms} ms here. Published, a request gets ${here.cpuMs} ms of CPU on ${here.name}` +
            `${up ? ` (${up.cpuMs} on ${up.name})` : ''}. Waiting on storage or fetch does not count, but if this is ` +
            `computing, it can pass a few times live and then answer 503 ("went over its limit"). Do less a ` +
            `request, or split the work.`,
        );
      };
    },
    upgrade(pathname) {
      count1(`WebSocket ${pathname}`);
    },
    /** A read of /platform/v1 that the play edge would count against the address it came from. */
    platformRead(what) {
      const t = now(),
        max = RULES.edge.platformReadsPerCallerMinute;
      if (t - readStart >= MINUTE) {
        readStart = t;
        reads = 0;
        readSaid = false;
      }
      if (++reads <= max || readSaid) return;
      readSaid = true;
      log(
        `limits: ${reads} reads of /platform/v1 within a minute (the last: ${what}). Published, the play edge ` +
          `refuses one address's reads past ${max} a minute (429 'rate'), on every plan; a board read with no ` +
          `token may come from its 5 s cache and is not counted. Here every tab shares one address, so this is only ` +
          `said: read less often (a board after a score, not on a timer).`,
      );
    },
  };
}
