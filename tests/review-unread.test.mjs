// `xcore review` never passes what it did not read: a live game that did not answer, a file it could not open, a page
// file too big to read in one go, and a review that could not finish. Each is a part not read (INCONCLUSIVE, exit 3),
// said beside the verdict, and never a finding about the game made out of a request that got no answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { liveReview, reviewGame } from '../lib/review.mjs';
import { ROOT, run, tempDir } from './helpers.mjs';

const SAMPLES = path.join(ROOT, 'tests', 'fixtures', 'review');
const INSTALLED = { ...process.env, GAMESFUN_SOLANA: '' };
const review = (dir, o = {}) => reviewGame(dir, { env: INSTALLED, ...o });
const sample = async (tmp, name, as = name) => {
  const dir = path.join(tmp.dir, as);
  await cp(path.join(SAMPLES, name), dir, { recursive: true });
  return dir;
};
const ids = r =>
  r.findings.filter(f => f.source !== 'economy' && f.source !== 'design').map(f => `${f.severity} ${f.id}`);
// nothing listens on port 9 here (discard): every request fails to connect
const NOWHERE = 'http://127.0.0.1:9/game/';
// a mode-000 file is still readable by root
const asRoot = process.getuid?.() === 0;

test('a live game that answers nothing was not reached: INCONCLUSIVE, no finding made of "fetch failed", and the summary says so', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  const r = await review(dir, { live: NOWHERE });
  assert.equal(r.verdict, 'INCONCLUSIVE');
  assert.equal(r.ok, false);
  // the key route and the economy file got no answer: nothing is said of the server's key or its economy
  assert.ok(!ids(r).some(f => / live-/.test(f)), ids(r).join(', '));
  const live = r.unread.find(u => u.live);
  assert.ok(live, JSON.stringify(r.unread));
  assert.equal(live.what, `live: ${NOWHERE}`);
  assert.match(live.why, /^not reached \((\d+) of \1 requests failed/);
  assert.equal(r.live.unanswered.length, r.live.asked);
  const md = await readFile(path.join(r.outDir, 'review.md'), 'utf8');
  assert.match(md, /as a stranger \(no sign-in, and a forged one\): it did not answer \(see "Not read"\)/);
  assert.match(md, /^- api\/vouchers\/key: no answer \(/m);
  // the command: exit 3, and its summary never names the address as if it had been asked
  const c = run(['review', dir, '--live', NOWHERE], { env: { GAMESFUN_SOLANA: '' } });
  assert.equal(c.status, 3, c.stdout + c.stderr);
  assert.match(c.stdout, /^review: INCONCLUSIVE /);
  assert.match(c.stdout, /; live: not reached \((\d+) of \1 requests failed\)$/m);
  assert.ok(!/signs no voucher/.test(c.stdout), c.stdout);
  const j = JSON.parse(run(['review', dir, '--live', NOWHERE, '--json'], { env: { GAMESFUN_SOLANA: '' } }).stdout);
  assert.equal(j.verdict, 'INCONCLUSIVE');
  assert.ok(j.unread.some(u => u.live));
});

test('a live game that answers some requests and not others: the ones without an answer are not read', async () => {
  const fetchImpl = async (url, o) => {
    if (url.endsWith('/api/scores')) throw new TypeError('fetch failed');
    const key = url.endsWith('/vouchers/key') && (o?.method ?? 'GET') === 'GET';
    return new Response(JSON.stringify(key ? { ok: true, publicKey: 'K' } : { ok: false }), {
      status: key ? 200 : 401,
    });
  };
  const r = await liveReview('https://g.example/', {
    routes: [{ path: 'api/scores' }, { path: 'api/vouchers/key' }],
    keys: ['K'],
    vouchers: true,
    fetchImpl,
  });
  assert.equal(r.asked, 9);
  assert.deepEqual(
    r.unanswered.map(u => u.what),
    [
      'GET api/scores (no sign-in)',
      'GET api/scores (a forged sign-in)',
      'POST api/scores (no sign-in)',
      'POST api/scores (a forged sign-in)',
    ],
  );
  assert.deepEqual(r.findings, []);
});

test('a page file bigger than 8 MB is searched whole: a seed past its first 8 MB is found', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  await writeFile(
    path.join(dir, 'levels.js'),
    `//${'x'.repeat(9 * 1048576)}\nconst VOUCHER_SEED = '${'c3'.repeat(32)}';\n`,
  );
  const r = await review(dir);
  assert.deepEqual(r.unread, []);
  assert.equal(r.verdict, 'FAIL');
  const custody = r.findings.find(f => f.id === 'key-custody');
  assert.ok(custody, ids(r).join(', '));
  assert.match(JSON.stringify(r.custody), /levels\.js:2/);
});

