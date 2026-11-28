// The payout ledger: each route that pays, who signs it, what decides it, who is paid, the identity its limits count,
// its trust and the ceiling one person can take; and its findings.
import { CMD } from '../command.mjs';
import { plural } from '../util.mjs';
import { GUIDE, SEVERITIES, TRUST, voucherGrants } from './where.mjs';
import { braced, codeOnly, payReading, siteReading } from './code.mjs';

// docs/SERVER.md, "What a payout rests on", computed. For every route that pays (each grant a voucher pays, whoever
// signs it), one record of what a cheater can't fake about it: who signs, what decides it (the request, or state the
// server keeps), who is paid, the identity its limits count, the limits, the trust declared and observed, and the
// ceiling (identities one person can make × the limit per identity × time). The findings are read off the record: a
// few codes keyed to what is wrong with the payout, never one per pattern.

/** Who signs a voucher, in words. */
export const SIGNERS = {
  server: "the server's own key (server/vouchers.js, VOUCHER_SEED)",
  other: "a key the game's own code holds (signVoucher)",
  keeper: "xgames.fun's keeper (env.GF.loot.report)",
  none: 'nothing in this game',
};
/**
 * The calls that sign a voucher from the game's own code, outside PAY.check: the keeper's report, a key the code holds
 * itself, and server/vouchers.js's own voucherFor (docs/SERVER.md, "Paying a result"). → [[signer, the call]]
 */
