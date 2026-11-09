// The platform's services on this machine, for `xcore dev` (gf-server-v1, ../server/contract.mjs): one game's saves and
// scores, a local sign-in, and loot reports. Both sides of the dev host use this one store, so what the page saves
// through gamesfun.js the game's server reads through env.GF, as it would hosted:
//   - the game's server, through ./gf-local.js's HOST binding (handleHost),
//   - the page, through the dev host's /platform/v1/* routes (handlePlatform, below).
// Kept in <game>/.gamesfun/dev-platform.json (a hidden folder: never published), written a moment after each change.
// The game's project files (env.GF.files) are ./files.mjs's, in <game>/.gamesfun/dev/files/.
//
// Every answer has xgames.fun's shape: {ok: true, …} or {ok: false, code, why}. A refusal is an answer, never a throw,
// so a game's server reads it the same here as hosted. The limits are the hosted ones (PLATFORM_LIMITS), so a game
// that stays inside them here stays inside them there; the per-minute rate limits are left out on this machine.
//
// Local sign-in. No xgames.fun signs a player in on this machine, so the dev host hands out its own tokens
// (POST /platform/v1/dev/token): `gfdev1.<payload>.<HMAC-SHA256>`, signed with a key made when it starts and never
// written anywhere, for this game only, lasting an hour. verifyPlayer accepts exactly those; an xgames.fun token (EdDSA,
// from the play host) is refused here with words that say so.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PLATFORM_LIMITS as L,
  PLATFORM_PREFIX,
  SAVE_KEY,
  SERVER_FORMAT,
  checkLootResult,
  FILES,
} from '../server/contract.mjs';
import { createFileStore } from './files.mjs';

const TOKEN_MS = 60 * 60 * 1000;
/** How much of a stream with no declared length GF.files.put reads (xgames.fun's UNSIZED_MAX); a longer one needs it. */
const UNSIZED_MAX = 1024 * 1024;
// eslint-disable-next-line no-control-regex -- it exists to drop control characters
const UNSAFE = /[\u0000-\u001f<>]/g;
const NAME = s =>
  String(s ?? '')
    .replace(UNSAFE, '')
    .trim()
    .slice(0, L.scores.nameChars);
const no = (code, why) => ({ ok: false, code, why });
const okPlayer = p => typeof p === 'string' && p.length >= 1 && p.length <= L.saves.playerChars;

/**
 * One game's platform store. → {slug, gameId, run(op, args), handleHost(request), devToken({name, id}),
 * verifyPlayer(token), flush(), file, files (./files.mjs), setFilesOrigin(origin)}
 */
