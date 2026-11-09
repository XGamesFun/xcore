// The game's live operations on this machine, for `xcore dev`. Hosted, the game's owner sets an announcement, a remote
// config and maintenance mode on xgames.fun/console (the Live tab), and the play edge answers GET /platform/v1/live
// itself (gamesfun.js's gf.live). Here they come from a file the creator writes, read again on every request:
//
//   <game>/.gamesfun/live.json   (a hidden folder: never published)
//   {
//     "announcement": {"text": "Double XP all weekend!", "level": "info", "startsAt": "2026-11-09T18:00:00Z", "endsAt": null},
//     "config": {"difficulty": "hard", "event": true},
//     "maintenance": {"message": "Back at 7pm"}          // or true, or null / left out: not paused
//   }
//
// The rules are the hosted ones (xgames.fun's play edge, parseLive): the announcement only between its start and end,
// plain text cut to 280 characters, info or warning; the config a JSON object of at most 8,192 bytes (a bigger one, or
// one that is not an object, is left out here and said in the log: xgames.fun refuses it). While maintenance is on, the
// dev host serves the holding page for the game's HTML pages and answers 503 {ok: false, code: 'maintenance'} to its
// /game/api/* and /platform/v1/* (but /platform/v1/live and the local sign-in), as xgames.fun does.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Shown to people as written (the same on Windows); path.join(dir, LIVE_FILE) still reads it there.
export const LIVE_FILE = '.gamesfun/live.json';
export const LIVE_TEXT_CHARS = 280;
export const LIVE_CONFIG_BYTES = 8192;
export const MAINTENANCE_DEFAULT = 'This game is paused for maintenance. It will be back soon.';
export const LIVE_EMPTY = Object.freeze({ announcement: null, config: {}, version: 0, maintenance: null });

// eslint-disable-next-line no-control-regex -- control characters never reach a player's screen (tabs and new lines may)
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
const text = (v, max) => (typeof v === 'string' ? v.replace(CONTROL, '').trim().slice(0, max) : '');
const time = v => {
  const t = typeof v === 'number' ? v : typeof v === 'string' && v ? Date.parse(v) : NaN;
  return Number.isFinite(t) && t > 0 ? t : null;
};

/**
 * The file's value → {live: {announcement, config, version, maintenance} as players would get it at `now`, problems:
 * [words]}. Times may be ms or ISO text here (the console sends ms).
 */
export function parseLiveFile(value, now = Date.now()) {
  const problems = [];
  if (value === null || value === undefined) return { live: LIVE_EMPTY, problems };
  if (typeof value !== 'object' || Array.isArray(value))
    return { live: LIVE_EMPTY, problems: [`${LIVE_FILE} is a JSON object: {announcement, config, maintenance}.`] };
  let announcement = null;
  const a = value.announcement;
  if (a && typeof a === 'object' && text(a.text, LIVE_TEXT_CHARS)) {
    const startsAt = time(a.startsAt),
      endsAt = time(a.endsAt);
    if ([...a.text].length > LIVE_TEXT_CHARS)
      problems.push(`the announcement is cut to ${LIVE_TEXT_CHARS} characters (xgames.fun refuses a longer one)`);
    if (a.level !== undefined && a.level !== 'info' && a.level !== 'warning')
      problems.push(`an announcement's level is info or warning, not ${JSON.stringify(a.level)}`);
    if ((startsAt === null || startsAt <= now) && (endsAt === null || endsAt > now))
      announcement = {
        id: createHash('sha256').update(`${a.text}\n${startsAt}\n${endsAt}`).digest('hex').slice(0, 12),
        text: text(a.text, LIVE_TEXT_CHARS),
        level: a.level === 'warning' ? 'warning' : 'info',
        startsAt,
        endsAt,
      };
  } else if (a) problems.push('the announcement needs its text: {"text": "…"}');
  let config = {};
  const c = value.config;
  if (c !== undefined && c !== null) {
    const bytes = Buffer.byteLength(JSON.stringify(c));
    if (typeof c !== 'object' || Array.isArray(c)) problems.push('the config is a JSON object: {"difficulty": "hard"}');
    else if (bytes > LIVE_CONFIG_BYTES)
      problems.push(`the config is ${bytes} bytes as JSON; xgames.fun takes ${LIVE_CONFIG_BYTES} at most`);
    else config = c;
  }
  const m = value.maintenance;
  const maintenance =
    m === true || (m && typeof m === 'object')
      ? { message: text(m?.message, LIVE_TEXT_CHARS) || MAINTENANCE_DEFAULT, since: time(m?.since) ?? null }
      : null;
  const version = Object.keys(config).length ? (Number.isSafeInteger(value.version) ? value.version : 1) : 0;
  return { live: { announcement, config, version, maintenance }, problems };
}

