// The trade-offs, for the person: for each route that pays, how its server checks it, what a cheater gets, and what
// the stronger level would cost.
import { payoutLedger } from './ledger.mjs';

/**
 * Each level in plain words: how the server checks, what a cheater gets, and what the stronger level costs. `request`
 * is the level the ledger observes when the check reads only the request, whatever the grant declares.
 */
export const LEVELS = {
  decides: {
    words:
      'the server runs the game itself (a turn, a room, a simulation from a seed it keeps) and the page sends only inputs',
    cheater: 'what a bot that plays well wins, and no more than a player who plays well',
    stronger:
      'there is no stronger level: if a good bot still earns too much, tighten the limits (perPerson with payOnly "x", a perDay total)',
  },
  replays: {
    words: 'the page sends its inputs; the server runs them again and reads the result itself',
    cheater:
      'the best run a script can find: given the whole seed up front it searches offline and sends only that; with randomness revealed as the run goes, what a bot that plays well wins',
    stronger:
      'deciding it: the rules run on the server step by step (a Durable Object a run) and the seed never leaves it; that is the simulation moved to the server, and a request and its CPU for every step of play',
  },
  bounds: {
    words:
      'the page plays and reports the result; the server checks only its own clock, the order of checkpoints and its caps',
    cheater:
      'every claim without playing: a script that waits as long as the game allows and reports the best result is paid, up to the limits',
    stronger:
      'replaying it: a deterministic game step (fixed time step, seeded randomness revealed as the run goes) that the server runs again from the inputs; about 3 ms of CPU a second played, which may need a paid slot (Creator)',
  },
  request: {
    words:
      "the page's request decides it: the check reads nothing the server keeps (no run it started, no clock, no replay)",
    cheater: 'every claim, at once, by a script that sends the request: nothing it sends is checked',
    stronger:
      'bounding it: the server starts each run (an id, its own clock, kept in a Durable Object or a database), takes checkpoints in order and refuses what is faster than the game allows',
  },
};

/**
 * The paid routes, read from the ledger: each with its level (the weaker of declared and observed), what a cheater gets
 * up to its ceiling, and what the stronger level costs. Without `ledger`, one is made from the spec and `facts`.
 */
export function tradeoffs(spec, { economy = null, facts = {}, ledger = null } = {}) {
  const records =
    ledger ??
    payoutLedger(spec, {
      sites: facts.vouchers
        ? [
            {
              signer: 'server',
              where: 'server/vouchers.js',
              payOnly: facts.payOnly ?? null,
              source: facts.pay === 'template' ? 'template' : 'unreadable',
              decides: null,
              amount: null,
              recipient: 'proven',
            },
          ]
        : [],
      economyRoutes: economy?.routes ?? [],
    });
  return records
    .filter(r => r.grant)
    .map(r => {
      const own = economy?.routes?.find(x => x.key === r.grant && (!x.kind || /grant/i.test(x.kind)));
      const observedWeaker = r.trust.observed === 'request';
      const level = LEVELS[observedWeaker ? 'request' : r.trust.level] ?? null;
      return {
        route: r.route,
        name: r.name,
        trust: r.trust.level,
        observed: r.trust.observed,
        declared: r.trust.declared !== null,
        how:
          level?.words ??
          'not declared: read PAY.check in server/vouchers.js and say which of decides, replays or bounds it does',
        cheater: `${level ? level.cheater : `it rests on what PAY.check checks: if it only bounds the result, ${LEVELS.bounds.cheater}; if it decides it, ${LEVELS.decides.cheater}`}; the most one person takes is ${r.ceiling.words}`,
        bounded: r.ceiling.bounded,
        // the economy review's own ceiling: what the chain lets one route pay, and what it feeds
        ceiling: own?.ceiling ? String(own.ceiling) : null,
        stronger: level?.stronger ?? null,
      };
    });
}
