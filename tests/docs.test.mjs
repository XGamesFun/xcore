// The guidance an agent reads (skills/bring-your-own-game: SKILL.md and its references; docs/BEFORE-YOU-BUILD.md) held
// to the command line it describes: a size budget on the skill, every `xcore <command>` and every --flag it names
// real, every "<N> invariants"-style count matching its list, every link there, and no tool of the unreleased kit.
// The reference a person reads (README.md and docs/) is held to the same commands and flags, and its links to the
// files and headings they name.
// And facts every document is held to: a command that asks for `--yes <code>` is one the skill says to ask the person
// about, an address given to `xcore backend use custom` is one the command takes, and docs/SERVER.md names every
// env.GF call a game's server gets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { backendOrigin } from '../lib/publish/scan.mjs';
import { PLAN_LIMITS } from '../lib/server/contract.mjs';
import { ROOT } from './helpers.mjs';

const SKILL_DIR = path.join(ROOT, 'skills', 'bring-your-own-game');
const SKILL = path.join(SKILL_DIR, 'SKILL.md');
const DOCS = [
  SKILL,
  ...readdirSync(path.join(SKILL_DIR, 'references'))
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(SKILL_DIR, 'references', f)),
  path.join(ROOT, 'docs', 'BEFORE-YOU-BUILD.md'),
];
/** README.md and the reference in docs/, which the README links to. */
const REFERENCE = [
  path.join(ROOT, 'README.md'),
  ...readdirSync(path.join(ROOT, 'docs'))
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(ROOT, 'docs', f)),
];
const read = file => readFileSync(file, 'utf8');
const rel = file => path.relative(ROOT, file);

/** The commands, by name: {usage, helpFor}. */
async function commands() {
  const all = new Map();
  for (const f of readdirSync(path.join(ROOT, 'commands')).filter(f => f.endsWith('.mjs'))) {
    const c = (await import(pathToFileURL(path.join(ROOT, 'commands', f)).href)).default;
    if (c?.name) all.set(c.name, c);
  }
  return all;
}
/** A command's help for these arguments, as `xcore <command> <args> --help` prints it. */
const helpOf = (c, args = []) => `${c.usage ?? ''}\n${c.helpFor?.(args) ?? ''}`;
/** The economy tools' own help (xcore loot hands everything else to them). */
const xsolanaHelp = () => read(path.join(ROOT, 'node_modules', '@xgamesfun', 'solana', 'bin', 'xsolana.mjs'));
const GLOBAL = new Set(['--json', '--help']);
/** What `xcore` itself takes in place of a command (bin/xcore.mjs). */
const TOP_LEVEL = new Set(['--help', '-h', 'help', '--version', '-v']);

test('the skill keeps to its budget: at most 15,000 characters, well under 300 lines', () => {
  const text = read(SKILL);
  assert.ok(text.length <= 15_000, `SKILL.md is ${text.length} characters`);
  assert.ok(text.split('\n').length <= 200, `SKILL.md is ${text.split('\n').length} lines`);
});

test('no tool or command of the unreleased game kit is named', () => {
  for (const file of DOCS) {
    const found = read(file).match(/gamesfun_\w+|backend connect/);
    assert.equal(found, null, `${rel(file)} names ${found?.[0]}`);
  }
});

test('every `xcore <command>`, its subcommand and every --flag named is in the command line', async () => {
  const all = await commands();
  const everyHelp = [...all.values()].map(c => helpOf(c)).join('\n') + xsolanaHelp();
  const problems = [];
  for (const file of new Set([...DOCS, ...REFERENCE])) {
    for (const [, span] of read(file).matchAll(/`([^`]+)`/g)) {
      const words = span.trim().split(/\s+/);
      if (words[0] === 'xcore' && (!words[1] || words[1].startsWith('<'))) continue; // `xcore <command>`
      if (words[0] === 'xcore' && words.length === 2 && TOP_LEVEL.has(words[1])) continue; // `xcore --version`
      const named = words[0] === 'xcore' ? words[1] : all.has(words[0]) ? words[0] : null;
      if (words[0] === 'xcore' && !all.has(named)) {
        problems.push(`${rel(file)}: \`${span}\` names no command "${named}"`);
        continue;
      }
      const rest = named ? words.slice(words.indexOf(named) + 1) : [];
      let help = named ? helpOf(all.get(named), rest) : everyHelp;
      if (named === 'loot') help += xsolanaHelp();
      // its subcommand (`db query`, `add signin|database`), when the word after the command is one
      const sub = rest[0];
      if (named && sub && /^[a-z][\w|-]*$/.test(sub))
        for (const s of sub.split('|'))
          if (!new RegExp(`(^|[\\s|\\[(])${s}([\\s|\\])]|$)`, 'm').test(help))
            problems.push(`${rel(file)}: \`${span}\`: ${named} has no "${s}"`);
      for (const [flag] of span.matchAll(/--[a-z][\w-]*/g))
        if (!GLOBAL.has(flag) && !new RegExp(`${flag}(?![\\w-])`).test(help))
          problems.push(`${rel(file)}: \`${span}\`: ${flag} is not in ${named ? `${named}'s help` : 'any help'}`);
    }
  }
  assert.deepEqual(problems, []);
});

