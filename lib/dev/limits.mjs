// What `xcore dev` says about games.fun's plan limits (README §5, `xcore plan`). The local server runs with no CPU or
// request limits, so a page that polls its server ten times a second works here and is refused once published. This
// counts the page's requests to its server and times each one, and says so in the dev log, once a minute at most for
// the rate and once per route for the time. It never refuses anything itself.
//
// The numbers are games.fun's plans; games.fun is the source and can change them.
export const PLAN_LIMITS = Object.freeze({
  free: Object.freeze({ name: 'Free', perPlayer: 120, cpuMs: 50 }),
  creator: Object.freeze({ name: 'Creator', perPlayer: 600, cpuMs: 200 }),
});
const MINUTE = 60_000;

/**
 * A watch over one dev session's server requests. `log(line)` takes what it has to say.
 * → {request(method, pathname) → done(), upgrade(pathname)}: request() before the server is called, done() when it
 *   has answered (its headers).
 */
export function createLimitWatch({ log, now = () => Date.now() }) {
  const { free, creator } = PLAN_LIMITS;
  let start = now();
  let count = 0;
  let said = 0; // the highest plan already named this minute: 0 none, 1 Free, 2 Creator
  const slow = new Set();

  function count1(what) {
    const t = now();
    if (t - start >= MINUTE) {
      start = t;
      count = 0;
      said = 0;
    }
    count++;
    if (count > creator.perPlayer && said < 2) {
      said = 2;
      log(
        `limits: ${count} requests to the game's server within a minute (the last: ${what}). Published, one player's ` +
          `requests past ${creator.perPlayer} a minute are refused even on Creator (${free.perPlayer} on Free): its ` +
          `server answers 429 with retry-after 60. Send frequent updates (positions, state) over a WebSocket ` +
          `(docs/SERVER.md, "A room over a WebSocket"); a socket is one request for its whole life.`,
      );
    } else if (count > free.perPlayer && said < 1) {
      said = 1;
      log(
        `limits: ${count} requests to the game's server within a minute (the last: ${what}). Published on ` +
          `${free.name}, one player's requests past ${free.perPlayer} a minute are refused (429, retry-after 60); ` +
          `${creator.name} allows ${creator.perPlayer}. Poll less often, or send frequent updates over a WebSocket ` +
          `(docs/SERVER.md). Two tabs here count as one player.`,
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
        if (ms <= free.cpuMs || slow.has(what)) return;
        slow.add(what);
        log(
          `limits: ${what} took ${ms} ms here. Published, a request gets ${free.cpuMs} ms of CPU on ${free.name} ` +
            `(${creator.cpuMs} on ${creator.name}). Waiting on storage or fetch does not count, but if this is ` +
            `computing, it can pass a few times live and then answer 503 ("went over its limit"). Do less a ` +
            `request, or split the work.`,
        );
      };
    },
    upgrade(pathname) {
      count1(`WebSocket ${pathname}`);
    },
  };
}
