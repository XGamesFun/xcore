// What publish says when xgames.fun answers something other than a clean publish: an answer that is not its API, no
// answer at all, a first publish whose account it could not say, a game an earlier first publish left without a
// version, a version kept but not put live, a database past its size. And the names and paths it sends: the game
// confirmed is the game made, a path xgames.fun refuses is refused here, the records it adds are said plainly. The
// links it prints: the plain one and the one that plays inside a post on X.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { call } from '../lib/publish/client.mjs';
import { preflight, publishGame, shotProblem } from '../lib/publish/index.mjs';
import { buildTree, treePathProblem, uploadWords } from '../lib/publish/tree.mjs';
import { databaseLine, playerCardUrl, statusLine } from '../commands/publish.mjs';
import { fixture, passing, runAsync, signIn, standIn, tempDir } from './helpers.mjs';

async function ready(t, { adopted = true } = {}) {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  await signIn(g, env);
  const dir = await fixture(tmp, 'static');
  if (adopted) await (await import('../lib/publish/adopt.mjs')).adopt(dir);
  const cli = { env: { ...env, GAMESFUN_STUDIO: g.origin } };
  // a remembered pass for these files: the command publishes without running the page check in Chrome
  const remember = async () => {
    await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
    const report = { pass: true, quick: true, passed: 4, ran: 4, failed: [], at: new Date().toISOString(), run: 'v' };
    await writeFile(
      path.join(dir, '.gamesfun', 'gate.json'),
      JSON.stringify({ fingerprint: (await buildTree(dir)).fingerprint, report }),
    );
  };
  return { tmp, g, env, dir, cli, remember };
}
const link = async (dir, origin) =>
  JSON.parse(await readFile(path.join(dir, '.gamesfun', 'publish.json'), 'utf8'))[origin];

test('an ok answer that is not the API is refused in words; an error that is not a string is not printed as one', async t => {
  const g = await standIn();
  t.after(g.close);
  const answers = {
    '/page': [200, Buffer.from('<!doctype html><title>Sign in</title>'), { 'content-type': 'text/html' }],
    '/empty': [200, Buffer.from('')],
    '/nested': [400, { error: { message: 'nested' } }],
  };
  g.state.handle = (_m, url) => answers[url] ?? null;
  await assert.rejects(
    call(g.origin, '/page'),
    e => e.code === 'not-api' && /answered \/page with a page, not its API's JSON/.test(e.message),
  );
  await assert.rejects(call(g.origin, '/empty'), e => e.code === 'not-api' && /with nothing/.test(e.message));
  await assert.rejects(call(g.origin, '/nested'), e => e.status === 400 && e.message === 'xgames.fun answered 400.');
  // no answer at all: its own code, so an agent waits and tries again instead of changing the game
  await assert.rejects(call('http://127.0.0.1:9', '/api/kit/me'), e => e.code === 'unreachable' && e.status === 0);
});

test('publish --json says unreachable, not failed, when xgames.fun does not answer', async t => {
  const { g, dir, cli } = await ready(t);
  await g.close(); // signed in to it, and it no longer answers
  const r = await runAsync(['publish', dir, '--no-card', '--json'], cli);
  assert.equal(r.status, 1);
  const j = JSON.parse(r.stdout);
  assert.deepEqual([j.ok, j.code], [false, 'unreachable']);
  assert.match(j.error, /Could not reach xgames.fun/);
});

test('a begin answered with a page stops the publish in words, never with a TypeError', async t => {
  const { g, env, dir } = await ready(t);
  g.state.handle = (method, url) =>
    method === 'POST' && url === '/api/kit/publish'
      ? [200, Buffer.from('<html>wall</html>'), { 'content-type': 'text/html' }]
      : null;
  await assert.rejects(
    publishGame(dir, { origin: g.origin, env, check: passing }),
    e => e.code === 'not-api' && !/Cannot read properties/.test(e.message),
  );
});

test('a first publish whose account xgames.fun could not say refuses, and makes nothing, even if the next call would answer', async t => {
  const { g, dir, cli } = await ready(t);
  let failOnce = true;
  g.state.handle = (method, url) => {
    if (url === '/api/kit/me' && failOnce) {
      failOnce = false;
      return [503, { error: 'busy' }];
    }
    return null;
  };
  const r = await runAsync(['publish', dir, '--no-card'], cli);
  assert.equal(r.status, 1);
  assert.match(
    r.stderr,
    /Nothing was published: this folder's first publish makes a new game, and xgames.fun did not say which account/,
  );
  assert.equal(g.state.published, undefined, 'no game was made');
  assert.ok(!g.state.calls.includes('POST /api/kit/publish'));
  // healthy again: the printout, with its code, and still nothing made
  const asked = await runAsync(['publish', dir, '--no-card'], cli);
  assert.equal(asked.status, 0, asked.stderr);
  assert.match(asked.stdout, /This creates a new game/);
  assert.equal(g.state.published, undefined);
});

