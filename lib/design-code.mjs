// `xcore review`'s design ↔ code pass: what the economy spec says the game's server does off chain, against what the
// server's code does. The economy kit (@xgamesfun/solana) follows value only through the spec, so a conversion that
// lives in server code (a code that multiplies earnings, a stake that counts as an entry, a prize bought with farm
// yield) hides every loop through it, and a per-person limit the server keeps leaves the kit computing with the
// chain's caps, which only bound a leaked voucher key. Two declarations close the gap:
//   offchain      `offchain: [{key, name, takes, gives, rate}]` in xsolana.json: what the server turns what players
//                 hold or did into
//   serverLimit   a voucher grant's server bound (SERVER_LIMIT below): what the server signs at most for one identity
//                 per window
// Read in both directions, one finding code each:
//   design-unbuilt     a declaration with no code in server/ that appears to do it (medium)
//   code-undeclared    a conversion in server/ the spec doesn't declare (medium; with a drafted declaration)
//   bound-undeclared   a voucher grant whose bound lives on its server, with no serverLimit (low; and a question)
// Then the drafts are added to a temporary copy of the spec (never the real one; only fields the installed kit's schema
// takes) and its check is run with and without them: what appears only with the drafts is what the server was hiding.
// The reading is by signals, never one rule per game, and says "appears to" where the code alone doesn't settle it.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { solanaCommand, solanaRoot } from './economy.mjs';
import { apiRoutes, braced, definitions, voucherGrants, withoutStrings, wordsOfName, XCORE_PARTS } from './review.mjs';

/**
 * A voucher grant's server bound, as the economy kit's maintainers agreed it: `grants[i].serverLimit = {per, amount,
 * every?, total?}`, "the server signs at most `amount` of the prize for one `per` each `every`". per: "person" (the
 * identity the server counts, an X account), "wallet", or "all" (everyone together); amount in the prize's own units
 * (tokens, or a count of an item); every defaults to "1d". The one place its name and shape live.
 */
export const SERVER_LIMIT = {
  field: 'serverLimit',
  per: ['person', 'wallet', 'all'],
  every: '1d',
  /** A declaration in its shape, from what the code shows. */
  make: ({ per, amount, every = null, total = null }) => ({
    per,
    amount,
    ...(every ? { every } : {}),
    ...(total ? { total } : {}),
  }),
  /** Is it on the grant? */
  of(g) {
    return g?.[this.field] ?? null;
  },
};
/** The kit's own field for what a server does off chain. */
const OFFCHAIN = 'offchain';
const DRAFTED = 'drafted from code: confirm each with the person before adding';

const arr = v => (Array.isArray(v) ? v : []);
const num = v => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/_/g, '')));
const lineAt = (code, at) => code.slice(0, at).split('\n').length;
const lineText = (text, line) => (text.split('\n')[line - 1] ?? '').trim();
const quote = s => `“${s}”`;

// ---- The design ---------------------------------------------------------------------------------------------------

/** What a grant's claim gives: {asset: token key or "item:<key>", amount, unit: 'tokens'|'item'} or null. */
function prizeOf(g, spec) {
  const p = g.prize ?? g.gives;
  if (!p || typeof p !== 'object') return null;
  const poolToken = key => arr(spec?.pools).find(x => x.key === key)?.currency ?? null;
  if (p.gives === 'item' || (!p.gives && p.item)) return { asset: `item:${p.item}`, amount: 1, unit: 'item' };
  if (p.gives === 'tokens') {
    const from = typeof p.from === 'string' && p.from.startsWith('pool:') ? poolToken(p.from.slice(5)) : null;
    const asset = from ?? p.currency ?? spec?.currency ?? null;
    return asset ? { asset, amount: num(p.amount) || null, unit: 'tokens' } : null;
  }
  if (!p.gives && p.pool) {
    const asset = poolToken(p.pool);
    return asset ? { asset, amount: num(p.amount) || null, unit: 'tokens' } : null;
  }
  return null;
}

/**
 * The design, as the spec says it: its offchain declarations, each voucher grant (trust, limits, prize, serverLimit),
 * and the names its tokens and items go by (to match in code). → {offchain, grants, assets, farms}
 */
export function designOf(spec) {
  const assets = [
    ...arr(spec?.tokens)
      .filter(t => t?.key)
      .map(t => ({
        asset: t.key,
        label: t.symbol ?? t.key.toUpperCase(),
        names: [t.key, t.symbol, t.name].filter(Boolean),
        mint: typeof t.mint === 'string' ? t.mint : null,
      })),
    ...arr(spec?.items)
      .filter(i => i?.key)
      .map(i => ({
        asset: `item:${i.key}`,
        label: i.name ?? i.key,
        names: [i.key, i.name].filter(Boolean),
        mint: null,
      })),
  ];
  return {
    offchain: arr(spec?.[OFFCHAIN]).filter(x => x && typeof x === 'object'),
    grants: voucherGrants(spec).map(g => ({
      key: g.key,
      id: g.id ?? null,
      name: g.name ?? g.key,
      trust: g.trust ?? null,
      limits: g.limits ?? {},
      prize: prizeOf(g, spec),
      serverLimit: SERVER_LIMIT.of(g),
    })),
    assets,
    farms: arr(spec?.farms)
      .filter(f => f?.key)
      .map(f => ({ key: f.key, rewards: f.rewards ?? null })),
  };
}

/** An asset in words: a token's symbol, an item's name. */
const labelOf = (design, asset) =>
  asset?.startsWith('farm:')
    ? `more of ${asset.slice(5)}'s rewards`
    : (design.assets.find(a => a.asset === asset)?.label ?? asset ?? 'something');

// ---- Reading the code -----------------------------------------------------------------------------------------------

const spaced = s => ` ${wordsOfName(s).join(' ')} `;
/** The spec's tokens and items `text` names (a key, symbol or name as whole words, a plural too, or a mint), first first. */
function assetsNamed(text, design) {
  const t = spaced(text);
  const found = [];
  for (const a of design.assets) {
    let at = a.mint && text.includes(a.mint) ? 0 : -1;
    for (const n of a.names) {
      const w = spaced(n).trim();
      if (!w) continue;
      for (const form of [` ${w} `, ` ${w}s `]) {
        const i = t.indexOf(form);
        if (i >= 0 && (at < 0 || i < at)) at = i;
      }
    }
    if (at >= 0) found.push({ asset: a.asset, at });
  }
  return found.sort((x, y) => x.at - y.at).map(x => x.asset);
}

