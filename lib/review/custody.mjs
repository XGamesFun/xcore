// Key custody: each voucher key, every place its bytes are and who can read them; and its findings.
import { CMD } from '../command.mjs';
import { SEVERITIES } from './where.mjs';

// For each key the game involves (the test voucher key, whose seed is in .dev.vars; the live one, held by xgames.fun; any
// key or seed in the page's files), every place its bytes are and who can read each one. A place outside the key's one
// intended holder is a finding, key-custody. Its severity is how far the place reaches, one level higher when the key
// signs for a grant on mainnet (real money).
const PLACES = {
  holder: { reach: 'its one intended holder', severity: null },
  git: { reach: 'everyone with a copy of the repository, in its history for good', severity: 'high' },
  unignored: { reach: 'not in .gitignore: the next `git add .` puts it in the repository', severity: 'low' },
  served: {
    reach:
      'inside the folder the page is served from: xgames.fun leaves hidden files out, but any other host that serves the folder serves it',
    severity: 'medium',
  },
  page: { reach: "in the page's files, which are public: a key there signs for anyone", severity: 'high' },
  grant: { reach: 'named by the grant: anyone with a copy of this folder signs claims for it', severity: 'medium' },
};
const CUSTODY_FIX = {
  git: `git rm --cached .dev.vars, add .dev.vars to .gitignore, and make new keys: delete VOUCHER_SEED from .dev.vars and run ${CMD} add vouchers again (and take the old test key out of every grant).`,
  unignored: 'Add .dev.vars to .gitignore.',
  served: 'Keep .dev.vars at the top of the game folder only, beside gamesfun.json.',
  page: `Take it out of the page: a voucher key lives only on the server (${CMD} secret set VOUCHER_SEED --new-key), and one that was ever in the page is a new key (take the old one out of every grant).`,
  grant:
    'Take the test key out of the grant before the economy holds anything of value; keep only the live key, which only xgames.fun holds.',
  grantMainnet:
    'The economy is on mainnet: take the test key out of the grant now; keep only the live key, which only xgames.fun holds.',
};
const place = (where, kind) => ({ where, kind, reach: PLACES[kind].reach, intended: kind === 'holder' });

/**
 * The custody list. `devVars`: the top .dev.vars' git state ({exists, git, tracked, ignored}); `seed`/`testKey`: the
 * test key's seed and address; `served`: the .dev.vars inside served folders [{rel, text}]; `pageHits`: [{path, line,
 * kind}] from the page's files (kind "the test voucher key's seed" for the test key's own); `grants`: voucherGrants;
 * `vouchers`: server/vouchers.js is there; `mainnet`. → [{key, what, address, holder, signs, network, places}]
 */
export function keyCustody({
  devVars = { exists: false },
  seed = null,
  testKey = null,
  served = [],
  pageHits = [],
  grants = [],
  vouchers = false,
  mainnet = false,
} = {}) {
  const network = mainnet ? 'mainnet' : 'devnet';
  const out = [];
  const gitPlaces = () =>
    devVars.git && devVars.tracked
      ? [place('git history (.dev.vars)', 'git')]
      : devVars.git && !devVars.ignored
        ? [place('.dev.vars, not ignored', 'unignored')]
        : [];
  if (seed) {
    const signs = testKey ? grants.filter(g => g.vouchers.includes(testKey)).map(g => g.key) : [];
    out.push({
      key: 'test',
      what: 'the test voucher key',
      address: testKey,
      holder: '.dev.vars (VOUCHER_SEED), on this machine',
      signs,
      signsKnown: Boolean(testKey),
      network,
      places: [
        place('.dev.vars', 'holder'),
        ...gitPlaces(),
        ...served.filter(s => s.text.toLowerCase().includes(seed)).map(s => place(s.rel, 'served')),
        ...pageHits.filter(h => h.kind === "the test voucher key's seed").map(h => place(h.path, 'page')),
        ...signs.map(k => place(`grant:${k}`, 'grant')),
      ],
    });
  } else if (devVars.exists)
    out.push({
      key: 'dev-vars',
      what: 'the secrets in .dev.vars',
      address: null,
      holder: '.dev.vars, on this machine',
      signs: [],
      signsKnown: false,
      network,
      places: [place('.dev.vars', 'holder'), ...gitPlaces()],
    });
  if (vouchers)
    out.push({
      key: 'live',
      what: 'the live voucher key',
      address: null,
      holder: `xgames.fun only (the secret VOUCHER_SEED, made by ${CMD} secret set VOUCHER_SEED --new-key)`,
      signs: [],
      signsKnown: false, // its address is the live server's to say (--live)
      network,
      places: [place('xgames.fun', 'holder')],
    });
  for (const s of served)
    if (!seed || !s.text.toLowerCase().includes(seed))
      out.push({
        key: `dev-vars:${s.rel}`,
        what: `the secrets in ${s.rel}`,
        address: null,
        holder: '.dev.vars at the top of the game folder, on this machine',
        signs: [],
        signsKnown: false,
        network,
        places: [place(s.rel, 'served')],
      });
  for (const h of pageHits)
    if (h.kind !== "the test voucher key's seed")
      out.push({
        key: `page:${h.path}:${h.kind}`,
        what: /^an? |^the /.test(h.kind) ? h.kind : `a ${h.kind}`,
        address: null,
        holder: `the server only (a secret: ${CMD} secret set)`,
        signs: [],
        signsKnown: false,
        network,
        places: [place(`${h.path}${h.line ? `:${h.line}` : ''}`, 'page')],
      });
  return out;
}

/** What a key signs, in words. */
export const signsWords = k =>
  k.signs.length
    ? `${k.signs.map(g => `grant:${g}`).join(', ')} on ${k.network}`
    : k.signsKnown
      ? 'no grant this economy names'
      : 'not known here (whatever it is the key to)';

/** One key-custody finding for each place a key is outside its holder. */
export function custodyFindings(custody) {
  const out = [];
  for (const k of custody) {
    const real = k.network === 'mainnet' && k.signs.length > 0;
    for (const p of k.places.filter(x => !x.intended)) {
      const base = PLACES[p.kind].severity;
      out.push({
        source: 'server',
        id: 'key-custody',
        severity: real ? SEVERITIES[Math.max(0, SEVERITIES.indexOf(base) - 1)] : base,
        route: p.where,
        key: k.key,
        place: p.kind,
        message: `${k.what}${k.address ? ` (${k.address})` : ''} is in ${p.where}: ${p.reach}. Its one holder is ${k.holder}; it signs ${signsWords(k)}.`,
        fix: CUSTODY_FIX[p.kind === 'grant' && k.network === 'mainnet' ? 'grantMainnet' : p.kind],
      });
    }
  }
  return out;
}
