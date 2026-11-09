// The game's own voucher key on xgames.fun, written into server/ by `xcore add vouchers`. Part of the game's server code
// (docs/SERVER.md, "Paying a result"): a reward for a result (a score, a win, a clear) is a grant in the game's economy
// claimed with a voucher, and this server signs the voucher once its own check says the result pays. The key is the
// owner's secret, never the page's:
//   xcore secret set VOUCHER_SEED --new-key <folder>   on xgames.fun: a live key, sent there only, never kept on this machine
//   VOUCHER_SEED=… in the folder's .dev.vars           under xcore dev: a key of its own, for testing
// Unset, nothing is paid and api/vouchers/key says so.
//
//   GET  api/vouchers/key                → {ok, publicKey}: the address to put in the grant's "vouchers"
//   GET  api/vouchers/link?wallet=…      → {ok, text, expires}: the proof the wallet signs that it is the player's
//   POST api/vouchers/link  {wallet, text, signature (base64)}, signed in → {ok, wallet}
//   POST api/vouchers/pay   {…your game's own fields}, signed in → {ok, voucher}: PAY.check below decides
//
// A voucher pays a wallet the player proved is theirs: the one they signed in with, or one they linked here by signing
// a proof (@xgamesfun/solana's: game, purpose, a nonce this server takes once, an expiry; gamesfun.js: gf.loot.link()). A wallet the page merely names is never paid. The page claims what
// it gets: await gf.loot.call('claimGrant', grant, {voucher}). This server's own code (a room that decided a match, a
// route of its own) pays with voucherFor(env, {…}), naming the wallet itself (walletOf(env, player) gives the proven one).
//
// One result pays one wallet once: each voucher names a round (the result's own id) and the GameVouchers Durable
// Object remembers every round it signed, so the same result asked again gets the same voucher, never one for another
// wallet or amount, and never one for the grant once it has been made again (a new campaign pays new rounds). A round
// goes free → reserved → signed, and roundStep below is the one place that moves it on. The voucher bytes are loot's
// own (server/gf-loot/, a copy of @xgamesfun/solana that publish keeps current).

import { DurableObject } from 'cloudflare:workers';
import { proofRequest, signVoucher, verifyProof } from './gf-loot/results/index.js';
import { decodeBase58, encodeBase58 } from './gf-loot/chain/base58.js';
import { rpcClient } from './gf-loot/chain/rpc.js';
import { decode, pda } from './gf-loot/client/index.js';
import ECONOMY from '__ECONOMY__';

/**
 * What a result pays. check gets the page's JSON (body), the signed-in player (env.GF.verifyPlayer's answer: sub,
 * wallet, x) and env, and answers what to pay: grant (its key or id in xsolana.json), round (the result's own id: a
 * run id this server gave out, a match id; any text, used once), amount (base units above 0, at most the grant's, or
 * 'grant' for the grant's own: always named). Anything else refuses; give a why to say why. Until it is written,
 * nothing is paid.
 * docs/SERVER.md, "How much your server can check", says what a check can stand behind. For example:
 *
 *   async check({ body, player, env }) {
 *     // the run this server started: xcore add database, RULES runs: {read: 'owner', write: 'server'}, so a player
 *     // can't write one (never a save: the page writes its own player's saves)
 *     const { item } = await dataOf(env).get('runs', String(body.runId));
 *     if (!item || item.value.player !== player.sub) return { why: 'Not a run this server started for you.' };
 *     if (Date.now() - item.value.startedAt < 60_000) return { why: 'Faster than the game allows.' };
 *     return { grant: 'clear', round: body.runId, amount: 'grant' }; // the grant's own amount, once a run
 *   },
 *
 * paid (optional) runs once a round, after its voucher is signed, with what check answered and the voucher: count a
 * player's daily total there, not in check, so a refusal after check (no proven wallet, a round already used) costs
 * them nothing. Not again for the same round asked twice at once or signed anew near its expiry; if paid throws, the
 * round is not counted and a later ask for it runs paid again.
 * Every wallet is a new player on a chain, and a wallet sign-in costs nothing: cap what a person can take with
 * VOUCHERS.payOnly 'x' (only players signed in with X, counted per X account) for rewards worth farming, and give each
 * grant a perDay total in xsolana.json.
 */
