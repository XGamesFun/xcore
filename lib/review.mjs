// `xcore review`: the security review of a brought game, as a cheater would read it. Three parts, and the trade-offs
// for the person:
//   the economy   @xgamesfun/solana's own review of the economy file (`xsolana review --json`): each route that pays,
//                 what it trusts, its ceiling, its findings, and `tradeoffs` (words for the person). An installed
//                 package without `review` is said in one line, and the rest of the review goes on.
//   the server    this package's own static reading of server/ and the page, as two analyses: the payout ledger (each
//                 route that pays: who signs, what decides it, who is paid, the identity its limits count, the trust
//                 declared and observed, and the ceiling one person can take; findings payout-input, payout-ceiling,
//                 payout-signer, payout-trust) and key custody (each key, every place its bytes are and who can read
//                 it; finding key-custody). Besides them: a server of the game's own that does work before (or
//                 without) checking a player's token, and every api/ route the code names (for the live part).
//   design and code  ./design-code.mjs: what the spec declares the server does off chain ("offchain", a grant's
//                 "serverLimit") against what server/ does (findings design-unbuilt, code-undeclared,
//                 bound-undeclared), with drafted declarations and the economy check run on a copy of the spec with them.
//   live          (--live) each route asked with no sign-in and with a forged one, GET and POST; api/vouchers/key
//                 against the grants' keys; the published economy file's `live` against this folder's. Read-only:
//                 nothing it sends could spend or sign (a route that pays gets an empty body).
//   for the person  two lists the agent passes on: "Ask the person" (questions whose answers change the design) and
//                 "Tell the person, as written" (final sentences): the economy check's own, one per paid route from the
//                 ledger, one per key out of place, and what stops when the plan caps the server.
// The record goes in <game>/evidence/review-N/ (review.md and review.json), as the page check's goes in verify-N/.
// docs/SERVER.md, "What a payout rests on", is the guide the findings point to.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CMD } from './command.mjs';
import { designCode, designCodeMarkdown, draftsChecked } from './design-code.mjs';
import { economyFile, solanaCommand, solanaHas, solanaRoot } from './economy.mjs';
import { pageRoots } from './publish/page.mjs';
import { isBinaryPath, scanFile } from './publish/scan.mjs';
import { economyCluster, solanaRpc } from './solana-rpc.mjs';

/** How much the server holding a grant's voucher key checks before it signs, strongest first (the grant's `trust`). */
export const TRUST = ['decides', 'replays', 'bounds'];
export const SEVERITIES = ['high', 'medium', 'low', 'info'];
const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const GUIDE = 'docs/SERVER.md, "What a payout rests on"';
const readJson = file => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const posix = p => p.split(path.sep).join('/');

// ---- Where things are -------------------------------------------------------------------------------------------------

/** The folder a game's economy lives in, as `xcore loot add` puts it: a brought game's static folder, else its own. */
export function economyHome(dir) {
  const r = pageRoots(dir);
  return r.static ?? r.out;
}

/** The grants a voucher pays: those that name at least one voucher key. */
export const voucherGrants = spec =>
  (Array.isArray(spec?.grants) ? spec.grants : []).filter(g => Array.isArray(g?.vouchers) && g.vouchers.length);

