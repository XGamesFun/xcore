// Reef Watch's server: the voucher key (vouchers.js) and the tide clock (tides.js).
import { handleVouchers } from './vouchers.js';
import { handleTides } from './tides.js';

export { GameVouchers } from './vouchers.js';
export { TideClock } from './tides.js';

export default {
  async fetch(request, env) {
    return (await handleVouchers(request, env)) ?? (await handleTides(request, env)) ?? new Response('not found', { status: 404 });
  },
};