export const PAY = {
  async check() {
    return { why: 'This game pays no results yet: write PAY.check at the top of server/vouchers.js.' };
  },
};

/** payOnly: 'any' (every signed-in player) | 'x' (only players signed in with X); perMinute: pay and link requests a
 *  player may make a minute; linkSeconds: how long a link text may be signed. */
export const VOUCHERS = {
  seconds: 7 * 86400,
  renewWithin: 3600,
  maxBody: 16 * 1024,
  payOnly: 'any',
  perMinute: 20,
  linkSeconds: 600,
};

const RELAY = 'https://play.xgames.fun/loot/v1/rpc'; // xgames.fun's devnet relay (the public RPC refuses Workers)
const PATH = /\/api\/vouchers\/(key|pay|link)\/?$/;
const te = new TextEncoder();
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const refuse = (status, code, why) => ({ ok: false, status, code, why });
const reply = (a, status = a.ok ? 200 : a.status) => {
  const { status: _, ...body } = a;
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
};

/** The voucher key from its 32-byte seed (hex), as WebCrypto takes an Ed25519 private key (PKCS #8); or null. */
async function voucherKey(seed) {
  const text = typeof seed === 'string' ? seed.trim() : '';
  if (!/^[0-9a-f]{64}$/i.test(text)) return null;
  const raw = Uint8Array.from(text.match(/../g), h => parseInt(h, 16));
  const der = Uint8Array.from([...'302e020100300506032b657004220420'.match(/../g).map(h => parseInt(h, 16)), ...raw]);
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, true, ['sign']);
  const { x } = await crypto.subtle.exportKey('jwk', key);
  const address = encodeBase58(Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
  return { address, raw, sign: async message => new Uint8Array(await crypto.subtle.sign('Ed25519', key, message)) };
}

const hmac = async (key, data) => {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, typeof data === 'string' ? te.encode(data) : data));
};

/** A result's round: 16 bytes in hex, as given or the SHA-256 of any other id (a run id, a match id). */
async function roundOf(id) {
  const text = String(id ?? '');
  if (!text) return null;
  if (/^[0-9a-f]{32}$/i.test(text)) return text.toLowerCase();
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(text))).subarray(0, 16));
}

/** One person (an X account) as the grant counts them: never the account itself, and a different hash per grant. */
async function personHashOf(signer, grantAddress, person) {
  if (person === null || person === undefined || person === '') return null;
  const own = await hmac(signer.raw, 'xcore voucher person v1');
  return hex(await hmac(await hmac(own, grantAddress), String(person)));
}

const isWallet = w => {
  try {
    return typeof w === 'string' && decodeBase58(w).length === 32;
  } catch {
    return false;
  }
};

/** What a link proves: this wallet is this player's (the proof's purpose, so a proof for anything else won't do). */
export const linkPurpose = player => `link to player ${player}`;

/** The grant in the economy, by its key or id, once the economy is live. */
function grantOf(grant) {
  const live = ECONOMY?.live;
  if (!live?.project) return refuse(409, 'not-live', 'The economy is not live yet: xcore loot approve.');
  const g = (ECONOMY.grants ?? []).find(x => x.key === grant || (x.id !== undefined && String(x.id) === String(grant)));
  if (!g || g.id === undefined)
    return refuse(400, 'grant', `No grant ${JSON.stringify(grant)} is live in xsolana.json (its key or id).`);
  return { ok: true, project: live.project, id: g.id, key: g.key, perPerson: Number(g.limits?.perPerson ?? 0) };
}

/** A round's record in GameVouchers: `${grant id}:${round}`. */
const roundKey = (grant, round) => `${grant}:${round}`;

