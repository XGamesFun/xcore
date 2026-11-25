// `xcore review`: the security review. Two sample servers (a bounded one, where the page says what it found and the
// server only times it, and a decided one, where the server runs the reef from a seed it keeps); the server's two
// analyses, the payout ledger (its ceiling arithmetic, and each payout-* finding firing and not firing) and key custody
// (each place a key is, firing and not), the live probe against a stand-in game on this machine, the economy's own review through a
// stand-in @xgamesfun/solana, `xcore loot review`, and the line publish says when the review is out of date. Then the
// reading itself: one unsafe payout and one safe one, each written several ways; what it says of its own method; and
// what it does when a file or a check cannot be read.
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
  codeOnly,
  liveReview,
  METHOD,
  NO_REVIEW,
  payoutCeiling,
  payoutFindings,
  payoutLedger,
  paysFromRequest,
  readVouchers,
  reviewGame,
  reviewNudge,
  serverReview,
  withoutComments,
  counts,
} from '../lib/review.mjs';
import { seedAddress } from '../lib/add.mjs';
import { ROOT, run, tempDir } from './helpers.mjs';
import { lootProgram } from '../lib/economy.mjs';

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
// xcore's own findings (the server, live); the economy's come from @xgamesfun/solana's review (`all` has them too). The
// design ↔ code pass's (source design: tests/design-code.test.mjs) are left out of both: a sample whose check keeps
// state asks about its server bound (bound-undeclared), which is that pass's to test.
const ids = r =>
  r.findings.filter(f => f.source !== 'economy' && f.source !== 'design').map(f => `${f.severity} ${f.id}`);
const all = r => r.findings.filter(f => f.source !== 'design').map(f => `${f.severity} ${f.id}`);
// a server finding's cases (the ledger's reasons under one code)
const one = (r, id) => r.findings.find(f => f.id === id);
const cases = (r, id) => r.findings.filter(f => f.id === id).flatMap(f => f.cases ?? [f.place]);
const edit = async (file, change) => writeFile(file, change(await readFile(file, 'utf8')));
const editJson = (file, change) =>
  edit(file, t => {
    const v = JSON.parse(t);
    change(v);
    return JSON.stringify(v, null, 2);
  });

test('the two sample servers: no server finding in either; the economy review of the installed @xgamesfun/solana; the trade-offs say bounds and decides', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const bounded = await sample(tmp, 'bounded');
  const decided = await sample(tmp, 'decided');
  const b = await review(bounded);
  const d = await review(decided);
  assert.deepEqual(ids(b), []);
  assert.deepEqual(ids(d), []);
  // the installed @xgamesfun/solana has `xsolana review`: the economy is read too. A "bounds" grant with no total is the
  // trade-off the review names (medium); a "decides" one isn't.
  assert.equal(b.economy.available, true);
  // (the economy's findings are the installed package's to word; what this package owes is to carry them, severity
  // and all: the "bounds" grant's uncapped claim is named, the "decides" one's isn't, and nothing in either is high)
  assert.ok(all(b).includes('medium R-CLAIM-UNCAPPED'), all(b).join(', '));
  assert.ok(!all(d).includes('medium R-CLAIM-UNCAPPED'), all(d).join(', '));
  for (const r of [b, d]) {
    assert.ok(all(r).includes('info R-VOUCHER-KEY') && all(r).includes('info R-AUTHORITY'), all(r).join(', '));
    assert.ok(!all(r).some(f => f.startsWith('high ')), all(r).join(', '));
  }
  assert.equal(b.ok, true, 'no high finding');
  assert.equal(b.outDir, path.join(bounded, 'evidence', 'review-1'));
  assert.deepEqual(
    b.server.routes.map(r => r.path),
    ['api/tide/found', 'api/tide/start', 'api/vouchers/key', 'api/vouchers/link', 'api/vouchers/pay'],
  );
  assert.deepEqual(
    d.server.routes.find(r => r.path === 'api/tide/step').from,
    ['server/reef.js', 'game.js'],
    'from the server code and the page both',
  );
  // the ledger: one record a paid route, the facts every payout-* finding is read off
  const [rb] = b.ledger;
  assert.equal(b.ledger.length, 1);
  assert.deepEqual(
    {
      route: rb.route,
      signer: rb.signer,
      where: rb.where,
      source: rb.source,
      amount: rb.amount,
      recipient: rb.recipient,
      identity: rb.identity,
      limits: rb.limits,
    },
    {
      route: 'grant:found-whale',
      signer: 'server',
      where: 'server/vouchers.js',
      source: 'env',
      amount: 'grant',
      recipient: 'proven',
      identity: 'x',
      limits: { perPerson: 1, perDay: 100 },
    },
  );
  assert.deepEqual(rb.trust, {
    declared: 'bounds',
    valid: true,
    economy: 'bounds',
    observed: 'state',
    level: 'bounds',
    matches: true,
  });
  assert.equal(rb.ceiling.bounded, true);
  assert.equal(rb.ceiling.by, 'person');
  assert.equal(d.ledger[0].trust.level, 'decides');
  // custody: the live key, at xgames.fun only (no .dev.vars in the samples)
  assert.deepEqual(
    b.custody.map(k => [k.key, k.places.map(p => p.kind)]),
    [['live', ['holder']]],
  );
  assert.equal(b.tradeoffs[0].trust, 'bounds');
  assert.match(b.tradeoffs[0].cheater, /every claim without playing.*bounded per person: 1 claim an X account/);
  assert.match(b.tradeoffs[0].cheater, /100 claims a day for every player together$/);
  assert.match(b.tradeoffs[0].stronger, /^replaying it/);
  assert.equal(d.tradeoffs[0].trust, 'decides');
  assert.match(d.tradeoffs[0].cheater, /a bot that plays well/);
  const md = await readFile(path.join(b.outDir, 'review.md'), 'utf8');
  for (const h of [
    '# Payout and key review: bounded',
    '## Findings',
    '## Economy',
    '## Server',
    '### Payouts: the ledger',
    '### Keys: where each one is',
    '## Live',
    '## What a cheater gets, and the trade-offs',
  ])
    assert.ok(md.includes(h), h);
  assert.ok(md.trimEnd().endsWith('trust-and-cheating.md.'), 'it ends with the guide');
  assert.match(
    md,
    /\| `grant:found-whale` \| server \(server\/vouchers\.js\) \| state the server keeps \| the grant's own \| a proven wallet \| X account \(payOnly 'x'\) \| perPerson 1, perDay 100 \| bounds \/ reads state \| bounded per person/,
  );
  assert.match(md, /\| the live voucher key \| not known here .* \| xgames\.fun \| its holder: xgames\.fun only/);
  assert.match(md, /- \*\*Its record\*\*: signed by the server's own key .* counted by an X account\./);
  const json = JSON.parse(await readFile(path.join(b.outDir, 'review.json'), 'utf8'));
  assert.deepEqual(json.counts, counts(b.findings), 'review.json counts what was found');
  assert.equal(json.counts.high, 0);
  assert.deepEqual(json.ledger, b.ledger, 'the ledger in review.json');
  assert.deepEqual(json.custody, b.custody, 'the custody list in review.json');
  // the next review is the next folder; the command says it all and exits 0
  const c = run(['review', bounded, '--verbose'], { env: { GAMESFUN_SOLANA: '' } });
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /^review: PASS 0 high/);
  assert.match(c.stdout, /evidence .*review-2/);
  assert.match(c.stdout, /^paid route grant:found-whale: bounds; bounded$/m);
  assert.match(c.stdout, /^server: 1 paid route in the ledger, 1 key in custody; 5 api\/ routes named/m);
  const kit = JSON.parse(
    await readFile(new URL('../node_modules/@xgamesfun/solana/package.json', import.meta.url), 'utf8'),
  ).version;
  assert.match(
    c.stdout,
    new RegExp(`economy: xsolana\\.json, \\d+ routes? reviewed by @xgamesfun/solana ${kit.replace(/\./g, '\\.')}`),
  );
});

test('a PAY.check review cannot read (commented out, or PAY gone) is a high finding, never a quiet pass', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  const vouchers = path.join(dir, 'server', 'vouchers.js');
  await edit(vouchers, t => t.replace(/export const PAY = \{[\s\S]*?\n\};/, m => `/*\n${m}\n*/`));
  const r = await review(dir);
  assert.equal(r.server.facts.pay, 'unreadable');
  assert.equal(one(r, 'pay-unreadable')?.severity, 'high');
  assert.match(one(r, 'pay-unreadable').fix, /export const PAY = \{ … \}/);
});

test('PAY.check in the ledger: the template pays nothing (payout-signer); the request deciding is payout-input (high with the body read), and its declared trust a payout-trust mismatch; the command exits 1', async t => {
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
  assert.deepEqual(ids(r), ['info payout-signer']);
  assert.deepEqual(cases(r, 'payout-signer'), ['template']);
  assert.equal(r.ledger[0].source, 'template');
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
  assert.deepEqual(ids(r), ['high payout-input', 'medium payout-trust']);
  assert.deepEqual(
    [r.ledger[0].source, r.ledger[0].decides, r.ledger[0].trust.observed],
    ['request', 'body', 'request'],
  );
  assert.equal(r.ledger[0].trust.matches, false);
  // the message names the grant and the record's facts
  assert.match(
    one(r, 'payout-input').message,
    /^"found-whale": the page's request decides it: .*Its record: signed by the server's own key .* decided by the request alone \(its body\)/,
  );
  assert.match(
    one(r, 'payout-trust').message,
    /declares trust "bounds", but nothing the server keeps reaches its decision \(it reads only the request/,
  );
  assert.equal(one(r, 'payout-input').route, 'grant:found-whale');
  assert.equal(r.tradeoffs[0].observed, 'request');
  assert.match(r.tradeoffs[0].cheater, /^every claim, at once, by a script that sends the request/);
  assert.equal(r.ok, false);
  // a gift to every signed-in player who asks (no body read): nothing they did is checked, but nothing they say decides
  await writeFile(
    vouchers,
    written.replace(
      /async check\(\{ body, player, env \}\) \{[\s\S]*?\n {2}\},/,
      "async check({ player }) {\n    return { grant: 'found-whale', round: `${player.sub}:${new Date().toISOString().slice(0, 10)}`, amount: 'grant' };\n  },",
    ),
  );
  r = await review(dir);
  assert.deepEqual(ids(r), ['medium payout-input', 'medium payout-trust']);
  assert.deepEqual(cases(r, 'payout-input'), ['sign-in-decides']);
  // a check of state the server keeps, but the wallet paid comes from the request: high
  await writeFile(
    vouchers,
    written.replace(
      "return { grant: 'found-whale', round: `${player.sub}:whale`, amount: 'grant' };",
      "return { grant: 'found-whale', round: `${player.sub}:whale`, amount: 'grant', wallet: body.wallet };",
    ),
  );
  r = await review(dir);
  assert.deepEqual(ids(r), ['high payout-input']);
  assert.deepEqual(cases(r, 'payout-input'), ['request-names-wallet']);
  assert.equal(r.ledger[0].recipient, 'request');
  // the same, with PAY.check handing the work to another method: read through the call, never a quiet pass
  await writeFile(
    vouchers,
    written
      .replace(
        "return { grant: 'found-whale', round: `${player.sub}:whale`, amount: 'grant' };",
        "return { grant: 'found-whale', round: `${player.sub}:whale`, amount: 'grant', wallet: body.wallet };",
      )
      .replace(
        'async check({ body, player, env }) {',
        'async check(args) {\n    return PAY.decide(args);\n  },\n  async decide({ body, player, env }) {',
      ),
  );
  r = await review(dir);
  assert.deepEqual(ids(r), ['high payout-input']);
  assert.deepEqual(cases(r, 'payout-input'), ['request-names-wallet']);
  assert.equal(r.ledger[0].recipient, 'request');
  // and the amount the page says (state decides whether, the page how much): high, since a script names the most the grant pays
  await writeFile(vouchers, written.replace("amount: 'grant' };", 'amount: body.amount };'));
  r = await review(dir);
  assert.deepEqual(ids(r), ['high payout-input']);
  assert.deepEqual(cases(r, 'payout-input'), ['request-amount']);
  await writeFile(
    vouchers,
    written.replace(
      /async check\(\{ body, player, env \}\) \{[\s\S]*?\n {2}\},/,
      "async check({ body }) {\n    return { grant: body.grant, round: body.runId, amount: 'grant' };\n  },",
    ),
  );
  const c = run(['review', dir, '--json'], { env: { GAMESFUN_SOLANA: '' } });
  assert.equal(c.status, 1);
  assert.equal(JSON.parse(c.stdout).findings[0].id, 'payout-input');
});

test("a server that checks players' tokens itself must name the game's audience", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'decided');
  const own = path.join(dir, 'server', 'auth.js');
  await writeFile(
    own,
    "import { createRemoteJWKSet, jwtVerify } from 'jose';\nconst keys = createRemoteJWKSet(new URL('https://xgames.fun/api/player/v1/key'));\nexport const who = t => jwtVerify(t, keys, { issuer: 'xgames.fun' });\n",
  );
  assert.ok(ids(await review(dir)).includes('high token-any-game'));
  // the same beside server/vouchers.js as xcore writes it, which names a game in words of its own (`game: g.project`)
  const asSampled = await readFile(path.join(dir, 'server', 'vouchers.js'), 'utf8');
  await cp(path.join(ROOT, 'lib', 'client', 'server', 'vouchers.js'), path.join(dir, 'server', 'vouchers.js'));
  assert.ok(ids(await review(dir)).includes('high token-any-game'));
  await writeFile(path.join(dir, 'server', 'vouchers.js'), asSampled);
  await writeFile(
    own,
    "import { createRemoteJWKSet, jwtVerify } from 'jose';\nconst keys = createRemoteJWKSet(new URL('https://xgames.fun/api/player/v1/key'));\nexport const who = t => jwtVerify(t, keys, { issuer: 'xgames.fun', audience: 'game:moth' });\n",
  );
  assert.ok(!ids(await review(dir)).includes('high token-any-game'));
});

