// The design: what the economy spec declares the server does off chain (its "offchain" conversions and each voucher
// grant's serverLimit, SERVER_LIMIT below), with the small helpers every part of the pass uses.
import path from 'node:path';
import { voucherGrants } from '../review/where.mjs';

/** A file's name for the person: server/x.js, or a module of the game's own server/ imports (../rules.js → rules.js). */
export const serverPath = f => path.posix.normalize(`server/${f}`);

/**
 * A voucher grant's server bound, as the economy kit's maintainers agreed it: `grants[i].serverLimit = {per, amount,
 * every?, total?}`, "the server signs at most `amount` of the prize for one `per` each `every`". per: "person" (the
 * identity the server counts, an X account), "wallet", or "all" (everyone together); amount in the prize's own units
 * (tokens, or a count of an item); every defaults to "1d". The one place its name and shape live.
 */
export const SERVER_LIMIT = {
  field: 'serverLimit',
  per: ['person', 'wallet', 'all'],
  every: '1d',
  /** A declaration in its shape, from what the code shows. */
  make: ({ per, amount, every = null, total = null }) => ({
    per,
    amount,
    ...(every ? { every } : {}),
    ...(total ? { total } : {}),
  }),
  /** Is it on the grant? */
  of(g) {
    return g?.[this.field] ?? null;
  },
};
/** The kit's own field for what a server does off chain. */
export const OFFCHAIN = 'offchain';
export const DRAFTED = 'drafted from code: confirm each before adding';

export const arr = v => (Array.isArray(v) ? v : []);
export const num = v => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/_/g, '')));
export const lineAt = (code, at) => code.slice(0, at).split('\n').length;
export const lineText = (text, line) => (text.split('\n')[line - 1] ?? '').trim();
export const quote = s => `“${s}”`;

/** What a grant's claim gives: {asset: token key or "item:<key>", amount, unit: 'tokens'|'item'} or null. */
function prizeOf(g, spec) {
  const p = g.prize ?? g.gives;
  if (!p || typeof p !== 'object') return null;
  const poolToken = key => arr(spec?.pools).find(x => x.key === key)?.currency ?? null;
  if (p.gives === 'item' || (!p.gives && p.item)) return { asset: `item:${p.item}`, amount: 1, unit: 'item' };
  if (p.gives === 'tokens') {
    const from = typeof p.from === 'string' && p.from.startsWith('pool:') ? poolToken(p.from.slice(5)) : null;
    const asset = from ?? p.currency ?? spec?.currency ?? null;
    return asset ? { asset, amount: num(p.amount) || null, unit: 'tokens' } : null;
  }
  if (!p.gives && p.pool) {
    const asset = poolToken(p.pool);
    return asset ? { asset, amount: num(p.amount) || null, unit: 'tokens' } : null;
  }
  return null;
}

/**
 * The design, as the spec says it: its offchain declarations, each voucher grant (trust, limits, prize, serverLimit),
 * and the names its tokens and items go by (to match in code). → {offchain, grants, assets, farms}
 */
export function designOf(spec) {
  const assets = [
    ...arr(spec?.tokens)
      .filter(t => t?.key)
      .map(t => ({
        asset: t.key,
        label: t.symbol ?? t.key.toUpperCase(),
        names: [t.key, t.symbol, t.name].filter(Boolean),
        mint: typeof t.mint === 'string' ? t.mint : null,
      })),
    ...arr(spec?.items)
      .filter(i => i?.key)
      .map(i => ({
        asset: `item:${i.key}`,
        label: i.name ?? i.key,
        names: [i.key, i.name].filter(Boolean),
        mint: null,
      })),
  ];
  return {
    offchain: arr(spec?.[OFFCHAIN]).filter(x => x && typeof x === 'object'),
    grants: voucherGrants(spec).map(g => ({
      key: g.key,
      id: g.id ?? null,
      name: g.name ?? g.key,
      trust: g.trust ?? null,
      limits: g.limits ?? {},
      prize: prizeOf(g, spec),
      serverLimit: SERVER_LIMIT.of(g),
    })),
    assets,
    farms: arr(spec?.farms)
      .filter(f => f?.key)
      .map(f => ({ key: f.key, rewards: f.rewards ?? null })),
  };
}

/** An asset in words: a token's symbol, an item's name. */
export const labelOf = (design, asset) =>
  asset?.startsWith('farm:')
    ? `more of ${asset.slice(5)}'s rewards`
    : (design.assets.find(a => a.asset === asset)?.label ?? asset ?? 'something');
