// The game's multiplayer rooms on games.fun, written into server/ by `xcore add multiplayer`. Part of the game's server
// code (docs/SERVER.md): one Durable Object a room, holding its players' WebSockets at the game's own
// api/rooms/<CODE>. Nothing to sign up for and no keys; publish puts it up with the game. The page joins through
// gamesfun.js (GamesFun.rooms.join), Godot's high-level multiplayer through the GamesFun peer, Unity through
// GamesFun.JoinRoom.
//
// A room is a relay with a host. The first player in is the host (id 1, as Godot's server); every other player gets an
// id of its own. A message goes to one player, to everyone else, or to everyone but one; the room never reads it.
// When the host leaves, the player who joined next becomes the host (a Godot client sees its server leave).
//
//   GET api/rooms/<CODE>                        → {ok, code, players, locked}
//   WebSocket api/rooms/<CODE>
//     → {t: 'hello', token?, name?, host?}      first: who joins (the sign-in token gamesfun.js holds, if any);
//                                               host: true opens a new room only, false joins one only
//     ← {t: 'welcome', id, host, peers, code}   peers: [{id, name, player}] already there
//     → {t: 'msg', to, d}   ← {t: 'msg', from, d}            any JSON; to: 0 everyone else, n one player, -n all but n
//     → binary [to: int32 LE][bytes]   ← [from: int32 LE][bytes]   the same, for bytes (Godot's packets)
//     → {t: 'msgs', m: [{to, d}]}   ← {t: 'msgs', from, d: [d…]}   several at once (gamesfun.js sends a frame's so)
//     → binary [BATCH][to, length: uint32, bytes]…   ← [BATCH][from, length, bytes]…   BATCH: int32 -2^31
//     → {t: 'lock', on}                         the host closes the room to new players, or opens it
//     ← {t: 'join', peer}  {t: 'leave', id}  {t: 'host', id}  {t: 'error', code, why}
//
// Change what a room allows in ROOM below.

import { DurableObject } from 'cloudflare:workers';

export const ROOM = {
  /** Most players in one room. */
  maxPlayers: 16,
  /** Only players signed in to games.fun may join (their games.fun id and X handle come with them). */
  signedIn: false,
  /** The largest message, in bytes. */
  messageBytes: 64 * 1024,
  /** Messages a player may send in a second; past it they are dropped (and the player told once). gamesfun.js sends a
   *  frame's messages as one, so a game at 60 frames a second sends 60. */
  perSecond: 120,
};

export const CODE = /^[A-Z0-9]{4,8}$/;
const HOST = 1;
const BATCH = -2147483648;
const te = new TextEncoder();

/** A room code as players type it: upper-cased; null when it is not one (4 to 8 letters and digits). */
export const roomCode = s => {
  const c = String(s ?? '')
    .trim()
    .toUpperCase();
  return CODE.test(c) ? c : null;
};

/** The players of a room as its sockets remember them (kept through hibernation). */
const seated = ctx =>
  ctx
    .getWebSockets()
    .map(ws => ({ ws, seat: ws.deserializeAttachment() }))
    .filter(x => x.seat?.id);
/** The host: the player in the room who joined first (by join number, which ties never share). */
const hostOf = players => players.reduce((h, p) => (h === null || p.seat.seq < h.seat.seq ? p : h), null);
const said = (ws, message) => {
  try {
    ws.send(typeof message === 'string' || message instanceof ArrayBuffer ? message : JSON.stringify(message));
  } catch {
    /* gone */
  }
};
/** The players a message to `to` reaches, from `from`: 0 everyone else, n that one, -n everyone else but n. */
export const reach = (players, from, to) =>
  players.filter(p => (p.seat.id === from ? false : to === 0 ? true : to > 0 ? p.seat.id === to : p.seat.id !== -to));

