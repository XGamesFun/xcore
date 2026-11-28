// Reading code: what is not code blanked out, brackets paired, functions found with their parameters, the names a
// function gives what it was handed, and what the server's code says about vouchers and api/ routes. All of it is
// patterns over the text: nothing here parses the code or runs it. Shared by the review's parts and ../design-code/,
// so it imports none of them.
import path from 'node:path';

const blank = s => s.replace(/[^\n]/g, ' ');
const NAME = '[A-Za-z_$][\\w$]*';
/**
 * Words a regular expression can follow. After any other word, or a closing `)` or `]`, a `/` divides, unless what
 * comes next could start no value (`\`, `^`, `(?`): then it opens a regular expression there too.
 */
const BEFORE_REGEX = /^(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
const ONLY_IN_REGEX = /^(?:\\|\^|\(\?)/;

/** Where the regular expression opening at `at` closes (its last `/`), or -1 when its line holds no end. */
function regexClose(code, at) {
  for (let i = at + 1, set = false; i < code.length && code[i] !== '\n'; i++) {
    if (code[i] === '\\') i++;
    else if (code[i] === '[') set = true;
    else if (code[i] === ']') set = false;
    else if (code[i] === '/' && !set) return i;
  }
  return -1;
}

/**
 * One pass over JavaScript text that tells code from what is not: comments, strings, template literals (their text; a
 * `${…}` inside is code again) and regular-expression literals. → the text at the same length and on the same lines,
 * its comments blanked; and, unless `literals`, the contents of each literal blanked too. Quotes stay where they are,
 * and a template's `${` and `}` become ` (` and `)`, so every bracket left still pairs.
 */
function scan(code, literals) {
  let out = '';
  const open = []; // for each `${` the pass is inside: the braces opened since
  let prev = ''; // the last character of code before here
  let word = ''; // the word it ends, when it ends one
  const put = s => (out += literals ? s : blank(s));
  /** A template's text from `i`, to its closing backtick or its next `${`. → where code goes on */
  const template = i => {
    let j = i;
    while (j < code.length && code[j] !== '`' && !(code[j] === '$' && code[j + 1] === '{'))
      j += code[j] === '\\' ? 2 : 1;
    j = Math.min(j, code.length);
    put(code.slice(i, j));
    if (j === code.length) return j;
    if (code[j] === '`') {
      out += '`';
      prev = '`';
      return j + 1;
    }
    out += literals ? '${' : ' (';
    open.push(0);
    prev = '(';
    return j + 2;
  };
  for (let i = 0; i < code.length;) {
    const c = code[i],
      d = code[i + 1];
    if (c === '/' && d === '/') {
      const end = code.indexOf('\n', i);
      const stop = end < 0 ? code.length : end;
      out += blank(code.slice(i, stop));
      i = stop;
    } else if (c === '/' && d === '*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end < 0 ? code.length : end + 2;
      out += blank(code.slice(i, stop));
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < code.length && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
      j = Math.min(j, code.length);
      out += c;
      put(code.slice(i + 1, j));
      if (code[j] === c) out += code[j++];
      i = j;
      prev = c;
    } else if (c === '`') {
      out += c;
      i = template(i + 1);
    } else if (c === '}' && open.length && open.at(-1) === 0) {
      open.pop();
      out += literals ? '}' : ')';
      prev = ')';
      i = template(i + 1);
    } else {
      const regex =
        c === '/' &&
        (!prev ||
          /[(,=:[!&|?{};+\-*%<>~^}]/.test(prev) ||
          BEFORE_REGEX.test(word) ||
          ONLY_IN_REGEX.test(code.slice(i + 1, i + 3)))
          ? regexClose(code, i)
          : -1;
      if (regex > 0) {
        const flags = /^[a-z]*/i.exec(code.slice(regex + 1))[0].length;
        out += '/';
        put(code.slice(i + 1, regex));
        out += '/';
        put(code.slice(regex + 1, regex + 1 + flags));
        i = regex + 1 + flags;
        prev = '/';
        word = '';
        continue;
      }
      if (open.length && c === '{') open[open.length - 1]++;
      if (open.length && c === '}') open[open.length - 1]--;
      out += c;
      if (/[\w$]/.test(c)) {
        word = /[\w$]/.test(code[i - 1] ?? '') ? word + c : c;
        prev = c;
      } else if (!/\s/.test(c)) {
        prev = c;
        word = '';
      }
      i++;
    }
  }
  return out;
}

/** The code with its comments blanked out (literals kept, so a URL's // stays), lengths and lines unchanged. */
export const withoutComments = code => scan(code, true);

/**
 * The code alone: comments blanked, and the contents of every string, template and regular-expression literal with
 * them (a template's `${…}` is code, and stays), lengths and lines unchanged. A word or a bracket in a message is not
 * code: every bracket match and every word test of the review reads this, and looks a literal's text up in the file
 * at the same place when it needs it.
 */
export const codeOnly = code => scan(code, false);

/** The same, by the name ../design-code/ reads it under. */
export const withoutStrings = codeOnly;

/** Where the bracket that opens at `at` closes in code alone, or -1. */
export function closing(code, at) {
  const open = code[at];
  const close = { '(': ')', '[': ']', '{': '}' }[open];
  for (let i = at, depth = 0; i < code.length; i++) {
    if (code[i] === open) depth++;
    else if (code[i] === close && --depth === 0) return i;
  }
  return -1;
}

/** The `{…}` that opens at `at` in code alone: its text, or null. */
export function braced(code, at) {
  const end = closing(code, at);
  return end < 0 ? null : code.slice(at, end + 1);
}

/** The comma-separated parts of code alone between `from` and `to`, each bracket kept whole: [[start, end]]. */
export function parts(code, from, to) {
  const out = [];
  let at = from;
  for (let i = from, depth = 0; i < to; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push([at, i]);
      at = i + 1;
    }
  }
  if (code.slice(at, to).trim()) out.push([at, to]);
  return out;
}

/** A line that ends in one of these goes on; one that starts with one carries the line before it on. */
const GOES_ON = /[=>?:+\-*/%&|<!~^.,([{]/;
const CARRIES_ON = /[?:+\-*/%&|<>=.,)\]}^([`]/;
/**
 * Where the expression that starts at `at` ends in code alone: at a comma, a semicolon or a closing bracket that is not
 * its own, or at a line end that nothing carries on from.
 */
export function expressionEnd(code, at) {
  for (let i = at, depth = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth-- === 0) return i;
    } else if (depth === 0 && (c === ',' || c === ';')) return i;
    else if (depth === 0 && c === '\n') {
      const before = code.slice(at, i).trimEnd().slice(-1);
      const after = /\S/.exec(code.slice(i, i + 400))?.[0] ?? '';
      if (before && !GOES_ON.test(before) && !CARRIES_ON.test(after)) return i;
    }
  }
  return code.length;
}

/**
 * The functions (and methods) `code` defines: [{name, params, body, start}], `start` where the body opens. A body is
 * its braces, or an arrow's expression. Read off four shapes: `function name(…)`, a method `name(…) {`, and a function
 * or an arrow given a name by `const name =` or by a property `name:`.
 */
export function definitions(code) {
  const out = [];
  const seen = new Set();
  /** A function's body after its parameters end at `from`: its braces, or (after `=>`) an expression. */
  const add = (name, params, from, arrows = true) => {
    const head = /^\s*(=>)?\s*/.exec(code.slice(from));
    if (head[1] && !arrows) return;
    const start = from + head[0].length;
    const body =
      code[start] === '{' ? braced(code, start) : head[1] ? code.slice(start, expressionEnd(code, start)) : null;
    if (body === null || seen.has(`${name} ${start}`)) return;
    seen.add(`${name} ${start}`);
    out.push({ name, params, body, start });
  };
  /** A function whose parameters open at `at`. */
  const from = (name, at, arrows) => {
    const close = closing(code, at);
    if (close >= 0) add(name, code.slice(at + 1, close), close + 1, arrows);
  };
  for (const m of code.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g))
    from(m[1], m.index + m[0].length - 1, false);
  // methods of a class or an object literal (wherever they start: { async check(…) { … } })
  for (const m of code.matchAll(/(?:^|[{},;\s])(?:static\s+)?(?:async\s+)?(?:\*\s*)?([A-Za-z_$][\w$]*)\s*\(/g))
    if (!/^(?:if|for|while|switch|catch|function|return|fetch|with|await)$/.test(m[1]))
      from(m[1], m.index + m[0].length - 1, false);
  // a function or an arrow given a name: `const name = …`, or an object's property (check: async (…) => { … })
  for (const m of code.matchAll(
    /(?:\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=|(?:^|[{,\s])([A-Za-z_$][\w$]*)\s*:)\s*(?:async\b\s*)?(?:function\b[^(]*)?(?:(\()|([A-Za-z_$][\w$]*)\s*=>)/g,
  )) {
    if (m[2] === 'fetch') continue;
    if (m[3]) from(m[1] ?? m[2], m.index + m[0].length - 1, true);
    else add(m[1] ?? m[2], m[4], m.index + m[0].length - 2);
  }
  return out;
}

/** The class whose body holds `at` in code alone: its name, or null. */
export function classAt(code, at) {
  let best = null;
  for (const m of code.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)[^{]*\{/g)) {
    const end = closing(code, m.index + m[0].length - 1);
    if (end >= 0 && m.index < at && at < end) best = m[1];
  }
  return best;
}

// ---- What a function reads, by the names it gives what it was handed -------------------------------------------------
//
// A payout is judged by what its code reads: the request, or state the server keeps. Which name holds which is read
// from the code, never taken from a fixed word. A name's role is one of:
//   'body'    the request's own (its JSON, or the request itself in a route)
//   'player'  the signed-in player
//   'env'     the Worker's bindings
//   '.DB'     one binding or setting of env, by its path ('.GF.saves' is env.GF.saves)
//   {…}       an object holding roles by key: what PAY.check is called with is {body, player, env}
// Roles start at a function's parameters and go on through `const {…} = …` in its body and through the arguments of
// each call the reading follows.

/** What server/vouchers.js calls PAY.check with: one object. */
const CHECK_ARGUMENT = { body: 'body', player: 'player', env: 'env' };
/** The names a route of the game's own usually gives them: read so where no call says what a function was handed. */
const USUAL = { env: 'env', request: 'body', req: 'body', body: 'body', player: 'player' };
/** In a class (a Durable Object), `this.env` is env; whatever else `this` holds is the object's own state. */
const INSTANCE = { env: 'env' };
/**
 * What the page writes itself, read on the server through env: a player's saves (GamesFun.saves) are written by the
 * page for its own player, so they are the player's word, never state the server keeps (the voucher template says so).
 * Read in a payout, they are player input, as the request's body is.
 */
const PLAYER_WRITTEN = ['.GF.saves'];
/**
 * The same, with the leaderboards: a board holds whatever the page submits until the server takes it over
 * (`writer: 'server'`, docs/SERVER.md), so a board read in a payout is the player's word unless the server's code makes
 * its boards its own. `files`: [{text}], the server's files.
 */
export const playerWrittenIn = files =>
  files.some(f => /\bwriter\s*:\s*['"`]server['"`]/.test(f.text ?? f.code ?? ''))
    ? PLAYER_WRITTEN
    : [...PLAYER_WRITTEN, '.GF.scores'];
/** What a piece takes as written by the page: its reading's own list, or saves alone. */
const writtenBy = p => p.written ?? PLAYER_WRITTEN;
/** Is a role (a binding of env, by its path) one the page writes? */
const pageWrites = (p, role) =>
  typeof role === 'string' && role[0] === '.' && writtenBy(p).some(w => role === w || role.startsWith(`${w}.`));
/** A value new on every request: a random id, the clock, a counter in memory. */
const FRESH =
  /\b(?:randomUUID|getRandomValues|Math\s*\.\s*random)\b|\+\+|(?<!Math\s*\.\s*floor\s*\(\s*)\b(?:Date|performance)\s*\.\s*now\s*\(\s*\)(?!\s*\/)/;
/** What env.GF gives that is no state about a result: who is asking (the sign-in), and the keeper that signs. */
const NOT_STATE = new Set(['.GF.verifyPlayer', '.GF.loot.report']);
/**
 * server/vouchers.js's own helpers for the game's code (docs/SERVER.md, "Paying a result"): voucherFor signs, walletOf
 * names the wallet a player proved. Each takes env to reach the voucher key and its records, which say nothing of a
 * result: env handed to one is no read of state, and the reading does not go into them.
 */
const VOUCHER_HELPERS = new Set(['voucherFor', 'walletOf']);

/** A role's own property: the role of `name` in it, or null. */
const prop = (role, name) =>
  !role
    ? null
    : typeof role === 'object'
      ? (role[name] ?? null)
      : role === 'env'
        ? `.${name}`
        : role[0] === '.'
          ? `${role}.${name}`
          : role;

/** The first `:` or `=` of an entry outside its brackets: → [index, character], or [-1]. */
function divider(entry) {
  for (let i = 0, depth = 0; i < entry.length; i++) {
    const c = entry[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && (c === ':' || (c === '=' && entry[i + 1] !== '>'))) return [i, c];
  }
  return [-1];
}

/**
 * What a function reads from the objects it was handed in a way the reading can't follow (a computed key: `ctx[k]`,
 * `ctx['bo' + 'dy']`, `{ [k]: x } = ctx`; or the object handed to Reflect or Object): which part it took is unknown,
 * so it is never taken as state the server keeps. Kept on the roles, so it follows the function's own names.
 */
const opaqueIn = roles => (roles.opaque ??= []);
/** Calls that read an object by a key or list it, where the key is not written in the code: `Reflect.get(ctx, k)`. */
const REFLECTIVE = /(?<![\w$.])(Reflect|Object)\s*\.\s*([A-Za-z]+)\s*(?:\?\.\s*)?\(\s*$/;

/** Gives the names of a pattern (`ctx`, `{ body, env: e }`, `{ env: { DB } }`, a default after `=`) their roles. */
function bind(roles, pattern, role) {
  const p = pattern.trim().replace(/^\.\.\.\s*/, '');
  if (p[0] !== '{' && p[0] !== '[') {
    const name = new RegExp(`^${NAME}`).exec(p)?.[0];
    if (name) roles.set(name, role ?? null);
    return;
  }
  const end = closing(p, 0);
  if (end < 0) return;
  for (const [a, b] of parts(p, 1, end)) {
    const entry = p.slice(a, b).trim();
    if (p[0] === '[' || entry.startsWith('...')) {
      // an array's element, and the rest of an object: a part of the same thing
      bind(roles, entry, typeof role === 'object' && p[0] === '[' ? null : role);
      continue;
    }
    const [at, mark] = divider(entry);
    const key = (at < 0 ? entry : entry.slice(0, at)).trim();
    if (!new RegExp(`^${NAME}$`).test(key)) {
      // a key the reading can't name (`{ [k]: x } = ctx`, a quoted key): which part it takes is not known
      if (role && typeof role === 'object') opaqueIn(roles).push('{ [key]: … } (a computed key)');
      continue;
    }
    if (mark === ':') bind(roles, entry.slice(at + 1), prop(role, key));
    else roles.set(key, prop(role, key));
  }
}

const CHAIN = new RegExp(`^(${NAME})((?:\\s*\\??\\.\\s*${NAME})*)\\s*`);
/** The role of an expression: a name, a member of one (`ctx.env`, `env.DB`), or an object written out. Else null. */
function roleOf(roles, expression) {
  const e = expression.trim().replace(/^await\s+/, '');
  if (e[0] === '{') {
    const end = closing(e, 0);
    if (end !== e.length - 1) return null;
    const held = {};
    for (const [a, b] of parts(e, 1, end)) {
      const entry = e.slice(a, b).trim();
      if (entry.startsWith('...')) {
        const rest = roleOf(roles, entry.slice(3));
        if (rest && typeof rest === 'object') Object.assign(held, rest);
        continue;
      }
      const [at, mark] = divider(entry);
      const key = (mark === ':' ? entry.slice(0, at) : entry).trim();
      if (!new RegExp(`^${NAME}$`).test(key)) continue;
      const role = mark === ':' ? roleOf(roles, entry.slice(at + 1)) : roles.get(key);
      if (role) held[key] = role;
    }
    return Object.keys(held).length ? held : null;
  }
  const chain = CHAIN.exec(e);
  if (!chain) return null;
  let role = roles.get(chain[1]) ?? null;
  for (const name of chain[2].matchAll(new RegExp(NAME, 'g'))) role = prop(role, name[0]);
  const rest = e.slice(chain[0].length);
  if (!role || !rest || /^(?:\?\?|\|\|)/.test(rest)) return role;
  // what the request answers when asked (request.json(), body.get(…)) is the request's still
  return role === 'body' && /^(?:\?\.)?[([]/.test(rest) ? 'body' : null;
}

/** A function as the reading takes it. `text`: its body with literals kept, at the same places as `bare`. */
const piece = (file, def, roles = new Map()) => {
  const inClass = Boolean(file && classAt(file.bare, def.start));
  if (inClass && !roles.has('this')) roles.set('this', INSTANCE);
  return {
    file,
    def,
    bare: def.body,
    text: file ? file.code.slice(def.start, def.start + def.body.length) : def.body,
    roles,
    taken: [],
    calls: [],
    inClass,
  };
};

/** The roles `const { body, player } = ctx`, `const db = env.DB` and the like give in a function's own body. */
function declare(p) {
  for (const m of p.bare.matchAll(/\b(?:const|let|var)\s+/g)) {
    for (let at = m.index + m[0].length; ;) {
      const open = p.bare[at];
      const end =
        open === '{' || open === '['
          ? closing(p.bare, at) + 1
          : at + (new RegExp(`^${NAME}`).exec(p.bare.slice(at))?.[0].length ?? 0);
      const is = /^\s*=(?![=>])\s*/.exec(p.bare.slice(end));
      if (end <= at || !is) break;
      const from = end + is[0].length;
      const to = expressionEnd(p.bare, from);
      const role = roleOf(p.roles, p.bare.slice(from, to));
      bind(p.roles, p.bare.slice(at, end), role);
      // taken apart here, name by name: not handed on whole
      if (role) p.taken.push([from, to]);
      if (p.bare[to] !== ',') break;
      at = to + 1 + /^\s*/.exec(p.bare.slice(to + 1))[0].length;
    }
  }
}

const NOT_A_CALL =
  /^(?:if|for|while|switch|catch|function|return|typeof|await|new|delete|void|throw|case|do|else|yield|in|of|super|import)$/;
/** The calls a function makes: [{name, on (the name it is called on, null for none, false when that is no plain name), args}]. */
function callsIn(p) {
  const out = [];
  for (const m of p.bare.matchAll(new RegExp(`(?<![\\w$])(${NAME})\\s*(?:\\?\\.\\s*)?\\(`, 'g'))) {
    if (NOT_A_CALL.test(m[1])) continue;
    const open = m.index + m[0].length - 1;
    const close = closing(p.bare, open);
    if (close < 0) continue;
    const from = Math.max(0, m.index - 200);
    const before = p.bare.slice(from, m.index);
    const dot = new RegExp(`(?:(${NAME})|[)\\]])?\\s*\\??\\.\\s*$`).exec(before);
    const on = !dot ? null : dot[1] && !/\.\s*$/.test(before.slice(0, dot.index)) ? dot[1] : false;
    out.push({
      name: m[1],
      on,
      at: dot ? from + dot.index : m.index,
      open,
      close,
      args: parts(p.bare, open + 1, close),
      to: null,
    });
  }
  return out;
}

/**
 * The game's own function a call reaches: in its file, or in the file it is imported from. → [file, def] or null.
 * `locals`: the caller's own names (a parameter or a local called there is no function of the file).
 */
function reached(call, file, fileAt, locals = new Map()) {
  if (!file || call.on === false || VOUCHER_HELPERS.has(call.name)) return null;
  if (call.on === null && locals.has(call.name)) return null;
  const there = (from, name) => {
    const other = fileAt(from);
    const def = other?.defs.find(d => d.name === name);
    return def ? [other, def] : null;
  };
  if (call.on === null) {
    // a name called by itself: what the file imports under it, else a function of the file (never a class's method)
    const named = file.imports.get(call.name);
    if (named) return named.name === '*' ? null : there(named.from, named.name);
    const own = file.defs.find(d => d.name === call.name && !classAt(file.bare, d.start));
    return own ? [file, own] : null;
  }
  const own = file.defs.find(d => d.name === call.name);
  if (call.on === 'this' || file.top.has(call.on)) return own ? [file, own] : null;
  const on = file.imports.get(call.on);
  return on ? there(on.from, call.name) : null;
}

/**
 * A function and the game's own functions it reaches, three calls deep, each with the roles its caller's arguments
 * give its parameters. What is handed to a function the reading follows is read there, under the name it has there.
 */
function reach(first, fileAt) {
  const pieces = [first];
  for (let depth = 0, level = [first]; level.length; depth++) {
    const next = [];
    for (const p of level) {
      declare(p);
      p.calls = callsIn(p);
      for (const call of p.calls) {
        const found = depth < 3 ? reached(call, p.file, fileAt, p.roles) : null;
        if (!found) continue;
        const [file, def] = found;
        let q = pieces.find(x => x.file === file && x.def === def);
        const fresh = !q;
        if (fresh) {
          q = piece(file, def);
          q.written = first.written;
          pieces.push(q);
          next.push(q);
        }
        call.to = q;
        // arguments spread out (`f(...args)`) match no parameter by place: the function is read by the usual names
        const spread = call.args.some(([a, b]) => p.bare.slice(a, b).trim().startsWith('...'));
        if (spread && fresh) for (const [name, role] of Object.entries(USUAL)) q.roles.set(name, role);
        if (spread) continue;
        parts(def.params, 0, def.params.length).forEach(([a, b], i) => {
          const arg = call.args[i];
          const role = arg ? roleOf(p.roles, p.bare.slice(arg[0], arg[1])) : null;
          if (fresh || role) bind(q.roles, def.params.slice(a, b), role);
          if (role) p.taken.push(arg);
        });
      }
    }
    level = next;
  }
  return pieces;
}

/** The function a value at `at` is handed to: the name before the bracket it sits in, or null. */
function handedTo(code, at) {
  for (let i = at - 1, depth = 0; i >= 0; i--) {
    const c = code[i];
    if (c === ')' || c === ']' || c === '}') depth++;
    else if ((c === '(' || c === '[' || c === '{') && depth-- === 0) {
      if (c !== '(') return handedTo(code, i);
      const name = new RegExp(`(${NAME})\\s*(?:\\?\\.\\s*)?$`).exec(code.slice(Math.max(0, i - 200), i))?.[1];
      return name && !NOT_A_CALL.test(name) ? name : null;
    }
  }
  return null;
}

/**
 * What a function does with what it was handed. → {state: [what it uses], handed: [the functions env went to unread],
 * body: whether it reads the request}. State is a binding of env used as an object (env.DB.prepare(…), env.ROOMS.get(…),
 * env[name]), a Durable Object's own (`this.…` in a class) or the answer of a fetch that is used. A setting read as a
 * value (env.MIN_SCORE) is what the owner set, no record of anything a player did; a fetch whose answer is thrown away
 * decides nothing. env handed whole to code the reading did not follow is `handed`: taken as state, and said so.
 */
function uses(p) {
  const state = [];
  const handed = [];
  const opaque = [];
  const tainted = [];
  let body = false;
  const taken = at => p.taken.some(([a, b]) => a <= at && at < b);
  for (const m of p.bare.matchAll(new RegExp(`(?<![\\w$.])(${NAME})((?:\\s*\\??\\.\\s*${NAME})*)`, 'g'))) {
    let role = p.roles.get(m[1]);
    if (!role) continue;
    const after = p.bare.slice(m.index + m[0].length, m.index + m[0].length + 40).trimStart();
    // an object's own key ({ env: … }) is no use of the name
    if (!m[2] && /^:(?!:)/.test(after) && /[{,]\s*$/.test(p.bare.slice(Math.max(0, m.index - 40), m.index))) continue;
    // the name a declaration gives (`const req = ctx`): its value is read where the name is used, not here
    if (
      !m[2] &&
      /^=(?![=>])/.test(after) &&
      /\b(?:const|let|var)\s*$/.test(p.bare.slice(Math.max(0, m.index - 12), m.index))
    )
      continue;
    const names = [...m[2].matchAll(new RegExp(NAME, 'g'))].map(x => x[0]);
    for (const name of names) role = prop(role, name);
    if (!role) {
      if (m[1] === 'this' && p.inClass) state.push(`this.${names[0]}`);
      continue;
    }
    // an object of the check's own (ctx, or what holds env) read by a computed key, or handed to Reflect or Object
    if (typeof role === 'object' && /^(?:\?\.\s*)?\[/.test(after)) {
      opaque.push(`${m[1]}${m[2].replace(/\s+/g, '')}[…]`);
      continue;
    }
    const via = REFLECTIVE.exec(p.bare.slice(Math.max(0, m.index - 80), m.index));
    if ((typeof role === 'object' || role === 'env') && via) {
      opaque.push(`${via[1]}.${via[2]}(${m[1]}${m[2].replace(/\s+/g, '')}, …)`);
      continue;
    }
    if (role === 'body') body = true;
    else if (typeof role === 'string' && role[0] === '.') {
      const deep = role.indexOf('.', 1) > 0;
      if (!NOT_STATE.has(role) && (deep || /^(?:\?\.)?[([]/.test(after))) {
        const what = `env${role
          .split('.')
          .slice(0, role.startsWith('.GF.') ? 3 : 2)
          .join('.')}`;
        // what the page writes for its own player (saves) is the player's word, however the server reads it
        // and so is a query of the page's documents (GamesFun.db, the table gf_docs), in the statement that reads it
        const text = p.text ?? '';
        const end = text.indexOf(';', m.index);
        const statement = text.slice(m.index, end < 0 ? undefined : end);
        if (pageWrites(p, role)) tainted.push(what);
        else if (/\bgf_docs\b/.test(statement)) tainted.push(`${what} (the page's documents, gf_docs)`);
        else state.push(what);
      }
    } else if (role === 'env' && after[0] === '[') state.push('env[…]');
    else if ((role === 'env' || typeof role === 'object') && !taken(m.index)) {
      const to = handedTo(p.bare, m.index);
      if ((role === 'env' || role.env) && !VOUCHER_HELPERS.has(to)) handed.push(to);
      if (role.body) body = true;
    }
  }
  for (const m of p.bare.matchAll(/(?<![\w$.])fetch\s*\(/g)) {
    const close = closing(p.bare, m.index + m[0].length - 1);
    const before = p.bare
      .slice(Math.max(0, m.index - 200), m.index)
      .trimEnd()
      .replace(/\b(?:await|void)$/, '')
      .trimEnd();
    const rest = close < 0 ? '' : p.bare.slice(close + 1, expressionEnd(p.bare, close + 1));
    const alone = (!before || /[;{}]$/.test(before)) && /^\s*(?:\.\s*catch\s*\([\s\S]*\)\s*)?$/.test(rest);
    if (!alone && !/\bwaitUntil\s*\($/.test(before)) state.push('the answer of a fetch');
  }
  return { state, handed, opaque, tainted, body };
}

/** The entries named `key` in the objects written out in `bare`: [{at, value: [start, end] | null (shorthand)}]. */
function entries(bare, key) {
  const out = [];
  for (const m of bare.matchAll(new RegExp(`(?<=[{,]\\s*)${key}\\s*(?=[:,}])`, 'g'))) {
    const colon = m.index + m[0].length;
    if (bare[colon] !== ':') out.push({ at: m.index, value: null });
    else if (bare[colon + 1] !== ':') out.push({ at: m.index, value: [colon + 1, expressionEnd(bare, colon + 1)] });
  }
  return out;
}

/**
 * The object written out around `at` (an entry of its own): [start, end], or null. A `{` after `(`, `,`, `=`, `:`, `[`,
 * `?`, `&`, `|` or `return` opens an object; any other opens a block. One that `=` or `) =>` follows is a pattern.
 */
function objectAround(bare, at) {
  for (let i = at - 1, depth = 0; i >= 0; i--) {
    const c = bare[i];
    if (c === ')' || c === ']' || c === '}') depth++;
    else if ((c === '(' || c === '[' || c === '{') && depth-- === 0) {
      const before = bare.slice(Math.max(0, i - 12), i).trimEnd();
      const end = c === '{' ? closing(bare, i) : -1;
      const object = /[(,:[?&|]$|(?<![=!<>])=$|\breturn$/.test(before);
      const pattern = /^\s*(?:=(?![=>])|\)\s*=>)/.test(bare.slice(end + 1, end + 40));
      return end < 0 || !object || pattern ? null : [i, end + 1];
    }
  }
  return null;
}

/** A literal's own text where `bare` holds only its quotes: 'grant' for `'grant'`, or null when it is no literal. */
function literal(p, [a, b]) {
  const t = p.text.slice(a, b).trim();
  if (/^\d+$/.test(t)) return t;
  return /^(['"`])[^'"`$\\]*\1$/.test(t) && /^(['"`])\s*\1$/.test(p.bare.slice(a, b).trim()) ? t.slice(1, -1) : null;
}

// ---- Where a value of the answer comes from -------------------------------------------------------------------------
//
// A value the check answers with (the wallet, the grant, the amount, the round) is the player's word when the request
// or what the page writes (saves, boards) reaches it: by its own names, or by a name it was given, followed back. What
// a lookup of state answers (db(env).first(…, body.runId), env.RUNS.get(body.runId)) is the server's, whatever key
// the request gave it.

/** Where the bracket that closes at `at` in code alone opens, or -1. */
function opening(code, at) {
  const close = code[at];
  const open = { ')': '(', ']': '[', '}': '{' }[close];
  for (let i = at, depth = 0; i >= 0; i--) {
    if (code[i] === close) depth++;
    else if (code[i] === open && --depth === 0) return i;
  }
  return -1;
}

/** What a call is made on, up to its bracket: `db(env).first` for `db(env).first(…)`. */
function calleeOf(bare, open) {
  let j = open - 1;
  for (;;) {
    while (j >= 0 && /\s/.test(bare[j])) j--;
    if (bare[j] === ')' || bare[j] === ']') {
      const o = opening(bare, j);
      if (o < 0) break;
      j = o - 1;
      continue;
    }
    const m = /[A-Za-z_$][\w$]*$/.exec(bare.slice(Math.max(0, j - 80), j + 1));
    if (!m) break;
    j -= m[0].length;
    let k = j;
    while (k >= 0 && /\s/.test(bare[k])) k--;
    if (bare[k] !== '.') break;
    j = bare[k - 1] === '?' ? k - 2 : k - 1;
  }
  return [j + 1, bare.slice(j + 1, open)];
}

const holdsEnv = role =>
  role === 'env' ||
  (typeof role === 'string' && role[0] === '.') ||
  Boolean(role && typeof role === 'object' && Object.values(role).some(holdsEnv));
const CHAIN_G = new RegExp(`(?<![\\w$.])(${NAME})((?:\\s*\\??\\.\\s*${NAME})*)`, 'g');

/**
 * The calls of a function that ask state the server keeps (made on env, a binding of it, a holder of it, `this` in a
 * Durable Object, or fetch): [[open, close]] of each one's arguments.
 */
function stateCalls(p) {
  if (p.stateCalls) return p.stateCalls;
  const out = [];
  for (const c of p.calls ?? callsIn(p)) {
    const [, callee] = calleeOf(p.bare, c.open);
    const asks =
      /^fetch$/.test(callee.trim()) ||
      (p.inClass && /^\s*this\b/.test(callee)) ||
      [...callee.matchAll(CHAIN_G)].some(m => {
        let role = p.roles.get(m[1]);
        for (const n of m[2].matchAll(new RegExp(NAME, 'g'))) role = prop(role, n[0]);
        return holdsEnv(role) || holdsEnv(p.roles.get(m[1]));
      });
    if (asks) out.push([c.open, c.close]);
  }
  return (p.stateCalls = out);
}

/**
 * Does the expression at [a, b) carry the player's word: the request, or what the page writes, by its own names or by
 * a name it was given (followed back, three deep)? The arguments of a call that asks state are left out: what state
 * answers is the server's.
 */
function playerWord(p, [a, b], depth = 0) {
  const skip = stateCalls(p).filter(([o, c]) => a <= o && c <= b);
  for (const m of p.bare.slice(a, b).matchAll(CHAIN_G)) {
    const at = a + m.index;
    if (skip.some(([o, c]) => o < at && at < c)) continue;
    let role = p.roles.get(m[1]);
    for (const n of m[2].matchAll(new RegExp(NAME, 'g'))) role = prop(role, n[0]);
    if (role === 'body' || role?.body || pageWrites(p, role)) return true;
    // (a name with no role of its own: what it was given)
    if (!p.roles.get(m[1]) && depth < 3 && givenPlayerWord(p, m[1], depth + 1)) return true;
  }
  return false;
}

/** The values a name is given in a function: `name = …`, and the patterns that take it apart (`const { name } = …`). */
function givenValues(p, name) {
  const n = name.replace(/\$/g, '\\$');
  const out = [];
  for (const m of p.bare.matchAll(new RegExp(`(?<![\\w$.])${n}\\s*=(?![=>])`, 'g'))) {
    const from = m.index + m[0].length;
    out.push([from, expressionEnd(p.bare, from)]);
  }
  for (const m of p.bare.matchAll(/\b(?:const|let|var)\s+([{[])/g)) {
    const open = m.index + m[0].length - 1;
    const close = closing(p.bare, open);
    if (close < 0 || !new RegExp(`(?<![\\w$.])${n}(?![\\w$])`).test(p.bare.slice(open, close + 1))) continue;
    const is = /^\s*=(?![=>])\s*/.exec(p.bare.slice(close + 1));
    if (!is) continue;
    const from = close + 1 + is[0].length;
    out.push([from, expressionEnd(p.bare, from)]);
  }
  return out;
}
const givenPlayerWord = (p, name, depth) => givenValues(p, name).some(span => playerWord(p, span, depth));

/** An entry's value is the player's word: its value, or (shorthand) the name of its key. */
const filledBy = (p, e, key) =>
  e.value
    ? playerWord(p, e.value)
    : p.roles.get(key)
      ? p.roles.get(key) === 'body' || pageWrites(p, p.roles.get(key))
      : givenPlayerWord(p, key, 1);

/** The names the state a check asks is looked up by: the last word of each name in the arguments of those calls. */
function lookedUp(p) {
  const out = new Set();
  for (const [o, c] of stateCalls(p))
    for (const m of p.bare.slice(o, c).matchAll(CHAIN_G)) out.add((m[2].match(new RegExp(NAME, 'g')) ?? [m[1]]).at(-1));
  return out;
}

/** Calls a round is made with that keep what they are given: no function of the game's own that is not read. */
const KEEPS = /^(?:String|Number|BigInt|parseInt|parseFloat|Boolean|encodeURIComponent|decodeURIComponent)$/;
/** The clock in a unit shorter than a day (`Math.floor(Date.now() / 1000)`): new every second, or every hour. */
function shortClock(text) {
  const m =
    /Math\s*\.\s*(?:floor|round|trunc|ceil)\s*\(\s*(?:Date|performance)\s*\.\s*now\s*\(\s*\)\s*\/\s*([\d_]+(?:\s*\*\s*[\d_]+)*)\s*\)/.exec(
      text,
    );
  if (!m) return false;
  const unit = m[1].split('*').reduce((n, x) => n * Number(x.replace(/[_\s]/g, '')), 1);
  return unit > 0 && unit < 86_400_000;
}

/**
 * Where a round comes from: 'fresh' new on every request (a random id, the clock, a counter, or a function of the
 * game's own that answers one); {by: 'request', names} parts of the request the check never looked state up by (a
 * script sends a new one each time); 'unread' a function it was not read through; null: from the code, or a request's
 * value the check looked up (a run id the server gave out).
 */
function roundFrom(p, span, looked) {
  const text = p.bare.slice(span[0], span[1]);
  const full = p.text.slice(span[0], span[1]);
  const inSpan = c => span[0] <= c.at && c.close <= span[1];
  const calls = (p.calls ?? []).filter(inSpan);
  if (FRESH.test(text) || shortClock(full)) return 'fresh';
  if (calls.some(c => c.to && (FRESH.test(c.to.bare) || shortClock(c.to.text ?? '')))) return 'fresh';
  const skip = stateCalls(p).filter(([o, c]) => span[0] <= o && c <= span[1]);
  const names = [];
  for (const m of text.matchAll(CHAIN_G)) {
    const at = span[0] + m.index;
    if (skip.some(([o, c]) => o < at && at < c)) continue;
    let role = p.roles.get(m[1]);
    for (const n of m[2].matchAll(new RegExp(NAME, 'g'))) role = prop(role, n[0]);
    const last = (m[2].match(new RegExp(NAME, 'g')) ?? [m[1]]).at(-1);
    if ((role === 'body' || pageWrites(p, role)) && !looked.has(last)) names.push(`${m[1]}${m[2].replace(/\s+/g, '')}`);
  }
  if (names.length) return { by: 'request', names: [...new Set(names)] };
  const unread = calls.find(c => !c.to && c.on === null && !KEEPS.test(c.name) && !VOUCHER_HELPERS.has(c.name));
  return unread ? { by: 'unread', names: [unread.name] } : null;
}

/**
 * The values a spread of [x, y) in code alone can give: each branch of a ternary, the right of `&&` (its left gives
 * nothing to spread when false), each side of `||` and `??`; brackets around them taken off. → [[start, end]]
 */
function spreadValues(bare, x, y) {
  while (x < y && /\s/.test(bare[x])) x++;
  while (y > x && /\s/.test(bare[y - 1])) y--;
  if (bare[x] === '(' && closing(bare, x) === y - 1) return spreadValues(bare, x + 1, y - 1);
  let ask = -1,
    colon = -1,
    nested = 0;
  const or = [],
    and = [];
  for (let i = x, depth = 0; i < y; i++) {
    const c = bare[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth) continue;
    else if ((c === '|' && bare[i + 1] === '|') || (c === '?' && bare[i + 1] === '?')) {
      if (ask < 0) or.push(i);
      i++;
    } else if (c === '&' && bare[i + 1] === '&') {
      if (ask < 0) and.push(i);
      i++;
    } else if (c === '?' && !/[.]/.test(bare[i + 1] ?? '')) {
      if (ask < 0) ask = i;
      else nested++;
    } else if (c === ':' && ask >= 0) {
      if (nested) nested--;
      else if (colon < 0) colon = i;
    }
  }
  if (ask >= 0 && colon > ask) return [...spreadValues(bare, ask + 1, colon), ...spreadValues(bare, colon + 1, y)];
  if (or.length)
    return [x, ...or.map(i => i + 2)].flatMap((from, k) => spreadValues(bare, from, k < or.length ? or[k] : y));
  if (and.length) return spreadValues(bare, and.at(-1) + 2, y);
  return [[x, y]];
}

/** The name an object written out at [a, …) is given (`const out = { … }`), or null. */
function holderOf(bare, a) {
  return /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(bare.slice(Math.max(0, a - 80), a))?.[1] ?? null;
}

/**
 * What each object a function writes out says it pays: [{grant, grantBy, amount, recipient, fresh, round, unread}]
 * for each that names a grant (or, with `within`, a span of the function's own, each that names a grant, a wallet,
 * winners or an amount there). Read with it: what is written to it afterwards (`out.wallet = …`,
 * `Object.assign(out, …)`) and what is spread into it (`...body`).
 *   grant      its key or id when written as a literal, else null (worked out as it runs: any grant); grantBy
 *              'request' when the player's word picks it
 *   amount     'grant' the grant's own, 'request' from the request, 'server' the code's, null when not named
 *   recipient  'request' a wallet (or winners) the player's word names, 'check' one the code names, 'proven' when none
 *              is named, 'unread' when something spread into it can't be told
 *   round      roundFrom's: where the result's own id comes from; fresh: new on every request
 *   unread     what in it the reading could not follow, in words
 * `looked`: the names the check looks state up by.
 */
function answersIn(p, within = null, looked = new Set()) {
  const found = new Map();
  for (const key of within ? ['grant', 'wallet', 'winners', 'amount'] : ['grant'])
    for (const e of entries(p.bare, key)) {
      const object = objectAround(p.bare, e.at);
      if (object && (!within || (within[0] <= e.at && e.at < within[1]))) found.set(object[0], object);
    }
  // an object inside another found one is a part of it (the winners of a report)
  const outer = [...found.values()].filter(([a, b]) => ![...found.values()].some(([c, d]) => c < a && b <= d));
  return outer.map(([a, b]) => {
    const inside = key =>
      entries(p.bare.slice(a, b), key).map(e => ({ at: e.at + a, value: e.value && [e.value[0] + a, e.value[1] + a] }));
    const keyed = Object.fromEntries(['grant', 'amount', 'round', 'wallet', 'winners'].map(k => [k, inside(k)]));
    // what is spread into it, and what is written to it after it is made: by its name (`out.wallet = …`)
    const spread = parts(p.bare, a + 1, b - 1)
      .map(([x, y]) => [x + /^\s*/.exec(p.bare.slice(x, y))[0].length, y])
      .filter(([x]) => p.bare.startsWith('...', x))
      .map(([x, y]) => [x + 3, y]);
    const holder = holderOf(p.bare, a);
    if (holder) {
      const h = holder.replace(/\$/g, '\\$');
      for (const m of p.bare
        .slice(b)
        .matchAll(
          new RegExp(`(?<![\\w$.])${h}\\s*(?:\\.\\s*(${NAME})|\\[\\s*(['"\`])\\s*\\3\\s*\\])\\s*=(?![=>])`, 'g'),
        )) {
        const at = b + m.index;
        const from = at + m[0].length;
        const key = m[1] ?? new RegExp(`^.{${m[0].indexOf(m[3]) + 1}}(\\w+)`).exec(p.text.slice(at))?.[1];
        if (key in keyed) keyed[key].push({ at, value: [from, expressionEnd(p.bare, from)] });
      }
      for (const m of p.bare.slice(b).matchAll(new RegExp(`\\bObject\\s*\\.\\s*assign\\s*\\(\\s*${h}\\s*,`, 'g'))) {
        const open = b + m.index + m[0].indexOf('(');
        const close = closing(p.bare, open);
        if (close < 0) continue;
        for (const [x, y] of parts(p.bare, b + m.index + m[0].length, close)) {
          const lead = x + /^\s*/.exec(p.bare.slice(x, y))[0].length;
          // an object written out: its entries are the answer's; anything else is spread into it
          if (p.bare[lead] === '{' && closing(p.bare, lead) === y - 1 - /\s*$/.exec(p.bare.slice(x, y))[0].length)
            for (const key of Object.keys(keyed))
              keyed[key].push(
                ...entries(p.bare.slice(lead, y), key).map(e => ({
                  at: e.at + lead,
                  value: e.value && [e.value[0] + lead, e.value[1] + lead],
                })),
              );
          else spread.push([x, y]);
        }
      }
    }
    const [grant] = keyed.grant;
    const [amount] = keyed.amount;
    const round = keyed.round.at(-1);
    const who = [...keyed.wallet.map(e => [e, 'wallet']), ...keyed.winners.map(e => [e, 'winners'])];
    const unread = [];
    // a spread the player's word fills can name the wallet; one the reading can't trace may too
    // ('request' the player's word fills all of it; 'request-wallet', '-amount', '-grant' that one entry of it)
    const spreadBy = spread.flatMap(([x, y]) =>
      spreadValues(p.bare, x, y).flatMap(span => {
        const e = p.bare.slice(span[0], span[1]).trim();
        if (e[0] === '{') {
          // an object written out: read by its entries, as the answer's own are
          const lead = span[0] + p.bare.slice(span[0], span[1]).indexOf('{');
          if (/\.\.\./.test(e) && playerWord(p, span)) return ['request'];
          const at = key =>
            entries(p.bare.slice(lead, span[1]), key).map(n => ({
              at: n.at + lead,
              value: n.value && [n.value[0] + lead, n.value[1] + lead],
            }));
          const by = [];
          for (const [key, what] of [
            ['wallet', 'wallet'],
            ['winners', 'wallet'],
            ['amount', 'amount'],
            ['grant', 'grant'],
          ])
            if (at(key).some(n => filledBy(p, n, key))) by.push(`request-${what}`);
          if (!by.includes('request-wallet') && (at('wallet').length || at('winners').length)) by.push('check');
          return by;
        }
        if (playerWord(p, span)) return ['request'];
        if (/^(?:null|undefined|false|0|(['"`])\s*\1)$/.test(e)) return [];
        const name = new RegExp(`^${NAME}$`).exec(e)?.[0];
        const given = name ? givenValues(p, name) : [];
        if (given.length)
          return given.some(g => /\b(?:wallet|winners)\b/.test(p.bare.slice(g[0], g[1]))) ? ['check'] : [];
        const words = p.text.slice(span[0], span[1]).trim().replace(/\s+/g, ' ');
        unread.push(`what it spreads into its answer (${words.slice(0, 40)})`);
        return ['unread'];
      }),
    );
    const spreads = what => spreadBy.includes('request') || spreadBy.includes(`request-${what}`);
    const literalGrant = grant?.value ? literal(p, grant.value) : null;
    const from = round?.value ? roundFrom(p, round.value, looked) : null;
    if (from?.by === 'unread') unread.push(`its round, made by ${from.names.map(n => `${n}()`).join(', ')}`);
    return {
      grant: literalGrant,
      grantBy:
        keyed.grant.some(e => !(e.value && literal(p, e.value)) && filledBy(p, e, 'grant')) || spreads('grant')
          ? 'request'
          : null,
      amount: !amount
        ? spreads('amount')
          ? 'request'
          : null
        : keyed.amount.some(e => filledBy(p, e, 'amount')) || spreads('amount')
          ? 'request'
          : amount.value && literal(p, amount.value) === 'grant'
            ? 'grant'
            : 'server',
      recipient:
        who.some(([e, key]) => filledBy(p, e, key)) || spreads('wallet')
          ? 'request'
          : who.length || spreadBy.includes('check')
            ? 'check'
            : spreadBy.includes('unread')
              ? 'unread'
              : 'proven',
      // a round new on every request (a random id, the clock, a counter): every request is a claim of its own
      fresh: from === 'fresh',
      round: from && from !== 'fresh' ? from : null,
      unread,
    };
  });
}

/**
 * Does a function give back only what the reading sees: a value written out (an object, null, a string), or the answer
 * of a function it followed that does? → the names it answers through that were not read (none: it does)
 */
function unseen(p, done = new Set()) {
  if (done.has(p)) return [];
  done.add(p);
  const block = p.bare[0] === '{';
  const out = [];
  for (const at of block ? [...p.bare.matchAll(/\breturn\b/g)].map(m => m.index + 6) : [0]) {
    const end = expressionEnd(p.bare, at);
    const from = at + /^\s*(?:await\s+)?\(?\s*/.exec(p.bare.slice(at, end))[0].length;
    const e = p.bare.slice(from, end).trim();
    if (!e || /^(?:\{|['"`]|\d|(?:null|undefined|false|true)\b)/.test(e)) continue;
    const call = p.calls.find(
      c =>
        c.at === from &&
        p.bare
          .slice(c.close + 1, end)
          .replace(/\)/g, '')
          .trim() === '',
    );
    if (call?.to) out.push(...unseen(call.to, done));
    else out.push(call?.name ?? new RegExp(`^${NAME}`).exec(e)?.[0] ?? 'an expression');
  }
  return out;
}

/**
 * The reading of a payout, from the functions that decide it. → {source, decides, seen, assumed, unread, answers}
 *   source   'env' it reads state the server keeps; 'request' it reads none (PAY.check: and answers a grant; a
 *            function that signs: and reads the request); 'nothing' PAY.check answers no grant; 'unreadable' what
 *            decides it is in code the reading did not follow
 *   decides  with 'request': 'body' the request's own words, 'sign-in' the sign-in alone
 *   seen     what the reading rests on, in words; assumed: state only because env went to code not read
 *   unread   the names it answers through, or hands env to, that were not read
 * `within`: for a function that signs, the span of its signing call (its answers are the objects written out there).
 */
function reading(pieces, { within = null } = {}) {
  const used = pieces.map(uses);
  const state = [...new Set(used.flatMap(u => u.state))];
  const handed = [...new Set(used.flatMap(u => u.handed))];
  const named = handed.filter(Boolean);
  const tainted = [...new Set(used.flatMap(u => u.tainted ?? []))];
  // player-written data (saves, the page's documents) decides a payout as the request's body does: never state
  const body = used.some(u => u.body) || tainted.length > 0;
  const opaque = [...new Set([...used.flatMap(u => u.opaque), ...pieces.flatMap(p => p.roles.opaque ?? [])])];
  // the names the check looks state up by, in every function it reaches: a round the request names is no fresh claim
  // when the check looked it up (a run id the server gave out)
  const looked = new Set(pieces.flatMap(p => [...lookedUp(p)]));
  let answers = pieces.flatMap(p => answersIn(p, null, looked));
  if (within) {
    answers = answersIn(pieces[0], within, looked);
    if (!answers.length) answers = answersIn(pieces[0], [0, pieces[0].bare.length], looked);
  }
  // state read is state that decides only when it reaches the decision: a condition, or what the check answers. A read
  // whose answer nothing uses (`await db(env).first('SELECT 1')`), or a query with no table (`SELECT 1`), decides
  // nothing, so the check is read as if it had not read it (a function that signs is read as it was)
  const read = state.length > 0 || handed.length > 0;
  const idle = read && !within && !stateDecides(pieces[0]);
  const kept = read && !idle;
  const through = kept || within || answers.length ? [] : [...new Set(unseen(pieces[0]))];
  const source = kept
    ? 'env'
    : within
      ? body
        ? 'request'
        : 'unreadable'
      : answers.length
        ? 'request'
        : through.length
          ? 'unreadable'
          : 'nothing';
  // read through a computed key: what it rests on can't be told, so it is neither state nor the request's word (unless
  // the request's own words already decide it, which is the weaker reading and stays)
  if (opaque.length && !(source === 'request' && body))
    return { source: 'unreadable', decides: null, seen: null, assumed: false, opaque, unread: opaque, answers };
  return {
    source,
    opaque: [],
    decides: source === 'request' ? (body ? 'body' : 'sign-in') : null,
    tainted,
    idle,
    seen: idle
      ? `it reads ${state.length ? state.slice(0, 2).join(' and ') : 'env'}, but nothing it reads decides the payout (no condition and no answer uses it)`
      : state.length
        ? `it uses ${state.slice(0, 2).join(' and ')}${tainted.length ? `, and ${tainted.join(' and ')}, which the player writes` : ''}`
        : tainted.length
          ? `it uses ${tainted.join(' and ')}, which the player writes`
          : handed.length
            ? `it hands env ${named.length ? `to ${named.slice(0, 2).join(' and ')}, which this review did not read` : 'on to code this review did not read'}`
            : null,
    assumed: kept && !state.length && handed.length > 0,
    unread: source === 'unreadable' ? through : !state.length ? named : [],
    // what the request sends that a deciding condition measures against (a bar the request can move)
    bound: kept ? [...new Set(pieces.flatMap(requestBound))] : [],
    answers,
  };
}

/**
 * The request's values a condition of a function compares by size or works out a size from (`< Number(body.minMs)`,
 * `body.endedAt - body.startedAt < 60_000`): the request then moves the bar it is measured against. A test of
 * whether it is there or what it is (`!body.runId`, `typeof body.x`, `===`) is no bar. → [the names, as written]
 */
function requestBound(p) {
  const out = [];
  for (const m of p.bare.matchAll(/\b(?:if|while)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = closing(p.bare, open);
    if (close < 0) continue;
    const skip = stateCalls(p).filter(([o, c]) => open <= o && c <= close);
    // the condition with the arguments of each state lookup in it blanked: what it measures, not what it looks up by
    let cond = p.bare.slice(open, close + 1);
    for (const [o, c] of skip) cond = cond.slice(0, o - open) + ' '.repeat(c - o + 1) + cond.slice(c - open + 1);
    if (!/(?<![=<>!])(?:<=?|>=?)(?![=>])/.test(cond)) continue;
    for (const n of cond.matchAll(CHAIN_G)) {
      let role = p.roles.get(n[1]);
      for (const x of n[2].matchAll(new RegExp(NAME, 'g'))) role = prop(role, x[0]);
      if (role === 'body' || pageWrites(p, role)) out.push(`${n[1]}${n[2].replace(/\s+/g, '')}`);
    }
  }
  return out;
}

/**
 * Is the statement after an `if (…)` that ends at `at` only log lines (console.log, warn, …), with no else: a
 * condition that decides nothing.
 */
function logsOnly(bare, at) {
  const rest = bare.slice(at);
  const lead = /^\s*/.exec(rest)[0].length;
  let body, end;
  if (rest[lead] === '{') {
    const block = braced(rest, lead);
    if (!block) return false;
    body = block.slice(1, -1);
    end = lead + block.length;
  } else {
    end = expressionEnd(rest, lead);
    body = rest.slice(lead, end);
  }
  if (/^\s*;?\s*else\b/.test(rest.slice(end))) return false;
  // what is left once every console call, with its arguments, is taken out: nothing but semicolons
  let left = body,
    logs = 0;
  for (const m of [...body.matchAll(/(?<![\w$.])console\s*\.\s*\w+\s*\(/g)].reverse()) {
    const close = closing(body, m.index + m[0].length - 1);
    if (close < 0) return false;
    left = left.slice(0, m.index) + left.slice(close + 1);
    logs++;
  }
  return logs > 0 && /^[\s;]*$/.test(left);
}

/**
 * Does what the function reads from env (a binding, a call it hands env or a holder of env to) reach its decision: a
 * condition (if, while) or what it answers (a return)? Names given a value that comes from env carry it on. A query
 * with no table (`SELECT 1`, `SELECT datetime('now')`) is no state, and a function's answer handed straight to
 * another function the reading followed is that function's decision. → true or false
 */
function stateDecides(p, depth = 0) {
  if (!p) return false;
  // what carries env here: the names whose role is env, a binding of it, or a holder of it; `this` in a class
  const holds = role =>
    role === 'env' ||
    (typeof role === 'string' && role[0] === '.') ||
    (role && typeof role === 'object' && Object.values(role).some(holds));
  const carriers = new Set([...p.roles].filter(([, role]) => holds(role)).map(([name]) => name));
  if (p.inClass) carriers.add('this');
  // a query with no table answers the same every time: blanked, with what it is part of, up to the statement's end
  let bare = p.bare;
  for (const m of (p.text ?? '').matchAll(/(["'`])\s*SELECT\b((?:(?!\1)[\s\S])*)\1/gi)) {
    if (/\bFROM\b|\?|\$\{/i.test(m[2])) continue;
    const start =
      Math.max(bare.lastIndexOf(';', m.index), bare.lastIndexOf('{', m.index), bare.lastIndexOf('}', m.index)) + 1;
    const end = bare.indexOf(';', m.index);
    bare =
      bare.slice(0, start) + blank(bare.slice(start, end < 0 ? bare.length : end)) + (end < 0 ? '' : bare.slice(end));
  }
  const word = name => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`);
  // (a backend of the game's own, asked with fetch, is state too)
  const carries = text => /(?<![\w$.])fetch\s*\(/.test(text) || [...carriers].some(n => word(n).test(text));
  // names given a value that carries env (`const run = await db(env).first(…)`), until no more are found
  for (let more = true; more;) {
    more = false;
    for (const m of bare.matchAll(/\b(?:const|let|var)\s+([^=;]+?)\s*=(?![=>])/g)) {
      const from = m.index + m[0].length;
      const rhs = bare.slice(from, expressionEnd(bare, from));
      if (!carries(rhs)) continue;
      for (const n of m[1].match(new RegExp(NAME, 'g')) ?? []) {
        // a name the pattern takes from a holder keeps its own role (body and player are no state)
        const own = p.roles.get(n);
        if (own && !holds(own)) continue;
        if (!carriers.has(n)) {
          carriers.add(n);
          more = true;
        }
      }
    }
  }
  // the decisions: each condition (unless all it does is write a log line), and each answer
  for (const m of bare.matchAll(/\b(?:if|while)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = closing(bare, open);
    if (!carries(bare.slice(open, close + 1))) continue;
    if (/^if/.test(m[0]) && logsOnly(bare, close + 1)) continue;
    return true;
  }
  for (const m of bare.matchAll(/\breturn\b/g)) {
    const from = m.index + 6;
    const answer = bare.slice(from, expressionEnd(bare, from));
    if (!carries(answer)) continue;
    // handed straight to a function the reading followed: that function decides
    const call = p.calls.find(
      c =>
        c.to && c.at >= from && c.at < from + answer.length && /^\s*(?:await\s+)?\(?\s*$/.test(bare.slice(from, c.at)),
    );
    if (call && depth < 3) {
      if (stateDecides(call.to, depth + 1)) return true;
      continue;
    }
    return true;
  }
  // an arrow whose body is an expression answers it
  if (!/\breturn\b/.test(bare) && carries(bare)) return true;
  return false;
}

/** A server file as the reading takes it: its code, its functions, what it imports and the names at its top level. */
function fileOf(f, text) {
  const code = withoutComments(text);
  const bare = codeOnly(text);
  const imports = new Map();
  for (const m of code.matchAll(/\bimport\s+([^'"]+?)\s+from\s*(['"])(\.{1,2}\/[^'"]+)\2/g)) {
    if (!bare.startsWith('import', m.index)) continue;
    const from = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[3]));
    for (const n of /\{([^}]*)\}/.exec(m[1])?.[1].split(',') ?? []) {
      const [name, local = name] = n.trim().split(/\s+as\s+/);
      if (name) imports.set(local.trim(), { from, name: name.trim() });
    }
    const all = new RegExp(`\\*\\s*as\\s+(${NAME})`).exec(m[1]);
    if (all) imports.set(all[1], { from, name: '*' });
  }
  const top = new RegExp(
    `^(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:const|let|var|class|function)\\b\\s*\\*?\\s*(${NAME})`,
    'gm',
  );
  return { f, code, bare, defs: definitions(bare), imports, top: new Set([...bare.matchAll(top)].map(m => m[1])) };
}

/**
 * What server/vouchers.js says about paying: PAY.check, read with the game's own functions it reaches (in this file
 * and, given `files`, in the server's other files: [{f, text}]), and VOUCHERS.payOnly.
 * → {template, check: {params, body, bare, pieces} | null, payOnly}. `body` is the check's code and the code it
 * reaches, literals kept; `template` is true while the check answers no grant and still says the template's sentence.
 */
export function readVouchers(text, { files = [] } = {}) {
  const made = new Map();
  const fileAt = f => {
    if (!made.has(f)) {
      const raw = f === 'vouchers.js' ? { text } : files.find(x => x.f === f);
      made.set(f, raw ? fileOf(f, raw.text) : null);
    }
    return made.get(f);
  };
  const file = fileAt('vouchers.js');
  const { code, bare } = file;
  const pay = /^export const PAY = \{/m.exec(bare);
  const open = pay ? pay.index + pay[0].length - 1 : -1;
  const block = pay ? braced(bare, open) : null;
  const inside = d => open < d.start && d.start < open + block.length;
  let def = block
    ? (file.defs.filter(d => d.name === 'check' && inside(d)).sort((a, b) => a.start - b.start)[0] ?? null)
    : null;
  // a check named, not written, in PAY (`{ check }`, `check: payCheck`): the function of that name
  const named = block && !def ? new RegExp(`[{,]\\s*check\\s*(?::\\s*(${NAME})\\s*)?[,}]`).exec(block) : null;
  if (named) {
    const call = { name: named[1] ?? 'check', on: null };
    [, def] = reached(call, file, fileAt) ?? [];
  }
  let check = null;
  if (def) {
    const home = [...made.values()].find(x => x?.defs.includes(def)) ?? file;
    const first = piece(home, def);
    first.written = playerWrittenIn([{ text }, ...files]);
    const [param] = parts(def.params, 0, def.params.length);
    if (param) bind(first.roles, def.params.slice(param[0], param[1]), CHECK_ARGUMENT);
    if (param && ![...first.roles.values()].some(Boolean))
      for (const [k, v] of Object.entries(USUAL)) first.roles.set(k, v);
    const pieces = reach(first, fileAt);
    check = {
      params: def.params,
      body: pieces.map(p => p.text).join('\n'),
      bare: pieces.map(p => p.bare).join('\n'),
      pieces,
    };
  }
  const vouchers = /^export const VOUCHERS = \{/m.exec(bare);
  const at = vouchers ? vouchers.index + vouchers[0].length - 1 : -1;
  const settings = vouchers ? (braced(bare, at) ?? '') : '';
  const only = entries(settings, 'payOnly')[0]?.value;
  const payOnly = only ? code.slice(at + only[0], at + only[1]).trim() : '';
  return {
    template:
      Boolean(check) && payReading(check).source === 'nothing' && /This game pays no results yet/.test(check.body),
    check,
    payOnly: /^(['"])(\w+)\1$/.exec(payOnly)?.[2] ?? null,
  };
}

/** The reading of PAY.check (readVouchers' `check`, or a body alone, read by the usual names). */
export function payReading(check) {
  if (check.pieces) return (check.reading ??= reading(check.pieces));
  const p = piece(
    null,
    { name: 'check', params: '', body: codeOnly(check.body), start: 0 },
    new Map(Object.entries(USUAL)),
  );
  p.text = check.body;
  return reading(reach(p, () => null));
}

/**
 * Does PAY.check pay from the request alone? It answers a grant, and reads no state the server keeps (no Durable
 * Object, no database, no record of a run the server started, no backend asked): whatever it pays, the page's request
 * decided.
 */
export function paysFromRequest(check) {
  return Boolean(check?.body) && payReading(check).source === 'request';
}

/**
 * The reading of a payout signed from the game's own code: the function around the signing call in a server file
 * (`bare`: its code alone; `code`: the same with literals kept; `open`: where the call's arguments open), read by the
 * usual names. Given the file's name `f` and the server's files ([{f, text}]), the game's own functions it calls are
 * followed as PAY.check's are, three calls deep (a database helper it reads state through, a rule in another file).
 */
export function siteReading(bare, code, open, { f = null, files = [] } = {}) {
  const made = new Map();
  const fileAt = name => {
    if (!made.has(name)) {
      const raw = files.find(x => x.f === name);
      made.set(name, raw ? fileOf(name, raw.text) : null);
    }
    return made.get(name);
  };
  const home = (f && fileAt(f)) || { bare, code, defs: [], imports: new Map(), top: new Set() };
  const def = around(bare, open) ?? { name: null, params: '', body: bare, start: 0 };
  const p = piece(home, def, new Map(Object.entries(USUAL)));
  p.written = playerWrittenIn(files);
  const close = closing(bare, open);
  const within = [open + 1 - def.start, (close < 0 ? open + 1 : close) - def.start];
  return reading(reach(p, f ? fileAt : () => null), { within });
}

const FETCH_HANDLER = /\b(?:async\s+)?fetch\s*(?::\s*(?:async\s*)?(?:function\s*)?)?\(([^()]*)\)\s*(?:=>\s*)?\{/g;
/** The innermost function (or fetch handler) around `at` in code alone: {name, params, body, start}, or null. */
export function around(code, at) {
  const defs = definitions(code);
  for (const m of code.matchAll(FETCH_HANDLER)) {
    const start = m.index + m[0].length - 1;
    const body = braced(code, start);
    if (body) defs.push({ name: 'fetch', params: m[1], body, start });
  }
  let best = null;
  for (const d of defs)
    if (d.start <= at && at < d.start + d.body.length && (!best || d.body.length < best.body.length)) best = d;
  return best;
}

/** A regex's or a string's text from `api/` on, as the paths it names: `(a|b)` spread, `\/?$` and the like dropped. */
function routesIn(fragment) {
  const text = fragment.replace(/\\\//g, '/').replace(/\/\?\$?$|\$$/, '');
  const group = /\(\?:?([\w|-]+)\)|\(([\w|-]+)\)/.exec(text);
  const spread = group
    ? (group[1] ?? group[2])
        .split('|')
        .map(w => text.slice(0, group.index) + w + text.slice(group.index + group[0].length))
    : [text];
  return spread
    .map(r => r.replace(/[/?$]+$/, ''))
    .filter(r => /^api(\/[\w-]+)+$/.test(r) || r === 'api')
    .filter(r => r !== 'api');
}

/**
 * The api/ routes a file's code names: in strings, template literals (up to the first `${`) and regex literals
 * (`/\/api\/tide\/(start|found)\/?$/`), and the page's `gf.api('vouchers/pay')`. Comments are left out. → [path]
 */
export function apiRoutes(code) {
  const c = withoutComments(code);
  const out = new Set();
  for (const m of c.matchAll(/(?:\\?\/|['"`])(api(?:\\?\/[\w|()?:-]+)+(?:\\?\/)?\??\$?)/g))
    for (const r of routesIn(m[1].replace(/\$\{.*$/, ''))) out.add(r);
  for (const m of c.matchAll(/\.api\(\s*['"`]([\w-]+(?:\/[\w-]+)*)/g)) out.add(`api/${m[1]}`);
  return [...out];
}

/** A name's words: split at - _ . / @ and at CamelCase, lower case. */
export const wordsOfName = s =>
  String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