const AUTH =
  "export async function requirePlayer(request, env) { const t = (request.headers.get('authorization')||'').slice(7); if (!t) return null; const p = await env.GF.verifyPlayer(t); return p.ok ? p : null; }\n";
// [name, server files, gamesfun.json or null, what the review says about tokens]
const TOKEN_CASES = [
  [
    'reads the board for anyone, never checks',
    {
      'index.js':
        "export default {\n  async fetch(request, env) {\n    return Response.json(await env.GF.scores.top('best'));\n  },\n};\n",
    },
    null,
    ['medium server-no-token-check'],
  ],
  [
    'a database for anyone',
    {
      'index.js':
        'export default { async fetch(request, env) { return Response.json(await env.DB.prepare("SELECT 1").all()); } };\n',
    },
    null,
    ['medium server-no-token-check'],
  ],
  [
    'a fetch out for anyone',
    { 'index.js': "export default { async fetch() { return fetch('https://api.example.net/x'); } };\n" },
    null,
    ['medium server-no-token-check'],
  ],
  [
    'a counter in a Durable Object, no token anywhere',
    {
      'index.js':
        "export default { async fetch(request, env) { return env.HITS.get(env.HITS.idFromName('x')).fetch(request); } };\n",
    },
    null,
    ['medium server-no-token-check'],
  ],
  [
    'checks first, then works',
    {
      'index.js':
        "export default {\n  async fetch(request, env) {\n    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\\s+/i, '');\n    if (!token) return new Response('sign in', { status: 401 });\n    const player = await env.GF.verifyPlayer(token);\n    if (!player.ok) return new Response('sign in', { status: 401 });\n    return Response.json(await env.GF.saves.get(player.sub));\n  },\n};\n",
    },
    null,
    [],
  ],
  [
    'works, then checks',
    {
      'index.js':
        "export default {\n  async fetch(request, env) {\n    const top = await env.GF.scores.top('best');\n    const player = await env.GF.verifyPlayer(request.headers.get('authorization'));\n    if (!player.ok) return Response.json(top);\n    return Response.json({ top, me: player.sub });\n  },\n};\n",
    },
    null,
    ['low work-before-token'],
  ],
  [
    'a public board on GET, a checked POST',
    {
      'index.js':
        "export default { async fetch(request, env) {\n if (request.method === 'GET') return Response.json(await env.GF.scores.top('best', {limit: 10}));\n const p = await env.GF.verifyPlayer((request.headers.get('authorization')||'').slice(7)); if (!p.ok) return new Response('no',{status:401});\n await env.GF.scores.submit('best', p.sub, 1); return Response.json({ok:true}); } };\n",
    },
    null,
    ['low work-before-token'],
  ],
  [
    'answers from what it has, no work',
    { 'index.js': 'export default { fetch: () => Response.json({ ok: true }) };\n' },
    null,
    [],
  ],
  [
    'checked first through a helper of its own (server/auth.js)',
    {
      'auth.js': AUTH,
      'index.js':
        "import { requirePlayer } from './auth.js';\nexport default { async fetch(request, env) { const p = await requirePlayer(request, env); if (!p) return new Response('no', {status: 401}); return Response.json(await env.GF.saves.get(p.sub, 'k')); } };\n",
    },
    null,
    [],
  ],
  [
    'a wrapper of its own checks every handler',
    {
      'auth.js':
        AUTH +
        "export const authed = h => async (request, env) => { const p = await requirePlayer(request, env); if (!p) return new Response('no',{status:401}); return h(request, env, p); };\n",
      'index.js':
        "import { authed } from './auth.js';\nconst handle = async (request, env, p) => Response.json(await env.GF.saves.get(p.sub,'k'));\nexport default { fetch: authed(handle) };\n",
    },
    null,
    [],
  ],
  [
    'a room whose Durable Object checks the token itself',
    {
      'room.js':
        "import { DurableObject } from 'cloudflare:workers';\nexport class Room extends DurableObject { async fetch(request) { const p = await this.env.GF.verifyPlayer(new URL(request.url).searchParams.get('t')); if (!p.ok) return new Response('no',{status:401}); return new Response('hi'); } }\n",
      'index.js':
        "export { Room } from './room.js';\nexport default { async fetch(request, env) { return env.ROOMS.get(env.ROOMS.idFromName('lobby')).fetch(request); } };\n",
    },
    { server: { main: 'server/index.js', objects: [{ class: 'Room', binding: 'ROOMS' }] } },
    [],
  ],
  [
    "a router's JWT middleware (a package): not decided, so not said",
    {
      'index.js':
        "import { Hono } from 'hono';\nimport { jwt } from 'hono/jwt';\nconst app = new Hono();\napp.use('/api/*', jwt({ secret: 'x' }));\napp.get('/api/me', async c => c.json(await c.env.GF.saves.get('a','b')));\nexport default app;\n",
    },
    null,
    [],
  ],
  [
    'a check in a comment only',
    {
      'index.js':
        "// verifyPlayer(token) here someday\nexport default { async fetch(request, env) { return Response.json(await env.GF.scores.top('b')); } };\n",
    },
    null,
    ['medium server-no-token-check'],
  ],
  [
    'a check in a string only',
    {
      'index.js':
        "const s = 'verifyPlayer(';\nexport default { async fetch(request, env) { return Response.json(await env.GF.scores.top('b')); } };\n",
    },
    null,
    ['medium server-no-token-check'],
  ],
  [
    'a check in a helper fetch never calls',
    {
      'index.js':
        "function never(env){ return env.GF.verifyPlayer('x'); }\nexport default { async fetch(request, env) { return Response.json(await env.GF.scores.top('b')); } };\n",
    },
    null,
    ['low work-before-token'],
  ],
  [
    'env.GF?.saves?.get',
    {
      'index.js':
        "export default { async fetch(request, env) { return Response.json(await env.GF?.saves?.get('a','b')); } };\n",
    },
    null,
    ['medium server-no-token-check'],
  ],
  [
    'const { GF } = env',
    {
      'index.js':
        "export default { async fetch(request, env) { const { GF } = env; return Response.json(await GF.scores.top('b')); } };\n",
    },
    null,
    ['medium server-no-token-check'],
  ],
  [
    'const g = env.GF; g.saves',
    {
      'index.js':
        "export default { async fetch(request, env) { const g = env.GF; return Response.json(await g.saves.get('a','b')); } };\n",
    },
    null,
    ['medium server-no-token-check'],
  ],
  [
    'export default new Server()',
    {
      'index.js':
        "class S { async fetch(request, env) { return Response.json(await env.GF.scores.top('b')); } }\nexport default new S();\n",
    },
    null,
    ['medium server-no-token-check'],
  ],
  [
    'checked first through a method of an object of its own (Auth.check())',
    {
      'auth.js':
        "export const Auth = { async check(request, env) { const t = (request.headers.get('authorization')||'').slice(7); if (!t) return null; const p = await env.GF.verifyPlayer(t); return p.ok ? p : null; } };\n",
      'index.js':
        "import { Auth } from './auth.js';\nexport default { async fetch(request, env) { const p = await Auth.check(request, env); if (!p) return new Response('no', {status: 401}); return Response.json(await env.GF.saves.get(p.sub, 'k')); } };\n",
    },
    null,
    [],
  ],
  [
    'checked first through a static method of a class of its own',
    {
      'auth.js':
        "export class Auth {\n  static async check(request, env) { const t = (request.headers.get('authorization')||'').slice(7); if (!t) return null; const p = await env.GF.verifyPlayer(t); return p.ok ? p : null; }\n}\n",
      'index.js':
        "import { Auth } from './auth.js';\nexport default { async fetch(request, env) { const p = await Auth.check(request, env); if (!p) return new Response('no', {status: 401}); return Response.json(await env.GF.saves.get(p.sub, 'k')); } };\n",
    },
    null,
    [],
  ],
  [
    'checked first through an arrow on an object of its own',
    {
      'auth.js':
        "export const Auth = { check: async (request, env) => { const t = (request.headers.get('authorization')||'').slice(7); if (!t) return null; const p = await env.GF.verifyPlayer(t); return p.ok ? p : null; } };\n",
      'index.js':
        "import { Auth } from './auth.js';\nexport default { async fetch(request, env) { const p = await Auth.check(request, env); if (!p) return new Response('no', {status: 401}); return Response.json(await env.GF.saves.get(p.sub, 'k')); } };\n",
    },
    null,
    [],
  ],
  [
    "a package whose name has 'auth' inside a word (authority, authorName): still said",
    {
      'index.js':
        "import { authorName } from 'authority';\nexport default { async fetch(request, env) { return Response.json(await env.GF.scores.top('b')); } };\n",
    },
    null,
    ['medium server-no-token-check'],
  ],
  [
    'a sign-in package by its path (@acme/auth): not decided, so not said',
    {
      'index.js':
        "import { requireUser } from '@acme/auth';\nexport default { async fetch(request, env) { return Response.json(await env.GF.scores.top('b')); } };\n",
    },
    null,
    [],
  ],
  [
    'a sign-in package by its name (x-auth): not decided, so not said',
    {
      'index.js':
        "import guard from 'x-auth';\nexport default { async fetch(request, env) { return Response.json(await env.GF.scores.top('b')); } };\n",
    },
    null,
    [],
  ],
  [
    'a sign-in package by its name (auth-kit): not decided, so not said',
    {
      'index.js':
        "import { guard } from 'auth-kit';\nexport default { async fetch(request, env) { return Response.json(await env.GF.scores.top('b')); } };\n",
    },
    null,
    [],
  ],
  [
    "xcore's own parts (its index, api/rpc)",
    {
      'index.js':
        "// The game's server on xgames.fun (docs/SERVER.md in @xgamesfun/xcore). Written by `xcore add rpc`:\nimport { handleRpc } from './rpc.js';\nexport default { async fetch(request, env) { const rpc = await handleRpc(request, env); if (rpc) return rpc; return new Response('not found', { status: 404 }); } };\n",
      'rpc.js':
        "export async function handleRpc(request, env) { return fetch(env.XSOLANA_RPC_URL, { method: 'POST' }); }\n",
    },
    null,
    [],
  ],
];

