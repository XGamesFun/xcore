// xgames.fun's side of a game's own sign-in, on this machine, for `xcore dev`: what gamesfun.js asks of xgames.fun
// when the page signs in by itself, answered here the way the published game is answered, so a developer sees what a
// player will.
//
//   GET  /platform/v1/signin/v1.js                 the sign-in client a game's own host can serve
//                                                  (../signin-client.mjs): the page asks for it as it loads and runs
//                                                  it in place of the copy it carries
//   GET  /api/player/v1/session?slug=&tab=         the question asked with no tap, as the page loads and before the
//                                                  token's hour ends: {player, token, expires} for a player who signed
//                                                  in to this game by a tap and has not signed out, else
//                                                  {player: null}
//   POST /api/player/v1/session/forget {slug, tab} Sign out: nobody is named to the page again until a tap
//   GET  /api/player/v1/x/begin?slug=&tab=&back=   Sign in, which takes the tab to X and back (the top window of the
//        /api/player/v1/google/begin               game's page): there is no X here, so the player is signed in at
//                                                  once and the tab sent back to `back`, where the page loads afresh
//                                                  and finds them
//
// One thing differs from xgames.fun, and it is why `tab` is there: xgames.fun remembers a browser (a cookie of its own
// site), so every tab is the same player; here each tab is its own player, so two tabs can play a room together, and
// the page says which tab it is. Any page on this machine can name any tab: this is a stand-in, not a sign-in.
import { readFileSync } from 'node:fs';
import { SIGNIN_FILE, SIGNIN_PATH } from '../signin-client.mjs';

const SESSION = '/api/player/v1/session';
const FORGET = '/api/player/v1/session/forget';
const BEGIN = /^\/api\/player\/v1\/(x|google)\/begin$/;
const json = (res, status, body) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
  return true;
};
async function readJson(req, cap = 4096) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > cap) return {};
    chunks.push(c);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
/** Where a sign-in may send the tab back to: a page of this dev host's own game, and nowhere else. → its URL, or null */
export function backHere(back, host) {
  let u;
  try {
    u = new URL(String(back ?? ''));
  } catch {
    return null;
  }
  return u.protocol === 'http:' && u.host === host && u.pathname.startsWith('/game/') ? u : null;
}

/** → true when the request was one of the sign-in routes above (answered), else false. `s`: the platform store. */
export async function handleSignin(req, res, url, s) {
  const p = url.pathname,
    m = req.method;
  if (p === SIGNIN_PATH) {
    if (m !== 'GET' && m !== 'HEAD') return json(res, 405, { ok: false, code: 'method', why: 'GET only.' });
    // read on each request, never kept by the browser: a newer xcore's client is the one the next load runs
    const text = readFileSync(SIGNIN_FILE);
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'content-length': text.length,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(m === 'HEAD' ? undefined : text);
    return true;
  }
  // a page may ask only for the game it is: here, the one game this dev host serves
  const own = slug => slug === null || slug === undefined || slug === '' || slug === s.slug;
  if (p === SESSION && m === 'GET') {
    const session = own(url.searchParams.get('slug')) ? await s.signinSession(url.searchParams.get('tab')) : null;
    return json(res, 200, session ?? { player: null });
  }
  if (p === FORGET && m === 'POST') {
    const b = await readJson(req);
    if (own(b.slug)) await s.signinForget(b.tab);
    return json(res, 200, { ok: true });
  }
  if (BEGIN.test(p) && m === 'GET') {
    const back = backHere(url.searchParams.get('back'), req.headers.host);
    if (!back || !own(url.searchParams.get('slug')))
      return json(res, 400, { error: 'A sign-in comes back to a page of this game: /game/ on this host.' });
    await s.signinRemember(url.searchParams.get('tab'), '');
    res.writeHead(302, { location: back.href, 'cache-control': 'no-store' });
    res.end();
    return true;
  }
  return false;
}
