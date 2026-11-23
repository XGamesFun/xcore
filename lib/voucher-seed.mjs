// A voucher key's seed: the VOUCHER_SEED line of .dev.vars that holds one, and the address a seed signs as. Kept apart
// from ./add.mjs (which re-exports both) because add.mjs imports ./voucher-key.mjs: voucher-key.mjs and review read
// them here, so nothing imports back into add.mjs.
import { createPrivateKey, createPublicKey } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NO_SOLANA, solanaRoot } from './economy.mjs';

/** A VOUCHER_SEED line in .dev.vars that holds a seed: 32 bytes in hex, the seed its match's first group. */
export const VOUCHER_SEED_LINE = /^\s*VOUCHER_SEED\s*=\s*["']?([0-9a-fA-F]{64})["']?\s*$/m;

/** An Ed25519 key's address (base58) from its 32-byte seed in hex. */
export async function seedAddress(seed) {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed, 'hex')]);
  const spki = createPublicKey(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })).export({
    format: 'der',
    type: 'spki',
  });
  const root = solanaRoot();
  if (!root) throw new Error(NO_SOLANA);
  const { encodeBase58 } = await import(pathToFileURL(path.join(root, 'js', 'chain', 'base58.js')).href);
  return encodeBase58(new Uint8Array(spki.subarray(-32)));
}
