// The step before a change on xgames.fun that can't be undone (lib/consent.mjs), as `xcore db`, `xcore secret`,
// `xcore files` and a first publish take it: the printout with its code and the command that goes on, the word a person
// at a terminal may type, and the refusal of a code made for another change, used already, or run out. A code is
// random, so nothing about the change works out into it without the printout. The commands' own tests run it as a
// person does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { CODE_MINUTES, changeCode, consented, issueCode, sameCommand, takeCode } from '../lib/consent.mjs';
import { tempDir } from './helpers.mjs';

const plan = { action: 'delete', origin: 'https://xgames.fun', game: 'g1', path: 'art/hero.png' };

async function configDir(t) {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  return { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config') };
}

/** The step for `plan`, with what it printed. `typed`: what a person at a terminal types (none: no terminal). */
async function step(t, env, { yes, word = null, typed, json = false, of = plan, bind = null } = {}) {
  const printed = [];
  t.mock.method(console, 'log', line => printed.push(line));
  const stdin = Object.assign(new PassThrough(), { isTTY: typed !== undefined }),
    stderr = new PassThrough();
  if (typed !== undefined) stdin.write(`${typed}\n`);
  const went = await consented({
    sub: 'files',
    args: ['rm', 'art/hero.png', '--live'],
    values: { ...(yes === undefined ? {} : { yes }), ...(json ? { json: true } : {}) },
    plan: of,
    bind,
    lines: ['This deletes art/hero.png.'],
    nothing: 'Nothing was deleted',
    word,
    stdin,
    stderr,
    env,
  }).finally(() => console.log.mock.restore());
  const out = printed.join('\n');
  return { went, printed: out, asked: String(stderr.read() ?? ''), code: /--yes ([0-9a-f]{8})/.exec(out)?.[1] ?? null };
}

test('the command again without its code: as the person ran it, without --yes or --json', () => {
  assert.match(changeCode(Object.values(plan)), /^[0-9a-f]{8}$/);
  assert.match(
    sameCommand('files', ['rm', 'art/hero.png', '--live', '--yes', 'abc', '--json', '--yes=abc']),
    / files rm art\/hero\.png --live$/,
  );
});

test('with no code the change is printed with a new code and the command that goes on, and it stops there', async t => {
  const env = await configDir(t);
  const r = await step(t, env);
  assert.equal(r.went, 0);
  assert.match(
    r.printed,
    new RegExp(
      `^This deletes art/hero\\.png\\.\\nNothing was deleted\\. To go on, run this again with the code:\\n {2}.* files rm art/hero\\.png --live --yes [0-9a-f]{8}$`,
    ),
  );
  assert.equal(r.asked, '', 'nobody is asked anything');
  // a code is random: it is not the change's hash, so it cannot be worked out without the printout
  assert.notEqual(r.code, changeCode(Object.values(plan)));
  assert.notEqual((await step(t, env)).code, r.code, 'each printout its own code');
  // with --json the command that goes on is `confirm`, never `next` (which means "run this" everywhere else)
  const json = [];
  const write = t.mock.method(process.stdout, 'write', text => json.push(String(text)) > 0);
  await consented({
    sub: 'files',
    args: ['rm', 'x', '--live'],
    values: { json: true },
    plan,
    lines: [],
    nothing: '',
    env,
  });
  write.mock.restore();
  const answer = JSON.parse(json.join(''));
  assert.deepEqual([answer.ok, answer.planned, 'next' in answer], [true, true, false]);
  assert.match(answer.confirm, new RegExp(` files rm x --live --yes ${answer.code}$`));
});

test('its code goes on once; another change’s, a used one, a made-up one and one past its time are refused', async t => {
  const env = await configDir(t);
  const { code } = await step(t, env);
  assert.deepEqual(await step(t, env, { yes: ` ${code.toUpperCase()}\n` }), {
    went: true,
    printed: '',
    asked: '',
    code: null,
  });
  const refused = { code: 'code', message: /^That code is not for this change: .*used already.* Run it without --yes/ };
  await assert.rejects(step(t, env, { yes: code }), refused, 'used once already');
  // a code printed for another change
  const other = (await step(t, env, { of: { ...plan, path: 'art/old.png' } })).code;
  await assert.rejects(step(t, env, { yes: other }), refused);
  // the change's own hash, worked out offline, is no code
  await assert.rejects(step(t, env, { yes: changeCode(Object.values(plan)) }), refused);
  // a code past its time
  const old = issueCode(
    { change: Object.values(plan), bind: null },
    { env, now: Date.now() - (CODE_MINUTES + 1) * 60_000 },
  );
  await assert.rejects(step(t, env, { yes: old }), refused);
  // what binds it unprinted (a secret's value) must be the same too
  const bound = (await step(t, env, { bind: 'value one' })).code;
  await assert.rejects(step(t, env, { yes: bound, bind: 'value two' }), refused);
  assert.equal((await step(t, env, { yes: bound, bind: 'value one' })).went, true);
  // two printouts of one change: either code goes on, and using one uses both
  const [a, b] = [(await step(t, env)).code, (await step(t, env)).code];
  assert.equal(takeCode(b, { change: Object.values(plan), bind: null }, { env }), true);
  await assert.rejects(step(t, env, { yes: a }), refused);
});

test('a command that names a word: at a terminal the person types it to go on, and anything else stops it', async t => {
  const env = await configDir(t);
  const yes = await step(t, env, { word: 'delete', typed: ' Delete ' });
  assert.equal(yes.went, true);
  assert.equal(yes.printed, 'This deletes art/hero.png.');
  assert.match(
    yes.asked,
    /^Type delete to go on \(or run it again with --yes [0-9a-f]{8}\), anything else to stop: $/,
    'asked on stderr, so the printout stays the output',
  );
  for (const typed of ['y', 'yes', '']) {
    const no = await step(t, env, { word: 'delete', typed });
    assert.deepEqual([no.went, no.printed], [1, 'This deletes art/hero.png.\nNothing was deleted.'], typed);
  }
  // a script or an agent has no terminal, and a command that names no word asks nobody: both get the printout
  for (const how of [{ word: 'delete' }, { typed: 'delete' }]) {
    const r = await step(t, env, how);
    assert.equal(r.went, 0);
    assert.match(r.printed, /To go on, run this again with the code:\n .* --yes [0-9a-f]{8}$/);
    assert.equal(r.asked, '');
  }
});
