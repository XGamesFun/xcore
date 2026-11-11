// The Solana RPC a game's economy talks to, on the economy's cluster: devnet unless its file says "network":
// "mainnet" (loot has an address of its own on each). One setting, XSOLANA_RPC_URL (@xgamesfun/solana's
// own name for it; LOOT_RPC_URL, its older name, is read too), from the environment or the workspace's .env: unset, it
// is xgames.fun's shared relay (the play host's /loot/v1/rpc, which holds xgames.fun's own RPC key on its side); set,
// it is the person's own devnet RPC (Helius, Triton, QuickNode, a local validator). The shared one is the default
// for now; a published game brings its own with `xcore add rpc` (server/rpc.js at api/rpc, the URL a secret of its
// server), which the page client asks first.
//
// A game's page never holds an RPC URL: it calls `/loot/v1/rpc` on its own host (PAGE_RPC). In `xcore dev` (and the kit's
// dev server) that path is forwarded to this setting, so a key in it stays on the person's machine; on the
// play host it is the shared relay. The kit's own loot tools (lootTool) use the same setting.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { pageRoots } from './publish/page.mjs';

/** xgames.fun's shared relay (the play host's /loot/v1/rpc): devnet's; mainnet's is the same with ?cluster=mainnet. */
export const SHARED_RPC = 'https://play.xgames.fun/loot/v1/rpc';
/** The path a game's page calls, on whatever host serves it. */
export const PAGE_RPC = '/loot/v1/rpc';
/** The clusters loot runs on. */
export const CLUSTERS = Object.freeze(['devnet', 'mainnet']);
/** The relay's address for a cluster: `base` as it is for devnet (as every request was), with ?cluster=mainnet for mainnet. */
export const relayFor = (base, cluster = 'devnet') =>
  cluster === 'devnet' ? base : `${base}${base.includes('?') ? '&' : '?'}cluster=${cluster}`;

/** The cluster an economy is on: its "network", devnet when it names none or is no economy. */
export const networkOf = economy => (CLUSTERS.includes(economy?.network) ? economy.network : 'devnet');

/**
 * The cluster of a game's economy: `at` is its economy file (a .json named on a command), or the game's folder, where
 * the economy is xsolana.json (or loot.json) in the folder itself or, for a brought game, in its static folder (as
 * publish finds it: page.mjs pageRoots). Devnet when there is none, it names none, or it is not JSON.
 */
export function economyCluster(at) {
  const read = file => {
    try {
      return networkOf(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      return 'devnet';
    }
  };
  if (/\.json$/i.test(at) && existsSync(at)) return read(at);
  let homes = [at];
  try {
    const r = pageRoots(at);
    homes = [...new Set([r.static, r.out, at].filter(Boolean))];
  } catch {
    // (no gamesfun.json: the folder alone)
  }
  for (const home of homes)
    for (const name of ['xsolana.json', 'loot.json']) {
      const file = path.join(home, name);
      if (existsSync(file)) return read(file);
    }
  return 'devnet';
}

/** loot's program on each cluster (the kit's own, js/client/cluster.js CLUSTERS). */
export const LOOT_PROGRAMS = Object.freeze({
  devnet: 'xgamesVsZBpCVgJuatfYAFJRmQoccfQf5qtUFNp2Eet',
  mainnet: 'xgames8C758PyweWB9sDw8evvwsTVwyA2fGRUeAXVPy',
});

const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i;

/** XSOLANA_RPC_URL (or LOOT_RPC_URL) from the environment, else from the workspace's .env (`file`), else null. */
function setting(env, file) {
  const own = env.XSOLANA_RPC_URL?.trim() || env.LOOT_RPC_URL?.trim();
  if (own) return own;
  if (!file || !existsSync(file)) return null;
  try {
    const v = parseEnv(readFileSync(file, 'utf8'));
    return v.XSOLANA_RPC_URL?.trim() || v.LOOT_RPC_URL?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * The RPC in use for an economy on `cluster` (devnet unless named): {url, shared, problem, cluster}. `file`: the .env it
 * reads (the folder the command runs in, or GAMESFUN_WORK; the kit passes its workspace's). `shared` is xgames.fun's
 * relay (nothing set): on mainnet it answers a signed-in player of a published game only, so a command run on this
 * machine needs an RPC of the person's own there. A setting that names another cluster, is not a URL, or is plain http
 * to anything but this machine is not used: `problem` says why and `url` is the shared relay.
 */
export function solanaRpc(
  env = process.env,
  { file = path.join(env.GAMESFUN_WORK || process.cwd(), '.env'), cluster = 'devnet' } = {},
) {
  const value = setting(env, file);
  const shared = relayFor(SHARED_RPC, cluster);
  if (!value) return { url: shared, shared: true, problem: null, cluster };
  const refuse = why => ({
    url: shared,
    shared: true,
    problem: `XSOLANA_RPC_URL ${why}; using xgames.fun's shared ${cluster} relay instead`,
    cluster,
  });
  let url;
  try {
    url = new URL(value);
  } catch {
    return refuse('is not a URL');
  }
  if (cluster === 'devnet' && /mainnet/i.test(value))
    return refuse('is a mainnet RPC, and the economy is on devnet (its file names no network, or devnet)');
  if (cluster === 'mainnet' && /devnet|testnet/i.test(value))
    return refuse('is not a mainnet RPC, and the economy is on mainnet');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL.test(url.hostname)))
    return refuse('must start with https:// (http:// only for a validator on this machine)');
  return { url: value, shared: false, problem: null, cluster };
}

/** The RPC in words, never its URL when it is the person's own (it usually carries their key). */
export function rpcWords(rpc) {
  const cluster = rpc.cluster ?? 'devnet';
  if (rpc.shared)
    return `xgames.fun's shared ${cluster} relay (${rpc.url}; set XSOLANA_RPC_URL in .env to use your own)${rpc.problem ? `: ${rpc.problem}` : ''}`;
  let host = 'your own';
  try {
    host = new URL(rpc.url).host;
  } catch {}
  return `your own ${cluster} RPC (XSOLANA_RPC_URL, ${host})`;
}

/**
 * The game folder's own RPC for its server (`xcore add rpc`): XSOLANA_RPC_URL from its .dev.vars (what xcore dev gives
 * the server), else from the folder's .env. → {url, origin, from} or null (none set, or one solanaRpc would not use).
 */
export function serverRpc(dir, cluster = economyCluster(dir)) {
  for (const name of ['.dev.vars', '.env']) {
    const file = path.join(dir, name);
    if (!existsSync(file)) continue;
    let v;
    try {
      v = parseEnv(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const value = v.XSOLANA_RPC_URL?.trim() || v.LOOT_RPC_URL?.trim();
    if (!value) continue;
    const rpc = solanaRpc({ XSOLANA_RPC_URL: value }, { file: null, cluster });
    if (rpc.shared) return null;
    return { url: rpc.url, origin: new URL(rpc.url).origin, from: name };
  }
  return null;
}
