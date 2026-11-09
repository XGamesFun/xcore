// The game's own voucher key (xcore add vouchers wrote the rest of this file; only what the review reads is kept here).
import { clockOf } from './tides.js';

export const PAY = {
  // a whale the tide clock took: the server bounds the result (its clock), it does not see the reef
  async check({ body, player, env }) {
    if (body?.creature !== 'whale') return { why: 'Only a whale earns an NFT.' };
    if (!(await clockOf(env).has(player.sub, 'whale'))) return { why: 'No whale in a tide this server timed.' };
    return { grant: 'found-whale', round: `${player.sub}:whale`, amount: 'grant' };
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