test('the game a first publish confirms is the game it makes: one name, from the page, for a folder never adopted', async t => {
  const { g, dir, cli, remember } = await ready(t, { adopted: false });
  await remember();
  const planned = JSON.parse((await runAsync(['publish', dir, '--no-card', '--json'], cli)).stdout);
  assert.equal(planned.plan.game, 'Dot Catch');
  const r = await runAsync(['publish', dir, '--no-card', '--yes', planned.code], cli);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(g.state.published.title, 'Dot Catch', 'begin names the game the printout named');
  assert.match(r.stderr, /Publishing “Dot Catch”/);
});

test('an update of a game an earlier first publish left without a version: the 409 says what to do', async t => {
  const { g, env, dir } = await ready(t);
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(
    path.join(dir, '.gamesfun', 'publish.json'),
    JSON.stringify({ [g.origin]: { projectId: 'g0', slug: null } }),
  );
  g.state.refuse = {
    at: 'begin',
    status: 409,
    body: { error: 'This game has no version yet; import it as a new game.' },
  };
  await assert.rejects(
    publishGame(dir, { origin: g.origin, env, check: passing }),
    e =>
      e.code === 'unfinished-game' &&
      / publish .*--new$/.test(e.next) &&
      /made by an earlier publish that stopped before its first version went up/.test(e.message) &&
      /archive the empty game in your console/.test(e.message) &&
      !/import it/.test(e.message),
  );
  // a 409 with xgames.fun's own code goes on as it came
  g.state.refuse = { at: 'begin', status: 409, body: { error: 'taken', code: 'game-cap' } };
  await assert.rejects(publishGame(dir, { origin: g.origin, env, check: passing }), e => e.code === 'game-cap');
});

test('a version xgames.fun kept but could not put live is said as that, and the record keeps the live version', async t => {
  const { g, env, dir, cli, remember } = await ready(t);
  // version 1 goes live
  await publishGame(dir, { origin: g.origin, env, check: passing });
  assert.equal((await link(dir, g.origin)).lastVersion, 1);
  // version 2 is kept, not live: the server's upload failed
  g.state.handle = (method, url) =>
    method === 'POST' && url === '/api/kit/publish/p1'
      ? [
          200,
          {
            projectId: 'g1',
            version: { id: 'v2', number: ++g.state.version },
            draft: false,
            published: {
              published: false,
              error: 'The game’s server could not be uploaded; the link still plays version 1.',
            },
            studioUrl: 'http://x/studio/g1',
          },
        ]
      : null;
  await writeFile(path.join(dir, 'game.js'), 'console.log("v2")');
  await remember();
  const r = await runAsync(['publish', dir, '--no-card'], cli);
  assert.equal(r.status, 1);
  assert.match(
    r.stdout,
    /^Kept “Dot Catch” as version 2 on xgames.fun, but it did not go live: The game’s server could not be uploaded/,
  );
  assert.match(r.stdout, /Version 1 still plays at http:\/\/x\/play\/dot-catch/);
  assert.doesNotMatch(r.stdout, /private draft/);
  const rec = await link(dir, g.origin);
  assert.deepEqual([rec.lastVersion, rec.draft, rec.kept.version], [1, false, 2]);
  // --status leads with what xgames.fun says plays now, then what was sent from here
  g.state.handle = (method, url) =>
    url === '/api/kit/games/g1'
      ? [200, { published: true, slug: 'dot-catch', url: 'http://x/play/dot-catch', version: { number: 1 } }]
      : null;
  const st = await runAsync(['publish', dir, '--status'], cli);
  assert.match(
    st.stdout,
    /is live at http:\/\/x\/play\/dot-catch \(version 1\)\.\n {2}Version 2 was kept on xgames.fun but did not go live: The game’s server/,
  );
  // the next clean publish clears it
  g.state.handle = null;
  await publishGame(dir, { origin: g.origin, env, check: passing });
  const after = await link(dir, g.origin);
  assert.equal(after.kept, undefined);
  assert.equal(after.lastVersion, 3);
});

