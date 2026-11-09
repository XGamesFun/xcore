// The game's own voucher key (xcore add vouchers wrote the rest of this file; only what the review reads is kept here).
import { reefOf } from './reef.js';

export const PAY = {
  // a whale the reef on the server saw turn up: the server decides the result
  async check({ body, player, env }) {
    if (body?.species !== 'whale') return { why: 'Only a whale earns an NFT.' };
    if (!(await reefOf(env, player).act('earned', { species: 'whale' })).ok) return { why: 'No whale yet.' };
    return { grant: 'discover-whale', round: `${player.x?.id}:whale`, amount: 'grant' };
  },
};

export const VOUCHERS = {
  seconds: 7 * 86400,
  payOnly: 'x',
  perMinute: 20,
};

const PATH = /\/api\/vouchers\/(key|pay|link)\/?$/;

export class GameVouchers {}

export async function handleVouchers(request) {
  return PATH.test(new URL(request.url).pathname) ? Response.json({ ok: false, why: 'Not in this sample.' }) : null;
}