/** Reads <game>/.gamesfun/live.json now. → {live, problems, exists}; never throws (a broken file is said, not fatal). */
export async function readLive(dir, now = Date.now()) {
  let raw;
  try {
    raw = await readFile(path.join(dir, LIVE_FILE), 'utf8');
  } catch {
    return { live: LIVE_EMPTY, problems: [], exists: false };
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    return { live: LIVE_EMPTY, problems: [`${LIVE_FILE} is not JSON: ${e.message}`], exists: true };
  }
  return { ...parseLiveFile(value, now), exists: true };
}

/** The holding page xgames.fun's play edge serves for the game's HTML while it is paused (503, never cached). */
export function maintenancePage(maintenance) {
  const esc = s =>
    s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  return (
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="60"><title>Back soon</title>' +
    '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0e;color:#d0d0d8;font:16px/1.5 system-ui,sans-serif">' +
    `<main style="max-width:32rem;padding:24px;text-align:center"><p style="margin:0 0 8px;font-weight:600;color:#fff">Paused for maintenance</p><p style="margin:0">${esc(maintenance.message)}</p>` +
    `<p style="margin:16px 0 0;font-size:13px;opacity:.6">xcore dev: ${LIVE_FILE} has maintenance on.</p></main></body>`
  );
}
/** The refusal of /api/* and /platform/v1/* while paused, as xgames.fun's play edge answers it. */
export const maintenanceBody = m => ({ ok: false, code: 'maintenance', why: m.message, since: m.since });

const LIVE_PATH = '/platform/v1/live';
/**
 * The dev host's live routes (./index.mjs route, tried before the platform's): GET /platform/v1/live from the file, and
 * while maintenance is on, the holding page for the game's HTML under /game/ and 503 'maintenance' for /game/api/* and
 * /platform/v1/* (not /platform/v1/live, nor the local sign-in /platform/v1/dev/*). → true when it answered.
 * `say(problems)`: the file's problems, each time they change.
 */
export function createLiveRoutes({ dir, apiAt = '/game/api/', say = () => {}, now = () => Date.now() }) {
  let said = '';
  const current = async () => {
    const r = await readLive(dir, now());
    const words = r.problems.join('; ');
    if (words !== said) {
      said = words;
      if (words) say(r.problems);
    }
    return r.live;
  };
  const isApi = p => p.startsWith(apiAt) || p === apiAt.slice(0, -1);
  const isPlatform = p => p.startsWith('/platform/v1/') && p !== LIVE_PATH && !p.startsWith('/platform/v1/dev/');
  const isPage = (p, method) =>
    (method === 'GET' || method === 'HEAD') &&
    p.startsWith('/game/') &&
    !isApi(p) &&
    (p.endsWith('/') || /\.html?$/i.test(p));
  const send = (res, status, type, body, extra = {}) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra });
    res.end(body);
    return true;
  };
  return {
    current,
    /** Whether a WebSocket upgrade to `pathname` is refused now (the game is paused). */
    async refuseUpgrade(pathname) {
      return isApi(pathname) && !!(await current()).maintenance;
    },
    async handle(req, res, url) {
      const p = url.pathname;
      if (p === LIVE_PATH && (req.method === 'GET' || req.method === 'HEAD'))
        return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, ...(await current()) }));
      if (!isApi(p) && !isPlatform(p) && !isPage(p, req.method)) return false;
      const m = (await current()).maintenance;
      if (!m) return false;
      if (isPage(p, req.method))
        return send(res, 503, 'text/html; charset=utf-8', maintenancePage(m), { 'retry-after': '60' });
      return send(res, 503, 'application/json; charset=utf-8', JSON.stringify(maintenanceBody(m)), {
        'retry-after': '60',
      });
    },
  };
}
