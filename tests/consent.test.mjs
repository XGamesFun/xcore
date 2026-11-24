// The step before a change on xgames.fun that can't be undone (lib/consent.mjs), as `xcore db`, `xcore secret` and
// `xcore files` take it: the change's code, the printout and the command that goes on, the word a person at a terminal
// may type, and the refusal of a code made for another change. The commands' own tests run it as a person does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { changeCode, codeMatches, consented, sameCommand } from '../lib/consent.mjs';

const plan = { action: 'delete', origin: 'https://xgames.fun', game: 'g1', path: 'art/hero.png' };
const code = changeCode(Object.values(plan));

/** The step for `plan`, with what it printed. `typed`: what a person at a terminal types (none: no terminal). */
async function step(t, { yes, word = null, typed } = {}) {
  const printed = [];
  t.mock.method(console, 'log', line => printed.push(line));
  const stdin = Object.assign(new PassThrough(), { isTTY: typed !== undefined }),
    stderr = new PassThrough();
  if (typed !== undefined) stdin.write(`${typed}\n`);
  const went = await consented({
    sub: 'files',
    args: ['rm', 'art/hero.png', '--live'],
    values: yes === undefined ? {} : { yes },
    plan,
    lines: ['This deletes art/hero.png.'],
    nothing: 'Nothing was deleted',
    word,
    stdin,
    stderr,
  }).finally(() => console.log.mock.restore());
  return { went, printed: printed.join('\n'), asked: String(stderr.read() ?? '') };
}

test('a change’s code: eight hex digits over its parts, another for a change that differs in any of them', () => {
  assert.match(code, /^[0-9a-f]{8}$/);
  assert.equal(changeCode(Object.values({ ...plan })), code, 'the same change, the same code');
  for (const [part, other] of Object.entries({ action: 'replace', origin: 'https://x.test', game: 'g2', path: 'a' }))
    assert.notEqual(changeCode(Object.values({ ...plan, [part]: other })), code, part);
  assert.ok(codeMatches(` ${code.toUpperCase()}\n`, code), 'as a person pastes it');
  for (const no of [undefined, '', 'yes', 'true', code.slice(0, 7), `${code}0`]) assert.ok(!codeMatches(no, code), no);
  assert.match(
    sameCommand('files', ['rm', 'art/hero.png', '--live', '--yes', 'abc', '--json', '--yes=abc']),
    / files rm art\/hero\.png --live$/,
    'the command again, without a code or --json',
  );
});

test('with no code the change is printed with its code and the command that goes on, and it stops there', async t => {
  const r = await step(t);
  assert.equal(r.went, 0);
  assert.match(
    r.printed,
    new RegExp(
      `^This deletes art/hero\\.png\\.\\nNothing was deleted\\. To go on, run this again with the code:\\n {2}.* files rm art/hero\\.png --live --yes ${code}$`,
    ),
  );
  assert.equal(r.asked, '', 'nobody is asked anything');
});

test('with its code the change goes on; a code made for another change is refused', async t => {
  assert.deepEqual(await step(t, { yes: code }), { went: true, printed: '', asked: '' });
  await assert.rejects(step(t, { yes: changeCode(Object.values({ ...plan, path: 'art/old.png' })) }), {
    code: 'code',
    message: /^That code is not for this change: .* Run it without --yes, read what it prints/,
  });
});

test('a command that names a word: at a terminal the person types it to go on, and anything else stops it', async t => {
  const yes = await step(t, { word: 'delete', typed: ' Delete ' });
  assert.equal(yes.went, true);
  assert.equal(yes.printed, 'This deletes art/hero.png.');
  assert.equal(
    yes.asked,
    `Type delete to go on (or run it again with --yes ${code}), anything else to stop: `,
    'asked on stderr, so the printout stays the output',
  );
  for (const typed of ['y', 'yes', '', code]) {
    const no = await step(t, { word: 'delete', typed });
    assert.deepEqual([no.went, no.printed], [1, 'This deletes art/hero.png.\nNothing was deleted.'], typed);
  }
  // a script or an agent has no terminal, and a command that names no word asks nobody: both get the printout
  for (const how of [{ word: 'delete' }, { typed: 'delete' }]) {
    const r = await step(t, how);
    assert.equal(r.went, 0);
    assert.match(r.printed, new RegExp(`To go on, run this again with the code:\\n .* --yes ${code}$`));
    assert.equal(r.asked, '');
  }
});