export function createPlatformStore({
  dir,
  slug = path.basename(path.resolve(dir)),
  log = () => {},
  now = () => Date.now(),
  file = path.join(dir, '.gamesfun', 'dev-platform.json'),
} = {}) {
  const key = randomBytes(32);
  const gameId = `dev-${slug}`.slice(0, 60);
  // the public files' origin: the dev host's files server, once it listens
  let filesOrigin = null;
  const files = createFileStore({ dir, origin: () => filesOrigin });
  let data = null,
    loading = null,
    timer = null,
    writing = Promise.resolve();
  // the file is read once: calls that come at once before it is read all wait on that one read, so none of them puts
  // a fresh copy of the file over what another has changed already
  const load = () =>
    (loading ??= readStore().catch(e => {
      loading = null; // read again next time
      throw e;
    }));
  const readStore = async () => {
    try {
      data = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      data = null;
    }
    if (!data || typeof data !== 'object') data = {};
    data.saves ??= {};
    data.boards ??= {};
    data.rules ??= {};
    // an older file kept a board's rule on the board
    for (const [name, b] of Object.entries(data.boards))
      if (b.writer) {
        data.rules[name] ??= b.writer;
        delete b.writer;
      }
    data.reports ??= [];
    return data;
  };
  const write = async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(data, null, 2) + '\n');
    await rename(`${file}.tmp`, file);
  };
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      writing = writing.then(write).catch(e => log(`dev platform: could not save ${file}: ${e.message}`));
    }, 150);
  };

  const sign = body => createHmac('sha256', key).update(body).digest('base64url');
  /** A local sign-in for a new or named player of this game. → {token, player, expires} */
  function devToken({ name = '', id = '' } = {}) {
    const pid = /^[a-z0-9]{6,24}$/.test(id) ? id : randomBytes(6).toString('hex');
    const exp = Math.floor((now() + TOKEN_MS) / 1000);
    const who = NAME(name) || `Player ${pid.slice(0, 4)}`;
    const payload = Buffer.from(
      JSON.stringify({ sub: `dev:${pid}`, aud: `game:${slug}`, name: who, lvl: 1, exp }),
    ).toString('base64url');
    const token = `gfdev1.${payload}.${sign(`gfdev1.${payload}`)}`;
    return {
      token,
      player: { id: `dev:${pid}`, name: who, level: 1, wallet: '', x: null, dev: true },
      expires: exp * 1000,
    };
  }
  /** env.GF.verifyPlayer, on this machine: xgames.fun's answer shape (no name: hosted it has none), plus `dev: true`. */
  function verifyPlayer(token) {
    const { name: _name, ...v } = readToken(token);
    return v;
  }
  /** The local sign-in token's claims as verifyPlayer answers them, plus the local player's `name` (the page's /me). */
  function readToken(token) {
    if (typeof token !== 'string' || !token) return no('bad', 'No token.');
    const parts = token.split('.');
    if (parts[0] !== 'gfdev1' || parts.length !== 3)
      return no(
        'bad',
        'In xcore dev only its own local sign-in tokens are checked (GamesFun.signIn() gets one); an xgames.fun token is checked when the game is hosted.',
      );
    const want = Buffer.from(sign(`gfdev1.${parts[1]}`)),
      got = Buffer.from(parts[2]);
    if (want.length !== got.length || !timingSafeEqual(want, got))
      return no(
        'key',
        'The token is not signed by this xcore dev (it signs with a key of its own; after a restart, sign in again).',
      );
    let c;
    try {
      c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      return no('bad', 'Not a game token.');
    }
    if (!(c.exp * 1000 > now())) return no('expired', 'The token has run out: sign in again.');
    if (c.aud !== `game:${slug}`) return no('game', 'The token is for another game.');
    return { ok: true, sub: c.sub, wallet: null, x: null, lvl: c.lvl | 0, exp: c.exp, dev: true, name: c.name };
  }

  const ranked = b =>
    [...b.rows].sort((x, y) => (b.order === 'low' ? x.score - y.score : y.score - x.score) || x.at - y.at);
  const rankOf = (b, score) => b.rows.filter(r => (b.order === 'low' ? r.score < score : r.score > score)).length + 1;
  const badPlayer = () => no('player', `A player id is 1–${L.saves.playerChars} characters.`);
  const badKey = () => no('key', 'A save key is 1–32 letters, digits, ".", "_" or "-".');
  const badBoard = () => no('board', 'A board name is 1–32 letters, digits, ".", "_" or "-" (or a pattern: daily-*).');
  // a rule names one board, or every board whose name starts with a prefix: `daily-*` (and `*`, every board)
  const PATTERN = /^[A-Za-z0-9_.-]{0,31}\*$/;
  const WRITERS = ['any', 'server'];
  const badWriter = () => no('writer', 'A board’s writer is "server" (only the game’s server submits) or "any".');
  const ops = {
    async 'saves.get'(player, k = 'main') {
      const d = await load();
      if (!okPlayer(player)) return badPlayer();
      if (!SAVE_KEY.test(String(k))) return badKey();
      const s = d.saves[player]?.[k];
      return { ok: true, value: s ? s.value : null, updatedAt: s?.updated ?? null };
    },
    async 'saves.put'(player, k, value) {
      const d = await load();
      if (!okPlayer(player)) return badPlayer();
      if (!SAVE_KEY.test(String(k))) return badKey();
      let text;
      try {
        text = JSON.stringify(value);
      } catch {
        text = undefined;
      }
      if (text === undefined) return no('value', 'A save is a JSON value.');
      const bytes = Buffer.byteLength(text);
      if (bytes > L.saves.valueBytes)
        return no(
          'too-big',
          `A save may be ${L.saves.valueBytes / 1024} KB; this one is ${Math.ceil(bytes / 1024)} KB.`,
        );
      const mine = (d.saves[player] ??= {});
      if (!mine[k] && Object.keys(mine).length >= L.saves.keysPerPlayer)
        return no('too-many', `A player may have ${L.saves.keysPerPlayer} saves.`);
      mine[k] = { value: JSON.parse(text), bytes, updated: now() };
      persist();
      return { ok: true, bytes };
    },
    async 'saves.delete'(player, k) {
      const d = await load();
      if (!okPlayer(player) || !SAVE_KEY.test(String(k))) return no('key', 'No such save.');
      const had = !!d.saves[player]?.[k];
      if (had) {
        delete d.saves[player][k];
        persist();
      }
      return { ok: true, deleted: had };
    },
    async 'saves.list'(player) {
      const d = await load();
      if (!okPlayer(player)) return badPlayer();
      const keys = Object.entries(d.saves[player] ?? {})
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, s]) => ({ key: k, bytes: s.bytes, updatedAt: s.updated }));
      return { ok: true, keys };
    },
    // `writer` ('server' | 'any') is the game's server's word only: the page's route never passes it (pageSubmit).
    async 'scores.submit'(board, player, score, { name = '', order = 'high', writer } = {}) {
      const d = await load();
      if (!SAVE_KEY.test(String(board))) return badBoard();
      if (!okPlayer(player)) return badPlayer();
      if (typeof score !== 'number' || !Number.isFinite(score)) return no('score', 'A score is a finite number.');
      if (typeof name !== 'string' || name.length > L.scores.nameChars)
        return no('name', `A name is at most ${L.scores.nameChars} characters.`);
      const b = ensureBoard(d, board, order, writer);
      if (b.ok === false) return b;
      let row = b.rows.find(r => r.player === player);
      if (row && now() - row.tried < L.scores.perPlayerEveryMs) return no('rate', 'One score a second a player.');
      const t = now(),
        improved = !row || (b.order === 'low' ? score < row.score : score > row.score);
      if (!row) b.rows.push((row = { player, name: NAME(name), score, at: t, tried: t }));
      else {
        row.tried = t;
        if (improved) Object.assign(row, { score, at: t, name: NAME(name) || row.name });
      }
      persist();
      return { ok: true, improved, best: row.score, rank: rankOf(b, row.score) };
    },
    /** The board's settings, made now when new: {order?, writer?: 'server' | 'any'} (xgames.fun's GF.scores.setup).
     * `board` may be a pattern (`daily-*`, `*`): then only the rule is kept, for those boards now and to come. */
    async 'scores.setup'(board, { order = 'high', writer } = {}) {
      const d = await load();
      if (typeof board === 'string' && PATTERN.test(board)) {
        if (!WRITERS.includes(writer)) return badWriter();
        const removed = d.rules[board] === writer ? 0 : setRule(d, board, writer);
        if (typeof removed !== 'number') return removed;
        persist();
        return { ok: true, board, writer, removed };
      }
      if (!SAVE_KEY.test(String(board))) return badBoard();
      const b = ensureBoard(d, board, order, writer);
      if (b.ok === false) return b;
      persist();
      return { ok: true, board, order: b.order, writer: writerOf(d, board), removed: b.removed };
    },
    /** The board, its entries and its own rule, gone: its place among the boards is free again (GF.scores.drop). */
    async 'scores.drop'(board) {
      const d = await load();
      if (!SAVE_KEY.test(String(board))) return badBoard();
      const b = d.boards[board];
      if (!b) return { ok: true, dropped: false, removed: 0 };
      delete d.boards[board];
      delete d.rules[board];
      persist();
      return { ok: true, dropped: true, removed: b.rows.length };
    },
    async 'scores.top'(board, { limit = 10, offset = 0 } = {}) {
      const d = await load();
      if (!SAVE_KEY.test(String(board))) return badBoard();
      const n = Math.min(Math.max(1, limit | 0), L.scores.topMax),
        skip = Math.max(0, offset | 0);
      const b = d.boards[board];
      if (!b) return { ok: true, order: null, writer: writerOf(d, board), entries: [] };
      const entries = ranked(b)
        .slice(skip, skip + n)
        .map(r => ({ rank: rankOf(b, r.score), player: r.player, name: r.name, score: r.score, at: r.at }));
      return { ok: true, order: b.order, writer: writerOf(d, board), entries };
    },
    async 'scores.best'(board, player) {
      const d = await load();
      if (!SAVE_KEY.test(String(board)) || !okPlayer(player)) return no('board', 'No such board or player.');
      const b = d.boards[board],
        r = b?.rows.find(x => x.player === player);
      return { ok: true, entry: r ? { rank: rankOf(b, r.score), score: r.score, name: r.name, at: r.at } : null };
    },
    async 'scores.remove'(board, player) {
      const d = await load();
      if (!SAVE_KEY.test(String(board)) || !okPlayer(player)) return no('board', 'No such board or player.');
      const b = d.boards[board],
        had = !!b?.rows.some(x => x.player === player);
      if (had) {
        b.rows = b.rows.filter(x => x.player !== player);
        persist();
      }
      return { ok: true, removed: had };
    },
    async 'loot.report'(result) {
      const d = await load();
      const bad = checkLootResult(result, now());
      if (bad) return bad;
      const entry = { id: `local-${d.reports.length + 1}`, at: now(), result };
      d.reports.push(entry);
      if (d.reports.length > 200) d.reports.shift();
      persist();
      log(
        `loot.report ${entry.id} (on this machine nothing is signed or paid; hosted, xgames.fun's keeper signs it with the game's host key; a voucher key of the server's own, xcore add vouchers, signs here too): ${JSON.stringify(result).slice(0, 300)}`,
      );
      return { ok: true, result: null, vouchers: [], local: true, id: entry.id };
    },
    async 'loot.status'() {
      return { ok: true, host: null, certified: false, game: null, local: true };
    },
    async verifyPlayer(token) {
      return verifyPlayer(token);
    },
    async info() {
      return { ok: true, contract: SERVER_FORMAT, gameId, slug, local: true };
    },
    'files.head': p => files.head(p),
    'files.list': opts => files.list(opts ?? {}),
    'files.delete': p => files.delete(p),
    'files.usage': () => files.usage(),
  };

  /** The board's writer: its own rule, else the longest pattern (`daily-*`, `*`) its name starts with, else 'any'. */
  function writerOf(d, board) {
    if (d.rules[board]) return d.rules[board];
    const p = Object.keys(d.rules)
      .filter(r => r.endsWith('*') && board.startsWith(r.slice(0, -1)))
      .sort((x, y) => y.length - x.length)[0];
    return p ? d.rules[p] : 'any';
  }
  /** Sets the rule for a board or a pattern. A board that becomes server-only starts empty: what was written while
   * anyone could write it is no one's checked word. → the number of entries removed, or a refusal. */
  function setRule(d, name, writer) {
    if (!(name in d.rules) && Object.keys(d.rules).length >= L.scores.rules)
      return no('too-many', `A game may have ${L.scores.rules} board rules.`);
    const hit = name.endsWith('*')
      ? Object.keys(d.boards).filter(b => b.startsWith(name.slice(0, -1)))
      : d.boards[name]
        ? [name]
        : [];
    const before = new Map(hit.map(b => [b, writerOf(d, b)]));
    d.rules[name] = writer;
    let removed = 0;
    for (const b of hit) {
      if (before.get(b) === 'server' || writerOf(d, b) !== 'server') continue;
      removed += d.boards[b].rows.length;
      d.boards[b].rows = [];
    }
    return removed;
  }
  /** Makes the board (when new) with `order`; `writer`, when given, becomes its rule. → the board (with `removed`) or
   * a refusal. */
  function ensureBoard(d, board, order, writer) {
    if (writer !== undefined && !WRITERS.includes(writer)) return badWriter();
    let b = d.boards[board];
    if (!b) {
      if (!['high', 'low'].includes(order)) return no('order', 'A board’s order is "high" (higher wins) or "low".');
      if (Object.keys(d.boards).length >= L.scores.boards)
        return no('too-many', `A game may have ${L.scores.boards} boards (GF.scores.drop frees one).`);
      b = d.boards[board] = { order, rows: [] };
    }
    let removed = 0;
    if (writer !== undefined && writer !== writerOf(d, board)) {
      removed = setRule(d, board, writer);
      if (typeof removed !== 'number') return removed;
    }
    return { ...b, removed };
  }
  /** The page's submit (/platform/v1/scores/<board>): refused on a board only the server writes; never sets a rule. */
  async function pageSubmit(board, player, score, { name, order } = {}) {
    const d = await load();
    if (writerOf(d, board) === 'server')
      return no('server-only', 'This board takes scores from the game’s server only.');
    return run('scores.submit', [board, player, score, { name, ...(order ? { order } : {}) }]);
  }

  /** One call by name with positional args, as env.GF takes them. → the answer ({ok, …}); never throws. */
  async function run(op, args = []) {
    if (!Object.hasOwn(ops, op)) return no('unknown', `env.GF has no ${op}.`);
    try {
      return await ops[op](...(Array.isArray(args) ? args.slice(0, 4) : []));
    } catch (e) {
      return no('failed', String(e?.message ?? e).slice(0, 300));
    }
  }
  /** gf-local.js's HOST binding: POST http://gf.local/<op> [args…] → the answer as JSON. */
  async function handleHost(request) {
    const url = new URL(request.url);
    const op = url.pathname.slice(1);
    // a file's bytes travel as they are: the put's body, the get's answer (its facts in x-gf-answer)
    if (op === 'files.put') {
      const q = url.searchParams;
      // a stream: held to exactly its declared length, or read up to 1 MB when it has none (xgames.fun's put does so)
      const stream = q.get('stream') === '1';
      const length = q.has('length') ? Number(q.get('length')) : null;
      if (stream && length !== null && length > FILES.fileBytes)
        return Response.json({ ok: false, code: 'too-big', why: `A file may be ${FILES.fileBytes / 1048576} MB.` });
      const cap = !stream ? FILES.fileBytes : length !== null ? length : UNSIZED_MAX;
      const body = await readCapped(request, cap);
      if (!body) {
        if (stream && length === null)
          return Response.json({
            ok: false,
            code: 'body',
            why: `A stream over ${UNSIZED_MAX / 1048576} MB needs its length: put(path, stream, {length}). (A string or an ArrayBuffer needs none.)`,
          });
        if (stream)
          return Response.json({
            ok: false,
            code: 'body',
            why: `The stream gave more bytes than its length (${length}), so nothing was stored.`,
          });
        return Response.json({ ok: false, code: 'too-big', why: `A file may be ${FILES.fileBytes / 1048576} MB.` });
      }
      if (stream && length !== null && body.length !== length)
        return Response.json({
          ok: false,
          code: 'body',
          why: `The stream gave fewer bytes than its length (${length}), so nothing was stored.`,
        });
      const opts = { public: q.get('public') === '1', ...(q.get('type') ? { type: q.get('type') } : {}) };
      return Response.json(await files.put(q.get('path') ?? '', body, opts));
    }
    if (op === 'files.get') {
      let args = [];
      try {
        args = await request.json();
      } catch {
        /* no body */
      }
      const a = await files.get(String(args?.[0] ?? ''));
      if (!a.ok) return Response.json(a);
      const { body, ...facts } = a;
      return new Response(body, { headers: { 'x-gf-answer': JSON.stringify(facts) } });
    }
    let args = [];
    try {
      args = await request.json();
    } catch {
      /* no body */
    }
    return Response.json(await run(op, args));
  }
  async function flush() {
    clearTimeout(timer);
    timer = null;
    await writing;
    if (data) await write();
  }
  return {
    slug,
    gameId,
    run,
    pageSubmit,
    handleHost,
    devToken,
    verifyPlayer,
    readToken,
    flush,
    file,
    files,
    setFilesOrigin: o => {
      filesOrigin = o;
    },
  };
}