/**
 * A round's record, {incarnation, wallet, amount, voucher, counted}, is in one of three states:
 *   free      no record: no wallet has asked for this result yet.
 *   reserved  voucher null: the round is this wallet's while its voucher is signed, so a second wallet asking at once
 *             is refused. A signing that failed leaves it here: the same wallet may sign it again, at a corrected
 *             amount (nothing was handed out for it); any other wallet is still refused.
 *   signed    a voucher: this wallet and this amount for good. Asked again it gets the same voucher, or one signed
 *             anew (same wallet, round and amount) when that one is near its expiry or was signed with an earlier
 *             voucher key: the program pays a wallet each round once, so a second signature never pays twice.
 * counted: PAY.paid ran for the round (false until it has; a signed record from before counted existed had its paid
 * run when it was signed, so it counts as counted). A record of an earlier incarnation of the grant is never signed
 * again: grant-remade.
 */
const stateOf = record => (!record ? 'free' : record.voucher ? 'signed' : 'reserved');
const countedOf = record => record.counted ?? stateOf(record) === 'signed';

/** The voucher a signed record can give back as it is: this wallet and amount, the current key, not near expiry. */
const freshFor = (record, { wallet, amount, publicKey, now }) =>
  stateOf(record) === 'signed' &&
  record.wallet === wallet &&
  record.amount === amount &&
  record.voucher.publicKey === publicKey &&
  record.voucher.expires - now > VOUCHERS.renewWithin;

const roundUsed = () =>
  refuse(
    409,
    'round-used',
    'This result has its voucher already (for another wallet or amount): a new result needs its own round.',
  );

/**
 * The one place a round's record moves on. `had` is the record (or undefined), `event` one of
 *   {ask: {incarnation, wallet, amount, publicKey, now}}   a wallet asks for the round's voucher
 *   {signed: {incarnation, wallet, amount, voucher}}       the voucher an ask signed, to keep
 *   {count: true} | {count: false}                         PAY.paid is to run (or it threw: not counted after all)
 * → {record?: the record to store (none: unchanged), answer}. An ask answers {ok, sign: true} (sign it), {ok, voucher}
 * (the one it has) or a refusal; signed answers {ok} or a refusal (the round moved on meanwhile: this voucher is not
 * given out); count answers {ok, count} (true: run paid now).
 */
function roundStep(had, event) {
  const state = stateOf(had);
  if (event.ask) {
    const { incarnation, wallet, amount } = event.ask;
    if (state === 'free')
      return {
        record: { incarnation, wallet, amount, voucher: null, counted: false },
        answer: { ok: true, sign: true },
      };
    if (had.incarnation !== incarnation)
      return {
        answer: refuse(
          409,
          'grant-remade',
          'This result was paid by the grant before it was made again; a new campaign pays new rounds.',
        ),
      };
    if (had.wallet !== wallet) return { answer: roundUsed() };
    // reserved: nothing was handed out, so its wallet may sign it again, at the amount asked now
    if (state === 'reserved') return { record: { ...had, amount, counted: false }, answer: { ok: true, sign: true } };
    if (had.amount !== amount) return { answer: roundUsed() };
    if (freshFor(had, event.ask)) return { answer: { ok: true, voucher: had.voucher } };
    return { answer: { ok: true, sign: true } }; // near its expiry, or an earlier key's: signed anew
  }
  if (event.signed) {
    const { incarnation, wallet, amount, voucher } = event.signed;
    if (state === 'free' || had.incarnation !== incarnation || had.wallet !== wallet || had.amount !== amount)
      return { answer: roundUsed() };
    return { record: { ...had, voucher, counted: countedOf(had) }, answer: { ok: true } };
  }
  if (event.count === true) {
    if (state !== 'signed' || countedOf(had)) return { answer: { ok: true, count: false } };
    return { record: { ...had, counted: true }, answer: { ok: true, count: true } };
  }
  if (event.count === false && state === 'signed' && had.counted === true)
    return { record: { ...had, counted: false }, answer: { ok: true, count: false } };
  return { answer: { ok: true, count: false } };
}

/**
 * The Durable Object that remembers each round signed and each player's linked wallet (gamesfun.json →
 * server.objects: GameVouchers, GAME_VOUCHERS).
 */
