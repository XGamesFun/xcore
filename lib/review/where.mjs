// The review's shared words (the trust levels, the severities, the guide the findings point to, this package) and
// where things are: the economy's folder, the grants a voucher pays, the test key's seed, a folder's files.
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pageRoots } from '../publish/page.mjs';
import { VOUCHER_SEED_LINE } from '../voucher-seed.mjs';

/** How much the server holding a grant's voucher key checks before it signs, strongest first (the grant's `trust`). */
export const TRUST = ['decides', 'replays', 'bounds'];
export const SEVERITIES = ['high', 'medium', 'low', 'info'];
export const PACKAGE = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
export const GUIDE = 'docs/SERVER.md, "What a payout rests on"';
export const posix = p => p.split(path.sep).join('/');

/** The folder a game's economy lives in, as `xcore loot add` puts it: a brought game's static folder, else its own. */
export function economyHome(dir) {
  const r = pageRoots(dir);
  return r.static ?? r.out;
}

/** The grants a voucher pays: those that name at least one voucher key. */
export const voucherGrants = spec =>
  (Array.isArray(spec?.grants) ? spec.grants : []).filter(g => Array.isArray(g?.vouchers) && g.vouchers.length);

/** The test key's seed in .dev.vars (VOUCHER_SEED), or null. */
export function devSeed(dir) {
  try {
    const text = readFileSync(path.join(dir, '.dev.vars'), 'utf8');
    return VOUCHER_SEED_LINE.exec(text)?.[1].toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** Every file under `root` (no hidden files or folders, no node_modules, evidence or `skip` folders), as posix paths. */
export async function filesUnder(root, { skip = [] } = {}) {
  const out = [];
  async function walk(abs, rel) {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && e.name === 'evidence') continue;
      if (skip.includes(r)) continue;
      if (e.isDirectory()) await walk(path.join(abs, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  }
  await walk(root, '');
  return out.sort();
}
