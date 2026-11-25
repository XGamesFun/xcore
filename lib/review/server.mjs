// The server, read where it is: server/ and the page's files, as the payout ledger, key custody, work done before a
// token is checked, and the design ↔ code pass (../design-code.mjs) read them; with the api/ routes the code names.
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CMD } from '../command.mjs';
import { designCode } from '../design-code.mjs';
import { isBinaryPath, scanFile } from '../publish/scan.mjs';
import { economyCluster } from '../solana-rpc.mjs';
import { devSeed, filesUnder, posix, reviewRoots, voucherGrants } from './where.mjs';
import { apiRoutes, braced, codeOnly, readVouchers, withoutComments } from './code.mjs';
import { gameOwn, OWN_COPIES, tokenFindings } from './token.mjs';
import { failOpenPaidReads, payoutFindings, payoutLedger, signingSites } from './ledger.mjs';
import { custodyFindings, keyCustody } from './custody.mjs';
import { payoutReads, storedInput } from './stored.mjs';
import { serverWork } from './told.mjs';

export const finding = (source, id, severity, message, fix, route = null) => ({
  source,
  id,
  severity,
  ...(route ? { route } : {}),
  message,
  fix,
});

/** Is `rel` tracked by git in `dir` / left out by its .gitignore? → {git: false} or {git: true, tracked, ignored} */
function gitState(dir, rel) {
  const git = args => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 10_000 });
  const inside = git(['rev-parse', '--is-inside-work-tree']);
  if (inside.error || inside.status !== 0) return { git: false };
  return {
    git: true,
    tracked: git(['ls-files', '--error-unmatch', rel]).status === 0,
    ignored: git(['check-ignore', '-q', rel]).status === 0,
  };
}

const TEXT_CODE = /\.(m?js|cjs|jsx|tsx?|html?|svelte|vue|astro)$/i;

/**
 * The game's own modules that server/ imports from outside it (`../rules.js`), followed through their own relative
 * imports: a multiplier kept there runs in the server as much as one in server/. Never node_modules, the kit's copies
 * or anything outside the game. → [{f: path from server/ ('../rules.js'), code, text}]
 */
async function importedFromServer(dir, read) {
  const serverDir = path.join(dir, 'server');
  const root = path.resolve(dir);
  const seen = new Set(read.map(r => path.resolve(serverDir, r.f)));
  const out = [];
  const queue = read.map(r => ({ abs: path.resolve(serverDir, r.f), code: r.code }));
  const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;
  while (queue.length && out.length < 50) {
    const { abs, code } = queue.shift();
    for (const m of code.matchAll(SPEC)) {
      const target = path.resolve(path.dirname(abs), m[2]);
      const rel = path.relative(root, target);
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
      const parts = rel.split(path.sep);
      if (
        ['server', 'node_modules', 'gf', 'evidence'].includes(parts[0]) ||
        parts.includes('node_modules') ||
        parts.includes('gf-loot')
      )
        continue;
      if (!TEXT_CODE.test(target) || seen.has(target) || !existsSync(target)) continue;
      seen.add(target);
      let text;
      try {
        text = await readFile(target, 'utf8');
      } catch {
        continue;
      }
      const own = withoutComments(text);
      out.push({ f: path.relative(serverDir, target).split(path.sep).join('/'), code: own, text });
      queue.push({ abs: target, code: own });
    }
  }
  return out;
}

/** A signer's payout as a line of what was not read says it. */
const PAID_BY = {
  keeper: 'the result it reports to the keeper',
  other: 'the voucher it signs (signVoucher)',
  server: 'the voucher it signs (voucherFor)',
};

/**
 * The server's part: facts, the payout ledger, the key custody list, their findings, the api/ routes, and `unread`,
 * what bears on a payout or a key that this reading could not read: [{what, why}]. `spec`: the economy (or null);
 * `economy`: its file; `economyRoutes`: the economy review's routes; `addressOf(seed)`: a seed's address (the test
 * key's), or null when it cannot be had.
 */
