// For the game's owner: the questions to decide, and the facts to know as written (the economy check's own sentences, one per paid
// route, one per key out of place, and what stops when the plan caps the server).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { solanaCommand, solanaHas } from '../economy.mjs';
import { economyCluster } from '../solana-rpc.mjs';
import { plural, readJson } from '../util.mjs';
import { around, braced, classAt, codeOnly } from './code.mjs';
import { reviewEnv } from './economy.mjs';
import { KEEPER_RATE, SIGNING } from './ledger.mjs';
import { signsWords } from './custody.mjs';
import { LEVELS } from './tradeoffs.mjs';

// Agents paraphrase findings, lose options, or keep them in private notes; ready sentences reach the owner. So the
// review opens review.md with two short lists, each line with where it comes from:
//   ask   questions whose answers change the design ("? "): decided before building on the answers
//   tell  final sentences, said as they are ("> ")
// from: economy   @xgamesfun/solana's check, in its own words (`xsolana check --json`: its "Ask the person" and
//                 "Tell the person, as written" lines; its review carries neither). Those two markers are
//                 @xgamesfun/solana's own text, read here and in ../design-code/drafts.mjs; review.md shows the lines
//                 under its own headings (./record.mjs ASK_HEADING and TELL_HEADING).
//       server    the payout ledger: per paid route, what decides it, its ceiling, what a cheater gets, and where the
//                 server holds a limit the chain can't, what the chain still allows if the server's key leaks
//       custody   one line per key in a place beyond its one holder
//       plan      what stops when the game's plan caps its server (every api/* answers 451, rooms stop, until the
//                 month ends), read from the server's code

