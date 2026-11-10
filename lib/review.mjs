// `xcore review`: the security review of a brought game, as a cheater would read it. Three parts, and the trade-offs
// for the person:
//   the economy   @xgamesfun/solana's own review of the economy file (`xsolana review --json`): each route that pays,
//                 what it trusts, its ceiling, its findings, and `tradeoffs` (words for the person). An installed
//                 package without `review` is said in one line, and the rest of the review goes on.
//   the server    this package's own static reading of server/ and the page: PAY.check written or still the template,
//                 one that pays from the request alone, VOUCHERS.payOnly against the grants, the voucher key and the
//                 grants that name it, `trust` on each voucher grant, .dev.vars in git or in the published folder, a
//                 seed in the page's files, a server of the game's own that does work before (or without) checking a
//                 player's token, and every api/ route the code names (for the live part).
//   live          (--live) each route asked with no sign-in and with a forged one, GET and POST; api/vouchers/key
//                 against the grants' keys; the published economy file's `live` against this folder's. Read-only:
//                 nothing it sends could spend or sign (a route that pays gets an empty body).
// The record goes in <game>/evidence/review-N/ (review.md and review.json), as the page check's goes in verify-N/.
// docs/SERVER.md, "How much your server can check", is the guide the findings point to.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CMD } from './command.mjs';
import { economyFile, solanaCommand, solanaHas, solanaRoot } from './economy.mjs';
import { pageRoots } from './publish/page.mjs';
import { isBinaryPath, scanFile } from './publish/scan.mjs';
import { solanaRpc } from './solana-rpc.mjs';

/** How much the server holding a grant's voucher key checks before it signs, strongest first (the grant's `trust`). */
export const TRUST = ['decides', 'replays', 'bounds'];
export const SEVERITIES = ['high', 'medium', 'low', 'info'];
const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const GUIDE = 'docs/SERVER.md, "How much your server can check"';
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
function braced(code, at) {
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
  const b = check.body;
  return /\bgrant\s*:/.test(b) && !/\benv\b/.test(b) && !/\bfetch\s*\(/.test(b) && !/\bthis\b/.test(b);
}

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
    env: { ...env, XSOLANA_RPC_URL: env.XSOLANA_RPC_URL?.trim() || solanaRpc(env).url },
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
const XCORE_PARTS = new Set(['database.js', 'gf-docs.js', 'gf-db.js', 'rooms.js', 'rpc.js', 'vouchers.js']);
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
/** The functions (and methods) `code` defines: [{name, body}]. A body is its braces, or an arrow's line. */
function definitions(code) {
  const out = [];
  const add = (name, from) => {
    const brace = code.indexOf('{', from);
    const eol = code.indexOf('\n', from);
    const body =
      brace >= 0 && (eol < 0 || brace < eol)
        ? (braced(code, brace) ?? '')
        : code.slice(from, eol < 0 ? undefined : eol);
    out.push({ name, body });
  };
  for (const m of code.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g)) add(m[1], m.index + m[0].length);
  for (const m of code.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\b|function\b|\(|[A-Za-z_$][\w$]*\s*=>)/g,
  ))
    add(m[1], m.index + m[0].length);
  for (const m of code.matchAll(/^[ \t]*(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/gm))
    if (!/^(?:if|for|while|switch|catch|function|return|fetch)$/.test(m[1])) add(m[1], m.index + m[0].length - 1);
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
/** A binding from a package whose name says it checks a sign-in (a router's jwt or auth middleware). */
const PACKAGE_CHECK =
  /\bimport\s*\{([^}]*)\}\s*from\s*['"](?![./])[^'"]+['"]|\bimport\s+([A-Za-z_$][\w$]*)\s+from\s*['"](?![./])[^'"]+['"]/g;
const packageChecks = code =>
  [...code.matchAll(PACKAGE_CHECK)].some(m => /jwt|auth|verif|session|bearer/i.test(`${m[1] ?? ''} ${m[2] ?? ''}`));
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

/**
 * The server's part: facts, findings and routes. `spec`: the economy (or null); `economy`: its file; `addressOf(seed)`:
 * a seed's address (the test key's), or null when it cannot be had.
 */
