// `xcore review`: the security review. Two sample servers (a bounded one, where the page says what it found and the
// server only times it, and a decided one, where the server runs the reef from a seed it keeps), each static finding
// firing and not firing, the live probe against a stand-in game on this machine, the economy's own review through a
// stand-in @xgamesfun/solana, `xcore loot review`, and the line publish says when the review is out of date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { ownWords } from '../commands/loot.mjs';
import { liveFlag } from '../commands/review.mjs';
import {
  apiRoutes,
  liveReview,
  NO_REVIEW,
  paysFromRequest,
  readVouchers,
  reviewGame,
  reviewNudge,
  withoutComments,
} from '../lib/review.mjs';
import { seedAddress } from '../lib/add.mjs';
import { ROOT, run, tempDir } from './helpers.mjs';

const SAMPLES = path.join(ROOT, 'tests', 'fixtures', 'review');
// the installed @xgamesfun/solana (0.25.0, no review), whatever the shell running the tests names
const INSTALLED = { ...process.env, GAMESFUN_SOLANA: '' };
const SEED = 'ab'.repeat(32);

async function sample(tmp, name, as = name) {
  const dir = path.join(tmp.dir, as);
  await cp(path.join(SAMPLES, name), dir, { recursive: true });
  return dir;
}
const review = (dir, o = {}) => reviewGame(dir, { env: INSTALLED, ...o });
const ids = r => r.findings.map(f => `${f.severity} ${f.id}`);
const edit = async (file, change) => writeFile(file, change(await readFile(file, 'utf8')));
const editJson = (file, change) =>
  edit(file, t => {
    const v = JSON.parse(t);
    change(v);
    return JSON.stringify(v, null, 2);
  });

test('the two sample servers: no finding in either; the trade-offs say bounds and decides, and what a cheater gets', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const bounded = await sample(tmp, 'bounded');
  const decided = await sample(tmp, 'decided');
  const b = await review(bounded);
  const d = await review(decided);
  assert.deepEqual(ids(b), []);
  assert.deepEqual(ids(d), []);
  assert.equal(b.ok, true);
  assert.equal(b.outDir, path.join(bounded, 'evidence', 'review-1'));
  assert.equal(b.economy.available, false);
  assert.match(b.economy.why, /needs @xgamesfun\/solana with `review`/);
  assert.deepEqual(
    b.server.routes.map(r => r.path),
    ['api/tide/found', 'api/tide/start', 'api/vouchers/key', 'api/vouchers/link', 'api/vouchers/pay'],
  );
  assert.deepEqual(
    d.server.routes.find(r => r.path === 'api/tide/step').from,
    ['server/reef.js', 'game.js'],
    'from the server code and the page both',
  );
  assert.equal(b.tradeoffs[0].trust, 'bounds');
  assert.match(b.tradeoffs[0].cheater, /every claim without playing.*100 a day in all/);
  assert.match(b.tradeoffs[0].stronger, /^replaying it/);
  assert.equal(d.tradeoffs[0].trust, 'decides');
  assert.match(d.tradeoffs[0].cheater, /a bot that plays well/);
  const md = await readFile(path.join(b.outDir, 'review.md'), 'utf8');
  for (const h of [
    '# Security review: bounded',
    '## Findings',
    '## Economy',
    '## Server',
    '## Live',
    '## For the person',
  ])
    assert.ok(md.includes(h), h);
  assert.ok(md.trimEnd().endsWith('trust-and-cheating.md.'), 'it ends with the guide');
  assert.deepEqual(JSON.parse(await readFile(path.join(b.outDir, 'review.json'), 'utf8')).counts, {
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  });
  // the next review is the next folder; the command says it all and exits 0
  const c = run(['review', bounded], { env: { GAMESFUN_SOLANA: '' } });
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /^review: PASS 0 high/);
  assert.match(c.stdout, /evidence .*review-2/);
  assert.match(c.stdout, /^paid route grant:found-whale: bounds$/m);
  assert.match(c.stdout, /economy: xsolana\.json not reviewed: the economy review needs/);
});