const NUMBERS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const COUNTED = new RegExp(`\\b(${Object.keys(NUMBERS).join('|')}) ([a-z]+s)\\b`, 'gi');
/** The top-level items of the first list at or after line `from` (before the next heading). */
function listAfter(lines, from, { heading }) {
  let i = from;
  for (; i < lines.length; i++) {
    if (/^#/.test(lines[i])) return null;
    if (/^(- |\d+\. )/.test(lines[i])) break;
    // after a line ending in a colon the list comes next, or it is not that line's list
    if (!heading && lines[i].trim()) return null;
  }
  let n = 0;
  for (; i < lines.length && lines[i].trim() && !/^#/.test(lines[i]); i++) if (/^(- |\d+\. )/.test(lines[i])) n++;
  return n || null;
}

test('a count in the guidance ("Four invariants", "the six lenses") matches the list it names', () => {
  const defined = new Map(),
    mentions = [];
  for (const file of DOCS) {
    const text = read(file);
    const lines = text.split('\n');
    lines.forEach((line, at) => {
      for (const m of line.matchAll(COUNTED)) {
        const n = NUMBERS[m[1].toLowerCase()],
          noun = m[2].toLowerCase();
        mentions.push({ n, noun, where: `${rel(file)}:${at + 1}` });
        // a heading that names the count, or a line that ends in a colon: the list under it
        const heading = /^#/.test(line);
        let items = heading || /:\s*$/.test(line) ? listAfter(lines, at + 1, { heading }) : null;
        // or the list in the same sentence: after its colon, items split by semicolons
        if (items === null) {
          const sentence = text.slice(text.indexOf(line) + m.index).split(/\.(\s|$)/)[0];
          const after = sentence.split(': ').slice(1).join(': ');
          if (after.includes(';')) items = after.split(';').length;
        }
        if (items !== null) {
          assert.equal(items, n, `${rel(file)}:${at + 1} says ${m[0]} and lists ${items}`);
          defined.set(noun, n);
        }
      }
    });
  }
  for (const noun of ['invariants', 'lenses']) assert.ok(defined.has(noun), `the ${noun} are listed somewhere`);
  for (const { n, noun, where } of mentions)
    if (defined.has(noun))
      assert.equal(n, defined.get(noun), `${where}: ${n} ${noun}, but ${defined.get(noun)} listed`);
});

test('every link in the skill and its references leads to a file', () => {
  for (const file of DOCS)
    for (const [, target] of read(file).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (/^[a-z]+:/.test(target)) continue;
      assert.ok(existsSync(path.resolve(path.dirname(file), target)), `${rel(file)} links to ${target}`);
    }
});

/** A heading's anchor as GitHub makes it: lower case, punctuation gone, spaces to hyphens. */
const slug = heading =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
/** The anchors of a Markdown file's headings (outside code blocks), with GitHub's -1, -2 for a repeated one. */
function anchorsOf(text) {
  const seen = new Map();
  const anchors = new Set();
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const h = !fenced && /^#{1,6}\s+(.*)$/.exec(line);
    if (!h) continue;
    const base = slug(h[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n ? `${base}-${n}` : base);
  }
  return anchors;
}

test('every link in README.md and docs/ leads to a file, and every #anchor to a heading in it', () => {
  const problems = [];
  for (const file of REFERENCE)
    for (const [, target, anchor] of read(file).matchAll(/\]\(([^)#\s]*)(?:#([^)\s]*))?\)/g)) {
      if (/^[a-z]+:/.test(target)) continue;
      const to = target ? path.resolve(path.dirname(file), target) : file;
      if (!existsSync(to)) problems.push(`${rel(file)} links to ${target}`);
      else if (anchor && to.endsWith('.md') && !anchorsOf(read(to)).has(anchor))
        problems.push(`${rel(file)} links to ${target}#${anchor}, a heading ${rel(to)} does not have`);
    }
  assert.deepEqual(problems, []);
});

test('every command that goes on only with --yes <code> is in the skill’s list of what needs the person’s yes', async () => {
  const consent = read(SKILL)
    .split('\n- ')
    .find(item => item.startsWith("**Consent where it can't be undone.**"));
  assert.ok(consent, 'the skill has its consent invariant');
  assert.match(consent, /Everything\s+else\s+is\s+reversible/, 'which says the rest can be undone');
  const gated = [];
  for (const [name, c] of await commands()) {
    // each form of the command in its usage block (`xcore db import <file.sql> [dir] [--live [--yes <code>]]`), with
    // the lines it runs on to
    const forms = [];
    for (const line of String(c.usage ?? '')
      .split('\n\n')[0]
      .split('\n'))
      if (/^(Usage:)?\s+xcore /.test(line)) forms.push(line);
      else if (forms.length) forms[forms.length - 1] += ` ${line.trim()}`;
    for (const form of forms.filter(f => f.includes('--yes'))) {
      const sub = form
        .trim()
        .replace(/^Usage:\s*/, '')
        .split(/\s+/)[2];
      gated.push(/^[a-z]/.test(sub ?? '') ? `${name} ${sub}` : name);
    }
  }
  // (loot approve is the economy tools' own, and the skill names it beside these)
  assert.deepEqual(
    gated.filter(named => !consent.includes(`\`${named}`)),
    [],
    'a command that asks for a code and is not in the list',
  );
  for (const named of [
    'coin launch',
    'db query',
    'db import',
    'db restore',
    'secret set',
    'secret remove',
    'files put',
    'files remove',
  ])
    assert.ok(gated.includes(named), `${named} asks for a code`);
});

test('an address the documents give `xcore backend use custom` is one the command takes', () => {
  const files = [
    path.join(ROOT, 'README.md'),
    ...readdirSync(path.join(ROOT, 'docs')).map(f => path.join(ROOT, 'docs', f)),
    ...DOCS,
  ];
  let found = 0;
  for (const file of new Set(files))
    for (const [, address] of read(file).matchAll(/--(?:url|origin) ((?:https?|wss?):\/\/[^\s`\]>)]+)/g)) {
      found++;
      assert.doesNotThrow(() => backendOrigin(address), `${rel(file)}: ${address}`);
    }
  assert.ok(found >= 2, 'the documents show the command with an address');
});

test('every env.GF call a game’s server gets in xcore dev is in docs/SERVER.md’s table of them', () => {
  // the calls, as lib/dev/gf-local.js sends them to the dev host: 'saves.get', 'scores.list', 'info', …
  const calls = [
    ...read(path.join(ROOT, 'lib', 'dev', 'gf-local.js')).matchAll(/call\([^,]+, '([\w.]+)'|gf\.local\/([\w.]+)/g),
  ].map(m => m[1] ?? m[2]);
  assert.ok(calls.includes('scores.list') && calls.includes('verifyPlayer'), `the calls are read: ${calls}`);
  const server = read(path.join(ROOT, 'docs', 'SERVER.md'));
  const table = server
    .slice(server.indexOf('### `env.GF`, the platform'))
    .split('\n\n')
    .find(part => part.startsWith('| Call'));
  const rows = table.split('\n').map(row => row.split('|')[1] ?? '');
  const missing = [...new Set(calls)].filter(op => {
    const [area, method] = op.includes('.') ? op.split('.') : [null, op];
    return !rows.some(cell =>
      area ? cell.includes(`GF.${area}.`) && new RegExp(`\\.${method}\\(`).test(cell) : cell.includes(`GF.${method}(`),
    );
  });
  assert.deepEqual(missing, [], 'a call the table does not name');
});

test('every npx example names this version (scripts/pin-version.mjs pins them at a release)', async () => {
  const { PINNED_DOCS, NPX } = await import('../scripts/pin-version.mjs');
  const { version } = JSON.parse(read(path.join(ROOT, 'package.json')));
  const stale = [];
  for (const rel of PINNED_DOCS)
    for (const [m] of read(path.join(ROOT, rel)).matchAll(NPX))
      if (m !== `npx -y @xgamesfun/xcore@${version}`) stale.push(`${rel}: ${m}`);
  assert.deepEqual(stale, [], `run: node scripts/pin-version.mjs`);
});

/**
 * A fact a document must state, where a reader looks for it: the file, the part of it (from the heading or text that
 * starts it to the next heading of that level or higher, or the whole file), and what that part must say.
 */
function partOf(file, starts) {
  const text = read(path.join(ROOT, file));
  if (!starts) return text;
  const at = text.indexOf(starts);
  assert.ok(at >= 0, `${file} has "${starts}"`);
  const level = /^(#+) /.exec(starts)?.[1].length ?? 6;
  const rest = text.slice(at + starts.length);
  const end = rest.search(new RegExp(`\\n#{1,${level}} `));
  return starts + (end < 0 ? rest : rest.slice(0, end));
}
const said = (file, starts, ...patterns) => {
  const part = partOf(file, starts);
  return patterns.filter(p => !p.test(part)).map(p => `${file}${starts ? ` (${starts})` : ''} does not say ${p}`);
};

test('the Creator plan is paid by card, renewing, or prepaid in SOL or USDC, wherever its payment is described', () => {
  const both = [/by\s+card[^.]*\brenews\b/i, /SOL\s+or\s+USDC/, /spending\s+cap/i];
  const problems = [
    ...said('README.md', '## Costs', ...both),
    ...said('docs/FEES.md', '## Hosting', ...both, /Manage\s+billing/),
    ...said('docs/HOSTING.md', '### Paying for a Creator account and usage', ...both, /Manage\s+billing/),
  ];
  // and nothing says the plan is only ever prepaid and renewed by hand
  for (const file of REFERENCE)
    for (const line of read(file).split('\n'))
      if (/Renew manually|prepaid, SOL or USDC/.test(line)) problems.push(`${rel(file)}: ${line.trim()}`);
  assert.deepEqual(problems, []);
});

test('the hosting guide says where a post on X lands, and that Sign in there reloads the game', () => {
  assert.deepEqual(
    said(
      'docs/HOSTING.md',
      '### Inside the play page',
      /xgames\.fun\/play\/<slug>/,
      /card=player/,
      /Sign\s+in[^.]*reloads\s+the\s+game/,
      /stay:\s*true[^.]*does\s+not/,
    ),
    [],
  );
});

/**
 * The database's size on each plan: the contract's, once it states one, else xgames.fun's plan table (creator-studio
 * lib/plans.mjs, database.bytes), which caps a game past it.
 */
const DATABASE_BYTES = { free: 100 * 2 ** 20, creator: 2 * 2 ** 30, scale: 10 * 2 ** 30 };
const sizeWords = bytes => (bytes >= 2 ** 30 ? `${bytes / 2 ** 30} GB` : `${bytes / 2 ** 20} MB`);

test("each plan's database size is stated, and that a database past it stops the game's server", () => {
  const sizes = Object.keys(PLAN_LIMITS).map(plan =>
    sizeWords(PLAN_LIMITS[plan].database?.bytes ?? DATABASE_BYTES[plan]),
  );
  const row = (file, starts, name) =>
    partOf(file, starts)
      .split('\n')
      .find(line => line.startsWith(`| ${name}`) && /database/i.test(line)) ?? '';
  const problems = [];
  const hosting = row('docs/HOSTING.md', '## Plans: `xcore plan`', 'Database');
  if (!sizes.every(size => hosting.includes(size)))
    problems.push(`HOSTING.md's plan table: ${hosting || 'no Database row'}`);
  for (const [plan, size] of Object.keys(PLAN_LIMITS).map((p, i) => [p, sizes[i]])) {
    const line = row('docs/FEES.md', '## Hosting', plan[0].toUpperCase() + plan.slice(1) + ' ');
    if (!line.includes(`${size} database`)) problems.push(`FEES.md's ${plan} row: ${line}`);
  }
  problems.push(
    ...said('docs/HOSTING.md', '### When a game is capped', /database\s+is\s+past\s+its\s+plan's\s+size/),
    ...said('docs/SERVER.md', "## The game's database", /server\s+stopped/),
  );
  // a lapsed account's games keep running, except one whose database is over Free's size
  for (const file of REFERENCE)
    for (const part of read(file).split('\n\n'))
      if (/keeps? running at Free limits|moves? to Free limits/.test(part) && !/database/.test(part))
        problems.push(`${rel(file)}: ${part.trim().slice(0, 100)}`);
  assert.deepEqual(problems, []);
});

test('the console has one name, and the reference says what only the console does', () => {
  const problems = said(
    'docs/COMMANDS.md',
    '## What only the console does',
    /xgames\.fun\/console/,
    /Logs\s+tab/,
    /Make\s+live/,
    /Unpublish/,
    /Live\s+tab/,
  );
  problems.push(...said('README.md', '## Commands', /COMMANDS\.md#what-only-the-console-does/));
  // the console is "your console" (xgames.fun/console); Studio is xgames.fun's game builder, a place apart
  for (const file of REFERENCE)
    for (const [m] of read(file).matchAll(/creator console|Studio is your|your xgames\.fun Studio|in Studio\.?$/gim))
      problems.push(`${rel(file)}: "${m}"`);
  assert.deepEqual(problems, []);
});