export class GameVouchers extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.hits = new Map(); // `${player}:${minute}` → requests (memory only: a rate, not a record)
  }
  /** The round's record, or undefined. */
  peek(key) {
    return this.ctx.storage.get(key);
  }
  /**
   * A round's record moved on by `event` (roundStep), and its answer. One step: an object takes no other call while it
   * waits on its own storage, so two requests for the same round at once can't both find it free, or both count it.
   */
  async step(key, event) {
    const { record, answer } = roundStep(await this.ctx.storage.get(key), event);
    if (record) await this.ctx.storage.put(key, record);
    return answer;
  }
  /** One more request from `player` this minute: false past `limit`. */
  hit(player, limit) {
    const minute = Math.floor(Date.now() / 60_000);
    for (const k of this.hits.keys()) if (!k.endsWith(`:${minute}`)) this.hits.delete(k);
    const k = `${player}:${minute}`;
    const n = (this.hits.get(k) ?? 0) + 1;
    this.hits.set(k, n);
    return n <= limit;
  }
  /** Keeps a proof's nonce until it expires: {player, wallet, expires}. Expired nonces go now and then. */
  async ask(nonce, record) {
    await this.ctx.storage.put(`nonce:${nonce}`, record);
    if (Math.random() < 0.05) {
      const now = Math.floor(Date.now() / 1000);
      const old = [...(await this.ctx.storage.list({ prefix: 'nonce:', limit: 1000 }))]
        .filter(([, r]) => !(r?.expires > now))
        .map(([k]) => k);
      if (old.length) await this.ctx.storage.delete(old);
    }
  }
  /** Takes a nonce once: true when this server asked it of this player and wallet, and it hasn't expired. */
  async spend(nonce, player, wallet) {
    const r = await this.ctx.storage.get(`nonce:${nonce}`);
    if (!r) return false;
    await this.ctx.storage.delete(`nonce:${nonce}`);
    return r.player === player && r.wallet === wallet && r.expires > Math.floor(Date.now() / 1000);
  }
  /** `player`'s linked wallet, or null. */
  async linked(player) {
    return (await this.ctx.storage.get(`link:${player}`)) ?? null;
  }
  /** Links `wallet` to `player`: a wallet belongs to one player at a time, a player has one linked wallet. */
  async link(player, wallet) {
    const before = await this.ctx.storage.get(`link:${player}`);
    if (before && before !== wallet) await this.ctx.storage.delete(`wallet:${before}`);
    const owner = await this.ctx.storage.get(`wallet:${wallet}`);
    if (owner && owner !== player) await this.ctx.storage.delete(`link:${owner}`);
    await this.ctx.storage.put({ [`link:${player}`]: wallet, [`wallet:${wallet}`]: player });
    return wallet;
  }
}
const stubOf = env => env.GAME_VOUCHERS.get(env.GAME_VOUCHERS.idFromName('main'));

/** The wallet `player` (env.GF.verifyPlayer's answer) proved is theirs: signed in with, else linked here; or null. */
export async function walletOf(env, player) {
  if (isWallet(player?.wallet)) return player.wallet;
  return player?.sub ? stubOf(env).linked(player.sub) : null;
}

/**
 * A voucher for a result this server stands behind: {grant (key or id), wallet, round (the result's id), amount (base
 * units above 0, or 'grant' for the grant's own amount: always named, so a forgotten amount never pays the most),
 * person? (an X account id: a grant with perPerson pays only a person)}. The caller names the wallet: a proven one
 * (walletOf). → {ok, voucher, again?} (again: the voucher this result had already) | {ok: false, code, why}
 */
export async function voucherFor(env, ask) {
  const { key: _key, ...out } = await signRound(env, ask);
  return out;
}