test('PAY.check: the template pays nothing; one that pays from the request alone is high, and the command exits 1', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  const vouchers = path.join(dir, 'server', 'vouchers.js');
  const written = await readFile(vouchers, 'utf8');
  await edit(vouchers, t =>
    t.replace(
      /export const PAY = \{[\s\S]*?\n\};/,
      "export const PAY = {\n  async check() {\n    return { why: 'This game pays no results yet: write PAY.check at the top of server/vouchers.js.' };\n  },\n};",
    ),
  );
  let r = await review(dir);
  assert.deepEqual(ids(r), ['info pay-unwritten']);
  assert.equal(r.server.facts.pay, 'template');
  // the page says what it found, and the server pays it
  await writeFile(
    vouchers,
    written.replace(
      /async check\(\{ body, player, env \}\) \{[\s\S]*?\n {2}\},/,
      "async check({ body, player }) {\n    // env is never read: nothing the server keeps\n    if (!player.x) return { why: 'Sign in with X.' };\n    return { grant: `found-${body.creature}`, round: body.runId, amount: 'grant' };\n  },",
    ),
  );
  r = await review(dir);
  assert.deepEqual(ids(r), ['high pay-from-request']);
  assert.match(r.findings[0].message, /declare trust "bounds", which this check does not do/);
  assert.equal(r.ok, false);
  // a gift to every signed-in player who asks (no body read): nothing they did is checked, but nothing they say decides
  await writeFile(
    vouchers,
    written.replace(
      /async check\(\{ body, player, env \}\) \{[\s\S]*?\n {2}\},/,
      "async check({ player }) {\n    return { grant: 'found-whale', round: `${player.sub}:${new Date().toISOString().slice(0, 10)}`, amount: 'grant' };\n  },",
    ),
  );
  assert.deepEqual(ids(await review(dir)), ['medium pay-from-request']);
  await edit(vouchers, t =>
    t.replace(
      /async check\(\{ player \}\) \{[\s\S]*?\n {2}\},/,
      "async check({ body }) {\n    return { grant: body.grant, round: body.runId, amount: 'grant' };\n  },",
    ),
  );
  const c = run(['review', dir, '--json'], { env: { GAMESFUN_SOLANA: '' } });
  assert.equal(c.status, 1);
  assert.equal(JSON.parse(c.stdout).findings[0].id, 'pay-from-request');
});

test('PAY.check read from the code: comments left out, env read or not', () => {
  const code = `// export const PAY = { check() { return { grant: 1 } } }
export const PAY = {
  /* a check with a URL in it: 'https://x.example/a' */
  async check({ body, env }) {
    const url = 'https://x.example/{a}'; // a brace in a string
    if (!(await env.RUNS.get(body.runId))) return { why: 'no' };
    return { grant: 'g', round: body.runId, amount: 'grant' };
  },
};
export const VOUCHERS = { payOnly: 'any' /* 'x' later */ };`;
  const v = readVouchers(code);
  assert.equal(v.template, false);
  assert.equal(v.payOnly, 'any');
  assert.match(v.check.body, /env\.RUNS/);
  assert.equal(paysFromRequest(v.check), false);
  assert.equal(
    paysFromRequest(
      readVouchers(
        'export const PAY = {\n  check: async ({ body }) => {\n    return { grant: body.g, round: body.r };\n  },\n};',
      ).check,
    ),
    true,
  );
  // a check that asks a backend of its own is not flagged
  assert.equal(
    paysFromRequest({ body: "{ const ok = await fetch('https://b.example/verify'); return { grant: 'g' }; }" }),
    false,
  );
  assert.equal(withoutComments("a // b\n'c // d'").replace(/ +/g, ' '), "a \n'c // d'");
});

test('api/ routes from strings, template literals, regex literals and gf.api, never from comments', () => {
  const code = `
// GET api/never/this
const PATH = /\\/api\\/vouchers\\/(key|pay|link)\\/?$/;
const ROOT = /\\/api\\/rpc\\/?$/;
fetch('api/scores');
fetch(\`./api/levels/\${id}\`);
await gf.api('tide/step', { method: 'POST' });
const other = '/api/rooms/join';`;
  assert.deepEqual(apiRoutes(code).sort(), [
    'api/levels',
    'api/rooms/join',
    'api/rpc',
    'api/scores',
    'api/tide/step',
    'api/vouchers/key',
    'api/vouchers/link',
    'api/vouchers/pay',
  ]);
});

