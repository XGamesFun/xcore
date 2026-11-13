// The guidance an agent reads (skills/bring-your-own-game: SKILL.md and its references; docs/BEFORE-YOU-BUILD.md) held
// to the command line it describes: a size budget on the skill, every `xcore <command>` and every --flag it names
// real, every "<N> invariants"-style count matching its list, every link there, and no tool of the unreleased kit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
  for (const file of DOCS) {
    for (const [, span] of read(file).matchAll(/`([^`]+)`/g)) {
      const words = span.trim().split(/\s+/);
      if (words[0] === 'xcore' && (!words[1] || words[1].startsWith('<'))) continue; // `xcore <command>`
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
