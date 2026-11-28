// The live voucher key in the game's economy: when `xcore secret set VOUCHER_SEED --new-key` makes one, the grants the
// server pays are pointed at its address here, so the owner copies no address by hand. The grants a server pays: those
// that name a voucher key already, and those its PAY.check names. Each gets the new address, in place of the live key
// this made before (its public address, kept in .gamesfun/vouchers.json; never a seed), and on mainnet without the test
// key, whose seed sits in .dev.vars in plain text. A grant that counts people gets it as the economy's issuer too, unless
// the economy names an issuer of its own choosing. What changes on chain still waits for the owner: `xcore loot approve`.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CMD } from './command.mjs';
import { readEconomy } from './economy.mjs';
import { readVouchers } from './review/code.mjs';
import { seedAddress, VOUCHER_SEED_LINE } from './voucher-seed.mjs';
import { networkOf } from './solana-rpc.mjs';

/** Where the live key's address is kept, from the game's folder. */
export const LIVE_KEY_FILE = ['.gamesfun', 'vouchers.json'];
/** The most voucher keys a grant names (loot). */
const MOST_KEYS = 3;

const byPerson = limits => Boolean(limits?.perPerson || limits?.perPersonEach);

/** The test key's address (its seed is VOUCHER_SEED in .dev.vars), or null. */
async function testKeyOf(dir) {
  try {
    const text = readFileSync(path.join(dir, '.dev.vars'), 'utf8');
    const seed = VOUCHER_SEED_LINE.exec(text)?.[1];
    return seed ? await seedAddress(seed.toLowerCase()) : null;
  } catch {
    return null;
  }
}

/**
 * The grants PAY.check pays, of `keys` (the economy's grant keys): each it names as a quoted string, however it hands
 * it on (`grant: 'clear'`, `const grant = boss ? "boss" : "clear"`), in server/vouchers.js.
 */
export async function grantsPaid(dir, keys) {
  const file = path.join(dir, 'server', 'vouchers.js');
  if (!existsSync(file)) return [];
  const body = readVouchers(await readFile(file, 'utf8')).check?.body ?? '';
  const quoted = new Set([...body.matchAll(/(['"`])([\w-]+)\1/g)].map(m => m[2]));
  return keys.filter(k => quoted.has(k));
}

/** The live voucher key's address this machine made last (`secret set VOUCHER_SEED --new-key`), or null. */
export function liveKeyOf(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, ...LIVE_KEY_FILE), 'utf8')).liveKey ?? null;
  } catch {
    return null;
  }
}

/**
 * Points the grants the server pays at the live key `address`, in the game's economy file. → {economy (its path, or
 * null when there is none), changed: [lines saying each change], left: [lines saying what was left as it is]}
 */
export async function pointGrantsAt(dir, address) {
  // read first: an economy file that does not read refuses before the key's address is kept
  const { economy, spec } = readEconomy(dir);
  const keyFile = path.join(dir, ...LIVE_KEY_FILE);
  const old = liveKeyOf(dir);
  await mkdir(path.dirname(keyFile), { recursive: true });
  await writeFile(keyFile, `${JSON.stringify({ liveKey: address }, null, 2)}\n`);
  if (!economy) return { economy: null, changed: [], left: [] };
  const test = await testKeyOf(dir);
  const mainnet = networkOf(spec) === 'mainnet';
  const grantKeys = (Array.isArray(spec.grants) ? spec.grants : []).map(g => g?.key).filter(Boolean);
  const paid = await grantsPaid(dir, grantKeys);
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
    if (unknown.length)
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
  // none to point at it yet: said, with what does it once PAY.check names the grants it pays
  if (!spec.grants.some(g => g?.vouchers?.includes(address)))
    left.push(
      `No grant in ${path.basename(economy)} takes vouchers from ${address} yet: none names a voucher key, and PAY.check names none of ${grantKeys.length ? grantKeys.map(k => `"${k}"`).join(', ') : 'its grants (it has none)'}. Once PAY.check names the grants it pays, ${CMD} add vouchers points them at this key (it makes no new one).`,
    );
  return { economy, changed, left };
}

/**
 * On devnet, the test key (`address`, its seed in .dev.vars) in each grant the server pays (one naming a voucher key
 * already, or one PAY.check names), so claims signed under xcore dev pay with no address copied. Never on mainnet. →
 * {changed: [lines]}
 */
export async function addTestKey(dir, address) {
  const { economy, spec } = readEconomy(dir);
  if (!economy || networkOf(spec) === 'mainnet') return { changed: [] };
  if (!Array.isArray(spec.grants)) return { changed: [] };
  const paid = await grantsPaid(dir, spec.grants.map(g => g?.key).filter(Boolean));
  const changed = [];
  spec.grants = spec.grants.map(g => {
    const listed = Array.isArray(g?.vouchers) ? g.vouchers : [];
    if ((!listed.length && !paid.includes(g?.key)) || listed.includes(address) || listed.length >= MOST_KEYS) return g;
    changed.push(
      `"${g.key}" takes vouchers from the test key (${address}) too: claims signed under ${CMD} dev pay on devnet.`,
    );
    return { ...g, vouchers: [...listed, address] };
  });
  if (changed.length) await writeFile(economy, `${JSON.stringify(spec, null, 2)}\n`);
  return { changed };
}
