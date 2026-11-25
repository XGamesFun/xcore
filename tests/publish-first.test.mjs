// The first publish of a folder makes a new game on the signed-in account, which counts toward its games: it prints
// the account, the game and where it goes (a free slot, or the Creator account's games), and goes on only with the
// code it printed (or "publish" typed at a terminal). An account with no room is told so before anything is
// uploaded. A folder already linked to a game publishes with no question.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { adopt } from '../lib/publish/adopt.mjs';
import { newGameWords, slotWords } from '../lib/publish/first.mjs';
import { fixture, runAsync, signIn, standIn, tempDir } from './helpers.mjs';

test('the slot a new game takes, in words', () => {
  assert.equal(slotWords(null), null);
  assert.equal(
    slotWords({ gameSlots: { free: { slots: 2, used: 1 } } }),
    'one of your 2 free slots (1 in use now, 2 after this)',
  );
  assert.match(slotWords({ gameSlots: { free: { slots: 2, used: 2 } } }), /^none: all 2 free slots are in use/);
});

test('where a new game goes, in words: a Free account, a Creator account, either at its cap, and an older xgames.fun', () => {
  const account = (tier, gamesUsed, gameCap) => ({ account: { tier, gamesUsed, gameCap, priceCents: 1500 } });
  assert.equal(newGameWords(null), null);
  // an xgames.fun without accounts: its slots, as before
  assert.deepEqual(newGameWords({ gameSlots: { free: { slots: 2, used: 0 } } }), {
    label: 'slot',
    words: 'one of your 2 free slots (0 in use now, 1 after this)',
    full: null,
  });
  // Free keeps the slot's words
  assert.deepEqual(newGameWords(account('free', 1, 2)), {
    label: 'slot',
    words: 'one of your 2 free slots (1 in use now, 2 after this)',
    full: null,
  });
  assert.deepEqual(newGameWords(account('creator', 3, 10)), {
    label: 'plan',
    words: 'your Creator account (3 of 10 games now, 4 after this)',
    full: null,
  });
  // at the cap: said plainly, as the refusal to stop with
  const free = newGameWords(account('free', 2, 2), { origin: 'https://xgames.fun' });
  assert.match(free.words, /^none: all 2 free slots are in use/);
  assert.match(
    free.full,
    /^Your Free account has all 2 of its games, so xgames.fun would refuse a new one\. Archive a game you no longer need on https:\/\/xgames\.fun\/console \(unpublish it first\), or buy a Creator account there .*Nothing was uploaded\.$/,
  );
  const creator = newGameWords(account('creator', 10, 10));
  assert.equal(creator.label, 'plan');
  assert.match(creator.full, /^Your Creator account has all 10 of its games, so xgames.fun would refuse a new one\./);
  assert.doesNotMatch(creator.full, /buy/);
});

test('a first publish on a Creator account names the account; at the cap it stops before uploading anything', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  await signIn(g, env);
  let account = { tier: 'creator', gameCap: 10, gamesUsed: 3, priceCents: 1500, includedCents: 1000 };
  g.state.handle = (method, url) =>
    method === 'GET' && url === '/api/kit/plan'
      ? [200, { ok: true, gameSlots: { free: { slots: 2, used: 0 }, paid: { slots: 0, used: 0 } }, account }]
      : null;
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  const cli = { env: { ...env, GAMESFUN_STUDIO: g.origin } };

  const asked = await runAsync(['publish', dir, '--no-card'], cli);
  assert.equal(asked.status, 0, asked.stderr);
  assert.match(asked.stdout, /\n {2}plan: {4}your Creator account \(3 of 10 games now, 4 after this\)\n/);
  assert.doesNotMatch(asked.stdout, /slot/);
  const planned = JSON.parse((await runAsync(['publish', dir, '--no-card', '--json'], cli)).stdout);
  assert.deepEqual(
    [planned.plan.tier, planned.plan.slot],
    ['creator', 'your Creator account (3 of 10 games now, 4 after this)'],
  );

  // xgames.fun refuses the new game itself (its count moved since): 409 game-cap, said in the same words
  g.state.refuse = {
    at: 'begin',
    status: 409,
    body: {
      error: 'Your Creator account runs up to 10 games, and all 10 are in use. Archive a game you no longer need.',
      code: 'game-cap',
    },
  };
  const theirs = await runAsync(['publish', dir, '--no-card', '--yes', planned.code], cli);
  assert.equal(theirs.status, 1);
  assert.match(
    theirs.stderr,
    /Your Creator account has all 10 of its games, so xgames.fun would refuse a new one\. Archive a game you no longer need on http:\/\/127\.0\.0\.1:\d+\/console \(unpublish it first\), then publish again, or write to xgames.fun for more\. No game was made\./,
  );
  const theirsJson = JSON.parse(
    (await runAsync(['publish', dir, '--no-card', '--yes', planned.code, '--json'], cli)).stdout,
  );
  assert.deepEqual([theirsJson.ok, theirsJson.code], [false, 'game-cap']);
  assert.match(theirsJson.next, / plan --all$/);
  g.state.refuse = undefined;

  // at the cap: refused here, with the code too, and nothing is sent
  account = { ...account, gamesUsed: 10 };
  const sent = g.state.calls.length;
  for (const extra of [[], ['--yes', planned.code]]) {
    const full = await runAsync(['publish', dir, '--no-card', ...extra], cli);
    assert.equal(full.status, 1);
    assert.match(full.stderr, /Your Creator account has all 10 of its games, so xgames.fun would refuse a new one\./);
    assert.match(full.stderr, /Nothing was uploaded\./);
  }
  const json = JSON.parse((await runAsync(['publish', dir, '--no-card', '--json'], cli)).stdout);
  assert.deepEqual([json.ok, json.code], [false, 'game-cap']);
  assert.match(json.next, / plan --all$/);
  assert.equal(g.state.published, undefined, 'no game was made');
  assert.ok(
    g.state.calls.slice(sent).every(c => /^GET \/api\/kit\/(me|plan)\b/.test(c)),
    g.state.calls.slice(sent).join('\n'),
  );

  // a Free account at its 2: the same, with the way to more
  account = { tier: 'free', gameCap: 2, gamesUsed: 2, priceCents: 1500, includedCents: 100 };
  const free = await runAsync(['publish', dir, '--no-card'], cli);
  assert.equal(free.status, 1);
  assert.match(free.stderr, /Your Free account has all 2 of its games.*buy a Creator account/);
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
