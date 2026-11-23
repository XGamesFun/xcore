// Work done before a token is checked: the game's own server files that do work for a request whose token they have
// not checked (a stranger's requests count toward what caps the game).
import path from 'node:path';
import { readJson } from '../util.mjs';
import { braced, codeOnly, definitions, wordsOfName } from './code.mjs';

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

/** The game's own server files: not the parts xcore writes, whose words are xcore's and no reading of the game. */
export const gameOwn = files =>
  files.filter(({ f, text }) => !XCORE_PARTS.has(f) && !(f === 'index.js' && /Written by `xcore add/.test(text)));

/** The findings for work done without, or before, a token check (see above). `files`: [{f, code (comments out), text}]. */
export function tokenFindings(dir, files, add) {
  const own = gameOwn(files).map(x => ({ ...x, bare: codeOnly(x.code) }));
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
export const OWN_COPIES = ['gf', 'gamesfun.js']; // xcore's and loot's copies in the page: not the game's own routes
