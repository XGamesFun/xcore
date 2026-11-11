// The player's Solana wallets on a game page, by the Wallet Standard's own handshake (no package: a published page
// has no node_modules). Copied into a game with an economy as gf/loot/wallets.js, beside loot's page client
// (@xgamesfun/xcore's lib/economy.mjs installPage). With its client:
//
//   import { solanaApp, walletStandardSigner } from './gf/loot/play/index.js';   (lootApp in a kit game's older copy)
//   import { solanaWallets, connectWallet, PAGE_RPC } from './gf/loot/wallets.js';
//   const [wallet] = await solanaWallets();                 // none: the browser has no wallet (say so, never fail)
//   const account = await connectWallet(wallet);            // the wallet asks the player
//   const app = solanaApp({ spec, rpcUrl: PAGE_RPC, wallet: walletStandardSigner(wallet, account) });

/** The page's own Solana RPC: the play host's relay once published, xcore dev's forward on the person's machine. */
// (no page, as in a test: the path alone; a game is never checked for an address on this machine it does not use)
export const PAGE_RPC = globalThis.location ? new URL('/loot/v1/rpc', globalThis.location.href).href : '/loot/v1/rpc';
/** The wallet chain of an economy's cluster: devnet unless its file says "network": "mainnet". */
export const chainOf = cluster => (cluster === 'mainnet' ? 'solana:mainnet' : 'solana:devnet');
/** The page's relay for an economy on `cluster`: PAGE_RPC on devnet, with ?cluster=mainnet on mainnet. */
export const pageRpc = (cluster = 'devnet') => (cluster === 'mainnet' ? `${PAGE_RPC}?cluster=mainnet` : PAGE_RPC);

const found = [];
let listening = false;
function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const api = Object.freeze({
    register: (...wallets) => {
      for (const w of wallets) if (!found.includes(w)) found.push(w);
      return () => {};
    },
  });
  // wallets loaded later announce themselves; those loaded earlier answer app-ready
  window.addEventListener('wallet-standard:register-wallet', event => {
    try {
      event.detail(api);
    } catch {}
  });
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
}
listen(); // from the import on, so a wallet that announces itself early is not missed

/** The wallets that can sign on `cluster` (devnet unless named), after `waitMs` for slow ones to announce themselves. */
export async function solanaWallets({ waitMs = 300, cluster = 'devnet' } = {}) {
  const CHAIN = chainOf(cluster);
  listen();
  if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
  return found.filter(
    w => w.chains?.includes(CHAIN) && w.features?.['standard:connect'] && w.features?.['solana:signTransaction'],
  );
}

/** Ask `wallet` for the player's account (the wallet shows its own prompt). → the account, or throws if they said no. */
export async function connectWallet(wallet, { cluster = 'devnet' } = {}) {
  const CHAIN = chainOf(cluster);
  const have = wallet.accounts?.find(a => a.chains?.includes(CHAIN));
  if (have) return have;
  const { accounts } = await wallet.features['standard:connect'].connect();
  const account = accounts.find(a => a.chains?.includes(CHAIN)) ?? accounts[0];
  if (!account) throw new Error(`${wallet.name} gave no account`);
  return account;
}