test('payOnly, the voucher key and the grants, trust: each finding fires, and not otherwise', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  const vouchers = path.join(dir, 'server', 'vouchers.js');
  const economy = path.join(dir, 'xsolana.json');
  // payOnly 'any' while the grant counts people: those claims fail
  await edit(vouchers, t => t.replace("payOnly: 'x'", "payOnly: 'any'"));
  assert.deepEqual(ids(await review(dir)), ['medium payonly-any-perperson']);
  // and with no perPerson: farmable, capped by its perDay; then with no total at all
  await editJson(economy, s => delete s.grants[0].limits.perPerson);
  assert.deepEqual(ids(await review(dir)), ['medium payonly-any-farmable']);
  await editJson(economy, s => delete s.grants[0].limits.perDay);
  const r = await review(dir);
  assert.deepEqual(ids(r), ['high payonly-any-farmable']);
  assert.equal(r.findings[0].route, 'grant:found-whale');
  assert.match(r.tradeoffs[0].cheater, /capped at 1 a wallet \(a wallet is free\)$/);
  // trust: not declared (0.25.0 refuses the field: info), not one of the three
  await edit(vouchers, t => t.replace("payOnly: 'any'", "payOnly: 'x'"));
  await editJson(economy, s => {
    s.grants[0].limits = { perWallet: 1, perPerson: 1, perDay: 100 };
    delete s.grants[0].trust;
  });
  const u = await review(dir);
  assert.deepEqual(ids(u), ['info trust-undeclared']);
  assert.match(u.findings[0].fix, /0\.25\.0 refuses the field/);
  assert.equal(u.tradeoffs[0].trust, null);
  assert.match(u.tradeoffs[0].cheater, /^it rests on what PAY\.check checks/);
  await editJson(economy, s => (s.grants[0].trust = 'mostly'));
  assert.deepEqual(ids(await review(dir)), ['medium trust-unknown']);
  // a server key no grant names; grants that name a key nothing here signs
  await editJson(economy, s => {
    s.grants[0].trust = 'bounds';
    delete s.grants[0].vouchers;
  });
  assert.deepEqual(ids(await review(dir)), ['medium vouchers-unnamed']);
  await editJson(economy, s => (s.grants[0].vouchers = ['2LW2C9sZbxoizKZ9eXYrsiF8xLP8GajJpnjAyNYKTrh1']));
  await rm(vouchers);
  await edit(path.join(dir, 'server', 'index.js'), t => t.replace(/.*vouchers.*\n/g, ''));
  assert.deepEqual(ids(await review(dir)), ['medium vouchers-no-signer']);
  // the keeper signs: no finding
  await writeFile(
    path.join(dir, 'server', 'room.js'),
    'export const win = (env, w) => env.GF.loot.report({ winners: w });\n',
  );
  assert.deepEqual(ids(await review(dir)), []);
});

