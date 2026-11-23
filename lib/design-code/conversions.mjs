// The conversions in server code: where the server turns what a player holds or did into more of what it pays (a code
// that multiplies earnings, a stake that counts as an entry, a prize bought with yield).
import { apiRoutes, withoutStrings, wordsOfName } from '../review/code.mjs';
import { lineAt, lineText, num, serverPath } from './design.mjs';
import {
  applied,
  around,
  assetsNamed,
  assigned,
  BOUND,
  byKind,
  calledFrom,
  CHAIN,
  dedupe,
  EARNED,
  EFFECT,
  ENTRY,
  factorIn,
  hasWord,
  inCondition,
  levelsBeneath,
  localApplied,
  makes,
  payingBodies,
  PAYOUT,
  readsIn,
  scopesOf,
  valueOf,
} from './reading.mjs';

/**
 * The conversions in the game's own server code: a multiplier or bonus applied to what is earned (or something counted
 * as an entry) in a function that reads what a player holds or did, there or in a function of its own it calls.
 * → [{where, line, code, effect, by, factor, reads, takes, gives, changes, grants, route, function}]
 */
export function conversionsIn(files, design) {
  const paying = payingBodies(files, design);
  const out = [];
  for (const file of files) {
    for (const m of file.bare.matchAll(CHAIN)) {
      const chain = m[0];
      const end = m.index + chain.length;
      const entry = hasWord(ENTRY, chain) && assigned(file.bare, end);
      // applied in place (`n * BOOST`), or through a local applied later in its function
      // (`const got = farm.multiplier ?? 1; … + got`)
      // (a local whose own name says it, `const factor = …`, is found where it is applied: not here too)
      // (and only when it is the value itself, `farm.multiplier ?? 1`, not a ternary's condition)
      const viaLocal =
        hasWord(EFFECT, chain) && /^\s*(?:\?\?|\|\||;|,|\)|:|$)/m.test(file.bare.slice(end, end + 6))
          ? localApplied(file, m.index)
          : null;
      if (viaLocal && hasWord(EFFECT, viaLocal) && !applied(file.bare, m.index, end)) continue;
      const effect = hasWord(EFFECT, chain) && (applied(file.bare, m.index, end) || Boolean(viaLocal));
      if (!entry && !effect) continue;
      // a value computed into a cap (`const dayCap = Math.min(room, earnCap + codeBonus)`) bounds a payout, it pays none
      const into = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(
        lineText(file.bare, lineAt(file.bare, m.index)),
      )?.[1];
      if (into && hasWord(BOUND, into)) continue;
      if (!makes(lineText(file.bare, lineAt(file.bare, m.index))) || inCondition(file.bare, m.index)) continue;
      const fn = around(file, m.index);
      if (effect && !hasWord(EARNED, fn.body.replace(/[^\w$]+/g, ' '))) continue;
      const by = chain.replace(/\s+/g, '');
      if (out.some(c => c.file === file && c.fnStart === fn.start && c.by === by)) continue;
      // what it reads: in the function, and in the functions of the game's own beneath it (a read wrapped in helpers)
      // and where its value is set from what a player did: `s.boost = {code: hash}` in another function of the file
      // (a level further down only while none above it reads: the helper that reads is the one named, not what it calls)
      const levels = levelsBeneath(fn.body, files).map(l => l.filter(x => x.def !== fn));
      const calls = levels[0] ?? [];
      const setters = settersOf(file, by.split('.').pop()).filter(d => d !== fn);
      const callers = setters.flatMap(d => callersOf(file, d)).filter(d => d !== fn && !setters.includes(d));
      const readsOf = list => list.flatMap(x => readsIn(x.file, x.def.start, x.def.start + x.def.body.length, design));
      let own = dedupe([
        ...readsIn(file, fn.start, fn.start + fn.body.length, design),
        ...readsOf([...calls, ...[...setters, ...callers].map(def => ({ file, def }))]),
      ]);
      for (const level of levels.slice(1)) {
        if (own.length) break;
        own = dedupe(readsOf(level));
      }
      own.sort(byKind);
      // and what turns the condition it is applied under on (`r.boosted ? n * BOOST : n`), followed through the
      // fields that hold it, in any file: a code redeemed → a flag stored → a round started → ×2
      const traced = effect
        ? guardReads(
            file,
            m.index,
            by,
            files,
            design,
            fn,
            viaLocal && by.includes('.') ? by.split('.').pop() : null,
          ).sort(byKind)
        : [];
      // what a player did or holds leads (a code, a holding, a stake), wherever it was read
      const STRONG = new Set(['code', 'holds', 'stake']);
      // (what the trace finds adds to its own reads only when it is what a player did or holds, or there are none)
      const tracedStrong = traced.filter(r => STRONG.has(r.kind));
      const all = tracedStrong.length ? [...own, ...tracedStrong] : own.length ? own : traced;
      const reads = dedupe([
        ...all.filter(r => STRONG.has(r.kind)).sort(byKind),
        ...all.filter(r => !STRONG.has(r.kind)),
      ]);
      if (!reads.length) continue;
      // what it changes, and the grants it feeds: PAY's own, a body that pays, or one that calls this function
      const name = fn.name;
      const feeds = paying.filter(
        p =>
          (p.file === file && p.start <= m.index && m.index < p.start + p.body.length) ||
          (name && calledFrom(p.body, [file]).some(x => x.def.name === name)),
      );
      const grants = [...new Set(feeds.flatMap(p => p.grants))];
      // a function that banks what a later claim pays (`p.banked += credited`): the grants of the paying code that
      // reads that field (`amount: Math.min(p.banked, 1000)`, in what PAY.check calls)
      if (!grants.length) {
        const fields = [
          ...new Set([...withoutStrings(fn.body).matchAll(/\.\s*([A-Za-z_$][\w$]*)\s*\+=/g)].map(x => x[1])),
        ];
        // (where a claim takes from it, `p.banked -= amount`, when any does: not a branch that only shows the bank)
        const reading = [];
        for (const p of fields.length ? paying : [])
          for (const s of scopesOf(p, files, design)) {
            const sb = withoutStrings(s.body);
            const f = fields.map(x => x.replace(/\$/g, '\\$')).join('|');
            if (!new RegExp(`\\.\\s*(?:${f})\\b(?!\\s*[-+]?=(?!=))`).test(sb)) continue;
            const takes = new RegExp(`\\.\\s*(?:${f})\\s*(?:-=|=(?!=)[^;\\n]*\\.\\s*(?:${f})\\s*-)`).test(sb);
            reading.push({ grants: s.grants?.length ? s.grants : p.grants, takes });
          }
        for (const r of reading.some(x => x.takes) ? reading.filter(x => x.takes) : reading)
          for (const g of r.grants) if (!grants.includes(g)) grants.push(g);
      }
      const line = lineAt(file.code, m.index);
      const gives =
        [...new Set(grants.map(g => g.prize?.asset).filter(Boolean))].length === 1
          ? grants.find(g => g.prize?.asset).prize.asset
          : (assetsNamed(lineText(file.code, line), design)[0] ?? null);
      // what it takes, from its own reads (and a holding traced to it): a traced line's other names are not it
      const takesFrom = [...own, ...traced.filter(r => r.kind === 'holds')];
      const named = [...takesFrom.map(r => r.asset), ...takesFrom.flatMap(r => r.named)].filter(a => a && a !== gives);
      const routes = feeds.some(p => p.pay) ? ['api/vouchers/pay'] : apiRoutes(file.text);
      const words = wordsOfName(fn.body.replace(/[^\w$]+/g, ' '));
      out.push({
        file,
        fnStart: fn.start,
        where: serverPath(file.f),
        line,
        code: lineText(file.text, line),
        effect: entry ? 'entry' : hasWord(new Set(['bonus', 'bonuses']), chain) ? 'bonus' : 'multiplier',
        by,
        // (a stored multiplier's starting value, `multiplier: 1`, is no factor)
        factor: effect
          ? ((v => (v > 1 ? v : null))(valueOf(files, by)) ?? factorIn(calls.filter(x => hasWord(EFFECT, x.def.name))))
          : null,
        reads: reads.map(({ kind, what, where, line: l }) => ({ kind, what, where, line: l })),
        takes: named[0] ?? null,
        gives,
        changes: entry ? 'entry' : words.some(w => PAYOUT.has(w)) ? 'payout' : 'score',
        word: wordsOfName(by)
          .find(w => EFFECT.has(w) || ENTRY.has(w))
          ?.replace(/(?:ed|es|s)$/, ''),
        paysHere: wordsOfName(lineText(file.bare, line)).some(w => EARNED.has(w) || w === 'value'),
        grants: grants.map(g => g.key),
        route: routes[0] ?? null,
        function: name,
      });
    }
  }
  // a factor chosen by a condition (`const count = golden ? 2 : 1`) whose condition reads what a wallet holds, a code
  // or a stake: a boost by any name, however its value is then written
  for (const file of files) {
    for (const m of file.bare.matchAll(
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;?\n=]+\?\s*(\d+(?:\.\d+)?)\s*:\s*1\b/g,
    )) {
      const factor = num(m[2]);
      if (!(factor > 1 && factor <= 1000)) continue;
      const fn = around(file, m.index);
      if (
        !hasWord(EARNED, fn.body.replace(/[^\w$]+/g, ' ')) &&
        !/\b(?:harvest|count|crops?|basket|balance)\b/.test(fn.body)
      )
        continue;
      if (out.some(c => c.file === file && c.fnStart === fn.start)) continue;
      const reads = dedupe(guardReads(file, m.index, m[1], files, design, fn))
        .filter(r => ['holds', 'code', 'stake'].includes(r.kind))
        .sort(byKind);
      if (!reads.length) continue;
      const line = lineAt(file.code, m.index);
      const feeds = payingBodies(files, design).filter(
        p => fn.name && calledFrom(p.body, [file]).some(x => x.def.name === fn.name),
      );
      const grants = [...new Set(feeds.flatMap(p => p.grants))];
      const holdsAsset = reads.find(r => r.asset)?.asset ?? null;
      out.push({
        file,
        fnStart: fn.start,
        where: serverPath(file.f),
        line,
        code: lineText(file.text, line),
        effect: 'multiplier',
        by: m[1],
        factor,
        reads: reads.map(({ kind, what, where, line: l }) => ({ kind, what, where, line: l })),
        takes: holdsAsset,
        gives: null,
        changes: 'payout',
        word: 'multiplier',
        paysHere: false,
        grants: grants.map(g => g.key),
        route: apiRoutes(file.text)[0] ?? null,
        function: fn.name,
      });
    }
  }

  // one conversion a name a file: where it is applied to what is earned, if anywhere, else its first use
  const kept = out.filter(
    c =>
      !out.some(
        o =>
          o !== c &&
          o.file === c.file &&
          o.word === c.word &&
          (o.paysHere
            ? !c.paysHere || out.indexOf(o) < out.indexOf(c)
            : !c.paysHere && out.indexOf(o) < out.indexOf(c)),
      ),
  );
  // and one a line: `n * (bonus ? STREAK_MULTIPLIER : 1)` is one rule, read by its factor rather than by its flag
  const once = kept.filter(
    c =>
      !kept.some(
        o =>
          o !== c &&
          o.where === c.where &&
          o.line === c.line &&
          (Boolean(o.factor) > Boolean(c.factor) ||
            (Boolean(o.factor) === Boolean(c.factor) && kept.indexOf(o) < kept.indexOf(c))),
      ),
  );
  return once.map(({ file: _f, fnStart: _s, paysHere: _p, word: _w, ...c }) => c);
}

