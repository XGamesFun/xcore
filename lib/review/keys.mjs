// Keys by their shape and by where they go: what publish's scan (../publish/scan.mjs) does not name. A key it finds by
// a name (VOUCHER_SEED = '…', a base58 secret key) is its own finding; here are the same bytes written without such a
// name (a 64-hex string, one split in two, a list of 32 or 64 numbers, base64 under a seed's name), and a secret of
// env that the server's code answers to a request or writes to its log. All of it is patterns over the text.
import { codeOnly } from './code.mjs';

const lineAt = (text, i) => text.slice(0, i).split('\n').length;
/** A name before a value that says what it is when it is no key: a hash, a digest, an id. */
const NOT_A_KEY =
  /(?:hash|sha\d*|digest|checksum|integrity|etag|commit|fingerprint|uuid|\bid)\w*["']?\s{0,20}[:=]\s{0,20}$/i;
/** A name that says a value is a key's bytes. */
const KEY_NAME = /(?:seed|secret|private)\w*["']?\s{0,20}[:=]\s{0,20}(?:new\s+Uint8Array\s*\(\s*)?$/i;

/** The live voucher key's seed written in as what the server uses when VOUCHER_SEED is not set. */
const FALLBACK = /\bVOUCHER_SEED\s*(?:\?\?|\|\|)\s*$/;

/**
 * Key-shaped bytes in one file's text, however written, that publish's scan does not name: [{line, kind, named,
 * fallback}]. `named`: under a name that says it is a key's bytes (a seed, a secret, a private key); `fallback`: the
 * live voucher key's seed written in for when VOUCHER_SEED is unset. `server`: the text is server code.
 */
export function keyShapes(text, { server = false } = {}) {
  const out = [];
  const add = (at, kind) => {
    const before = text.slice(Math.max(0, at - 60), at);
    const fallback = server && FALLBACK.test(before);
    out.push({ line: lineAt(text, at), kind, named: fallback || KEY_NAME.test(before), fallback });
  };
  // a 64-hex string (32 bytes: a seed), alone or split into strings joined with +
  for (const m of text.matchAll(/(["'`])([0-9a-fA-F]{8,64})\1(?:\s*\+\s*(["'`])([0-9a-fA-F]{8,64})\3)*/g)) {
    const hex = m[0].replace(/[^0-9a-fA-F]/g, '');
    if (hex.length !== 64 || new Set(hex.toLowerCase()).size < 8) continue;
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    if (NOT_A_KEY.test(before)) continue;
    // (a seed under a seed's name is publish's scan's, and the page's own seed pattern's: said there once)
    if (!server && /\bseed\w*["']?\s{0,20}[:=]\s{0,20}$/i.test(before) && m[2].length === 64) continue;
    add(
      m.index,
      m[2].length === 64 ? 'a possible seed (64 hex characters)' : 'a possible seed (64 hex characters, split)',
    );
  }
  // a list of 32 or 64 numbers below 256 made into bytes, or under a key's name
  for (const m of text.matchAll(/\[\s*(\d{1,3}\s*,\s*){31,63}\d{1,3}\s*,?\s*\]/g)) {
    const n = m[0].match(/\d+/g);
    if ((n.length !== 32 && n.length !== 64) || n.some(x => Number(x) > 255) || new Set(n).size < 12) continue;
    const before = text.slice(Math.max(0, m.index - 60), m.index);
    if (
      !/(?:Uint8Array|Buffer\s*\.\s*from|fromSecretKey|fromSeed|FromBytes)\s*\(\s*$/.test(before) &&
      !KEY_NAME.test(before)
    )
      continue;
    add(m.index, `possible key bytes (${n.length} numbers)`);
  }
  // base64 of 32 or 64 bytes under a seed's, a secret's or a private key's name
  for (const m of text.matchAll(/(["'`])([A-Za-z0-9+/]{43}=|[A-Za-z0-9+/]{86}==)\1/g)) {
    if (!KEY_NAME.test(text.slice(Math.max(0, m.index - 40), m.index))) continue;
    add(m.index, 'a possible seed (base64)');
  }
  return out;
}

/** env's names that hold a secret: a seed, a key, a token, a password, an address with its key in it. */
const SECRET_NAME = /SEED|SECRET|PRIVATE|PASSWORD|PASSWD|TOKEN|API_?KEY|(?:^|_)KEY$|RPC_URL|DATABASE_URL|DSN$/;
const PUBLIC_NAME = /PUBLIC|_ID$|^ID$/;
/** Calls whose arguments a request is answered with, or a log line is written from. */
const SINKS = [
  ['answered', /(?<![\w$.])Response\s*\.\s*json\s*\(|\bnew\s+Response\s*\(/g],
  ['logged', /(?<![\w$.])console\s*\.\s*(?:log|info|warn|error|debug)\s*\(/g],
];
/** Calls a value may go through and still be itself. */
const SAME = /^(?:String|JSON\s*\.\s*stringify|encodeURIComponent|btoa|Object\s*\.\s*assign)$/;

/** Where the bracket that opens at `at` closes in code alone, or -1. */
function closing(code, at) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  for (let i = at, depth = 0; i < code.length; i++) {
    if (code[i] === code[at]) depth++;
    else if (code[i] === pairs[code[at]] && --depth === 0) return i;
  }
  return -1;
}

/**
 * Secrets of env that a server file answers a request with or writes to its log: [{name, how ('answered' or
 * 'logged'), line}]. Read as env.NAME (or env['NAME']) itself, or under a name it was given (`const seed =
 * env.VOUCHER_SEED`, `const { VOUCHER_SEED } = env`), inside the call's arguments and not changed on the way by a call
 * of another function (a signature made with the seed is no seed).
 */
export function exposedSecrets(code) {
  const bare = codeOnly(code);
  const out = [];
  // the names given a secret of env
  const alias = new Map();
  for (const m of code.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*env\s*(?:\??\.\s*([A-Z][A-Z0-9_]*)|\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\])/g,
  ))
    alias.set(m[1], m[2] ?? m[3]);
  for (const m of bare.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*env\b/g))
    for (const part of m[1].split(',')) {
      const [key, local = key] = part.split(':').map(x => x.trim().replace(/\s*=.*$/, ''));
      if (/^[A-Z][A-Z0-9_]*$/.test(key)) alias.set(local, key);
    }
  const secret = name => SECRET_NAME.test(name) && !PUBLIC_NAME.test(name);
  for (const [how, sink] of SINKS)
    for (const s of bare.matchAll(sink)) {
      const open = s.index + s[0].length - 1;
      const close = closing(bare, open);
      if (close < 0) continue;
      const args = code.slice(open, close + 1);
      const refs = [
        ...[
          ...args.matchAll(/(?<![\w$.])env\s*(?:\??\.\s*([A-Z][A-Z0-9_]*)|\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\])/g),
        ].map(r => [r.index, r[1] ?? r[2]]),
        ...[...alias].flatMap(([local, name]) =>
          [...args.matchAll(new RegExp(`(?<![\\w$.])${local.replace(/\$/g, '\\$')}(?![\\w$])`, 'g'))].map(r => [
            r.index,
            name,
          ]),
        ),
      ];
      for (const [at, name] of refs) {
        if (!secret(name) || bare[open + at] === ' ') continue;
        // a call between the sink and the value (other than one that keeps it as it is) changes it: no secret there
        const inner = args.slice(1, at);
        let changed = false;
        for (let i = 0; i < inner.length; i++) {
          if (inner[i] !== '(') continue;
          const name = /([A-Za-z_$][\w$.\s]*)$/.exec(inner.slice(0, i))?.[1]?.trim() ?? '';
          if (name && !SAME.test(name) && closing(args, i + 1) > at) changed = true;
        }
        if (changed) continue;
        if (!out.some(o => o.name === name && o.how === how)) out.push({ name, how, line: lineAt(code, open + at) });
      }
    }
  return out;
}