test('a server that works for anyone without checking a token is named; one that checks first (itself, through a helper of its own or in its room), or does no work, is not', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const tokenIds = r => ids(r).filter(f => /token/.test(f));
  for (const [i, [name, files, cfg, expected]] of TOKEN_CASES.entries()) {
    const dir = path.join(tmp.dir, `t${i}`);
    await mkdir(path.join(dir, 'server'), { recursive: true });
    await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>x</title>');
    if (cfg) await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify(cfg));
    for (const [f, text] of Object.entries(files)) await writeFile(path.join(dir, 'server', f), text);
    const r = await review(dir);
    assert.deepEqual(tokenIds(r), expected, name);
    for (const f of r.findings.filter(x => /token/.test(x.id))) {
      // the advice, not a recipe: no numbers, no timing
      assert.match(f.message, /counts toward what caps the game/, name);
      assert.doesNotMatch(`${f.message} ${f.fix}`, /\d+ ms|days?\b|minute/, name);
      assert.match(f.fix, /verifyPlayer/);
      assert.match(f.fix, /401/);
    }
  }
  // the parts xcore writes, as `xcore add` writes them
  const { addDatabase, addDatabaseObject, addMultiplayer, addRpc } = await import('../lib/add.mjs');
  for (const [name, steps] of [
    ['multiplayer, rpc and a database', [addMultiplayer, addRpc, addDatabase]],
    ['the older database', [addDatabaseObject]],
  ]) {
    const dir = path.join(tmp.dir, name.replace(/\W+/g, '-'));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>x</title>');
    for (const step of steps) await step(dir);
    assert.deepEqual(tokenIds(await review(dir)), [], name);
  }
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
  // "this" in a why's words is no read of state
  assert.equal(
    paysFromRequest({
      body: "{ if (!body.ok) return { why: 'Not a run this server started.' }; return { grant: 'g' }; }",
    }),
    true,
  );
  // a check that asks a backend of its own is not flagged, when the answer decides; asked and ignored, it decides nothing
  assert.equal(
    paysFromRequest({
      body: "{ const ok = await fetch('https://b.example/verify'); if (!ok.ok) return { why: 'no' }; return { grant: 'g' }; }",
    }),
    false,
  );
  assert.equal(
    paysFromRequest({ body: "{ const ok = await fetch('https://b.example/verify'); return { grant: 'g' }; }" }),
    true,
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

test('the ledger against the grants: payOnly and perPerson (payout-signer, payout-ceiling), the signer, trust; each fires, and not otherwise', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  const vouchers = path.join(dir, 'server', 'vouchers.js');
  const economy = path.join(dir, 'xsolana.json');
  // payOnly 'any' while the grant counts people: wallet-only players are signed nothing, so their claims fail
  await edit(vouchers, t => t.replace("payOnly: 'x'", "payOnly: 'any'"));
  let r = await review(dir);
  assert.deepEqual(ids(r), ['medium payout-signer']);
  assert.deepEqual(cases(r, 'payout-signer'), ['identity']);
  assert.equal(r.ledger[0].identity, 'wallet');
  assert.equal(r.ledger[0].ceiling.by, 'person', 'those who are paid are still counted per person');
  // and counted per wallet, not per person: a wallet is free, so only the day's total bounds it; then with no total at all
  await editJson(economy, s => (s.grants[0].limits = { perWallet: 1, perDay: 100 }));
  r = await review(dir);
  assert.deepEqual(ids(r), ['medium payout-ceiling']);
  assert.deepEqual(cases(r, 'payout-ceiling'), ['shared-day']);
  assert.match(
    one(r, 'payout-ceiling').message,
    /^"found-whale": what one person can take is bounded only by the day's total \(100 claims a day\)/,
  );
  assert.match(
    one(r, 'payout-ceiling').message,
    /Its record: identity paid: a wallet, which is free, by VOUCHERS\.payOnly 'any'; limits: perWallet 1, perDay 100\.$/,
  );
  await editJson(economy, s => delete s.grants[0].limits.perDay);
  r = await review(dir);
  assert.deepEqual(ids(r), ['high payout-ceiling']);
  assert.equal(one(r, 'payout-ceiling').route, 'grant:found-whale');
  assert.deepEqual(cases(r, 'payout-ceiling'), ['unbounded']);
  assert.equal(r.ledger[0].ceiling.bounded, false);
  assert.match(
    r.tradeoffs[0].cheater,
    /the most one person takes is unbounded: 1 claim a wallet \(perWallet\) × as many wallets/,
  );
  // payOnly 'x' with no perPerson: one X account links wallet after wallet, so the wallet still binds
  await edit(vouchers, t => t.replace("payOnly: 'any'", "payOnly: 'x'"));
  r = await review(dir);
  assert.deepEqual(ids(r), ['high payout-ceiling']);
  assert.match(r.ledger[0].ceiling.words, /payOnly lets only an X account be paid, but the grant counts no person/);
  // trust: not declared (the installed @xgamesfun/solana says it itself), not one of the three
  await editJson(economy, s => {
    s.grants[0].limits = { perPerson: 1, perDay: 100 };
    delete s.grants[0].trust;
  });
  const u = await review(dir);
  // the installed @xgamesfun/solana says it itself (R-TRUST-UNSAID), so this package's own line stays out
  assert.deepEqual(ids(u), []);
  assert.ok(
    all(u).some(i => i.endsWith(' R-TRUST-UNSAID')),
    all(u).join(', '),
  );
  assert.equal(u.ledger[0].trust.declared, null);
  assert.equal(u.tradeoffs[0].trust, null);
  assert.match(u.tradeoffs[0].cheater, /^it rests on what PAY\.check checks/);
  await editJson(economy, s => (s.grants[0].trust = 'mostly'));
  r = await review(dir);
  assert.deepEqual(ids(r), ['medium payout-trust']);
  assert.deepEqual(cases(r, 'payout-trust'), ['unknown']);
  // a server key no grant names: what it signs can't be claimed
  await editJson(economy, s => {
    s.grants[0].trust = 'bounds';
    delete s.grants[0].vouchers;
  });
  r = await review(dir);
  assert.deepEqual(ids(r), ['medium payout-signer']);
  assert.deepEqual(cases(r, 'payout-signer'), ['unclaimable']);
  assert.deepEqual(
    r.ledger.map(x => [x.route, x.claimable]),
    [['server/vouchers.js', false]],
  );
  assert.deepEqual(r.tradeoffs, []);
  // grants that name a key nothing here signs
  await editJson(economy, s => (s.grants[0].vouchers = ['2LW2C9sZbxoizKZ9eXYrsiF8xLP8GajJpnjAyNYKTrh1']));
  await rm(vouchers);
  await edit(path.join(dir, 'server', 'index.js'), t => t.replace(/.*vouchers.*\n/g, ''));
  r = await review(dir);
  assert.deepEqual(ids(r), ['medium payout-signer']);
  assert.deepEqual(cases(r, 'payout-signer'), ['no-signer']);
  assert.equal(r.ledger[0].signer, 'none');
  // the keeper signs: no finding, and the ledger says who
  await writeFile(
    path.join(dir, 'server', 'room.js'),
    'export const win = (env, w) => env.GF.loot.report({ winners: w });\n',
  );
  r = await review(dir);
  assert.deepEqual(ids(r), []);
  assert.deepEqual([r.ledger[0].signer, r.ledger[0].where, r.ledger[0].identity], ['keeper', 'server/room.js', 'x']);
  // (who wins is its callers' to say, and the review read none: said as not read, and no PASS)
  assert.equal(r.verdict, 'INCONCLUSIVE');
  assert.deepEqual(r.unread, [
    {
      what: 'server/room.js',
      payout: true,
      why: 'what decides the result it reports to the keeper is in the code that calls its function, which was not read',
    },
  ]);
  // a route that reports the winners the page names: the request decides who is paid
  await writeFile(
    path.join(dir, 'server', 'room.js'),
    'export async function report(request, env) {\n  const body = await request.json();\n  return env.GF.loot.report({ round: body.round, endedAt: 1, winners: body.winners });\n}\n',
  );
  r = await review(dir);
  assert.deepEqual(ids(r), ['high payout-input', 'medium payout-trust']);
  assert.deepEqual(cases(r, 'payout-input'), ['request-decides', 'request-names-wallet']);
  // a key the game's own code holds (signVoucher), reading a run it keeps
  await writeFile(
    path.join(dir, 'server', 'room.js'),
    "import { signVoucher } from './gf-loot/results/index.js';\nexport async function pay(env, run) {\n  const kept = await env.RUNS.get(run.id);\n  return signVoucher({ seed: env.VOUCHER_SEED, wallet: kept.wallet, amount: kept.score });\n}\n",
  );
  r = await review(dir);
  assert.deepEqual(ids(r), []);
  assert.deepEqual([r.ledger[0].signer, r.ledger[0].source, r.ledger[0].recipient], ['other', 'env', 'check']);
});

test('a grant that counts people, whose vouchers a key other than the issuer signs: every claim refused (payout-signer issuer)', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  const economy = path.join(dir, 'xsolana.json');
  // the sample's issuer is its voucher key: nothing to say
  let r = await review(dir);
  assert.deepEqual(cases(r, 'payout-signer'), []);
  // another key is the issuer: loot counts the voucher's person only when the issuer signed it, so NotLinked
  await editJson(economy, s => (s.keys = { issuer: '24sDWzHodVNPzTuAt5wNqtrHzxNuaxQiCHLaUcDLrkUF' }));
  r = await review(dir);
  assert.deepEqual(cases(r, 'payout-signer'), ['issuer']);
  assert.match(one(r, 'payout-signer').message, /NotLinked/);
  // counted per wallet: the issuer doesn't matter
  await editJson(economy, s => (s.grants[0].limits = { perWallet: 1, perDay: 100 }));
  r = await review(dir);
  assert.deepEqual(cases(r, 'payout-signer'), []);
  // the leaked key's reach names the grant's token cap
  await editJson(economy, s => (s.grants[0].limits = { perPerson: 1, perDay: 100, tokens: 5000 }));
  await editJson(economy, s => (s.keys = { issuer: s.grants[0].vouchers[0] }));
  r = await review(dir);
  assert.deepEqual(r.ledger[0].limits, { perPerson: 1, perDay: 100, tokens: 5000 });
});

