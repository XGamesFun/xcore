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
function closing(code, at) {
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
function parts(code, from, to) {
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
function expressionEnd(code, at) {
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
    if (!new RegExp(`^${NAME}$`).test(key)) continue;
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
  let body = false;
  const taken = at => p.taken.some(([a, b]) => a <= at && at < b);
  for (const m of p.bare.matchAll(new RegExp(`(?<![\\w$.])(${NAME})((?:\\s*\\??\\.\\s*${NAME})*)`, 'g'))) {
    let role = p.roles.get(m[1]);
    if (!role) continue;
    const after = p.bare.slice(m.index + m[0].length, m.index + m[0].length + 40).trimStart();
    // an object's own key ({ env: … }) is no use of the name
    if (!m[2] && /^:(?!:)/.test(after) && /[{,]\s*$/.test(p.bare.slice(Math.max(0, m.index - 40), m.index))) continue;
    const names = [...m[2].matchAll(new RegExp(NAME, 'g'))].map(x => x[0]);
    for (const name of names) role = prop(role, name);
    if (!role) {
      if (m[1] === 'this' && p.inClass) state.push(`this.${names[0]}`);
      continue;
    }
    if (role === 'body') body = true;
    else if (typeof role === 'string' && role[0] === '.') {
      const deep = role.indexOf('.', 1) > 0;
      if (!NOT_STATE.has(role) && (deep || /^(?:\?\.)?[([]/.test(after)))
        state.push(
          `env${role
            .split('.')
            .slice(0, role.startsWith('.GF.') ? 3 : 2)
            .join('.')}`,
        );
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
  return { state, handed, body };
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

/** Does an expression of a function come from the request: a name or member of the request's in it? */
function fromRequest(p, [a, b]) {
  const re = new RegExp(`(?<![\\w$.])(${NAME})((?:\\s*\\??\\.\\s*${NAME})*)`, 'g');
  for (const m of p.bare.slice(a, b).matchAll(re)) {
    let role = p.roles.get(m[1]);
    for (const name of m[2].matchAll(new RegExp(NAME, 'g'))) role = prop(role, name[0]);
    if (role === 'body' || role?.body) return true;
  }
  return false;
}

/** A name's value comes from the request: by its role, or by what it was last given (`wallet = body.wallet`). */
function nameFromRequest(p, name) {
  const role = p.roles.get(name);
  if (role) return role === 'body';
  const given = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\s*=(?![=>])`, 'g');
  return [...p.bare.matchAll(given)].some(m => {
    const from = m.index + m[0].length;
    return fromRequest(p, [from, expressionEnd(p.bare, from)]);
  });
}

/** How an entry of an object is filled: from the request, or by the code. */
const filled = (p, e, key) => (e.value ? fromRequest(p, e.value) : nameFromRequest(p, key));

/** A literal's own text where `bare` holds only its quotes: 'grant' for `'grant'`, or null when it is no literal. */
function literal(p, [a, b]) {
  const t = p.text.slice(a, b).trim();
  if (/^\d+$/.test(t)) return t;
  return /^(['"`])[^'"`$\\]*\1$/.test(t) && /^(['"`])\s*\1$/.test(p.bare.slice(a, b).trim()) ? t.slice(1, -1) : null;
}

/**
 * What each object a function writes out says it pays: [{grant, amount, recipient}] for each that names a grant (or,
 * with `within`, a span of the function's own, each that names a grant, a wallet, winners or an amount there).
 * grant: its key or id when written as a literal, else null (worked out as it runs: any grant). amount: 'grant' the
 * grant's own, 'request' from the request, 'server' the code's, null when not named. recipient: 'request' a wallet (or
 * winners) the request names, 'check' one the code names, 'proven' when none is named.
 */
function answersIn(p, within = null) {
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
    const [grant] = inside('grant');
    const [amount] = inside('amount');
    const who = [...inside('wallet').map(e => [e, 'wallet']), ...inside('winners').map(e => [e, 'winners'])];
    return {
      grant: grant?.value ? literal(p, grant.value) : null,
      amount: !amount
        ? null
        : amount.value && literal(p, amount.value) === 'grant'
          ? 'grant'
          : filled(p, amount, 'amount')
            ? 'request'
            : 'server',
      recipient: !who.length ? 'proven' : who.some(([e, key]) => filled(p, e, key)) ? 'request' : 'check',
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
  const body = used.some(u => u.body);
  let answers = pieces.flatMap(p => answersIn(p));
  if (within) {
    answers = answersIn(pieces[0], within);
    if (!answers.length) answers = answersIn(pieces[0], [0, pieces[0].bare.length]);
  }
  const kept = state.length > 0 || handed.length > 0;
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
  return {
    source,
    decides: source === 'request' ? (body ? 'body' : 'sign-in') : null,
    seen: state.length
      ? `it uses ${state.slice(0, 2).join(' and ')}`
      : handed.length
        ? `it hands env ${named.length ? `to ${named.slice(0, 2).join(' and ')}, which this review did not read` : 'on to code this review did not read'}`
        : null,
    assumed: !state.length && handed.length > 0,
    unread: source === 'unreadable' ? through : !state.length ? named : [],
    answers,
  };
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
 * usual names.
 */
export function siteReading(bare, code, open) {
  const def = around(bare, open) ?? { name: null, params: '', body: bare, start: 0 };
  const p = piece({ bare, code, defs: [], imports: new Map(), top: new Set() }, def, new Map(Object.entries(USUAL)));
  const close = closing(bare, open);
  const within = [open + 1 - def.start, (close < 0 ? open + 1 : close) - def.start];
  declare(p);
  p.calls = callsIn(p);
  return reading([p], { within });
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