/**
 * A request's body, or null when it passes `cap` bytes. Past the cap the rest is read and dropped (up to a bound), so
 * the request ends cleanly: an answer sent while workerd is still sending the body leaves its connection half open.
 */
async function readCapped(request, cap, drain = 64 * 1024 * 1024) {
  if (!request.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for await (const c of request.body) {
    size += c.byteLength;
    if (size > cap + drain) return null;
    if (size <= cap) chunks.push(Buffer.from(c));
  }
  return size > cap ? null : Buffer.concat(chunks);
}

// ---- the page's side: /platform/v1/* on the dev host -------------------------------------------------------------
//   POST   /platform/v1/dev/token          {name?}             → {token, player, expires}   (this machine only)
//   GET    /platform/v1/me                 bearer              → {ok, player: {id, name, level, wallet, x, dev}}
//   GET    /platform/v1/saves              bearer              → {ok, keys}
//   GET    /platform/v1/saves/<key>        bearer              → {ok, value, updatedAt}
//   PUT    /platform/v1/saves/<key>        bearer {value}      → {ok, bytes}
//   DELETE /platform/v1/saves/<key>        bearer              → {ok, deleted}
//   POST   /platform/v1/scores/<board>     bearer {score, name?, order?} → {ok, improved, best, rank}
//                                          (403 server-only: a board the game's server set writer 'server')
//   GET    /platform/v1/scores/<board>?limit=&offset=          → {ok, order, writer, entries}
//   GET    /platform/v1/scores/<board>/me  bearer              → {ok, entry}
const STATUS = {
  'server-only': 403,
  player: 401,
  bad: 401,
  key: 401,
  expired: 401,
  game: 401,
  unknown: 404,
  'too-big': 413,
  rate: 429,
  'too-many': 409,
  full: 409,
};
const json = (res, status, body) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
  return true;
};
const answer = (res, a) => json(res, a?.ok ? 200 : (STATUS[a?.code] ?? 400), a);
async function readBody(req, cap = 96 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > cap) throw Object.assign(new Error('The body is too big.'), { status: 413 });
    chunks.push(c);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('The body is not JSON.'), { status: 400 });
  }
}