export async function serverReview(
  dir,
  { spec = null, economy = null, available = false, economyRoutes = [], addressOf = null } = {},
) {
  const roots = reviewRoots(dir);
  const findings = [];
  const add = (id, severity, message, fix, route = null) =>
    findings.push(finding('server', id, severity, message, fix, route));
  const grants = voucherGrants(spec);
  const facts = { server: existsSync(path.join(dir, 'server')), vouchers: false, pay: null, payOnly: null };
  const unread = [];
  const routes = new Map(); // path → [files that name it]
  const named = (r, file) => routes.set(r, [...new Set([...(routes.get(r) ?? []), file])]);

  // server/: its routes, and how it pays
  const serverFiles = (await filesUnder(path.join(dir, 'server'), { skip: ['gf-loot'] })).filter(f =>
    TEXT_CODE.test(f),
  );
  const read = [];
  for (const f of serverFiles) {
    const text = await readFile(path.join(dir, 'server', f), 'utf8');
    read.push({ f, code: withoutComments(text), text });
    for (const r of apiRoutes(text)) named(r, `server/${f}`);
  }
  // the game's own modules server/ imports from outside it (a rules file the page and the server share)
  const imported = await importedFromServer(dir, read);
  tokenFindings(dir, read, add);
  // (read in the game's own files: the parts xcore writes name a game in words of their own)
  const ownCode = gameOwn(read)
    .map(x => x.code)
    .join('\n');
  // A token checked by hand (a JWT library against <play host>/player/v1/key): every game's tokens are signed with the
  // one key, so a check that skips the audience takes a token any other game was given (a game a player signed in to,
  // whose creator then replays the token here). env.GF.verifyPlayer checks it; a hand-made check must name it.
  if (/player\/v1\/key|createRemoteJWKSet|jwtVerify\s*\(/.test(ownCode) && !/\baudience\b|\baud\b|game:/.test(ownCode))
    add(
      'token-any-game',
      'high',
      "The server checks players' tokens itself (xgames.fun's key) but never their audience: every game's tokens are signed with one key, so it takes a token another game was given, and that game's maker can act as any of its players here.",
      "Use env.GF.verifyPlayer(token), which checks it, or pass {issuer: 'xgames.fun', audience: 'game:<this game>'} to jwtVerify.",
    );

  // the payout ledger
  const vouchersFile = path.join(dir, 'server', 'vouchers.js');
  let v = null;
  if (existsSync(vouchersFile)) {
    facts.vouchers = true;
    v = readVouchers(await readFile(vouchersFile, 'utf8'), { files: [...read, ...imported] });
    facts.pay = v.template ? 'template' : v.check ? 'written' : 'unreadable';
    facts.payOnly = v.payOnly;
    // A review that cannot read the check must not pass for it: either the server no longer declares PAY (every
    // payout fails) or what it checks is out of sight, and a high finding that "went away" this way was never fixed.
    if (facts.pay === 'unreadable') {
      unread.push({ what: 'server/vouchers.js', why: 'PAY.check was not found in it', payout: true });
      add(
        'pay-unreadable',
        'high',
        'server/vouchers.js has no readable PAY.check (`export const PAY = { async check(…) { … }, … }` at the top level, not in a comment): the server pays nothing, or what it checks before paying cannot be reviewed.',
        `Put PAY back as \`export const PAY = { … }\` with its check and paid, run the paying route once under ${CMD} dev, then run review again.`,
      );
    }
  }
  // PAY with a check in another file of server/, and no server/vouchers.js: a check the review does not read
  if (!facts.vouchers)
    for (const { f, code } of read) {
      const bare = codeOnly(code);
      const pay = /^export const PAY = \{/m.exec(bare);
      if (!pay || !/\bcheck\b/.test(braced(bare, pay.index + pay[0].length - 1) ?? '')) continue;
      unread.push({
        what: `server/${f}`,
        why: 'it declares PAY, which is read only in server/vouchers.js',
        payout: true,
      });
      add(
        'pay-unreadable',
        'high',
        `server/${f} declares PAY, and this review reads PAY.check only in server/vouchers.js: what the server checks before paying was not reviewed.`,
        `Keep PAY in server/vouchers.js, where ${CMD} add vouchers writes it, then run review again.`,
      );
    }
  // a read of whether a win was paid that, when the chain can't be read, answers "not paid": the server then signs
  // the win again (for another wallet, or a new voucher) and it pays twice
  for (const o of failOpenPaidReads(read))
    add(
      'paid-read-open',
      'medium',
      `${o.where}:${o.line} reads whether a win was paid (${o.call}) and, when the chain can't be read, answers "not paid" (\`${o.code}\`): a win the chain did pay is then signed again, for another wallet or as a new voucher, and pays twice.`,
      `When the read fails, sign nothing: let the error stop the request (or answer {why: 'try again in a moment'}), never false; ${o.call} throws for that reason.`,
    );
  // key custody: the test key (its seed in .dev.vars), the live key, and any key in the page's files
  const seed = devSeed(dir);
  const testKey = seed && addressOf ? await addressOf(seed).catch(() => null) : null;
  const sites = signingSites(read, v);
  // State the payout reads that a route of the game's own stores from a request is the player's word, one request
  // removed: a high finding. A write the reading can't place is a payout not read through (INCONCLUSIVE).
  const checkSite = sites.find(x => x.where === 'server/vouchers.js');
  if (v?.check && checkSite?.source === 'env') {
    const reads = payoutReads(v.check.pieces.map(p => p.text ?? p.bare));
    const stored = storedInput(read, reads);
    for (const t of stored.tainted)
      add(
        'payout-stored-input',
        'high',
        `PAY.check reads ${t.kind === 'table' ? `the table ${t.name}` : `env.${t.name}`}, and ${t.where} writes it with what a request sent (${t.from.join(', ')}): the payout trusts a value the player wrote, one request removed.`,
        `Store only what the server works out itself in what a payout reads (its own clock, an id it makes, the signed-in player from withPlayer), or check the request's values before storing them (${'docs/SERVER.md, "What a payout rests on"'}).`,
      );
    for (const u of stored.unknown)
      unread.push({
        what: u.where,
        payout: true,
        why: `it writes ${u.kind === 'table' ? `the table ${u.name}` : `env.${u.name}`}, which PAY.check reads, outside any function this review reads: whether a request's values go in can't be told`,
      });
  }
  // What decides a payout, where the reading could not follow it. None of it passes. A check that answers through
  // code not read is not reviewed: high. A check that reads what it was handed by a computed key (`ctx[k]`,
  // `Reflect.get(ctx, k)`), a function that signs for a result its callers decide, and env handed to code not read are
  // payout reads not followed: the verdict is INCONCLUSIVE until the code says plainly what it reads.
  for (const s of sites.filter(x => x.source === 'unreadable' || x.assumed)) {
    const check = s.where === 'server/vouchers.js';
    if (check && !v.check) continue;
    const through = s.unread.length ? s.unread.map(n => `\`${n}\``).join(', ') : 'code';
    const opaque = s.opaque?.length > 0;
    unread.push({
      what: s.where,
      payout: true,
      why: opaque
        ? `${check ? 'PAY.check' : `the function around ${PAID_BY[s.signer]}`} reads what it was handed through ${through}: which field it reads (the request's body, or state the server keeps) can't be told by reading. Name the field (ctx.body, ctx.env.X)`
        : s.assumed
          ? `${check ? 'PAY.check' : `the function around ${PAID_BY[s.signer]}`} hands env to ${through}, which was not read: taken as reading state the server keeps`
          : check
            ? `PAY.check answers through ${through}, which was not read`
            : `what decides ${PAID_BY[s.signer]} is in the code that calls its function, which was not read`,
    });
    if (check && !s.assumed && !opaque)
      add(
        'pay-unreadable',
        'high',
        `PAY.check in server/vouchers.js answers through ${through}, which this review did not read (it follows the game's own functions in server/, three calls deep): what the server checks before paying was not reviewed.`,
        "Write what decides the payout in PAY.check, or in a function of the game's own server files that it calls, then run review again.",
      );
  }
  const ledger = payoutLedger(spec, { sites, economyRoutes });
  findings.push(...payoutFindings(ledger, { available, testKey }));

  const devVars = existsSync(path.join(dir, '.dev.vars'))
    ? { exists: true, ...gitState(dir, '.dev.vars') }
    : { exists: false };
  const served = [];
  for (const folder of [...new Set([roots.out, roots.static, roots.overlay].filter(Boolean))])
    if (folder !== path.resolve(dir) && existsSync(path.join(folder, '.dev.vars')))
      served.push({
        rel: posix(path.relative(dir, path.join(folder, '.dev.vars'))),
        text: await readFile(path.join(folder, '.dev.vars'), 'utf8').catch(() => ''),
      });
  if (seed && addressOf) facts.testKey = testKey;
  // (on mainnet a claim is real money: a key whose seed sits in plain text on this machine must not sign for it)
  const mainnet = spec?.network === 'mainnet' || economyCluster(economy ?? dir) === 'mainnet';

  // the page's files: a seed, a key, the test key's own seed; and the routes the page calls
  const pageFiles = await filesUnder(dir, { skip: ['server'] });
  const hits = [];
  for (const f of pageFiles) {
    const full = path.join(dir, f);
    if (isBinaryPath(f)) continue;
    if (statSync(full).size > 8 * 1048576) {
      unread.push({ what: f, why: 'it is over 8 MB: not searched for a key or a seed' });
      continue;
    }
    const bytes = new Uint8Array(await readFile(full));
    hits.push(...scanFile(f, bytes));
    const text = new TextDecoder().decode(bytes);
    if (seed && text.toLowerCase().includes(seed)) hits.push({ path: f, line: 0, kind: "the test voucher key's seed" });
    else {
      const m = /\bseed\w*["']?\s{0,20}[:=]\s{0,20}["'`][0-9a-fA-F]{64}["'`]/i.exec(text);
      if (m)
        hits.push({ path: f, line: text.slice(0, m.index).split('\n').length, kind: 'a seed (64 hex characters)' });
    }
    const top = f.split('/');
    const own = OWN_COPIES.some(c => top.includes(c));
    if (TEXT_CODE.test(f) && !own) for (const r of apiRoutes(text)) named(r, f);
  }
  const seen = new Set();
  const pageHits = hits.filter(h => !seen.has(`${h.path} ${h.kind}`) && seen.add(`${h.path} ${h.kind}`));
  const custody = keyCustody({ devVars, seed, testKey, served, pageHits, grants, vouchers: facts.vouchers, mainnet });
  findings.push(...custodyFindings(custody));

  facts.economy = economy ? posix(path.relative(dir, economy)) : null;
  // design and code: what the spec declares the server does off chain, against what server/ does (../design-code.mjs)
  // with the game's own modules server/ imports from outside it
  const design = spec ? designCode(spec, { read: [...read, ...imported], ledger }) : null;
  if (design) findings.push(...design.findings);

  const routeList = [...routes].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, from]) => ({ path: p, from }));
  // what stops with the server when its plan caps it (the routes the server itself answers)
  const work = serverWork(read, {
    sites,
    routes: routeList.filter(x => x.from.some(f => f.startsWith('server/'))).map(x => x.path),
  });
  return { facts, ledger, custody, findings, routes: routeList, work, design, unread };
}
