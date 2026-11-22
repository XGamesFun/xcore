// Publishing a brought game against a stand-in xgames.fun: sign in, the files and checks, only new files uploaded, the
// same link updated, a secret refused, sign out; a game the kit made is never published by this package alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adopt } from '../lib/publish/adopt.mjs';
import { credentialKey, logout, savedLogin } from '../lib/publish/client.mjs';
import { preflight, publishGame } from '../lib/publish/index.mjs';
import { buildTree } from '../lib/publish/tree.mjs';
import { fixture, passing, run, signIn, standIn, tempDir } from './helpers.mjs';

test('sign in, publish, update at the same link, a secret refused, sign out', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  assert.equal((await signIn(g, env)).email, 'alice@example.com');
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  const files = (await preflight(dir, { origin: g.origin })).built.tree.files.map(f => f.path);
  assert.deepEqual(
    files,
    ['adaptation-plan.json', 'foundation.lock.json', 'game.js', 'icon.svg', 'index.html', 'style.css'],
    'its own files and the two records publish adds; never gamesfun.json',
  );
  const one = await publishGame(dir, { origin: g.origin, env, check: passing });
  assert.equal(one.url, 'http://x/play/dot-catch');
  assert.equal(one.uploaded, files.length);
  assert.match(one.verify.kit, /^@xgamesfun\/xcore /);
  await writeFile(path.join(dir, 'game.js'), 'console.log("v2")');
  const two = await publishGame(dir, { origin: g.origin, env, check: passing });
  assert.equal(two.uploaded, 1, 'only the changed file goes up');
  assert.equal(two.version.number, 2);
  assert.equal(
    JSON.parse(await readFile(path.join(dir, '.gamesfun', 'publish.json'), 'utf8'))[g.origin].projectId,
    'g1',
  );
  await writeFile(path.join(dir, 'game.js'), 'const k = "sk_live_' + 'a'.repeat(24) + '";');
  await assert.rejects(publishGame(dir, { origin: g.origin, env, check: passing }), /Nothing was published|key/);
  assert.ok((await preflight(dir, { origin: g.origin })).hits.length >= 1);
  assert.deepEqual(await logout(g.origin, { env }), { revoked: true, forgot: true });
  assert.equal(await savedLogin(g.origin, { env }), null);
  await assert.rejects(publishGame(dir, { origin: g.origin, env, check: passing }), /Not signed in/);
});

test('a failing check goes up as a private draft only', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  await signIn(g, env);
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  const r = await publishGame(dir, {
    origin: g.origin,
    env,
    check: async () => ({
      pass: false,
      quick: true,
      passed: 3,
      ran: 4,
      failed: [{ n: 3, name: 'the page starts' }],
      started: new Date().toISOString(),
      run: 'x',
    }),
  });
  assert.equal(r.url, null);
  assert.equal(r.draft, true);
});

test('a game the kit made is refused here, before anything else: the kit checks it by its six gates', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = path.join(tmp.dir, 'made');
  await mkdir(dir);
  await writeFile(path.join(dir, 'index.html'), '<title>x</title>');
  await writeFile(path.join(dir, 'gf-three.json'), '{}');
  await assert.rejects(publishGame(dir, { env: {} }), e => e.code === 'kit');
  const r = run(['publish', dir, '--check']);
  assert.match(r.stderr, /kit/);
});

test('publish --check: the offline part, and the files it would send', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  const r = run(['publish', dir, '--check', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.files, 6);
});

test('a timeout on the last step says the game may be published, and publishing again updates the same game', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  await signIn(g, env);
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  g.state.completeStatus = 504;
  await assert.rejects(
    publishGame(dir, { origin: g.origin, env, check: passing, newGame: true }),
    e =>
      e.code === 'timeout' &&
      /may have gone through anyway[\s\S]*--status[\s\S]*updates this same game/.test(e.message),
  );
  const link = JSON.parse(await readFile(path.join(dir, '.gamesfun', 'publish.json'), 'utf8'))[g.origin];
  assert.equal(link.projectId, 'g1', 'the game is remembered as soon as xgames.fun made it');
  g.state.completeStatus = null;
  g.state.calls.length = 0;
  await publishGame(dir, { origin: g.origin, env, check: passing });
  assert.deepEqual(g.state.lastBegin?.projectId ?? g.state.beganWith, 'g1', 'the retry names the same game');
});

test("the sign-in's storage key never changes: 0.1.0 and the kit keep the token under it", () => {
  // renaming the platform to xgames.fun once changed it, which signed everyone out and orphaned their tokens
  assert.equal(credentialKey('https://xgames.fun'), 'games.fun https://xgames.fun');
});

test('programs, installers and archives are refused before anything is sent, as xgames.fun refuses them', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  await mkdir(path.join(dir, 'downloads'), { recursive: true });
  await writeFile(path.join(dir, 'downloads', 'Setup.EXE'), 'MZ');
  await writeFile(path.join(dir, 'old-build.tar.gz'), 'x');
  await writeFile(path.join(dir, 'levels.zip'), 'PK');
  const pre = await preflight(dir);
  assert.ok(
    pre.problems.some(p => p === 'downloads/Setup.EXE: a program or an installer: a game never hands one out'),
    pre.problems.join('\n'),
  );
  assert.ok(
    pre.problems.some(p => /^old-build\.tar\.gz: an archive/.test(p)),
    pre.problems.join('\n'),
  );
  assert.ok(!pre.problems.some(p => /levels\.zip/.test(p)), 'a .zip the game loads goes up');
  const r = run(['publish', dir, '--check', '--json']);
  assert.notEqual(r.status, 0);
  assert.equal(JSON.parse(r.stdout).ok, false);
});