export async function serverReview(dir, { spec = null, economy = null, available = false, addressOf = null } = {}) {
  const roots = pageRoots(dir);
  const findings = [];
  const add = (...a) => findings.push(finding('server', ...a));
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
  const vouchersFile = path.join(dir, 'server', 'vouchers.js');
  const keeper = /\bloot\s*\.\s*report\s*\(/.test(serverCode);
  if (existsSync(vouchersFile)) {
    facts.vouchers = true;
    const v = readVouchers(await readFile(vouchersFile, 'utf8'));
    facts.pay = v.template ? 'template' : v.check ? 'written' : 'unreadable';
    facts.payOnly = v.payOnly;
    if (v.template)
      add(
        'pay-unwritten',
        'info',
        'PAY.check in server/vouchers.js is still the template: the server pays no result yet.',
        `Write PAY.check with the person: what the server checks before a result pays (${GUIDE}).`,
      );
    else if (paysFromRequest(v.check)) {
      const said = [...new Set(grants.map(g => g.trust).filter(Boolean))];
      // with no body read, it pays every signed-in player who asks (a daily gift, say): by design, perhaps, but nothing
      // they did is checked; with the body read, the page's own words decide what is paid
      const body = /\bbody\b/.test(v.check.body);
      add(
        'pay-from-request',
        body ? 'high' : 'medium',
        `PAY.check pays from the ${body ? "page's request" : 'sign-in'} alone: it never reads env (no record of a run the server started, no clock, no replay), so ${body ? 'a script that sends the request is paid' : 'every signed-in player who asks is paid, whatever they did'}.${said.length ? ` The grants declare trust "${said.join('", "')}", which this check does not do.` : ''}`,
        `Check the result against what the server itself keeps (a run it started and timed, a replay, a match it ran), and declare that level as the grant's trust (${GUIDE}).`,
      );
    }
    if (!grants.length && spec)
      add(
        'vouchers-unnamed',
        'medium',
        'server/vouchers.js signs vouchers, but no grant in the economy names a voucher key: nothing it signs can be claimed.',
        `Put the server's key in the grant that pays results: "vouchers": ["<the address ${CMD} secret set VOUCHER_SEED --new-key printed>"].`,
      );
    const perPerson = grants.filter(g => Number(g.limits?.perPerson ?? 0) > 0);
    const farmable = grants.filter(g => !(Number(g.limits?.perPerson ?? 0) > 0));
    if (v.payOnly === 'any' && perPerson.length)
      add(
        'payonly-any-perperson',
        'medium',
        `VOUCHERS.payOnly is 'any', but ${perPerson.map(g => `"${g.key}"`).join(', ')} count${perPerson.length === 1 ? 's' : ''} people (perPerson): a player signed in with a wallet only gets past payOnly and is then refused (person), so their claims fail.`,
        "Set VOUCHERS.payOnly to 'x' in server/vouchers.js, so the page asks them to sign in with X first.",
        perPerson.map(g => `grant:${g.key}`).join(', '),
      );
    for (const g of v.payOnly === 'any' ? farmable : []) {
      const capped = Number(g.limits?.perDay ?? 0) > 0 || Number(g.limits?.total ?? 0) > 0;
      add(
        'payonly-any-farmable',
        capped ? 'medium' : 'high',
        `"${g.key}" pays any signed-in player (VOUCHERS.payOnly 'any') and does not count people (no perPerson): a wallet is free, so one person claims it again from every wallet they make${capped ? ', up to its perDay or total' : ', with no total to stop them'}.`,
        `For a reward worth farming: VOUCHERS.payOnly 'x' and "perPerson" in the grant's limits; and a perDay total on every grant.`,
        `grant:${g.key}`,
      );
    }
  } else if (grants.length && !keeper && !/\bsignVoucher\s*\(/.test(serverCode))
    add(
      'vouchers-no-signer',
      'medium',
      `The economy's grants name voucher keys (${grants.map(g => `"${g.key}"`).join(', ')}), but nothing in this game signs a voucher: no server/vouchers.js, no env.GF.loot.report (the keeper), no signVoucher.`,
      `Give the server its key (${CMD} add vouchers) or report results to the keeper (docs/SERVER.md, "Paying a result"); a key held by a backend of your own is fine: say so to the person.`,
    );

  // trust, on each grant a voucher pays (the economy's own review says it when it can)
  for (const g of grants) {
    if (g.trust === undefined) {
      add(
        'trust-undeclared',
        available ? 'medium' : 'info',
        `"${g.key}" pays with a voucher and does not say how much its server checks before signing ("trust").`,
        available
          ? `Declare it honestly, as PAY.check really does it: "trust": "decides", "replays" or "bounds" (${GUIDE}).`
          : `Once the installed @xgamesfun/solana takes it (the one with xsolana review; 0.25.0 refuses the field), declare "trust": "decides", "replays" or "bounds" as PAY.check really does it (${GUIDE}).`,
        `grant:${g.key}`,
      );
    } else if (!TRUST.includes(g.trust))
      add(
        'trust-unknown',
        'medium',
        `"${g.key}" declares trust "${g.trust}", which is none of ${TRUST.join(', ')}.`,
        `Use one of "decides", "replays" or "bounds" (${GUIDE}).`,
        `grant:${g.key}`,
      );
  }

  // .dev.vars: the test key's seed
  const seed = devSeed(dir);
  if (existsSync(path.join(dir, '.dev.vars'))) {
    const g = gitState(dir, '.dev.vars');
    if (g.git && g.tracked)
      add(
        'dev-vars-tracked',
        'high',
        ".dev.vars is tracked by git: its secrets (the test voucher key's seed) are in the repository's history, and in every copy of it.",
        `git rm --cached .dev.vars, add .dev.vars to .gitignore, and make new keys: delete VOUCHER_SEED from .dev.vars and run ${CMD} add vouchers again (and take the old test key out of every grant).`,
      );
    else if (g.git && !g.ignored)
      add(
        'dev-vars-not-ignored',
        'low',
        '.dev.vars is not in .gitignore: the next `git add .` commits its secrets.',
        'Add .dev.vars to .gitignore.',
      );
  }
  for (const folder of [...new Set([roots.out, roots.static, roots.overlay].filter(Boolean))])
    if (folder !== path.resolve(dir) && existsSync(path.join(folder, '.dev.vars')))
      add(
        'dev-vars-published-folder',
        'medium',
        `${posix(path.relative(dir, path.join(folder, '.dev.vars')))} is inside the folder the page is served from: xgames.fun leaves hidden files out, but any other host that serves the folder serves it.`,
        'Keep .dev.vars at the top of the game folder only, beside gamesfun.json.',
      );
  if (seed && addressOf) {
    const test = await addressOf(seed).catch(() => null);
    const using = test ? grants.filter(g => g.vouchers.includes(test)) : [];
    facts.testKey = test;
    if (using.length)
      add(
        'test-key-in-grant',
        'medium',
        `${using.map(g => `"${g.key}"`).join(', ')} name${using.length === 1 ? 's' : ''} the test key (its seed is in .dev.vars): anyone with a copy of this folder signs claims for ${using.length === 1 ? 'it' : 'them'}.`,
        'Take the test key out of the grant before the economy holds anything of value; keep only the live key, which only xgames.fun holds.',
        using.map(g => `grant:${g.key}`).join(', '),
      );
  }

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
  for (const h of hits) {
    if (seen.has(`${h.path} ${h.kind}`)) continue;
    seen.add(`${h.path} ${h.kind}`);
    add(
      'secret-in-page',
      'high',
      `${h.path}${h.line ? `:${h.line}` : ''} holds ${/^an? |^the /.test(h.kind) ? h.kind : `a ${h.kind}`}: the page's files are public, and a key there signs for anyone.`,
      `Take it out of the page: a voucher key lives only on the server (${CMD} secret set VOUCHER_SEED --new-key), and one that was ever in the page is a new key (take the old one out of every grant).`,
    );
  }
  facts.economy = economy ? posix(path.relative(dir, economy)) : null;
  return {
    facts,
    findings,
    routes: [...routes].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, from]) => ({ path: p, from })),
  };
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

