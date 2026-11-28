// The reading of a payout follows a value to where it comes from: a wallet written to the answer after it is made,
// spread into it, or read from the player's own save; a grant the request picks; a round the request names, a helper
// makes or the clock gives each second; a paid-read that answers "not paid" in any falsy word. Each unsafe one is a high
// finding (or, where the reading can't follow it, a part not read), and each safe spelling stays quiet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { failOpenPaidReads, reviewGame } from '../lib/review.mjs';
import { ROOT, tempDir } from './helpers.mjs';

const SAMPLES = path.join(ROOT, 'tests', 'fixtures', 'review');
const INSTALLED = { ...process.env, GAMESFUN_SOLANA: '' };
const review = dir => reviewGame(dir, { env: INSTALLED });
const cases = (r, id) => r.findings.filter(f => f.id === id).flatMap(f => f.cases ?? []);
const high = r => r.findings.filter(f => f.severity === 'high' && f.source !== 'economy').map(f => f.id);

/** The bounded sample with the game's database helper, its grant's limits as given, and PAY.check as `body`. */
async function game(tmp, name, { limits = null, more = null } = {}) {
  const dir = path.join(tmp.dir, name);
  await cp(path.join(SAMPLES, 'bounded'), dir, { recursive: true });
  await writeFile(
    path.join(dir, 'server', 'gf-db.js'),
    (await readFile(path.join(ROOT, 'lib', 'client', 'server', 'gf-db.js'), 'utf8')).replace('__BINDING__', 'DB'),
  );
  const file = path.join(dir, 'xsolana.json');
  const spec = JSON.parse(await readFile(file, 'utf8'));
  if (limits) spec.grants[0].limits = limits;
  if (more) spec.grants.push({ ...spec.grants[0], ...more });
  await writeFile(file, JSON.stringify(spec, null, 2));
  return dir;
}
const own = await readFile(path.join(SAMPLES, 'bounded', 'server', 'vouchers.js'), 'utf8');
/** server/vouchers.js with PAY.check's body as given (and `above` over PAY), the rest as the sample has it. */
const withCheck = (dir, body, above = '') =>
  writeFile(
    path.join(dir, 'server', 'vouchers.js'),
    `import { db } from './gf-db.js';\n${above}\nexport const PAY = {\n  async check({ body, player, env }) {\n    ${body}\n  },\n};\n\n${own.slice(own.indexOf('export const VOUCHERS'))}`,
  );
// a run the server started for this player, looked up by the id the page sends back
const RUN =
  "const run = await db(env).first('SELECT player, started_at FROM runs WHERE id = ?', String(body.runId));\n    if (!run || run.player !== player.sub) return { why: 'Not a run this server started for you.' };\n    if (Date.now() - run.started_at < 60_000) return { why: 'Faster than the game allows.' };\n    ";

test('the wallet: written to the answer after it is made, spread into it, or read from a save, is the request’s', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp, 'w');
  const wallet = async (body, above) => {
    await withCheck(dir, RUN + body, above);
    return review(dir);
  };
  let r = await wallet(
    "const out = { grant: 'found-whale', round: body.runId, amount: 'grant' };\n    out.wallet = body.wallet;\n    return out;",
  );
  assert.equal(r.verdict, 'FAIL');
  assert.deepEqual(cases(r, 'payout-input'), ['request-names-wallet']);
  assert.equal(r.ledger[0].recipient, 'request');
  // (spread after them, the request's fields can set the amount too)
  r = await wallet("return { grant: 'found-whale', round: body.runId, amount: 'grant', ...body.payTo };");
  assert.deepEqual(cases(r, 'payout-input'), ['request-names-wallet', 'request-amount']);
  r = await wallet(
    "const out = { grant: 'found-whale', round: body.runId, amount: 'grant' };\n    Object.assign(out, { wallet: body.to });\n    return out;",
  );
  assert.deepEqual(cases(r, 'payout-input'), ['request-names-wallet']);
  r = await wallet(
    "const profile = await env.GF.saves.get(player.sub, 'profile');\n    return { grant: 'found-whale', round: body.runId, amount: 'grant', wallet: profile.value?.wallet };",
  );
  assert.deepEqual(cases(r, 'payout-input'), ['request-names-wallet'], 'a save is the player’s word');
  // something spread in that can't be traced: who is paid is not read
  r = await wallet("return { grant: 'found-whale', round: body.runId, amount: 'grant', ...globalThis.PAYEE };");
  assert.equal(r.verdict, 'INCONCLUSIVE');
  assert.equal(r.ledger[0].recipient, 'unread');
  assert.match(
    r.unread.find(u => u.what === 'server/vouchers.js').why,
    /spreads into its answer \(globalThis\.PAYEE\)/,
  );
  // safe: the proven wallet by name, a round set afterwards, what the run row holds
  for (const body of [
    "const wallet = await walletOf(env, player);\n    return { grant: 'found-whale', round: body.runId, amount: 'grant', wallet };",
    "const out = { grant: 'found-whale', amount: 'grant' };\n    out.round = body.runId;\n    return out;",
    "return { grant: 'found-whale', round: body.runId, amount: 'grant', wallet: run.wallet };",
  ]) {
    r = await wallet(body, "import { walletOf } from './gf-wallets.js';");
    assert.deepEqual(high(r), [], body);
    assert.equal(r.verdict, 'PASS', `${body}: ${JSON.stringify(r.unread)}`);
  }
});

