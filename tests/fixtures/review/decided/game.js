// Reef Keeper: the page sends where the player drops food; the server runs the reef from a seed it keeps, and says
// what turned up.
const gf = window.GamesFun;
let run = null;

export async function startTide() {
  run = (await gf.api('tide/start', { method: 'POST' })).data?.run ?? null;
}

export async function drop(taps) {
  run = (await gf.api('tide/step', { method: 'POST', body: { id: run.id, seq: run.seq + 1, taps } })).data?.run ?? run;
  if (run.earned?.whale) {
    const r = await gf.api('vouchers/pay', { method: 'POST', body: { species: 'whale' } });
    if (r.data?.voucher) await gf.loot.call('claimGrant', 'discover-whale', { voucher: r.data.voucher });
  }
}