test('--status says a takedown, from xgames.fun’s answer, over the folder’s record', () => {
  const s = {
    link: 'public',
    known: { projectId: 'g1', slug: 'dot-catch', url: 'http://x/play/dot-catch', lastVersion: 1, draft: false },
    live: { published: false, takenDown: true },
  };
  assert.match(statusLine('g1', 'http://x', s), /^g1 was taken down by xgames.fun: nothing plays at its link/);
  assert.doesNotMatch(statusLine('g1', 'http://x', s), /is published at/);
  assert.match(statusLine('g1', 'http://x', { ...s, live: { published: false } }), /^g1 is not live now/);
  assert.match(
    statusLine('g1', 'http://x', { ...s, live: null }),
    /^g1 was last published at http:\/\/x\/play\/dot-catch \(xgames.fun was not asked/,
  );
  assert.match(
    statusLine('g1', 'http://x', { link: 'started', known: { projectId: 'g1' }, live: null }),
    /publish it with --new and archive the empty game/,
  );
});

test('a published game prints the link that plays inside a post on X beside the plain one, and its database past its size', async t => {
  assert.equal(playerCardUrl('https://xgames.fun/play/dot-catch'), 'https://xgames.fun/play/dot-catch?card=player');
  assert.equal(databaseLine(null), null);
  assert.equal(databaseLine({ sizeBytes: 10, cap: 100 }), null);
  assert.match(
    databaseLine({ sizeBytes: 150 * 1048576, cap: 100 * 1048576, warning: 'slow' }),
    /its database is 150(\.0)? MB, past its plan's 100(\.0)? MB\. xgames.fun stops the game's server .*451/,
  );
  const { g, dir, cli, remember } = await ready(t);
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(
    path.join(dir, '.gamesfun', 'publish.json'),
    JSON.stringify({ [g.origin]: { projectId: 'g1', slug: 'dot-catch', lastVersion: 0 } }),
  );
  await remember();
  g.state.handle = (method, url) =>
    method === 'POST' && url === '/api/kit/publish/p1'
      ? [
          200,
          {
            projectId: 'g1',
            version: { id: 'v', number: 1 },
            draft: false,
            published: {
              published: true,
              slug: 'dot-catch',
              url: 'http://x/play/dot-catch',
              gameUrl: 'http://x/g',
              friendsUrl: null,
            },
            database: { name: 'd', applied: 1, sizeBytes: 200 * 1048576, cap: 100 * 1048576, warning: 'runs slowly' },
            studioUrl: 'http://x/studio/g1',
          },
        ]
      : null;
  const r = await runAsync(['publish', dir, '--no-card'], cli);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\n {2}to play inside a post on X: http:\/\/x\/play\/dot-catch\?card=player\n/);
  assert.match(r.stdout, /plain link shows a picture card/);
  assert.match(r.stdout, /Worth fixing now: its database is 200(\.0)? MB/);
  await remember();
  const j = JSON.parse((await runAsync(['publish', dir, '--no-card', '--json'], cli)).stdout);
  assert.equal(j.xPostUrl, 'http://x/play/dot-catch?card=player');
  assert.equal(j.database.sizeBytes, 200 * 1048576);
});

test('a path xgames.fun refuses (a backslash, a control character, over 512 characters) is refused before anything goes up', async t => {
  assert.equal(treePathProblem('assets/a.png'), null);
  assert.match(treePathProblem('a\\b.js'), /backslash/);
  assert.match(treePathProblem('tab\there.js'), /control character/);
  assert.match(treePathProblem('x'.repeat(513)), /513 characters.*at most 512/);
  if (process.platform === 'win32') return; // these names cannot be made there
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await writeFile(path.join(dir, 'a\\b.js'), '');
  await writeFile(path.join(dir, 'line\nbreak.png'), '');
  const p = await preflight(dir);
  assert.ok(
    p.problems.some(x => /^a\\b\.js: its name has a backslash/.test(x)),
    p.problems.join('\n'),
  );
  assert.ok(
    p.problems.some(x => /^line\\nbreak\.png: its name has a control character/.test(x)),
    p.problems.join('\n'),
  );
});