/** The test key's seed in .dev.vars (VOUCHER_SEED), or null. */
function devSeed(dir) {
  try {
    const text = readFileSync(path.join(dir, '.dev.vars'), 'utf8');
    return /^\s*VOUCHER_SEED\s*=\s*["']?([0-9a-fA-F]{64})["']?\s*$/m.exec(text)?.[1].toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** Every file under `root` (no hidden files or folders, no node_modules, evidence or `skip` folders), as posix paths. */
async function filesUnder(root, { skip = [] } = {}) {
  const out = [];
  async function walk(abs, rel) {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && e.name === 'evidence') continue;
      if (skip.includes(r)) continue;
      if (e.isDirectory()) await walk(path.join(abs, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  }
  await walk(root, '');
  return out.sort();
}

// ---- Reading code -----------------------------------------------------------------------------------------------------

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
  return /\bgrant\s*:/.test(b) && !/\benv\b/.test(b) && !/\bfetch\s*\(/.test(b) && !/\bthis\b/.test(b);
}

/** Code with its '…' and "…" strings blanked (a why that says "this server" is no read of `this`); template literals kept. */
const quotesBlanked = code =>
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

// ---- The economy's own review -----------------------------------------------------------------------------------------

/** What the installed @xgamesfun/solana is: {version, root} or null. */
function solanaPackage(env) {
  const root = solanaRoot(env);
  if (!root) return null;
  return { root, version: readJson(path.join(root, 'package.json'))?.version ?? null };
}

export const NO_REVIEW =
  'the economy review needs @xgamesfun/solana with `review` (xsolana review): update @xgamesfun/xcore once it is released, or set GAMESFUN_SOLANA to a solana-kit checkout that has it';

/**
 * @xgamesfun/solana's review of the economy file: `xsolana review <file> --json`, run in the file's folder.
 * → {available: true, version, ok, routes, findings, tradeoffs} or {available: false, version, why}
 */
export function economyReview(file, { env = process.env } = {}) {
  const pkg = solanaPackage(env);
  const xsolana = solanaCommand(env);
  if (!pkg || !xsolana)
    return { available: false, version: null, why: 'the economy tools (@xgamesfun/solana) are not installed here' };
  if (!solanaHas('review', env)) return { available: false, version: pkg.version, why: NO_REVIEW };
  const r = spawnSync(xsolana[0], [xsolana[1], 'review', path.basename(file), '--json'], {
    cwd: path.dirname(file),
    encoding: 'utf8',
    timeout: 120_000,
    // (the RPC on the economy's own cluster; on mainnet the shared relay answers published games' players only, so with
    // no RPC of the person's own the review is left to the tools' default)
    env: reviewEnv(env, economyCluster(path.dirname(file))),
  });
  const said = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  if (/no command\W+review/i.test(said)) return { available: false, version: pkg.version, why: NO_REVIEW };
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {}
  if (!json || typeof json !== 'object')
    return {
      available: false,
      version: pkg.version,
      why: `xsolana review gave no JSON (${said.trim().split('\n')[0] || `exit code ${r.status}`})`,
    };
  if (!Array.isArray(json.findings))
    return {
      available: false,
      version: pkg.version,
      why: `xsolana review could not read the economy: ${json.error ?? json.message ?? JSON.stringify(json).slice(0, 200)}`,
    };
  return {
    available: true,
    version: pkg.version,
    ok: json.ok !== false,
    routes: Array.isArray(json.routes) ? json.routes : [],
    findings: json.findings,
    tradeoffs: typeof json.tradeoffs === 'string' ? json.tradeoffs : '',
  };
}

// ---- The server, read where it is ---------------------------------------------------------------------------------

const finding = (source, id, severity, message, fix, route = null) => ({
  source,
  id,
  severity,
  ...(route ? { route } : {}),
  message,
  fix,
});

/** Is `rel` tracked by git in `dir` / left out by its .gitignore? → {git: false} or {git: true, tracked, ignored} */
function gitState(dir, rel) {
  const git = args => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 10_000 });
  const inside = git(['rev-parse', '--is-inside-work-tree']);
  if (inside.error || inside.status !== 0) return { git: false };
  return {
    git: true,
    tracked: git(['ls-files', '--error-unmatch', rel]).status === 0,
    ignored: git(['check-ignore', '-q', rel]).status === 0,
  };
}

const TEXT_CODE = /\.(m?js|cjs|jsx|tsx?|html?|svelte|vue|astro)$/i;

// ---- Work done before a token is checked ----------------------------------------------------------------------------
// A request with no good token is a stranger's, and the work a server does for strangers counts toward what caps the
// game (a capped game's server is switched off until the month ends). So: check the token before any work. Read simply,
// to say nothing that is not so, over the game's own server files (not the parts xcore writes, which check where they
// must or are public by design), with comments and strings left out:
//   work    a call to the platform's saves, scores, files or loot (env.GF.saves.get, env.GF?.saves?.get, through
//           `const g = env.GF` or `const { GF } = env` too), a database, a Durable Object, or a fetch() out;
//   a check env.GF.verifyPlayer, gf-db.js's withPlayer or a JWT library's jwtVerify, or a call to a function of the
//           game's own that makes one (in any of its own files, through other functions of its own);
//   not decided: a binding from a package whose name says it checks (a router's jwt or auth middleware): nothing is said.
// Named when the game's own files do work and make no check anywhere (medium), and when the entry's fetch does work
// before its first check (low: a public read there is fine, and the person decides), unless the only work is waking a
// Durable Object whose class checks the token itself.
/** The files xcore writes into server/ (lib/add.mjs), each checking a token where it must or public by design. */
export const XCORE_PARTS = new Set(['database.js', 'gf-docs.js', 'gf-db.js', 'rooms.js', 'rpc.js', 'vouchers.js']);
const TOKEN_CHECK = /(?<![\w$])(?:verifyPlayer|withPlayer|jwtVerify)\s*(?:\?\.\s*)?\(/;
const DOT = '\\s*\\??\\.\\s*';
const CALL = '\\s*(?:\\?\\.\\s*)?\\(';
/** The kinds of work, as patterns over code whose platform binding may also be called `gf` (its aliases). */
const workPatterns = gf => [
  ['saves', new RegExp(`(?<![\\w$])(?:${gf})${DOT}saves${DOT}[\\w$]+${CALL}`)],
  ['scores', new RegExp(`(?<![\\w$])(?:${gf})${DOT}scores${DOT}[\\w$]+${CALL}`)],
  ['files', new RegExp(`(?<![\\w$])(?:${gf})${DOT}files${DOT}[\\w$]+${CALL}`)],
  ['loot', new RegExp(`(?<![\\w$])(?:${gf})${DOT}loot${DOT}[\\w$]+${CALL}`)],
  [
    'a database',
    new RegExp(
      `\\benv${DOT}[A-Z][A-Z0-9_]*${DOT}(?:prepare|batch|exec|dump)${CALL}|\\b(?:db|docsOf|dataOf)\\s*\\(\\s*env\\s*\\)`,
    ),
  ],
  [
    'a Durable Object',
    new RegExp(`\\benv${DOT}[A-Z][A-Z0-9_]*${DOT}(?:get|idFromName|idFromString|newUniqueId|getByName)${CALL}`),
  ],
  ['a fetch out', /(?<![\w$.])fetch\s*\(/],
];
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
/** A method's own `fetch(…) {` taken out, so only calls remain. */
const withoutFetchHandlers = code =>
  code.replace(/\b(?:async\s+)?fetch\s*(?::\s*(?:async\s*)?(?:function\s*)?)?\(([^()]*)\)\s*(?:=>\s*)?\{/g, m =>
    ' '.repeat(m.length),
  );
/** The names `env.GF` goes by in `code`: GF, and `const g = env.GF` aliases. → a pattern's alternatives */
const gfNames = code =>
  [
    'GF',
    ...[
      ...code.matchAll(
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:this\s*\.\s*)?env\s*\??\.\s*GF\b(?!\s*\??\.)/g,
      ),
    ].map(m => m[1]),
  ]
    .map(n => n.replace(/\$/g, '\\$'))
    .join('|');
/** The kinds of work `code` does, and where the first one is. → {kinds: [word], at} */
function workIn(code, gf = 'GF') {
  const c = withoutFetchHandlers(code);
  const hits = workPatterns(gf)
    .map(([what, re]) => [what, re.exec(c)?.index ?? -1])
    .filter(([, at]) => at >= 0);
  return { kinds: hits.map(([what]) => what), at: hits.length ? Math.min(...hits.map(([, at]) => at)) : -1 };
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
/** The names of the game's own functions that check a token, directly or through another of them. */
function checkingFunctions(codes) {
  const defs = codes.flatMap(definitions);
  const names = new Set(defs.filter(d => TOKEN_CHECK.test(d.body)).map(d => d.name));
  for (let changed = true; changed;) {
    changed = false;
    for (const d of defs)
      if (!names.has(d.name) && [...names].some(n => callOf(n).test(d.body))) {
        names.add(d.name);
        changed = true;
      }
  }
  return names;
}
const callOf = name => new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}\\s*(?:\\?\\.\\s*)?\\(`);
/** Where the first check is in `code`: a token check, or a call to a checking function. → index or -1 */
function firstCheck(code, checking) {
  const at = [TOKEN_CHECK, ...[...checking].map(callOf)].map(re => re.exec(code)?.index ?? -1).filter(i => i >= 0);
  return at.length ? Math.min(...at) : -1;
}
/** The default export's fetch body in comment-free code, or null. */
function fetchBody(code) {
  const start = /export\s+default\s*\{/.exec(code);
  if (!start) return null;
  const obj = braced(code, start.index + start[0].length - 1);
  if (!obj) return null;
  const m = /\b(?:async\s+)?fetch\s*(?::\s*(?:async\s*)?(?:function\s*)?)?\(([^()]*)\)\s*(?:=>\s*)?\{/.exec(obj);
  return m ? braced(obj, m.index + m[0].length - 1) : null;
}
/**
 * An import from a package that says it checks a sign-in (a router's jwt or auth middleware): a whole word of the
 * package's name or path (auth, @scope/auth, x-auth, auth-kit, hono/jwt) or of a name it imports (jwt, requireAuth,
 * verifyToken), never a word that only has one inside it (authority, authorName).
 */
const PACKAGE_IMPORT =
  /\bimport\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\}|\*\s*as\s+[A-Za-z_$][\w$]*)?\s*from\s*['"]((?![./])[^'"]+)['"]/g;
const SIGN_IN_WORDS = new Set([
  'auth',
  'oauth',
  'jwt',
  'jose',
  'bearer',
  'session',
  'verify',
  'authenticate',
  'authorize',
]);
/** A name's words: split at - _ . / @ and at CamelCase, lower case. */
export const wordsOfName = s =>
  String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const packageChecks = code =>
  [...code.matchAll(PACKAGE_IMPORT)].some(m =>
    [m[3], m[1] ?? '', ...(m[2] ?? '').split(',').map(x => x.trim().split(/\s+as\s+/)[0])].some(n =>
      wordsOfName(n).some(w => SIGN_IN_WORDS.has(w)),
    ),
  );
const TOKEN_WHY =
  "The work a server does for a caller with no token counts toward what caps the game, and a capped game's server is switched off until the month ends.";
const TOKEN_FIX =
  'Check the game token before any work: answer 401 at once when the request has none, then const player = await env.GF.verifyPlayer(token) (it checks the token\'s signature, its audience and its expiry) and 401 when it is not ok; keep only what is truly public (a leaderboard read) before it (docs/SERVER.md, "Check the token first").';

/** The findings for work done without, or before, a token check (see above). `files`: [{f, code (comments out), text}]. */
function tokenFindings(dir, files, add) {
  const own = files
    .filter(({ f, text }) => !XCORE_PARTS.has(f) && !(f === 'index.js' && /Written by `xcore add/.test(text)))
    .map(x => ({ ...x, bare: withoutStrings(x.code) }));
  if (!own.length || own.some(x => packageChecks(x.code))) return; // not decided: nothing said
  const working = own.map(x => ({ ...x, work: workIn(x.bare, gfNames(x.bare)) })).filter(x => x.work.kinds.length);
  if (!working.length) return;
  const checking = checkingFunctions(own.map(x => x.bare));
  if (!own.some(x => TOKEN_CHECK.test(x.bare))) {
    const names = working.map(x => `server/${x.f}`);
    const kinds = [...new Set(working.flatMap(x => x.work.kinds))];
    add(
      'server-no-token-check',
      'medium',
      `${names.join(', ')} ${names.length === 1 ? 'does' : 'do'} work for every request (${kinds.join(', ')}) and never check${names.length === 1 ? 's' : ''} a player's token: anyone, signed in or not, can make it spend the game's allowance. ${TOKEN_WHY}`,
      TOKEN_FIX,
    );
    return;
  }
  // the entry's fetch: work before its first check
  const cfg = readJson(path.join(dir, 'gamesfun.json'));
  const main = typeof cfg?.server?.main === 'string' ? cfg.server.main.replace(/^\.\//, '') : 'server/index.js';
  const entry = own.find(x => `server/${x.f}` === main);
  const body = entry ? fetchBody(entry.bare) : null;
  if (!body) return;
  const work = workIn(body, gfNames(entry.bare));
  if (work.at < 0) return;
  const check = firstCheck(body, checking);
  if (check >= 0 && check < work.at) return;
  // only a room woken, and the room's class checks the token itself: the room turns the stranger away
  const rooms = own.filter(x => /\bextends\s+DurableObject\b/.test(x.bare));
  if (work.kinds.every(k => k === 'a Durable Object') && rooms.some(x => firstCheck(x.bare, checking) >= 0)) return;
  add(
    'work-before-token',
    'low',
    `${main}'s fetch does work (${work.kinds.join(', ')}) before it checks a player's token${check < 0 ? ' (it checks none there itself)' : ''}: fine for what is truly public (a leaderboard read), but every stranger's request runs it. ${TOKEN_WHY}`,
    TOKEN_FIX,
  );
}
const OWN_COPIES = ['gf', 'gamesfun.js']; // xcore's and loot's copies in the page: not the game's own routes

// ---- The payout ledger ------------------------------------------------------------------------------------------------
// docs/SERVER.md, "What a payout rests on", computed. For every route that pays (each grant a voucher pays, whoever
// signs it), one record of what a cheater can't fake about it: who signs, what decides it (the request, or state the
// server keeps), who is paid, the identity its limits count, the limits, the trust declared and observed, and the
// ceiling (identities one person can make × the limit per identity × time). The findings are read off the record: a
// few codes keyed to what is wrong with the payout, never one per pattern.

/** Who signs a voucher, in words. */
const SIGNERS = {
  server: "the server's own key (server/vouchers.js, VOUCHER_SEED)",
  other: "a key the game's own code holds (signVoucher)",
  keeper: "xgames.fun's keeper (env.GF.loot.report)",
  none: 'nothing in this game',
};
/** Where a payout's decision comes from, in words. */
const SOURCES = {
  template: 'no check yet (PAY.check is the template: nothing is paid)',
  request: 'the request alone',
  env: 'state the server keeps (it reads env)',
  unreadable: 'not readable here',
};
const RECIPIENTS = {
  proven: 'a wallet the player proved (signed in with, or linked)',
  check: 'a wallet the server code names',
  request: 'a wallet the request names',
};
const AMOUNTS = { grant: "the grant's own", request: "the request's", server: "the server's" };
/** The identity VOUCHERS.payOnly lets be paid: 'any' a wallet (free), 'account' X or Google, 'x' an X account. */
const IDENTITY = { any: 'wallet', account: 'account', x: 'x' };
const IDENTITY_WORDS = {
  wallet: 'a wallet, which is free',
  account: 'an X or Google account',
  x: 'an X account',
};
const OBSERVED = {
  state: 'reads state the server keeps (decides, replays or bounds: the code alone does not say which)',
  request: 'reads only the request (it can decide, replay or bound nothing)',
  template: 'nothing paid yet (the template)',
  unreadable: 'not readable here',
  none: 'nothing here signs',
};
/** The keeper's own rate (docs/SERVER.md, "Paying a result"): reports an hour a game, winners a report. */
const KEEPER_RATE = { hour: 120, winners: 16 };
const LIMITS = ['perPerson', 'perWallet', 'perDay', 'total'];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const worst = severities => [...severities].sort((a, b) => SEVERITIES.indexOf(a) - SEVERITIES.indexOf(b))[0];

/**
 * What one person can take from a grant: identities × limit per identity × time. `limits`: the grant's (numbers above
 * 0); `identity`: the unit payOnly lets be paid (wallet, account, x). A limit per person binds a person (an X account,
 * or X or Google); with none, the unit that binds is the wallet, and a wallet is free, so only a total shared by every
 * player (perDay, total, the keeper's rate) bounds it, and one person can take all of it.
 * → {bounded, by: 'person'|'day'|'total'|'keeper'|null, unit, perIdentity, identities, time, severity, words}
 */
export function payoutCeiling(limits = {}, identity = 'wallet', { keeper = false } = {}) {
  const { perPerson = 0, perWallet = 0, perDay = 0, total = 0 } = limits;
  const time = [
    perDay ? `${plural(perDay, 'claim')} a day` : null,
    total ? `${plural(total, 'claim')} in all` : null,
  ].filter(Boolean);
  if (perPerson) {
    const unit = identity === 'x' ? 'x' : 'account';
    return {
      bounded: true,
      by: 'person',
      unit,
      perIdentity: perPerson,
      identities: `the ${unit === 'x' ? 'X accounts' : 'X or Google accounts'} one person holds`,
      time,
      severity: null,
      words: `bounded per person: ${plural(perPerson, 'claim')} ${IDENTITY_WORDS[unit]} (perPerson) × the ${unit === 'x' ? 'X accounts' : 'accounts'} one person holds${time.length ? `; ${time.join(', ')} for every player together` : ''}`,
    };
  }
  const why =
    identity === 'wallet'
      ? 'a wallet is free'
      : `payOnly lets only ${IDENTITY_WORDS[identity]} be paid, but the grant counts no person, so one of them links wallet after wallet, and a wallet is free`;
  const each = perWallet ? `${plural(perWallet, 'claim')} a wallet (perWallet)` : 'no limit a wallet';
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

/** A wallet (or the keeper's winners) taken from the request: `wallet: body.wallet`, `const { wallet } = body`. */
const RECIPIENT_FROM_REQUEST =
  /\b(?:wallet|winners)\s*:\s*[^,}\n]*\b(?:body|request)\b|\{[^}]*\b(?:wallet|winners)\b[^}]*\}\s*=\s*(?:await\s+)?(?:body|request)\b|\b(?:wallet|winners)\s*=\s*[^;\n]*\b(?:body|request)\b/;
const amountOf = code =>
  /\bamount\s*:\s*['"]grant['"]/.test(code)
    ? 'grant'
    : /\bamount\s*:[^,}\n]*\bbody\b/.test(code)
      ? 'request'
      : /\bamount\b/.test(code)
        ? 'server'
        : null;

/** PAY.check, as server/vouchers.js says it (readVouchers): what decides a payout, its amount and who is paid. */
function checkSite(v) {
  if (v.template) return { source: 'template', decides: null, amount: null, recipient: 'proven' };
  if (!v.check) return { source: 'unreadable', decides: null, amount: null, recipient: 'proven' };
  const b = v.check.body;
  const source = /\benv\b|\bfetch\s*\(|\bthis\b/.test(quotesBlanked(b))
    ? 'env'
    : paysFromRequest(v.check)
      ? 'request'
      : 'unreadable';
  const names = /\bwallet\s*:/.test(b) || /[{,]\s*wallet\s*[,}]/.test(b);
  return {
    source,
    // with the body read, the page's words decide what is paid; without, the sign-in alone (a gift to all who ask)
    decides: source === 'request' ? (/\bbody\b/.test(b) ? 'body' : 'sign-in') : null,
    amount: amountOf(b),
    recipient: !names ? 'proven' : RECIPIENT_FROM_REQUEST.test(b) ? 'request' : 'check',
  };
}

/** A keeper report or a signVoucher in the game's own code: the function around it, read the way a check is. */
function codeSite(body, signer) {
  const rest = quotesBlanked(body).replace(
    /(?:this\s*\??\.\s*)?env\s*\??\.\s*(?:GF\s*\??\.\s*loot\s*\??\.\s*report|VOUCHER_SEED)\b/g,
    ' ',
  );
  const state = /\benv\b|\bthis\b|(?<![\w$.])fetch\s*\(/.test(rest);
  const source = state ? 'env' : /\bbody\b|\brequest\b/.test(body) ? 'request' : 'unreadable';
  return {
    source,
    decides: source === 'request' ? 'body' : null,
    amount: signer === 'keeper' ? 'grant' : amountOf(body),
    recipient: RECIPIENT_FROM_REQUEST.test(body) ? 'request' : 'check',
  };
}

const FETCH_HANDLER = /\b(?:async\s+)?fetch\s*(?::\s*(?:async\s*)?(?:function\s*)?)?\(([^()]*)\)\s*(?:=>\s*)?\{/g;
/** The innermost function (or fetch handler) around `at` in comment-free code: its body, or the whole code. */
function enclosing(code, at) {
  const spans = definitions(code).map(d => [d.start, d.body]);
  for (const m of code.matchAll(FETCH_HANDLER)) {
    const body = braced(code, m.index + m[0].length - 1);
    if (body) spans.push([m.index + m[0].length - 1, body]);
  }
  let best = null;
  for (const [start, body] of spans)
    if (start <= at && at < start + body.length && (best === null || body.length < best.length)) best = body;
  return best ?? code;
}

/** Every place in server/ that signs a voucher. `read`: [{f, code}] (comments out); `vouchers`: readVouchers' or null. */
function signingSites(read, vouchers) {
  const sites = [];
  if (vouchers)
    sites.push({ signer: 'server', where: 'server/vouchers.js', payOnly: vouchers.payOnly, ...checkSite(vouchers) });
  for (const { f, code } of read) {
    if (f === 'vouchers.js') continue;
    const bare = withoutStrings(code);
    for (const [signer, re] of [
      ['keeper', /\bloot\s*\??\.\s*report\s*\(/],
      ['other', /(?<![\w$.])signVoucher\s*\(/],
    ]) {
      const m = re.exec(bare);
      if (m) sites.push({ signer, where: `server/${f}`, payOnly: null, ...codeSite(enclosing(code, m.index), signer) });
    }
  }
  return sites;
}

/** The site whose reading pays most to a cheater: the request deciding first, then what can't be read, then state. */
const weakest = sites => {
  const rank = s =>
    s.source === 'template'
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
  const site = weakest(sites);
  const signer = site?.signer ?? 'none';
  const records = grants.map(g => {
    const limits = Object.fromEntries(LIMITS.filter(k => Number(g.limits?.[k]) > 0).map(k => [k, Number(g.limits[k])]));
    const identity =
      signer === 'server'
        ? (IDENTITY[site.payOnly] ?? 'wallet') // not found: read as the template's 'any'
        : signer === 'keeper' && limits.perPerson
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
      source: site?.source ?? null,
      decides: site?.decides ?? null,
      amount: site?.amount ?? null,
      recipient: site?.recipient ?? null,
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
    for (const s of sites)
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

const limitWords = limits =>
  Object.keys(limits).length
    ? Object.entries(limits)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')
    : 'none';
const decidedWords = r =>
  r.source === 'request'
    ? `the request alone (${r.decides === 'body' ? 'its body' : 'the sign-in, nothing else'})`
    : (SOURCES[r.source] ?? 'nothing (no signer)');

/**
 * The findings read off the ledger, one a code a record, its cases joined and its severity the worst of them:
 *   payout-input    the request decides something a cheater shouldn't: whether it pays (high with the body read,
 *                   medium for the sign-in alone), the wallet paid (high), the amount (medium: up to the grant's)
 *   payout-ceiling  unbounded (high), or bounded only by a total every player shares (medium)
 *   payout-signer   nothing signs it, or a signer pays nothing claimable (medium); payOnly 'any' on a grant that counts
 *                   people, so wallet-only players are refused (medium); PAY.check still the template (info)
 *   payout-trust    declared and observed differ (medium), unknown (medium), or not declared (medium; info when the
 *                   installed @xgamesfun/solana can't take it)
 */
export function payoutFindings(ledger, { available = false } = {}) {
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
              fix: `If it is a gift, say so to the person and keep its limits tight; if it pays a result, check the result against what the server keeps (${GUIDE}).`,
            },
      );
    if (r.recipient === 'request')
      input.push({
        case: 'request-names-wallet',
        severity: 'high',
        why: 'the request names the wallet paid: a script sends its own',
        fix: 'Pay only a proven wallet: leave the wallet out of what the check answers (api/vouchers/pay pays the one signed in with or linked), or name one the server holds (walletOf(env, player)).',
      });
    if (r.amount === 'request' && r.source !== 'request')
      input.push({
        case: 'request-amount',
        severity: 'medium',
        why: "the amount is the request's: whatever the server checks, a script names the most the grant pays",
        fix: "Work the amount out from what the server keeps (the run's own result), or pay 'grant'.",
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
                : `Bound it per person: "perPerson" in the grant's limits, so it counts ${r.identity === 'x' ? 'X accounts' : 'accounts'} and not wallets; and a perDay total on every grant (${GUIDE}).`,
          },
        ],
        `identity paid: ${IDENTITY_WORDS[r.identity]}${r.payOnly ? `, by VOUCHERS.payOnly '${r.payOnly}'` : ''}; limits: ${limitWords(r.limits)}`,
      );

    const sign = [];
    if (r.signer === 'none')
      sign.push({
        case: 'no-signer',
        severity: 'medium',
        why: `the grant names voucher keys (${r.keys.length}), but nothing in this game signs one: no server/vouchers.js, no env.GF.loot.report (the keeper), no signVoucher`,
        fix: `Give the server its key (${CMD} add vouchers) or report results to the keeper (docs/SERVER.md, "Paying a result"); a key held by a backend of your own is fine: say so to the person.`,
      });
    if (!r.claimable)
      sign.push({
        case: 'unclaimable',
        severity: 'medium',
        why: `${r.where} signs vouchers, but no grant in the economy names a voucher key: nothing it signs can be claimed`,
        fix:
          r.signer === 'keeper'
            ? 'Name the keeper\'s key for the game in the grant that pays results (docs/SERVER.md, "The keeper").'
            : `Put the server's key in the grant that pays results: "vouchers": ["<the address ${CMD} secret set VOUCHER_SEED --new-key printed>"].`,
      });
    if (r.source === 'template')
      sign.push({
        case: 'template',
        severity: 'info',
        why: 'PAY.check in server/vouchers.js is still the template: the server pays no result yet',
        fix: `Write PAY.check with the person: what the server checks before a result pays (${GUIDE}).`,
      });
    if (r.signer === 'server' && r.payOnly === 'any' && r.limits.perPerson)
      sign.push({
        case: 'identity',
        severity: 'medium',
        why: "VOUCHERS.payOnly 'any' lets a wallet-only player be paid, but the grant counts people (perPerson): the server signs them nothing (person), so their claims fail",
        fix: "Set VOUCHERS.payOnly to 'x' in server/vouchers.js (or 'account'), so the page asks them to sign in first.",
      });
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
        severity: 'medium',
        why: `it declares trust "${t.declared}", but its check reads only the request: it can't decide, replay or bound anything`,
        fix: `Make the check do what "${t.declared}" says (${GUIDE}), and until it does, tell the person it is paid on the request's word.`,
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

// ---- Key custody ------------------------------------------------------------------------------------------------------
// For each key the game involves (the test voucher key, whose seed is in .dev.vars; the live one, held by xgames.fun; any
// key or seed in the page's files), every place its bytes are and who can read each one. A place outside the key's one
// intended holder is a finding, key-custody. Its severity is how far the place reaches, one level higher when the key
// signs for a grant on mainnet (real money).
const PLACES = {
  holder: { reach: 'its one intended holder', severity: null },
  git: { reach: 'everyone with a copy of the repository, in its history for good', severity: 'high' },
  unignored: { reach: 'not in .gitignore: the next `git add .` puts it in the repository', severity: 'low' },
  served: {
    reach:
      'inside the folder the page is served from: xgames.fun leaves hidden files out, but any other host that serves the folder serves it',
    severity: 'medium',
  },
  page: { reach: "in the page's files, which are public: a key there signs for anyone", severity: 'high' },
  grant: { reach: 'named by the grant: anyone with a copy of this folder signs claims for it', severity: 'medium' },
};
const CUSTODY_FIX = {
  git: `git rm --cached .dev.vars, add .dev.vars to .gitignore, and make new keys: delete VOUCHER_SEED from .dev.vars and run ${CMD} add vouchers again (and take the old test key out of every grant).`,
  unignored: 'Add .dev.vars to .gitignore.',
  served: 'Keep .dev.vars at the top of the game folder only, beside gamesfun.json.',
  page: `Take it out of the page: a voucher key lives only on the server (${CMD} secret set VOUCHER_SEED --new-key), and one that was ever in the page is a new key (take the old one out of every grant).`,
  grant:
    'Take the test key out of the grant before the economy holds anything of value; keep only the live key, which only xgames.fun holds.',
  grantMainnet:
    'The economy is on mainnet: take the test key out of the grant now; keep only the live key, which only xgames.fun holds.',
};
const place = (where, kind) => ({ where, kind, reach: PLACES[kind].reach, intended: kind === 'holder' });

/**
 * The custody list. `devVars`: the top .dev.vars' git state ({exists, git, tracked, ignored}); `seed`/`testKey`: the
 * test key's seed and address; `served`: the .dev.vars inside served folders [{rel, text}]; `pageHits`: [{path, line,
 * kind}] from the page's files (kind "the test voucher key's seed" for the test key's own); `grants`: voucherGrants;
 * `vouchers`: server/vouchers.js is there; `mainnet`. → [{key, what, address, holder, signs, network, places}]
 */
export function keyCustody({
  devVars = { exists: false },
  seed = null,
  testKey = null,
  served = [],
  pageHits = [],
  grants = [],
  vouchers = false,
  mainnet = false,
} = {}) {
  const network = mainnet ? 'mainnet' : 'devnet';
  const out = [];
  const gitPlaces = () =>
    devVars.git && devVars.tracked
      ? [place('git history (.dev.vars)', 'git')]
      : devVars.git && !devVars.ignored
        ? [place('.dev.vars, not ignored', 'unignored')]
        : [];
  if (seed) {
    const signs = testKey ? grants.filter(g => g.vouchers.includes(testKey)).map(g => g.key) : [];
    out.push({
      key: 'test',
      what: 'the test voucher key',
      address: testKey,
      holder: '.dev.vars (VOUCHER_SEED), on this machine',
      signs,
      signsKnown: Boolean(testKey),
      network,
      places: [
        place('.dev.vars', 'holder'),
        ...gitPlaces(),
        ...served.filter(s => s.text.toLowerCase().includes(seed)).map(s => place(s.rel, 'served')),
        ...pageHits.filter(h => h.kind === "the test voucher key's seed").map(h => place(h.path, 'page')),
        ...signs.map(k => place(`grant:${k}`, 'grant')),
      ],
    });
  } else if (devVars.exists)
    out.push({
      key: 'dev-vars',
      what: 'the secrets in .dev.vars',
      address: null,
      holder: '.dev.vars, on this machine',
      signs: [],
      signsKnown: false,
      network,
      places: [place('.dev.vars', 'holder'), ...gitPlaces()],
    });
  if (vouchers)
    out.push({
      key: 'live',
      what: 'the live voucher key',
      address: null,
      holder: `xgames.fun only (the secret VOUCHER_SEED, made by ${CMD} secret set VOUCHER_SEED --new-key)`,
      signs: [],
      signsKnown: false, // its address is the live server's to say (--live)
      network,
      places: [place('xgames.fun', 'holder')],
    });
  for (const s of served)
    if (!seed || !s.text.toLowerCase().includes(seed))
      out.push({
        key: `dev-vars:${s.rel}`,
        what: `the secrets in ${s.rel}`,
        address: null,
        holder: '.dev.vars at the top of the game folder, on this machine',
        signs: [],
        signsKnown: false,
        network,
        places: [place(s.rel, 'served')],
      });
  for (const h of pageHits)
    if (h.kind !== "the test voucher key's seed")
      out.push({
        key: `page:${h.path}:${h.kind}`,
        what: /^an? |^the /.test(h.kind) ? h.kind : `a ${h.kind}`,
        address: null,
        holder: `the server only (a secret: ${CMD} secret set)`,
        signs: [],
        signsKnown: false,
        network,
        places: [place(`${h.path}${h.line ? `:${h.line}` : ''}`, 'page')],
      });
  return out;
}

/** What a key signs, in words. */
const signsWords = k =>
  k.signs.length
    ? `${k.signs.map(g => `grant:${g}`).join(', ')} on ${k.network}`
    : k.signsKnown
      ? 'no grant this economy names'
      : 'not known here (whatever it is the key to)';

/** One key-custody finding for each place a key is outside its holder. */
export function custodyFindings(custody) {
  const out = [];
  for (const k of custody) {
    const real = k.network === 'mainnet' && k.signs.length > 0;
    for (const p of k.places.filter(x => !x.intended)) {
      const base = PLACES[p.kind].severity;
      out.push({
        source: 'server',
        id: 'key-custody',
        severity: real ? SEVERITIES[Math.max(0, SEVERITIES.indexOf(base) - 1)] : base,
        route: p.where,
        key: k.key,
        place: p.kind,
        message: `${k.what}${k.address ? ` (${k.address})` : ''} is in ${p.where}: ${p.reach}. Its one holder is ${k.holder}; it signs ${signsWords(k)}.`,
        fix: CUSTODY_FIX[p.kind === 'grant' && k.network === 'mainnet' ? 'grantMainnet' : p.kind],
      });
    }
  }
  return out;
}

/**
 * The server's part: facts, the payout ledger, the key custody list, their findings and the api/ routes. `spec`: the
 * economy (or null); `economy`: its file; `economyRoutes`: the economy review's routes; `addressOf(seed)`: a seed's
 * address (the test key's), or null when it cannot be had.
 */
export async function serverReview(
  dir,
  { spec = null, economy = null, available = false, economyRoutes = [], addressOf = null } = {},
) {
  const roots = pageRoots(dir);
  const findings = [];
  const add = (id, severity, message, fix, route = null) =>
    findings.push(finding('server', id, severity, message, fix, route));
  const grants = voucherGrants(spec);
  const facts = { server: existsSync(path.join(dir, 'server')), vouchers: false, pay: null, payOnly: null };
  const routes = new Map(); // path → [files that name it]
  const named = (r, file) => routes.set(r, [...new Set([...(routes.get(r) ?? []), file])]);

  // server/: its routes, and how it pays
  const serverFiles = (await filesUnder(path.join(dir, 'server'), { skip: ['gf-loot'] })).filter(f =>
    TEXT_CODE.test(f),
  );
  let serverCode = '';
  const read = [];
  for (const f of serverFiles) {
    const text = await readFile(path.join(dir, 'server', f), 'utf8');
    serverCode += `\n${withoutComments(text)}`;
    read.push({ f, code: withoutComments(text), text });
    for (const r of apiRoutes(text)) named(r, `server/${f}`);
  }
  tokenFindings(dir, read, add);
  // A token checked by hand (a JWT library against <play host>/player/v1/key): every game's tokens are signed with the
  // one key, so a check that skips the audience takes a token any other game was given (a game a player signed in to,
  // whose creator then replays the token here). env.GF.verifyPlayer checks it; a hand-made check must name it.
  if (
    /player\/v1\/key|createRemoteJWKSet|jwtVerify\s*\(/.test(serverCode) &&
    !/\baudience\b|\baud\b|game:/.test(serverCode)
  )
    add(
      'token-any-game',
      'high',
      "The server checks players' tokens itself (xgames.fun's key) but never their audience: every game's tokens are signed with one key, so it takes a token another game was given, and that game's maker can act as any of its players here.",
      "Use env.GF.verifyPlayer(token), which checks it, or pass {issuer: 'xgames.fun', audience: 'game:<this game>'} to jwtVerify.",
    );

  // the payout ledger
  const vouchersFile = path.join(dir, 'server', 'vouchers.js');
  let v = null;
  if (existsSync(vouchersFile)) {
    facts.vouchers = true;
    v = readVouchers(await readFile(vouchersFile, 'utf8'));
    facts.pay = v.template ? 'template' : v.check ? 'written' : 'unreadable';
    facts.payOnly = v.payOnly;
    // A review that cannot read the check must not pass for it: either the server no longer declares PAY (every
    // payout fails) or what it checks is out of sight, and a high finding that "went away" this way was never fixed.
    if (facts.pay === 'unreadable')
      add(
        'pay-unreadable',
        'high',
        'server/vouchers.js has no readable PAY.check (`export const PAY = { async check(…) { … }, … }` at the top level, not in a comment): the server pays nothing, or what it checks before paying cannot be reviewed.',
        `Put PAY back as \`export const PAY = { … }\` with its check and paid, run the paying route once under ${CMD} dev, then run review again.`,
      );
  }
  const sites = signingSites(read, v);
  const ledger = payoutLedger(spec, { sites, economyRoutes });
  findings.push(...payoutFindings(ledger, { available }));

  // key custody: the test key (its seed in .dev.vars), the live key, and any key in the page's files
  const seed = devSeed(dir);
  const devVars = existsSync(path.join(dir, '.dev.vars'))
    ? { exists: true, ...gitState(dir, '.dev.vars') }
    : { exists: false };
  const served = [];
  for (const folder of [...new Set([roots.out, roots.static, roots.overlay].filter(Boolean))])
    if (folder !== path.resolve(dir) && existsSync(path.join(folder, '.dev.vars')))
      served.push({
        rel: posix(path.relative(dir, path.join(folder, '.dev.vars'))),
        text: await readFile(path.join(folder, '.dev.vars'), 'utf8').catch(() => ''),
      });
  const testKey = seed && addressOf ? await addressOf(seed).catch(() => null) : null;
  if (seed && addressOf) facts.testKey = testKey;
  // (on mainnet a claim is real money: a key whose seed sits in plain text on this machine must not sign for it)
  const mainnet = spec?.network === 'mainnet' || economyCluster(economy ?? dir) === 'mainnet';

  // the page's files: a seed, a key, the test key's own seed; and the routes the page calls
  const pageFiles = await filesUnder(dir, { skip: ['server'] });
  const hits = [];
  for (const f of pageFiles) {
    const full = path.join(dir, f);
    if (isBinaryPath(f) || statSync(full).size > 8 * 1048576) continue;
    const bytes = new Uint8Array(await readFile(full));
    hits.push(...scanFile(f, bytes));
    const text = new TextDecoder().decode(bytes);
    if (seed && text.toLowerCase().includes(seed)) hits.push({ path: f, line: 0, kind: "the test voucher key's seed" });
    else {
      const m = /\bseed\w*["']?\s{0,20}[:=]\s{0,20}["'`][0-9a-fA-F]{64}["'`]/i.exec(text);
      if (m)
        hits.push({ path: f, line: text.slice(0, m.index).split('\n').length, kind: 'a seed (64 hex characters)' });
    }
    const top = f.split('/');
    const own = OWN_COPIES.some(c => top.includes(c));
    if (TEXT_CODE.test(f) && !own) for (const r of apiRoutes(text)) named(r, f);
  }
  const seen = new Set();
  const pageHits = hits.filter(h => !seen.has(`${h.path} ${h.kind}`) && seen.add(`${h.path} ${h.kind}`));
  const custody = keyCustody({ devVars, seed, testKey, served, pageHits, grants, vouchers: facts.vouchers, mainnet });
  findings.push(...custodyFindings(custody));

  facts.economy = economy ? posix(path.relative(dir, economy)) : null;
  // design and code: what the spec declares the server does off chain, against what server/ does (./design-code.mjs)
  const design = spec ? designCode(spec, { read, ledger }) : null;
  if (design) findings.push(...design.findings);

  const routeList = [...routes].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, from]) => ({ path: p, from }));
  // what stops with the server when its plan caps it (the routes the server itself answers)
  const work = serverWork(read, {
    sites,
    routes: routeList.filter(x => x.from.some(f => f.startsWith('server/'))).map(x => x.path),
  });
  return { facts, ledger, custody, findings, routes: routeList, work, design };
}

// ---- Live: the published game, asked as a stranger --------------------------------------------------------------------

/** A sign-in token in the shape the play host's are, signed by nobody. */
const FORGED = (() => {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${b64({ alg: 'EdDSA', typ: 'JWT' })}.${b64({ sub: 'review-forged', exp: 4102444800 })}.${'A'.repeat(86)}`;
})();
/** Routes that pay, sign or spend: asked with an empty body only, so even an open one has nothing to act on. */
const ACTS = /\/(pay|claim|sign|link|mint|buy|spend|withdraw|transfer|report|redeem|grant|voucher)s?(\/|$)/i;
/** Routes every game may answer anyone: the voucher key's address, whether it has its own RPC. */
const PUBLIC = new Set(['api/vouchers/key', 'api/rpc']);

/** One request: → {status, ok (the JSON's ok, or null), said (its why or error, short)} */
async function ask(fetchImpl, url, { method, auth, body, timeoutMs }) {
  try {
    const res = await fetchImpl(url, {
      method,
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        ...(auth ? { authorization: `Bearer ${FORGED}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    const said = json?.why ?? json?.error ?? json?.code ?? (json ? null : text.trim().slice(0, 80) || null);
    return {
      status: res.status,
      ok: json && typeof json === 'object' && 'ok' in json ? json.ok === true : null,
      said: said == null ? null : String(said).slice(0, 120),
    };
  } catch (e) {
    return { status: 0, ok: null, said: e.name === 'TimeoutError' ? 'no answer in time' : e.message };
  }
}

const accepted = a => a.status >= 200 && a.status < 300 && a.ok === true;

/**
 * The game at `base` (its play origin, or xcore dev's /game/), asked as a stranger. routes: [{path}]; keys: the voucher
 * keys the grants name; testKey: the test key's address; economyPath: the economy file's path in the page; localLive:
 * this folder's economy `live`. → {base, probes, key, economy, findings}
 */
export async function liveReview(
  base,
  {
    routes = [],
    keys = [],
    testKey = null,
    economyPath = null,
    localLive = null,
    vouchers = false,
    fetchImpl = fetch,
    timeoutMs = 10_000,
  } = {},
) {
  const root = base.endsWith('/') ? base : `${base}/`;
  const findings = [];
  const add = (...a) => findings.push(finding('live', ...a));
  const probes = [];
  for (const { path: p } of routes) {
    const url = new URL(p, root).href;
    const body = ACTS.test(p) ? {} : { runId: 'review-probe', id: 'review-probe', seq: 1, score: 1 };
    const asked = {};
    for (const [method, auth] of [
      ['GET', false],
      ['GET', true],
      ['POST', false],
      ['POST', true],
    ]) {
      const a = await ask(fetchImpl, url, { method, auth, body: method === 'POST' ? body : undefined, timeoutMs });
      asked[`${method} ${auth ? 'forged' : 'none'}`] = a;
      probes.push({ route: p, method, auth: auth ? 'forged' : 'none', ...a });
    }
    const posted = ['POST none', 'POST forged'].filter(k => accepted(asked[k]));
    if (posted.length)
      add(
        'live-open-post',
        'high',
        `POST ${p} answered ok to a request with ${posted.map(k => (k.endsWith('forged') ? 'a forged sign-in' : 'no sign-in')).join(' and with ')}: anyone can do what it does.`,
        'Verify the player first in that route (env.GF.verifyPlayer(token), and refuse when it is not ok), before anything it reads or writes.',
        p,
      );
    if (accepted(asked['GET forged']) && !accepted(asked['GET none']))
      add(
        'live-forged-token',
        'high',
        `GET ${p} refuses no sign-in but answers ok to a forged one: it reads the token without checking its signature.`,
        'Verify the token with env.GF.verifyPlayer(token) and use the player it answers, never what the token says by itself.',
        p,
      );
    else if (accepted(asked['GET none']) && !PUBLIC.has(p))
      add(
        'live-open-get',
        'medium',
        `GET ${p} answers ok to anyone, with no sign-in: fine for what is public (a leaderboard), never for a player's own data or a step of a run.`,
        'If it is not public, verify the player in that route first.',
        p,
      );
  }

  let key = null;
  if (vouchers || routes.some(r => r.path === 'api/vouchers/key')) {
    const url = new URL('api/vouchers/key', root).href;
    try {
      const res = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = await res.json().catch(() => null);
      key = { status: res.status, publicKey: json?.ok ? (json.publicKey ?? null) : null, said: json?.why ?? null };
    } catch (e) {
      key = { status: 0, publicKey: null, said: e.message };
    }
    if (!key.publicKey)
      add(
        'live-key-unset',
        'medium',
        `api/vouchers/key gives no key (${key.status}${key.said ? `: ${key.said}` : ''}): the live server signs no voucher.`,
        `${CMD} secret set VOUCHER_SEED --new-key, then put the address it prints in the grant.`,
      );
    else if (testKey && key.publicKey === testKey)
      add(
        'live-test-key',
        'high',
        "The live server signs with the test key, whose seed is in this folder's .dev.vars: anyone with a copy of the folder signs what it signs.",
        `Make the live key (${CMD} secret set VOUCHER_SEED --new-key: made and sent to xgames.fun only), put it in the grant in place of the test key, approve and publish.`,
      );
    else if (!keys.includes(key.publicKey))
      add(
        'live-key-unnamed',
        'medium',
        `The live server's key (${key.publicKey}) is in no grant's "vouchers": every voucher it signs is refused on chain.`,
        `Put that address in the grant that pays results, then ${CMD} loot approve and ${CMD} publish.`,
      );
  }

  let economy = null;
  if (economyPath) {
    const url = new URL(economyPath, root).href;
    try {
      const res = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = res.ok ? await res.json().catch(() => null) : null;
      const same = (a, b) =>
        (a?.project ?? null) === (b?.project ?? null) && (a?.program ?? null) === (b?.program ?? null);
      economy = {
        path: economyPath,
        status: res.status,
        live: json?.live ? { program: json.live.program ?? null, project: json.live.project ?? null } : null,
        same: json ? same(json.live, localLive) : false,
      };
    } catch (e) {
      economy = { path: economyPath, status: 0, live: null, same: false, said: e.message };
    }
    if (!economy.same)
      add(
        'live-economy-stale',
        'medium',
        economy.status !== 200
          ? `The published ${economyPath} could not be read (${economy.status || economy.said}).`
          : `The published ${economyPath} is live at ${economy.live?.project ?? 'nothing'}, this folder's at ${localLive?.project ?? 'nothing'}: the page players have talks to another economy.`,
        `${CMD} publish, so the page carries the economy as it is live now.`,
      );
  }
  return { base: root, probes, key, economy, findings };
}

// ---- The trade-offs, for the person ---------------------------------------------------------------------------------

/**
 * Each level in plain words: how the server checks, what a cheater gets, and what the stronger level costs. `request`
 * is the level the ledger observes when the check reads only the request, whatever the grant declares.
 */
export const LEVELS = {
  decides: {
    words:
      'the server runs the game itself (a turn, a room, a simulation from a seed it keeps) and the page sends only inputs',
    cheater: 'what a bot that plays well wins, and no more than a player who plays well',
    stronger:
      'there is no stronger level: if a good bot still earns too much, tighten the limits (perPerson with payOnly "x", a perDay total)',
  },
  replays: {
    words: 'the page sends its inputs; the server runs them again and reads the result itself',
    cheater:
      'the best run a script can find: given the whole seed up front it searches offline and sends only that; with randomness revealed as the run goes, what a bot that plays well wins',
    stronger:
      'deciding it: the rules run on the server step by step (a Durable Object a run) and the seed never leaves it; that is the simulation moved to the server, and a request and its CPU for every step of play',
  },
  bounds: {
    words:
      'the page plays and reports the result; the server checks only its own clock, the order of checkpoints and its caps',
    cheater:
      'every claim without playing: a script that waits as long as the game allows and reports the best result is paid, up to the limits',
    stronger:
      'replaying it: a deterministic game step (fixed time step, seeded randomness revealed as the run goes) that the server runs again from the inputs; about 3 ms of CPU a second played, which may need a paid slot (Creator)',
  },
  request: {
    words:
      "the page's request decides it: the check reads nothing the server keeps (no run it started, no clock, no replay)",
    cheater: 'every claim, at once, by a script that sends the request: nothing it sends is checked',
    stronger:
      'bounding it: the server starts each run (an id, its own clock, kept in a Durable Object or a database), takes checkpoints in order and refuses what is faster than the game allows',
  },
};

/**
 * The paid routes, read from the ledger: each with its level (the weaker of declared and observed), what a cheater gets
 * up to its ceiling, and what the stronger level costs. Without `ledger`, one is made from the spec and `facts`.
 */
export function tradeoffs(spec, { economy = null, facts = {}, ledger = null } = {}) {
  const records =
    ledger ??
    payoutLedger(spec, {
      sites: facts.vouchers
        ? [
            {
              signer: 'server',
              where: 'server/vouchers.js',
              payOnly: facts.payOnly ?? null,
              source: facts.pay === 'template' ? 'template' : 'unreadable',
              decides: null,
              amount: null,
              recipient: 'proven',
            },
          ]
        : [],
      economyRoutes: economy?.routes ?? [],
    });
  return records
    .filter(r => r.grant)
    .map(r => {
      const own = economy?.routes?.find(x => x.key === r.grant && (!x.kind || /grant/i.test(x.kind)));
      const observedWeaker = r.trust.observed === 'request';
      const level = LEVELS[observedWeaker ? 'request' : r.trust.level] ?? null;
      return {
        route: r.route,
        name: r.name,
        trust: r.trust.level,
        observed: r.trust.observed,
        declared: r.trust.declared !== null,
        how:
          level?.words ??
          'not declared: read PAY.check in server/vouchers.js and say which of decides, replays or bounds it does',
        cheater: `${level ? level.cheater : `it rests on what PAY.check checks: if it only bounds the result, ${LEVELS.bounds.cheater}; if it decides it, ${LEVELS.decides.cheater}`}; the most one person takes is ${r.ceiling.words}`,
        bounded: r.ceiling.bounded,
        // the economy review's own ceiling: what the chain lets one route pay, and what it feeds
        ceiling: own?.ceiling ? String(own.ceiling) : null,
        stronger: level?.stronger ?? null,
      };
    });
}

// ---- For the person: what to ask, and what to tell as written -----------------------------------------------------
// Agents paraphrase findings, lose options, or keep them in private notes; ready sentences reach the person. So the
// review opens review.md with two short lists, each line with where it comes from:
//   ask   questions whose answers change the design ("? "): ask them before building on the answers
//   tell  final sentences to say as they are ("> ")
// from: economy   @xgamesfun/solana's check, in its own words (`xsolana check --json`: its "Ask the person" and
//                 "Tell the person, as written" lines; its review carries neither)
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
const CRITICAL = /\bloot\s*\??\.\s*report\s*\(|(?<![\w$.])signVoucher\s*\(|(?<![\w$.])fetch\s*\(|\bsendTransaction\b/;
/** → {what, timer} for the first word of TIMED in `texts`, or {what: null, timer: null}. */
const timedWords = (...texts) => {
  const t = texts.join(' ').toLowerCase();
  const hit = TIMED.find(([w]) => t.includes(w));
  return { what: hit?.[1] ?? null, timer: hit?.[2] ?? null };
};
/** The class whose body holds `at` in comment-free code: its name, or null. */
function classAt(code, at) {
  let best = null;
  for (const m of code.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)[^{]*\{/g)) {
    const body = braced(code, m.index + m[0].length - 1);
    if (body && m.index < at && at < m.index + m[0].length - 1 + body.length) best = m[1];
  }
  return best;
}
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
    const bare = withoutStrings(code);
    const where = `server/${f}`;
    const owners = new Map(); // class (or the file) → {at, body}
    for (const m of bare.matchAll(/(?:^|[\s;{}])(?:async\s+)?alarm\s*\([^()]*\)\s*\{/g)) {
      const owner = classAt(bare, m.index) ?? where;
      owners.set(owner, { body: braced(bare, m.index + m[0].length - 1) ?? '' });
    }
    for (const m of bare.matchAll(/\bsetAlarm\s*\(/g)) {
      const owner = classAt(bare, m.index) ?? where;
      if (!owners.has(owner)) owners.set(owner, { body: enclosing(bare, m.index) });
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
    return `at most ${plural(c.perIdentity, 'claim')} for each ${c.unit === 'x' ? 'X account' : 'X or Google account'} they hold${time ? `, and ${time} for all players together` : ''}`;
  if (c.by === 'day' || c.by === 'total')
    return `all of ${time} shared by every player: wallets are free, so one person can take it all`;
  if (c.by === 'keeper')
    return `all the keeper's rate allows (${KEEPER_RATE.hour} reports an hour): wallets are free, so one winner can take it all`;
  return 'no limit: wallets are free, and the grant has no perDay or total';
}
/** What the chain alone allows a grant: what a leaked key could sign. perPerson and perWallet don't bound it. */
const chainAllows = limits =>
  limits.perDay || limits.total
    ? `up to ${[limits.perDay ? `${plural(limits.perDay, 'claim')} a day` : null, limits.total ? `${plural(limits.total, 'claim')} in all` : null].filter(Boolean).join(' and ')}`
    : 'any number of claims (the grant has no perDay or total)';

/** One sentence to tell for a paid route, from its ledger record; and a question when the design waits on one. */
function routeTold(r) {
  const name = `“${r.name}”`;
  if (r.signer === 'none')
    return {
      tell: `${name} can't be claimed yet: nothing in this game signs its vouchers.`,
      ask: `Who signs the vouchers for ${name}: this game's server (its own key), xgames.fun's keeper, or a backend of your own?`,
    };
  if (r.source === 'template')
    return {
      tell: `${name} pays nothing yet: the server's check (PAY.check in server/vouchers.js) is still the template.`,
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
      : "it rests on a check this review can't read";
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

// ---- The record -------------------------------------------------------------------------------------------------------

async function nextOut(dir) {
  const root = path.join(dir, 'evidence');
  let n = 0;
  try {
    for (const e of await readdir(root)) {
      const m = /^review-(\d+)$/.exec(e);
      if (m) n = Math.max(n, Number(m[1]));
    }
  } catch {}
  return path.join(root, `review-${n + 1}`);
}

export const counts = findings =>
  Object.fromEntries(SEVERITIES.map(s => [s, findings.filter(f => f.severity === s).length]));
const cell = v =>
  String(v ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');

const DECIDED_CELL = r =>
  r.source === 'request'
    ? `the request (${r.decides === 'body' ? 'its body' : 'the sign-in alone'})`
    : ({ template: 'no check yet (template)', env: 'state the server keeps', unreadable: 'not readable' }[r.source] ??
      'nothing');

/** The payout ledger as a table: one row a paid route. */
export function ledgerTable(ledger) {
  const lines = [
    '| Route | Signer | Decided by | Amount | Paid to | Identity | Limits | Trust (declared / observed) | Ceiling |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of ledger)
    lines.push(
      `| \`${r.route}\` | ${r.signer}${r.where ? ` (${r.where})` : ''} | ${DECIDED_CELL(r)} | ${AMOUNTS[r.amount] ?? ''} | ${{ proven: 'a proven wallet', check: 'a wallet the code names', request: 'a wallet the request names' }[r.recipient] ?? ''} | ${{ wallet: 'wallet (free)', account: 'account (X or Google)', x: 'X account' }[r.identity]}${r.payOnly ? ` (payOnly '${r.payOnly}')` : ''} | ${cell(limitWords(r.limits))} | ${r.trust ? `${r.trust.declared ?? 'none'} / ${r.trust.observed === 'state' ? 'reads state' : r.trust.observed}${r.trust.matches ? '' : ' (mismatch)'}` : 'no grant'} | ${r.ceiling ? cell(r.ceiling.words) : 'nothing claimable'} |`,
    );
  return lines;
}

/** The key custody list as a table: one row a place a key's bytes are. */
export function custodyTable(custody) {
  const lines = ['| Key | Signs | Place | Who can read it | Finding |', '| --- | --- | --- | --- | --- |'];
  for (const k of custody)
    for (const p of k.places) {
      const sev = custodyFindings([{ ...k, places: [p] }])[0]?.severity;
      lines.push(
        `| ${k.what}${k.address ? ` (\`${k.address}\`)` : ''} | ${signsWords(k)} | ${cell(p.where)} | ${cell(p.intended ? `its holder: ${k.holder}` : p.reach)} | ${sev ?? 'none'} |`,
      );
    }
  return lines;
}

const FROM = {
  economy: (r, n) =>
    `From the economy (@xgamesfun/solana${r.economy.version ? ` ${r.economy.version}` : ''}'s check, in its words), ${n}:`,
  server: (r, n) => `From the server's code (its payout ledger), ${n}:`,
  design: (r, n) =>
    `From the design against the code (what the spec declares the server does, and what it does), ${n}:`,
  custody: (r, n) => `From where its keys are, ${n}:`,
  plan: (r, n) => `From its plan (a capped server is off until the month ends), ${n}:`,
};
/** review.md's two blocks for the person: "Ask the person" ("? ") and "Tell the person, as written" ("> "), by source. */
export function toldMarkdown(r) {
  const lines = [];
  const block = (head, intro, list, mark) => {
    lines.push(`## ${head}`, '', intro, '');
    if (!list.length) lines.push('Nothing here.', '');
    for (const from of Object.keys(FROM)) {
      const of = list.filter(x => x.from === from);
      if (!of.length) continue;
      lines.push(FROM[from](r, of.length === 1 ? 'one line' : `${of.length} lines`), '');
      for (const x of of) lines.push(`${mark}${x.text}`, '');
    }
  };
  block(
    'Ask the person',
    'Questions whose answers change the design: ask them before building on the answers.',
    r.ask ?? [],
    '? ',
  );
  block(
    'Tell the person, as written',
    'Each is final: say it as it is, in your own answer to the person, not only in notes.',
    r.tell ?? [],
    '> ',
  );
  return lines;
}

/** review.md: what the person and their agent read. */
export function reviewMarkdown(r) {
  const c = r.counts;
  const lines = [
    `# Security review: ${r.game}`,
    '',
    `${r.at} · ${r.xcore} · ${r.economy.version ? `@xgamesfun/solana ${r.economy.version}` : 'no @xgamesfun/solana'}`,
    '',
    `**${c.high ? 'FAIL' : 'PASS'}**: ${SEVERITIES.map(s => `${c[s]} ${s}`).join(', ')}. ${c.high ? 'Fix every high finding before the game pays anything of value.' : 'No high finding.'}`,
    '',
    ...toldMarkdown(r),
    '## Findings',
    '',
  ];
  if (!r.findings.length) lines.push('None.', '');
  for (const s of SEVERITIES) {
    const of = r.findings.filter(f => f.severity === s);
    if (!of.length) continue;
    lines.push(`### ${s[0].toUpperCase()}${s.slice(1)}`, '');
    for (const f of of)
      lines.push(
        `- **${f.id}** (${f.source}${f.route ? `, ${f.route}` : ''}): ${f.message}`,
        ...(f.fix ? [`  Fix: ${f.fix}`] : []),
      );
    lines.push('');
  }
  lines.push('## Economy', '');
  if (!r.economy.file) lines.push('This game has no economy.', '');
  else if (!r.economy.available) lines.push(`${r.economy.file}: not reviewed: ${r.economy.why}.`, '');
  else {
    lines.push(`${r.economy.file}, reviewed by @xgamesfun/solana ${r.economy.version} (xsolana review).`, '');
    if (r.economy.routes.length) {
      lines.push(
        '| Route | Kind | Trigger | Trusts | Trust | Enforced | Ceiling |',
        '| --- | --- | --- | --- | --- | --- | --- |',
      );
      for (const x of r.economy.routes)
        lines.push(
          `| ${cell(x.name ?? x.key)} | ${cell(x.kind)} | ${cell(x.trigger)} | ${cell(Array.isArray(x.trusts) ? x.trusts.join(', ') : x.trusts)} | ${cell(x.trust)} | ${cell(Array.isArray(x.enforced) ? x.enforced.join(', ') : x.enforced)} | ${cell(x.ceiling)} |`,
        );
      lines.push('');
    }
  }
  const f = r.server.facts;
  lines.push(
    '## Server',
    '',
    `- server/: ${f.server ? 'yes' : 'none'}; server/vouchers.js: ${f.vouchers ? 'yes' : 'none'}`,
    ...(f.vouchers
      ? [
          `- PAY.check: ${{ template: 'still the template (pays nothing)', written: 'written', unreadable: 'not found in the file' }[f.pay]}`,
          `- VOUCHERS.payOnly: ${f.payOnly ? `'${f.payOnly}'` : 'not found'}`,
        ]
      : []),
    `- api/ routes the code names: ${r.server.routes.length ? r.server.routes.map(x => `\`${x.path}\``).join(', ') : 'none'}`,
    '',
    '### Payouts: the ledger',
    '',
    'Each route that pays, as a cheater reads it: who signs, what decides it, who is paid, the identity its limits count, and the ceiling (identities one person can make × the limit for each × time). The payout-* findings are read off it.',
    '',
    ...(r.ledger.length ? [...ledgerTable(r.ledger), ''] : ['No route pays through a voucher.', '']),
    '### Keys: where each one is',
    '',
    "Every place a key's bytes are, and who can read it. Each place outside its one holder is a key-custody finding.",
    '',
    ...(r.custody.length ? [...custodyTable(r.custody), ''] : ['No key here.', '']),
    ...designCodeMarkdown(r.designCode),
    '## Live',
    '',
  );
  if (!r.live) lines.push(`Not run: ${r.liveWhy ?? `${CMD} review --live`}.`, '');
  else {
    lines.push(`Asked ${r.live.base} as a stranger (no sign-in, and a forged one).`, '');
    if (r.live.probes.length) {
      lines.push('| Route | Request | Sign-in | Answer |', '| --- | --- | --- | --- |');
      for (const p of r.live.probes)
        lines.push(
          `| \`${p.route}\` | ${p.method} | ${p.auth} | ${p.status || 'none'}${p.ok === null ? '' : ` ok:${p.ok}`}${p.said ? ` ${cell(p.said)}` : ''} |`,
        );
      lines.push('');
    }
    if (r.live.key) lines.push(`- api/vouchers/key: ${r.live.key.publicKey ?? `none (${r.live.key.status})`}`);
    if (r.live.economy)
      lines.push(
        `- published ${r.live.economy.path}: ${r.live.economy.same ? 'live at the same economy as this folder' : 'not the economy this folder has live'}`,
      );
    lines.push('');
  }
  lines.push(
    '## For the person: what a cheater gets',
    '',
    'Show the person this section in plain words, and let them choose the trade-off.',
    '',
  );
  if (r.economy.tradeoffs) lines.push(r.economy.tradeoffs.trim(), '');
  if (!r.tradeoffs.length)
    lines.push('No route pays a result through a voucher: nothing here rests on what the server checks.', '');
  for (const t of r.tradeoffs) {
    const rec = r.ledger.find(x => x.route === t.route);
    lines.push(
      `### ${t.name} (\`${t.route.replace(/^grant:/, '')}\`)`,
      '',
      `- **How the server checks it**: ${t.observed === 'request' ? `declared ${t.trust ?? 'nothing'}, but observed: ` : t.trust ? `${t.trust}${t.declared ? '' : ' (from the economy review; not declared in the grant)'}: ` : ''}${t.how}.`,
      `- **What a cheater gets**: ${t.cheater}.`,
      ...(t.ceiling ? [`- **The economy review's ceiling**: ${t.ceiling.replace(/\.$/, '')}.`] : []),
      ...(rec
        ? [
            `- **Its record**: signed by ${SIGNERS[rec.signer]}${rec.where ? ` in ${rec.where}` : ''}; decided by ${decidedWords(rec)}; paid to ${RECIPIENTS[rec.recipient] ?? 'nobody'}; counted by ${IDENTITY_WORDS[rec.identity]}.`,
          ]
        : []),
      ...(t.stronger ? [`- **The stronger level**: ${t.stronger}.`] : []),
      '',
    );
  }
  lines.push(
    `The guide: ${GUIDE}, and @xgamesfun/solana's skill reference, skills/xsolana-economy/references/trust-and-cheating.md.`,
    '',
  );
  return lines.join('\n');
}

/**
 * The whole review of the game in `dir`. live: the base to ask (or null); out: where the record goes (default
 * evidence/review-N/). → the record, with outDir
 */
export async function reviewGame(
  dir,
  { live = null, liveWhy = null, out = null, env = process.env, fetchImpl = fetch, now = new Date() } = {},
) {
  const home = economyHome(dir);
  const file = economyFile(home);
  const spec = file ? readJson(file) : null;
  const economy = file
    ? {
        file: posix(path.relative(dir, file)),
        ...(spec ? economyReview(file, { env }) : { available: false, version: null, why: 'it is not valid JSON' }),
      }
    : { file: null, available: false, version: solanaPackage(env)?.version ?? null, why: 'no economy' };
  // the economy's own sentences for the person: its check's (its review carries none)
  const told =
    file && spec ? economyTold(file, { env }) : { ask: [], tell: [], why: file ? 'it is not valid JSON' : null };
  const addressOf = async seed => (await import('./add.mjs')).seedAddress(seed);
  const server = await serverReview(dir, {
    spec,
    economy: file,
    available: economy.available,
    economyRoutes: economy.available ? economy.routes : [],
    addressOf,
  });
  // the drafted declarations, checked by the economy kit on a temporary copy of the spec (never the spec itself)
  const designed = server.design
    ? {
        ...server.design,
        withDrafts: await draftsChecked(file, spec, server.design.drafts, {
          env: reviewEnv(env, economyCluster(path.dirname(file))),
        }),
      }
    : null;
  // the economy review says what it says about trust; this package's own line on it only when it says nothing
  const theirs = economy.available ? economy.findings : [];
  const own = server.findings.filter(
    f =>
      !(f.id === 'payout-trust' && f.cases.join() === 'undeclared') ||
      !theirs.some(t => /trust/i.test(t.id ?? '') && (!t.route || t.route === f.route)),
  );
  let liveReport = null;
  if (live)
    liveReport = await liveReview(live, {
      routes: server.routes,
      keys: [...new Set(voucherGrants(spec).flatMap(g => g.vouchers))],
      testKey: server.facts.testKey ?? null,
      economyPath: file ? posix(path.relative(home, file)) : null,
      localLive: spec?.live ?? null,
      vouchers: server.facts.vouchers,
      fetchImpl,
    });
  // the live key, once the live server has said it: its address and the grants that name it
  const liveKey = liveReport?.key?.publicKey ?? null;
  const custody = server.custody.map(k =>
    k.key === 'live' && liveKey
      ? {
          ...k,
          address: liveKey,
          signs: voucherGrants(spec)
            .filter(g => g.vouchers.includes(liveKey))
            .map(g => g.key),
          signsKnown: true,
        }
      : k,
  );
  const findings = [...theirs.map(f => ({ source: 'economy', ...f })), ...own, ...(liveReport?.findings ?? [])].sort(
    (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity),
  );
  const r = {
    ok: !findings.some(f => f.severity === 'high'),
    game: path.basename(path.resolve(dir)),
    at: now.toISOString(),
    xcore: `${PACKAGE.name} ${PACKAGE.version}`,
    counts: counts(findings),
    findings,
    economy,
    server: { facts: server.facts, routes: server.routes, work: server.work },
    ledger: server.ledger,
    custody,
    designCode: designed,
    live: liveReport,
    ...(liveReport ? {} : { liveWhy }),
    tradeoffs: tradeoffs(spec, { economy, facts: server.facts, ledger: server.ledger }),
    ...toldLines({
      economy: told,
      ledger: server.ledger,
      custody,
      work: server.work,
      plan: folderPlan(dir),
      design: designed,
    }),
    told: {
      economy: file && spec ? (told.why ? null : 'xsolana check') : null,
      ...(told.why ? { why: told.why } : {}),
    },
  };
  const outDir = out ? path.resolve(out) : await nextOut(dir);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'review.json'), JSON.stringify(r, null, 2) + '\n');
  await writeFile(path.join(outDir, 'review.md'), reviewMarkdown(r));
  return { ...r, outDir };
}

// ---- The nudge publish gives ------------------------------------------------------------------------------------------

/** The newest change to a file or under a folder (hidden files and node_modules left out), in ms; 0 when none. */
function newest(p) {
  let t = 0;
  const walk = q => {
    let s;
    try {
      s = statSync(q);
    } catch {
      return;
    }
    if (s.isDirectory()) {
      for (const e of readdirSyncSafe(q)) if (!e.startsWith('.') && e !== 'node_modules') walk(path.join(q, e));
    } else t = Math.max(t, s.mtimeMs);
  };
  walk(p);
  return t;
}
function readdirSyncSafe(q) {
  try {
    return readdirSync(q);
  } catch {
    return [];
  }
}

/**
 * One line for publish when the game pays results through voucher grants and no review (evidence/review-N/) is newer
 * than its economy file and server/; else null. A nudge only: publish goes on.
 */
export function reviewNudge(dir) {
  let file;
  try {
    file = economyFile(economyHome(dir));
  } catch {
    return null;
  }
  if (!file || !voucherGrants(readJson(file)).length) return null;
  const changed = Math.max(newest(file), newest(path.join(dir, 'server')));
  let reviewed = 0;
  for (const e of readdirSyncSafe(path.join(dir, 'evidence')))
    if (/^review-\d+$/.test(e)) reviewed = Math.max(reviewed, newest(path.join(dir, 'evidence', e, 'review.json')));
  if (reviewed > changed) return null;
  return `This game pays results through voucher grants, and ${CMD} review has not run since its economy or server/ changed: run it before players are paid (it says what a cheater gets, and what to fix).`;
}

/** The environment a review runs in: XSOLANA_RPC_URL the person's own, else the shared relay on devnet, else unset. */
function reviewEnv(env, cluster) {
  const own = env.XSOLANA_RPC_URL?.trim();
  if (own) return { ...env, XSOLANA_RPC_URL: own };
  const rpc = solanaRpc(env, { cluster });
  if (rpc.shared && cluster === 'mainnet') {
    const { XSOLANA_RPC_URL: _unset, ...rest } = env;
    return rest;
  }
  return { ...env, XSOLANA_RPC_URL: rpc.url };
}
