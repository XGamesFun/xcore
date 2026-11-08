// The reference-name rule: a published game never carries the name of a game it was made to look or play like. The
// person's words keep it (spec.prompt, the ledger, the look's reference records stay on their machine as written); the
// files that go public do not. Style is fair game, names are not (the kit's looks layer).
//
// Where the names come from (referenceNames): the look's references (spec.look.refs[].game, the reference folder's
// manifest `game`), the ledger's references (state.ledger.references[].name: "a game by its name") and the ledger's
// reference rows (about: 'reference', the name read out of the person's words: "the same aesthetic as <name>",
// "a game like <name>"), and any names a host passes. What publish does with them (lib/publish/tree.mjs and
// index.mjs): spec.json goes up as a copy with every name taken out of its words (redactJson), the adaptation plan is
// made from that copy, and any other file that carries a name refuses the publish, naming the file and line.
//
// Matching is by the name's letters, not its spelling: case, spaces, punctuation and CamelCase do not hide it, and a
// name the person typed with a slip ("ultmate") still finds the real spelling (an edit or two, by the name's length).
// A one-word name shorter than four letters is not matched (too many ordinary words). A multi-word name's first word
// on its own, capitalised, is a warning, not a refusal: it is often an ordinary word ("frogs", "portal").
// Pure (no Node imports): the kit's publish and a host's scan can share it.

export const REDACTED = 'a reference game';
const LEAD =
  /^(?:(?:make|build|create)\s+(?:me\s+)?)?(?:a|an|the)?\s*(?:game|games|one|thing)?\s*(?:that\s+(?:looks|plays|feels)\s+)?(?:just\s+)?(?:like|as|similar to|inspired by|in the (?:style|spirit|vein) of|with the (?:same\s+)?(?:look|style|feel|aesthetic|asethetic|aesthetics|art style|vibe)s?\s+(?:of|as)|the (?:same\s+)?(?:look|style|feel|aesthetic|asethetic|aesthetics|art style|vibe)s?\s+(?:of|as)|(?:look|style|feel|aesthetic)s?\s+(?:of|as))\s+/i;
const TAIL = /\s+(?:that|which|where|but|and|with|for|so|to|in which|lets?|except)\b.*$/i;

