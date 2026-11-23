// Design against code: each declaration against the code that appears to do it, and each conversion or bound in code
// against the spec, as findings design-unbuilt, code-undeclared and bound-undeclared, with drafted declarations.
import { wordsOfName } from '../review/code.mjs';
import { designOf, labelOf, OFFCHAIN, quote, SERVER_LIMIT } from './design.mjs';
import { NOUNS, ownFiles, spaced } from './reading.mjs';
import { conversionsIn } from './conversions.mjs';
import { boundsIn } from './bounds.mjs';

/**
 * The code right around a conversion, five lines each side: a declaration's name there is this rule's; elsewhere in
 * the function or the file (a hinted answer that earns nothing, beside a streak's bonus) it is another rule's.
 */
const codeAround = c =>
  c.file
    ? c.file.code
        .split('\n')
        .slice(Math.max(0, c.line - 6), c.line + 5)
        .join('\n')
    : '';

/** Does a declaration name what a conversion does? By its key or name in the code, or by what it takes and gives. */
function declares(d, c, design, codeText) {
  const words = [d.key, d.name].filter(Boolean).map(n => spaced(n).trim());
  if (words.some(w => w && spaced(codeText).includes(` ${w} `))) return true;
  const farmGives = d.gives?.startsWith('farm:') ? design.farms.find(f => `farm:${f.key}` === d.gives)?.rewards : null;
  // a rule on what is on no chain, written in plain words and giving more of a grant:
  // { takes: 'a code', gives: 'grant:pops', rate: 2 } is this one when its words name what the code reads and its
  // grant is one this code feeds (or the code's grant can't be read)
  if (
    !c.takes &&
    typeof d.takes === 'string' &&
    !design.assets.some(a => a.asset === d.takes) &&
    !/^item:/.test(d.takes)
  ) {
    const words = wordsOfName(d.takes);
    const kinds = new Set(c.reads.map(r => r.kind));
    const says =
      (kinds.has('code') && words.some(w => /^(?:code|codes|coupon|promo|voucher)$/.test(w))) ||
      (STREAK.test(`${c.by} ${c.code}`) && words.some(w => /^(?:streak|streaks|row|combo|consecutive)$/.test(w))) ||
      ((kinds.has('balance') || kinds.has('save')) &&
        words.some(w => /^(?:count|counts|score|scores|balance|level|rank|place)$/.test(w)));
    const grant = /^grant:(.+)$/.exec(String(d.gives ?? ''))?.[1];
    if (says && (!grant || !c.grants.length || c.grants.includes(grant))) return true;
  }
  const t = c.takes ? d.takes === c.takes : null;
  const g = c.gives ? d.gives === c.gives || farmGives === c.gives : null;
  // what it gives alone is no match: a hint that costs QUIZ is not a streak that pays more QUIZ. Without what the code
  // takes, only the declaration's own key or name in that code says it is this one (above).
  if (t === null) return false;
  // the same token in and out (QUIZ for QUIZ) fits every such rule alike, a hint's price as well as a streak's bonus
  if (c.takes === c.gives || d.takes === d.gives) return false;
  return t !== false && g !== false;
}

const keyOf = (s, taken) => {
  const base =
    wordsOfName(s)
      .join('-')
      .replace(/^[^a-z]+/, '')
      .slice(0, 28)
      .replace(/-+$/, '') || 'server';
  let k = base,
    n = 2;
  while (taken.has(k)) k = `${base}-${n++}`;
  taken.add(k);
  return k;
};

/** A conversion in words: what it reads, what it changes. */
/** A multiplier named for what the player did in a row (a streak, a combo): that, not a holding, is what it reads. */
const STREAK = /streak|combo|in_?a_?row|consecutive/i;
const readWords = (c, design) =>
  STREAK.test(`${c.by} ${c.code}`) && !c.takes?.startsWith('item:')
    ? 'a streak (what the player did in a row)'
    : c.takes
      ? `${c.takes.startsWith('item:') ? 'a ' : ''}${labelOf(design, c.takes)}`
      : (NOUNS[c.reads[0]?.kind] ?? 'what a player holds');