/** voucherFor's work, with the round's record key (`key`) when it answers a voucher. */
async function signRound(env, { grant, wallet, round, amount, person = null }) {
  const signer = await voucherKey(env.VOUCHER_SEED);
  if (!signer)
    return refuse(
      503,
      'not-set',
      'This game pays no results: its voucher key is not set (xcore secret set VOUCHER_SEED --new-key).',
    );
  const g = grantOf(grant);
  if (!g.ok) return g;
  if (!isWallet(wallet)) return refuse(400, 'wallet', 'A voucher pays a Solana wallet: connect one first.');
  const r = await roundOf(round);
  if (!r) return refuse(400, 'round', 'A voucher needs the result’s own id (round), used once.');
  if (g.perPerson > 0 && (person === null || person === undefined || person === ''))
    return refuse(403, 'person', 'This reward counts people: sign in with X to be paid.');
  let units;
  try {
    // 'grant': the grant's own amount (the voucher names 0); otherwise a whole number of base units above 0
    units = amount === 'grant' ? 0n : BigInt(amount);
  } catch {
    units = -1n;
  }
  if (units < 0n || (units === 0n && amount !== 'grant'))
    return refuse(
      400,
      'amount',
      "Name the amount: base units above 0, or 'grant' for the grant's own amount (never left out, so it never pays the most by mistake).",
    );
  const stub = stubOf(env);
  const key = roundKey(g.id, r);
  const want = { wallet, amount: String(units), publicKey: signer.address, now: Math.floor(Date.now() / 1000) };
  // the same result asked again: its voucher, with no chain read. (One of an earlier incarnation of the grant comes
  // back here too: it pays nothing, and telling would take the chain read this saves; past here it is grant-remade.)
  const seen = await stub.peek(key);
  if (freshFor(seen, want)) return { ok: true, voucher: seen.voucher, again: true, key };
  // the grant as it is now: a voucher pays only the incarnation it was signed for
  const rpc =
    typeof env.XSOLANA_RPC_URL === 'string' && env.XSOLANA_RPC_URL.trim() ? env.XSOLANA_RPC_URL.trim() : RELAY;
  const address = pda.grant(g.project, g.id);
  const account = await rpcClient(rpc).account(address);
  if (!account)
    return refuse(409, 'grant', `The grant ${g.key ?? g.id} is not on the chain (closed, or not live yet).`);
  const incarnation = String(decode('Grant', account.data).incarnation);
  // the round is this wallet's from here on, before anything is signed (a second wallet asking at once is refused)
  const asked = await stub.step(key, { ask: { ...want, incarnation } });
  if (!asked.ok) return asked;
  if (asked.voucher) return { ok: true, voucher: asked.voucher, again: true, key };
  const voucher = await signVoucher({
    signer,
    game: g.project,
    grant: g.id,
    incarnation,
    wallet,
    round: r,
    now: want.now,
    seconds: VOUCHERS.seconds,
    personHash: await personHashOf(signer, address, person),
    amount: units,
  });
  const kept = await stub.step(key, { signed: { incarnation, wallet, amount: want.amount, voucher } });
  if (!kept.ok) return kept;
  return { ok: true, voucher, key };
}

/** The signed-in player of a request (env.GF.verifyPlayer's answer), or a refusal. */
async function playerOf(request, env) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!bearer) return refuse(401, 'player', 'Sign in first: a result pays a signed-in player.');
  const player = await env.GF.verifyPlayer(bearer);
  if (!player?.ok)
    return refuse(401, 'player', `Sign in again: ${String(player?.why ?? 'not a player token').replace(/\.$/, '')}.`);
  return player;
}

/** The request's JSON body, or a refusal. */
async function bodyOf(request) {
  const text = await request.text();
  if (te.encode(text).byteLength > VOUCHERS.maxBody) return refuse(413, 'too-big', 'The request is too large.');
  try {
    return { ok: true, body: text ? JSON.parse(text) : {} };
  } catch {
    return refuse(400, 'bad', 'The body is not JSON.');
  }
}

