// Reading the code: the game's own server files as the pass reads them, the reads of what a player holds or did, the
// bodies that pay each grant and the functions they call. What ./conversions.mjs and ./bounds.mjs build on.
import { braced, definitions, withoutStrings, wordsOfName } from '../review/code.mjs';
import { XCORE_PARTS } from '../review/token.mjs';
import { lineAt, lineText, num, serverPath } from './design.mjs';

export const spaced = s => ` ${wordsOfName(s).join(' ')} `;
/** The spec's tokens and items `text` names (a key, symbol or name as whole words, a plural too, or a mint), first first. */
export function assetsNamed(text, design) {
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
export function ownFiles(read) {
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
      // and the game's own functions in the file that PAY calls, a few calls deep (a cap kept in `takeSlot`)
      const keep = [[start, start + block.length]];
      const defs = definitions(code).filter(
        d => d.name && d.body.length > 2 && (d.start < start || d.start >= start + block.length),
      );
      const kept = new Set();
      for (let depth = 0, grew = true; grew && depth < 3; depth++) {
        grew = false;
        const reach = withoutStrings(keep.map(([a, b]) => code.slice(a, b)).join('\n'));
        for (const d of defs) {
          if (kept.has(d) || !new RegExp(`(?<![\\w$])${d.name.replace(/\$/g, '\\$')}\\s*\\(`).test(reach)) continue;
          kept.add(d);
          keep.push([code.lastIndexOf('\n', d.start) + 1, d.start + d.body.length]); // from its line: its name too
          grew = true;
        }
      }
      keep.sort((a, b) => a[0] - b[0]);
      let shown = '',
        at = 0;
      for (const [a, b] of keep) {
        if (b <= at) continue;
        shown += blank(code.slice(at, Math.max(at, a))) + code.slice(Math.max(at, a), b);
        at = b;
      }
      shown += blank(code.slice(at));
      out.push({
        f,
        text,
        code: shown,
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
export function around(file, at) {
  let best = null;
  for (const d of file.defs)
    if (d.start <= at && at < d.start + d.body.length && (!best || d.body.length < best.body.length)) best = d;
  return best ?? { name: null, start: 0, body: file.code };
}

/** What a player holds or did, read by the server: each kind and how to spot it on a line (strings kept). */
const READS = [
  // the kit's helpers (collectiblesOf through an object too, `deps.collectiblesOf(…)`), and the chain's own reads of
  // what an owner has (an RPC call or a DAS query written by hand)
  [
    'holds',
    'what a wallet holds',
    /(?<![\w$.])holds\s*\(|(?<![\w$])collectiblesOf\s*\(|\b(?:getProgramAccounts|getAssetsByOwner|searchAssets)\b/,
  ],
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
export const NOUNS = {
  holds: 'what a wallet holds',
  balance: 'a balance or count the server keeps for the player',
  stake: 'a stake',
  code: 'a code',
  save: "what the player's save or score holds",
};
export const byKind = (a, b) => Object.keys(NOUNS).indexOf(a.kind) - Object.keys(NOUNS).indexOf(b.kind);
const CODE_WORD = /\b(?:codes?|promo\w*|coupons?|redeem\w*)\b|\w(?:Code|Promo|Coupon)s?\b/;
const LOOKUP = /(?:\.get|prepare|\.first|\.find|\.has|digest|sha256|hash\w*)\s*\(|\[[^\]]*\]/;

/** The reads in [from, to) of a file: [{kind, what, where, line, at, asset}]. */
export function readsIn(file, from, to, design) {
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
      out.push({ kind, what, where: serverPath(file.f), line: i + 1, at: start, asset, named: assetsNamed(l, design) });
      break;
    }
  }
  return out;
}

/** Reads once each (a function found twice by definitions(): as a function and as a method shape). */
export const dedupe = reads =>
  reads.filter((r, i) => reads.findIndex(x => x.where === r.where && x.line === r.line) === i);

/** Words that mark a multiplier or bonus, an entry, a value earned, and a per-identity bound. */
export const EFFECT = new Set([
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
  'factor',
]);
export const ENTRY = new Set([
  'entry',
  'entries',
  'ticket',
  'tickets',
  'eligible',
  'eligibility',
  'qualifies',
  'qualified',
]);
export const EARNED = new Set([
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
  // what a server banks for a later claim
  'banked',
  'credited',
]);
export const PAYOUT = new Set([
  'banked',
  'credited',
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
export const BOUND = new Set([
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
export const CHAIN = /(?:[A-Za-z_$][\w$]*\s*\??\.\s*)*[A-Za-z_$][\w$]*/g;
export const hasWord = (set, s) => wordsOfName(s).some(w => set.has(w));

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

/**
 * Is the expression at [at, end) applied to something, not counted up itself: an operand of * or +, or a function of
 * the effect's own name called to give it (`creditBonus(code, 300)`, `await harvestMultiplier(player)`)?
 */
export function applied(bare, at, end) {
  if (/^\s*(?:\?\.\s*)?\(/.test(bare.slice(end, end + 4))) return true;
  const before = bare
    .slice(Math.max(0, at - 40), at)
    .replace(/(?:await\s+|\(\s*)+$/, '')
    .trimEnd();
  if (/(?<![+*])[*+]=?$/.test(before) && !/\+\+$/.test(before)) return true;
  const after = bare.slice(pastCall(bare, end), pastCall(bare, end) + 4).replace(/^\s*\)?\s*/, '');
  if (/^[*+](?![+=])/.test(after)) return true;
  // a branch of a ternary whose other branch changes nothing, the whole applied: `n * (boosted ? BOOST : 1)`,
  // `(golden ? BONUS : 0) + n`
  const other = /^\s*:\s*([01])\b/.exec(bare.slice(pastCall(bare, end)));
  if (!/\?$/.test(before) || !other) return false;
  const op = other[1] === '1' ? '*' : '+';
  for (let i = at - 1, depth = 0; i >= Math.max(0, at - 300); i--) {
    const ch = bare[i];
    if (ch === ')') depth++;
    else if (ch === '(' && depth-- === 0) {
      const outside = bare.slice(Math.max(0, i - 40), i).trimEnd();
      const next = bare.slice(pastCall(bare, i), pastCall(bare, i) + 4).trimStart();
      return (outside.endsWith(op) && !outside.endsWith(op + op)) || (next.startsWith(op) && !/^[*+][*+=]/.test(next));
    } else if (ch === ';' || ch === '{' || ch === '}') return false;
  }
  return false;
}
/** `const got = <chain> …` whose local is then added to or multiplied in its function: → the local's name, or null. */
export function localApplied(file, at) {
  const from = file.bare.lastIndexOf('\n', at) + 1;
  // the whole value, or a branch of it (`const times = boosted(me) ? BOOST_TIMES : 1`)
  const decl = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[^;=?]*\?\s*)?$/.exec(file.bare.slice(from, at));
  if (!decl) return null;
  const fn = around(file, at);
  const rest = withoutStrings(fn.body).slice(Math.max(0, at - fn.start));
  const n = decl[1].replace(/\$/g, '\\$');
  return new RegExp(`[*+]=?\\s*${n}(?![\\w$])|(?<![\\w$.])${n}\\s*[*+](?![+=])`).test(rest) ? decl[1] : null;
}

/** Does the statement on this line make a value (an assignment, a property, a return), not only test one? */
export const makes = l => /(?<![=!<>])=(?![=>])|\breturn\b|[\w$\])]\s*:(?!:)/.test(l);
/** Is `at` inside an if's or a while's condition (a value tested, not made)? */
export function inCondition(bare, at) {
  const from = bare.lastIndexOf('\n', at) + 1;
  for (const m of bare.slice(from, at).matchAll(/\b(?:if|while)\s*\(/g)) {
    const open = from + m.index + m[0].length - 1;
    if (pastCall(bare, open) > at) return true;
  }
  return false;
}
export const assigned = (bare, end) => /^\s*(?:[+*]?=(?!=)|:)/.test(bare.slice(end, end + 4));

/** A name's numeric value where the code sets it: `const BOOST = 1.5`, `boost: 2`. → number or null */
export function valueOf(files, name) {
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
export function factorIn(calls) {
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
export function payingBodies(files, design) {
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

/** Where a body calls a function by its name: → [index]. */
export function callSites(body, name) {
  if (!name) return [];
  const re = new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}\\s*(?:\\?\\.\\s*)?\\(`, 'g');
  return [...withoutStrings(body).matchAll(re)].map(m => m.index);
}

/**
 * The grants the code at `at` pays: those named in the innermost block around it that names any (a branch of PAY.check
 * returning {grant: 'pops'}), else all the body's. → [grant]
 */
export function grantsAt(body, at, design, all) {
  const bare = withoutStrings(body);
  for (let open = at, depth = 0; open >= 0; open--) {
    const c = bare[open];
    if (c === '}') depth++;
    else if (c === '{' && depth-- === 0) {
      depth = 0;
      let close = open,
        d = 0;
      for (; close < bare.length; close++) {
        if (bare[close] === '{') d++;
        else if (bare[close] === '}' && --d === 0) break;
      }
      const named = grantsIn(body.slice(open, close + 1), design).filter(g => all.includes(g));
      // what the block goes on to pay after it (a branch that returned earlier is not this one's)
      const after = grantsIn(body.slice(at, close + 1), design).filter(g => all.includes(g));
      if (after.length) return after;
      if (named.length) return named;
    }
  }
  return all;
}

/** The functions of the game's own beneath a body, level by level (`depth` levels): [[{file, def}], …]. */
export function levelsBeneath(body, files, depth = 3) {
  const levels = [];
  const seen = new Set();
  let bodies = [body];
  for (let d = 0; d < depth && bodies.length; d++) {
    const level = bodies.flatMap(b => calledFrom(b, files)).filter(x => !seen.has(x.def) && seen.add(x.def));
    if (level.length) levels.push(level);
    bodies = level.map(x => x.def.body);
  }
  return levels;
}

/** The functions a body calls that the game's own code defines (one level): [{file, def}]. */
export function calledFrom(body, files) {
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
 * A paying body and what it calls, a few deep (PAY.check → payCheck → stub.takeClaim, where the claims a day are
 * counted), each with the grants of the branches that call it: `if (kind === 'pops') { … plan() … return {grant:
 * 'pops'} }`. → [{file, start, body, direct?, grants?, calls?}]
 */
export function scopesOf(p, files, design) {
  const scopes = [{ file: p.file, start: p.start, body: p.body, direct: true, grants: p.grants }];
  const seen = new Set();
  const walk = (body, grants, depth) => {
    if (depth > 3) return;
    for (const x of calledFrom(body, files)) {
      if (seen.has(x.def)) continue;
      seen.add(x.def);
      const sites = callSites(body, x.def.name);
      const own = sites.flatMap(at => grantsAt(body, at, design, grants));
      scopes.push({
        file: x.file,
        start: x.def.start,
        body: x.def.body,
        grants: own,
        calls: sites.map(at => lineText(body, lineAt(body, at))).join('\n'),
      });
      walk(x.def.body, own.length ? own : grants, depth + 1);
    }
  };
  walk(p.body, p.grants, 1);
  return scopes;
}
