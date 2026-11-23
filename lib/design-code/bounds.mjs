// The bounds in server code: the per-identity caps a window the server keeps on each grant it pays.
import { withoutStrings, wordsOfName } from '../review/code.mjs';
import { lineAt, lineText, num, SERVER_LIMIT, serverPath } from './design.mjs';
import {
  BOUND,
  calledFrom,
  callSites,
  CHAIN,
  grantsAt,
  hasWord,
  payingBodies,
  scopesOf,
  spaced,
  valueOf,
} from './reading.mjs';

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

/** Words that name a count of what was already given (the side a cap is compared on). */
const COUNTED = new Set([
  'n',
  'count',
  'counts',
  'size',
  'length',
  'total',
  'used',
  'given',
  'signed',
  'claimed',
  'paid',
  'sent',
  'issued',
  'taken',
]);

/** The grants a point in a scope pays: its own branch's in the paying body, else those of the branches that call it. */
function grantsOfScope(s, at, design, p) {
  const own = s.direct ? grantsAt(p.body, at, design, p.grants) : s.grants;
  return own.length ? [...new Set(own)] : p.grants;
}

/**
 * The bounds the server keeps on each grant it pays: in PAY (and what it calls) or around voucherFor / a report, a
 * comparison against a cap a window (`if (hour + amount > PER_HOUR)`, `Math.min(…, DAILY_CAP)`). → [{grant, where,
 * line, code, name, value, every, per, unit, amount}] (amount: in the prize's own units, or null when not read)
 */