export const SIGNING = [
  ['keeper', /\bloot\s*\??\.\s*report\s*\(/],
  ['other', /(?<![\w$.])signVoucher\s*\(/],
  ['server', /(?<![\w$.])voucherFor\s*\(/],
];
/** Where a payout's decision comes from, in words. */
const SOURCES = {
  template: 'no check yet (PAY.check is the template: nothing is paid)',
  nothing: 'no check that pays (PAY.check answers no grant: nothing is paid)',
  request: 'the request alone',
  unreadable: 'code this review did not read',
};
export const RECIPIENTS = {
  proven: 'a wallet the player proved (signed in with, or linked)',
  check: 'a wallet the server code names',
  request: 'a wallet the request names',
  unread: 'a wallet this review could not trace (see "Not read")',
};
export const AMOUNTS = { grant: "the grant's own", request: "the request's", server: "the server's" };
/** The identity VOUCHERS.payOnly lets be paid: 'any' a wallet (free), 'account' X or Google, 'x' an X account. */
const IDENTITY = { any: 'wallet', account: 'account', x: 'x' };
export const IDENTITY_WORDS = {
  wallet: 'a wallet, which is free',
  account: 'an X or Google account',
  x: 'an X account',
};
const OBSERVED = {
  state: 'reads state the server keeps (decides, replays or bounds: the code alone does not say which)',
  request: 'reads only the request (it can decide, replay or bound nothing)',
  template: 'nothing paid yet (the template)',
  nothing: 'nothing paid yet (the check answers no grant)',
  unreadable: 'not read by this review',
  none: 'nothing here signs',
};
/** The keeper's own rate (docs/SERVER.md, "Paying a result"): reports an hour a game, winners a report. */
export const KEEPER_RATE = { hour: 120, winners: 16 };
const LIMITS = ['perPerson', 'perWallet', 'perDay', 'total', 'tokens'];
/** Whether a grant's limits count people (perPerson, or perPersonEach in each window), not wallets. */
const byPerson = limits => Boolean(limits?.perPerson || limits?.perPersonEach);
/** A limit in each window, in words: "1 claim each 1d". */
const eachWords = e => `${plural(e.count, 'claim')} each ${e.every}`;
const worst = severities => [...severities].sort((a, b) => SEVERITIES.indexOf(a) - SEVERITIES.indexOf(b))[0];

/**
 * What one person can take from a grant: identities × limit per identity × time. `limits`: the grant's (numbers above
 * 0); `identity`: the unit payOnly lets be paid (wallet, account, x). A limit per person binds a person (an X account,
 * or X or Google); with none, the unit that binds is the wallet, and a wallet is free, so only a total shared by every
 * player (perDay, total, the keeper's rate) bounds it, and one person can take all of it.
 * → {bounded, by: 'person'|'day'|'total'|'keeper'|null, unit, perIdentity, identities, time, severity, words}
 */
export function payoutCeiling(limits = {}, identity = 'wallet', { keeper = false } = {}) {
  const {
    perPerson = 0,
    perPersonEach = null,
    perWallet = 0,
    perWalletEach = null,
    perDay = 0,
    total = 0,
    tokens = 0,
  } = limits;
  const time = [
    perDay ? `${plural(perDay, 'claim')} a day` : null,
    total ? `${plural(total, 'claim')} in all` : null,
    // a cap on the tokens it gives, in all (grant.rs `limits.tokens`, in its token's base units): what it pays ever
    tokens ? `${tokens} base units of its token in all (limits.tokens)` : null,
  ].filter(Boolean);
  if (perPerson || perPersonEach) {
    const unit = identity === 'x' ? 'x' : 'account';
    const per = [
      perPerson ? `${plural(perPerson, 'claim')} ${IDENTITY_WORDS[unit]} (perPerson)` : null,
      perPersonEach ? `${eachWords(perPersonEach)} ${IDENTITY_WORDS[unit]} (perPersonEach)` : null,
    ].filter(Boolean);
    return {
      bounded: true,
      by: 'person',
      unit,
      perIdentity: perPerson || null,
      per: perPerson ? plural(perPerson, 'claim') : eachWords(perPersonEach),
      identities: `the ${unit === 'x' ? 'X accounts' : 'X or Google accounts'} one person holds`,
      time,
      severity: null,
      words: `bounded per person: ${per.join(' and ')} × the ${unit === 'x' ? 'X accounts' : 'accounts'} one person holds${time.length ? `; ${time.join(', ')} for every player together` : ''}`,
    };
  }
  const why =
    identity === 'wallet'
      ? 'a wallet is free'
      : `payOnly lets only ${IDENTITY_WORDS[identity]} be paid, but the grant counts no person, so one of them links wallet after wallet, and a wallet is free`;
  const each =
    [
      perWallet ? `${plural(perWallet, 'claim')} a wallet (perWallet)` : null,
      perWalletEach ? `${eachWords(perWalletEach)} a wallet (perWalletEach)` : null,
    ]
      .filter(Boolean)
      .join(' and ') || 'no limit a wallet';
  const base = { unit: 'wallet', perIdentity: perWallet || null, identities: 'unbounded', time };
  if (time.length)
    return {
      ...base,
      bounded: true,
      by: perDay ? 'day' : 'total',
      severity: 'medium',
      words: `bounded only by ${perDay ? `the day's total (${time.join(', ')})` : `the total (${time[0]})`}, which every player shares and one person can take: ${each} × as many wallets as they make (${why})`,
    };
  if (keeper)
    return {
      ...base,
      bounded: true,
      by: 'keeper',
      severity: 'medium',
      words: `bounded only by the keeper's rate (${KEEPER_RATE.hour} reports an hour, ${KEEPER_RATE.winners} winners each), which one person who wins can take: ${each} × as many wallets as they make (${why})`,
    };
  return {
    ...base,
    bounded: false,
    by: null,
    severity: 'high',
    words: `unbounded: ${each} × as many wallets as one person makes (${why}), with no perDay or total`,
  };
}

/**
 * PAY.check, as server/vouchers.js says it (readVouchers): what decides a payout, and what each object it answers
 * with says it pays.
 */
function checkSite(v) {
  if (!v.check) return { source: 'unreadable', decides: null, seen: null, assumed: false, unread: [], answers: [] };
  const r = payReading(v.check);
  return { ...r, source: v.template ? 'template' : r.source };
}

/**
 * A keeper report, a signVoucher or a voucherFor in the game's own code: the function around it, read the way a check
 * is. Such a function names the wallet itself, and the keeper pays the grant's own amount.
 */
function codeSite(file, open, signer, read = []) {
  const r = siteReading(file.bare, file.code, open, { f: file.f, files: read });
  const answers = r.answers.length ? r.answers : [{ grant: null, amount: null, recipient: 'check' }];
  return {
    ...r,
    answers: answers.map(a => ({
      ...a,
      amount: signer === 'keeper' ? 'grant' : a.amount,
      recipient: a.recipient === 'proven' ? 'check' : a.recipient,
    })),
  };
}

/**
 * Reads of a win's payment (winPaid, or a function of the game's own around it) whose failure answers "not paid":
 * `.catch(() => false)` on the call, or a try around it whose catch returns or sets false. → [{where, line, call, code}]
 */
export function failOpenPaidReads(read) {
  const out = [];
  for (const { f, code } of read) {
    if (f.split('/')[0] === 'gf-loot') continue;
    const bare = codeOnly(code);
    for (const m of bare.matchAll(/(?<![\w$.])winPaid\s*\(/g)) {
      const after = bare.slice(m.index, m.index + 400);
      let open = false;
      // any answer a later `if (paid)` reads as "not paid": false, null, undefined, 0, '' or nothing at all
      const FALSY = String.raw`(?:false|null|undefined|0|''|""|void\s+0)(?![\w$.])`;
      const fallback = new RegExp(
        String.raw`^winPaid\s*\([^;]*?\)\s*\)?\s*\.catch\s*\(\s*(?:\([^)]*\)|\w+)?\s*=>\s*(${FALSY}|\{\s*(?:return\s+${FALSY}|return\s*;?)?\s*\})`,
      ).exec(after);
      if (fallback) open = true;
      let caught = '';
      const handlerOf = () => caught;
      // a try whose block holds the call, and whose catch answers false
      for (const t of bare.slice(0, m.index).matchAll(/\btry\s*\{/g)) {
        const body = braced(bare, t.index + t[0].length - 1);
        if (!body || t.index + t[0].length - 1 + body.length < m.index) continue;
        const rest = bare.slice(t.index + t[0].length - 1 + body.length);
        const c = /^\s*catch\s*(?:\([^)]*\))?\s*\{/.exec(rest);
        if (!c) continue;
        const handler = braced(rest, c[0].length - 1) ?? '';
        if (new RegExp(String.raw`\breturn\s+${FALSY}|(?<![=!<>])=\s*${FALSY}|^\{\s*\}$`).test(handler)) {
          open = true;
          caught = handler;
        }
      }
      // null or undefined may mean "unknown": open only where the answer is then read as "not paid" (`if (paid)`,
      // `!paid`) and never told apart from it (`paid === null`); a helper's answer, read elsewhere, is not judged
      const nullish = open && !new RegExp(String.raw`(?:false|0|''|"")(?![\w$.])`).test(fallback?.[1] ?? handlerOf());
      if (nullish) {
        const name = /(?:\b(?:const|let|var)\s+|(?<![\w$.]))([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?$/.exec(
          bare.slice(Math.max(0, m.index - 80), m.index),
        )?.[1];
        const later = bare.slice(m.index, m.index + 1200);
        const n = name?.replace(/\$/g, '\\$');
        open = Boolean(
          n &&
          new RegExp(String.raw`\bif\s*\(\s*!?\s*${n}\s*\)|(?<![\w$.])${n}\s*(?:&&|\|\||\?(?!\?|\.))`).test(later) &&
          !new RegExp(String.raw`(?<![\w$.])${n}\s*[!=]==?\s*(?:null|undefined)\b`).test(later),
        );
      }
      if (!open) continue;
      const line = code.slice(0, m.index).split('\n').length;
      out.push({ where: `server/${f}`, line, call: 'winPaid', code: (code.split('\n')[line - 1] ?? '').trim() });
    }
  }
  return out;
}

/**
 * Calls that sign or send a Solana transaction, or make a signing key from bytes: a payout of the game's own, outside
 * any voucher (a treasury key in env sending SOL to whom the request names). → [[the call in words, its pattern]]
 */
const OWN_SIGNING = [
  ['Keypair.fromSecretKey', /\bKeypair\s*\.\s*fromSecretKey\s*\(/],
  ['Keypair.fromSeed', /\bKeypair\s*\.\s*fromSeed\s*\(/],
  ['a key pair made from bytes', /(?<![\w$.])createKeyPair(?:Signer)?From(?:Private)?(?:Key)?Bytes\s*\(/],
  // nacl.sign(…), nacl.sign.detached(…) and a key pair from a secret or a seed; nacl.sign.detached.verify and
  // nacl.sign.open check a signature and sign nothing
  [
    'nacl.sign',
    /\bnacl\s*\.\s*sign\s*(?:\(|\.\s*detached\s*\(|\.\s*keyPair\s*\.\s*from(?:SecretKey|Seed)\s*\()/,
  ],
  ['an Ed25519 signature (crypto.subtle.sign)', /\bsubtle\s*\.\s*sign\s*\(\s*\{?\s*(?:name\s*:\s*)?['"]Ed25519['"]/],
  ['ed25519.sign', /\bed25519\s*\.\s*sign\s*\(/],
  [
    'sendTransaction',
    /(?<![\w$])(?:sendTransaction|sendAndConfirmTransaction|sendRawTransaction|signAndSendTransaction|sendAndConfirmRawTransaction)\s*\(/,
  ],
  [
    'signTransaction',
    /(?<![\w$])(?:signTransaction|signAllTransactions|partialSign|signTransactionMessageWithSigners)\s*\(/,
  ],
  ['a sendTransaction request to an RPC', /\bmethod\s*:\s*['"]sendTransaction['"]/],
];
/**
 * The game's own server files (`own`: [{f, code}], comments out; xcore's copies left out) that sign or send a
 * transaction themselves: payouts this review does not read, since it reads only those made through a voucher.
 * → [{where, line, calls: [words]}]
 */
export function ownTransactions(own) {
  const out = [];
  for (const { f, code } of own) {
    if (f.split('/')[0] === 'gf-loot') continue;
    // (read with literals kept, for the Ed25519 name; a match that starts inside a string or a message is none)
    const bare = codeOnly(code);
    const calls = [],
      lines = [];
    for (const [words, re] of OWN_SIGNING) {
      const m = [...code.matchAll(new RegExp(re.source, 'g'))].find(x => bare[x.index] !== ' ');
      if (!m) continue;
      calls.push(words);
      lines.push(code.slice(0, m.index).split('\n').length);
    }
    if (calls.length) out.push({ where: `server/${f}`, line: Math.min(...lines), calls });
  }
  return out;
}

/** Every place in server/ that signs a voucher. `read`: [{f, code}] (comments out); `vouchers`: readVouchers' or null. */
export function signingSites(read, vouchers) {
  const sites = [];
  if (vouchers)
    sites.push({ signer: 'server', where: 'server/vouchers.js', payOnly: vouchers.payOnly, ...checkSite(vouchers) });
  for (const { f, code } of read) {
    if (f === 'vouchers.js') continue;
    const file = { f, bare: codeOnly(code), code };
    for (const [signer, call] of SIGNING)
      for (const m of file.bare.matchAll(new RegExp(call.source, 'g')))
        sites.push({
          signer,
          where: `server/${f}`,
          payOnly: null,
          ...codeSite(file, m.index + m[0].length - 1, signer, read),
        });
  }
  return sites;
}

const WEAKER_AMOUNT = ['request', 'server', 'grant'];
const WEAKER_RECIPIENT = ['request', 'unread', 'check', 'proven'];
const first = (order, values) => order.find(v => values.includes(v)) ?? null;
/**
 * A site as it pays one grant (`g`; null: any): its amount and who is paid, from the objects it writes out that name
 * the grant, or none in particular. null when all it writes out names other grants.
 */
function paying(site, g) {
  if (!site.answers) return site; // given whole: its amount and recipient as they are
  const mine = site.answers.filter(
    a =>
      !g ||
      a.grant === null ||
      a.grant === g.key ||
      (/^\d+$/.test(a.grant) && (g.id === undefined || String(g.id) === a.grant)),
  );
  if (site.answers.length && !mine.length) return null;
  return {
    ...site,
    amount: first(
      WEAKER_AMOUNT,
      mine.map(a => a.amount),
    ),
    recipient:
      first(
        WEAKER_RECIPIENT,
        mine.map(a => a.recipient),
      ) ?? 'proven',
    fresh: mine.some(a => a.fresh),
    grantBy: mine.some(a => a.grantBy === 'request') ? 'request' : null,
    // a round the request names and the check never looked up (the first such), or one made by code not read
    round: mine.find(a => a.round?.by === 'request')?.round ?? mine.find(a => a.round)?.round ?? null,
    answerUnread: [...new Set(mine.flatMap(a => a.unread ?? []))],
  };
}

/** The site whose reading pays most to a cheater: the request deciding first, then what was not read, then state. */
const weakest = sites => {
  const rank = s =>
    s.source === 'template' || s.source === 'nothing'
      ? 3
      : s.source === 'request' || s.recipient === 'request' || s.amount === 'request'
        ? 0
        : s.source === 'unreadable'
          ? 1
          : 2;
  return [...sites].sort((a, b) => rank(a) - rank(b))[0] ?? null;
};

/**
 * The payout ledger: one record for each grant a voucher pays, and one for each signer no grant names (what it signs
 * can't be claimed). `sites`: signingSites'; `economyRoutes`: the economy review's routes (their trust, when the grant
 * says none). → [record]
 */
export function payoutLedger(spec, { sites = [], economyRoutes = [] } = {}) {
  const grants = voucherGrants(spec);
  const records = grants.map(g => {
    // the sites that pay this grant: those that name it, or no grant in particular
    const site = weakest(sites.map(s => paying(s, g)).filter(Boolean));
    const signer = site?.signer ?? 'none';
    const limits = Object.fromEntries(LIMITS.filter(k => Number(g.limits?.[k]) > 0).map(k => [k, Number(g.limits[k])]));
    for (const window of ['perPersonEach', 'perWalletEach']) {
      const each = g.limits?.[window];
      if (Number(each?.count) > 0) limits[window] = { count: Number(each.count), every: each.every ?? '1d' };
    }
    const identity =
      signer === 'server'
        ? (IDENTITY[site.payOnly] ?? 'wallet') // not found: read as the template's 'any'
        : signer === 'keeper' && byPerson(limits)
          ? 'x' // the keeper counts each winner by their X account
          : 'wallet';
    const own = economyRoutes.find(r => r.key === g.key && (!r.kind || /grant/i.test(r.kind)));
    const declared = g.trust === undefined ? null : g.trust;
    const valid = TRUST.includes(declared);
    const observed = !site ? 'none' : site.source === 'env' ? 'state' : site.source;
    return {
      route: `grant:${g.key}`,
      grant: g.key,
      name: g.name ?? g.key,
      claimable: true,
      signer,
      where: site?.where ?? null,
      signers: sites.map(s => `${s.signer} (${s.where})`),
      keys: g.vouchers,
      // who says who is who: a voucher's person counts only when the project's issuer signed it; an
      // approved list names its own
      issuer: typeof spec?.keys?.issuer === 'string' ? spec.keys.issuer : null,
      listed: Array.isArray(g.list) && g.list.length > 0,
      source: site?.source ?? null,
      decides: site?.decides ?? null,
      // what the reading of its decision rests on, and whether that is env handed to code not read
      seen: site?.seen ?? null,
      assumed: site?.assumed ?? false,
      amount: site?.amount ?? null,
      recipient: site?.recipient ?? null,
      fresh: site?.fresh ?? false,
      // the request picks the grant (a check that pays any of several): `grants` it can pick from
      grantBy: site?.grantBy ?? null,
      grants: grants.length,
      round: site?.round ?? null,
      bound: site?.bound ?? [],
      answerUnread: site?.answerUnread ?? [],
      payOnly: site?.payOnly ?? null,
      identity,
      limits,
      trust: {
        declared,
        valid,
        economy: TRUST.includes(own?.trust) ? own.trust : null,
        observed,
        level: valid ? declared : TRUST.includes(own?.trust) ? own.trust : null,
        matches: !(valid && observed === 'request'),
      },
      ceiling: payoutCeiling(limits, identity, { keeper: signer === 'keeper' }),
    };
  });
  if (spec && !grants.length)
    for (const s of sites.map(x => paying(x, null)))
      records.push({
        route: s.where,
        grant: null,
        name: s.where,
        claimable: false,
        signer: s.signer,
        where: s.where,
        signers: [`${s.signer} (${s.where})`],
        keys: [],
        source: s.source,
        decides: s.decides,
        seen: s.seen ?? null,
        assumed: s.assumed ?? false,
        amount: s.amount,
        recipient: s.recipient,
        payOnly: s.payOnly,
        identity: s.signer === 'server' ? (IDENTITY[s.payOnly] ?? 'wallet') : 'wallet',
        limits: {},
        trust: null,
        ceiling: null,
      });
  return records;
}

export const limitWords = limits =>
  Object.keys(limits).length
    ? Object.entries(limits)
        .map(([k, v]) => `${k} ${typeof v === 'object' ? `${v.count} each ${v.every}` : v}`)
        .join(', ')
    : 'none';
export const decidedWords = r =>
  r.source === 'request'
    ? `the request alone (${r.decides === 'body' ? 'its body' : 'the sign-in, nothing else'})`
    : r.source === 'env'
      ? `state the server keeps (${r.seen ?? 'it reads env'})`
      : (SOURCES[r.source] ?? 'nothing (no signer)');

/**
 * The findings read off the ledger, one a code a record, its cases joined and its severity the worst of them:
 *   payout-input    the request decides something a cheater shouldn't: whether it pays (high with the body read,
 *                   medium for the sign-in alone), the wallet paid (high), the amount (medium: up to the grant's)
 *   payout-ceiling  unbounded (high), or bounded only by a total every player shares (medium)
 *   payout-signer   nothing signs it, or a signer pays nothing claimable (medium); payOnly 'any' on a grant that counts
 *                   people, so wallet-only players are refused (medium); PAY.check still the template, or answering no
 *                   grant (info)
 *   payout-trust    declared and observed differ (medium), unknown (medium), or not declared (medium; info when the
 *                   installed @xgamesfun/solana can't take it)
 */
export function payoutFindings(ledger, { available = false, testKey = null } = {}) {
  const out = [];
  for (const r of ledger) {
    const who = r.grant ? `"${r.grant}"` : r.where;
    const emit = (id, cases, facts) => {
      if (!cases.length) return;
      out.push({
        source: 'server',
        id,
        severity: worst(cases.map(c => c.severity)),
        route: r.route,
        cases: cases.map(c => c.case),
        message: `${who}: ${cases.map(c => c.why).join('; ')}. Its record: ${facts}.`,
        fix: [...new Set(cases.map(c => c.fix))].join(' '),
      });
    };
    const signed = r.where ? `${SIGNERS[r.signer]} in ${r.where}` : SIGNERS.none;

    const input = [];
    if (r.source === 'request')
      input.push(
        r.decides === 'body'
          ? {
              case: 'request-decides',
              severity: 'high',
              why: `the page's request decides it: the check reads the request's body and no state the server keeps (no run it started, no clock, no replay), so a script that sends the request is paid`,
              fix: `Check the result against what the server itself keeps (a run it started and timed, a replay, a match it ran) (${GUIDE}).`,
            }
          : {
              case: 'sign-in-decides',
              severity: 'medium',
              why: `the sign-in alone decides it: the check reads no state the server keeps, so every signed-in player who asks is paid, whatever they did`,
              fix: `If it is a gift, keep its limits tight; if it pays a result, check the result against what the server keeps (${GUIDE}).`,
            },
      );
    if (r.recipient === 'request')
      input.push({
        case: 'request-names-wallet',
        severity: 'high',
        why: 'the request names the wallet paid: a script sends its own',
        fix: 'Pay only a proven wallet: leave the wallet out of what the check answers (api/vouchers/pay pays the one signed in with or linked), or name one the server holds (walletOf(env, player)).',
      });
    // the request picks which grant pays, and there are several: a script asks for the biggest every time
    if (r.grantBy === 'request' && r.grants > 1)
      input.push({
        case: 'request-grant',
        severity: 'high',
        why: `the request picks which grant pays (the check answers the grant it names): of the ${r.grants} grants a voucher pays, a script asks for the biggest every time`,
        fix: "Name the grant in the check (grant: 'clear'), or pick it from what the server keeps (the run's own level), never from the request.",
      });
    if (r.amount === 'request' && r.source !== 'request')
      input.push({
        case: 'request-amount',
        severity: 'high',
        why: "the amount is the request's: whatever the server checks, a script names the most the grant pays",
        fix: "Work the amount out from what the server keeps (the run's own result), or pay 'grant'.",
      });
    // a round new on every request: each request is a claim of its own, so only a limit per person or wallet stops a
    // script that asks again and again
    const perPlayer = ['perPerson', 'perWallet', 'perPersonEach', 'perWalletEach'].some(k => r.limits?.[k]);
    if (r.fresh)
      input.push({
        case: 'round-fresh',
        severity: perPlayer ? 'medium' : 'high',
        why: `its round is new on every request (a random id or the clock), so every request is a claim of its own${perPlayer ? ': only the per-person or per-wallet limit stops a script' : ' and nothing per player bounds it: a script is paid on every request'}`,
        fix: 'Use a round the server gives out once and keeps (a run it started), so a result is paid once.',
      });
    // a bar the request sets: the check reads state, but measures it against what the request sent
    if (r.source === 'env' && r.bound?.length)
      input.push({
        case: 'request-bound',
        severity: 'medium',
        why: `a condition that decides it measures against what the request sent (${r.bound.slice(0, 3).join(', ')}): a script sends the value that passes. This review does not judge a guard's direction or its thresholds`,
        fix: "Measure against what the server keeps or sets itself (its own clock, the run's own start, a setting in env), never a value the request sends.",
      });
    // a round the request names, which the check never looked up: a script sends a new one with every request. With
    // a limit per person or per wallet, that limit bounds it as it bounds a round the server gave out: nothing to say
    if (r.round?.by === 'request' && r.source !== 'request' && !perPlayer)
      input.push({
        case: 'round-request',
        severity: 'high',
        why: `its round comes from the request (${r.round.names.join(', ')}), which the check never looks state up by: a script sends a new one each time, and with nothing per player to bound it, every request is a claim of its own`,
        fix: 'Use a round the server gave out and keeps (a run it started, looked up in the check), so a result is paid once.',
      });
    emit(
      'payout-input',
      input,
      `signed by ${signed}; decided by ${decidedWords(r)}; amount ${AMOUNTS[r.amount] ?? 'not read'}; paid to ${RECIPIENTS[r.recipient] ?? 'nobody'}`,
    );

    if (r.ceiling?.severity)
      emit(
        'payout-ceiling',
        [
          {
            case: r.ceiling.bounded ? `shared-${r.ceiling.by}` : 'unbounded',
            severity: r.ceiling.severity,
            why: `what one person can take is ${r.ceiling.words}`,
            fix:
              r.identity === 'wallet'
                ? `Bound it per person: VOUCHERS.payOnly 'x' (or 'account') and "perPerson" in the grant's limits; and a perDay total on every grant (${GUIDE}).`
                : `Bound it per person: "perPerson" in the grant's limits (in place of perWallet), so it counts ${r.identity === 'x' ? 'X accounts' : 'accounts'} and not wallets, with the key that signs its vouchers as the economy's "keys": { "issuer" }; and a perDay total on every grant (${GUIDE}).`,
          },
        ],
        `identity paid: ${IDENTITY_WORDS[r.identity]}${r.payOnly ? `, by VOUCHERS.payOnly '${r.payOnly}'` : ''}; limits: ${limitWords(r.limits)}`,
      );

    const sign = [];
    if (r.signer === 'none')
      sign.push({
        case: 'no-signer',
        severity: 'medium',
        why: `the grant names voucher keys (${r.keys.length}), but nothing in this game signs one: ${r.signers.length ? `what signs here (${r.signers.join(', ')}) names other grants only` : 'no server/vouchers.js, no env.GF.loot.report (the keeper), no signVoucher'}`,
        fix: `Give the server its key (${CMD} add vouchers) or report results to the keeper (docs/SERVER.md, "Paying a result"); a key held by a backend of your own is fine (this review cannot see it).`,
      });
    if (!r.claimable)
      sign.push({
        case: 'unclaimable',
        severity: 'medium',
        why: `${r.where} signs vouchers, but no grant in the economy names a voucher key: nothing it signs can be claimed`,
        fix:
          r.signer === 'keeper'
            ? 'Name the keeper\'s key for the game in the grant that pays results (docs/SERVER.md, "The keeper").'
            : `If the server has its live key already, ${CMD} add vouchers points the grants it pays at it (no new key); else ${CMD} secret set VOUCHER_SEED --new-key makes one and points them. Then ${CMD} loot approve.`,
      });
    if (r.source === 'template' || r.source === 'nothing')
      sign.push({
        case: r.source === 'template' ? 'template' : 'pays-nothing',
        severity: 'info',
        why: `PAY.check in server/vouchers.js ${r.source === 'template' ? 'is still the template' : 'answers no grant'}: the server pays no result yet`,
        fix: `Write PAY.check: what the server checks before a result pays (${GUIDE}).`,
      });
    if (r.signer === 'server' && r.payOnly === 'any' && byPerson(r.limits))
      sign.push({
        case: 'identity',
        severity: 'medium',
        why: "VOUCHERS.payOnly 'any' lets a wallet-only player be paid, but the grant counts people (perPerson): the server signs them nothing (person), so their claims fail",
        fix: "Set VOUCHERS.payOnly to 'x' in server/vouchers.js (or 'account'), so the page asks them to sign in first.",
      });
    // loot counts the person a voucher names only when the project's issuer signed it (else the wallet's link, which
    // this server never writes): a grant that counts people, whose vouchers another key signs, refuses every claim.
    // With no issuer at all the economy check refuses it itself (E-PERSON).
    if (r.signer === 'server' && byPerson(r.limits) && !r.listed && r.issuer && !r.keys.includes(r.issuer))
      sign.push({
        case: 'issuer',
        severity: 'high',
        why: `the grant counts people, but the economy's issuer (keys.issuer, ${r.issuer}) is not a key that signs its vouchers: loot counts a voucher's person only when the issuer signed it, so every claim is refused (NotLinked)`,
        fix: 'Make the key that signs its vouchers the issuer: "keys": { "issuer": "<the live voucher key\'s address>" } in xsolana.json, then approve. The issuer is one key: it signs both the vouchers that name a person and any links.',
      });
    // The issuer among the keys the grant names, but maybe not the server's live key (on xgames.fun only, so this machine
    // can't name it): the test key (whose seed is in .dev.vars, so the live server never signs with it) is known wrong;
    // one of several others (the keeper's beside the live key) may be right, and is the person's to confirm.
    else if (r.signer === 'server' && byPerson(r.limits) && !r.listed && r.issuer) {
      const others = r.keys.filter(k => k !== testKey);
      if (r.issuer === testKey)
        sign.push({
          case: 'issuer-test',
          severity: 'medium',
          why: `the grant counts people, and the economy's issuer (${r.issuer}) is the test key in .dev.vars: loot counts a voucher's person only when the issuer signed it, and the server on xgames.fun signs with its live key, so every claim it pays there is refused (NotLinked)`,
          fix: `Make the live key (${CMD} secret set VOUCHER_SEED --new-key makes it the issuer where a grant counts people), then ${CMD} loot approve.`,
        });
      else if (others.length > 1)
        sign.push({
          case: 'issuer-which',
          severity: 'info',
          why: `the grant counts people and names ${others.length} voucher keys${testKey ? ' besides the test key' : ''}, and the economy's issuer (${r.issuer}) is one of them: loot counts a voucher's person only when the issuer signed it, so it must be the key this server signs with, not the keeper's`,
          fix: `Check whether ${r.issuer} is this game's own live voucher key (the address ${CMD} secret set VOUCHER_SEED --new-key printed); if it is the keeper's, make the live key the issuer.`,
        });
    }
    emit(
      'payout-signer',
      sign,
      `signer: ${signed}; keys the grant names: ${r.keys.length}; identity paid: ${IDENTITY_WORDS[r.identity]}${r.payOnly ? `, by VOUCHERS.payOnly '${r.payOnly}'` : ''}`,
    );

    const trust = [];
    const t = r.trust;
    if (t && t.declared === null)
      trust.push({
        case: 'undeclared',
        severity: available ? 'medium' : 'info',
        why: 'it pays with a voucher and does not say how much its server checks before signing ("trust")',
        fix: available
          ? `Declare it honestly, as the check really does it: "trust": "decides", "replays" or "bounds" (${GUIDE}).`
          : `Once the installed @xgamesfun/solana takes it (the one with xsolana review), declare "trust": "decides", "replays" or "bounds" as the check really does it (${GUIDE}).`,
      });
    else if (t && !t.valid)
      trust.push({
        case: 'unknown',
        severity: 'medium',
        why: `it declares trust "${t.declared}", which is none of ${TRUST.join(', ')}`,
        fix: `Use one of "decides", "replays" or "bounds" (${GUIDE}).`,
      });
    else if (t && !t.matches)
      trust.push({
        case: 'mismatch',
        // claiming the server decides or replays the result when nothing it keeps reaches the decision: every reader
        // of the economy (its own review, a player) trusts a claim that is false
        severity: t.declared === 'decides' || t.declared === 'replays' ? 'high' : 'medium',
        why: `it declares trust "${t.declared}", but nothing the server keeps reaches its decision (it reads only the request, or reads state it never uses): it can't decide, replay or bound anything`,
        fix: `Make the check do what "${t.declared}" says (${GUIDE}), and know that until it does, it pays on the request's word alone.`,
      });
    if (t)
      emit(
        'payout-trust',
        trust,
        `declared ${t.declared === null ? 'nothing' : `"${t.declared}"`}; observed: ${OBSERVED[t.observed]}`,
      );
  }
  return out;
}
