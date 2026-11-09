// The server's own calls to the older database (server/database.js: dataOf(env)) that 0.2.0 reads differently from
// 0.1.0. In 0.1.0 a document was found by its collection and id alone, whoever wrote it; now every player has a space
// of their own and dataOf(env) without an owner is the server's: a get by id alone answers 404 for a player's
// document, and a put, add or delete writes the server's own copy, which the player never sees. A list without an
// owner is everyone's, as it was; its `offset` is refused. Read where `xcore add database` brings a 0.1.0
// database.js up to date, and at publish, so each call is said with the change it needs (CHANGELOG / README
// "Upgrading from 0.1.0").
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Comments and strings blanked (same length), so a word in them is not code. */
export function codeOnly(src) {
  // a string keeps its quotes (so `import('./x.js')` still reads as a literal path), its text becomes spaces
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, m =>
    m[0] === '/' ? m.replace(/[^\n]/g, ' ') : m[0] + ' '.repeat(m.length - 2) + m[0],
  );
}

/** Each call's options: the argument after collection, id and value (get(c, id, opts), list(c, opts), …). */
const OPTS_AT = { get: 2, put: 3, add: 2, delete: 2, list: 1 };
const CALL = '(get|put|add|list|delete)';
const lineAt = (text, i) => text.slice(0, i).split('\n').length;

/** The arguments of the call whose ( is at `open` in `code`, as [start, end) spans; null if it never closes. */
function argsAt(code, open) {
  const spans = [];
  let depth = 0,
    start = open + 1;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (--depth === 0) {
        if (code.slice(start, i).trim()) spans.push([start, i]);
        return { spans, end: i + 1 };
      }
    } else if (c === ',' && depth === 1) {
      spans.push([start, i]);
      start = i + 1;
    }
  }
  return null;
}

/** What one call needs, or null when it says whose space it means (or its options are not written out here). */
function needs(op, opts) {
  if (op === 'list') {
    if (opts && opts.startsWith('{') && /\boffset\b/.test(opts) && !/\boffset\s*:\s*0\s*[,}]/.test(opts))
      return "offset is refused now: page with the last answer's after (.list(c, {after})), which the answer gives with more";
    return null;
  }
  if (opts !== null && (!opts.startsWith('{') || /\bowner\b|\.\.\./.test(opts))) return null;
  const mean = {
    get: 'reads the server\'s own space (owner "server"), so a document a player wrote answers 404',
    put: "writes the server's own copy, which the player never sees",
    add: "adds to the server's own space, not a player's",
    delete: "deletes the server's own copy; a player's document stays",
  }[op];
  return `without an owner it ${mean}. For a player's document pass {owner: sub} (their id, from env.GF.verifyPlayer); for the server's own, {owner: 'server'}`;
}

/**
 * The calls to dataOf(env) in one file's text that need a change: dataOf(env).get(…) and a name it was kept under
 * (const data = dataOf(env); data.get(…)). → [{file, line, op, fix}]
 */
export function dataCallsIn(file, text) {
  const code = codeOnly(text);
  const found = [];
  const look = (re, from) => {
    for (const m of code.matchAll(re)) {
      const open = m.index + m[0].length - 1;
      const args = argsAt(code, open);
      if (!args) continue;
      const op = m[from];
      const at = OPTS_AT[op];
      const opts = args.spans[at] ? text.slice(...args.spans[at]).trim() : null;
      const fix = needs(op, opts);
      if (fix) found.push({ file, line: lineAt(code, m.index), op, fix });
    }
  };
  // dataOf(env).get(…), dataOf(env)?.put(…)
  for (const m of code.matchAll(/(?<![\w$.])dataOf\s*\(/g)) {
    const args = argsAt(code, m.index + m[0].length - 1);
    if (!args) continue;
    const rest = new RegExp(String.raw`^\s*\??\.\s*${CALL}\s*\(`).exec(code.slice(args.end));
    if (!rest) continue;
    const at = args.end + rest[0].length - 1;
    const call = argsAt(code, at);
    if (!call) continue;
    const opts = call.spans[OPTS_AT[rest[1]]] ? text.slice(...call.spans[OPTS_AT[rest[1]]]).trim() : null;
    const fix = needs(rest[1], opts);
    if (fix) found.push({ file, line: lineAt(code, m.index), op: rest[1], fix });
  }
  // const data = dataOf(env); … data.get(…)
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?dataOf\s*\(/g))
    look(new RegExp(String.raw`(?<![\w$.])${m[1].replace(/\$/g, '\\$')}\s*\??\.\s*${CALL}\s*\(`, 'g'), 1);
  return found.sort((a, b) => a.line - b.line);
}

const SOURCE = /\.(m?js|cjs|ts|mts|jsx|tsx)$/;
/** xcore's own files, and code of others: not the game's calls. */
const NOT_OURS = rel =>
  rel === 'server/database.js' || rel.startsWith('server/gf-loot/') || rel.split('/').includes('node_modules');

/**
 * The calls in the game's server code that need a change: `files`, the paths (relative to `dir`, with /) to read, or
 * every source file in server/. → [{file, line, op, fix}]
 */
export async function ownerlessDataCalls(dir, files = null) {
  if (!files) {
    files = [];
    const walk = async rel => {
      let entries;
      try {
        entries = await readdir(path.join(dir, ...rel.split('/')), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const r = `${rel}/${e.name}`;
        if (e.isDirectory()) await walk(r);
        else files.push(r);
      }
    };
    await walk('server');
  }
  const out = [];
  for (const rel of files.filter(f => SOURCE.test(f) && !NOT_OURS(f))) {
    const text = await readFile(path.join(dir, ...rel.split('/')), 'utf8').catch(() => null);
    if (text?.includes('dataOf')) out.push(...dataCallsIn(rel, text));
  }
  return out;
}

/** One call, as a line a person reads. */
export const dataCallLine = c => `${c.file}:${c.line} dataOf(env).${c.op}(…): ${c.fix}`;
