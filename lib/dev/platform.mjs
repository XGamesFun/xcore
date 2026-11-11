// The platform's services on this machine, for `xcore dev` (gf-server-v1, ../server/contract.mjs): one game's saves and
// scores, a local sign-in, and loot reports. Both sides of the dev host use this one store, so what the page saves
// through gamesfun.js the game's server reads through env.GF, as it would hosted:
//   - the game's server, through ./gf-local.js's HOST binding (handleHost; `run`),
//   - the page, through the dev host's /platform/v1/* routes (handlePlatform, below; `page`).
// Kept in <game>/.gamesfun/dev-platform.json (a hidden folder: never published), written a moment after each change.
// The game's project files (env.GF.files) are ./files.mjs's, in <game>/.gamesfun/dev/files/.
//
// Every answer has xgames.fun's shape: {ok: true, …} or {ok: false, code, why}. A refusal is an answer, never a throw,
// so a game's server reads it the same here as hosted. The limits are the platform's on the plan this dev host
// imitates (./plans.mjs: Free unless `xcore dev --plan`), and so are the rules a page is held to and the server is not:
// the boards a page makes ("high" only, two a player, half the plan's), a player's share of the game's saves, each
// player's writes a minute, and a board read with no token (the top 100, a 5 s cache, a minute of its own). The
// counts a minute are kept in memory, as the platform keeps them; they start again when xcore dev does.
//
// Local sign-in. No xgames.fun signs a player in on this machine, so the dev host hands out its own tokens
// (POST /platform/v1/dev/token): `gfdev1.<payload>.<HMAC-SHA256>`, signed with a key made when it starts and never
// written anywhere, for this game only, lasting an hour. verifyPlayer accepts exactly those; an xgames.fun token (EdDSA,
// from the play host) is refused here with words that say so.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PLATFORM_PREFIX, SAVE_KEY, SERVER_FORMAT, checkLootResult } from '../server/contract.mjs';
import { createFileStore } from './files.mjs';
import { RULES, count, devPlan, size } from './plans.mjs';
import { stateFolder } from '../state-folder.mjs';

const TOKEN_MS = 60 * 60 * 1000;
const MINUTE = 60_000;
/** How much of a body GF.files.put holds in memory: a stream with no declared length, a string or an ArrayBuffer. */
const UNSIZED_MAX = RULES.files.unsizedBytes;
const mb = b => `${(b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0)} MB`;
// eslint-disable-next-line no-control-regex -- it exists to drop control characters
const UNSAFE = /[\u0000-\u001f<>]/g;
const NAME = s =>
  String(s ?? '')
    .replace(UNSAFE, '')
    .trim()
    .slice(0, RULES.scores.nameChars);
const no = (code, why) => ({ ok: false, code, why });
const okPlayer = p => typeof p === 'string' && p.length >= 1 && p.length <= RULES.saves.playerChars;
/** A name's matching form: NFKC, invisible format characters gone, lower case (how the platform reads "@handle"). */
const fold = s =>
  String(s)
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .toLowerCase();
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const base32 = bytes => {
  let out = '',
    bits = 0,
    value = 0;
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
};

/**
 * One game's platform store. `plan`: the plan imitated ('free', 'creator', 'scale', or ./plans.mjs devPlan's answer).
 * → {slug, gameId, plan, run(op, args) (env.GF's), page(op, args, player, {anon}) (the page's), pageSubmit,
 * playerId(sub), handleHost(request), devToken({name, id}), signinRemember(pid, name), signinForget(pid),
 * signinSession(pid), verifyPlayer(token), readToken, flush(), file, files
 * (./files.mjs), setFilesOrigin(origin)}
 */
