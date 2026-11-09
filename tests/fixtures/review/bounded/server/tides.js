// The tide clock: the server starts a tide on its own clock and takes a creature found no sooner than the game
// allows. It cannot see the reef: the page says what it found.
import { DurableObject } from 'cloudflare:workers';

const PATH = /\/api\/tide\/(start|found)\/?$/;
const FASTEST = 90; // seconds before a whale can turn up

export class TideClock extends DurableObject {
  async start(player) {
    const run = { id: crypto.randomUUID(), at: Date.now() };
    await this.ctx.storage.put(`run:${player}`, run);
    return run;
  }
  async found(player, runId, creature) {
    const run = await this.ctx.storage.get(`run:${player}`);
    if (!run || run.id !== runId) return { ok: false, why: 'Not your tide.' };
    if ((Date.now() - run.at) / 1000 < FASTEST) return { ok: false, why: 'Too fast.' };
    await this.ctx.storage.put(`found:${player}:${creature}`, true);
    return { ok: true };
  }
  async has(player, creature) {
    return (await this.ctx.storage.get(`found:${player}:${creature}`)) === true;
  }
}

export const clockOf = env => env.TIDE_CLOCK.get(env.TIDE_CLOCK.idFromName('main'));

export async function handleTides(request, env) {
  const m = PATH.exec(new URL(request.url).pathname);
  if (!m) return null;
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const player = await env.GF.verifyPlayer(token);
  if (!player.ok) return Response.json({ ok: false, why: 'Sign in first.' }, { status: 401 });
  const body = request.method === 'POST' ? await request.json() : {};
  if (m[1] === 'start') return Response.json({ ok: true, runId: (await clockOf(env).start(player.sub)).id });
  return Response.json(await clockOf(env).found(player.sub, body.runId, body.creature));
}