test("a game's link name: xgames.fun leaves sign-in, wallet and brand words out of it, and the kit says so first", async t => {
  const { linkName } = await import('../lib/publish/names.mjs');
  const cases = [
    ['Dot Catch', 'dot-catch', []],
    ['Wallet Wars', 'wars', ['wallet']],
    ['Phantom Wallet Connect', 'game', ['phantom', 'wallet connect']],
    ['Phantom Wallet Wars', 'wars', ['phantom', 'wallet']],
    ['Sign In Quest', 'quest', ['sign in']],
    ['X Games Fun Run', 'fun-run', ['x games']],
    ['Connect Four', 'connect-four', []],
    ['Designing Dreams', 'designing-dreams', []],
    ['WalletConnect', 'game', ['walletconnect']],
    ['Super Walletlord', 'super', ['walletlord']],
    ['API', 'api-game', []],
    ['Go', 'go-game', []],
    ['Café Crème', 'cafe-creme', []],
    ["Bob's Airdrop", 'bobs', ['airdrop']],
  ];
  for (const [title, slug, dropped] of cases) assert.deepEqual(linkName(title), { slug, dropped }, title);
  assert.equal(linkName('a'.repeat(60)).slug.length, 48);

  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  await signIn(g, env);
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  const said = [];
  await publishGame(dir, {
    origin: g.origin,
    env,
    check: passing,
    title: 'Phantom Wallet Wars',
    progress: l => said.push(l),
  });
  const line = said.find(l => /link name/.test(l));
  assert.ok(line, said.join('\n'));
  assert.match(line, /Phantom Wallet Wars/);
  assert.match(line, /"wars"/);
  assert.match(line, /phantom, wallet/);
  assert.ok(said.indexOf(line) < said.findIndex(l => /^Uploading/.test(l)), 'said before anything is uploaded');
  // an update keeps the link it has: nothing to say
  const again = [];
  await publishGame(dir, {
    origin: g.origin,
    env,
    check: passing,
    title: 'Phantom Wallet Wars',
    progress: l => again.push(l),
  });
  assert.ok(!again.some(l => /link name/.test(l)), again.join('\n'));
});

test('a mainnet game whose server/vouchers.js predates its cluster is refused, with the command that writes it again', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  await signIn(g, env);
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  await writeFile(path.join(dir, 'xsolana.json'), JSON.stringify({ network: 'mainnet', grants: [] }));
  await mkdir(path.join(dir, 'server'), { recursive: true });
  // a voucher server as xcore 0.10.3 wrote it: no cluster named
  await writeFile(
    path.join(dir, 'server', 'vouchers.js'),
    "import ECONOMY from '__ECONOMY__';\nexport const PAY = {};\n",
  );
  await assert.rejects(
    publishGame(dir, { origin: g.origin, env, check: passing }),
    e => e.code === 'vouchers-cluster' && /add vouchers again/.test(e.message),
  );
});

test('a mainnet game that names its cluster in a server file of its own (as Bubble Day does) is published', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  await signIn(g, env);
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  await writeFile(path.join(dir, 'xsolana.json'), JSON.stringify({ network: 'mainnet', grants: [] }));
  await mkdir(path.join(dir, 'server'), { recursive: true });
  await writeFile(
    path.join(dir, 'server', 'vouchers.js'),
    "import { RELAY } from './network.js';\nexport const PAY = {};\n",
  );
  await writeFile(
    path.join(dir, 'server', 'network.js'),
    "import { useCluster as useLoot } from './gf-loot/client/cluster.js';\nuseLoot('mainnet');\n",
  );
  await assert.doesNotReject(publishGame(dir, { origin: g.origin, env, check: passing }));
});

test('a published folder linked from outside the game is refused; one linked inside it is published', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const outside = path.join(tmp.dir, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'index.html'), '<!doctype html>');
  const game = path.join(tmp.dir, 'game');
  await mkdir(path.join(game, 'build'), { recursive: true });
  await writeFile(path.join(game, 'build', 'index.html'), '<!doctype html>');
  await writeFile(path.join(game, 'gamesfun.json'), JSON.stringify({ page: { out: 'dist' } }));
  await symlink(outside, path.join(game, 'dist'));
  const out = await buildTree(game);
  assert.ok(out.refused.some(r => r.path === 'dist' && /outside the game/.test(r.why)));
  assert.ok(!out.tree.files.some(f => f.path === 'index.html'));
  await writeFile(path.join(game, 'gamesfun.json'), JSON.stringify({ page: { out: 'inside' } }));
  await symlink(path.join(game, 'build'), path.join(game, 'inside'));
  const ok = await buildTree(game);
  assert.ok(
    ok.tree.files.some(f => f.path === 'index.html'),
    JSON.stringify(ok.refused),
  );
});