export function createPlatformStore({
  dir,
  slug = path.basename(path.resolve(dir)),
  log = () => {},
  now = () => Date.now(),
  file = path.join(dir, '.gamesfun', 'dev-platform.json'),
  plan = 'free',
} = {}) {
  const P = typeof plan === 'object' && plan?.key ? plan : devPlan(plan);
  const key = randomBytes(32);
  const gameId = `dev-${slug}`.slice(0, 60);
  // the public files' origin: the dev host's files server, once it listens
  let filesOrigin = null;
  const files = createFileStore({ dir, origin: () => filesOrigin, cap: P.files.bytes, fileBytes: P.files.fileBytes });
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
    for (const [name, b] of Object.entries(data.boards)) {
      // an older file kept a board's rule on the board
      if (b.writer) {
        data.rules[name] ??= b.writer;
        delete b.writer;
      }
      // a board from before boards had a maker is the server's, as the platform counts boards made before then
      b.maker ??= null;
      b.created ??= now();
    }
    data.reports ??= [];
    data.signins ??= {};
    return data;
  };
  const write = async () => {
    if (dir && path.dirname(file) === path.join(dir, '.gamesfun')) await stateFolder(dir);
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

  // ---- the counts a minute, in memory as the platform keeps them ----
  const windows = new Map();
  let pruned = -Infinity;
  /** One from window `k`: true while under `limit` in its period. */
  function spend(k, limit, ms = MINUTE) {
    const t = now();
    if (t - pruned >= MINUTE) {
      for (const [w, v] of windows) if (t - v.start >= v.ms) windows.delete(w);
      pruned = t;
    }
    const w = windows.get(k);
    if (w && t - w.start < ms) {
      if (w.n >= limit) return false;
      w.n++;
      return true;
    }
    windows.set(k, { start: t, n: 1, ms });
    return true;
  }
  const used = k => {
    const w = windows.get(k);
    return w && now() - w.start < w.ms ? w.n : 0;
  };
  /**
   * One write ('saves' or 'scores') from the game's minute (`max`, the plan's). The game's server spends `kind`; pages
   * spend `page-<kind>`, the same number counted apart; once that is spent, a player who has made at most `page.floor`
   * this minute still writes, from a second count.
   */
  function spendWrite(kind, max, page = null) {
    if (!page) return spend(kind, max);
    if (spend(`page-${kind}`, max)) return true;
    return used(page.mine) <= page.floor && spend(`page-${kind}-floor`, max);
  }
  /** The game's reads a minute (env.GF's 'reads', the pages' 'page-reads'): null, or the refusal. */
  const readRefused = w =>
    spend(w, P.reads.perMinute)
      ? null
      : no('rate', `Too many reads this minute (this game’s plan, ${P.name}, allows ${count(P.reads.perMinute)}).`);
  const filesOp = () =>
    spend('files-ops', P.files.opsPerMinute)
      ? null
      : no(
          'rate',
          `Too many file calls this minute (this game’s plan, ${P.name}, allows ${count(P.files.opsPerMinute)}).`,
        );

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
  // ---- the local sign-in, remembered as xgames.fun remembers one ----
  // Hosted, xgames.fun knows which games a player signed in to by their own click, and signs them in to those again
  // with no click until they sign out of the game (../client/gamesfun.js asks as the page loads, and before the
  // token's hour ends). Here the same is kept for each local player (a tab's own): `signins` in the store's file, so
  // a tab is signed in again after a reload and after xcore dev starts again, and not after Sign out.
  const SIGNINS_MAX = 200;
  const okTab = id => typeof id === 'string' && /^[a-z0-9]{6,24}$/.test(id);
  /** The local player `pid` signed in by a click. */
  async function signinRemember(pid, name) {
    if (!okTab(pid)) return;
    await load();
    const named = NAME(name) || data.signins[pid]?.name || '';
    delete data.signins[pid];
    data.signins[pid] = { name: named, at: now() };
    const ids = Object.keys(data.signins);
    for (const id of ids.slice(0, Math.max(0, ids.length - SIGNINS_MAX))) delete data.signins[id];
    persist();
  }
  /** The local player `pid` signed out: nothing signs them in again but a click. */
  async function signinForget(pid) {
    await load();
    if (!okTab(pid) || !data.signins[pid]) return;
    delete data.signins[pid];
    persist();
  }
  /** What xgames.fun answers a game's page that asks with no click: {player, token, expires}, or null (not signed in). */
  async function signinSession(pid) {
    await load();
    const who = okTab(pid) ? data.signins[pid] : null;
    if (!who) return null;
    const t = devToken({ id: pid, name: who.name });
    return {
      player: { wallet: null, level: 1, x: null, google: null, name: t.player.name, by: 'dev' },
      token: t.token,
      expires: t.expires,
    };
  }
  /**
   * env.GF.verifyPlayer, on this machine: xgames.fun's answer shape (no name: hosted it has none), plus `dev: true`.
   * `banned` is always null here: xcore dev has no owner's bans (hosted, it is the creator's ban on any of the token's ids).
   */
  function verifyPlayer(token) {
    const { name: _name, ...v } = readToken(token);
    return v.ok ? { ...v, banned: null } : v;
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
  // A board read from a page shows each player as an id of this game's own (16 base32 characters of an HMAC of the
  // player's id), never the id itself, as the platform does. Here the key is this game's dev key, so the ids are not
  // the ones the published game shows; they stay the same from one run of xcore dev to the next.
  const pidKey = createHash('sha256').update(`xcore dev board player id|${gameId}`).digest();
  const playerId = sub => base32(createHmac('sha256', pidKey).update(String(sub)).digest()).slice(0, 16);

  const ranked = b =>
    [...b.rows].sort((x, y) => (b.order === 'low' ? x.score - y.score : y.score - x.score) || x.at - y.at);
  const rankOf = (b, score) => b.rows.filter(r => (b.order === 'low' ? r.score < score : r.score > score)).length + 1;
  /** One player's rank, counted to RULES.scores.rankMax: past it, rank rankMax + 1 with rankAtLeast. */
  const placeOf = (b, score) => {
    const better = rankOf(b, score) - 1,
      max = RULES.scores.rankMax;
    return better >= max ? { rank: max + 1, rankAtLeast: true } : { rank: better + 1 };
  };
  const savesBytes = mine => Object.values(mine ?? {}).reduce((n, s) => n + (s.bytes ?? 0), 0);
  const badPlayer = () => no('player', `A player id is 1–${RULES.saves.playerChars} characters.`);
  const badKey = () => no('key', 'A save key is 1–32 letters, digits, ".", "_" or "-".');
  const badBoard = () => no('board', 'A board name is 1–32 letters, digits, ".", "_" or "-" (or a pattern: daily-*).');
  // a rule names one board, or every board whose name starts with a prefix: `daily-*` (and `*`, every board)
  const PATTERN = /^[A-Za-z0-9_.-]{0,31}\*$/;
  const WRITERS = ['any', 'server'];
  const badWriter = () => no('writer', 'A board’s writer is "server" (only the game’s server submits) or "any".');
  const badOrder = () => no('order', 'A board’s order is "high" (higher wins) or "low".');
  /** The boards all pages together may make: the plan's over RULES.page.boardsDivisor. */
  const pageBoards = () => Math.floor(P.scores.boards / RULES.page.boardsDivisor);

  /**
   * One save written. `by`: the player whose page writes it, else null (the game's server). A page's write is held to
   * the player's share of the game's save bytes (1/128, never less than one save). With the game's saves at their
   * total, a player whose saves stay within RULES.saves.floorBytes still writes, up to an eighth past the total. A
   * write that does not grow the saves is never refused for space.
   */
  async function putSave(player, k, value, by = null) {
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
    const S = P.saves;
    const bytes = Buffer.byteLength(text);
    if (bytes > S.valueBytes)
      return no('too-big', `A save may be ${S.valueBytes / 1024} KB; this one is ${Math.ceil(bytes / 1024)} KB.`);
    const mine = d.saves[player] ?? {},
      old = Object.hasOwn(mine, k) ? mine[k] : null;
    if (!old && Object.keys(mine).length >= S.keysPerPlayer)
      return no('too-many', `A player may have ${S.keysPerPlayer} saves.`);
    const grows = bytes > (old?.bytes ?? 0);
    const theirs = savesBytes(mine) - (old?.bytes ?? 0) + bytes;
    if (by !== null && grows) {
      const cap = Math.max(S.valueBytes, Math.floor(S.gameBytes / RULES.saves.playerShareDivisor));
      if (theirs > cap)
        return no(
          'full',
          `This player’s saves are full: a player may keep ${size(cap)} of this game’s saves (its plan, ${P.name}, allows ${size(S.gameBytes)} in all).`,
        );
    }
    const total = Object.values(d.saves).reduce((n, m) => n + savesBytes(m), 0) - (old?.bytes ?? 0) + bytes;
    if (
      grows &&
      total > S.gameBytes &&
      (theirs > RULES.saves.floorBytes || total > S.gameBytes + Math.floor(S.gameBytes / RULES.saves.floorPoolDivisor))
    )
      return no(
        'full',
        `This game’s saves are full (its plan, ${P.name}, allows ${size(S.gameBytes)}; a player may still keep ${size(RULES.saves.floorBytes)}).`,
      );
    const page = by === null ? null : { mine: `p:ps:${by}`, floor: RULES.page.saveWritesFloorPerPlayerMinute };
    if (!spendWrite('saves', S.writesPerMinute, page))
      return no(
        'rate',
        `Too many saves this minute (this game’s plan, ${P.name}, allows ${count(S.writesPerMinute)}).`,
      );
    (d.saves[player] ??= {})[k] = { value: JSON.parse(text), bytes, updated: now() };
    persist();
    return { ok: true, bytes };
  }

  /**
   * Makes the board (when new) with `order` (undefined: "high"); `writer`, when given, becomes its rule. `maker`: the
   * player whose page post makes it, else null (the game's server). A page makes only "high" boards, each player
   * RULES.page.boardsPerPlayer of them, all pages together half the plan's; its order never changes a board that is
   * there. The server naming the other order remakes a board a page made (its entries go: `remade`); one the server
   * made keeps its order (`declare`, setup's: 'order-differs'; a submit's: `differs`).
   * → {b, removed, remade, differs} or a refusal
   */
  function ensureBoard(d, board, order, writer, maker = null, declare = false) {
    if (writer !== undefined && !WRITERS.includes(writer)) return badWriter();
    let b = d.boards[board],
      removed = 0,
      remade = false,
      differs = false;
    if (!b) {
      const ord = order === undefined ? 'high' : order;
      if (!['high', 'low'].includes(ord)) return badOrder();
      const all = Object.values(d.boards);
      if (maker !== null && ord !== 'high')
        return no(
          'order',
          'A page makes "high" boards only (higher wins): a "low" board is made by the game’s server (GF.scores.setup) or its owner.',
        );
      if (maker !== null && all.filter(x => x.maker === maker).length >= RULES.page.boardsPerPlayer)
        return no(
          'too-many',
          `One player may make ${RULES.page.boardsPerPlayer} of this game’s boards from its page; the game’s server (GF.scores.setup) or its owner makes more.`,
        );
      if (maker !== null && all.filter(x => x.maker != null).length >= pageBoards())
        return no(
          'too-many',
          `This game’s pages may make ${pageBoards()} of its ${P.scores.boards} boards (its plan, ${P.name}); the rest are its server’s (GF.scores.setup) or its owner’s.`,
        );
      if (all.length >= P.scores.boards)
        return no(
          'too-many',
          `This game’s plan (${P.name}) allows ${P.scores.boards} boards (GF.scores.drop frees one).`,
        );
      b = d.boards[board] = { order: ord, rows: [], maker, created: now() };
    } else if (maker === null && (order === 'high' || order === 'low') && order !== b.order) {
      if (b.maker == null && declare)
        return no(
          'order-differs',
          `This board ranks "${b.order}" (${b.order === 'low' ? 'lower' : 'higher'} wins), not "${order}": GF.scores.drop it, then set it up again.`,
        );
      if (b.maker == null) differs = true;
      else {
        removed = b.rows.length;
        Object.assign(b, { rows: [], order, maker: null, created: now() });
        remade = true;
      }
    }
    if (writer !== undefined && writer !== writerOf(d, board)) {
      const r = setRule(d, board, writer);
      if (typeof r !== 'number') return r;
      removed += r;
    }
    return { b, removed, remade, differs };
  }

  // `writer` ('server' | 'any') is the game's server's word only: the page's route never passes it (page).
  // `order`: none makes a new board "high" and asks nothing of one that is there.
  async function submitScore(board, player, score, { name = '', order, writer } = {}, maker = null) {
    const d = await load();
    if (!SAVE_KEY.test(String(board))) return badBoard();
    if (!okPlayer(player)) return badPlayer();
    if (typeof score !== 'number' || !Number.isFinite(score)) return no('score', 'A score is a finite number.');
    if (typeof name !== 'string' || name.length > RULES.scores.nameChars)
      return no('name', `A name is at most ${RULES.scores.nameChars} characters.`);
    const e = ensureBoard(d, board, order, writer, maker);
    if (e.ok === false) return e;
    const { b } = e;
    if (e.removed || e.remade) persist();
    let row = b.rows.find(r => r.player === player);
    if (row && now() - row.tried < RULES.scores.perPlayerEveryMs) return no('rate', 'One score a second a player.');
    const pageWrite =
      maker === null ? null : { mine: `p:pc:${maker}`, floor: RULES.page.scoreSubmitsFloorPerPlayerMinute };
    if (!spendWrite('scores', P.scores.submitsPerMinute, pageWrite))
      return no(
        'rate',
        `Too many scores this minute (this game’s plan, ${P.name}, allows ${count(P.scores.submitsPerMinute)}).`,
      );
    if (!row && b.rows.length >= P.scores.entriesPerBoard)
      return no(
        'full',
        `This board is full (this game’s plan, ${P.name}, allows ${count(P.scores.entriesPerBoard)} entries a board).`,
      );
    const t = now(),
      improved = !row || (b.order === 'low' ? score < row.score : score > row.score);
    if (!row) b.rows.push((row = { player, name: NAME(name), score, at: t, tried: t }));
    else {
      row.tried = t;
      if (improved) Object.assign(row, { score, at: t, name: NAME(name) || row.name });
    }
    persist();
    return {
      ok: true,
      improved,
      best: row.score,
      ...placeOf(b, row.score),
      ...(e.remade ? { remade: true, removed: e.removed } : {}),
      ...(e.differs ? { orderDiffers: true, order: b.order } : {}),
    };
  }

  // the calls as the store answers them, with no count a minute (env.GF's and the page's count their own)
  const raw = {
    async 'saves.get'(player, k = 'main') {
      const d = await load();
      if (!okPlayer(player)) return badPlayer();
      if (!SAVE_KEY.test(String(k))) return badKey();
      const s = Object.hasOwn(d.saves[player] ?? {}, k) ? d.saves[player][k] : null;
      return { ok: true, value: s ? s.value : null, updatedAt: s?.updated ?? null };
    },
    'saves.put': (player, k, value) => putSave(player, k, value, null),
    async 'saves.delete'(player, k) {
      const d = await load();
      if (!okPlayer(player) || !SAVE_KEY.test(String(k))) return no('key', 'No such save.');
      const had = Object.hasOwn(d.saves[player] ?? {}, k);
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
    'scores.submit': (board, player, score, opts) => submitScore(board, player, score, opts ?? {}, null),
    /** The board's settings, made now when new: {order?, writer?: 'server' | 'any'} (xgames.fun's GF.scores.setup).
     * `board` may be a pattern (`daily-*`, `*`): then only the rule is kept, for those boards now and to come. */
    async 'scores.setup'(board, { order: asked, writer } = {}) {
      const d = await load();
      const order = asked ?? undefined; // null asks nothing, as no order does
      if (typeof board === 'string' && PATTERN.test(board)) {
        if (!WRITERS.includes(writer)) return badWriter();
        const removed = d.rules[board] === writer ? 0 : setRule(d, board, writer);
        if (typeof removed !== 'number') return removed;
        persist();
        return { ok: true, board, writer, removed };
      }
      if (!SAVE_KEY.test(String(board))) return badBoard();
      if (order !== undefined && !['high', 'low'].includes(order)) return badOrder();
      const was = d.boards[board];
      const e = ensureBoard(d, board, order, writer, null, true);
      if (e.ok === false) return e;
      // a board the server sets up is no player's to count among the boards they made
      if (was) was.maker = null;
      persist();
      return {
        ok: true,
        board,
        order: e.b.order,
        writer: writerOf(d, board),
        removed: e.removed,
        ...(e.remade ? { remade: true } : {}),
      };
    },
    /** The game's boards and rules, so its server can find the boards pages made (GF.scores.list). */
    async 'scores.list'() {
      const d = await load();
      const boards = Object.keys(d.boards)
        .sort()
        .map(name => {
          const b = d.boards[name];
          return {
            board: name,
            order: b.order,
            made: b.maker == null ? 'server' : 'page',
            ...(b.maker == null ? {} : { player: b.maker }),
            writer: writerOf(d, name),
            entries: b.rows.length,
            created: b.created,
          };
        });
      const rules = Object.keys(d.rules)
        .sort()
        .map(name => ({ board: name, writer: d.rules[name] }));
      return { ok: true, boards, rules, limit: { boards: P.scores.boards, page: pageBoards() } };
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
      const n = Math.min(Math.max(1, limit | 0), RULES.scores.topMax),
        skip = Math.max(0, offset | 0);
      const b = d.boards[board];
      if (!b) return { ok: true, order: null, writer: writerOf(d, board), entries: [] };
      // read no deeper than the platform does: past it, no entries (a player's own rank is still theirs: best)
      if (skip > RULES.scores.offsetMax) return { ok: true, order: b.order, writer: writerOf(d, board), entries: [] };
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
      return { ok: true, entry: r ? { ...placeOf(b, r.score), score: r.score, name: r.name, at: r.at } : null };
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
  };
  // env.GF's reads count against the game's server's reads a minute
  const READS = ['saves.get', 'saves.list', 'scores.top', 'scores.best', 'scores.list'];
  const counted = window => Object.fromEntries(READS.map(op => [op, (...a) => readRefused(window) ?? raw[op](...a)]));
  const ops = {
    ...raw,
    ...counted('reads'),
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
    // every files call spends one of the game's file calls a minute
    'files.head': p => filesOp() ?? files.head(p),
    'files.list': opts => filesOp() ?? files.list(opts ?? {}),
    'files.delete': p => filesOp() ?? files.delete(p),
    'files.usage': async () => filesOp() ?? { ...(await files.usage()) },
  };

  /** The board's writer: its own rule, else the longest pattern (`daily-*`, `*`) its name starts with, else 'any'. */
  function writerOf(d, board) {
    if (Object.hasOwn(d.rules, board)) return d.rules[board];
    const p = Object.keys(d.rules)
      .filter(r => r.endsWith('*') && board.startsWith(r.slice(0, -1)))
      .sort((x, y) => y.length - x.length)[0];
    return p ? d.rules[p] : 'any';
  }
  /** Sets the rule for a board or a pattern. A board that becomes server-only starts empty: what was written while
   * anyone could write it is no one's checked word. → the number of entries removed, or a refusal. */
  function setRule(d, name, writer) {
    if (!Object.hasOwn(d.rules, name) && Object.keys(d.rules).length >= P.scores.rules)
      return no('too-many', `This game’s plan (${P.name}) allows ${P.scores.rules} board rules.`);
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

  // ---- the page's own calls (/platform/v1/*): the same store, and each player's share of the game's writes ----
  const PAGE_WRITES = {
    'saves.put': ['ps', RULES.page.saveWritesPerPlayerMinute, 'saves'],
    'saves.delete': ['ps', RULES.page.saveWritesPerPlayerMinute, 'saves'],
    'scores.submit': ['pc', RULES.page.scoreSubmitsPerPlayerMinute, 'scores'],
  };
  const pageReads = counted('page-reads');
  // a board read with no good player token: the top RULES.page.anonTopDepth, the same read again within
  // anonReadCacheMs from memory, and the rest held to the plan's reads over anonReadsDivisor a minute
  const anonTops = new Map();
  async function anonTop(board, opts) {
    const n = Math.min(Math.max(1, Number(opts?.limit ?? 10) | 0), RULES.scores.topMax),
      skip = Math.max(0, Number(opts?.offset ?? 0) | 0);
    if (skip + n > RULES.page.anonTopDepth)
      return no('player', `Sign in to read past the top ${RULES.page.anonTopDepth} of a board.`);
    const k = `${board}\u0000${n}\u0000${skip}`,
      t = now(),
      hit = anonTops.get(k);
    if (hit && t - hit.at < RULES.page.anonReadCacheMs) return hit.answer;
    const max = Math.max(1, Math.floor(P.reads.perMinute / RULES.page.anonReadsDivisor));
    if (!spend('page-anon-reads', max))
      return no(
        'rate',
        `Too many reads this minute from visitors who are not signed in (this game’s plan, ${P.name}, allows ${count(max)}). Sign in, or try again shortly.`,
      );
    const answer = await pageReads['scores.top'](board, { limit: n, offset: skip });
    if (answer?.ok) {
      if (anonTops.size >= 256) anonTops.clear();
      anonTops.set(k, { at: t, answer });
    }
    return answer;
  }
  /**
   * One page call for `player` (the token's sub): op with env.GF's positional args. `anon`: a board read with no good
   * player token. → the answer; never throws.
   */
  async function page(op, args = [], player = '', { anon = false } = {}) {
    try {
      if (!Object.hasOwn(PAGE_WRITES, op) && !Object.hasOwn(pageReads, op))
        return no('unknown', `No ${op} from a page.`);
      if (op === 'scores.list') return no('unknown', `No ${op} from a page.`);
      const a = Array.isArray(args) ? args.slice(0, 4) : [];
      if (op === 'scores.submit') {
        const d = await load();
        // a board the game's server owns takes no score from a page; and a page never sets a rule
        if (typeof a[0] === 'string' && writerOf(d, a[0]) === 'server')
          return no('server-only', 'This board takes scores from the game’s server only.');
        if (a[3] && typeof a[3] === 'object') {
          const { writer: _w, hidden: _h, ...opts } = a[3];
          a[3] = opts;
        }
      }
      if (op === 'scores.top' && a[1] && typeof a[1] === 'object') {
        const { hidden: _h, ...opts } = a[1];
        a[1] = opts;
      }
      if (op === 'scores.top' && anon)
        return typeof a[0] === 'string' && SAVE_KEY.test(a[0]) ? await anonTop(a[0], a[1] ?? {}) : badBoard();
      const w = PAGE_WRITES[op];
      if (w) {
        if (!okPlayer(player)) return badPlayer();
        if (!spend(`p:${w[0]}:${player}`, w[1]))
          return no('rate', `Too many ${w[2]} this minute for one player (${w[1]}).`);
      }
      if (op === 'scores.submit') return await submitScore(a[0], a[1], a[2], a[3] ?? {}, player);
      if (op === 'saves.put') return await putSave(a[0], a[1], a[2], player);
      if (op === 'saves.delete') return await raw['saves.delete'](...a);
      return await pageReads[op](...a);
    } catch (e) {
      return no('failed', String(e?.message ?? e).slice(0, 300));
    }
  }
  /** The page's submit (/platform/v1/scores/<board>), for `player`. */
  const pageSubmit = (board, player, score, { name, order, writer } = {}) =>
    page(
      'scores.submit',
      [board, player, score, { name, ...(order ? { order } : {}), ...(writer ? { writer } : {}) }],
      player,
    );

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
      const spent = filesOp();
      if (spent) {
        await request.body?.cancel().catch(() => {});
        return Response.json(spent);
      }
      // a stream: held to exactly its declared length, or read up to 1 MB when it has none; a string or an
      // ArrayBuffer is in memory already: at most 1 MB (xgames.fun's put does so)
      const stream = q.get('stream') === '1';
      const length = q.has('length') ? Number(q.get('length')) : null;
      const max = P.files.fileBytes;
      if (stream && length !== null && length > max)
        return Response.json({ ok: false, code: 'too-big', why: `A file may be ${mb(max)}.` });
      const cap = !stream ? max : length !== null ? length : UNSIZED_MAX;
      const body = await readCapped(request, cap);
      if (!body) {
        if (stream && length === null)
          return Response.json({
            ok: false,
            code: 'body',
            why: `A stream over ${mb(UNSIZED_MAX)} needs its length: put(path, stream, {length}). (A string or an ArrayBuffer needs none.)`,
          });
        if (stream)
          return Response.json({
            ok: false,
            code: 'body',
            why: `The stream gave more bytes than its length (${length}), so nothing was stored.`,
          });
        return Response.json({ ok: false, code: 'too-big', why: `A file may be ${mb(max)}.` });
      }
      if (!stream && body.length > UNSIZED_MAX)
        return Response.json({
          ok: false,
          code: 'body',
          why: `A string or ArrayBuffer body is at most ${mb(UNSIZED_MAX)}; send a larger file as a byte stream with its length: put(path, stream, {length}).`,
        });
      if (stream && length !== null && body.length !== length)
        return Response.json({
          ok: false,
          code: 'body',
          why: `The stream gave fewer bytes than its length (${length}), so nothing was stored.`,
        });
      // no type is application/octet-stream, as the platform stores it (never a public type)
      const opts = { public: q.get('public') === '1', type: q.get('type') || 'application/octet-stream' };
      return Response.json(await files.put(q.get('path') ?? '', body, opts));
    }
    if (op === 'files.get') {
      let args = [];
      try {
        args = await request.json();
      } catch {
        /* no body */
      }
      const spent = filesOp();
      if (spent) return Response.json(spent);
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
    plan: P,
    run,
    page,
    pageSubmit,
    playerId,
    handleHost,
    devToken,
    signinRemember,
    signinForget,
    signinSession,
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
//   GET    /platform/v1/scores/<board>?limit=&offset=  bearer? → {ok, order, writer, entries}: each entry's player
//                                          an id of this game's own, `me: true` on the caller's; with no good token,
//                                          the top 100 only (401 past it)
//   GET    /platform/v1/scores/<board>/me  bearer              → {ok, entry}
// Bodies are JSON (content-type: application/json, else 415), at most 96 KB (413).
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
const refusal = (status, code, why) => Object.assign(new Error(why), { status, code });
/** A page's JSON body, as the platform reads one: at most 96 KB, JSON only; an empty one is {}, a non-object {}. */
async function readBody(req, { strict = true } = {}) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > RULES.page.bodyBytes) throw refusal(413, 'too-big', `A body may be ${RULES.page.bodyBytes / 1024} KB.`);
    chunks.push(c);
  }
  if (!size) return {};
  if (strict && !/^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] ?? '')))
    throw refusal(415, 'failed', 'The body must be JSON (content-type: application/json).');
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw refusal(400, 'failed', 'The body is not JSON.');
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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
      const b = await readBody(req, { strict: false });
      const signed = s.devToken({ name: b.name, id: b.id });
      // the click: this player is signed in to the game until they sign out (./signin.mjs answers the page's question)
      await s.signinRemember(signed.player.id.slice('dev:'.length), signed.player.name);
      return json(res, 200, signed);
    }
    if (rest[0] === 'me' && rest.length === 1 && m === 'GET') return answer(res, who());
    if (rest[0] === 'saves' && rest.length <= 2) {
      const w = who();
      if (!w.ok) return answer(res, w);
      const id = w.player.id;
      if (rest.length === 1 && m === 'GET') return answer(res, await s.page('saves.list', [id], id));
      if (rest.length === 2 && m === 'GET') return answer(res, await s.page('saves.get', [id, rest[1]], id));
      if (rest.length === 2 && m === 'PUT') {
        const b = await readBody(req);
        return answer(res, await s.page('saves.put', [id, rest[1], b.value], id));
      }
      if (rest.length === 2 && m === 'DELETE') return answer(res, await s.page('saves.delete', [id, rest[1]], id));
    }
    if (rest[0] === 'scores' && rest.length === 2 && m === 'GET') {
      // no token needed; a good one marks the caller's own entry `me: true`, a bad one marks nothing
      const v = bearer ? s.readToken(bearer) : null;
      const mine = v?.ok ? [v.sub, v.wallet].filter(i => typeof i === 'string' && i) : [];
      const limit = Number(url.searchParams.get('limit') ?? 10),
        offset = Number(url.searchParams.get('offset') ?? 0);
      const top = await s.page('scores.top', [rest[1], { limit, offset }], '', { anon: !mine.length });
      if (!top?.ok || !Array.isArray(top.entries)) return answer(res, top);
      const entries = top.entries.map(e => ({
        ...e,
        player: s.playerId(e.player),
        ...(mine.includes(e.player) ? { me: true } : {}),
      }));
      return answer(res, { ...top, entries });
    }
    if (rest[0] === 'scores' && rest.length === 2 && m === 'POST') {
      const w = who();
      if (!w.ok) return answer(res, w);
      const b = await readBody(req);
      // a name that reads as an X handle stands only when it is the player's own (none here): else the player's name
      const sent = typeof b.name === 'string' ? b.name : null;
      const own = w.player.x?.handle ? `@${w.player.x.handle}` : '';
      const name =
        sent === null || (fold(NAME(sent)).startsWith('@') && !(own && fold(NAME(sent)) === fold(own)))
          ? w.player.name
          : sent;
      return answer(
        res,
        await s.pageSubmit(rest[1], w.player.id, b.score, { name, ...(b.order ? { order: b.order } : {}) }),
      );
    }
    if (rest[0] === 'scores' && rest.length === 3 && rest[2] === 'me' && m === 'GET') {
      const w = who();
      if (!w.ok) return answer(res, w);
      return answer(res, await s.page('scores.best', [rest[1], w.player.id], w.player.id));
    }
    return json(res, 404, { ok: false, code: 'unknown', why: `No platform route ${m} ${url.pathname}.` });
  } catch (e) {
    return json(res, e.status ?? 500, { ok: false, code: e.code ?? 'failed', why: e.message });
  }
}