test('the ceiling arithmetic: identities × limit per identity × time', () => {
  // payOnly 'any', no perPerson, no perDay: a wallet is free, and nothing else bounds it
  let c = payoutCeiling({ perWallet: 1 }, 'wallet');
  assert.deepEqual([c.bounded, c.by, c.identities, c.perIdentity, c.severity], [false, null, 'unbounded', 1, 'high']);
  assert.match(
    c.words,
    /^unbounded: 1 claim a wallet \(perWallet\) × as many wallets as one person makes \(a wallet is free\), with no perDay or total$/,
  );
  // with a perDay: bounded by the day's total, which one person can take
  c = payoutCeiling({ perWallet: 1, perDay: 50 }, 'wallet');
  assert.deepEqual([c.bounded, c.by, c.severity], [true, 'day', 'medium']);
  assert.match(
    c.words,
    /^bounded only by the day's total \(50 claims a day\), which every player shares and one person can take/,
  );
  c = payoutCeiling({ total: 500 }, 'wallet');
  assert.deepEqual([c.bounded, c.by, c.severity], [true, 'total', 'medium']);
  // payOnly 'x' and perPerson: bounded per person (an X account), whatever the totals
  c = payoutCeiling({ perPerson: 2, perDay: 50 }, 'x');
  assert.deepEqual([c.bounded, c.by, c.unit, c.perIdentity, c.severity], [true, 'person', 'x', 2, null]);
  assert.match(
    c.words,
    /^bounded per person: 2 claims an X account \(perPerson\) × the X accounts one person holds; 50 claims a day/,
  );
  // 'account' (or 'any') with perPerson: counted per X or Google account
  assert.equal(payoutCeiling({ perPerson: 1 }, 'account').unit, 'account');
  // perPersonEach (loot 0.29, a daily bonus): a person in each window
  c = payoutCeiling({ perPersonEach: { count: 1, every: '1d' }, perDay: 50 }, 'x');
  assert.deepEqual([c.bounded, c.by, c.per, c.severity], [true, 'person', '1 claim each 1d', null]);
  assert.match(c.words, /^bounded per person: 1 claim each 1d an X account \(perPersonEach\)/);
  // the keeper's own rate is a total too: shared, so medium
  // A window on each wallet is said, and bounds nothing: a wallet is free.
  c = payoutCeiling({ perWalletEach: { count: 1, every: '1d' } }, 'wallet');
  assert.equal(c.bounded, false);
  assert.match(c.words, /1 claim each 1d a wallet \(perWalletEach\)/);
  assert.doesNotMatch(c.words, /no limit a wallet/);
  c = payoutCeiling({}, 'wallet', { keeper: true });
  assert.deepEqual([c.bounded, c.by, c.severity], [true, 'keeper', 'medium']);
  assert.match(c.words, /120 reports an hour, 16 winners each/);

  // the same through the ledger, from the grant and VOUCHERS.payOnly
  const spec = limits => ({ grants: [{ key: 'g', vouchers: ['K'], trust: 'bounds', limits }] });
  const site = payOnly => ({
    signer: 'server',
    where: 'server/vouchers.js',
    payOnly,
    source: 'env',
    decides: null,
    amount: 'grant',
    recipient: 'proven',
  });
  const ledgerOf = (payOnly, limits) => payoutLedger(spec(limits), { sites: [site(payOnly)] });
  const sevs = l => payoutFindings(l).map(f => `${f.severity} ${f.id}`);
  assert.deepEqual(sevs(ledgerOf('any', { perWallet: 1 })), ['high payout-ceiling']);
  assert.deepEqual(sevs(ledgerOf('any', { perWallet: 1, perDay: 10 })), ['medium payout-ceiling']);
  assert.deepEqual(sevs(ledgerOf('x', { perPerson: 1 })), []);
  assert.equal(ledgerOf('x', { perPerson: 1 })[0].ceiling.by, 'person');
  // payOnly 'any' with perPerson: bounded, but the identity paid and the one counted differ
  assert.deepEqual(
    payoutFindings(ledgerOf('any', { perPerson: 1 })).map(f => [f.id, f.cases]),
    [['payout-signer', ['identity']]],
  );
});

