// The reef, run on the server: a tide's seed stays here, the page sends only taps, and the server decides what turns
// up. One open tide a player, steps in order, on the server's clock.
import { DurableObject } from 'cloudflare:workers';

const PATH = /\/api\/tide\/(start|step)\/?$/;
const TIDE_MS = 120_000;

/** One step of the reef: food dropped, creatures grow; a whale turns up when the reef is fed well enough. */
function advance(state, taps, seconds) {
  for (const t of taps) state.food += Math.min(1, Math.hypot(t.x, t.y) / 100);
  state.rand = (state.rand * 1664525 + 1013904223) >>> 0;
  state.growth += seconds * state.food * ((state.rand % 100) / 100);
  if (state.growth > 500) state.seen.whale = true;
}

export class Reef extends DurableObject {
  async act(action, body) {
    const now = Date.now();
    const rec = (await this.ctx.storage.get('rec')) ?? { earned: {} };
    if (action === 'start') {
      rec.run = { id: crypto.randomUUID(), started: now, updated: now, seq: 0 };
      rec.state = { rand: crypto.getRandomValues(new Uint32Array(1))[0], food: 0, growth: 0, seen: {} };
    } else if (action === 'step') {
      if (!rec.run || body.id !== rec.run.id || body.seq !== rec.run.seq + 1) return { ok: false, why: 'Out of order.' };
      if (now - rec.run.started > TIDE_MS) return { ok: false, why: 'The tide is out.' };
      advance(rec.state, (body.taps ?? []).slice(0, 16), (now - rec.run.updated) / 1000);
      rec.run.updated = now;
      rec.run.seq++;
      if (rec.state.seen.whale) rec.earned.whale = { run: rec.run.id, at: now };
    } else if (action === 'earned') return { ok: !!rec.earned[body.species] };
    await this.ctx.storage.put('rec', rec);
    return { ok: true, run: { id: rec.run.id, seq: rec.run.seq, earned: rec.earned } };
  }
}

export const reefOf = (env, player) => env.REEF.get(env.REEF.idFromName(player.sub));

export async function handleReef(request, env) {
  const m = PATH.exec(new URL(request.url).pathname);
  if (!m) return null;
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const player = await env.GF.verifyPlayer(token);
  if (!player.ok) return Response.json({ ok: false, why: 'Sign in first.' }, { status: 401 });
  const body = request.method === 'POST' ? await request.json() : {};
  return Response.json(await reefOf(env, player).act(m[1], body));
}