/** Each level in plain words: how the server checks, what a cheater gets, and what the stronger level costs. */
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
};

/** A grant's limits in words, as they cap a cheater. */
function ceilingWords(g, payOnly) {
  const l = g.limits ?? {};
  const out = [];
  if (Number(l.perPerson) > 0)
    out.push(`${l.perPerson} a person (an X account${payOnly === 'x' ? '' : ': only with payOnly "x"'})`);
  if (Number(l.perWallet) > 0) out.push(`${l.perWallet} a wallet (a wallet is free)`);
  if (Number(l.perDay) > 0) out.push(`${l.perDay} a day in all`);
  if (Number(l.total) > 0) out.push(`${l.total} in all`);
  return out.length ? out.join(', ') : 'no limit in the grant';
}

/** The paid routes, each with its level, what a cheater gets and what the stronger level costs. */
export function tradeoffs(spec, { economy = null, facts = {} } = {}) {
  return voucherGrants(spec).map(g => {
    const own = economy?.routes?.find(r => r.key === g.key && (!r.kind || /grant/i.test(r.kind)));
    const trust = TRUST.includes(g.trust) ? g.trust : TRUST.includes(own?.trust) ? own.trust : null;
    const level = LEVELS[trust] ?? null;
    return {
      route: `grant:${g.key}`,
      name: g.name ?? g.key,
      trust,
      declared: g.trust !== undefined,
      how:
        level?.words ??
        'not declared: read PAY.check in server/vouchers.js and say which of decides, replays or bounds it does',
      cheater: `${level ? level.cheater : `it rests on what PAY.check checks: if it only bounds the result, ${LEVELS.bounds.cheater}; if it decides it, ${LEVELS.decides.cheater}`}; capped at ${ceilingWords(g, facts.payOnly)}`,
      // the economy review's own ceiling: what the chain lets one route pay, and what it feeds
      ceiling: own?.ceiling ? String(own.ceiling) : null,
      stronger: level?.stronger ?? null,
    };
  });
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

/** What the server does about paying, in words: PAY.check and VOUCHERS.payOnly. */
function serverWords(f) {
  const pay =
    { template: 'is still the template (it pays nothing yet)', written: 'is written' }[f.pay] ?? 'was not found';
  const who = {
    x: ' (only players signed in with X, a person each)',
    any: ' (any signed-in player: a wallet is free)',
  };
  return `PAY.check ${pay}; VOUCHERS.payOnly ${f.payOnly ? `'${f.payOnly}'${who[f.payOnly] ?? ''}` : 'not found'}`;
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
  for (const t of r.tradeoffs)
    lines.push(
      `### ${t.name} (\`${t.route.replace(/^grant:/, '')}\`)`,
      '',
      `- **How the server checks it**: ${t.trust ? `${t.trust}${t.declared ? '' : ' (from the economy review; not declared in the grant)'}: ` : ''}${t.how}.`,
      `- **What a cheater gets**: ${t.cheater}.`,
      ...(t.ceiling ? [`- **The economy review's ceiling**: ${t.ceiling.replace(/\.$/, '')}.`] : []),
      ...(r.server.facts.vouchers ? [`- **Its server**: ${serverWords(r.server.facts)}.`] : []),
      ...(t.stronger ? [`- **The stronger level**: ${t.stronger}.`] : []),
      '',
    );
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
  const addressOf = async seed => (await import('./add.mjs')).seedAddress(seed);
  const server = await serverReview(dir, { spec, economy: file, available: economy.available, addressOf });
  // the economy review says what it says about trust; this package's own line on it only when it says nothing
  const theirs = economy.available ? economy.findings : [];
  const own = server.findings.filter(
    f =>
      f.id !== 'trust-undeclared' || !theirs.some(t => /trust/i.test(t.id ?? '') && (!t.route || t.route === f.route)),
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
    server: { facts: server.facts, routes: server.routes },
    live: liveReport,
    ...(liveReport ? {} : { liveWhy }),
    tradeoffs: tradeoffs(spec, { economy, facts: server.facts }),
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
