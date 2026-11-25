// The review's shared words (the trust levels, the severities, the guide the findings point to, this package) and
// where things are: the economy's folder, the grants a voucher pays, the test key's seed, a folder's files.
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pageRoots } from '../publish/page.mjs';
import { jsonResult } from '../util.mjs';
import { VOUCHER_SEED_LINE } from '../voucher-seed.mjs';

/** How much the server holding a grant's voucher key checks before it signs, strongest first (the grant's `trust`). */
export const TRUST = ['decides', 'replays', 'bounds'];
export const SEVERITIES = ['high', 'medium', 'low', 'info'];
export const PACKAGE = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
export const GUIDE = 'docs/SERVER.md, "What a payout rests on"';
export const posix = p => p.split(path.sep).join('/');

/**
 * What every result of the review says of itself, the same on the screen, in review.md and in review.json: what was
 * read, how, what its verdict means, and where the reading of a payout (./code.mjs) stops.
 */
/** The three verdicts: no high finding and every payout read; a high finding; no high finding, but a payout not read. */
export const VERDICTS = ['PASS', 'FAIL', 'INCONCLUSIVE'];
/** The verdict of findings and unread parts. */
export const verdictOf = (findings, unread) =>
  findings.some(f => f.severity === 'high') ? 'FAIL' : unread.some(u => u.payout) ? 'INCONCLUSIVE' : 'PASS';

export const METHOD = [
  "What was read: the economy file (by @xgamesfun/solana's own review), the code in server/ and the page's files; with --live, what the published game answers a stranger.",
  "How: as text, by patterns. None of the game's code is run and none is parsed, so code written in a way the patterns do not know is read wrongly, or not at all.",
  `A PASS means no high finding in what was read, and every payout read through. It is not proof that the game is safe to pay real money from: read each paid route's check yourself against ${GUIDE}. A payout the reading could not follow makes the verdict INCONCLUSIVE, never PASS.`,
  "Where the reading of a payout stops: it follows PAY.check into the game's own functions in server/, three calls deep, and reads a route that signs by itself (a keeper report, signVoucher, voucherFor) in the one function around the call, by the usual names (request, env, body). A binding of env the code calls or reads into counts as state the server keeps only when what it reads reaches the decision (a condition, or what the check answers): a read nothing uses, or a query with no table, is none. Each table or KV namespace the check reads is looked for among the writes in server/: one written from a request is player input. Not state either: what the page writes for its own player (saves, and the page's GamesFun.db documents), which counts as player input, as the request's body does: reading it never makes a payout safe. env handed to code it did not read, and what the check was handed read by a computed key (ctx[k], Reflect.get), are not followed: the verdict is INCONCLUSIVE. A check that pays several grants is judged as one, and a grant's trust is the economy file's word.",
];

/**
 * A JSON file read strictly. → {value}, its object; {missing: true} when there is no such file; {error} when it is
 * there and cannot be read as a JSON object, with why in words.
 */
export function jsonFile(file) {
  const r = jsonResult(file);
  if (r.missing) return { missing: true };
  if (r.error) return { error: `it ${r.error}` };
  return r.value && typeof r.value === 'object' && !Array.isArray(r.value)
    ? { value: r.value }
    : { error: 'it holds no JSON object' };
}

/**
 * Where a game's files are, for the review (`pageRoots`). A gamesfun.json that is there and is not JSON is read as no
 * settings here: the review names it as a high finding of its own (record.mjs) and goes on, where other commands stop.
 */
export function reviewRoots(dir) {
  try {
    return pageRoots(dir);
  } catch (e) {
    if (e.code !== 'not-json') throw e;
    const root = path.resolve(dir);
    return { dir: root, brought: false, build: null, out: root, static: root, overlay: null, title: null };
  }
}

/** The folder a game's economy lives in, as `xcore loot add` puts it: a brought game's static folder, else its own. */
export function economyHome(dir) {
  const r = reviewRoots(dir);
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