test(".dev.vars: tracked by git, not ignored, in the published folder; a seed or the test key's seed in the page; the test key in a grant", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  await writeFile(path.join(dir, '.dev.vars'), `VOUCHER_SEED=${SEED}\n`);
  const git = (...a) =>
    spawnSync('git', ['-C', dir, '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
  if (git('init', '-q').status === 0) {
    assert.deepEqual(ids(await review(dir)), ['low dev-vars-not-ignored']);
    git('add', '.dev.vars');
    assert.deepEqual(ids(await review(dir)), ['high dev-vars-tracked']);
    git('rm', '-q', '--cached', '.dev.vars');
    await writeFile(path.join(dir, '.gitignore'), '.dev.vars\n');
    assert.deepEqual(ids(await review(dir)), []);
  }
  // the test key's seed in the page; a seed by its name
  await writeFile(path.join(dir, 'debug.js'), `export const k = '${SEED}';\n`);
  let r = await review(dir);
  assert.deepEqual(ids(r), ['high secret-in-page']);
  assert.match(r.findings[0].message, /debug\.js holds the test voucher key's seed/);
  await writeFile(path.join(dir, 'debug.js'), `export const cfg = { seed: '${'c4'.repeat(32)}' };\n`);
  r = await review(dir);
  assert.deepEqual(ids(r), ['high secret-in-page']);
  assert.match(r.findings[0].message, /debug\.js:1 holds a seed \(64 hex characters\)/);
  await rm(path.join(dir, 'debug.js'));
  // the test key named in the grant
  const test = await seedAddress(SEED);
  await editJson(path.join(dir, 'xsolana.json'), s => s.grants[0].vouchers.push(test));
  r = await review(dir);
  assert.deepEqual(ids(r), ['medium test-key-in-grant']);
  assert.equal(r.server.facts.testKey, test);
  // a brought game whose static folder (what its build copies as it is) holds a .dev.vars
  const brought = await sample(tmp, 'decided', 'brought');
  await writeFile(
    path.join(brought, 'gamesfun.json'),
    JSON.stringify({ page: { build: 'npm run build', out: 'dist', static: 'public' } }),
  );
  await mkdir(path.join(brought, 'public'));
  await rename(path.join(brought, 'xsolana.json'), path.join(brought, 'public', 'xsolana.json'));
  await writeFile(path.join(brought, 'public', '.dev.vars'), 'NOTHING=1\n');
  r = await review(brought);
  assert.deepEqual(ids(r), ['medium dev-vars-published-folder']);
  assert.equal(r.server.facts.economy, 'public/xsolana.json', 'its economy found where loot add puts it');
});

/** A stand-in published game: routes that are open, half-open and closed, its voucher key and its economy file. */
async function standInGame({
  key = '2LW2C9sZbxoizKZ9eXYrsiF8xLP8GajJpnjAyNYKTrh1',
  project = 'ReefWatch1111111111111111111111111111111111',
} = {}) {
  const seen = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const auth = req.headers.authorization ?? null;
    seen.push({ method: req.method, url: req.url, auth, body });
    const send = (status, v) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(v));
    };
    const p = req.url.replace(/^\/game\//, '/');
    if (p === '/api/tide/start' && req.method === 'POST') return send(200, { ok: true, runId: 'r1' }); // open
    if (p === '/api/profile' && req.method === 'GET')
      return auth ? send(200, { ok: true, profile: {} }) : send(401, { ok: false, why: 'Sign in.' }); // any token
    if (p === '/api/scores' && req.method === 'GET') return send(200, { ok: true, scores: [] }); // public
    if (p === '/api/vouchers/key' && req.method === 'GET') return send(200, { ok: true, publicKey: key });
    if (p === '/xsolana.json')
      return send(200, { live: { program: '9cwqM1TXytPnFZsLfmUyv2dg4uW6Ch9C6UJVPns7NFQ', project } });
    return send(401, { ok: false, why: 'Sign in first.' });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${server.address().port}/game/`,
    seen,
    close: () => new Promise(r => server.close(r)),
  };
}

test('live: each route asked with no sign-in and a forged one; the key and the economy against this folder', async t => {
  const g = await standInGame({
    key: '24sDWzHodVNPzTuAt5wNqtrHzxNuaxQiCHLaUcDLrkUF',
    project: 'Older111111111111111111111111111111111111111',
  });
  t.after(g.close);
  const r = await liveReview(g.base, {
    routes: ['api/tide/start', 'api/profile', 'api/scores', 'api/vouchers/pay', 'api/vouchers/key'].map(p => ({
      path: p,
    })),
    keys: ['2LW2C9sZbxoizKZ9eXYrsiF8xLP8GajJpnjAyNYKTrh1'],
    economyPath: 'xsolana.json',
    localLive: {
      program: '9cwqM1TXytPnFZsLfmUyv2dg4uW6Ch9C6UJVPns7NFQ',
      project: 'ReefWatch1111111111111111111111111111111111',
    },
    vouchers: true,
  });
  assert.deepEqual(
    r.findings.map(f => `${f.severity} ${f.id} ${f.route ?? ''}`.trim()),
    [
      'high live-open-post api/tide/start',
      'high live-forged-token api/profile',
      'medium live-open-get api/scores',
      'medium live-key-unnamed',
      'medium live-economy-stale',
    ],
  );
  assert.equal(r.probes.length, 20, 'four requests a route');
  // read-only and a stranger's: no token but the forged one, and a route that pays gets an empty body
  for (const s of g.seen) assert.ok(s.auth === null || /^Bearer eyJ[\w-]+\.eyJ[\w-]+\.A+$/.test(s.auth), s.auth);
  for (const s of g.seen.filter(s => s.url === '/game/api/vouchers/pay' && s.method === 'POST'))
    assert.equal(s.body, '{}');
  assert.ok(
    g.seen.some(s => s.url === '/game/api/tide/start' && /runId/.test(s.body)),
    'a plausible body elsewhere',
  );
});

test('live through the review: the key and economy that match; the live key that is the test key is high', async t => {
  const tmp = await tempDir();
  const g = await standInGame();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const dir = await sample(tmp, 'bounded');
  // the bounded sample's page and server name api/tide/start: the stand-in answers it to anyone
  let r = await review(dir, { live: g.base });
  assert.deepEqual(ids(r), ['high live-open-post']);
  assert.equal(r.live.key.publicKey, '2LW2C9sZbxoizKZ9eXYrsiF8xLP8GajJpnjAyNYKTrh1');
  assert.equal(r.live.economy.same, true);
  assert.match(
    await readFile(path.join(r.outDir, 'review.md'), 'utf8'),
    /\| `api\/tide\/start` \| POST \| none \| 200 ok:true \|/,
  );
  // the live server signing with the test key in .dev.vars
  const test = await seedAddress(SEED);
  const t2 = await standInGame({ key: test });
  t.after(t2.close);
  await writeFile(path.join(dir, '.dev.vars'), `VOUCHER_SEED=${SEED}\n`);
  r = await review(dir, { live: t2.base });
  assert.ok(ids(r).includes('high live-test-key'), ids(r).join(', '));
  // the command: --live with no published link says how to give one
  const c = run(['review', dir, '--live'], { env: { GAMESFUN_SOLANA: '' } });
  assert.match(c.stderr, /no published link here: publish it, or run .* dev and give its address/);
  assert.deepEqual(liveFlag(['--live', 'https://a.example/', 'g']), { rest: ['g'], live: 'https://a.example/' });
  assert.deepEqual(liveFlag(['g', '--live']), { rest: ['g'], live: true });
  assert.deepEqual(liveFlag(['--live=http://127.0.0.1:5/game/']), { rest: [], live: 'http://127.0.0.1:5/game/' });
});

/** A stand-in @xgamesfun/solana: with `review` (its JSON as given) or without (it says it has no such command). */
async function standInSolana(tmp, name, review) {
  const root = path.join(tmp.dir, name);
  await mkdir(path.join(root, 'bin'), { recursive: true });
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: '@xgamesfun/solana',
      version: review ? '0.26.0' : '0.25.0',
      bin: { xsolana: 'bin/xsolana.mjs' },
    }),
  );
  await writeFile(
    path.join(root, 'bin', 'xsolana.mjs'),
    review
      ? `const [cmd, file, json] = process.argv.slice(2);
if (cmd !== 'review') process.exit(2);
if (json !== '--json') { console.log('Reviewed ' + (file ?? 'xsolana.json') + ': run xsolana review again after a change (or xsolana_review).'); process.exit(0); }
console.log(JSON.stringify(${JSON.stringify(review)}));
process.exit(${review.findings.some(f => f.severity === 'high') ? 1 : 0});\n`
      : `console.error('xsolana: there is no command “' + process.argv[2] + '”.');\nprocess.exit(1);\n`,
  );
  return root;
}

test("the economy's own review: its routes, findings and trade-offs in the record; without it, one line", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  await editJson(path.join(dir, 'xsolana.json'), s => delete s.grants[0].trust);
  const theirs = {
    ok: false,
    routes: [
      {
        kind: 'grant',
        key: 'found-whale',
        name: 'Found a Whale',
        trigger: 'voucher',
        enforced: ['perWallet', 'perPerson', 'perDay'],
        trusts: ['voucher key'],
        trust: 'bounds',
        ceiling: '100 whales a day',
        feeds: ['farm:reef'],
      },
    ],
    findings: [
      {
        id: 'bounded-feeds-farm',
        severity: 'high',
        route: 'grant:found-whale',
        message: 'A bounded grant feeds a farm that mints a token.',
        fix: 'Decide the result.',
      },
    ],
    tradeoffs: 'Found a Whale is **bounded**: a script gets every whale.',
  };
  const env = { ...process.env, GAMESFUN_SOLANA: await standInSolana(tmp, 'with', theirs) };
  const r = await reviewGame(dir, { env });
  assert.equal(r.economy.available, true);
  assert.equal(r.economy.version, '0.26.0');
  // its trust says nothing about the undeclared field, so this package's own line stays, at medium now
  assert.deepEqual(ids(r), ['high bounded-feeds-farm', 'medium trust-undeclared']);
  assert.equal(r.findings[0].source, 'economy');
  assert.equal(r.tradeoffs[0].trust, 'bounds', 'the level from its route when the grant does not say');
  assert.equal(r.tradeoffs[0].ceiling, '100 whales a day');
  assert.match(r.tradeoffs[0].cheater, /^every claim without playing/);
  const md = await readFile(path.join(r.outDir, 'review.md'), 'utf8');
  assert.match(
    md,
    /\| Found a Whale \| grant \| voucher \| voucher key \| bounds \| perWallet, perPerson, perDay \| 100 whales a day \|/,
  );
  assert.match(md, /a script gets every whale/);
  assert.match(md, /- \*\*The economy review's ceiling\*\*: 100 whales a day\./);
  assert.match(md, /bounds \(from the economy review; not declared in the grant\)/);
  // when it says the trust itself, this package does not say it again
  theirs.findings.push({
    id: 'trust-undeclared',
    severity: 'medium',
    route: 'grant:found-whale',
    message: 'm',
    fix: 'f',
  });
  const env2 = { ...process.env, GAMESFUN_SOLANA: await standInSolana(tmp, 'with2', theirs) };
  assert.deepEqual(ids(await reviewGame(dir, { env: env2 })), ['high bounded-feeds-farm', 'medium trust-undeclared']);
  assert.equal((await reviewGame(dir, { env: env2 })).findings[1].source, 'economy');
  // an installed one without review
  const without = { ...process.env, GAMESFUN_SOLANA: await standInSolana(tmp, 'without', null) };
  const w = await reviewGame(dir, { env: without });
  assert.deepEqual(w.economy, { file: 'xsolana.json', available: false, version: '0.25.0', why: NO_REVIEW });
});

test('xcore loot review: passed to xsolana review, said as this package; without it, what to do', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  const theirs = { ok: true, routes: [], findings: [], tradeoffs: '' };
  const r = run(['loot', 'review'], { cwd: dir, env: { GAMESFUN_SOLANA: await standInSolana(tmp, 'with', theirs) } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    r.stdout.trim(),
    'Reviewed xsolana.json: run xcore loot review again after a change (or xcore loot review).',
  );
  const w = run(['loot', 'review'], { cwd: dir, env: { GAMESFUN_SOLANA: await standInSolana(tmp, 'without', null) } });
  assert.equal(w.status, 1);
  assert.equal(w.stderr.trim(), `xcore: ${NO_REVIEW}.`);
  assert.match(run(['loot', '--help']).stdout, /xcore loot review \[file\]/);
  assert.equal(
    ownWords()('`xsolana review xsolana.json`, xsolana_review'),
    '`xcore loot review xsolana.json`, xcore loot review',
  );
});

test('publish says to run the review when a game that pays through vouchers changed since its last one', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  assert.match(reviewNudge(dir), /pays results through voucher grants, and .* review has not run since/);
  const r = await review(dir);
  assert.equal(reviewNudge(dir), null);
  // server/ changed after it
  const later = new Date(Date.now() + 60_000);
  await utimes(path.join(dir, 'server', 'tides.js'), later, later);
  assert.match(reviewNudge(dir) ?? '', /review has not run since/);
  assert.ok(existsSync(r.outDir));
  // a game with no voucher grant hears nothing
  const plain = await sample(tmp, 'decided', 'plain');
  await editJson(path.join(plain, 'xsolana.json'), s => delete s.grants[0].vouchers);
  assert.equal(reviewNudge(plain), null);
  // the command says it, and goes on
  const c = run(['publish', dir, '--check'], { env: { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config') } });
  assert.match(c.stderr, /review has not run since its economy or server\/ changed/);
  assert.doesNotMatch(run(['publish', plain, '--check']).stderr, /review has not run/);
});
