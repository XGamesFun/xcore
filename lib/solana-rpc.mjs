// The Solana RPC a game's economy talks to (devnet only, like loot). One setting, XSOLANA_RPC_URL (@xgamesfun/solana's
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

/** xgames.fun's shared devnet relay (the play host's /loot/v1/rpc). */
export const SHARED_RPC = 'https://play.xgames.fun/loot/v1/rpc';
/** The path a game's page calls, on whatever host serves it. */
export const PAGE_RPC = '/loot/v1/rpc';

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
 * The RPC in use: {url, shared, problem}. `file`: the .env it reads (the folder the command runs in, or GAMESFUN_WORK; the
 * kit passes its workspace's). `shared` is xgames.fun's relay (nothing set). A setting that is mainnet, not a
 * URL, or plain http to anything but this machine is not used: `problem` says why and `url` is the shared relay.
 */
export function solanaRpc(env = process.env, { file = path.join(env.GAMESFUN_WORK || process.cwd(), '.env') } = {}) {
  const value = setting(env, file);
  if (!value) return { url: SHARED_RPC, shared: true, problem: null };
  const refuse = why => ({
    url: SHARED_RPC,
    shared: true,
    problem: `XSOLANA_RPC_URL ${why}; using xgames.fun's shared devnet RPC instead`,
  });
  let url;
  try {
    url = new URL(value);
  } catch {
    return refuse('is not a URL');
  }
  if (/mainnet/i.test(value)) return refuse('is a mainnet RPC (loot runs on devnet only until it is audited)');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL.test(url.hostname)))
    return refuse('must start with https:// (http:// only for a validator on this machine)');
  return { url: value, shared: false, problem: null };
}

/** The RPC in words, never its URL when it is the person's own (it usually carries their key). */
export function rpcWords(rpc) {
  if (rpc.shared)
    return `xgames.fun's shared devnet RPC (${SHARED_RPC}; set XSOLANA_RPC_URL in .env to use your own)${rpc.problem ? `: ${rpc.problem}` : ''}`;
  let host = 'your own';
  try {
    host = new URL(rpc.url).host;
  } catch {}
  return `your own devnet RPC (XSOLANA_RPC_URL, ${host})`;
}

/**
 * The game folder's own RPC for its server (`xcore add rpc`): XSOLANA_RPC_URL from its .dev.vars (what xcore dev gives
 * the server), else from the folder's .env. → {url, origin, from} or null (none set, or one solanaRpc would not use).
 */
export function serverRpc(dir) {
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
    const rpc = solanaRpc({ XSOLANA_RPC_URL: value }, { file: null });
    if (rpc.shared) return null;
    return { url: rpc.url, origin: new URL(rpc.url).origin, from: name };
  }
  return null;
}