/** One room (gamesfun.json → server.objects: {class: "GameRoom", binding: "GAME_ROOMS"}). */
export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rate = new Map(); // id → {second, n, told}; lost when the room sleeps, which is fine
    // a ping the room answers without waking up (gamesfun.js keeps a connection alive with it)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    const code = request.headers.get('x-room-code') ?? '';
    if (request.headers.get('upgrade') !== 'websocket') {
      const locked = (await this.ctx.storage.get('locked')) === true;
      return Response.json({ ok: true, code, players: seated(this.ctx).length, locked });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ code, at: Date.now() });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) {
    const seat = ws.deserializeAttachment() ?? {};
    const size = typeof data === 'string' ? te.encode(data).byteLength : data.byteLength;
    if (size > ROOM.messageBytes + 64)
      return said(ws, { t: 'error', code: 'too-big', why: `A message may be ${ROOM.messageBytes / 1024} KB.` });
    if (!seat.id) return this.hello(ws, seat, data);
    if (!this.allowed(ws, seat.id)) return;
    const players = seated(this.ctx);
    if (typeof data !== 'string') {
      // bytes: [to: int32 LE][payload] in, [from: int32 LE][payload] out
      if (data.byteLength < 4) return;
      const to = new DataView(data).getInt32(0, true);
      if (to === BATCH) return this.bytesBatch(ws, seat.id, players, data);
      const out = data.slice(0);
      new DataView(out).setInt32(0, seat.id, true);
      for (const p of reach(players, seat.id, to)) said(p.ws, out);
      return;
    }
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return said(ws, { t: 'error', code: 'bad', why: 'Not JSON.' });
    }
    if (m?.t === 'msg') {
      const text = JSON.stringify({ t: 'msg', from: seat.id, d: m.d ?? null });
      for (const p of reach(players, seat.id, Number(m.to) | 0)) said(p.ws, text);
    } else if (m?.t === 'msgs' && Array.isArray(m.m)) {
      // each player gets its own share of the batch, in order, as one message
      const out = new Map();
      for (const x of m.m)
        for (const p of reach(players, seat.id, Number(x?.to) | 0)) {
          if (!out.has(p.ws)) out.set(p.ws, []);
          out.get(p.ws).push(x.d ?? null);
        }
      for (const [w, d] of out) said(w, JSON.stringify({ t: 'msgs', from: seat.id, d }));
    } else if (m?.t === 'lock') {
      if (hostOf(players)?.seat.id !== seat.id)
        return said(ws, { t: 'error', code: 'not-host', why: 'Only the host locks the room.' });
      await this.ctx.storage.put('locked', m.on !== false);
    }
  }

  /** Bytes for several players at once: each player gets its own share, in order, as one batch from this player. */
  bytesBatch(ws, from, players, data) {
    const dv = new DataView(data);
    const parts = new Map(); // ws → [Uint8Array]
    let at = 4;
    while (at < data.byteLength) {
      if (at + 8 > data.byteLength) return said(ws, { t: 'error', code: 'bad', why: 'A broken batch.' });
      const to = dv.getInt32(at, true);
      const len = dv.getUint32(at + 4, true);
      if (at + 8 + len > data.byteLength) return said(ws, { t: 'error', code: 'bad', why: 'A broken batch.' });
      const record = new Uint8Array(data, at, 8 + len);
      for (const p of reach(players, from, to)) {
        if (!parts.has(p.ws)) parts.set(p.ws, []);
        parts.get(p.ws).push(record);
      }
      at += 8 + len;
    }
    for (const [w, list] of parts) {
      const out = new Uint8Array(4 + list.reduce((n, r) => n + r.length, 0));
      const odv = new DataView(out.buffer);
      odv.setInt32(0, BATCH, true);
      let o = 4;
      for (const r of list) {
        out.set(r, o);
        odv.setInt32(o, from, true); // the sender, in place of the target
        o += r.length;
      }
      said(w, out.buffer);
    }
  }

  /** The first message: who joins. A seat, an id, and the room told. */
  async hello(ws, seat, data) {
    let m = null;
    try {
      m = typeof data === 'string' ? JSON.parse(data) : null;
    } catch {
      /* not JSON */
    }
    if (m?.t !== 'hello') return ws.close(4000, 'Say hello first.');
    const players = seated(this.ctx);
    // a Host button opens a room of its own, a Join button joins one that is there (as over ENet)
    if (m.host === true && players.length)
      return ws.close(4009, 'Someone is in this room already: choose another code.');
    if (m.host === false && !players.length) return ws.close(4004, 'No one is in this room.');
    if (players.length >= ROOM.maxPlayers) return ws.close(4003, 'The room is full.');
    if (players.length && (await this.ctx.storage.get('locked')) === true) return ws.close(4003, 'The room is closed.');
    if (!players.length) await this.ctx.storage.delete('locked');
    let player = null;
    if (m.token) {
      const v = await this.env.GF.verifyPlayer(String(m.token));
      if (v?.ok) player = { id: v.sub, x: v.x?.handle ?? null, wallet: v.wallet ?? null };
    }
    if (ROOM.signedIn && !player) return ws.close(4001, 'Sign in to join this room.');
    const name = String(m.name ?? player?.x ?? '')
      // eslint-disable-next-line no-control-regex -- a name never carries control characters
      .replace(/[\u0000-\u001f<>]/g, '')
      .trim()
      .slice(0, 32);
    // the first in is the host, id 1; every other player a random id of its own (2 … 2^31 - 1, as Godot's)
    const taken = new Set(players.map(p => p.seat.id));
    let id = taken.has(HOST) || players.length ? 0 : HOST;
    while (!id || taken.has(id)) id = 2 + Math.floor(Math.random() * 0x7ffffffd);
    const seq = players.reduce((n, p) => Math.max(n, p.seat.seq ?? 0), 0) + 1;
    const mine = { ...seat, id, name, player, seq, joined: Date.now() };
    ws.serializeAttachment(mine);
    const host = hostOf([...players, { ws, seat: mine }]).seat.id;
    said(ws, {
      t: 'welcome',
      id,
      host,
      code: seat.code,
      peers: players.map(p => ({ id: p.seat.id, name: p.seat.name, player: p.seat.player })),
    });
    const join = JSON.stringify({ t: 'join', peer: { id, name, player } });
    for (const p of players) said(p.ws, join);
  }

  allowed(ws, id) {
    const second = Math.floor(Date.now() / 1000);
    const r = this.rate.get(id) ?? { second, n: 0, told: false };
    if (r.second !== second) Object.assign(r, { second, n: 0 });
    r.n++;
    this.rate.set(id, r);
    if (r.n <= ROOM.perSecond) return true;
    if (!r.told) {
      r.told = true;
      said(ws, {
        t: 'error',
        code: 'rate',
        why: `At most ${ROOM.perSecond} messages a second; the rest were dropped.`,
      });
    }
    return false;
  }

  async webSocketClose(ws) {
    await this.left(ws);
  }

  async webSocketError(ws) {
    await this.left(ws);
  }

  async left(ws) {
    const seat = ws.deserializeAttachment();
    if (!seat?.id) return;
    ws.serializeAttachment({ ...seat, id: 0 });
    this.rate.delete(seat.id);
    // the room as it was, with this player: a closed socket may already be gone from getWebSockets()
    const players = seated(this.ctx).filter(p => p.ws !== ws);
    const before = hostOf([...players, { ws, seat }]);
    const leave = JSON.stringify({ t: 'leave', id: seat.id });
    for (const p of players) said(p.ws, leave);
    // the host left: the player who joined next takes over (said once, to everyone)
    const after = hostOf(players);
    if (after && before?.seat.id === seat.id) {
      const next = JSON.stringify({ t: 'host', id: after.seat.id });
      for (const p of players) said(p.ws, next);
    }
    if (!players.length) await this.ctx.storage.delete('locked');
  }
}

/** The page's api/rooms/<CODE>: a WebSocket into the room, or how many are in it; null for any other path. */
export async function handleRooms(request, env) {
  const m = /\/api\/rooms\/([^/]+)\/?$/.exec(new URL(request.url).pathname);
  if (!m) return null;
  const code = roomCode(decodeURIComponent(m[1]));
  if (!code)
    return Response.json({ ok: false, code: 'bad', why: 'A room code is 4 to 8 letters and digits.' }, { status: 400 });
  const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(code));
  const headers = new Headers(request.headers);
  headers.set('x-room-code', code);
  return stub.fetch(new Request(request, { headers }));
}