/** The page's calls to api/vouchers/…; null for any other path, so the server's own routes go on. */
export async function handleVouchers(request, env) {
  const url = new URL(request.url);
  const m = PATH.exec(url.pathname);
  if (!m) return null;
  const method = request.method.toUpperCase();
  if (m[1] === 'key') {
    if (method !== 'GET') return reply(refuse(405, 'method', 'GET api/vouchers/key.'));
    const signer = await voucherKey(env.VOUCHER_SEED);
    return reply(
      signer
        ? { ok: true, publicKey: signer.address }
        : refuse(503, 'not-set', 'The voucher key is not set (xcore secret set VOUCHER_SEED --new-key).'),
    );
  }
  const player = await playerOf(request, env);
  if (!player.ok) return reply(player);
  const stub = stubOf(env);
  if (!(await stub.hit(player.sub, VOUCHERS.perMinute)))
    return reply(refuse(429, 'rate', 'Too many requests this minute: try again in a moment.'));
  const game = String(env.GF_GAME_ID ?? 'game');
  if (m[1] === 'link') {
    if (method === 'GET') {
      const wallet = url.searchParams.get('wallet') ?? '';
      if (!isWallet(wallet)) return reply(refuse(400, 'wallet', 'Name the wallet to link (?wallet=its address).'));
      const ask = proofRequest({ game, wallet, purpose: linkPurpose(player.sub), seconds: VOUCHERS.linkSeconds });
      await stub.ask(ask.nonce, { player: player.sub, wallet, expires: ask.expires });
      return reply({ ok: true, text: ask.text, expires: ask.expires });
    }
    if (method !== 'POST') return reply(refuse(405, 'method', 'GET or POST api/vouchers/link.'));
    const b = await bodyOf(request);
    if (!b.ok) return reply(b);
    const { wallet, text, signature } = b.body ?? {};
    if (!isWallet(wallet)) return reply(refuse(400, 'wallet', 'Name the wallet to link.'));
    let sig;
    try {
      sig = Uint8Array.from(atob(String(signature ?? '')), c => c.charCodeAt(0));
    } catch {
      return reply(refuse(400, 'signature', 'The signature is not base64.'));
    }
    let proof;
    try {
      proof = await verifyProof({ text, signature: sig, wallet, game, purpose: linkPurpose(player.sub) });
    } catch (e) {
      return reply(refuse(403, 'signature', String(e?.message ?? e)));
    }
    if (!(await stub.spend(proof.nonce, player.sub, wallet)))
      return reply(
        refuse(403, 'nonce', 'That proof was used already, or this server never asked it: ask for a new one.'),
      );
    return reply({ ok: true, wallet: await stub.link(player.sub, wallet) });
  }
  if (method !== 'POST') return reply(refuse(405, 'method', 'POST api/vouchers/pay.'));
  if (VOUCHERS.payOnly === 'x' && !player.x?.id)
    return reply(refuse(403, 'x-only', 'This game pays players signed in with X: sign in with X to be paid.'));
  const b = await bodyOf(request);
  if (!b.ok) return reply(b);
  const body = b.body;
  const pays = await PAY.check({ body, player, env });
  if (!pays || pays.grant === undefined || pays.round === undefined)
    return reply(refuse(403, 'not-paid', String(pays?.why ?? 'This result does not pay.')));
  // a wallet the player proved: one check names (the server decided it), the signed-in one, or the one linked here
  const wallet = isWallet(pays.wallet) ? pays.wallet : await walletOf(env, player);
  if (!wallet)
    return reply(
      refuse(
        403,
        'wallet',
        'Link your wallet first: the game pays only a wallet you proved is yours (gf.loot.link()).',
      ),
    );
  if (isWallet(body?.wallet) && body.wallet !== wallet)
    return reply(refuse(403, 'wallet', `This pays your proven wallet (${wallet.slice(0, 4)}…), not the one named.`));
  const { key, ...out } = await signRound(env, {
    grant: pays.grant,
    wallet,
    round: pays.round,
    amount: pays.amount,
    person: player.x?.id ?? null,
  });
  // paid once a round: the object flips the round to counted once, so two asks at once can't both run it; one that
  // throws puts it back, so a later ask runs it again (the voucher stays the round's either way)
  if (out.ok && typeof PAY.paid === 'function' && (await stub.step(key, { count: true })).count)
    try {
      await PAY.paid({ body, player, env, pays, voucher: out.voucher });
    } catch (e) {
      await stub.step(key, { count: false }).catch(() => {});
      throw e;
    }
  return reply(out);
}