/** The functions of a file that call `def` (the route that hands a setter what the player sent). */
const callersOf = (file, def) =>
  file.defs.filter(
    d =>
      d !== def &&
      d.name &&
      !(d.start <= def.start && def.start < d.start + d.body.length) &&
      new RegExp(`(?<![\\w$])${def.name.replace(/\$/g, '\\$')}\\s*(?:\\?\\.\\s*)?\\(`).test(withoutStrings(d.body)),
  );

/**
 * What a player did or holds behind the condition an effect is applied under: the fields its condition reads
 * (`r.boosted ? n * BOOST : n`, `if (s.golden) got *= 2`), where any file sets them, the fields those settings read in
 * turn, and the functions that call the setters, a few steps deep. → reads, as readsIn
 */
function guardReads(file, at, by, files, design, fn, field = null) {
  // a local of the effect's own function: `const factor = boosted ? BOOST : 1`, `const boosted = rounds > 0`
  const local = name => {
    const d = new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\s*=\\s*([^;\\n]+)`).exec(fn.body);
    return d ? d[1] : null;
  };
  // what an expression reads: its locals, its fields (`r.boosted`), its stored keys (`storage.get('rounds')`)
  const named = text => {
    const bare = withoutStrings(text);
    return [
      // (a local used as an object, `r` in `r.boosted`, is not followed: its field is)
      ...[...bare.matchAll(/(?<![\w$.])([a-z_$][\w$]*)(?!\s*\(|\s*\??\.|[\w$])/g)]
        .map(x => x[1])
        .filter(n => local(n) !== null)
        .map(n => ['local', n]),
      ...[...bare.matchAll(/\.\s*([A-Za-z_$][\w$]*)\b(?!\s*\()/g)].map(x => ['field', x[1]]),
      ...[...text.matchAll(/\.\s*get\s*\(\s*['"]([\w$]+)['"]/g)].map(x => ['field', x[1]]),
      // a function of the game's own it calls (`(await goldenOf(env, player)).items.length ? 2 : 1`)
      ...[...bare.matchAll(/(?<![\w$])([A-Za-z_$][\w$]*)\s*\(/g)]
        .map(x => x[1])
        .filter(
          n =>
            !/^(?:if|for|while|switch|return|await|get|put|run|first|all|prepare|bind|json|fetch|Number|String|Boolean|Math|Date|Object|Array|JSON)$/.test(
              n,
            ),
        )
        .map(n => ['call', n]),
    ];
  };
  const condOf = text => {
    const q = /^([^?]*?)\?(?![?.])/.exec(withoutStrings(text));
    return q ? text.slice(0, q[1].length) : text;
  };
  const line = lineText(file.code, lineAt(file.code, at));
  const iff = /\bif\s*\(([^)]*)\)/.exec(line)?.[1] ?? '';
  const tern = /(?:=|\breturn\b|\()\s*([^?=;]+?)\s*\?(?![?.])/.exec(withoutStrings(line));
  const start = [iff, tern ? line.slice(tern.index, tern.index + tern[0].length) : ''];
  if (/^[A-Za-z_$][\w$]*$/.test(by) && local(by) !== null) start.push(condOf(local(by)));
  const last = by.split('.').pop();
  const queue = start
    .flatMap(named)
    .filter(([, n]) => n !== last)
    .map(x => [...x, 0]);
  // a stored multiplier read into a local (`farm.multiplier ?? 1`): where any file sets the field itself
  if (field) queue.unshift(['field', field, 0]);
  const out = [];
  const seen = new Set();
  while (queue.length) {
    const [kind, name, depth] = queue.shift();
    if (seen.has(`${kind}:${name}`) || depth > 4) continue;
    seen.add(`${kind}:${name}`);
    if (kind === 'local') {
      for (const x of named(local(name))) queue.push([...x, depth + 1]);
      continue;
    }
    if (kind === 'call') {
      for (const f of files)
        for (const d of f.defs)
          if (d.name === name && d !== fn) {
            out.push(...readsIn(f, d.start, d.start + d.body.length, design));
            // a small predicate's fields too (`const boostedAt = (p, ms) => ms < (p.boostUntil ?? 0)`): where they
            // are set is what turns the condition on
            const small = d.body.length <= 200;
            for (const x of named(d.body))
              if (x[0] === 'call' || (small && x[0] === 'field')) queue.push([...x, depth + 1]);
          }
      continue;
    }
    const n = name.replace(/\$/g, '\\$');
    for (const f of files)
      for (const s of fieldSetters(f, name)) {
        if (s === fn) continue;
        out.push(...readsIn(f, s.start, s.start + s.body.length, design));
        // what the setting reads: `boosted: s.boostUntil > now` → boostUntil
        const body = f.code.slice(s.start, s.start + s.body.length);
        for (const x of body.matchAll(new RegExp(`(?:\\.\\s*${n}\\s*=(?![=>])|[{,]\\s*${n}\\s*:)([^,;\\n}]*)`, 'g')))
          for (const y of named(x[1])) queue.push([...y, depth + 1]);
        // and who calls the setter: the route that hands it what the player sent (a code redeemed)
        if (!s.name) continue;
        const call = new RegExp(`(?<![\\w$])${s.name.replace(/\$/g, '\\$')}\\s*(?:\\?\\.\\s*)?\\(`);
        for (const g of files)
          for (const c of g.defs)
            if (
              c !== s &&
              c.name &&
              !(g === f && c.start <= s.start && s.start < c.start + c.body.length) &&
              call.test(withoutStrings(c.body))
            )
              out.push(...readsIn(g, c.start, c.start + c.body.length, design));
      }
  }
  return out;
}

/** The functions of a file that set field `name`: `x.name = …`, `{ name: … }`, `{ name }`, `put('name', …)`. */
function fieldSetters(file, name) {
  const n = name.replace(/\$/g, '\\$');
  const out = [];
  const add = at => {
    const d = around(file, at);
    if (d.name && !out.includes(d)) out.push(d);
  };
  for (const m of file.bare.matchAll(new RegExp(`\\.\\s*${n}\\s*=(?![=>])|[{,]\\s*${n}\\s*(?::|(?=[,}]))`, 'g')))
    add(m.index);
  for (const m of file.code.matchAll(new RegExp(`\\.\\s*put\\s*\\(\\s*['"]${n}['"]`, 'g'))) add(m.index);
  return out;
}

/** The functions of a file that set `name` (`x.name = …`, `{ name: … }`): where a value applied elsewhere comes from. */
function settersOf(file, name) {
  const n = name.replace(/\$/g, '\\$');
  const re = new RegExp(`\\.\\s*${n}\\s*=(?![=>])|[{,]\\s*${n}\\s*:`, 'g');
  const out = [];
  for (const m of file.bare.matchAll(re)) {
    const d = around(file, m.index);
    if (d.name && !out.includes(d)) out.push(d);
  }
  return out;
}
