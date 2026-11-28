// Stored input: state the payout reads that another route of the game's own server writes from a request. A run the
// server "started" is no state the server keeps when the route that starts it stores what the page sent (its start time,
// its player, its score): the payout then trusts the player's word, one request removed. So each table (D1 SQL), KV
// namespace and Durable Object PAY.check reads is looked for among the writes in server/, and a write whose stored
// values come from the request (request.json(), a form, the URL's query, and any name given one of those) makes that
// read player input. A value that only picks the row (a WHERE, a KV key) is stored nowhere, and a column the check never
// reads decides nothing. A write the reading can't place in a function is said as not read: the verdict is INCONCLUSIVE.
import { around, classAt, closing, codeOnly, definitions, expressionEnd, parts } from './code.mjs';

const lineAt = (text, i) => text.slice(0, i).split('\n').length;
const word = n => new RegExp(`(?<![\\w$.])${n.replace(/\$/g, '\\$')}(?![\\w$])`);

/**
 * What a check reads: the tables its SQL names, the KV namespaces and Durable Objects it gets from, and the columns it
 * uses (its SELECT lists and the fields it reads off what they answer; `star` when it selects every column).
 */
export function payoutReads(texts) {
  const text = texts.join('\n');
  const columns = new Set();
  let star = false;
  for (const m of text.matchAll(/\bSELECT\s+([\s\S]*?)\s+FROM\b/gi))
    for (const c of m[1].split(',')) {
      const col = c.trim().split(/\s+/)[0].split('.').at(-1).toLowerCase();
      if (col === '*') star = true;
      else if (/^\w+$/.test(col)) columns.add(col);
    }
  for (const m of codeOnly(text).matchAll(/\??\.\s*([A-Za-z_]\w*)/g)) columns.add(m[1].toLowerCase());
  return {
    tables: new Set([...text.matchAll(/\b(?:FROM|JOIN)\s+["`]?([A-Za-z_]\w*)/gi)].map(m => m[1].toLowerCase())),
    spaces: new Set(
      [...text.matchAll(/\benv\s*\.\s*([A-Z][A-Z0-9_]*)\s*\.\s*get(?:WithMetadata|ByName)?\s*\(/g)].map(m => m[1]),
    ),
    columns,
    star,
  };
}

/** The writes in one server file: SQL that writes a table, and a KV put. → [{kind, name, at}] */
function writesIn(code) {
  const out = [];
  for (const m of code.matchAll(/\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE)\s+["`]?([A-Za-z_]\w*)/gi))
    out.push({ kind: 'table', name: m[1].toLowerCase(), at: m.index });
  for (const m of code.matchAll(/\benv\s*\.\s*([A-Z][A-Z0-9_]*)\s*\.\s*put\s*\(/g))
    out.push({ kind: 'space', name: m[1], at: m.index });
  return out;
}

/** Calls that give back who is asking (the sign-in), never what the request says. */
const SIGN_IN = /(?<![\w$])(?:verifyPlayer|withPlayer|walletOf)\s*\(/;

/**
 * The names in a function that hold what the request sent: its body, a form, the URL's query, and every name given a
 * value made of one of those (`const best = Math.floor(Number(b.score))`), never the sign-in a token gives.
 */
function requestNames(fn) {
  const names = new Set();
  const params = fn.params ?? '';
  for (const n of ['request', 'req', 'body']) if (new RegExp(`\\b${n}\\b`).test(params)) names.add(n);
  const body = fn.body;
  // const b = await request.json(); const { runId, startedAt } = await req.json(); const q = url.searchParams
  for (const m of body.matchAll(
    /\b(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:[A-Za-z_$][\w$]*\s*\.\s*(?:json|text|formData)\s*\(|new\s+URL\s*\([^)]*\)\s*\.\s*searchParams|[A-Za-z_$][\w$]*\s*\.\s*searchParams)/g,
  ))
    for (const n of m[1].match(/[A-Za-z_$][\w$]*/g) ?? []) names.add(n);
  // what the request's own values are copied into, until no more are found. The request itself (request, req) passes
  // on only what it is read for: its URL, its headers and the token in them say who is asking and where, not a value.
  const carries = text =>
    !SIGN_IN.test(text) &&
    [...names].some(n =>
      n === 'request' || n === 'req'
        ? new RegExp(`(?<![\\w$.])${n}\\s*\\.\\s*(?:json|text|formData)\\s*\\(`).test(text)
        : word(n).test(text),
    );
  for (let more = true; more;) {
    more = false;
    for (const m of body.matchAll(/\b(?:const|let|var)\s+(\{[^}]*\}|\[[^\]]*\]|[A-Za-z_$][\w$]*)\s*=(?![=>])/g)) {
      const from = m.index + m[0].length;
      if (!carries(body.slice(from, expressionEnd(body, from)))) continue;
      for (const n of m[1].replace(/:\s*/g, ' ').match(/[A-Za-z_$][\w$]*/g) ?? [])
        if (!names.has(n)) {
          names.add(n);
          more = true;
        }
    }
  }
  return names;
}

/** The request's names that a piece of code holds. */
const fromIn = (names, text) =>
  [...names].filter(n =>
    n === 'request' || n === 'req'
      ? new RegExp(`(?<![\\w$.])${n}\\s*\\.\\s*(?:json|text|formData|url)\\b`).test(text) ||
        /searchParams|headers\s*\.\s*get/.test(text)
      : word(n).test(text),
  );

/**
 * The values a SQL write stores, with the columns they go in: [{column (or null when it can't be told), value: text}],
 * or null when the statement can't be read this way (the caller then reads the whole statement). The SQL is the string
 * the write is in; its values are the call's arguments after it (db.run(sql, …)), or a .bind(…) after it. A `?` before
 * an UPDATE's WHERE, or in an INSERT's VALUES or its ON CONFLICT … SET, is stored; one in a WHERE only picks the row.
 */
function storedValues(code, bare, at) {
  const quote = Math.max(bare.lastIndexOf("'", at), bare.lastIndexOf('"', at), bare.lastIndexOf('`', at));
  if (quote < 0) return null;
  const end = bare.indexOf(bare[quote], at);
  if (end < 0) return null;
  const sql = code.slice(quote + 1, end);
  // a value written into the SQL itself (`${…}`) is stored as it is
  const inline = [...sql.matchAll(/\$\{([^}]*)\}/g)].map(m => ({ column: null, value: m[1] }));
  // the call the SQL is handed to, and the values after it
  let open = -1;
  for (let i = quote - 1, depth = 0; i >= 0; i--) {
    if (bare[i] === ')') depth++;
    else if (bare[i] === '(' && depth-- === 0) {
      open = i;
      break;
    }
  }
  let args = [];
  const close = open < 0 ? -1 : closing(bare, open);
  if (close > end) args = parts(bare, open + 1, close).slice(1);
  const bind = /^\s*\)\s*\.\s*bind\s*\(/.exec(bare.slice(close < 0 ? end + 1 : close));
  if (bind) {
    const b = (close < 0 ? end + 1 : close) + bind[0].length - 1;
    args = parts(bare, b + 1, closing(bare, b));
  }
  // each `?` in order (or `?N`, by its number), and the column it goes in
  const marks = [...sql.matchAll(/\?(\d*)/g)].map((m, i) => ({ at: m.index, n: m[1] ? Number(m[1]) - 1 : i }));
  if (!marks.length) return inline.length ? inline : null;
  const where = /\bWHERE\b/i.exec(sql)?.index ?? sql.length;
  const insert = /\b(?:INSERT|REPLACE)\b/i.test(sql);
  const cols = insert
    ? /\(\s*([^)]*)\)\s*VALUES\s*\(/i
        .exec(sql)?.[1]
        .split(',')
        .map(c => c.trim().toLowerCase())
    : null;
  const valuesAt = insert ? (/\bVALUES\s*\(/i.exec(sql)?.index ?? -1) : -1;
  const out = [...inline];
  let place = 0;
  for (const mark of marks) {
    const inValues =
      insert && valuesAt >= 0 && mark.at > valuesAt && mark.at < (/\bON\s+CONFLICT\b/i.exec(sql)?.index ?? sql.length);
    const stored = insert ? inValues || mark.at < where : mark.at < where;
    if (!stored || !args[mark.n]) {
      if (inValues) place++;
      continue;
    }
    // the column: an INSERT's by place, a SET's by its name (`col = ?`)
    const set = /([A-Za-z_]\w*)\s*=\s*$/.exec(sql.slice(0, mark.at))?.[1]?.toLowerCase();
    const column = inValues ? (cols?.[place] ?? null) : (set ?? null);
    if (inValues) place++;
    const [a, b] = args[mark.n];
    out.push({ column, value: code.slice(a, b) });
  }
  return out;
}

/** Durable Object methods that write their storage: their names, from every file. */
function objectWriters(read) {
  const out = new Set();
  for (const { code } of read) {
    const bare = codeOnly(code);
    for (const d of definitions(bare))
      if (classAt(bare, d.start) && /\bstorage\s*\.\s*(?:put|sql\s*\.\s*exec|transaction)\s*\(/.test(d.body))
        out.add(d.name);
  }
  return out;
}

/**
 * The writes, in the game's server files, to what the payout reads. → {tainted: [{name, kind, where, from}], unknown:
 * [{name, where}]}: a write that stores what the request sent, and one outside any function the reading finds.
 */
export function storedInput(read, reads) {
  const tainted = [],
    unknown = [];
  // a column the check reads (or one that can't be told, or every column)
  const used = col => col === null || reads.star || !reads.columns || reads.columns.has(col);
  const writers = objectWriters(read);
  for (const { f, code } of read) {
    const bare = codeOnly(code);
    for (const w of writesIn(code)) {
      if (!(w.kind === 'table' ? reads.tables : reads.spaces).has(w.name)) continue;
      const where = `server/${f}:${lineAt(code, w.at)}`;
      const fn = around(bare, w.at);
      if (!fn) {
        unknown.push({ name: w.name, kind: w.kind, where });
        continue;
      }
      const names = requestNames(fn);
      let from;
      if (w.kind === 'table') {
        const values = storedValues(code, bare, w.at);
        from = values ? [...new Set(values.filter(v => used(v.column)).flatMap(v => fromIn(names, v.value)))] : null;
      } else {
        // a KV put stores its second argument; the key only names where
        const open = bare.indexOf('(', w.at);
        const args = parts(bare, open + 1, closing(bare, open));
        from = args.length > 1 ? fromIn(names, code.slice(args[1][0], args[1][1])) : null;
      }
      if (from === null) {
        // the statement the write is part of: up to its end (a `;`, or the function's)
        const end = bare.indexOf(';', w.at);
        from = fromIn(names, bare.slice(w.at, end < 0 ? fn.start + fn.body.length : end));
      }
      if (from.length) tainted.push({ name: w.name, kind: w.kind, where, from });
    }
    // a Durable Object the check reads, given what the request sent by a method of its that writes its storage
    for (const m of bare.matchAll(
      /\benv\s*\.\s*([A-Z][A-Z0-9_]*)\s*\.\s*get(?:ByName)?\s*\((?:[^()]|\([^()]*\))*\)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g,
    )) {
      if (!reads.spaces.has(m[1]) || !writers.has(m[2])) continue;
      const open = m.index + m[0].length - 1;
      const fn = around(bare, m.index);
      if (!fn) continue;
      const from = fromIn(requestNames(fn), code.slice(open, closing(bare, open) + 1));
      if (from.length)
        tainted.push({ name: m[1], kind: 'object', where: `server/${f}:${lineAt(code, m.index)}`, from });
    }
  }
  return { tainted, unknown };
}