test(".dev.vars and every key's places (key-custody): tracked by git, not ignored, in the served folder; a seed or the test key's seed in the page; the test key in a grant, raised on mainnet", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  await writeFile(path.join(dir, '.dev.vars'), `VOUCHER_SEED=${SEED}\n`);
  const test = await seedAddress(SEED);
  const places = r => r.custody.find(k => k.key === 'test').places.map(p => p.kind);
  const git = (...a) =>
    spawnSync('git', ['-C', dir, '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
  if (git('init', '-q').status === 0) {
    let r = await review(dir);
    assert.deepEqual(ids(r), ['low key-custody']);
    assert.deepEqual(places(r), ['holder', 'unignored']);
    git('add', '.dev.vars');
    r = await review(dir);
    assert.deepEqual(ids(r), ['high key-custody']);
    assert.deepEqual(places(r), ['holder', 'git']);
    assert.match(one(r, 'key-custody').message, new RegExp(`^the test voucher key \\(${test}\\) is in git history`));
    git('rm', '-q', '--cached', '.dev.vars');
    await writeFile(path.join(dir, '.gitignore'), '.dev.vars\n');
    r = await review(dir);
    assert.deepEqual(ids(r), []);
    assert.deepEqual(places(r), ['holder']);
  }
  // the test key's seed in the page; a seed by its name (a key of its own)
  await writeFile(path.join(dir, 'debug.js'), `export const k = '${SEED}';\n`);
  let r = await review(dir);
  assert.deepEqual(ids(r), ['high key-custody']);
  assert.deepEqual(places(r), ['holder', 'page']);
  assert.match(
    one(r, 'key-custody').message,
    /^the test voucher key .* is in debug\.js: in the page's files, which are public/,
  );
  await writeFile(path.join(dir, 'debug.js'), `export const cfg = { seed: '${'c4'.repeat(32)}' };\n`);
  r = await review(dir);
  assert.deepEqual(ids(r), ['high key-custody']);
  assert.match(one(r, 'key-custody').message, /^a seed \(64 hex characters\) is in debug\.js:1: in the page's files/);
  assert.ok(r.custody.some(k => k.key === 'page:debug.js:a seed (64 hex characters)'));
  await rm(path.join(dir, 'debug.js'));
  // the test key named in the grant: anyone with the folder signs for it
  await editJson(path.join(dir, 'xsolana.json'), s => s.grants[0].vouchers.push(test));
  r = await review(dir);
  assert.deepEqual(ids(r), ['medium key-custody']);
  assert.equal(one(r, 'key-custody').route, 'grant:found-whale');
  assert.deepEqual(r.custody.find(k => k.key === 'test').signs, ['found-whale']);
  assert.equal(r.server.facts.testKey, test);
  // on mainnet the same grant signs real-money claims with a key whose seed sits in .dev.vars: raised to high
  await editJson(path.join(dir, 'xsolana.json'), s => {
    s.network = 'mainnet';
  });
  r = await review(dir);
  assert.ok(ids(r).includes('high key-custody'), ids(r).join(', '));
  assert.ok(r.findings.find(f => f.id === 'key-custody').fix.startsWith('The economy is on mainnet'));
  const md = await readFile(path.join(r.outDir, 'review.md'), 'utf8');
  assert.match(
    md,
    new RegExp(
      `\\| the test voucher key \\(\`${test}\`\\) \\| grant:found-whale on mainnet \\| grant:found-whale \\| named by the grant: .* \\| high \\|`,
    ),
  );
  await editJson(path.join(dir, 'xsolana.json'), s => {
    delete s.network;
  });
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
  assert.deepEqual(ids(r), ['medium key-custody']);
  assert.deepEqual(cases(r, 'key-custody'), ['served']);
  assert.ok(r.custody.some(k => k.key === 'dev-vars:public/.dev.vars'));
  assert.equal(r.server.facts.economy, 'public/xsolana.json', 'its economy found where loot add puts it');
  // the test key's own seed in the served copy: a place of the test key
  await writeFile(path.join(brought, '.dev.vars'), `VOUCHER_SEED=${SEED}\n`);
  await writeFile(path.join(brought, 'public', '.dev.vars'), `VOUCHER_SEED=${SEED}\n`);
  r = await review(brought);
  assert.deepEqual(places(r), ['holder', 'served']);
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
    if (p === '/xsolana.json') return send(200, { live: { program: lootProgram(), project } });
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
      program: lootProgram(),
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
  // its findings say nothing about trust, so this package's own line stays (payout-trust, undeclared), at medium now
  assert.deepEqual(all(r), ['high bounded-feeds-farm', 'medium payout-trust']);
  assert.deepEqual(cases(r, 'payout-trust'), ['undeclared']);
  assert.equal(r.ledger[0].trust.economy, 'bounds');
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
  assert.deepEqual(all(await reviewGame(dir, { env: env2 })), ['high bounded-feeds-farm', 'medium trust-undeclared']);
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
  // the tools' own words for reading a coin made elsewhere, as this package's
  assert.equal(
    ownWords()('Run `xsolana token So11111111111111111111111111111111111111112` (xsolana_token): it reads the mint.'),
    'Run `xcore loot token So11111111111111111111111111111111111111112` (xcore loot token): it reads the mint.',
  );
  assert.match(run(['loot', '--help']).stdout, /xcore loot token <mint>/);
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

// ---- For the owner: "Questions to decide" and "What this build allows" -------------------------------------------------

const FROM = ['economy', 'server', 'design', 'custody', 'plan'];
/** Each line is {text, from}: a sentence, and one of the four sources. */
function assertLines(list, name) {
  assert.ok(Array.isArray(list), `${name} is a list`);
  for (const x of list) {
    assert.deepEqual(Object.keys(x).sort(), ['from', 'text'], `${name}: ${JSON.stringify(x)}`);
    assert.ok(typeof x.text === 'string' && x.text.trim().length > 10, `${name}: ${x.text}`);
    assert.ok(FROM.includes(x.from), `${name} from: ${x.from}`);
  }
}

test('the sample bounded server: a Tell line names its ceiling and what a leaked key still allows; review.md and review.json carry ask and tell', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  const r = await review(dir);
  assertLines(r.ask, 'ask');
  assertLines(r.tell, 'tell');
  const own = r.tell.filter(x => x.from === 'server');
  assert.equal(own.length, 1, 'one line for its one paid route');
  assert.match(own[0].text, /^“Found a Whale”: the server only bounds the result/);
  assert.match(own[0].text, /a cheater gets every claim without playing/);
  assert.match(
    own[0].text,
    /The most one person takes: at most 1 claim for each X account they hold, and 100 claims a day/,
  );
  assert.match(
    own[0].text,
    /The server holds the limit on each run .*if the server's key leaks, the chain still allows up to 100 claims a day\./,
  );
  // the live key is at its one holder: nothing to tell of it
  assert.ok(!r.tell.some(x => x.from === 'custody'));
  // what stops with the server: its claims and its own routes (no timer here, so no question from the plan)
  const plan = r.tell.filter(x => x.from === 'plan');
  assert.equal(plan.length, 1);
  assert.match(
    plan[0].text,
    /^If the game's plan cap is reached, its server stops until the month ends: claims \(voucher signing\)/,
  );
  assert.match(plan[0].text, /api\/tide\/start/);
  assert.match(plan[0].text, /pages keep loading/);
  assert.ok(!r.ask.some(x => x.from === 'plan'));

  const json = JSON.parse(await readFile(path.join(r.outDir, 'review.json'), 'utf8'));
  assert.deepEqual(json.ask, r.ask);
  assert.deepEqual(json.tell, r.tell);
  const md = await readFile(path.join(r.outDir, 'review.md'), 'utf8');
  const at = h => md.indexOf(h);
  assert.ok(at('## Questions to decide') > at('**PASS**'), 'after the summary');
  assert.ok(at('## What this build allows') > at('## Questions to decide'));
  assert.ok(at('## Findings') > at('## What this build allows'), 'before the findings');
  const block = (from, to) => md.slice(at(from), at(to));
  for (const x of r.ask)
    assert.ok(block('## Questions to decide', '## What this build allows').includes(`\n? ${x.text}\n`), x.text);
  for (const x of r.tell)
    assert.ok(block('## What this build allows', '## Findings').includes(`\n> ${x.text}\n`), x.text);

  // the command: the counts, and where both lists are
  const c = run(['review', dir, '--verbose'], { env: { GAMESFUN_SOLANA: '' } });
  assert.match(
    c.stdout,
    new RegExp(
      `^questions to decide: ${r.ask.length} \\(\\d+ from the economy\\); facts about this build: ${r.tell.length} `,
      'm',
    ),
  );
  assert.match(c.stdout, /^review\.md lists both: "Questions to decide" \("\? "\) and "What this build allows"/m);
  // written to the person reading it, not to an agent
  assert.doesNotMatch(c.stdout, /(Tell|Ask|For) the person|Tell them|Pass them on/);
  // the questions themselves, on screen: an agent that reads only the summary still sees them
  assert.ok(r.ask.length > 0);
  for (const x of r.ask) assert.ok(c.stdout.includes(`\n  ? ${x.text}\n`), x.text);
});

test('a server whose alarm draws: the plan-cap line names the timer, and asks who sends the draw when the server is off', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  await writeFile(
    path.join(dir, 'server', 'draw.js'),
    `import { DurableObject } from 'cloudflare:workers';
export class DrawClock extends DurableObject {
  async open() {
    await this.ctx.storage.setAlarm(Date.now() + 86_400_000); // alarm() below: the day's draw
  }
  async alarm() {
    const entries = (await this.ctx.storage.get('entries')) ?? [];
    await this.ctx.storage.put('winner', entries[0] ?? null);
  }
}
`,
  );
  await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify({ plan: 'free' }));
  const r = await review(dir);
  assert.deepEqual(r.server.work.alarms, [
    { where: 'server/draw.js', owner: 'DrawClock', what: 'the draw', timer: 'the draw timer', critical: true },
  ]);
  const [cap] = r.tell.filter(x => x.from === 'plan');
  assert.match(cap.text, /^If the game's plan \(Free\) reaches its cap, its server stops until the month ends: /);
  assert.match(cap.text, /claims \(voucher signing\), the draw timer \(DrawClock's alarm, server\/draw\.js\)/);
  const asks = r.ask.filter(x => x.from === 'plan');
  assert.equal(asks.length, 1);
  assert.match(asks[0].text, /^Who sends the draw \(DrawClock's alarm in server\/draw\.js\) if the server is off/);

  // an alarm that only tidies up is named, and asks nothing; a cron handler that reports is asked about
  await writeFile(
    path.join(dir, 'server', 'draw.js'),
    `export class Tidy { async alarm() { await this.ctx.storage.deleteAll(); } }
export default { async scheduled(controller, env) { await env.GF.loot.report({ round: 'x', winners: [] }); } };
`,
  );
  const q = await review(dir);
  assert.equal(q.server.work.alarms[0].critical, false);
  assert.equal(q.server.work.scheduled.length, 1);
  assert.match(
    q.tell.find(x => x.from === 'plan').text,
    /a timer \(Tidy's alarm, server\/draw\.js\), the report timer \(a cron handler/,
  );
  assert.deepEqual(
    q.ask.filter(x => x.from === 'plan').map(x => x.text.replace(/ \(.*/, '')),
    ['Who sends the results it reports'],
  );
});

test("the economy's own ask and tell lines: carried from its check with from economy; a kit without them leaves the review whole", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  const r = await review(dir);
  if (r.told.economy) {
    // the installed kit has its check: its lines, in its words (not pinned here), each marked as the economy's
    assert.equal(r.told.economy, 'xsolana check');
    const ask = r.ask.filter(x => x.from === 'economy');
    const tell = r.tell.filter(x => x.from === 'economy');
    assert.ok(tell.length > 0, 'its tell lines');
    assert.ok(ask.length > 0, 'its questions');
    for (const x of [...ask, ...tell]) assert.doesNotMatch(x.text, /^[?>] /, 'the marks are taken off');
    // its wording is the kit's: some are a question, some a request ("What a player earned ...: kept or lost")
    assert.ok(ask.every(x => x.text.trim().length > 0));
    // the economy's come first, then this package's own
    assert.equal(r.tell[0].from, 'economy');
  } else assert.ok(r.told.why, 'it says why there are none');
  // a kit whose check is missing or says nothing: no economy line, the rest of the review as before
  const theirs = { ok: true, routes: [], findings: [], tradeoffs: '' };
  const env = { ...process.env, GAMESFUN_SOLANA: await standInSolana(tmp, 'nocheck', theirs) };
  const w = await reviewGame(dir, { env });
  assert.equal(w.economy.available, true);
  assert.equal(w.told.economy, null);
  assert.match(w.told.why, /no check/);
  assert.ok(!w.ask.some(x => x.from === 'economy') && !w.tell.some(x => x.from === 'economy'));
  assert.ok(w.tell.some(x => x.from === 'server'));
  assertLines(w.ask, 'ask');
  assertLines(w.tell, 'tell');
  // and one that has a check which answers no JSON
  const broken = await standInSolana(tmp, 'brokencheck', theirs);
  await edit(
    path.join(broken, 'bin', 'xsolana.mjs'),
    s => `// 'check'\nif (process.argv[2] === 'check') { console.log('not json'); process.exit(0); }\n${s}`,
  );
  const b = await reviewGame(dir, { env: { ...process.env, GAMESFUN_SOLANA: broken } });
  assert.equal(b.told.economy, null);
  assert.match(b.told.why, /xsolana check gave no JSON/);
  assert.equal(b.economy.available, true);
});

test('a paid read that answers "not paid" when the chain fails (paid-read-open), and one that stops instead', async () => {
  const { failOpenPaidReads } = await import('../lib/review.mjs');
  const open = `async function landed(rpc, wallet, round) {
  try {
    return await winPaid({ rpc, game, grant, wallet, round });
  } catch {
    return false;
  }
}`;
  const caught = `const paid = await winPaid({ rpc, game, grant, wallet, round }).catch(() => false);`;
  const closed = `async function landed(rpc, wallet, round) {
  try {
    return await winPaid({ rpc, game, grant, wallet, round });
  } catch {
    return null; // unknown: the caller signs nothing
  }
}`;
  const thrown = `const paid = await winPaid({ rpc, game, grant, wallet, round });`;
  const of = code => failOpenPaidReads([{ f: 'vouchers.js', code, text: code }]).map(o => `${o.where}:${o.line}`);
  assert.deepEqual(of(open), ['server/vouchers.js:3']);
  assert.deepEqual(of(caught), ['server/vouchers.js:1']);
  assert.deepEqual(of(closed), []);
  assert.deepEqual(of(thrown), []);
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

test('review: a setting read from env is no state; storage through env is', () => {
  const check = body => paysFromRequest({ body });
  assert.equal(check("return body.score > Number(env.MIN_SCORE) ? { grant: 'clear' } : { why: 'low' };"), true);
  // read and used: state; read and never used, it decides nothing (the request decides)
  assert.equal(
    check("const r = await env.DB.prepare('x').first();\n if (!r) return { why: 'no' };\n return { grant: 'clear' };"),
    false,
  );
  assert.equal(check("const r = await env.DB.prepare('x').first();\n return { grant: 'clear' };"), true);
  assert.equal(check("return seen(env) && { grant: 'clear' };"), false);
});

// ---- The reading itself ----------------------------------------------------------------------------------------------

const TEMPLATE = path.join(ROOT, 'lib', 'client', 'server', 'vouchers.js');
/** server/vouchers.js with `pay` as its PAY and `above` over it; the rest as the bounded sample has it. */
async function vouchersWith(pay, above = '') {
  const own = await readFile(path.join(SAMPLES, 'bounded', 'server', 'vouchers.js'), 'utf8');
  return `// The game's own voucher key.\n${above}\n${pay}\n\n${own.slice(own.indexOf('export const VOUCHERS'))}`;
}
const check = body => `export const PAY = {\n  async check({ body, player, env }) {\n    ${body}\n  },\n};`;
const NOT_A_WHALE = "if (body?.creature !== 'whale') return { why: 'Only a whale earns an NFT.' };";
// what the page says it found, paid on its word; and a whale the server's own clock timed
const ON_ITS_WORD = "{ grant: 'found-whale', round: `${player.sub}:${body.runId}`, amount: 'grant' }";
const TIMED = "{ grant: 'found-whale', round: `${player.sub}:whale`, amount: 'grant' }";
const NO_TIDE = "return { why: 'No whale in a tide this server timed.' };";
const CLOCK = "import { clockOf } from './tides.js';";

// [how it is written, PAY, what stands above it, the server's other files]
const UNSAFE = [
  ['as the template shows a check', check(`${NOT_A_WHALE}\n    return ${ON_ITS_WORD};`)],
  [
    'its parameters under names of its own ({ body: b, player: p })',
    "export const PAY = {\n  async check({ body: b, player: p }) {\n    if (b?.creature !== 'whale') return { why: 'Only a whale earns an NFT.' };\n    return { grant: 'found-whale', round: `${p.sub}:${b.runId}`, amount: 'grant' };\n  },\n};",
  ],
  [
    'a helper in another file of server/',
    check('return whale(body, player);'),
    "import { whale } from './whale.js';",
    { 'whale.js': `export function whale(body, player) {\n  ${NOT_A_WHALE}\n  return ${ON_ITS_WORD};\n}\n` },
  ],
  [
    'an arrow whose body is an expression',
    `export const PAY = {\n  check: async ({ body, player }) =>\n    body?.creature === 'whale'\n      ? ${ON_ITS_WORD}\n      : { why: 'Only a whale earns an NFT.' },\n};`,
  ],
  [
    'a setting taken out of env by its name',
    check(
      `const { PRIZE_CREATURE = 'whale' } = env;\n    if (body?.creature !== PRIZE_CREATURE) return { why: 'Only a whale earns an NFT.' };\n    return ${ON_ITS_WORD};`,
    ),
  ],
  [
    'named in PAY and written beside it ({ check })',
    'export const PAY = { check };',
    `async function check({ body, player }) {\n  ${NOT_A_WHALE}\n  return ${ON_ITS_WORD};\n}`,
  ],
  [
    'the word "this" in a message',
    check(
      `if (body?.creature !== 'whale') return { why: \`A \${body?.creature} does not earn this.\` };\n    return ${ON_ITS_WORD};`,
    ),
  ],
  [
    'a brace in a message',
    check(
      `if (body?.creature !== 'whale') return { why: 'Only a whale earns an NFT :}' };\n    return ${ON_ITS_WORD};`,
    ),
  ],
  [
    'a brace and a quote in a regular expression',
    check(`if (!/^[a-z'}{]+$/.test(String(body?.creature))) return { why: 'Odd name.' };\n    return ${ON_ITS_WORD};`),
  ],
  [
    'a fetch whose answer nobody reads',
    check(
      `${NOT_A_WHALE}\n    await fetch('https://stats.example.org/whale', { method: 'POST', body: JSON.stringify({ who: player.sub }) });\n    return ${ON_ITS_WORD};`,
    ),
  ],
  [
    'another method of PAY, through this',
    `export const PAY = {\n  async check({ body, player }) {\n    return this.whale(body, player);\n  },\n  whale(body, player) {\n    ${NOT_A_WHALE}\n    return ${ON_ITS_WORD};\n  },\n};`,
  ],
  [
    'env handed to a helper that never reads it',
    check('return whale(env, body, player);'),
    `function whale(env, body, player) {\n  ${NOT_A_WHALE}\n  return ${ON_ITS_WORD};\n}`,
  ],
  [
    'state named only in a comment, and the sentence of the template left in one',
    check(
      `// return { why: 'This game pays no results yet: write PAY.check at the top of server/vouchers.js.' };\n    // later: await env.RUNS.get(body.runId)\n    ${NOT_A_WHALE}\n    return ${ON_ITS_WORD};`,
    ),
  ],
];
const SAFE = [
  [
    'as the sample has it',
    check(`${NOT_A_WHALE}\n    if (!(await clockOf(env).has(player.sub, 'whale'))) ${NO_TIDE}\n    return ${TIMED};`),
    CLOCK,
  ],
  [
    'all it was handed, given whole to a helper in another file',
    `export const PAY = {\n  async check(ctx) {\n    const { body, player } = ctx;\n    ${NOT_A_WHALE}\n    if (!(await timedWhale(ctx))) ${NO_TIDE}\n    return ${TIMED};\n  },\n};`,
    "import { timedWhale } from './timed.js';",
    {
      'timed.js': `${CLOCK}\nexport const timedWhale = ({ env, player }) => clockOf(env).has(player.sub, 'whale');\n`,
    },
  ],
  [
    'a binding taken in the parameters (env: { TIDE_CLOCK })',
    `export const PAY = {\n  async check({ body, player, env: { TIDE_CLOCK } }) {\n    ${NOT_A_WHALE}\n    const clock = TIDE_CLOCK.get(TIDE_CLOCK.idFromName('main'));\n    if (!(await clock.has(player.sub, 'whale'))) ${NO_TIDE}\n    return ${TIMED};\n  },\n};`,
  ],
  [
    'env under another name (env: bindings)',
    `export const PAY = {\n  async check({ body, player, env: bindings }) {\n    ${NOT_A_WHALE}\n    if (!(await clockOf(bindings).has(player.sub, 'whale'))) ${NO_TIDE}\n    return ${TIMED};\n  },\n};`,
    CLOCK,
  ],
  [
    'an arrow that hands all of it to a function below',
    'export const PAY = {\n  check: ctx => timedWhale(ctx),\n};',
    `${CLOCK}\nasync function timedWhale({ body, player, env }) {\n  ${NOT_A_WHALE}\n  if (!(await clockOf(env).has(player.sub, 'whale'))) ${NO_TIDE}\n  return ${TIMED};\n}`,
  ],
  [
    'a binding handed to a helper, and the same under a name of its own',
    check(
      `${NOT_A_WHALE}\n    const tides = env.TIDE_CLOCK;\n    if (!(await has(tides, player.sub))) ${NO_TIDE}\n    return ${TIMED};`,
    ),
    "const has = (clock, who) => clock.get(clock.idFromName('main')).has(who, 'whale');",
  ],
  [
    'a message with a brace and the word env in it, and no semicolons',
    `export const PAY = {\n  async check({ body, player, env }) {\n    if (body?.creature !== 'whale') return { why: 'Only a whale {not this} earns an NFT: ask env.' }\n    const seen = await clockOf(env).has(player.sub, 'whale')\n    if (!seen) return { why: \`No whale for \${player.sub} }\` }\n    return ${TIMED}\n  },\n}`,
    CLOCK,
  ],
];

// What PAY.check was handed, read in a way the reading can't follow: which field it took (the request's body, or state
// the server keeps) can't be told, so the verdict is INCONCLUSIVE (exit code 3), never PASS. Each pays the page's word.
const RUN_ID = "{ grant: 'found-whale', round: `${ctx.player.sub}:${req.runId}`, amount: 'grant' }";
const WHALE_REQ = "if (req?.creature !== 'whale') return { why: 'Only a whale earns an NFT.' };";
const opaqueCheck = take =>
  `export const PAY = {\n  async check(ctx) {\n    ${take}\n    ${WHALE_REQ}\n    return ${RUN_ID};\n  },\n};`;
const EVASIONS = [
  ['a key made of two strings', opaqueCheck("const req = ctx['bo' + 'dy'];")],
  ['a key held in a variable', opaqueCheck("const k = 'body';\n    const req = ctx[k];")],
  ['a key written as a string', opaqueCheck("const req = ctx['body'];")],
  ['optional chaining with a computed key', opaqueCheck("const k = 'body';\n    const req = ctx?.[k];")],
  ['destructuring through a computed key', opaqueCheck("const k = 'body';\n    const { [k]: req } = ctx;")],
  ['Reflect.get', opaqueCheck("const req = Reflect.get(ctx, 'body');")],
  ['Object.values', opaqueCheck('const [req] = Object.values(ctx);')],
  [
    'a computed key in the parameters',
    "const K = 'body';\nexport const PAY = {\n  async check({ [K]: req, player }) {\n    if (req?.creature !== 'whale') return { why: 'Only a whale earns an NFT.' };\n    return { grant: 'found-whale', round: `${player.sub}:${req.runId}`, amount: 'grant' };\n  },\n};",
  ],
  [
    'a helper that reads what it was handed by a computed key',
    'export const PAY = {\n  async check(ctx) {\n    return whale(ctx);\n  },\n};',
    `function whale(ctx) {\n  const req = ctx['bo' + 'dy'];\n  ${WHALE_REQ}\n  return ${RUN_ID};\n}`,
  ],
];

test('a check read through a computed key or Reflect is INCONCLUSIVE, never PASS', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  for (const [i, [how, pay, above = '']] of EVASIONS.entries()) {
    const dir = await sample(tmp, 'bounded', `e${i}`);
    await writeFile(path.join(dir, 'server', 'vouchers.js'), await vouchersWith(pay, above));
    const r = await review(dir);
    assert.deepEqual([r.verdict, r.ok], ['INCONCLUSIVE', false], how);
    assert.deepEqual(
      ids(r).filter(x => x.startsWith('high')),
      [],
      `${how}: no high finding, so no FAIL either`,
    );
    const not = r.unread.find(u => u.what === 'server/vouchers.js');
    assert.ok(not?.payout, `${how}: said as a payout not read`);
    assert.match(not.why, /can't be told by reading/, how);
    assert.equal(r.ledger[0].source, 'unreadable', `${how}: never taken as state the server keeps`);
  }
  // the outside reviewer's own case, through the command: exit code 3 and ok: false, in words and in JSON
  const dir = path.join(tmp.dir, 'e0');
  const c = run(['review', dir, '--verbose'], { env: { GAMESFUN_SOLANA: '' } });
  assert.equal(c.status, 3, c.stdout + c.stderr);
  assert.match(c.stdout, /^review: INCONCLUSIVE 0 high, /);
  const j = run(['review', dir, '--json'], { env: { GAMESFUN_SOLANA: '' } });
  assert.equal(j.status, 3);
  assert.deepEqual([JSON.parse(j.stdout).ok, JSON.parse(j.stdout).verdict], [false, 'INCONCLUSIVE']);
  // the same check written plainly is read, and is the high finding it should be
  await writeFile(path.join(dir, 'server', 'vouchers.js'), await vouchersWith(opaqueCheck('const req = ctx.body;')));
  const plain = await review(dir);
  assert.equal(plain.verdict, 'FAIL');
  assert.ok(ids(plain).includes('high payout-input'), ids(plain).join());
});

// What the page writes for its own player (a save, the page's GamesFun.db documents) is the player's word: read in a
// payout it is player input, as the request's body is, and a read of it never makes a body read safe.
const SCORE = "if (!(body.score > 100)) return { why: 'Score more than 100.' };";
const BEST = "const best = (await env.GF.saves.get(player.sub, 'best')).value ?? 0;";
const PAID = "return { grant: 'found-whale', round: `${player.sub}:${body.runId}`, amount: 'grant' };";
const DECOYS = [
  ['a save read after the body', check(`${SCORE}\n    ${BEST}\n    ${PAID}`)],
  ['a save read before the body', check(`${BEST}\n    ${SCORE}\n    ${PAID}`)],
  [
    'the save and the body together',
    check(`${BEST}\n    if (!(Math.max(best, body.score) > 100)) return { why: 'no' };\n    ${PAID}`),
  ],
  [
    'a save taken apart first',
    check(`const { saves } = env.GF;\n    const b = await saves.get(player.sub, 'best');\n    ${SCORE}\n    ${PAID}`),
  ],
  [
    'a save alone',
    check(
      `${BEST}\n    if (!(best > 100)) return { why: 'no' };\n    return { grant: 'found-whale', round: \`\${player.sub}:best\`, amount: 'grant' };`,
    ),
  ],
  [
    "the page's documents",
    check(
      `const doc = await env.DB.prepare("SELECT data FROM gf_docs WHERE owner = ?").bind(player.sub).first();\n    ${SCORE}\n    ${PAID}`,
    ),
  ],
];

test("a save or the page's documents read beside the body: player input, a high payout-input, never a PASS", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  for (const [i, [how, pay]] of DECOYS.entries()) {
    const dir = await sample(tmp, 'bounded', `d${i}`);
    await writeFile(path.join(dir, 'server', 'vouchers.js'), await vouchersWith(pay));
    const r = await review(dir);
    assert.equal(r.verdict, 'FAIL', how);
    assert.ok(ids(r).includes('high payout-input'), `${how}: ${ids(r).join()}`);
    assert.deepEqual([r.ledger[0].source, r.ledger[0].decides], ['request', 'body'], how);
    assert.match(r.ledger[0].seen ?? '', /which the player writes/, how);
  }
  // the outside reviewer's case, through the command: exit code 1
  const c = run(['review', path.join(tmp.dir, 'd0')], { env: { GAMESFUN_SOLANA: '' } });
  assert.equal(c.status, 1, c.stdout);
  assert.match(c.stdout, /^review: FAIL [1-9]\d* high/);
  // state the server keeps (a Durable Object of its own) still decides: no payout-input
  const dir = await sample(tmp, 'bounded', 'kept');
  await writeFile(
    path.join(dir, 'server', 'vouchers.js'),
    await vouchersWith(
      check(
        `const run = await env.RUNS.get(env.RUNS.idFromName(player.sub)).finished(body.runId);\n    if (!run) return { why: 'no' };\n    ${PAID}`,
      ),
    ),
  );
  const kept = await review(dir);
  assert.ok(!ids(kept).includes('high payout-input'), ids(kept).join());
  assert.equal(kept.ledger[0].source, 'env');
});

// The final outside review's variants: state read and never used (H), state another route stores from a request (D,
// through D1; M, through KV), and an alias of what the check is handed (B). Each is a high finding, never a PASS.
const GF_DB = async dir =>
  writeFile(
    path.join(dir, 'server', 'gf-db.js'),
    (await readFile(path.join(ROOT, 'lib', 'client', 'server', 'gf-db.js'), 'utf8')).replace('__BINDING__', 'DB'),
  );
const DB = "import { db } from './gf-db.js';";
const RUN_CHECK = check(
  "const run = await db(env).first('SELECT player, started_at FROM runs WHERE id = ?', String(body.runId));\n    if (!run || run.player !== player.sub) return { why: 'Not a run this server started for you.' };\n    if (Date.now() - run.started_at < 60_000) return { why: 'Faster than the game allows.' };\n    return { grant: 'found-whale', round: body.runId, amount: 'grant' };",
);
const START = values =>
  `import { db, withPlayer } from './gf-db.js';\nexport async function start(request, env) {\n  const b = await request.json();\n  const sub = await withPlayer(request, env);\n  await db(env).first('INSERT INTO runs (id, player, started_at) VALUES (?, ?, ?)', ${values});\n  return Response.json({ ok: true });\n}\n`;
/** The bounded sample with its grant's trust and limits as given. */
async function grantAs(dir, change) {
  const file = path.join(dir, 'xsolana.json');
  const spec = JSON.parse(await readFile(file, 'utf8'));
  change(spec.grants[0]);
  await writeFile(file, JSON.stringify(spec, null, 2));
}

test('H: a state read nothing uses, a round new on every request, a "decides" it does not: high, never a PASS', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded', 'h');
  await GF_DB(dir);
  await grantAs(dir, g => {
    g.trust = 'decides';
    g.limits = { perDay: 100 };
  });
  await writeFile(
    path.join(dir, 'server', 'vouchers.js'),
    await vouchersWith(
      check(
        "await db(env).first('SELECT 1 AS one');\n    return { grant: 'found-whale', round: crypto.randomUUID(), amount: 'grant' };",
      ),
      DB,
    ),
  );
  let r = await review(dir);
  assert.equal(r.verdict, 'FAIL');
  assert.deepEqual(
    [r.ledger[0].source, r.ledger[0].trust.observed, r.ledger[0].trust.matches],
    ['request', 'request', false],
  );
  assert.match(r.ledger[0].seen, /nothing it reads decides the payout/);
  assert.ok(cases(r, 'payout-input').includes('round-fresh'));
  assert.equal(one(r, 'payout-trust').severity, 'high', 'a "decides" that nothing decides');
  assert.equal(one(r, 'payout-input').severity, 'high', 'a fresh round with nothing per player');
  // a constant query that a condition does use decides nothing either
  await writeFile(
    path.join(dir, 'server', 'vouchers.js'),
    await vouchersWith(
      check(
        "const ok = await db(env).first('SELECT 1 AS one');\n    if (!ok) return { why: 'no' };\n    return { grant: 'found-whale', round: `${player.sub}:${Date.now()}`, amount: 'grant' };",
      ),
      DB,
    ),
  );
  r = await review(dir);
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.ledger[0].source, 'request');
  assert.ok(cases(r, 'payout-input').includes('round-fresh'));
});

test('D and M: state another route stores from the request is player input; one the server works out is state', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  // D: the docs' own check, and a route that stores what the page sent (D1)
  const d = await sample(tmp, 'bounded', 'd');
  await GF_DB(d);
  await writeFile(path.join(d, 'server', 'vouchers.js'), await vouchersWith(RUN_CHECK, DB));
  await writeFile(path.join(d, 'server', 'start.js'), START('b.runId, b.player, b.startedAt'));
  let r = await review(d);
  assert.equal(r.verdict, 'FAIL');
  assert.match(
    one(r, 'payout-stored-input').message,
    /reads the table runs, and server\/start\.js:5 writes it with what a request sent \(b\)/,
  );
  assert.equal(one(r, 'payout-stored-input').severity, 'high');
  // the same route storing only what the server works out: the docs' example holds
  await writeFile(path.join(d, 'server', 'start.js'), START('crypto.randomUUID(), sub, Date.now()'));
  r = await review(d);
  assert.ok(!ids(r).includes('high payout-stored-input'), ids(r).join());
  assert.equal(r.ledger[0].source, 'env');
  // M: the same through KV
  const m = await sample(tmp, 'bounded', 'm');
  await writeFile(
    path.join(m, 'server', 'vouchers.js'),
    await vouchersWith(
      check(
        "const run = await env.RUNS.get(String(body.runId), 'json');\n    if (!run || run.player !== player.sub) return { why: 'no' };\n    return { grant: 'found-whale', round: body.runId, amount: 'grant' };",
      ),
    ),
  );
  await writeFile(
    path.join(m, 'server', 'start.js'),
    "export async function start(request, env) {\n  const b = await request.json();\n  await env.RUNS.put(b.runId, JSON.stringify(b));\n  return new Response('ok');\n}\n",
  );
  r = await review(m);
  assert.equal(r.verdict, 'FAIL');
  assert.match(one(r, 'payout-stored-input').message, /reads env\.RUNS, and server\/start\.js:3 writes it/);
});

test('B: an alias of what the check is handed is followed, and an amount the request names is high', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded', 'b');
  await writeFile(
    path.join(dir, 'server', 'vouchers.js'),
    await vouchersWith(
      "export const PAY = {\n  async check(ctx) {\n    const req = ctx;\n    const amt = req.body.amount;\n    return { grant: 'found-whale', round: req.body.runId, amount: amt };\n  },\n};",
    ),
  );
  const r = await review(dir);
  assert.equal(r.verdict, 'FAIL');
  assert.deepEqual([r.ledger[0].source, r.ledger[0].decides, r.ledger[0].amount], ['request', 'body', 'request']);
  assert.ok(!r.unread.some(u => /hands env/.test(u.why)), 'nothing is handed to code it did not read');
  assert.equal(one(r, 'payout-input').severity, 'high');
});

test('the economy part: a spec its review refuses is high findings in words, never a JSON blob; a review that did not run is INCONCLUSIVE', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded', 'refused');
  await grantAs(dir, g => {
    g.trust = 'banana';
  });
  const r = await review(dir);
  assert.equal(r.verdict, 'FAIL');
  const refused = r.findings.filter(f => f.source === 'economy' && f.id === 'E-SCHEMA');
  assert.equal(refused.length, 1);
  assert.equal(refused[0].severity, 'high');
  assert.match(refused[0].message, /trust must be one of/);
  const c = run(['review', dir], { env: { GAMESFUN_SOLANA: '' } });
  assert.match(c.stdout, /^ {2}high {3}E-SCHEMA \(economy\.grants\[0\]\.trust\): /m);
  assert.doesNotMatch(c.stdout, /\{"ok":false/);
  // the economy tools not here: what pays was not all read, so no PASS
  const none = await sample(tmp, 'bounded', 'none');
  const r2 = await reviewGame(none, {
    env: { ...process.env, GAMESFUN_SOLANA: path.join(tmp.dir, 'no-such-package') },
  });
  assert.equal(r2.verdict, 'INCONCLUSIVE');
  assert.ok(r2.unread.some(u => u.what === 'xsolana.json' && u.payout));
});

test('one unsafe payout, however its check is written: paid on the request alone, a high finding', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  for (const [i, [how, pay, above, files = {}]] of UNSAFE.entries()) {
    const dir = await sample(tmp, 'bounded', `u${i}`);
    await writeFile(path.join(dir, 'server', 'vouchers.js'), await vouchersWith(pay, above));
    for (const [f, text] of Object.entries(files)) await writeFile(path.join(dir, 'server', f), text);
    const economy = path.join(dir, 'xsolana.json');
    const r = await serverReview(dir, { spec: JSON.parse(await readFile(economy, 'utf8')), economy });
    assert.deepEqual(
      r.findings.filter(f => f.severity === 'high').map(f => `${f.id} ${f.cases}`),
      ['payout-input request-decides'],
      how,
    );
    assert.deepEqual([r.ledger[0].source, r.ledger[0].decides], ['request', 'body'], how);
    assert.deepEqual(r.unread, [], how);
  }
});

test('one safe payout, however its check is written: decided by state the server keeps, no finding', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  for (const [i, [how, pay, above, files = {}]] of SAFE.entries()) {
    const dir = await sample(tmp, 'bounded', `s${i}`);
    await writeFile(path.join(dir, 'server', 'vouchers.js'), await vouchersWith(pay, above));
    for (const [f, text] of Object.entries(files)) await writeFile(path.join(dir, 'server', f), text);
    const economy = path.join(dir, 'xsolana.json');
    const r = await serverReview(dir, { spec: JSON.parse(await readFile(economy, 'utf8')), economy });
    assert.deepEqual(
      r.findings.filter(f => f.source === 'server').map(f => f.id),
      [],
      how,
    );
    // read as state from what the code does with a binding, not taken so because env went out of sight
    assert.deepEqual(
      [r.ledger[0].source, r.ledger[0].seen, r.ledger[0].assumed],
      ['env', 'it uses env.TIDE_CLOCK', false],
      how,
    );
    assert.deepEqual(r.unread, [], how);
  }
});

test('strings, templates, regular expressions and comments are not code: blanked in place, a template’s ${…} kept', () => {
  const text =
    "const a = 'x } y'; // c {\nconst r = /[/}'\"]+/g.test(s) ? `a ${b ? `in ${c}` : '}'} this` : a / b;\n/* env */ f(`${env.DB}`);";
  const bare = codeOnly(text);
  assert.equal(bare.length, text.length);
  assert.deepEqual(
    bare.split('\n').map(l => l.length),
    text.split('\n').map(l => l.length),
  );
  assert.doesNotMatch(bare, /[{}]|this|\bc\b \{|x . y/);
  // what a template works out is code, in brackets that still pair
  assert.match(bare, /\(b \? ` {4}\(c\)` : ' '\)/);
  assert.match(bare, /f\(` \(env\.DB\)`\)/);
  assert.match(bare, /: a \/ b;/, 'a division is no regular expression');
  // with comments alone taken out, every literal stays as it is
  assert.equal(withoutComments(text), text.replace('// c {', '      ').replace('/* env */', '         '));
  // a // inside a regular expression is no comment
  assert.equal(
    withoutComments('const u = s.replace(/^https?:\\/\\//, ""); f(x)'),
    'const u = s.replace(/^https?:\\/\\//, ""); f(x)',
  );
  // the template's sentence in a comment does not make a written check the template
  const written = readVouchers(
    "export const PAY = {\n  // return { why: 'This game pays no results yet: write PAY.check.' };\n  async check({ body }) {\n    return { grant: 'g', round: body.r, amount: 'grant' };\n  },\n};",
  );
  assert.equal(written.template, false);
  assert.equal(paysFromRequest(written.check), true);
});

test('an economy file or a gamesfun.json that is there and cannot be read is a high finding by its name, never a pass', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  const economy = path.join(dir, 'xsolana.json');
  // the check pays on the page's word: a FAIL while the economy can be read
  await writeFile(
    path.join(dir, 'server', 'vouchers.js'),
    await vouchersWith(check(`${NOT_A_WHALE}\n    return ${ON_ITS_WORD};`)),
  );
  assert.equal((await review(dir)).ok, false);
  // cut short: not JSON any more
  await writeFile(economy, '{ "version": 2, "grants": [ { "key": "found-whale", ');
  let r = await review(dir);
  assert.equal(r.ok, false);
  assert.deepEqual(ids(r), ['high file-unreadable']);
  assert.equal(one(r, 'file-unreadable').route, 'xsolana.json');
  assert.match(
    one(r, 'file-unreadable').message,
    /^xsolana\.json is there and cannot be read: it is not valid JSON \(.+\)\. Nothing in it was reviewed: no grant, no limit, no key/,
  );
  assert.match(
    one(r, 'file-unreadable').fix,
    /^Mend xsolana\.json so that it is a JSON object, then run .* review again\.$/,
  );
  assert.deepEqual(
    r.unread.map(u => u.what),
    ['xsolana.json'],
  );
  // the rest of the review ran: the server was read, and the installed tools are named as they are
  assert.equal(r.server.facts.pay, 'written');
  assert.equal(r.economy.available, false);
  const kit = JSON.parse(
    await readFile(new URL('../node_modules/@xgamesfun/solana/package.json', import.meta.url), 'utf8'),
  ).version;
  assert.equal(r.economy.version, kit);
  const md = await readFile(path.join(r.outDir, 'review.md'), 'utf8');
  assert.match(md, /^\*\*FAIL\*\*: 1 high, 0 medium, 0 low, 0 info; 1 part not read\. Fix every high finding/m);
  assert.match(md, /## Not read\n\n.*\n\n- xsolana\.json: it is not valid JSON/);
  assert.ok(md.includes(`@xgamesfun/solana ${kit}`), 'no "no @xgamesfun/solana" while it is installed');
  const c = run(['review', dir, '--verbose'], { env: { GAMESFUN_SOLANA: '' } });
  assert.equal(c.status, 1);
  assert.match(c.stdout, /^review: FAIL 1 high, 0 medium, 0 low, 0 info; 1 part not read · evidence /);
  assert.match(c.stdout, /^ {2}not read: xsolana\.json: it is not valid JSON/m);
  // JSON that is no object is no economy either
  await writeFile(economy, '[]');
  r = await review(dir);
  assert.match(
    one(r, 'file-unreadable').message,
    /^xsolana\.json is there and cannot be read: it holds no JSON object\./,
  );
  // the game's own settings: where its page and its economy are is read from them
  const other = await sample(tmp, 'bounded', 'settings');
  await writeFile(path.join(other, 'gamesfun.json'), '{ "plan": "free", ');
  r = await review(other);
  assert.equal(r.ok, false);
  assert.deepEqual(ids(r), ['high file-unreadable']);
  assert.equal(one(r, 'file-unreadable').route, 'gamesfun.json');
  assert.match(one(r, 'file-unreadable').message, /The review went on as for a folder with no settings/);
  // and one that is not there at all is no finding
  assert.deepEqual(ids(await review(await sample(tmp, 'bounded', 'plain'))), []);
});

test('every result says how it was read and what a PASS means: the same lines on the screen, in review.md and in review.json', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  assert.ok(METHOD.length <= 4);
  assert.match(METHOD[0], /^What was read: the economy file .*, the code in server\/ and the page's files/);
  assert.match(METHOD[1], /^How: as text, by patterns\. None of the game's code is run and none is parsed/);
  assert.match(
    METHOD[2],
    /^A PASS means no high finding in what was read, and every payout read through\. It is not proof that the game is safe to pay/,
  );
  assert.match(METHOD[3], /^Where the reading of a payout stops: /);
  const r = await review(dir);
  assert.equal(r.ok, true);
  assert.deepEqual(r.method, METHOD);
  assert.deepEqual(r.unread, []);
  assert.deepEqual(JSON.parse(await readFile(path.join(r.outDir, 'review.json'), 'utf8')).method, METHOD);
  const md = await readFile(path.join(r.outDir, 'review.md'), 'utf8');
  const c = run(['review', dir, '--verbose'], { env: { GAMESFUN_SOLANA: '' } });
  for (const line of METHOD) {
    assert.ok(md.includes(`\n- ${line}\n`), line);
    assert.ok(c.stdout.includes(`\n  ${line}\n`), line);
  }
  // by default: the verdict, one line on what it is, the findings, what was read, and at most three next steps
  const short = run(['review', dir], { env: { GAMESFUN_SOLANA: '' } }).stdout;
  assert.match(
    short,
    /^review: PASS 0 high, .*\n {2}Pattern-based, not a security audit: a PASS is not proof \(--verbose says how it reads\)\.\n/,
  );
  for (const line of METHOD) assert.ok(!short.includes(line), "the method is --verbose's");
  assert.match(
    short,
    /^read: xsolana\.json \(1 route\); server\/ \(1 paid route, 1 key, 5 api\/ routes\); live: not asked$/m,
  );
  assert.ok((short.match(/^ {2}\d\. /gm) ?? []).length <= 3, 'at most three next steps');
  assert.ok(short.split('\n').length < 20, short);
  assert.ok(md.indexOf(METHOD[0]) < md.indexOf('## Questions to decide'), 'under the verdict, before anything else');
  assert.match(md, /^\*\*PASS\*\*: 0 high, .* info\. No high finding\.$/m);
  assert.deepEqual(JSON.parse(run(['review', dir, '--json'], { env: { GAMESFUN_SOLANA: '' } }).stdout).method, METHOD);
  // a count says what it counts: one route, one key
  assert.match(c.stdout, /^economy: xsolana\.json, 1 route reviewed by /m);
  assert.match(c.stdout, /^server: 1 paid route in the ledger, 1 key in custody; 5 api\/ routes named/m);
  assert.match(
    run(['review', '--help']).stdout,
    /as text, by patterns, and runs none of it\. Verdicts:\n {2}PASS {10}no high finding in what it read/,
  );
});

test('what the review could not read is said beside the verdict; a check that answers through code it did not read is a high finding', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  const vouchers = path.join(dir, 'server', 'vouchers.js');
  // PAY.check hands the answer to a package's function: what it checks is out of sight
  await writeFile(
    vouchers,
    await vouchersWith(check('return whale(body, player);'), "import { whale } from 'reef-rules';"),
  );
  let r = await review(dir);
  assert.deepEqual(ids(r), ['high pay-unreadable']);
  assert.equal(r.server.facts.pay, 'written');
  assert.match(
    one(r, 'pay-unreadable').message,
    /^PAY\.check in server\/vouchers\.js answers through `whale`, which this review did not read .*: what the server checks before paying was not reviewed\.$/,
  );
  assert.deepEqual(r.unread, [
    { what: 'server/vouchers.js', why: 'PAY.check answers through `whale`, which was not read', payout: true },
  ]);
  assert.equal(r.ledger[0].source, 'unreadable');
  assert.match(
    r.tell.find(x => x.from === 'server').text,
    /^“Found a Whale”: it rests on code this review did not read/,
  );
  // env handed to code it did not read (a class of a package): the ledger takes it as state, but the verdict is no
  // PASS: INCONCLUSIVE, exit code 3
  await writeFile(
    vouchers,
    await vouchersWith(
      check(`${NOT_A_WHALE}\n    if (!(await new Tides(env).has(player.sub))) ${NO_TIDE}\n    return ${TIMED};`),
      "import { Tides } from 'reef-tides';",
    ),
  );
  r = await review(dir);
  assert.deepEqual([r.ok, r.verdict], [false, 'INCONCLUSIVE']);
  assert.deepEqual(ids(r), []);
  assert.deepEqual(
    [r.ledger[0].source, r.ledger[0].assumed, r.ledger[0].seen],
    ['env', true, 'it hands env to Tides, which this review did not read'],
  );
  assert.deepEqual(r.unread, [
    {
      what: 'server/vouchers.js',
      payout: true,
      why: 'PAY.check hands env to `Tides`, which was not read: taken as reading state the server keeps',
    },
  ]);
  const md = await readFile(path.join(r.outDir, 'review.md'), 'utf8');
  assert.match(md, /^\*\*INCONCLUSIVE\*\*: 0 high, .* info; 1 part not read\. No high finding, but a payout/m);
  assert.match(
    md,
    /## Not read\n\nThe verdict does not cover these: read them yourself\.\n\n- server\/vouchers\.js: PAY\.check hands env to `Tides`/,
  );
  assert.match(md, /\| state the server keeps \(taken so: env goes to code not read\) \|/);
  const c = run(['review', dir, '--verbose'], { env: { GAMESFUN_SOLANA: '' } });
  assert.equal(c.status, 3);
  assert.match(c.stdout, /^review: INCONCLUSIVE 0 high, .* info; 1 part not read · evidence /);
  assert.match(c.stdout, /^ {2}not read: server\/vouchers\.js: PAY\.check hands env to `Tides`, which was not read/m);
  // a check that refuses everything in words of its own pays nothing: said so, and nothing more
  await writeFile(
    vouchers,
    await vouchersWith(
      "export const PAY = {\n  async check() {\n    return { why: 'The reef is closed for the winter.' };\n  },\n};",
    ),
  );
  r = await review(dir);
  assert.deepEqual(ids(r), ['info payout-signer']);
  assert.deepEqual(cases(r, 'payout-signer'), ['pays-nothing']);
  assert.deepEqual([r.server.facts.pay, r.ledger[0].source], ['written', 'nothing']);
  assert.match(
    r.tell.find(x => x.from === 'server').text,
    /pays nothing yet: the server's check .* answers no grant\.$/,
  );
  assert.deepEqual(r.unread, []);
  // PAY kept in a file the review does not read it in (server/vouchers.ts, types and all)
  await rename(vouchers, path.join(dir, 'server', 'vouchers.ts'));
  r = await review(dir);
  assert.ok(ids(r).includes('high pay-unreadable'), ids(r).join(', '));
  assert.match(
    one(r, 'pay-unreadable').message,
    /^server\/vouchers\.ts declares PAY, and this review reads PAY\.check only in server\/vouchers\.js/,
  );
  assert.deepEqual(r.unread, [
    { what: 'server/vouchers.ts', why: 'it declares PAY, which is read only in server/vouchers.js', payout: true },
  ]);
});

test('a route of the game’s own that signs with voucherFor is a paid route the review reads, beside a PAY.check still the template', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  // server/vouchers.js as xcore add vouchers writes it, and a route that pays whatever wallet the page names
  await cp(TEMPLATE, path.join(dir, 'server', 'vouchers.js'));
  const route = wallet =>
    `import { handleVouchers, voucherFor, walletOf } from './vouchers.js';\nimport { handleTides } from './tides.js';\n\nexport { GameVouchers } from './vouchers.js';\nexport { TideClock } from './tides.js';\n\nasync function handleFound(request, env) {\n  if (!/\\/api\\/found\\/?$/.test(new URL(request.url).pathname)) return null;\n  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\\s+/i, '');\n  const player = await env.GF.verifyPlayer(token);\n  if (!player.ok) return Response.json({ ok: false, why: 'Sign in first.' }, { status: 401 });\n  const body = await request.json();\n  if (body?.creature !== 'whale') return Response.json({ ok: false, why: 'Only a whale earns an NFT.' });\n  return Response.json(await voucherFor(env, { grant: 'found-whale', wallet: ${wallet}, round: \`\${player.sub}:\${body.runId}\`, amount: 'grant', person: player.x?.id }));\n}\n\nexport default {\n  async fetch(request, env) {\n    return (await handleVouchers(request, env)) ?? (await handleFound(request, env)) ?? (await handleTides(request, env)) ?? new Response('not found', { status: 404 });\n  },\n};\n`;
  await writeFile(path.join(dir, 'server', 'index.js'), route('body.wallet'));
  let r = await review(dir);
  assert.equal(r.ok, false);
  assert.equal(r.server.facts.pay, 'template');
  assert.deepEqual(cases(r, 'payout-input'), ['request-decides', 'request-names-wallet']);
  assert.deepEqual(
    [r.ledger[0].signer, r.ledger[0].where, r.ledger[0].source, r.ledger[0].decides, r.ledger[0].recipient],
    ['server', 'server/index.js', 'request', 'body', 'request'],
  );
  const told = r.tell.filter(x => x.from === 'server').map(x => x.text);
  assert.ok(!told.some(x => /pays nothing yet/.test(x)), told.join('\n'));
  assert.match(told[0], /^“Found a Whale” is paid on the page's word/);
  assert.equal(r.server.work.claims, true);
  // the same route paying the wallet the player proved: the request still decides, and the sign-in is no state
  await writeFile(path.join(dir, 'server', 'index.js'), route('await walletOf(env, player)'));
  r = await review(dir);
  assert.deepEqual(cases(r, 'payout-input'), ['request-decides']);
  // and one that asks its own clock first: state the server keeps
  await writeFile(
    path.join(dir, 'server', 'index.js'),
    route('await walletOf(env, player)').replace(
      '  return Response.json(await voucherFor(',
      "  if (!(await env.TIDE_CLOCK.get(env.TIDE_CLOCK.idFromName('main')).has(player.sub, 'whale'))) return Response.json({ ok: false });\n  return Response.json(await voucherFor(",
    ),
  );
  r = await review(dir);
  assert.deepEqual(cases(r, 'payout-input'), []);
  assert.deepEqual(
    [r.ledger[0].where, r.ledger[0].source, r.ledger[0].seen],
    ['server/index.js', 'env', 'it uses env.TIDE_CLOCK'],
  );
});

test('one check that pays two grants: the amount and the wallet of each are read from the answer that names it', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  await editJson(path.join(dir, 'xsolana.json'), s => {
    s.tokens.push({ key: 'shell', source: 'game', name: 'Shell', symbol: 'SHELL', decimals: 0 });
    s.grants.push({
      key: 'shells',
      name: 'Shells for a dive',
      prize: { gives: 'tokens', amount: 500, from: 'mint', currency: 'shell' },
      vouchers: [...s.grants[0].vouchers],
      limits: { perPerson: 5, perDay: 1000 },
      trust: 'bounds',
      id: 2,
    });
  });
  // shells: whatever the page says the dive collected; the whale: a tide the server timed
  await writeFile(
    path.join(dir, 'server', 'vouchers.js'),
    await vouchersWith(
      check(
        `if (body?.kind === 'shells') return { grant: 'shells', round: \`\${player.sub}:\${body.dive}\`, amount: body.shells };\n    ${NOT_A_WHALE}\n    if (!(await clockOf(env).has(player.sub, 'whale'))) ${NO_TIDE}\n    return ${TIMED};`,
      ),
      CLOCK,
    ),
  );
  const r = await review(dir);
  assert.deepEqual(
    r.ledger.map(x => [x.route, x.amount, x.recipient]),
    [
      ['grant:found-whale', 'grant', 'proven'],
      ['grant:shells', 'request', 'proven'],
    ],
  );
  assert.deepEqual(
    r.findings.filter(f => f.id === 'payout-input').map(f => [f.route, f.severity, f.cases]),
    [['grant:shells', 'high', ['request-amount']]],
  );
  // a grant no answer names is paid by nothing here: said of that grant, not read off another's
  await edit(path.join(dir, 'server', 'vouchers.js'), t => t.replace("grant: 'shells'", "grant: 'pearls'"));
  const q = await review(dir);
  assert.deepEqual(
    q.ledger.map(x => [x.route, x.signer]),
    [
      ['grant:found-whale', 'server'],
      ['grant:shells', 'none'],
    ],
  );
  assert.match(
    q.findings.find(f => f.id === 'payout-signer' && f.route === 'grant:shells').message,
    /nothing in this game signs one: what signs here \(server \(server\/vouchers\.js\)\) names other grants only/,
  );
});
