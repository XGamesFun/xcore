// Reef Keeper's server: the voucher key (vouchers.js) and the reef itself (reef.js), run here from a seed the page
// never sees.
import { handleVouchers } from './vouchers.js';
import { handleReef } from './reef.js';

export { GameVouchers } from './vouchers.js';
export { Reef } from './reef.js';

export default {
  async fetch(request, env) {
    return (await handleVouchers(request, env)) ?? (await handleReef(request, env)) ?? new Response('not found', { status: 404 });
  },
};
