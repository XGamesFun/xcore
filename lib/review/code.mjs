// Reading code: comments and strings blanked out, braces matched, functions found by name, and what the server's code
// says about vouchers and api/ routes. Shared by the review's parts and ../design-code/, so it imports none of them.

/** The code with its comments blanked out (strings kept, so a URL's // stays), lengths and lines unchanged. */
export function withoutComments(code) {
  let out = '',
    i = 0,
    quote = null;
  while (i < code.length) {
    const c = code[i],
      d = code[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += d ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i++;
    } else if (c === '/' && d === '/') {
      while (i < code.length && code[i] !== '\n') ((out += ' '), i++);
    } else if (c === '/' && d === '*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end < 0 ? code.length : end + 2;
      out += code.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** The `{…}` that opens at `at` in comment-free code: its text, or null. */
export function braced(code, at) {
  let depth = 0;
  for (let i = at; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return code.slice(at, i + 1);
  }
  return null;
}

/**
 * What server/vouchers.js says about paying: whether PAY.check is still the template, its parameters and body, and
 * VOUCHERS.payOnly. → {template, check: {params, body} | null, payOnly}
 */
export function readVouchers(text) {
  const code = withoutComments(text);
  const pay = /^export const PAY = \{/m.exec(code);
  const block = pay ? braced(code, pay.index + pay[0].length - 1) : null;
  let check = null;
  if (block) {
    const m = /\bcheck\s*(?::\s*(?:async\s*)?(?:function\s*)?)?\(([^)]*)\)\s*(?:=>\s*)?\{/.exec(block);
    if (m) check = { params: m[1], body: braced(block, m.index + m[0].length - 1) ?? '' };
  }
  // a check that hands the work to another of the file's functions (`return gated(…, await PAY.decide(…))`) is read
  // with them, a few calls deep: who it pays and from what is decided there
  if (check) {
    const defs = definitions(code).filter(d => d.name && !/^(?:check|paid)$/.test(d.name) && d.body.length > 2);
    const seen = new Set();
    for (let depth = 0, grew = true; grew && depth < 3; depth++) {
      grew = false;
      const blanked = quotesBlanked(check.body);
      for (const d of defs) {
        if (seen.has(d.name)) continue;
        if (!new RegExp(`(?<![\\w$])${d.name.replace(/\$/g, '\\$')}\\s*(?:\\?\\.\\s*)?\\(`).test(blanked)) continue;
        seen.add(d.name);
        check.body += `\n${d.body}`;
        grew = true;
      }
    }
  }
  const vouchers = /^export const VOUCHERS = \{/m.exec(code);
  const settings = vouchers ? braced(code, vouchers.index + vouchers[0].length - 1) : '';
  return {
    template: /This game pays no results yet/.test(text),
    check,
    payOnly: /\bpayOnly\s*:\s*['"](\w+)['"]/.exec(settings ?? '')?.[1] ?? null,
  };
}

/**
 * Does PAY.check pay from the request alone? It answers a grant, and never reads `env` (so no Durable Object, no
 * database, no record of a run the server started) nor fetches anything: whatever it pays, the page's request decided.
 * A Worker has no state but what env gives it, so this is a reading, not a guess; a check that reads state any other way
 * is not flagged.
 */
export function paysFromRequest(check) {
  if (!check?.body) return false;
  const b = quotesBlanked(check.body);
  return /\bgrant\s*:/.test(b) && !readsState(b);
}

/**
 * Does code (quotes blanked) read state: storage through env (a binding's call, `env.DB.prepare`, `env.ROOMS.get`; env
 * handed on whole; `env[name]`), `this`, or a fetch? A setting read as `env.MIN_SCORE` is a value the owner set, no
 * record of anything a player did: not state.
 */
export function readsState(code) {
  const rest = code.replace(/\benv\s*\??\.\s*[A-Za-z_$][\w$]*(?!\s*(?:\??\.|\[|\(|\?\.\(|[\w$]))/g, ' ');
  return /\benv\b|\bthis\b|(?<![\w$.])fetch\s*\(/.test(rest);
}

/** Code with its '…' and "…" strings blanked (a why that says "this server" is no read of `this`); template literals kept. */
export const quotesBlanked = code =>
  code.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, m => m[0] + ' '.repeat(m.length - 2) + m[0]);

/** A regex's or a string's text from `api/` on, as the paths it names: `(a|b)` spread, `\/?$` and the like dropped. */
function routesIn(fragment) {
  const text = fragment.replace(/\\\//g, '/').replace(/\/\?\$?$|\$$/, '');
  const group = /\(\?:?([\w|-]+)\)|\(([\w|-]+)\)/.exec(text);
  const spread = group
    ? (group[1] ?? group[2])
        .split('|')
        .map(w => text.slice(0, group.index) + w + text.slice(group.index + group[0].length))
    : [text];
  return spread
    .map(r => r.replace(/[/?$]+$/, ''))
    .filter(r => /^api(\/[\w-]+)+$/.test(r) || r === 'api')
    .filter(r => r !== 'api');
}

/**
 * The api/ routes a file's code names: in strings, template literals (up to the first `${`) and regex literals
 * (`/\/api\/tide\/(start|found)\/?$/`), and the page's `gf.api('vouchers/pay')`. Comments are left out. → [path]
 */
export function apiRoutes(code) {
  const c = withoutComments(code);
  const out = new Set();
  for (const m of c.matchAll(/(?:\\?\/|['"`])(api(?:\\?\/[\w|()?:-]+)+(?:\\?\/)?\??\$?)/g))
    for (const r of routesIn(m[1].replace(/\$\{.*$/, ''))) out.add(r);
  for (const m of c.matchAll(/\.api\(\s*['"`]([\w-]+(?:\/[\w-]+)*)/g)) out.add(`api/${m[1]}`);
  return [...out];
}
/** Code with every string and template literal blanked out (lengths and lines kept): a word there is never a call. */
export function withoutStrings(code) {
  let out = '';
  for (let i = 0; i < code.length;) {
    const c = code[i];
    if (c !== '"' && c !== "'" && c !== '`') {
      out += c;
      i++;
      continue;
    }
    let j = i + 1;
    while (j < code.length && code[j] !== c && !(c !== '`' && code[j] === '\n')) j += code[j] === '\\' ? 2 : 1;
    out += c + code.slice(i + 1, j).replace(/[^\n]/g, ' ') + (j < code.length ? c : '');
    i = j + 1;
  }
  return out;
}
/** The functions (and methods) `code` defines: [{name, body, start}]. A body is its braces, or an arrow's line. */
export function definitions(code) {
  const out = [];
  const add = (name, from) => {
    const brace = code.indexOf('{', from);
    const eol = code.indexOf('\n', from);
    const start = brace >= 0 && (eol < 0 || brace < eol) ? brace : from;
    const body = start === brace ? (braced(code, brace) ?? '') : code.slice(from, eol < 0 ? undefined : eol);
    out.push({ name, body, start });
  };
  for (const m of code.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g)) add(m[1], m.index + m[0].length);
  for (const m of code.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\b|function\b|\(|[A-Za-z_$][\w$]*\s*=>)/g,
  ))
    add(m[1], m.index + m[0].length);
  // methods of a class or an object literal (wherever they start: { async check(…) { … } }), and an object's
  // arrow or function properties (check: async (…) => { … })
  for (const m of code.matchAll(/(?:^|[{},;\s])(?:static\s+)?(?:async\s+)?\*?\s*([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/g))
    if (!/^(?:if|for|while|switch|catch|function|return|fetch|with)$/.test(m[1])) add(m[1], m.index + m[0].length - 1);
  for (const m of code.matchAll(
    /(?:^|[{,\s])([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function\b[^(]*\(|\(|[A-Za-z_$][\w$]*\s*=>)/g,
  ))
    if (m[1] !== 'fetch') add(m[1], m.index + m[0].length);
  return out;
}
/** A name's words: split at - _ . / @ and at CamelCase, lower case. */
export const wordsOfName = s =>
  String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