test(
  'a server or page file that cannot be opened is a part not read: INCONCLUSIVE, never a crash with FAIL’s exit code',
  { skip: asRoot && 'root reads mode-000 files' },
  async t => {
    const tmp = await tempDir();
    const dir = await sample(tmp, 'bounded');
    const helper = path.join(dir, 'server', 'tides.js');
    const page = path.join(dir, 'game.js');
    t.after(async () => {
      await chmod(helper, 0o644).catch(() => {});
      await chmod(page, 0o644).catch(() => {});
      await tmp.cleanup();
    });
    await chmod(helper, 0o000);
    let r = await review(dir);
    assert.equal(r.verdict, 'INCONCLUSIVE');
    assert.deepEqual(
      r.unread.find(u => u.what === 'server/tides.js'),
      { what: 'server/tides.js', why: 'it could not be opened (EACCES)', payout: true },
    );
    const c = run(['review', dir, '--json'], { env: { GAMESFUN_SOLANA: '' } });
    assert.equal(c.status, 3, c.stderr);
    assert.equal(JSON.parse(c.stdout).verdict, 'INCONCLUSIVE');
    // server/vouchers.js itself: the check is not read, said as that, and no "PAY.check not found" high
    await chmod(helper, 0o644);
    await chmod(path.join(dir, 'server', 'vouchers.js'), 0o000);
    r = await review(dir);
    await chmod(path.join(dir, 'server', 'vouchers.js'), 0o644);
    assert.equal(r.verdict, 'INCONCLUSIVE');
    assert.equal(r.server.facts.pay, 'unopened');
    assert.ok(!ids(r).includes('high pay-unreadable'), ids(r).join(', '));
    assert.ok(r.unread.some(u => u.what === 'server/vouchers.js' && u.payout));
    // a page file: not searched for a key
    await chmod(page, 0o000);
    r = await review(dir);
    assert.equal(r.verdict, 'INCONCLUSIVE');
    assert.deepEqual(
      r.unread.find(u => u.what === 'game.js'),
      {
        what: 'game.js',
        why: 'it could not be opened (EACCES): not searched for a key or a seed',
        key: true,
      },
    );
  },
);

test('a review that cannot finish exits 3 (INCONCLUSIVE) with the verdict in its JSON, never 1', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await sample(tmp, 'bounded');
  // the record cannot be written where --out says: a file is in the way
  const blocked = path.join(tmp.dir, 'in-the-way');
  await writeFile(blocked, '');
  const c = run(['review', dir, '--out', path.join(blocked, 'review'), '--json'], { env: { GAMESFUN_SOLANA: '' } });
  assert.equal(c.status, 3, c.stdout + c.stderr);
  const j = JSON.parse(c.stdout);
  assert.deepEqual([j.ok, j.verdict, j.code], [false, 'INCONCLUSIVE', 'review-unfinished']);
  const plain = run(['review', dir, '--out', path.join(blocked, 'review')], { env: { GAMESFUN_SOLANA: '' } });
  assert.equal(plain.status, 3);
  assert.match(plain.stderr, /^review: INCONCLUSIVE: the review could not finish \(/);
});