/** → true when the request was a platform route (answered), else false. */
export async function handlePlatform(req, res, url, s) {
  if (!url.pathname.startsWith(PLATFORM_PREFIX)) return false;
  let rest;
  try {
    rest = url.pathname.slice(PLATFORM_PREFIX.length).split('/').map(decodeURIComponent);
  } catch {
    return json(res, 400, { ok: false, code: 'bad', why: 'Not a path.' });
  }
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '';
  const who = () => {
    const v = s.readToken(bearer);
    return v.ok
      ? { ok: true, player: { id: v.sub, name: v.name ?? '', level: v.lvl, wallet: v.wallet ?? '', x: v.x, dev: true } }
      : { ...v, why: `Sign in first: ${v.why}` };
  };
  try {
    const m = req.method;
    if (rest[0] === 'dev' && rest[1] === 'token' && rest.length === 2 && m === 'POST') {
      const b = await readBody(req);
      return json(res, 200, s.devToken({ name: b.name, id: b.id }));
    }
    if (rest[0] === 'me' && rest.length === 1 && m === 'GET') return answer(res, who());
    if (rest[0] === 'saves' && rest.length <= 2) {
      const w = who();
      if (!w.ok) return answer(res, w);
      const id = w.player.id;
      if (rest.length === 1 && m === 'GET') return answer(res, await s.run('saves.list', [id]));
      if (rest.length === 2 && m === 'GET') return answer(res, await s.run('saves.get', [id, rest[1]]));
      if (rest.length === 2 && m === 'PUT') {
        const b = await readBody(req);
        return answer(res, await s.run('saves.put', [id, rest[1], b.value]));
      }
      if (rest.length === 2 && m === 'DELETE') return answer(res, await s.run('saves.delete', [id, rest[1]]));
    }
    if (rest[0] === 'scores' && rest.length === 2 && m === 'GET') {
      const q = {
        limit: Number(url.searchParams.get('limit') ?? 10),
        offset: Number(url.searchParams.get('offset') ?? 0),
      };
      return answer(res, await s.run('scores.top', [rest[1], q]));
    }
    if (rest[0] === 'scores' && rest.length === 2 && m === 'POST') {
      const w = who();
      if (!w.ok) return answer(res, w);
      const b = await readBody(req);
      const opts = {
        name: typeof b.name === 'string' ? b.name : w.player.name,
        ...(b.order ? { order: b.order } : {}),
      };
      return answer(res, await s.pageSubmit(rest[1], w.player.id, b.score, opts));
    }
    if (rest[0] === 'scores' && rest.length === 3 && rest[2] === 'me' && m === 'GET') {
      const w = who();
      if (!w.ok) return answer(res, w);
      return answer(res, await s.run('scores.best', [rest[1], w.player.id]));
    }
    return json(res, 404, { ok: false, code: 'unknown', why: `No platform route ${m} ${url.pathname}.` });
  } catch (e) {
    return json(res, e.status ?? 500, { ok: false, code: 'failed', why: e.message });
  }
}