test('the records publish adds are said as xgames.fun’s, not as the kit’s', async t => {
  assert.equal(
    uploadWords({ files: 5, bytes: 2048, added: ['foundation.lock.json', 'adaptation-plan.json'] }),
    '5 files to upload (3 files from the game, plus 2 small records xgames.fun keeps with every version), 2 KB',
  );
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await (await import('../lib/publish/adopt.mjs')).adopt(dir);
  const built = await buildTree(dir);
  const sha = built.tree.files.find(f => f.path === 'adaptation-plan.json').sha256;
  const plan = JSON.parse(built.sources.get(sha).data.toString('utf8'));
  assert.doesNotMatch(plan.brief, /brought to the xgames.fun kit/);
  // a stray gf-three.json is named, with what to do
  await writeFile(path.join(dir, 'gf-three.json'), '{}');
  await assert.rejects(
    publishGame(dir, { env: {} }),
    e =>
      e.code === 'kit' &&
      /this folder has gf-three.json/.test(e.message) &&
      /move it out of the folder/.test(e.message),
  );
});

test('a check screenshot makes the preview picture only from a run that passed on the files as they are', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  const run = path.join(dir, 'evidence', 'verify-1');
  await mkdir(run, { recursive: true });
  const shot = path.join(run, 'desktop.png');
  await writeFile(shot, '');
  assert.match(await shotProblem(dir, shot), /did not finish/);
  await writeFile(
    path.join(run, 'record.json'),
    JSON.stringify({ pass: false, started: new Date().toISOString(), seconds: 1 }),
  );
  assert.match(await shotProblem(dir, shot), /did not pass/);
  await writeFile(
    path.join(run, 'record.json'),
    JSON.stringify({ pass: true, started: new Date().toISOString(), seconds: 1 }),
  );
  assert.equal(await shotProblem(dir, shot), null);
  // a file of the game changed after the run ended
  const later = new Date(Date.now() + 60_000);
  await utimes(path.join(dir, 'game.js'), later, later);
  assert.match(await shotProblem(dir, shot), /changed after that check ran \(game\.js, for one\)/);
});

test('an economy live on devnet whose "network" says mainnet is refused, with what to do; one on its own cluster goes', async t => {
  const { liveClusterProblem } = await import('../lib/publish/index.mjs');
  const { LOOT_PROGRAMS } = await import('../lib/solana-rpc.mjs');
  const live = program => ({ live: { program, project: 'P' } });
  assert.equal(liveClusterProblem({ network: 'mainnet', ...live(LOOT_PROGRAMS.mainnet) }), null);
  assert.equal(liveClusterProblem({ ...live(LOOT_PROGRAMS.devnet) }), null);
  assert.equal(liveClusterProblem({ network: 'mainnet' }), null, 'not live yet');
  assert.equal(liveClusterProblem({ network: 'mainnet', ...live('Some1ocalProgram') }), null, 'no cluster’s loot');
  assert.match(
    liveClusterProblem({ network: 'mainnet', ...live(LOOT_PROGRAMS.devnet) }),
    /"network" is "mainnet", and its "live" section is loot on devnet .*refuse to start\. To go to mainnet: keep a copy of this file .*take its "live" section out/,
  );
  assert.match(
    liveClusterProblem({ network: 'devnet', ...live(LOOT_PROGRAMS.mainnet) }),
    /Set "network" back to "mainnet"/,
  );
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await writeFile(
    path.join(dir, 'xsolana.json'),
    JSON.stringify({ network: 'mainnet', ...live(LOOT_PROGRAMS.devnet) }),
  );
  assert.ok((await preflight(dir)).problems.some(p => /^xsolana\.json: its "network" is "mainnet"/.test(p)));
});

test('a mainnet economy whose grant or issuer is the .dev.vars test voucher key is refused; on devnet it is the point', async t => {
  const { seedAddress } = await import('../lib/voucher-seed.mjs');
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  const seed = 'ab'.repeat(32);
  const test = await seedAddress(seed);
  await writeFile(path.join(dir, '.dev.vars'), `VOUCHER_SEED=${seed}\n`);
  const economy = network =>
    writeFile(
      path.join(dir, 'xsolana.json'),
      JSON.stringify({
        network,
        grants: [
          { key: 'win', vouchers: [test] },
          { key: 'other', vouchers: [] },
        ],
        keys: { issuer: test },
      }),
    );
  await economy('devnet');
  assert.ok(!(await preflight(dir)).problems.some(p => /test voucher key/.test(p)));
  await economy('mainnet');
  const said = (await preflight(dir)).problems.find(p => /test voucher key/.test(p));
  assert.match(
    said,
    /^xsolana\.json: this economy is on mainnet, and grant "win" takes vouchers from the test voucher key \(\w+\), and its keys\.issuer is that key, whose seed is in \.dev\.vars/,
  );
  assert.match(said, /secret set VOUCHER_SEED --new-key/);
});
