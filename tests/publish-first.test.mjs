// The first publish of a folder makes a new game on the signed-in account and takes a slot: it prints the account,
// the game and the slot, and goes on only with the code it printed (or "publish" typed at a terminal). A folder
// already linked to a game publishes with no question.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { adopt } from '../lib/publish/adopt.mjs';
import { slotWords } from '../lib/publish/first.mjs';
import { fixture, runAsync, signIn, standIn, tempDir } from './helpers.mjs';

test('the slot a new game takes, in words', () => {
  assert.equal(slotWords(null), null);
  assert.equal(
    slotWords({ gameSlots: { free: { slots: 2, used: 1 } } }),
    'one of your 2 free slots (1 in use now, 2 after this)',
  );
  assert.match(slotWords({ gameSlots: { free: { slots: 2, used: 2 } } }), /^none: all 2 free slots are in use/);
});

test('a first publish asks first: account, game and slot; the code goes on; a linked folder is not asked', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  await signIn(g, env);
  g.state.handle = (method, url) =>
    method === 'GET' && url === '/api/kit/plan'
      ? [200, { ok: true, gameSlots: { free: { slots: 2, used: 1 }, paid: { slots: 0, used: 0 } } }]
      : null;
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  const cli = { env: { ...env, GAMESFUN_STUDIO: g.origin } };

  // without a terminal and without the code: the printout, and nothing made
  const asked = await runAsync(['publish', dir, '--no-card'], cli);
  assert.equal(asked.status, 0, asked.stderr);
  assert.match(asked.stdout, /This creates a new game on http:\/\/127\.0\.0\.1:\d+:/);
  assert.match(asked.stdout, /account: alice@example\.com/);
  assert.match(asked.stdout, /game: {4}“Dot Catch” \(from the folder static\)/);
  assert.match(asked.stdout, /slot: {4}one of your 2 free slots \(1 in use now, 2 after this\)/);
  assert.match(
    asked.stdout,
    /Nothing was published\. To go on, run this again with the code:\n {2}.* publish .* --yes [0-9a-f]{8}$/m,
  );
  assert.equal(g.state.published, undefined, 'no game was made');

  const planned = JSON.parse((await runAsync(['publish', dir, '--no-card', '--json'], cli)).stdout);
  assert.deepEqual([planned.ok, planned.planned, planned.plan.account], [true, true, 'alice@example.com']);
  assert.match(planned.next, / --yes [0-9a-f]{8}$/);

  // another code is refused; the printed one publishes
  const wrong = await runAsync(['publish', dir, '--no-card', '--yes', '00000000'], cli);
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /That code is not for this change/);
  assert.equal(g.state.published, undefined);
  const done = await runAsync(['publish', dir, '--no-card', '--yes', planned.code], cli);
  assert.equal(done.status, 0, done.stderr);
  assert.ok(g.state.published, 'published');

  // linked now: publishing again asks nothing
  g.state.published = undefined;
  const again = await runAsync(['publish', dir, '--no-card'], cli);
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /This creates a new game/);
  assert.ok(g.state.published);
  // --new makes another game: asked again
  const fresh = await runAsync(['publish', dir, '--no-card', '--new'], cli);
  assert.match(fresh.stdout, /This creates a new game/);
});