test('a grant the request picks, among several: high; one grant, or a grant the code names: nothing', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp, 'g', { more: { key: 'jackpot', name: 'Jackpot', id: 2 } });
  await withCheck(dir, `${RUN}return { grant: body.grant, round: body.runId, amount: 'grant' };`);
  let r = await review(dir);
  assert.equal(r.verdict, 'FAIL');
  assert.ok(cases(r, 'payout-input').includes('request-grant'), JSON.stringify(r.findings));
  assert.match(
    r.findings.find(f => f.cases?.includes('request-grant')).message,
    /the request picks which grant pays .* of the 2 grants a voucher pays, a script asks for the biggest every time/,
  );
  await withCheck(dir, `${RUN}const grant = body.grant;\n    return { grant, round: body.runId, amount: 'grant' };`);
  assert.ok(cases(await review(dir), 'payout-input').includes('request-grant'), 'through a name it was given');
  await withCheck(
    dir,
    `${RUN}return { grant: run.level > 5 ? 'jackpot' : 'found-whale', round: body.runId, amount: 'grant' };`,
  );
  assert.deepEqual(cases(await review(dir), 'payout-input'), []);
  const one = await game(tmp, 'g1');
  await withCheck(one, `${RUN}return { grant: body.grant, round: body.runId, amount: 'grant' };`);
  assert.deepEqual(cases(await review(one), 'payout-input'), [], 'with one grant the request picks nothing');
});

test('a round new on every request, however it is made, or one the request names and the check never looks up: high with nothing per player', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp, 'f', { limits: { perDay: 100 } });
  const round = async (expr, above = '') => {
    await withCheck(dir, `${RUN}return { grant: 'found-whale', round: ${expr}, amount: 'grant' };`, above);
    return review(dir);
  };
  for (const [expr, above, want] of [
    ['newRound()', 'function newRound() {\n  return crypto.randomUUID();\n}', 'round-fresh'],
    ['`${player.sub}:${Math.floor(Date.now() / 1000)}`', '', 'round-fresh'],
    ['String(body.nonce)', '', 'round-request'],
    ['`${body.runId}:${body.checkpoint}`', '', 'round-request'],
  ]) {
    const r = await round(expr, above);
    assert.equal(r.verdict, 'FAIL', expr);
    assert.ok(cases(r, 'payout-input').includes(want), `${expr}: ${cases(r, 'payout-input')}`);
  }
  const r = await round('`${body.runId}:${body.checkpoint}`');
  assert.match(
    r.findings.find(f => f.cases?.includes('round-request')).message,
    /its round comes from the request \(body\.checkpoint\), which the check never looks state up by/,
  );
  // the run's own id, looked up; a day's bucket of the clock: nothing
  for (const expr of ['body.runId', '`${player.sub}:${Math.floor(Date.now() / 86_400_000)}`'])
    assert.deepEqual(cases(await round(expr), 'payout-input'), [], expr);
  // a round made by a function the reading did not follow: not read
  const u = await round('makeRound(body.runId)', "import { makeRound } from './rounds-not-here.js';");
  assert.equal(u.verdict, 'INCONCLUSIVE');
  assert.match(u.unread.find(x => x.what === 'server/vouchers.js').why, /its round, made by makeRound\(\)/);
  // a per-person limit bounds a round the request names as it bounds one the server gave out
  const bounded = await game(tmp, 'p');
  await withCheck(bounded, `${RUN}return { grant: 'found-whale', round: String(body.nonce), amount: 'grant' };`);
  assert.ok(!cases(await review(bounded), 'payout-input').includes('round-request'));
});

test('a paid-read that answers null, undefined or 0 when the chain fails is open when the answer is read as "not paid"', () => {
  const of = code => failOpenPaidReads([{ f: 'resign.js', code, text: code }]).map(o => `${o.where}:${o.line}`);
  const read = fallback =>
    `const paid = await winPaid({ rpc, game, grant: 1, wallet, round }).catch(() => ${fallback});\nif (paid) return Response.json({ why: 'Paid already.' });\nreturn sign();`;
  for (const f of ['null', 'undefined', '0', 'false', '{}']) assert.deepEqual(of(read(f)), ['server/resign.js:1'], f);
  // told apart from "not paid": closed
  assert.deepEqual(
    of(
      "const paid = await winPaid({ rpc, game, grant: 1, wallet, round }).catch(() => null);\nif (paid === null) return Response.json({ why: 'Try again in a moment.' });\nif (paid) return Response.json({ why: 'Paid already.' });",
    ),
    [],
  );
});