/** The game's name in a reference row's words ("the same aesthetic as Glimmer Valley that…" → "Glimmer Valley"), or null. */
export function nameFromWords(words) {
  let w = String(words ?? '')
    .trim()
    .replace(/[“”"«»]/g, '');
  if (!w) return null;
  let prev;
  do {
    prev = w;
    w = w.replace(LEAD, '');
  } while (w !== prev);
  w = w
    .replace(TAIL, '')
    .replace(/[.,;:!?]+$/, '')
    .trim();
  return w && w.split(/\s+/).length <= 6 ? w : null;
}

/**
 * Every reference name a game's records hold. spec: spec.json; ledger: the loop's ledger (gf-ledger/1), or null;
 * refs: reference frames ([{game}]); extra: names a host adds. → [name] (deduplicated by letters)
 */
export function referenceNames({ spec = null, ledger = null, refs = [], extra = [] } = {}) {
  const out = new Map();
  const add = n => {
    const s = String(n ?? '').trim();
    const k = squash(s);
    if (s && k.length >= 4 && !out.has(k)) out.set(k, s);
  };
  for (const r of spec?.look?.refs ?? []) add(r?.game);
  for (const r of refs ?? []) add(r?.game);
  for (const r of ledger?.references ?? []) add(r?.name);
  for (const r of ledger?.rows ?? []) if (r?.about === 'reference' && r.words) add(nameFromWords(r.words));
  for (const n of extra ?? []) add(n);
  return [...out.values()];
}

const fold = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '');
const squash = s =>
  fold(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
const wordsOf = s =>
  fold(s)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
/** How many slips a name of this many letters may have and still be the name. */
const slips = n => (n < 6 ? 0 : n < 12 ? 1 : n < 20 ? 2 : 3);

/** Edit distance, stopping once it passes `max` (→ max + 1). */
function within(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < low) low = cur[j];
    }
    if (low > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** A name as the matcher reads it. */
function formOf(name) {
  const words = wordsOf(name),
    sq = words.join('');
  return { name, words, sq, max: slips(sq.length) };
}

/**
 * Where a text carries one of the names: [{name, line, found, warn?}] (one per name; `warn`: only a multi-word name's
 * first word stood alone, capitalised). Tokens are words split at CamelCase too, so "GlimmerValleyRumble" is found.
 */
export function findNames(text, names) {
  const forms = (names ?? []).map(formOf).filter(f => f.sq.length >= 4);
  if (!forms.length || !text) return [];
  const src = String(text),
    toks = [];
  const re = /[A-Za-z0-9À-ɏ]+/g;
  for (let m; (m = re.exec(src));) {
    const parts = fold(m[0])
      .replace(/([a-z])([A-Z])/g, '$1\u0000$2')
      .split('\u0000');
    let off = m.index;
    for (const p of parts) {
      toks.push({ w: p.toLowerCase(), raw: p, at: off });
      off += p.length;
    }
  }
  const lineAt = i => src.slice(0, i).split('\n').length;
  const hits = [];
  for (const f of forms) {
    let hit = null,
      warn = null;
    const n = f.words.length,
      first = f.words[0];
    for (let i = 0; i < toks.length && !hit; i++) {
      const t = toks[i].w;
      // a cheap gate: the window starts like the name (its first word, or the squashed name's first letters)
      if (!(
        t[0] === f.sq[0] &&
        (t === first || within(t, first, 1) <= 1 || f.sq.startsWith(t.slice(0, 3)) || t.startsWith(f.sq.slice(0, 3)))
      ))
        continue;
      for (let k = Math.max(1, n - 1); k <= n + 1 && i + k <= toks.length; k++) {
        const joined = toks
          .slice(i, i + k)
          .map(x => x.w)
          .join('');
        if (within(joined, f.sq, f.max) <= f.max) {
          hit = {
            name: f.name,
            line: lineAt(toks[i].at),
            found: src.slice(toks[i].at, toks[i + k - 1].at + toks[i + k - 1].raw.length),
          };
          break;
        }
      }
      // the name's first word alone, as a proper noun: worth a look, not a refusal
      if (
        !hit &&
        !warn &&
        n > 1 &&
        first.length >= 4 &&
        (t === first || (first.length >= 6 && within(t, first, 1) <= 1)) &&
        /^[A-Z]/.test(toks[i].raw)
      )
        warn = { name: f.name, line: lineAt(toks[i].at), found: toks[i].raw, warn: true };
    }
    if (hit) hits.push(hit);
    else if (warn) hits.push(warn);
  }
  return hits;
}

/** Every name in a text replaced by REDACTED (or `by`). */
export function redactText(text, names, by = REDACTED) {
  let out = String(text ?? '');
  for (let guard = 0; guard < 20; guard++) {
    const h = findNames(out, names).find(x => !x.warn);
    if (!h) break;
    const i = out.indexOf(h.found);
    if (i < 0) break;
    out = out.slice(0, i) + by + out.slice(i + h.found.length);
  }
  return out;
}

/** A JSON value with every string's names redacted, and the `game` of every look reference dropped. Pure. */
export function redactJson(value, names) {
  const walk = (v, ref = false) => {
    if (typeof v === 'string') return redactText(v, names);
    if (Array.isArray(v)) return v.map(x => walk(x, ref));
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v)
          .filter(([k]) => !(ref && k === 'game'))
          .map(([k, x]) => [k, walk(x, k === 'refs' && Array.isArray(x))]),
      );
    return v;
  };
  return walk(value);
}

/** The refusal, in plain words, for the hits ([{path, line, name, found}]) that are not warnings, or null. */
export function namesMessage(hits) {
  const real = (hits ?? []).filter(h => !h.warn);
  if (!real.length) return null;
  const shown = real
    .slice(0, 6)
    .map(h => `${h.path}:${h.line} ("${h.found}")`)
    .join('; ');
  return (
    `Nothing was published: ${real.length === 1 ? 'a file names' : `${real.length} files name`} a game this one was made to look or play like: ${shown}${real.length > 6 ? '; …' : ''}. ` +
    "Style is fair game; another game's name is not. Take the name out of the game's own words (titles, text, comments, file names), then publish again. The person's prompt and the look's records keep it on this machine."
  );
}