/** The economy check's own ask and tell lines: `xsolana check <file> --json`. → {ask: [text], tell: [text], why} */
export function economyTold(file, { env = process.env } = {}) {
  const none = why => ({ ask: [], tell: [], why });
  const xsolana = solanaCommand(env);
  if (!xsolana) return none('the economy tools (@xgamesfun/solana) are not installed here');
  if (!solanaHas('check', env)) return none('the installed @xgamesfun/solana has no check');
  const r = spawnSync(xsolana[0], [xsolana[1], 'check', path.basename(file), '--json'], {
    cwd: path.dirname(file),
    encoding: 'utf8',
    timeout: 60_000,
    env: reviewEnv(env, economyCluster(path.dirname(file))),
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {}
  if (!json || typeof json.text !== 'string')
    return none(`xsolana check gave no JSON (${`${r.stderr ?? ''}`.trim().split('\n')[0] || `exit code ${r.status}`})`);
  const block = (head, mark) => {
    const lines = json.text.split('\n');
    const at = lines.findIndex(l => head.test(l));
    if (at < 0) return [];
    const out = [];
    for (const l of lines.slice(at + 1)) {
      if (!l.startsWith(mark)) break;
      out.push(l.slice(mark.length).trim());
    }
    return out;
  };
  // (its warnings carry each question too: the ones its text leaves out are kept)
  const asked = (Array.isArray(json.warnings) ? json.warnings : []).map(w => w?.ask).filter(a => typeof a === 'string');
  return {
    ask: [...new Set([...block(/^Ask the person\b/, '? '), ...asked.map(a => a.trim())])].filter(Boolean),
    tell: [...new Set(block(/^Tell the person\b/, '> '))].filter(Boolean),
    why: null,
  };
}

/** What a timer is for, read off its class and its body (the first of these words): what it sends, and its name. */
const TIMED = [
  ['draw', 'the draw', 'the draw timer'],
  ['reveal', 'the reveal', 'the reveal timer'],
  ['settle', 'the settling', 'the settling timer'],
  ['payout', 'the payouts', 'the payout timer'],
  ['refund', 'the refunds', 'the refund timer'],
  ['report', 'the results it reports', 'the report timer'],
  ['close', 'the close', 'the closing timer'],
  ['season', "the season's turn", 'the season timer'],
  ['round', 'the next round', 'the round timer'],
  ['reset', 'the reset', 'the reset timer'],
  ['expire', 'the expiry', 'the expiry timer'],
];
/** Work on a clock that pays, signs or sends something: it matters when it doesn't run. */
const CRITICAL = new RegExp(
  [...SIGNING.map(([, call]) => call.source), '(?<![\\w$.])fetch\\s*\\(', '\\bsendTransaction\\b'].join('|'),
);
/** → {what, timer} for the first word of TIMED in `texts`, or {what: null, timer: null}. */
const timedWords = (...texts) => {
  const t = texts.join(' ').toLowerCase();
  const hit = TIMED.find(([w]) => t.includes(w));
  return { what: hit?.[1] ?? null, timer: hit?.[2] ?? null };
};
const ADMIN = /(?:^|\/)(?:admin|owner|operator|ops|manage|moderate|mod)(?:\/|$)/;

/**
 * What the game's server does that stops with it: its api/ routes, its timers (a Durable Object's alarm), its
 * scheduled work (a cron handler), its rooms, the claims it signs and the results it reports to the keeper. `read`:
 * [{f, code}] (comments out); `sites`: signingSites'; `routes`: the api/ routes server/ names.
 * → {routes, admin, alarms: [{where, owner, what, timer, critical}], scheduled: [{where, what, timer, critical}], rooms,
 *    claims, keeper}
 */
export function serverWork(read, { sites = [], routes = [] } = {}) {
  const alarms = [];
  const scheduled = [];
  const rooms = [];
  for (const { f, code } of read) {
    const bare = codeOnly(code);
    const where = `server/${f}`;
    const owners = new Map(); // class (or the file) → {at, body}
    for (const m of bare.matchAll(/(?:^|[\s;{}])(?:async\s+)?alarm\s*\([^()]*\)\s*\{/g)) {
      const owner = classAt(bare, m.index) ?? where;
      owners.set(owner, { body: braced(bare, m.index + m[0].length - 1) ?? '' });
    }
    for (const m of bare.matchAll(/\bsetAlarm\s*\(/g)) {
      const owner = classAt(bare, m.index) ?? where;
      if (!owners.has(owner)) owners.set(owner, { body: around(bare, m.index)?.body ?? bare });
    }
    for (const [owner, { body }] of owners) {
      const named = timedWords(owner === where ? '' : owner, body);
      alarms.push({
        where,
        owner: owner === where ? null : owner,
        ...named,
        critical: Boolean(named.what) || CRITICAL.test(body),
      });
    }
    for (const m of bare.matchAll(
      /(?:^|[\s;{},])(?:export\s+)?(?:async\s+)?(?:function\s+)?scheduled\s*(?::\s*(?:async\s*)?(?:function\s*)?)?\([^()]*\)\s*(?:=>\s*)?\{/g,
    )) {
      const body = braced(bare, m.index + m[0].length - 1) ?? '';
      const named = timedWords(body);
      scheduled.push({ where, ...named, critical: Boolean(named.what) || CRITICAL.test(body) });
    }
    if (f === 'rooms.js' || /\bWebSocketPair\b|\bacceptWebSocket\s*\(/.test(bare)) rooms.push(where);
  }
  return {
    routes,
    admin: routes.filter(r => ADMIN.test(r.replace(/^api\//, ''))),
    alarms,
    scheduled,
    rooms,
    claims: sites.some(s => s.signer === 'server' || s.signer === 'other'),
    keeper: sites.some(s => s.signer === 'keeper'),
  };
}

const TIERS = { free: 'Free', creator: 'Creator', scale: 'Scale' };
/** The game's plan as its folder says it (gamesfun.json → plan), or null: the live plan is `xcore plan`'s to say. */
export function folderPlan(dir) {
  const p = readJson(path.join(dir, 'gamesfun.json'))?.plan;
  const name = typeof p === 'string' ? p : typeof p?.tier === 'string' ? p.tier : null;
  return name ? (TIERS[name.toLowerCase()] ?? name) : null;
}

const listWords = items =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
/**
 * What stops when the plan caps the game's server: one line to tell, and a question for each timer that matters.
 * → {tell: text | null, ask: [text]}
 */
export function planCap(work, { plan = null } = {}) {
  const stops = [];
  if (work.claims) stops.push('claims (voucher signing)');
  if (work.keeper) stops.push("results reported to xgames.fun's keeper");
  for (const a of work.alarms)
    stops.push(`${a.timer ?? 'a timer'} (${a.owner ? `${a.owner}'s alarm` : 'an alarm'}, ${a.where})`);
  for (const s of work.scheduled) stops.push(`${s.timer ?? 'its scheduled work'} (a cron handler, ${s.where})`);
  if (work.rooms.length) stops.push('rooms');
  const own = work.routes.filter(r => !/^api\/(vouchers|rooms)(\/|$)/.test(r));
  if (own.length)
    stops.push(
      `${own.length === 1 ? 'its route' : 'its routes'} ${own.length > 4 ? `${own.slice(0, 3).join(', ')} and ${own.length - 3} more` : listWords(own)}`,
    );
  if (!stops.length) return { tell: null, ask: [] };
  const tell = `If ${plan ? `the game's plan (${plan}) reaches its cap` : "the game's plan cap is reached"}, its server stops until the month ends: ${listWords(stops)} stop with it (every api/ request answers 451); pages keep loading, and saves and scores slow down.`;
  const ask = [
    ...work.alarms
      .filter(a => a.critical)
      .map(
        a =>
          `Who sends ${a.what ?? 'what it does'} (${a.owner ? `${a.owner}'s alarm` : 'the alarm'} in ${a.where}) if the server is off, and do players wait or lose anything until it comes back?`,
      ),
    ...work.scheduled
      .filter(s => s.critical)
      .map(
        s =>
          `Who sends ${s.what ?? 'its scheduled work'} (the cron handler in ${s.where}) if the server is off, and do players wait or lose anything until it comes back?`,
      ),
  ];
  return { tell, ask };
}

/** The level a paid route's check is at, in words: how the server checks it. */
const HOW = {
  decides: 'the server decides the result (it runs the game itself; the page sends only inputs)',
  replays: "the server replays the result (it runs the page's inputs again)",
  bounds:
    'the server only bounds the result (the page plays and reports; the server checks its own clock, the order of checkpoints and its caps)',
};
/** A ceiling in plain words: what one person can take. */
function ceilingPlain(c) {
  const time = c.time.length ? c.time.join(' and ') : null;
  if (c.by === 'person')
    return `at most ${c.per ?? plural(c.perIdentity, 'claim')} for each ${c.unit === 'x' ? 'X account' : 'X or Google account'} they hold${time ? `, and ${time} for all players together` : ''}`;
  if (c.by === 'day' || c.by === 'total')
    return `all of ${time} shared by every player: wallets are free, so one person can take it all`;
  if (c.by === 'keeper')
    return `all the keeper's rate allows (${KEEPER_RATE.hour} reports an hour): wallets are free, so one winner can take it all`;
  return 'no limit: wallets are free, and the grant has no perDay or total';
}
/**
 * What the chain alone allows a grant: what a leaked key could sign. perPerson and perWallet don't bound it (the key
 * names any person and any wallet it likes); perDay, total and the tokens it gives in all (limits.tokens) do.
 */
const chainAllows = limits => {
  const caps = [
    limits.perDay ? `${plural(limits.perDay, 'claim')} a day` : null,
    limits.total ? `${plural(limits.total, 'claim')} in all` : null,
    limits.tokens ? `${limits.tokens} tokens in all (limits.tokens)` : null,
  ].filter(Boolean);
  return caps.length
    ? `up to ${caps.join(' and ')}`
    : 'any number of claims (the grant has no perDay, total or tokens cap)';
};

/** One sentence to tell for a paid route, from its ledger record; and a question when the design waits on one. */
function routeTold(r) {
  const name = `“${r.name}”`;
  if (r.signer === 'none')
    return {
      tell: `${name} can't be claimed yet: nothing in this game signs its vouchers.`,
      ask: `Who signs the vouchers for ${name}: this game's server (its own key), xgames.fun's keeper, or a backend of your own?`,
    };
  if (r.source === 'template' || r.source === 'nothing')
    return {
      tell: `${name} pays nothing yet: the server's check (PAY.check in server/vouchers.js) ${r.source === 'template' ? 'is still the template' : 'answers no grant'}.`,
      ask: `What must a player do before ${name} pays, and what can the server check of it itself (a run it starts and times, a replay, a match it runs)?`,
    };
  const most = `The most one person takes: ${ceilingPlain(r.ceiling)}.`;
  if (r.source === 'request')
    return {
      tell:
        r.decides === 'body'
          ? `${name} is paid on the page's word: the server checks nothing it keeps, so a script that sends the request gets every claim, at once. ${most}`
          : `${name} is a gift to every signed-in player who asks: the server checks nothing of what they did. ${most}`,
    };
  const level = r.trust?.level ?? null;
  const how =
    r.source === 'env'
      ? (HOW[level] ?? "the server checks state it keeps (how much, the grant's trust doesn't say)")
      : 'it rests on code this review did not read';
  const cheater = LEVELS[level]?.cheater ?? 'what the check lets through';
  // where the server keeps records, it holds the limit on each run the chain can't; the chain's caps are what a leaked
  // key could still sign (a voucher names any person and any wallet it likes)
  const held =
    r.source === 'env' && r.signer !== 'keeper'
      ? ` The server holds the limit on each run (a cap that tight on chain would stop real players); if the server's key leaks, the chain still allows ${chainAllows(r.limits)}.`
      : '';
  return { tell: `${name}: ${how}, so a cheater gets ${cheater}. ${most}${held}` };
}

/** Where a key is, in a sentence's words: each place outside its holder. */
const PLACE_WORDS = {
  git: w =>
    `is in the repository's history (${w.replace(/^git history \((.*)\)$/, '$1')}), where everyone with a copy can read it for good`,
  unignored: w =>
    `is in ${w.replace(/, not ignored$/, '')}, which .gitignore doesn't cover, so the next \`git add .\` puts it in the repository`,
  served: w => `is in ${w}, inside the folder the page is served from (any host but xgames.fun would serve it)`,
  page: w => `is in the page's files (${w}), which anyone can read`,
  grant: w => `is named by ${w}, so anyone with a copy of this folder can sign claims for it`,
};
/** One sentence to tell for a key in a place beyond its one holder. */
function custodyTold(k) {
  const off = k.places.filter(p => !p.intended);
  if (!off.length) return null;
  const what = `${k.what[0].toUpperCase()}${k.what.slice(1)}${k.address ? ` (${k.address})` : ''}`;
  const signs = k.signs.length
    ? ` It signs ${signsWords(k)}: until it is replaced, whoever reads it can sign claims for that, up to the grant's limits.`
    : k.signsKnown
      ? ' It signs no grant this economy names.'
      : ' Whoever reads it there holds whatever it is the key to.';
  return `${what} ${off.map(p => PLACE_WORDS[p.kind](p.where)).join('; and it ')}.${signs}`;
}

/**
 * The two lists for the person. → {ask: [{text, from}], tell: [{text, from}]}
 * economy: economyTold's; ledger, custody: the review's; work: serverWork's; plan: folderPlan's.
 */
export function toldLines({ economy = null, ledger = [], custody = [], work = null, plan = null, design = null } = {}) {
  const ask = [];
  const tell = [];
  const put = (list, text, from) => {
    if (text && !list.some(x => x.text === text)) list.push({ text, from });
  };
  for (const t of economy?.ask ?? []) put(ask, t, 'economy');
  for (const t of economy?.tell ?? []) put(tell, t, 'economy');
  for (const r of ledger.filter(x => x.grant)) {
    const t = routeTold(r);
    put(tell, t.tell, 'server');
    put(ask, t.ask, 'server');
  }
  for (const r of ledger.filter(x => !x.grant))
    put(
      tell,
      `${r.where} signs vouchers, but no grant names a voucher key: nothing it signs can be claimed.`,
      'server',
    );
  if (work?.admin.length)
    put(
      ask,
      `Who runs the server's operator steps (${listWords(work.admin)}), and are they around for as long as the game runs?`,
      'server',
    );
  for (const t of design?.tell ?? []) put(tell, t, 'design');
  for (const t of design?.ask ?? []) put(ask, t, 'design');
  for (const k of custody) put(tell, custodyTold(k), 'custody');
  if (work) {
    const cap = planCap(work, { plan });
    put(tell, cap.tell, 'plan');
    for (const a of cap.ask) put(ask, a, 'plan');
  }
  return { ask, tell };
}