export function boundsIn(files, design) {
  const out = [];
  for (const p of payingBodies(files, design)) {
    const scopes = scopesOf(p, files, design);
    for (const s of scopes) {
      const bare = withoutStrings(s.body);
      for (const m of bare.matchAll(CHAIN)) {
        const name = m[0].replace(/\s+/g, '');
        const words = wordsOfName(name);
        // (Math.max is no cap; a grant's own limits, read from the economy, are the chain's)
        if (words[0] === 'math' || /\b(?:ECONOMY|grants?)\b/.test(name)) continue;
        // PER_DAY, VOUCHERS_A_DAY, claimsAnHour: a count a window
        const windowed = (words.includes('per') || words.includes('a') || words.includes('an')) && windowIn(name);
        if (!hasWord(BOUND, name) && !windowed) continue;
        const at = s.start + m.index;
        const line = lineAt(s.file.code, at);
        const l = lineText(s.file.code, line);
        if (!/(?<![=>])[<>]=?(?!=)|Math\s*\.\s*min\s*\(/.test(withoutStrings(l))) continue;
        for (const g of grantsOfScope(s, m.index, design, p)) {
          if (out.some(b => b.grant === g.key && b.where === serverPath(s.file.f) && b.line === line)) continue;
          const value = valueOf(files, name) ?? num(/[<>]=?\s*([\d_]+(?:\.\d+)?)\b/.exec(l)?.[1]);
          const every = windowIn(name) ?? windowIn(l) ?? windowIn(s.body);
          const per = /player\s*\??\.\s*(?:sub|x|id)\b|\bperson\b/.test(`${s.body}\n${s.calls ?? ''}`)
            ? 'person'
            : /\bwallet\b/.test(s.body)
              ? 'wallet'
              : 'all';
          const claims = /\b(?:count|counts|claims|times|runs|plays|vouchers)\b|\+\+|\+\s*1\b/.test(
            `${spaced(l)} ${l}`,
          );
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
            where: serverPath(s.file.f),
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
    // a ranked cut: the check pays only a player found in the top N a function of the game's returns
    // (`const top = await topOf(env, month); if (!top.some(t => t.farmer === player.sub)) return {why}`), so at most
    // N are paid a window, held by the ranking's LIMIT rather than a comparison against a cap
    const bare = withoutStrings(p.body);
    for (const x of calledFrom(p.body, files)) {
      const cut = rankedCut(x, files);
      if (!cut) continue;
      for (const at of callSites(p.body, x.def.name)) {
        const line = lineAt(p.body, at);
        const held = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(lineText(p.body, line))?.[1];
        const member =
          held &&
          new RegExp(
            `(?<![\\w$])${held.replace(/\$/g, '\\$')}\\s*(?:\\?\\.\\s*)?\\.\\s*(?:some|find|findIndex|includes|indexOf|has)\\s*\\(`,
          );
        if (!member?.test(bare)) continue;
        const own = grantsAt(p.body, at, design, p.grants);
        const fileLine = lineAt(p.file.code, p.start + at);
        const window = `${x.def.name} ${spaced(x.def.name)} ${p.body}`;
        const every = /\bmonth(?:s|ly)?\b/i.test(spaced(window)) ? '30d' : windowIn(window);
        for (const g of own.length ? [...new Set(own)] : p.grants) {
          if (out.some(b => b.grant === g.key && b.where === serverPath(p.file.f) && b.line === fileLine)) continue;
          out.push({
            grant: g.key,
            where: serverPath(p.file.f),
            line: fileLine,
            code: lineText(p.file.text, fileLine),
            name: cut.name ?? x.def.name,
            value: cut.value,
            every,
            per: 'all',
            unit: 'claims',
            amount:
              cut.value === null
                ? null
                : g.prize?.unit === 'item'
                  ? cut.value
                  : g.prize?.amount
                    ? cut.value * g.prize.amount
                    : null,
          });
        }
      }
    }
    // a cap the code holds under no telling name: a refusal against the very number a grant declares
    // (`if (signed.n >= 10) return { why: … }` for serverLimit {amount: 10})
    for (const s of scopes) {
      const bare = withoutStrings(s.body);
      for (const m of bare.matchAll(
        /(?<![=>])[<>]=?(?!=)\s*([A-Za-z_$][\w$.]*|[\d_]+)\b|Math\s*\.\s*min\s*\([^)]*?([\d_]+)\s*\)/g,
      )) {
        const operand = m[1] ?? m[2];
        const value = /^[\d_]+$/.test(operand) ? num(operand) : valueOf(files, operand);
        const line = lineAt(s.file.code, s.start + m.index);
        const l = withoutStrings(lineText(s.file.code, line));
        const next = withoutStrings(lineText(s.file.code, line + 1));
        if (!/\breturn\b|\bthrow\b/.test(`${l} ${next}`)) continue;
        // and what it compares is a count of what was given (`signed.n`, `claims.length`), not a rank or a score
        const left = /([A-Za-z_$][\w$.]*)\s*$/.exec(bare.slice(0, m.index))?.[1] ?? '';
        if (!m[2] && !wordsOfName(left).some(w => COUNTED.has(w))) continue;
        for (const g of grantsOfScope(s, m.index, design, p)) {
          const limit = SERVER_LIMIT.of(g);
          if (!limit || num(limit.amount) !== value || out.some(b => b.grant === g.key)) continue;
          out.push({
            grant: g.key,
            where: serverPath(s.file.f),
            line,
            code: lineText(s.file.text, line),
            name: operand,
            value,
            every: windowIn(l) ?? windowIn(s.body),
            per: limit.per ?? null,
            unit: g.prize?.unit === 'item' ? 'claims' : 'amount',
            amount: value,
            matched: 'declared',
          });
        }
      }
    }
  }
  return out;
}

/**
 * The size of the ranking a function of the game's returns: an ordered query's LIMIT (`ORDER BY crops DESC LIMIT ?`,
 * the limit a parameter's default or a constant) or a sorted list's first N (`.sort(…).slice(0, TOP)`). → {value, name}
 * (value null when not read) or null when it returns no ranking
 */
function rankedCut(x, files) {
  const body = x.def.body;
  const sql = /\bORDER\s+BY\b[^`'";]*?\bLIMIT\s+(\d+|\?|\$\{\s*([A-Za-z_$][\w$.]*)\s*\})/i.exec(body);
  const sliced = /\.\s*sort\s*\([^]*?\)\s*\.\s*slice\s*\(\s*0\s*,\s*([A-Za-z_$][\w$.]*|\d+)\s*\)/.exec(
    withoutStrings(body),
  );
  if (!sql && !sliced) return null;
  let name = sql ? (sql[2] ?? (sql[1] === '?' ? null : sql[1])) : sliced[1];
  // `LIMIT ?` bound to a parameter: its default (`limit = TOP`)
  if (sql && sql[1] === '?') {
    const head = x.file.code.slice(Math.max(0, x.def.start - 300), x.def.start);
    const params = /\(([^()]*)\)\s*(?:=>\s*)?$/.exec(head.trimEnd())?.[1] ?? '';
    name = /\b\w+\s*=\s*([A-Za-z_$][\w$.]*|\d+)\s*$/.exec(params.split(',').find(s => /=/.test(s)) ?? '')?.[1] ?? null;
  }
  if (name === null) return { value: null, name: null };
  if (/^\d+$/.test(name)) return { value: num(name), name };
  return { value: valueOf(files, name), name };
}
