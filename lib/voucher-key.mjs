// The live voucher key in the game's economy: when `xcore secret set VOUCHER_SEED --new-key` makes one, the grants the
// server pays are pointed at its address here, so the owner copies no address by hand. The grants a server pays: those
// that name a voucher key already, and those its PAY.check names. Each gets the new address, in place of the live key
// this made before (its public address, kept in .gamesfun/vouchers.json; never a seed), and on mainnet without the test
// key, whose seed sits in .dev.vars in plain text. A grant that counts people gets it as the economy's issuer too, unless
// the economy names an issuer of its own choosing. What changes on chain still waits for the owner: `xcore loot approve`.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { seedAddress } from './add.mjs';
import { economyFile } from './economy.mjs';
import { pageRoots } from './publish/page.mjs';
import { readVouchers } from './review.mjs';
import { economyCluster } from './solana-rpc.mjs';

/** Where the live key's address is kept, from the game's folder. */
export const LIVE_KEY_FILE = ['.gamesfun', 'vouchers.json'];
/** The most voucher keys a grant names (loot). */
const MOST_KEYS = 3;

const byPerson = limits => Boolean(limits?.perPerson || limits?.perPersonEach);

/** The test key's address (its seed is VOUCHER_SEED in .dev.vars), or null. */
async function testKeyOf(dir) {
  try {
    const text = readFileSync(path.join(dir, '.dev.vars'), 'utf8');
    const seed = /^\s*VOUCHER_SEED\s*=\s*["']?([0-9a-fA-F]{64})["']?\s*$/m.exec(text)?.[1];
    return seed ? await seedAddress(seed.toLowerCase()) : null;
  } catch {
    return null;
  }
}

/** The grant keys PAY.check names (`grant: 'clear'`) in server/vouchers.js. */
async function grantsPaid(dir) {
  const file = path.join(dir, 'server', 'vouchers.js');
  if (!existsSync(file)) return [];
  const body = readVouchers(await readFile(file, 'utf8')).check?.body ?? '';
  return [...body.matchAll(/\bgrant\s*:\s*['"]([\w-]+)['"]/g)].map(m => m[1]);
}

/**
 * Points the grants the server pays at the live key `address`, in the game's economy file. → {economy (its path, or
 * null when there is none), changed: [lines saying each change], left: [lines saying what was left as it is]}
 */
export async function pointGrantsAt(dir, address) {
  const roots = pageRoots(dir);
  const economy = economyFile(roots.brought && roots.static ? roots.static : dir);
  const keyFile = path.join(dir, ...LIVE_KEY_FILE);
  const old = existsSync(keyFile) ? (JSON.parse(await readFile(keyFile, 'utf8')).liveKey ?? null) : null;
  await mkdir(path.dirname(keyFile), { recursive: true });
  await writeFile(keyFile, `${JSON.stringify({ liveKey: address }, null, 2)}\n`);
  if (!economy) return { economy: null, changed: [], left: [] };
  const spec = JSON.parse(await readFile(economy, 'utf8'));
  const test = await testKeyOf(dir);
  const mainnet = economyCluster(economy) === 'mainnet';
  const paid = await grantsPaid(dir);
  const changed = [];
  const left = [];
  let counted = false;
  spec.grants = (Array.isArray(spec.grants) ? spec.grants : []).map(g => {
    const listed = Array.isArray(g?.vouchers) ? g.vouchers : [];
    if (!listed.length && !paid.includes(g?.key)) return g;
    let keys = listed.filter(k => k !== old && !(mainnet && k === test));
    if (!keys.includes(address)) keys = [...keys, address];
    if (keys.length > MOST_KEYS) {
      left.push(
        `"${g.key}" names ${listed.length} voucher keys already, the most a grant takes: put ${address} in place of one of them.`,
      );
      return g;
    }
    // a key this machine can't name (an earlier live key made before its address was kept, or the keeper's) is left:
    // said, as an old live key in a grant still signs for it
    const unknown = keys.filter(k => k !== address && k !== test);
    if (!old && unknown.length)
      left.push(
        `"${g.key}" also takes vouchers from ${unknown.join(' and ')}: if that is a live key this replaces, take it out of "vouchers" (a key a grant names still signs for it), then approve; xgames.fun's keeper's key can stay.`,
      );
    if (JSON.stringify(keys) === JSON.stringify(listed)) return g;
    const gone = listed.filter(k => !keys.includes(k));
    changed.push(
      `"${g.key}" now takes vouchers from ${address}${gone.length ? `, in place of ${gone.map(k => (k === test ? `the test key (${k})` : k)).join(' and ')}` : ''}.`,
    );
    if (byPerson(g.limits)) counted = true;
    return { ...g, vouchers: keys };
  });
  // the issuer: a grant that counts people counts the person a voucher names only when the issuer signed it
  if (counted || spec.grants.some(g => byPerson(g?.limits) && g.vouchers?.includes(address))) {
    const issuer = spec.keys?.issuer ?? null;
    if (issuer !== address) {
      if (!issuer || issuer === old || issuer === test) {
        spec.keys = { ...(spec.keys ?? {}), issuer: address };
        changed.push(
          `The economy's issuer is now ${address}${issuer ? ` (it was ${issuer === test ? 'the test key' : issuer})` : ''}: a grant that counts people counts the person a voucher names only when the issuer signed it.`,
        );
      } else
        left.push(
          `The economy's issuer is ${issuer}, which you chose: a grant that counts people counts the person this server's vouchers name only when the issuer is ${address}.`,
        );
    }
  }
  if (changed.length) await writeFile(economy, `${JSON.stringify(spec, null, 2)}\n`);
  return { economy, changed, left };
}
