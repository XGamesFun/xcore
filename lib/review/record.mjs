// The record: the whole review of a game (reviewGame), written to evidence/review-N/ as review.md and review.json.
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CMD } from '../command.mjs';
import { designCodeMarkdown, draftsChecked } from '../design-code.mjs';
import { economyFile } from '../economy.mjs';
import { economyCluster } from '../solana-rpc.mjs';
import { plural } from '../util.mjs';
import { seedAddress } from '../voucher-seed.mjs';
import { economyHome, GUIDE, jsonFile, METHOD, PACKAGE, posix, SEVERITIES, voucherGrants } from './where.mjs';
import { economyReview, reviewEnv, solanaPackage } from './economy.mjs';
import { finding, serverReview } from './server.mjs';
import { AMOUNTS, decidedWords, IDENTITY_WORDS, limitWords, RECIPIENTS, SIGNERS } from './ledger.mjs';
import { custodyFindings, signsWords } from './custody.mjs';
import { liveReview } from './live.mjs';
import { tradeoffs } from './tradeoffs.mjs';
import { economyTold, folderPlan, toldLines } from './told.mjs';

async function nextOut(dir) {
  const root = path.join(dir, 'evidence');
  let n = 0;
  try {
    for (const e of await readdir(root)) {
      const m = /^review-(\d+)$/.exec(e);
      if (m) n = Math.max(n, Number(m[1]));
    }
  } catch {}
  return path.join(root, `review-${n + 1}`);
}

export const counts = findings =>
  Object.fromEntries(SEVERITIES.map(s => [s, findings.filter(f => f.severity === s).length]));
