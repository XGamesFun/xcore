// What an audit of xcore's own code found (2026-11-22): the check and dev host serving what publish leaves out, the dev
// sign-in with no person, .dev.vars staged in a repository the game sits in, and review's word on a grant's issuer
// among several keys and on a grant capped only by its tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { addVouchers } from '../lib/add.mjs';
import { createPlatformStore } from '../lib/dev/platform.mjs';
import { payoutCeiling, payoutFindings, payoutLedger } from '../lib/review.mjs';
import { buildTree } from '../lib/publish/tree.mjs';
import { ROOT, tempDir } from './helpers.mjs';

test('the check and the dev host leave out what publish leaves out, so a page that loads it fails there too', async t => {
  const { servePage } = await import('../lib/check.mjs');
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  await mkdir(path.join(tmp.dir, 'node_modules/three'), { recursive: true });
  await writeFile(path.join(tmp.dir, 'node_modules/three/three.js'), 'export {};');
  await writeFile(path.join(tmp.dir, 'README.md'), 'notes');
  await writeFile(path.join(tmp.dir, 'index.html'), '<!doctype html><title>x</title>');
  await mkdir(path.join(tmp.dir, 'levels'), { recursive: true });
  await writeFile(path.join(tmp.dir, 'levels/README.md'), 'a level’s notes, published');
  const site = await servePage(tmp.dir);
  t.after(site.close);
  const published = (await buildTree(tmp.dir)).tree.files.map(f => f.path);
  for (const p of ['node_modules/three/three.js', 'README.md', 'index.html', 'levels/README.md'])
    assert.equal((await fetch(`${site.url}${p}`)).status === 200, published.includes(p), p);
});

test('a local player stands in for one signed in with X, so a grant that counts people can be tried under xcore dev', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const store = createPlatformStore({ dir: tmp.dir, slug: 'g' });
  const { token, player } = store.devToken({ id: 'tab1abc' });
  const v = await store.verifyPlayer(token);
  assert.equal(v.x?.id, 'dev:tab1abc');
  assert.equal(player.x?.id, v.x.id);
  // XCORE_DEV_SIGNIN=wallet: a player with no X account, to try what they meet
  process.env.XCORE_DEV_SIGNIN = 'wallet';
  t.after(() => delete process.env.XCORE_DEV_SIGNIN);
  assert.equal((await store.verifyPlayer(store.devToken({ id: 'tab2abc' }).token)).x, null);
});

test('add vouchers keeps .dev.vars out of a repository the game sits in, not only one of its own', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  execFileSync('git', ['init', '-q'], { cwd: tmp.dir });
  const dir = path.join(tmp.dir, 'games', 'mine');
  await cp(path.join(ROOT, 'tests/fixtures/byo/static'), dir, { recursive: true });
  await writeFile(path.join(dir, 'xsolana.json'), JSON.stringify({ grants: [{ key: 'clear', id: 0 }] }));
  await addVouchers(dir);
  execFileSync('git', ['add', '-A'], { cwd: tmp.dir });
  const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: tmp.dir, encoding: 'utf8' });
  assert.doesNotMatch(staged, /\.dev\.vars/);
  assert.match(staged, /games\/mine\/\.gitignore/);
});

test('review asks which key is the issuer when a grant that counts people names several, and counts a cap on tokens', () => {
  const KEEPER = 'Kee1111111111111111111111111111111111111111';
  const LIVE = 'Liv1111111111111111111111111111111111111111';
  const site = {
    signer: 'server',
    where: 'server/vouchers.js',
    payOnly: 'x',
    source: 'env',
    amount: 'grant',
    recipient: 'proven',
  };
  const cases = (vouchers, issuer) =>
    payoutFindings(
      payoutLedger(
        {
          keys: { issuer },
          grants: [{ key: 'clear', id: 1, vouchers, trust: 'decides', limits: { perPerson: 1, perDay: 100 } }],
        },
        { sites: [site] },
      ),
      { available: true },
    ).flatMap(f => f.cases ?? []);
  assert.ok(cases([LIVE], KEEPER).includes('issuer'));
  assert.ok(cases([KEEPER, LIVE], KEEPER).includes('issuer-which'));
  assert.ok(!cases([LIVE], LIVE).some(c => c.startsWith('issuer')));
  const capped = payoutCeiling({ tokens: 1000 });
  assert.equal(capped.bounded, true);
  assert.match(capped.words, /1000 base units of its token in all/);
});