/** The game's own server files, as the pass reads them: kit copies and xcore's parts out, server/vouchers.js's PAY only. */
function ownFiles(read) {
  const out = [];
  for (const { f, code, text } of read) {
    const top = f.split('/')[0];
    if (top === 'gf-loot' || top === 'gf-loot-play') continue;
    if (f === 'index.js' && /Written by `xcore add/.test(text)) continue;
    if (f === 'vouchers.js') {
      // xcore writes the rest of it (its own request rate, VOUCHERS.perMinute, is no bound on what one person earns)
      const m = /^export const PAY = \{/m.exec(code);
      const block = m ? braced(code, m.index + m[0].length - 1) : null;
      if (!block) continue;
      const start = m.index + m[0].length - 1;
      const blank = s => s.replace(/[^\n]/g, ' ');
      out.push({
        f,
        text,
        code: blank(code.slice(0, start)) + block + blank(code.slice(start + block.length)),
        full: code,
        pay: { start, end: start + block.length },
      });
      continue;
    }
    if (XCORE_PARTS.has(f)) continue;
    out.push({ f, text, code, full: code, pay: null });
  }
  return out.map(x => ({ ...x, bare: withoutStrings(x.code), defs: [...definitions(x.code), ...methods(x.code)] }));
}

/** Methods whose parameters hold parentheses (`view(s, now = Date.now()) {`), which definitions() reads past. */
function methods(code) {
  const bare = withoutStrings(code);
  const out = [];
  for (const m of bare.matchAll(/(?:^|[{},;\s])(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (/^(?:if|for|while|switch|catch|function|return|with|await|typeof|new)$/.test(m[1])) continue;
    const close = pastCall(bare, m.index + m[0].length - 1);
    const brace = /^\s*\{/.exec(bare.slice(close));
    if (close === m.index + m[0].length - 1 || !brace) continue;
    const start = close + brace[0].length - 1;
    const body = braced(code, start);
    if (body && /\(/.test(bare.slice(m.index + m[0].length, close - 1))) out.push({ name: m[1], body, start });
  }
  return out;
}

/** The innermost function around `at`: {name, start, body} (start: its body's first index), or the whole file. */
function around(file, at) {
  let best = null;
  for (const d of file.defs)
    if (d.start <= at && at < d.start + d.body.length && (!best || d.body.length < best.body.length)) best = d;
  return best ?? { name: null, start: 0, body: file.code };
}

/** What a player holds or did, read by the server: each kind and how to spot it on a line (strings kept). */
const READS = [
  ['holds', 'what a wallet holds', /(?<![\w$.])(?:holds|collectiblesOf)\s*\(/],
  [
    'balance',
    'a balance',
    /\b(?:getTokenAccountBalance|getParsedTokenAccountsByOwner|getTokenAccountsByOwner|getBalance|balanceOf|tokenBalance|balances?)\b|\b\w*[a-z]Balance\b/,
  ],
  ['stake', 'a stake', /\b(?:stake[ds]?|staking|staker|seats?|seatOf)\b|\b[a-z]\w*Stake[ds]?\b|\bstaked[A-Z]\w*/],
  ['save', 'a save or score the platform keeps', /\b(?:saves|scores)\s*\??\.\s*[\w$]+\s*\(/],
  ['code', 'a code lookup', null],
];
/** Each kind of read as the thing a player turns into more (for the sentences), most telling first. */
const NOUNS = {
  holds: 'what a wallet holds',
  balance: 'a token balance',
  stake: 'a stake',
  code: 'a code',
  save: "what the player's save or score holds",
};
const byKind = (a, b) => Object.keys(NOUNS).indexOf(a.kind) - Object.keys(NOUNS).indexOf(b.kind);
const CODE_WORD = /\b(?:codes?|promo\w*|coupons?|redeem\w*)\b|\w(?:Code|Promo|Coupon)s?\b/;
const LOOKUP = /(?:\.get|prepare|\.first|\.find|\.has|digest|sha256|hash\w*)\s*\(|\[[^\]]*\]/;

/** The reads in [from, to) of a file: [{kind, what, where, line, at, asset}]. */
function readsIn(file, from, to, design) {
  const out = [];
  const lines = file.code.slice(0, to).split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const start = offset;
    offset += l.length + 1;
    if (start + l.length < from) continue;
    for (const [kind, what, re] of READS) {
      const hit = re ? re.test(l) : CODE_WORD.test(l) && LOOKUP.test(l);
      if (!hit) continue;
      const item = kind === 'holds' ? /\bitem\s*:\s*['"]([\w-]+)['"]/.exec(l)?.[1] : null;
      const asset = item && design.assets.some(a => a.asset === `item:${item}`) ? `item:${item}` : null;
      out.push({ kind, what, where: `server/${file.f}`, line: i + 1, at: start, asset, named: assetsNamed(l, design) });
      break;
    }
  }
  return out;
}

/** Reads once each (a function found twice by definitions(): as a function and as a method shape). */
const dedupe = reads => reads.filter((r, i) => reads.findIndex(x => x.where === r.where && x.line === r.line) === i);

/** Words that mark a multiplier or bonus, an entry, a value earned, and a per-identity bound. */
const EFFECT = new Set([
  'boost',
  'boosts',
  'boosted',
  'bonus',
  'bonuses',
  'multiplier',
  'multipliers',
  'mult',
  'x2',
  'double',
  'doubled',
  'perk',
]);
const ENTRY = new Set(['entry', 'entries', 'ticket', 'tickets', 'eligible', 'eligibility', 'qualifies', 'qualified']);
const EARNED = new Set([
  'amount',
  'reward',
  'rewards',
  'earn',
  'earned',
  'earns',
  'earnings',
  'payout',
  'pay',
  'prize',
  'claim',
  'grant',
  'score',
  'points',
  'entries',
  'tickets',
]);
const PAYOUT = new Set([
  'amount',
  'reward',
  'rewards',
  'payout',
  'prize',
  'claim',
  'grant',
  'earn',
  'earned',
  'earnings',
]);
const BOUND = new Set([
  'cap',
  'caps',
  'max',
  'most',
  'limit',
  'quota',
  'allowance',
  'budget',
  'bucket',
  'ceiling',
  'hourly',
  'daily',
]);
const CHAIN = /(?:[A-Za-z_$][\w$]*\s*\??\.\s*)*[A-Za-z_$][\w$]*/g;
const hasWord = (set, s) => wordsOfName(s).some(w => set.has(w));

/** The end of a call's parentheses opening at `at` (or `at` itself when none opens there). */
function pastCall(code, at) {
  let i = at;
  while (code[i] === ' ') i++;
  if (code[i] !== '(') return at;
  let depth = 0;
  for (; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) return i + 1;
  }
  return at;
}

/** Is the expression at [at, end) an operand of * or + (applied to something, not counted up itself)? */
function applied(bare, at, end) {
  const before = bare
    .slice(Math.max(0, at - 40), at)
    .replace(/(?:await\s+|\(\s*)+$/, '')
    .trimEnd();
  if (/(?<![+*])[*+]=?$/.test(before) && !/\+\+$/.test(before)) return true;
  const after = bare.slice(pastCall(bare, end), pastCall(bare, end) + 4).replace(/^\s*\)?\s*/, '');
  return /^[*+](?![+=])/.test(after);
}
/** Does the statement on this line make a value (an assignment, a property, a return), not only test one? */
const makes = l => /(?<![=!<>])=(?![=>])|\breturn\b|[\w$\])]\s*:(?!:)/.test(l);
/** Is `at` inside an if's or a while's condition (a value tested, not made)? */
function inCondition(bare, at) {
  const from = bare.lastIndexOf('\n', at) + 1;
  for (const m of bare.slice(from, at).matchAll(/\b(?:if|while)\s*\(/g)) {
    const open = from + m.index + m[0].length - 1;
    if (pastCall(bare, open) > at) return true;
  }
  return false;
}
const assigned = (bare, end) => /^\s*(?:[+*]?=(?!=)|:)/.test(bare.slice(end, end + 4));

/** A name's numeric value where the code sets it: `const BOOST = 1.5`, `boost: 2`. → number or null */
function valueOf(files, name) {
  const last = name.split('.').pop().trim().replace(/\$/g, '\\$');
  for (const file of files) {
    const m = new RegExp(
      `(?:\\b(?:const|let|var)\\s+${last}\\s*=|(?<![\\w$.])${last}\\s*:)\\s*(-?[\\d_]+(?:\\.\\d+)?)\\b`,
    ).exec(file.full);
    if (m) return num(m[1]);
  }
  return null;
}

/** The most a boost function of the game's own gives (`return held ? 2 : 1`, `return 1.5`): above 1, or null. */
function factorIn(calls) {
  const seen = calls.flatMap(x =>
    [...withoutStrings(x.def.body).matchAll(/(?:\?|:|\breturn)\s*(\d+(?:\.\d+)?)\s*(?=[:;}\n])/g)].map(m => num(m[1])),
  );
  const most = Math.max(0, ...seen);
  return most > 1 && most <= 1000 ? most : null;
}

/** The grants a body pays (`grant: 'key'`, a template's prefix, an id), from the design's voucher grants. */
function grantsIn(body, design) {
  const out = new Set();
  for (const m of body.matchAll(/\bgrant\s*:\s*(?:(['"])([\w-]+)\1|`([\w-]*)\$\{|`([\w-]+)`|(\d+)\b)/g)) {
    const [, , exact, prefix, plain, id] = m;
    for (const g of design.grants)
      if (
        (exact ?? plain) === g.key ||
        (id && Number(id) === Number(g.id)) ||
        (prefix !== undefined && prefix && g.key.startsWith(prefix))
      )
        out.add(g);
  }
  // a grant named some other way (a variable): the only one there is
  if (!out.size && /\bgrant\s*:/.test(body) && design.grants.length === 1) out.add(design.grants[0]);
  return [...out];
}

/** Where each grant is paid from: PAY (server/vouchers.js), voucherFor, a keeper report, signVoucher. → [{file, body, start, grants, pay}] */
function payingBodies(files, design) {
  const out = [];
  for (const file of files) {
    if (file.pay) {
      const body = file.code.slice(file.pay.start, file.pay.end);
      const grants = grantsIn(body, design);
      out.push({ file, body, start: file.pay.start, grants: grants.length ? grants : design.grants, pay: true });
      continue;
    }
    for (const m of file.bare.matchAll(/\bvoucherFor\s*\(|\bloot\s*\??\.\s*report\s*\(|(?<![\w$.])signVoucher\s*\(/g)) {
      const d = around(file, m.index);
      out.push({ file, body: d.body, start: d.start, grants: grantsIn(d.body, design), pay: false });
    }
  }
  return out;
}

/** The functions a body calls that the game's own code defines (one level): [{file, def}]. */
function calledFrom(body, files) {
  const out = [];
  const bare = withoutStrings(body);
  for (const file of files)
    for (const def of file.defs)
      if (
        def.name &&
        !/^(?:check|paid|fetch|constructor)$/.test(def.name) &&
        new RegExp(`(?<![\\w$])${def.name.replace(/\$/g, '\\$')}\\s*(?:\\?\\.\\s*)?\\(`).test(bare) &&
        !out.some(x => x.def === def)
      )
        out.push({ file, def });
  return out;
}

/**
 * The conversions in the game's own server code: a multiplier or bonus applied to what is earned (or something counted
 * as an entry) in a function that reads what a player holds or did, there or in a function of its own it calls.
 * → [{where, line, code, effect, by, factor, reads, takes, gives, changes, grants, route, function}]
 */
export function conversionsIn(files, design) {
  const paying = payingBodies(files, design);
  const out = [];
  for (const file of files) {
    for (const m of file.bare.matchAll(CHAIN)) {
      const chain = m[0];
      const end = m.index + chain.length;
      const entry = hasWord(ENTRY, chain) && assigned(file.bare, end);
      const effect = hasWord(EFFECT, chain) && applied(file.bare, m.index, end);
      if (!entry && !effect) continue;
      if (!makes(lineText(file.bare, lineAt(file.bare, m.index))) || inCondition(file.bare, m.index)) continue;
      const fn = around(file, m.index);
      if (effect && !hasWord(EARNED, fn.body.replace(/[^\w$]+/g, ' '))) continue;
      const by = chain.replace(/\s+/g, '');
      if (out.some(c => c.file === file && c.fnStart === fn.start && c.by === by)) continue;
      // what it reads: in the function, and in each function of the game's own it calls (one level)
      // and where its value is set from what a player did: `s.boost = {code: hash}` in another function of the file
      const calls = calledFrom(fn.body, files).filter(x => x.def !== fn);
      const setters = settersOf(file, by.split('.').pop()).filter(d => d !== fn);
      const callers = setters.flatMap(d => callersOf(file, d)).filter(d => d !== fn && !setters.includes(d));
      const reads = dedupe([
        ...readsIn(file, fn.start, fn.start + fn.body.length, design),
        ...[...calls, ...[...setters, ...callers].map(def => ({ file, def }))].flatMap(x =>
          readsIn(x.file, x.def.start, x.def.start + x.def.body.length, design),
        ),
      ]);
      if (!reads.length) continue;
      reads.sort(byKind);
      // what it changes, and the grants it feeds: PAY's own, a body that pays, or one that calls this function
      const name = fn.name;
      const feeds = paying.filter(
        p =>
          (p.file === file && p.start <= m.index && m.index < p.start + p.body.length) ||
          (name && calledFrom(p.body, [file]).some(x => x.def.name === name)),
      );
      const grants = [...new Set(feeds.flatMap(p => p.grants))];
      const line = lineAt(file.code, m.index);
      const gives =
        [...new Set(grants.map(g => g.prize?.asset).filter(Boolean))].length === 1
          ? grants.find(g => g.prize?.asset).prize.asset
          : (assetsNamed(lineText(file.code, line), design)[0] ?? null);
      const named = [...reads.map(r => r.asset), ...reads.flatMap(r => r.named)].filter(a => a && a !== gives);
      const routes = feeds.some(p => p.pay) ? ['api/vouchers/pay'] : apiRoutes(file.text);
      const words = wordsOfName(fn.body.replace(/[^\w$]+/g, ' '));
      out.push({
        file,
        fnStart: fn.start,
        where: `server/${file.f}`,
        line,
        code: lineText(file.text, line),
        effect: entry ? 'entry' : hasWord(new Set(['bonus', 'bonuses']), chain) ? 'bonus' : 'multiplier',
        by,
        factor: effect ? (valueOf(files, by) ?? factorIn(calls.filter(x => hasWord(EFFECT, x.def.name)))) : null,
        reads: reads.map(({ kind, what, where, line: l }) => ({ kind, what, where, line: l })),
        takes: named[0] ?? null,
        gives,
        changes: entry ? 'entry' : words.some(w => PAYOUT.has(w)) ? 'payout' : 'score',
        word: wordsOfName(by)
          .find(w => EFFECT.has(w) || ENTRY.has(w))
          ?.replace(/(?:ed|es|s)$/, ''),
        paysHere: wordsOfName(lineText(file.bare, line)).some(w => EARNED.has(w) || w === 'value'),
        grants: grants.map(g => g.key),
        route: routes[0] ?? null,
        function: name,
      });
    }
  }
  // one conversion a name a file: where it is applied to what is earned, if anywhere, else its first use
  const kept = out.filter(
    c =>
      !out.some(
        o =>
          o !== c &&
          o.file === c.file &&
          o.word === c.word &&
          (o.paysHere
            ? !c.paysHere || out.indexOf(o) < out.indexOf(c)
            : !c.paysHere && out.indexOf(o) < out.indexOf(c)),
      ),
  );
  return kept.map(({ file: _f, fnStart: _s, paysHere: _p, word: _w, ...c }) => c);
}

/** The functions of a file that call `def` (the route that hands a setter what the player sent). */
const callersOf = (file, def) =>
  file.defs.filter(
    d =>
      d !== def &&
      d.name &&
      !(d.start <= def.start && def.start < d.start + d.body.length) &&
      new RegExp(`(?<![\\w$])${def.name.replace(/\$/g, '\\$')}\\s*(?:\\?\\.\\s*)?\\(`).test(withoutStrings(d.body)),
  );

/** The functions of a file that set `name` (`x.name = …`, `{ name: … }`): where a value applied elsewhere comes from. */
function settersOf(file, name) {
  const n = name.replace(/\$/g, '\\$');
  const re = new RegExp(`\\.\\s*${n}\\s*=(?![=>])|[{,]\\s*${n}\\s*:`, 'g');
  const out = [];
  for (const m of file.bare.matchAll(re)) {
    const d = around(file, m.index);
    if (d.name && !out.includes(d)) out.push(d);
  }
  return out;
}

const WINDOWS = [
  ['1m', /\b(?:minute|minutes|per minute|60_?000)\b/],
  ['1h', /\b(?:hour|hours|hourly|hr|3_?600(?:_?000)?)\b/],
  ['1d', /\b(?:day|days|daily|today|86_?400(?:_?000)?)\b|slice\s*\(\s*0\s*,\s*10\s*\)/],
  ['7d', /\b(?:week|weeks|weekly|604_?800(?:_?000)?)\b/],
];
/** The window a name or a body says: → '1h' | '1d' | … or null (none, or more than one). */
function windowIn(text) {
  const t = `${spaced(text)} ${text}`;
  const hits = WINDOWS.filter(([, re]) => re.test(t)).map(([w]) => w);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The bounds the server keeps on each grant it pays: in PAY (and what it calls) or around voucherFor / a report, a
 * comparison against a cap a window (`if (hour + amount > PER_HOUR)`, `Math.min(…, DAILY_CAP)`). → [{grant, where,
 * line, code, name, value, every, per, unit, amount}] (amount: in the prize's own units, or null when not read)
 */
export function boundsIn(files, design) {
  const out = [];
  for (const p of payingBodies(files, design)) {
    const scopes = [
      { file: p.file, start: p.start, body: p.body },
      ...calledFrom(p.body, files).map(x => ({ file: x.file, start: x.def.start, body: x.def.body })),
    ];
    for (const s of scopes) {
      const bare = withoutStrings(s.body);
      for (const m of bare.matchAll(CHAIN)) {
        const name = m[0].replace(/\s+/g, '');
        const words = wordsOfName(name);
        // (Math.max is no cap; a grant's own limits, read from the economy, are the chain's)
        if (words[0] === 'math' || /\b(?:ECONOMY|grants?)\b/.test(name)) continue;
        const windowed = words.includes('per') && windowIn(name);
        if (!hasWord(BOUND, name) && !windowed) continue;
        const at = s.start + m.index;
        const line = lineAt(s.file.code, at);
        const l = lineText(s.file.code, line);
        if (!/(?<![=>])[<>]=?(?!=)|Math\s*\.\s*min\s*\(/.test(withoutStrings(l))) continue;
        for (const g of p.grants) {
          if (out.some(b => b.grant === g.key && b.where === `server/${s.file.f}` && b.line === line)) continue;
          const value = valueOf(files, name) ?? num(/[<>]=?\s*([\d_]+(?:\.\d+)?)\b/.exec(l)?.[1]);
          const every = windowIn(name) ?? windowIn(l) ?? windowIn(s.body);
          const per = /player\s*\??\.\s*(?:sub|x|id)\b|\bperson\b/.test(s.body)
            ? 'person'
            : /\bwallet\b/.test(s.body)
              ? 'wallet'
              : 'all';
          const claims = /\b(?:count|counts|claims|times|runs|plays)\b|\+\+|\+\s*1\b/.test(`${spaced(l)} ${l}`);
          const unit = claims ? 'claims' : 'amount';
          const amount = !Number.isFinite(value)
            ? null
            : !claims || g.prize?.unit === 'item'
              ? value
              : g.prize?.amount
                ? value * g.prize.amount
                : null;
          out.push({
            grant: g.key,
            where: `server/${s.file.f}`,
            line,
            code: lineText(s.file.text, line),
            name,
            value: Number.isFinite(value) ? value : null,
            every,
            per,
            unit,
            amount,
          });
        }
      }
    }
  }
  return out;
}

// ---- Design against code ------------------------------------------------------------------------------------------

/** Does a declaration name what a conversion does? By its key or name in the code, or by what it takes and gives. */
function declares(d, c, design, codeText) {
  const words = [d.key, d.name].filter(Boolean).map(n => spaced(n).trim());
  if (words.some(w => w && spaced(codeText).includes(` ${w} `))) return true;
  const farmGives = d.gives?.startsWith('farm:') ? design.farms.find(f => `farm:${f.key}` === d.gives)?.rewards : null;
  const t = c.takes ? d.takes === c.takes : null;
  const g = c.gives ? d.gives === c.gives || farmGives === c.gives : null;
  if (t === null && g === null) return false;
  return t !== false && g !== false;
}

const keyOf = (s, taken) => {
  const base =
    wordsOfName(s)
      .join('-')
      .replace(/^[^a-z]+/, '')
      .slice(0, 28)
      .replace(/-+$/, '') || 'server';
  let k = base,
    n = 2;
  while (taken.has(k)) k = `${base}-${n++}`;
  taken.add(k);
  return k;
};

/** A conversion in words: what it reads, what it changes. */
const readWords = (c, design) =>
  c.takes
    ? `${c.takes.startsWith('item:') ? 'a ' : ''}${labelOf(design, c.takes)}`
    : (NOUNS[c.reads[0]?.kind] ?? 'what a player holds');
const changeWords = (c, design) =>
  c.changes === 'entry'
    ? `an entry${c.gives ? ` to ${labelOf(design, c.gives)}` : ''}`
    : `${c.factor ? `×${c.factor} ` : c.effect === 'bonus' ? 'a bonus of ' : 'more '}${c.gives ? labelOf(design, c.gives) : c.changes === 'score' ? 'score' : 'of what it pays'}`;

/**
 * The pass: the design and the code side by side, the findings, the drafts, and the lines for the person. `spec`: the
 * economy; `read`: serverReview's [{f, code (comments out), text}]; `ledger`: the payout ledger (what each grant's
 * check reads). → {design, conversions, bounds, unbuilt, findings, drafts, ask, tell}
 */
export function designCode(spec, { read = [], ledger = [] } = {}) {
  const design = designOf(spec);
  const files = ownFiles(read);
  const conversions = conversionsIn(files, design);
  const bounds = boundsIn(files, design);
  const findings = [];
  const ask = [];
  const tell = [];
  const add = (id, severity, route, message, fix, extra = {}) =>
    findings.push({ source: 'design', id, severity, ...(route ? { route } : {}), message, fix, ...extra });

  // design-unbuilt: a declaration no code appears to do
  const unbuilt = [];
  for (const d of design.offchain) {
    const built = conversions.some(c =>
      declares(d, c, design, files.find(f => `server/${f.f}` === c.where)?.code ?? ''),
    );
    if (built) continue;
    unbuilt.push({ kind: OFFCHAIN, key: d.key });
    add(
      'design-unbuilt',
      'medium',
      `offchain:${d.key}`,
      `The spec declares ${quote(d.name ?? d.key)} (offchain: ${d.takes} into ${d.gives}${d.rate !== undefined ? ` at ${d.rate}` : ''}), but no code in server/ appears to do it: no multiplier, bonus or entry there reads ${labelOf(design, d.takes)}. If the page does it, it is a suggestion to a script (BEFORE-YOU-BUILD.md, lens 5); if nothing does, the economy check counts a route that isn't there.`,
      `Build it in the server (where a payout is decided), or take it out of "offchain"; if it lives in a backend this review can't see, say so to the person.`,
    );
  }
  for (const g of design.grants.filter(x => x.serverLimit)) {
    if (bounds.some(b => b.grant === g.key)) continue;
    unbuilt.push({ kind: SERVER_LIMIT.field, key: g.key });
    add(
      'design-unbuilt',
      'medium',
      `grant:${g.key}`,
      `${quote(g.name)} declares ${SERVER_LIMIT.field} ${JSON.stringify(g.serverLimit)}, but no check in server/ that pays it appears to hold a cap a window (PAY.check, what it calls, voucherFor or a report): the chain allows its own limits, and the economy check reasons from a bound that isn't kept.`,
      `Hold the bound where the grant is paid (PAY.check or PAY.paid, counting what each ${g.serverLimit.per ?? 'person'} took in the window), or take ${SERVER_LIMIT.field} out of the grant.`,
    );
  }

  // code-undeclared: a conversion the spec doesn't declare, with its draft
  const taken = new Set(design.offchain.map(d => d.key));
  const offchain = [];
  for (const c of conversions) {
    const codeText = files.find(f => `server/${f.f}` === c.where)?.code ?? '';
    if (design.offchain.some(d => declares(d, c, design, codeText))) continue;
    const at = `${c.where}:${c.line}`;
    const draft = {
      key: keyOf(`${c.takes?.replace(/^item:/, '') ?? ''} ${c.by.split('.').pop()}`, taken),
      name: `${readWords(c, design)[0].toUpperCase()}${readWords(c, design).slice(1)} into ${changeWords(c, design)}`,
      takes: c.takes ?? '<what the player holds or spends: a token key, or item:<key>>',
      gives: c.gives ?? '<what it gives: a token key, item:<key>, or farm:<key>>',
      says: `The server ${c.changes === 'entry' ? 'counts' : c.effect === 'bonus' ? 'adds a bonus from' : 'multiplies what it pays by'} ${c.by} (${at}), from ${c.reads.map(r => `${r.what} (${r.where}:${r.line})`).join(', ')}.`,
    };
    const ready = Boolean(c.takes && c.gives);
    offchain.push({ from: at, ready, rate: null, declaration: draft });
    const via = c.reads.map(r => `${r.what} at ${r.where}:${r.line}`).join(', ');
    add(
      'code-undeclared',
      'medium',
      c.route ?? c.where,
      `${at} appears to turn ${readWords(c, design)} into ${changeWords(c, design)} (\`${c.code}\`; it reads ${via}${c.grants.length ? `; it feeds ${c.grants.map(k => `grant:${k}`).join(', ')}` : ''}), and the spec declares nothing of it in "offchain": the economy model can't see it, so any loop through it is invisible to the check.`,
      `Confirm with the person what it does, then add it to "offchain" (its draft is in review.md, "Design and code") and run the economy check again${ready ? '' : `; the draft leaves ${[!c.takes && 'takes', !c.gives && 'gives'].filter(Boolean).join(' and ')} for you to fill`}.`,
      { where: at, draft },
    );
    tell.push(
      `${at} ${ready ? 'turns' : 'appears to turn'} ${readWords(c, design)} into ${changeWords(c, design)}; the economy model doesn't see it until it's declared.`,
    );
    if (!ready)
      ask.push(
        `What does ${c.where} take for ${c.by} (it appears to read ${c.reads[0].what} at ${c.reads[0].where}:${c.reads[0].line}), and what does it give more of?`,
      );
  }

  // bound-undeclared: a grant whose bound lives on its server, with no serverLimit
  const serverLimit = [];
  for (const g of design.grants) {
    if (g.serverLimit) continue;
    const rec = ledger.find(r => r.grant === g.key);
    if (!['bounds', 'replays'].includes(g.trust) && rec?.source !== 'env') continue;
    const found = bounds.filter(b => b.grant === g.key);
    const best = found.find(b => b.value !== null && b.every) ?? found[0] ?? null;
    const identity = best?.per ?? (rec?.identity === 'wallet' ? 'wallet' : 'person');
    const per = best?.per === 'all' ? 'all players together' : `one ${identity === 'wallet' ? 'wallet' : 'person'}`;
    const window = { '1m': 'minute', '1h': 'hour', '1d': 'day', '7d': 'week' }[best?.every] ?? 'hour or day';
    const aWindow = `${best?.every === '1h' ? 'an' : 'a'} ${window}`;
    const seen = best
      ? `it appears to be ${best.value ?? best.name}${best.value !== null && !/^\d/.test(best.name) ? ` (${best.name})` : ''}${best.unit === 'claims' ? ' claims' : ''} in ${best.where}:${best.line}`
      : 'this review found no such cap where it is paid';
    ask.push(`How much does your server let ${per} take from ${quote(g.name)} per ${window}? (${seen})`);
    if (best?.amount !== null && best?.amount !== undefined && best.every)
      serverLimit.push({
        grant: g.key,
        from: `${best.where}:${best.line}`,
        [SERVER_LIMIT.field]: SERVER_LIMIT.make({
          per: best.per,
          amount: best.amount,
          every: best.every === SERVER_LIMIT.every ? null : best.every,
        }),
      });
    add(
      'bound-undeclared',
      'low',
      `grant:${g.key}`,
      `${quote(g.name)} is paid on a check that ${{ bounds: 'bounds the result (trust "bounds")', replays: 'replays the result (trust "replays")' }[g.trust] ?? 'reads state the server keeps'}, so its real limit lives on the server, and the grant declares none (${SERVER_LIMIT.field}): the economy check computes with the chain's caps (${
        Object.entries(g.limits)
          .filter(([, v]) => typeof v === 'number' && v > 0)
          .map(([k, v]) => `${k} ${v}`)
          .join(', ') || 'none'
      }), which only bound a leaked voucher key. ${best ? `The server appears to cap it at ${best.value ?? best.name}${best.unit === 'claims' ? ' claims' : ''}${best.every ? ` ${aWindow}` : ''} (\`${best.code}\`, ${best.where}:${best.line}).` : 'This review found no cap a window where it is paid.'}`,
      `Ask the person what the server lets one identity take a window, then declare it on the grant: "${SERVER_LIMIT.field}": ${JSON.stringify(SERVER_LIMIT.make({ per: 'person', amount: 0, every: '1h' })).replace('0', '<n>')}.`,
    );
  }

  return {
    design: {
      offchain: design.offchain.map(d => d.key),
      grants: design.grants.map(g => ({ key: g.key, trust: g.trust, [SERVER_LIMIT.field]: g.serverLimit })),
    },
    conversions,
    bounds,
    unbuilt,
    findings,
    drafts: { offchain, serverLimit },
    ask,
    tell,
  };
}

// ---- The drafts, checked by the kit -------------------------------------------------------------------------------

/** What the installed kit's schema takes: the offchain list, a grant's serverLimit. */
export function kitTakes(env = process.env) {
  const root = solanaRoot(env);
  let schema = null;
  try {
    schema = JSON.parse(readFileSync(path.join(root ?? '', 'js', 'economy', 'schema.json'), 'utf8'));
  } catch {}
  return {
    version: root ? (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version ?? null) : null,
    offchain: Boolean(schema?.properties?.[OFFCHAIN]),
    serverLimit: Boolean(schema?.$defs?.grant?.properties?.[SERVER_LIMIT.field]),
  };
}

/** The check's answer, as lines to compare: its warnings, and its ask and tell lines. */
function checkLines(json) {
  const block = (head, mark) => {
    const lines = String(json?.text ?? '').split('\n');
    const at = lines.findIndex(l => head.test(l));
    const out = [];
    if (at >= 0)
      for (const l of lines.slice(at + 1)) {
        if (!l.startsWith(mark)) break;
        out.push(l.slice(mark.length).trim());
      }
    return out;
  };
  return {
    warnings: arr(json?.warnings).map(w => ({
      code: w.code ?? null,
      severity: w.severity ?? null,
      where: w.where ?? null,
      message: w.message ?? '',
    })),
    ask: block(/^Ask the person\b/, '? '),
    tell: block(/^Tell the person\b/, '> '),
    refusals: arr(json?.refusals).map(r => ({
      code: r.code ?? null,
      where: r.where ?? null,
      message: r.message ?? '',
    })),
  };
}

/**
 * The drafts added to a temporary copy of the spec, and the kit's check run on it and on the spec as it is (both in the
 * same temporary folder, so only the drafts differ). The real spec is never touched. → {ran: false, why} or {ran: true,
 * version, added, left, only, gone, refused}
 */
export async function draftsChecked(file, spec, drafts, { env = process.env } = {}) {
  const takes = kitTakes(env);
  const xsolana = solanaCommand(env);
  if (!xsolana) return { ran: false, why: 'the economy tools (@xgamesfun/solana) are not installed here' };
  const left = [];
  const offchain = [];
  for (const d of drafts.offchain)
    if (!takes.offchain)
      left.push({ draft: d.declaration.key, why: `@xgamesfun/solana ${takes.version} takes no "offchain"` });
    else if (!d.ready) left.push({ draft: d.declaration.key, why: 'what it takes or gives is not read from the code' });
    else offchain.push(d.declaration);
  const limits = [];
  for (const d of drafts.serverLimit)
    if (!takes.serverLimit)
      left.push({
        draft: `grant:${d.grant}`,
        why: `@xgamesfun/solana ${takes.version} takes no "${SERVER_LIMIT.field}" (a later kit reads it)`,
      });
    else limits.push(d);
  if (!offchain.length && !limits.length)
    return {
      ran: false,
      version: takes.version,
      why: drafts.offchain.length + drafts.serverLimit.length ? 'no draft the installed kit takes' : 'nothing drafted',
      left,
    };
  const drafted = structuredClone(spec);
  if (offchain.length) drafted[OFFCHAIN] = [...arr(drafted[OFFCHAIN]), ...offchain];
  for (const d of limits) {
    const g = arr(drafted.grants).find(x => x.key === d.grant);
    if (g) g[SERVER_LIMIT.field] = d[SERVER_LIMIT.field];
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'xcore-design-code-'));
  try {
    const name = path.basename(file);
    const run = async (sub, value) => {
      await writeFile(path.join(dir, `${sub}-${name}`), JSON.stringify(value, null, 2));
      const r = spawnSync(xsolana[0], [xsolana[1], 'check', `${sub}-${name}`, '--json'], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 60_000,
        env,
      });
      try {
        return JSON.parse(r.stdout);
      } catch {
        return null;
      }
    };
    const before = await run('as-is', spec);
    const after = await run('drafted', drafted);
    if (!before || !after) return { ran: false, version: takes.version, why: 'xsolana check gave no JSON', left };
    const a = checkLines(before);
    const b = checkLines(after);
    const key = w => `${w.code} ${w.message}`;
    const diff = (x, y, k = v => v) => x.filter(v => !y.some(w => k(w) === k(v)));
    return {
      ran: true,
      version: takes.version,
      added: { offchain: offchain.map(d => d.key), [SERVER_LIMIT.field]: limits.map(d => d.grant) },
      left,
      only: { warnings: diff(b.warnings, a.warnings, key), ask: diff(b.ask, a.ask), tell: diff(b.tell, a.tell) },
      gone: { warnings: diff(a.warnings, b.warnings, key), ask: diff(a.ask, b.ask), tell: diff(a.tell, b.tell) },
      refused: diff(b.refusals, a.refusals, key),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---- The record -----------------------------------------------------------------------------------------------------

/** One line for the command. */
export function designCodeLine(dc) {
  if (!dc) return 'design and code: no economy';
  const undeclared = dc.findings.filter(f => f.id === 'code-undeclared').length;
  const bounds = dc.findings.filter(f => f.id === 'bound-undeclared').length;
  const w = dc.withDrafts;
  const loops = w?.ran ? w.only.warnings.length : 0;
  return `design and code: ${dc.conversions.length} conversion${dc.conversions.length === 1 ? '' : 's'} in server/ (${undeclared} undeclared), ${dc.design.offchain.length} declared offchain (${dc.unbuilt.length} unbuilt), ${bounds} grant${bounds === 1 ? '' : 's'} with a server bound undeclared; ${w?.ran ? `with the drafts, the economy check reports ${loops} new finding${loops === 1 ? '' : 's'}` : `drafts not checked (${w?.why ?? 'nothing drafted'})`}`;
}

/** review.md's "Design and code" section. */
export function designCodeMarkdown(dc) {
  const lines = ['## Design and code', ''];
  if (!dc) return [...lines, 'This game has no economy: nothing to compare.', ''];
  const cell = v =>
    String(v ?? '')
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ');
  lines.push(
    'What the economy spec says the server does off chain ("offchain", and each voucher grant\'s "serverLimit"), against what server/ does. The economy check follows value only through the spec: a conversion or a bound that lives only in code is invisible to it.',
    '',
    `- Declared: ${dc.design.offchain.length ? dc.design.offchain.map(k => `offchain \`${k}\``).join(', ') : 'no offchain'}; ${dc.design.grants.filter(g => g[SERVER_LIMIT.field]).length} of ${dc.design.grants.length} voucher grants with a ${SERVER_LIMIT.field}.`,
    '',
    '### What the server converts',
    '',
  );
  if (!dc.conversions.length)
    lines.push('No multiplier, bonus or entry found that reads what a player holds or did.', '');
  else {
    lines.push(
      '| Where | What it reads | What it changes | Feeds | Route | Declared |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const c of dc.conversions) {
      const undeclared = dc.findings.some(f => f.id === 'code-undeclared' && f.where === `${c.where}:${c.line}`);
      lines.push(
        `| ${c.where}:${c.line} \`${cell(c.code)}\` | ${cell(c.reads.map(r => `${r.what} (${r.where}:${r.line})`).join(', '))}${c.takes ? `: ${c.takes}` : ''} | ${c.effect} \`${cell(c.by)}\`${c.factor ? ` ×${c.factor}` : ''} on ${c.changes}${c.gives ? ` (${c.gives})` : ''} | ${c.grants.map(k => `grant:${k}`).join(', ') || 'not read'} | ${c.route ? `\`${c.route}\`` : 'not read'} | ${undeclared ? 'no' : 'yes'} |`,
      );
    }
    lines.push('');
  }
  lines.push('### What the server bounds', '');
  if (!dc.bounds.length) lines.push('No cap a window found where a grant is paid.', '');
  else {
    lines.push('| Grant | Where | Cap | Window | Counts | Declared |', '| --- | --- | --- | --- | --- | --- |');
    for (const b of dc.bounds) {
      const declared = dc.design.grants.find(g => g.key === b.grant)?.[SERVER_LIMIT.field];
      lines.push(
        `| \`${b.grant}\` | ${b.where}:${b.line} \`${cell(b.code)}\` | ${b.value ?? 'not read'} (\`${cell(b.name)}\`, ${b.unit}) | ${b.every ?? 'not read'} | ${b.per} | ${declared ? `\`${cell(JSON.stringify(declared))}\`` : 'no'} |`,
      );
    }
    lines.push('');
  }
  const own = dc.findings;
  lines.push('### Findings', '');
  if (!own.length) lines.push('None: the design and the code agree, as far as this reading sees.', '');
  for (const f of own) lines.push(`- **${f.id}** (${f.severity}${f.route ? `, ${f.route}` : ''}): ${f.message}`);
  if (own.length) lines.push('');
  const { offchain, serverLimit } = dc.drafts;
  lines.push('### Suggested declarations', '');
  if (!offchain.length && !serverLimit.length) lines.push('Nothing to draft.', '');
  else {
    lines.push(
      `**${DRAFTED[0].toUpperCase()}${DRAFTED.slice(1)}.** Nothing here is in xsolana.json until you add it.`,
      '',
    );
    for (const d of offchain)
      lines.push(
        `- offchain \`${d.declaration.key}\`, from ${d.from}${d.ready ? '' : ' (fill in what the code does not say)'}; no "rate" is read from the code: the kit counts 1 for each one taken until it is set.`,
      );
    for (const d of serverLimit) lines.push(`- grant \`${d.grant}\`'s ${SERVER_LIMIT.field}, from ${d.from}.`);
    lines.push('', '```json');
    const block = {
      ...(offchain.length ? { [OFFCHAIN]: offchain.map(d => d.declaration) } : {}),
      ...(serverLimit.length
        ? { grants: serverLimit.map(d => ({ key: d.grant, [SERVER_LIMIT.field]: d[SERVER_LIMIT.field] })) }
        : {}),
    };
    lines.push(JSON.stringify(block, null, 2), '```', '');
  }
  lines.push('### The economy check, with the drafts', '');
  const w = dc.withDrafts;
  if (!w?.ran) lines.push(`Not run: ${w?.why ?? 'nothing drafted'}.`, '');
  else {
    const added = [
      ...w.added.offchain.map(k => `offchain \`${k}\``),
      ...w.added[SERVER_LIMIT.field].map(k => `\`${k}\`'s ${SERVER_LIMIT.field}`),
    ];
    lines.push(
      `@xgamesfun/solana ${w.version}'s check, on a temporary copy of the spec with ${added.join(', ')} added (the spec itself untouched).`,
      '',
    );
    const only = [
      ...w.only.warnings.map(x => `${x.code}${x.severity ? ` (${x.severity})` : ''}: ${x.message}`),
      ...w.only.tell.map(t => `Tell: ${t}`),
      ...w.only.ask.map(t => `Ask: ${t}`),
    ];
    const gone = [...w.gone.warnings.map(x => `${x.code}: ${x.message}`), ...w.gone.ask.map(t => `Ask: ${t}`)];
    lines.push(
      only.length
        ? 'Only with the drafts, the economy check now reports:'
        : 'The drafts change nothing the economy check reports.',
      '',
    );
    for (const x of only) lines.push(`- ${x}`);
    if (only.length) lines.push('');
    if (gone.length) {
      lines.push('Gone with the drafts:', '');
      for (const x of gone) lines.push(`- ${x}`);
      lines.push('');
    }
    if (w.refused.length) {
      lines.push('The drafts do not check yet:', '');
      for (const r of w.refused) lines.push(`- ${r.code}: ${r.message}`);
      lines.push('');
    }
  }
  for (const l of w?.left ?? []) lines.push(`- Left out of the check: ${l.draft}: ${l.why}.`);
  if (w?.left?.length) lines.push('');
  return lines;
}
