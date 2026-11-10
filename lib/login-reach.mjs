// What an `xcore login` reaches. xgames.fun's approval page asks the developer which games the command line may work
// on: the games they tick (and any game they publish as new from that sign-in), or their whole account. The token
// exchange answers which ({scope: 'games', games: [ids]} or {scope: 'account'}); this module says it after sign-in,
// keeps it beside the sign-in's public record (kit-reach.json in the config folder, keyed by the token's id: never a
// secret), and words a refusal for a game the sign-in was not given (xgames.fun's 'not-granted', 403) as what it is,
// with what to do. A sign-in's games grow after it is made (a game it publishes as new joins them), so `xcore login
// --status` and a refusal ask xgames.fun for them again (GET /api/kit/plan lists the games the sign-in reaches) and
// keep the answer; when xgames.fun cannot be asked, the saved list stands, said to be possibly out of date.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configDir, listEntries } from './credentials.mjs';
import { call, credentialKey, login, savedLogin, storeWords, studioOrigin } from './publish/client.mjs';
import { CMD } from './command.mjs';

const reachFile = env => path.join(configDir({ env }), 'kit-reach.json');
async function readAll(env) {
  try {
    const v = JSON.parse(await readFile(reachFile(env), 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
async function writeAll(env, all) {
  const file = reachFile(env);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(`${file}.${process.pid}.tmp`, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
  await rename(`${file}.${process.pid}.tmp`, file);
}

/** The reach xgames.fun gave in a token exchange's answer: {scope, games: [id] | null}, or null when it says none. */
function reachOf(answer) {
  if (answer?.scope === 'account') return { scope: 'account', games: null };
  if (answer?.scope === 'games')
    return { scope: 'games', games: Array.isArray(answer.games) ? answer.games.map(String) : [] };
  return null;
}

/**
 * `xcore login` (../lib/publish/client.mjs login, with the same options) that also learns what the sign-in reaches,
 * names those games (GET /api/kit/plan lists the games the sign-in reaches, with their titles; when it does not answer,
 * the ids stand) and keeps it for --status. → login's answer and {scope: 'games' | 'account' | null, games: [{id,
 * title, slug}] | null}
 */
export async function loginWithReach({ origin = studioOrigin(), env = process.env, fetchImpl = fetch, ...opts } = {}) {
  let exchanged = null;
  const watching = async (url, init) => {
    const res = await fetchImpl(url, init);
    if (String(url) === `${origin}/api/kit/token` && init?.method === 'POST' && res.ok)
      exchanged = await res
        .clone()
        .json()
        .catch(() => null);
    return res;
  };
  const r = await login({ origin, env, fetchImpl: watching, ...opts });
  const reach = reachOf(exchanged);
  if (!reach) return { ...r, studio: origin, scope: null, games: null };
  let games = null;
  if (reach.scope === 'games') {
    const titles = new Map();
    if (reach.games.length)
      try {
        for (const g of gamesOf(await call(origin, '/api/kit/plan', { token: exchanged.token, fetchImpl })))
          titles.set(g.id, g);
      } catch {
        /* the ids stand */
      }
    games = reach.games.map(id => titles.get(id) ?? { id, title: null, slug: null });
  }
  const all = await readAll(env);
  all[credentialKey(origin)] = { tokenId: exchanged?.tokenId ?? null, scope: reach.scope, games };
  await writeAll(env, all);
  return { ...r, studio: origin, scope: reach.scope, games };
}

/** What this computer's sign-in to `origin` reaches, as kept at sign-in: {scope, games} or null (none kept). */
export async function readReach(origin = studioOrigin(), { env = process.env } = {}) {
  const k = credentialKey(origin);
  const kept = (await readAll(env))[k];
  const entry = (await listEntries({ env }))[k];
  // only for the sign-in it was kept for: another login since (from an older xcore) leaves it unknown
  if (!kept || !entry || (kept.tokenId ?? null) !== (entry.tokenId ?? null)) return null;
  return { scope: kept.scope, games: kept.games ?? null };
}

/** The games GET /api/kit/plan lists for the sign-in, as {id, title, slug}. */
const gamesOf = plan =>
  (Array.isArray(plan?.games) ? plan.games : [])
    .filter(g => g && typeof g.id === 'string')
    .map(g => ({
      id: g.id,
      title: typeof g.title === 'string' ? g.title : null,
      slug: typeof g.slug === 'string' ? g.slug : null,
    }));

/**
 * What this computer's sign-in to `origin` reaches now: its scope as given at sign-in (a sign-in's scope never
 * changes), and for one given games, those games as xgames.fun lists them now, kept for next time. → {scope, games,
 * checked: true} (xgames.fun answered), {scope, games, checked: false} (the saved copy: xgames.fun could not be asked),
 * or null (not known: no sign-in, or one made by an older xcore).
 */
export async function currentReach(origin = studioOrigin(), { env = process.env, fetchImpl = fetch } = {}) {
  const saved = await readReach(origin, { env });
  if (!saved) return null;
  if (saved.scope !== 'games') return { ...saved, checked: true };
  try {
    const s = await savedLogin(origin, { env });
    if (!s?.token) throw new Error('no token');
    const plan = await call(origin, '/api/kit/plan', { token: s.token, fetchImpl });
    // an answer that is not a list of games (a page, {}, games of another shape) is no answer: the saved copy stands
    if (!Array.isArray(plan?.games) || !plan.games.every(x => x && typeof x === 'object' && typeof x.id === 'string'))
      throw new Error('not a list of games');
    const games = gamesOf(plan);
    const all = await readAll(env);
    const k = credentialKey(origin);
    if (all[k]) {
      all[k] = { ...all[k], games };
      await writeAll(env, all);
    }
    return { scope: 'games', games, checked: true };
  } catch {
    return { ...saved, checked: false };
  }
}

/** Forget what the sign-in to `origin` reaches (`xcore logout`). */
export async function forgetReach(origin = studioOrigin(), { env = process.env } = {}) {
  const all = await readAll(env);
  if (!(credentialKey(origin) in all)) return;
  delete all[credentialKey(origin)];
  await writeAll(env, all);
}

const gameName = g => (g.title ? `${g.title}${g.slug ? ` (${g.slug})` : ''}` : g.slug || g.id);
const MAYBE_OLD =
  ' (xgames.fun could not be asked just now, so this is the list saved at sign-in or at the last check, and may be out of date.)';
/** The reach in a sentence: "This sign-in reaches …". '' when it is not known. `checked: false`: said to be saved. */
export function reachWords(reach) {
  if (reach?.scope === 'account') return 'This sign-in reaches your whole account: every game, now and later.';
  if (reach?.scope !== 'games') return '';
  const games = reach.games ?? [];
  const old = reach.checked === false ? MAYBE_OLD : '';
  if (!games.length)
    return `This sign-in reaches none of your games yet: a game you publish as new from here is added to it. To work on a game you have, run ${CMD} login again and tick it.${old}`;
  return (
    `This sign-in reaches ${games.length} of your games: ${games.map(gameName).join(', ')}. ` +
    `A game you publish as new from here is added to it; for another, run ${CMD} login again and tick it.${old}`
  );
}

/** What `xcore login` prints once signed in. */
export function loginWords(r) {
  const reach = reachWords(r);
  return (
    `Signed in to ${r.studio ?? studioOrigin()} as ${r.email}.${reach ? ` ${reach}` : ''} The token is kept in ` +
    `${storeWords(r.store)} until ${new Date(r.expiresAt).toISOString().slice(0, 10)}. Next: ${CMD} publish`
  );
}

/**
 * A refusal for a game the sign-in was not given (code 'not-granted'), in plain words with what to do, naming what the
 * sign-in does reach when that is known. The error is changed in place (message, next). → the error
 */
export async function explainNotGranted(e, { env = process.env } = {}) {
  let reach = null;
  try {
    reach = await currentReach(studioOrigin(env), { env });
  } catch {
    /* unknown */
  }
  const has =
    reach?.scope === 'games'
      ? reach.games?.length
        ? ` This sign-in reaches: ${reach.games.map(gameName).join(', ')}.`
        : ' This sign-in reaches none of your games yet.'
      : '';
  const old = reach?.scope === 'games' && reach.checked === false ? MAYBE_OLD : '';
  e.message =
    `xgames.fun refused this: your sign-in (${CMD} login) was not given this game. Run ${CMD} login again and tick ` +
    `this game on the approval page (or choose your whole account).${has}${old}`;
  e.next = `${CMD} login`;
  return e;
}
