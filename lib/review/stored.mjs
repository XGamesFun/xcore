// Stored input: state the payout reads that another route of the game's own server writes from a request. A run the
// server "started" is no state the server keeps when the route that starts it stores what the page sent (its start time,
// its player, its score): the payout then trusts the player's word, one request removed. So each table (D1 SQL) and
// KV namespace PAY.check reads is looked for among the writes in server/, and a write whose values come from the
// request (request.json(), a form, the URL's query) makes that read player input. A write the reading can't place in a
// function is said as not read: the verdict is INCONCLUSIVE.
import { around, codeOnly } from './code.mjs';

const lineAt = (text, i) => text.slice(0, i).split('\n').length;

/** What a check reads: the tables its SQL names, and the KV namespaces it gets from. */
export function payoutReads(texts) {
  const text = texts.join('\n');
  return {
    tables: new Set([...text.matchAll(/\b(?:FROM|JOIN)\s+["`]?([A-Za-z_]\w*)/gi)].map(m => m[1].toLowerCase())),
    spaces: new Set(
      [...text.matchAll(/\benv\s*\.\s*([A-Z][A-Z0-9_]*)\s*\.\s*get(?:WithMetadata)?\s*\(/g)].map(m => m[1]),
    ),
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

/** The names in a function that hold what the request sent: its body, a form, the URL's query. */
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
  return names;
}

/**
 * The writes, in the game's server files, to what the payout reads. → {tainted: [{name, kind, where, from}], unknown:
 * [{name, where}]}: a write whose statement uses what the request sent, and one outside any function the reading finds.
 */
export function storedInput(read, reads) {
  const tainted = [],
    unknown = [];
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
      // the statement the write is part of: up to its end (a `;`, or the function's)
      const end = bare.indexOf(';', w.at);
      const statement = bare.slice(w.at, end < 0 ? fn.start + fn.body.length : end);
      const from = [...requestNames(fn)].filter(n =>
        new RegExp(`(?<![\\w$.])${n.replace(/\$/g, '\\$')}(?![\\w$])`).test(statement),
      );
      if (from.length) tainted.push({ name: w.name, kind: w.kind, where, from });
    }
  }
  return { tainted, unknown };
}