test('stored input: a request value copied to a name first, given to a Durable Object, or a board the page writes; and a value that only picks the row is not', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp, 's');
  const stored = r => r.findings.filter(f => f.id === 'payout-stored-input').map(f => f.message);
  await withCheck(
    dir,
    "const s = await db(env).first('SELECT best FROM scores WHERE player = ?', player.sub);\n    if (!s || s.best < 1000) return { why: 'Score 1000 first.' };\n    return { grant: 'found-whale', round: `${player.sub}:whale`, amount: 'grant' };",
  );
  const route = body =>
    writeFile(
      path.join(dir, 'server', 'score.js'),
      `import { db, withPlayer } from './gf-db.js';\nexport async function handleScore(request, env) {\n  const sub = await withPlayer(request, env);\n  const b = await request.json();\n  ${body}\n  return Response.json({ ok: true });\n}\n`,
    );
  await route(
    "const best = Math.floor(Number(b.score));\n  await db(env).run('INSERT OR REPLACE INTO scores (player, best) VALUES (?, ?)', sub, best);",
  );
  let r = await review(dir);
  assert.equal(r.verdict, 'FAIL');
  assert.match(
    stored(r)[0],
    /reads the table scores, and server\/score\.js:6 writes it with what a request sent \(best\)/,
  );
  // the request's id only picks the row, and the column it writes is the server's clock, which the check never reads
  await route(
    "await db(env).run('UPDATE scores SET finished_at = ? WHERE player = ? AND run = ?', Date.now(), sub, String(b.run));",
  );
  r = await review(dir);
  assert.deepEqual(stored(r), []);
  assert.equal(r.verdict, 'PASS', JSON.stringify(r.findings.map(f => f.id)));
  // the same UPDATE storing the request's score in the column the check reads
  await route("await db(env).run('UPDATE scores SET best = ? WHERE player = ?', Number(b.score), sub);");
  assert.equal(stored(await review(dir)).length, 1);
  // a Durable Object the check reads, given the request's score by a method that writes its storage
  await withCheck(
    dir,
    "const best = await env.BEST.get(env.BEST.idFromName(player.sub)).best();\n    if (best < 1000) return { why: 'Score 1000 first.' };\n    return { grant: 'found-whale', round: `${player.sub}:whale`, amount: 'grant' };",
  );
  await writeFile(
    path.join(dir, 'server', 'best.js'),
    "import { DurableObject } from 'cloudflare:workers';\nexport class Best extends DurableObject {\n  async record(score) { await this.ctx.storage.put('best', score); }\n  async best() { return (await this.ctx.storage.get('best')) ?? 0; }\n}\nexport async function handleBest(request, env) {\n  const player = await env.GF.verifyPlayer((request.headers.get('authorization') ?? '').slice(7));\n  const body = await request.json();\n  await env.BEST.get(env.BEST.idFromName(player.sub)).record(Number(body.score));\n  return Response.json({ ok: true });\n}\n",
  );
  r = await review(dir);
  assert.equal(r.verdict, 'FAIL');
  assert.match(stored(r)[0], /reads env\.BEST, and server\/best\.js:9 writes it with what a request sent \(body\)/);
  // a board the page writes (no writer: 'server'): player input; one the server makes its own: state
  await withCheck(
    dir,
    "const best = await env.GF.scores.best('main', player.sub);\n    if (!best || best.score < 1000) return { why: 'Score 1000 first.' };\n    return { grant: 'found-whale', round: `${player.sub}:whale`, amount: 'grant' };",
  );
  r = await review(dir);
  assert.equal(r.verdict, 'FAIL');
  assert.deepEqual(cases(r, 'payout-input'), ['request-decides']);
  assert.match(r.ledger[0].seen ?? '', /env\.GF\.scores, which the player writes/);
  await writeFile(
    path.join(dir, 'server', 'boards.js'),
    "export const boards = env => env.GF.scores.setup('main', { writer: 'server' });\n",
  );
  r = await review(dir);
  assert.equal(r.ledger[0].source, 'env');
  assert.deepEqual(cases(r, 'payout-input'), []);
});

test('a KV put whose key alone is the request’s stores nothing of it; one whose value is the request’s does', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp, 'kv');
  await withCheck(
    dir,
    "const run = await env.RUNS.get(String(body.runId), 'json');\n    if (!run || run.player !== player.sub) return { why: 'no' };\n    return { grant: 'found-whale', round: body.runId, amount: 'grant' };",
  );
  const start = value =>
    writeFile(
      path.join(dir, 'server', 'start.js'),
      `export async function start(request, env) {\n  const player = await env.GF.verifyPlayer(request.headers.get('authorization'));\n  const b = await request.json();\n  await env.RUNS.put(b.runId, ${value});\n  return new Response('ok');\n}\n`,
    );
  await start('JSON.stringify({ player: player.sub, at: Date.now() })');
  let r = await review(dir);
  assert.ok(!r.findings.some(f => f.id === 'payout-stored-input'), JSON.stringify(r.findings.map(f => f.id)));
  await start('JSON.stringify({ player: player.sub, at: b.startedAt })');
  r = await review(dir);
  assert.ok(r.findings.some(f => f.id === 'payout-stored-input'));
});