const cell = v =>
  String(v ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');

const DECIDED_CELL = r =>
  r.source === 'request'
    ? `the request (${r.decides === 'body' ? 'its body' : 'the sign-in alone'})`
    : r.source === 'env'
      ? `state the server keeps${r.assumed ? ' (taken so: env goes to code not read)' : ''}`
      : ({ template: 'no check yet (template)', nothing: 'no grant answered', unreadable: 'code not read' }[r.source] ??
        'nothing');

/** The payout ledger as a table: one row a paid route. */
export function ledgerTable(ledger) {
  const lines = [
    '| Route | Signer | Decided by | Amount | Paid to | Identity | Limits | Trust (declared / observed) | Ceiling |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of ledger)
    lines.push(
      `| \`${r.route}\` | ${r.signer}${r.where ? ` (${r.where})` : ''} | ${DECIDED_CELL(r)} | ${AMOUNTS[r.amount] ?? ''} | ${{ proven: 'a proven wallet', check: 'a wallet the code names', request: 'a wallet the request names' }[r.recipient] ?? ''} | ${{ wallet: 'wallet (free)', account: 'account (X or Google)', x: 'X account' }[r.identity]}${r.payOnly ? ` (payOnly '${r.payOnly}')` : ''} | ${cell(limitWords(r.limits))} | ${r.trust ? `${r.trust.declared ?? 'none'} / ${r.trust.observed === 'state' ? 'reads state' : r.trust.observed}${r.trust.matches ? '' : ' (mismatch)'}` : 'no grant'} | ${r.ceiling ? cell(r.ceiling.words) : 'nothing claimable'} |`,
    );
  return lines;
}

/** The key custody list as a table: one row a place a key's bytes are. */
export function custodyTable(custody) {
  const lines = ['| Key | Signs | Place | Who can read it | Finding |', '| --- | --- | --- | --- | --- |'];
  for (const k of custody)
    for (const p of k.places) {
      const sev = custodyFindings([{ ...k, places: [p] }])[0]?.severity;
      lines.push(
        `| ${k.what}${k.address ? ` (\`${k.address}\`)` : ''} | ${signsWords(k)} | ${cell(p.where)} | ${cell(p.intended ? `its holder: ${k.holder}` : p.reach)} | ${sev ?? 'none'} |`,
      );
    }
  return lines;
}

/** review.md's headings for the two lists (review.json has them as ask and tell). */
export const ASK_HEADING = 'Questions to decide';
export const TELL_HEADING = 'What this build allows';

const FROM = {
  economy: (r, n) =>
    `From the economy (@xgamesfun/solana${r.economy.version ? ` ${r.economy.version}` : ''}'s check, in its words), ${n}:`,
  server: (r, n) => `From the server's code (its payout ledger), ${n}:`,
  design: (r, n) =>
    `From the design against the code (what the spec declares the server does, and what it does), ${n}:`,
  custody: (r, n) => `From where its keys are, ${n}:`,
  plan: (r, n) => `From its plan (a capped server is off until the month ends), ${n}:`,
};
/** review.md's two blocks for the game's owner: "Questions to decide" ("? ") and "What this build allows" ("> "), by
 *  source. */
export function toldMarkdown(r) {
  const lines = [];
  const block = (head, intro, list, mark) => {
    lines.push(`## ${head}`, '', intro, '');
    if (!list.length) lines.push('Nothing here.', '');
    for (const from of Object.keys(FROM)) {
      const of = list.filter(x => x.from === from);
      if (!of.length) continue;
      lines.push(FROM[from](r, of.length === 1 ? 'one line' : `${of.length} lines`), '');
      for (const x of of) lines.push(`${mark}${x.text}`, '');
    }
  };
  block(
    ASK_HEADING,
    'Your answers to these change the design. Decide them before you build on them.',
    r.ask ?? [],
    '? ',
  );
  block(
    TELL_HEADING,
    'Each line is a fact about the game as it is built now: what a script or a leaked key can take, and what stops when the plan caps the server.',
    r.tell ?? [],
    '> ',
  );
  return lines;
}

/** What was not read, beside the verdict: "; 2 parts not read", or nothing. */
export const unreadWords = r => (r.unread?.length ? `; ${plural(r.unread.length, 'part')} not read` : '');

/** review.md: the full record, for the game's owner (and any coding agent working for them). */
export function reviewMarkdown(r) {
  const c = r.counts;
  const unread = r.unread ?? [];
  const lines = [
    `# Payout and key review: ${r.game}`,
    '',
    `${r.at} · ${r.xcore} · ${r.economy.version ? `@xgamesfun/solana ${r.economy.version}` : 'no @xgamesfun/solana'}`,
    '',
    `**${c.high ? 'FAIL' : 'PASS'}**: ${SEVERITIES.map(s => `${c[s]} ${s}`).join(', ')}${unreadWords(r)}. ${c.high ? 'Fix every high finding before the game pays anything of value.' : 'No high finding.'}`,
    '',
    ...(r.method ?? METHOD).map(l => `- ${l}`),
    '',
    ...(unread.length
      ? [
          '## Not read',
          '',
          'The verdict does not cover these: read them yourself.',
          '',
          ...unread.map(u => `- ${u.what}: ${u.why}.`),
          '',
        ]
      : []),
    ...toldMarkdown(r),
    '## Findings',
    '',
  ];
  if (!r.findings.length) lines.push('None.', '');
  for (const s of SEVERITIES) {
    const of = r.findings.filter(f => f.severity === s);
    if (!of.length) continue;
    lines.push(`### ${s[0].toUpperCase()}${s.slice(1)}`, '');
    for (const f of of)
      lines.push(
        `- **${f.id}** (${f.source}${f.route ? `, ${f.route}` : ''}): ${f.message}`,
        ...(f.fix ? [`  Fix: ${f.fix}`] : []),
      );
    lines.push('');
  }
  lines.push('## Economy', '');
  if (!r.economy.file) lines.push('This game has no economy.', '');
  else if (!r.economy.available) lines.push(`${r.economy.file}: not reviewed: ${r.economy.why}.`, '');
  else {
    lines.push(`${r.economy.file}, reviewed by @xgamesfun/solana ${r.economy.version} (xsolana review).`, '');
    if (r.economy.routes.length) {
      lines.push(
        '| Route | Kind | Trigger | Trusts | Trust | Enforced | Ceiling |',
        '| --- | --- | --- | --- | --- | --- | --- |',
      );
      for (const x of r.economy.routes)
        lines.push(
          `| ${cell(x.name ?? x.key)} | ${cell(x.kind)} | ${cell(x.trigger)} | ${cell(Array.isArray(x.trusts) ? x.trusts.join(', ') : x.trusts)} | ${cell(x.trust)} | ${cell(Array.isArray(x.enforced) ? x.enforced.join(', ') : x.enforced)} | ${cell(x.ceiling)} |`,
        );
      lines.push('');
    }
  }
  const f = r.server.facts;
  lines.push(
    '## Server',
    '',
    `- server/: ${f.server ? 'yes' : 'none'}; server/vouchers.js: ${f.vouchers ? 'yes' : 'none'}`,
    ...(f.vouchers
      ? [
          `- PAY.check: ${{ template: 'still the template (pays nothing)', written: 'written', unreadable: 'not found in the file' }[f.pay]}`,
          `- VOUCHERS.payOnly: ${f.payOnly ? `'${f.payOnly}'` : 'not found'}`,
        ]
      : []),
    `- api/ routes the code names: ${r.server.routes.length ? r.server.routes.map(x => `\`${x.path}\``).join(', ') : 'none'}`,
    '',
    '### Payouts: the ledger',
    '',
    'Each route that pays, as a cheater reads it: who signs, what decides it, who is paid, the identity its limits count, and the ceiling (identities one person can make × the limit for each × time). The payout-* findings are read off it.',
    '',
    ...(r.ledger.length ? [...ledgerTable(r.ledger), ''] : ['No route pays through a voucher.', '']),
    '### Keys: where each one is',
    '',
    "Every place a key's bytes are, and who can read it. Each place outside its one holder is a key-custody finding.",
    '',
    ...(r.custody.length ? [...custodyTable(r.custody), ''] : ['No key here.', '']),
    ...designCodeMarkdown(r.designCode),
    '## Live',
    '',
  );
  if (!r.live) lines.push(`Not run: ${r.liveWhy ?? `${CMD} review --live`}.`, '');
  else {
    lines.push(`Asked ${r.live.base} as a stranger (no sign-in, and a forged one).`, '');
    if (r.live.probes.length) {
      lines.push('| Route | Request | Sign-in | Answer |', '| --- | --- | --- | --- |');
      for (const p of r.live.probes)
        lines.push(
          `| \`${p.route}\` | ${p.method} | ${p.auth} | ${p.status || 'none'}${p.ok === null ? '' : ` ok:${p.ok}`}${p.said ? ` ${cell(p.said)}` : ''} |`,
        );
      lines.push('');
    }
    if (r.live.key) lines.push(`- api/vouchers/key: ${r.live.key.publicKey ?? `none (${r.live.key.status})`}`);
    if (r.live.economy)
      lines.push(
        `- published ${r.live.economy.path}: ${r.live.economy.same ? 'live at the same economy as this folder' : 'not the economy this folder has live'}`,
      );
    lines.push('');
  }
  lines.push(
    '## What a cheater gets, and the trade-offs',
    '',
    'For each route that pays: how the server checks it, what a cheater gets, and what a stronger check would cost. Which trade-off to take is your decision.',
    '',
  );
  if (r.economy.tradeoffs) lines.push(r.economy.tradeoffs.trim(), '');
  if (!r.tradeoffs.length)
    lines.push('No route pays a result through a voucher: nothing here rests on what the server checks.', '');
  for (const t of r.tradeoffs) {
    const rec = r.ledger.find(x => x.route === t.route);
    lines.push(
      `### ${t.name} (\`${t.route.replace(/^grant:/, '')}\`)`,
      '',
      `- **How the server checks it**: ${t.observed === 'request' ? `declared ${t.trust ?? 'nothing'}, but observed: ` : t.trust ? `${t.trust}${t.declared ? '' : ' (from the economy review; not declared in the grant)'}: ` : ''}${t.how}.`,
      `- **What a cheater gets**: ${t.cheater}.`,
      ...(t.ceiling ? [`- **The economy review's ceiling**: ${t.ceiling.replace(/\.$/, '')}.`] : []),
      ...(rec
        ? [
            `- **Its record**: signed by ${SIGNERS[rec.signer]}${rec.where ? ` in ${rec.where}` : ''}; decided by ${decidedWords(rec)}; paid to ${RECIPIENTS[rec.recipient] ?? 'nobody'}; counted by ${IDENTITY_WORDS[rec.identity]}.`,
          ]
        : []),
      ...(t.stronger ? [`- **The stronger level**: ${t.stronger}.`] : []),
      '',
    );
  }
  lines.push(
    `The guide: ${GUIDE}, and @xgamesfun/solana's skill reference, skills/xsolana-economy/references/trust-and-cheating.md.`,
    '',
  );
  return lines.join('\n');
}

/**
 * The whole review of the game in `dir`. live: the base to ask (or null); out: where the record goes (default
 * evidence/review-N/). → the record, with outDir
 */
export async function reviewGame(
  dir,
  { live = null, liveWhy = null, out = null, env = process.env, fetchImpl = fetch, now = new Date() } = {},
) {
  // A file that is there and cannot be read is never read as absent: the game's settings say where its page and its
  // economy are, and the economy file holds every grant, so each is a high finding by its name.
  const settings = jsonFile(path.join(dir, 'gamesfun.json'));
  const home = economyHome(dir);
  const file = economyFile(home);
  const own = file ? jsonFile(file) : null;
  const spec = own?.value ?? null;
  const kit = solanaPackage(env)?.version ?? null;
  const economy = file
    ? {
        file: posix(path.relative(dir, file)),
        ...(spec ? economyReview(file, { env }) : { available: false, version: kit, why: own.error }),
      }
    : { file: null, available: false, version: kit, why: 'no economy' };
  const unreadable = [];
  if (settings.error)
    unreadable.push({
      what: 'gamesfun.json',
      why: settings.error,
      lost: 'The review went on as for a folder with no settings, so where it looked for the page, the economy and the server may be wrong',
    });
  if (file && !spec)
    unreadable.push({
      what: economy.file,
      why: own.error,
      lost: 'Nothing in it was reviewed: no grant, no limit, no key, and no payout that rests on them',
    });
  // the economy's own sentences for the person: its check's (its review carries none)
  const told = file && spec ? economyTold(file, { env }) : { ask: [], tell: [], why: file ? own.error : null };
  const addressOf = async seed => seedAddress(seed);
  const server = await serverReview(dir, {
    spec,
    economy: file,
    available: economy.available,
    economyRoutes: economy.available ? economy.routes : [],
    addressOf,
  });
  // the drafted declarations, checked by the economy kit on a temporary copy of the spec (never the spec itself)
  const designed = server.design
    ? {
        ...server.design,
        withDrafts: await draftsChecked(file, spec, server.design.drafts, {
          env: reviewEnv(env, economyCluster(path.dirname(file))),
        }),
      }
    : null;
  // the economy review says what it says about trust; this package's own line on it only when it says nothing
  const theirs = economy.available ? economy.findings : [];
  const mine = server.findings.filter(
    f =>
      !(f.id === 'payout-trust' && f.cases.join() === 'undeclared') ||
      !theirs.some(t => /trust/i.test(t.id ?? '') && (!t.route || t.route === f.route)),
  );
  let liveReport = null;
  if (live)
    liveReport = await liveReview(live, {
      routes: server.routes,
      keys: [...new Set(voucherGrants(spec).flatMap(g => g.vouchers))],
      testKey: server.facts.testKey ?? null,
      economyPath: file ? posix(path.relative(home, file)) : null,
      localLive: spec?.live ?? null,
      vouchers: server.facts.vouchers,
      fetchImpl,
    });
  // the live key, once the live server has said it: its address and the grants that name it
  const liveKey = liveReport?.key?.publicKey ?? null;
  const custody = server.custody.map(k =>
    k.key === 'live' && liveKey
      ? {
          ...k,
          address: liveKey,
          signs: voucherGrants(spec)
            .filter(g => g.vouchers.includes(liveKey))
            .map(g => g.key),
          signsKnown: true,
        }
      : k,
  );
  const findings = [
    ...unreadable.map(u =>
      finding(
        'review',
        'file-unreadable',
        'high',
        `${u.what} is there and cannot be read: ${u.why}. ${u.lost}.`,
        `Mend ${u.what} so that it is a JSON object, then run ${CMD} review again.`,
        u.what,
      ),
    ),
    ...theirs.map(f => ({ source: 'economy', ...f })),
    ...mine,
    ...(liveReport?.findings ?? []),
  ].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  // what the verdict does not cover: a file that could not be read, an economy its own tools did not review, and what
  // the reading of the server could not follow
  const unread = [
    ...unreadable.map(u => ({ what: u.what, why: u.why })),
    ...(spec && !economy.available ? [{ what: economy.file, why: `its own review did not run: ${economy.why}` }] : []),
    ...server.unread,
  ];
  const r = {
    ok: !findings.some(f => f.severity === 'high'),
    game: path.basename(path.resolve(dir)),
    at: now.toISOString(),
    xcore: `${PACKAGE.name} ${PACKAGE.version}`,
    method: METHOD,
    counts: counts(findings),
    unread,
    findings,
    economy,
    server: { facts: server.facts, routes: server.routes, work: server.work },
    ledger: server.ledger,
    custody,
    designCode: designed,
    live: liveReport,
    ...(liveReport ? {} : { liveWhy }),
    tradeoffs: tradeoffs(spec, { economy, facts: server.facts, ledger: server.ledger }),
    ...toldLines({
      economy: told,
      ledger: server.ledger,
      custody,
      work: server.work,
      plan: folderPlan(dir),
      design: designed,
    }),
    told: {
      economy: file && spec ? (told.why ? null : 'xsolana check') : null,
      ...(told.why ? { why: told.why } : {}),
    },
  };
  const outDir = out ? path.resolve(out) : await nextOut(dir);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'review.json'), JSON.stringify(r, null, 2) + '\n');
  await writeFile(path.join(outDir, 'review.md'), reviewMarkdown(r));
  return { ...r, outDir };
}