const changeWords = (c, design) =>
  c.changes === 'entry'
    ? `an entry${c.gives ? ` to ${labelOf(design, c.gives)}` : ''}`
    : `${c.effect === 'bonus' ? `a bonus of ${c.factor ? `${c.factor} ` : ''}` : c.factor ? `×${c.factor} ` : 'more '}${c.gives ? labelOf(design, c.gives) : c.changes === 'score' ? 'score' : c.effect === 'bonus' ? 'on what it pays' : 'of what it pays'}`;

/**
 * The pass: the design and the code side by side, the findings, the drafts, and the lines for the person. `spec`: the
 * economy; `read`: serverReview's [{f, code (comments out), text}]; `ledger`: the payout ledger (what each grant's
 * check reads). → {design, conversions, bounds, unbuilt, findings, drafts, ask, tell}
 */
export function designCode(spec, { read = [], ledger = [] } = {}) {
  const design = designOf(spec);
  const files = ownFiles(read);
  const conversions = conversionsIn(files, design);
  const bounds = boundsIn(files, design);
  const findings = [];
  const ask = [];
  const tell = [];
  const add = (id, severity, route, message, fix, extra = {}) =>
    findings.push({ source: 'design', id, severity, ...(route ? { route } : {}), message, fix, ...extra });

  // design-unbuilt: a declaration no code appears to do
  const unbuilt = [];
  for (const d of design.offchain) {
    const built = conversions.some(c => declares(d, c, design, codeAround(c)));
    // (a rule this reader can't see as a multiplier, a hint paid for: built when the server's code names it)
    // any distinctive word of its key or name (`weekly` of "Weekly top 20", `golden` of golden-harvest)
    const words = [...new Set([d.key, d.name].filter(Boolean).flatMap(n => wordsOfName(n)))].filter(
      w =>
        w.length >= 4 &&
        !/^(?:into|from|with|each|that|this|your|their|more|than|gives|takes|server|player|players|reward|rewards|prize|bonus)$/.test(
          w,
        ),
    );
    const named = files.some(f => words.some(w => spaced(f.code).includes(` ${w} `)));
    if (built || named) continue;
    unbuilt.push({ kind: OFFCHAIN, key: d.key });
    add(
      'design-unbuilt',
      'medium',
      `offchain:${d.key}`,
      `The spec declares ${quote(d.name ?? d.key)} (offchain: ${d.takes} into ${d.gives}${d.rate !== undefined ? ` at ${d.rate}` : ''}), but no code in server/ appears to do it: no multiplier, bonus or entry there reads ${labelOf(design, d.takes)}. If the page does it, it is a suggestion to a script (BEFORE-YOU-BUILD.md, lens 5); if nothing does, the economy check counts a route that isn't there.`,
      `Build it in the server (where a payout is decided), or take it out of "offchain"; if it lives in a backend this review can't see, say so to the person.`,
    );
  }
  for (const g of design.grants.filter(x => x.serverLimit)) {
    if (bounds.some(b => b.grant === g.key)) continue;
    unbuilt.push({ kind: SERVER_LIMIT.field, key: g.key });
    add(
      'design-unbuilt',
      'medium',
      `grant:${g.key}`,
      `${quote(g.name)} declares ${SERVER_LIMIT.field} ${JSON.stringify(g.serverLimit)}, but no check in server/ that pays it appears to hold a cap a window (PAY.check, what it calls, voucherFor or a report): the chain allows its own limits, and the economy check reasons from a bound that isn't kept.`,
      `Hold the bound where the grant is paid (PAY.check or PAY.paid, counting what each ${g.serverLimit.per ?? 'person'} took in the window), or take ${SERVER_LIMIT.field} out of the grant.`,
    );
  }

  // code-undeclared: a conversion the spec doesn't declare, with its draft
  const taken = new Set(design.offchain.map(d => d.key));
  const offchain = [];
  for (const c of conversions) {
    const codeText = codeAround(c);
    if (design.offchain.some(d => declares(d, c, design, codeText))) continue;
    const at = `${c.where}:${c.line}`;
    // what is on no chain (a code typed in, a streak, a count the server keeps) is said in plain words, and a rule
    // that pays more of a grant names the grant, its rate the number of times: { takes: 'a code', gives:
    // 'grant:pops', rate: 2 }
    const plain = c.takes
      ? null
      : STREAK.test(`${c.by} ${c.code}`)
        ? 'a streak (answers or plays in a row)'
        : ({ code: 'a code', save: "what the player's save or score holds", balance: 'a count the server keeps' }[
            c.reads[0]?.kind
          ] ?? null);
    // (a code or a streak multiplying one grant's pay is that grant at a rate, even when its token can be named)
    const grantGives =
      (!c.gives || (plain && c.factor && c.effect !== 'bonus')) && c.changes !== 'entry' && c.grants.length === 1
        ? `grant:${c.grants[0]}`
        : null;
    const draft = {
      key: keyOf(
        `${c.takes?.replace(/^item:/, '') ?? (plain ? wordsOfName(plain).slice(0, 2).join(' ') : '')} ${c.by.split('.').pop()}`,
        taken,
      ),
      name: `${readWords(c, design)[0].toUpperCase()}${readWords(c, design).slice(1)} into ${changeWords(c, design)}`,
      takes:
        c.takes ??
        plain ??
        '<what the player holds, spends or does: a token key, item:<key>, or plain words such as "a code">',
      gives:
        grantGives ??
        c.gives ??
        `<what it gives: a token key, item:<key>, farm:<key>, or grant:<key> (${design.grants.map(g => `grant:${g.key}`).join(', ') || 'a grant of the spec'}) with "rate" the number of times>`,
      // ×N of a grant is that grant at rate N; a bonus of N tokens is N of that token for each one taken
      ...((grantGives && c.factor && c.effect !== 'bonus') ||
      (!grantGives && c.gives && c.factor && c.effect === 'bonus')
        ? { rate: c.factor }
        : {}),
      says: `The server ${c.changes === 'entry' ? 'counts' : c.effect === 'bonus' ? 'adds a bonus from' : 'multiplies what it pays by'} ${c.by} (${at}), from ${c.reads.map(r => `${r.what} (${r.where}:${r.line})`).join(', ')}.`,
    };
    const ready = Boolean((c.takes || plain) && (c.gives || grantGives));
    offchain.push({ from: at, ready, rate: draft.rate ?? null, declaration: draft });
    const via = c.reads.map(r => `${r.what} at ${r.where}:${r.line}`).join(', ');
    add(
      'code-undeclared',
      'medium',
      c.route ?? c.where,
      `${at} appears to turn ${readWords(c, design)} into ${changeWords(c, design)} (\`${c.code}\`; it reads ${via}${c.grants.length ? `; it feeds ${c.grants.map(k => `grant:${k}`).join(', ')}` : ''}), and the spec declares nothing of it in "offchain": the economy model can't see it, so any loop through it is invisible to the check. ("offchain" is for every rule the server applies to what a player is paid, a code, a streak or a count as much as a token held on chain: \`{ "takes": "a code", "gives": "grant:<key>", "rate": <times> }\`.)`,
      `Confirm with the person what it does, then add it to "offchain" (its draft is in review.md, "Design and code") and run the economy check again${ready ? '' : `; the draft leaves ${['takes', 'gives'].filter(k => String(draft[k]).startsWith('<')).join(' and ')} for you to fill`}.`,
      { where: at, draft },
    );
    tell.push(
      `${at} ${ready ? 'turns' : 'appears to turn'} ${readWords(c, design)} into ${changeWords(c, design)}; the economy model doesn't see it until it's declared.`,
    );
    if (!ready)
      ask.push(
        `What does ${c.where} take for ${c.by} (it appears to read ${c.reads[0].what} at ${c.reads[0].where}:${c.reads[0].line}), and what does it give more of?`,
      );
    // a player paid more for something: the person decides it, and players are told where they earn
    else
      ask.push(
        `${at} pays a player ${!c.factor ? 'more' : c.effect === 'bonus' ? `a bonus of ${c.factor}` : `${c.factor} times`} for ${readWords(c, design)}: is that a rule you want, and how are players told where they earn?`,
      );
  }

  // bound-undeclared: a grant whose bound lives on its server, with no serverLimit
  const serverLimit = [];
  for (const g of design.grants) {
    if (g.serverLimit) continue;
    const rec = ledger.find(r => r.grant === g.key);
    // as the economy kit asks it: a result the server only bounds or replays, or one whose trust is unsaid but whose
    // check reads state the server keeps; a result the server decides is its own bound
    if (g.trust === 'decides') continue;
    if (!['bounds', 'replays'].includes(g.trust) && !(g.trust == null && rec?.source === 'env')) continue;
    const found = bounds.filter(b => b.grant === g.key);
    const best = found.find(b => b.value !== null && b.every) ?? found[0] ?? null;
    const identity = best?.per ?? (rec?.identity === 'wallet' ? 'wallet' : 'person');
    const per = best?.per === 'all' ? 'all players together' : `one ${identity === 'wallet' ? 'wallet' : 'person'}`;
    const window =
      { '1m': 'minute', '1h': 'hour', '1d': 'day', '7d': 'week', '30d': 'month' }[best?.every] ?? 'hour or day';
    const aWindow = `${best?.every === '1h' ? 'an' : 'a'} ${window}`;
    const seen = best
      ? `it appears to be ${best.value ?? best.name}${best.value !== null && !/^\d/.test(best.name) ? ` (${best.name})` : ''}${best.unit === 'claims' ? ' claims' : ''} in ${best.where}:${best.line}`
      : 'this review found no such cap where it is paid';
    ask.push(`How much does your server let ${per} take from ${quote(g.name)} per ${window}? (${seen})`);
    if (best?.amount !== null && best?.amount !== undefined && best.every)
      serverLimit.push({
        grant: g.key,
        from: `${best.where}:${best.line}`,
        [SERVER_LIMIT.field]: SERVER_LIMIT.make({
          per: best.per,
          amount: best.amount,
          every: best.every === SERVER_LIMIT.every ? null : best.every,
        }),
      });
    add(
      'bound-undeclared',
      'low',
      `grant:${g.key}`,
      `${quote(g.name)} is paid on a check that ${{ bounds: 'bounds the result (trust "bounds")', replays: 'replays the result (trust "replays")' }[g.trust] ?? 'reads state the server keeps'}, so its real limit lives on the server, and the grant declares none (${SERVER_LIMIT.field}): the economy check computes with the chain's caps (${
        Object.entries(g.limits)
          .filter(([, v]) => typeof v === 'number' && v > 0)
          .map(([k, v]) => `${k} ${v}`)
          .join(', ') || 'none'
      }), which only bound a leaked voucher key. ${best ? `The server appears to cap it at ${best.value ?? best.name}${best.unit === 'claims' ? ' claims' : ''}${best.every ? ` ${aWindow}` : ''} (\`${best.code}\`, ${best.where}:${best.line}).` : 'This review found no cap a window where it is paid.'}`,
      `Ask the person what the server lets one identity take a window, then declare it on the grant: "${SERVER_LIMIT.field}": ${JSON.stringify(SERVER_LIMIT.make({ per: 'person', amount: 0, every: '1h' })).replace('0', '<n>')}.`,
    );
  }

  return {
    design: {
      offchain: design.offchain.map(d => d.key),
      grants: design.grants.map(g => ({ key: g.key, trust: g.trust, [SERVER_LIMIT.field]: g.serverLimit })),
    },
    conversions,
    bounds,
    unbuilt,
    findings,
    drafts: { offchain, serverLimit },
    ask,
    tell,
  };
}
