// Reef Watch: the page runs the reef, and says when a big creature turns up. The server only times the tide.
const gf = window.GamesFun;
let runId = null;

export async function startTide() {
  const r = await gf.api('tide/start', { method: 'POST' });
  runId = r.data?.runId ?? null;
}

// the page decides what it found, and tells the server: a script can say the same
export async function found(creature) {
  await gf.api('tide/found', { method: 'POST', body: { runId, creature } });
  const r = await gf.api('vouchers/pay', { method: 'POST', body: { creature } });
  if (r.data?.voucher) await gf.loot.call('claimGrant', `found-${creature}`, { voucher: r.data.voucher });
}
