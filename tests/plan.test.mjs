// `xcore plan` (lib/publish/plans.mjs): the folder's own game and the saved sign-in, xgames.fun's routes and bodies,
// and the plan said in plain words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { saveSecret } from '../lib/credentials.mjs';
import { credentialKey } from '../lib/publish/client.mjs';
import { accountPlan, describeAccount, describeGame, gamePlan, setActive } from '../lib/publish/plans.mjs';
import { run, tempDir } from './helpers.mjs';

const ORIGIN = 'https://studio.example';
const LIMITS = {
  cpuMs: 200,
  rate: { game: 6000, player: 600 },
  saves: { gameBytes: 1073741824 },
  scores: { boards: 16, entriesPerBoard: 1000000 },
};

test('plan: the account, a game, activate and deactivate, through the routes xgames.fun takes', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  const dir = path.join(tmp.dir, 'game');
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  let active = false;
  const calls = [];
  const game = () => ({
    ok: true,
    game: { id: 'g-77', title: 'Moth', slug: 'moth' },
    tier: active ? 'creator' : 'free',
    capped: false,
    comp: false,
    limits: LIMITS,
    monthCents: 42,
    includedCents: active ? 1000 : 100,
    slots: 1,
    used: active ? 1 : 0,
  });
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: u.pathname, auth: init.headers.authorization, body: init.body ?? null });
    if (u.pathname === '/api/kit/plan')
      return Response.json({
        ok: true,
        slots: 1,
        used: 0,
        billing: true,
        capCents: 0,
        monthCents: 42,
        includedCents: 1000,
        games: [game().game],
      });
    if (u.pathname !== '/api/kit/games/g-77/plan') return new Response('{"error":"no"}', { status: 404 });
    if (init.method === 'POST') {
      const want = JSON.parse(init.body).active;
      const changed = want !== active;
      active = want;
      return Response.json({ ...game(), changed });
    }
    return Response.json(game());
  };
  const opts = { origin: ORIGIN, env, fetchImpl };
  await assert.rejects(gamePlan(dir, opts), /not on https:\/\/studio.example yet: publish it first/);
  await writeFile(path.join(dir, '.gamesfun', 'publish.json'), JSON.stringify({ [ORIGIN]: { projectId: 'g-77' } }));
  await assert.rejects(gamePlan(dir, opts), /not signed in/i);
  await saveSecret(credentialKey(ORIGIN), 'gfk_test_token', { studio: ORIGIN, email: 'a@example.com' }, { env });

  assert.equal((await gamePlan(dir, opts)).tier, 'free');
  const on = await setActive(dir, true, opts);
  assert.equal(on.tier, 'creator');
  assert.equal(on.changed, true);
  assert.equal((await setActive(dir, true, opts)).changed, false);
  assert.equal((await setActive(dir, false, opts)).tier, 'free');
  assert.equal((await accountPlan(opts)).slots, 1);
  assert.deepEqual(
    calls.slice(-5).map(c => `${c.method ?? 'GET'} ${c.path} ${c.body ?? ''}`.trim()),
    [
      'GET /api/kit/games/g-77/plan',
      'POST /api/kit/games/g-77/plan {"active":true}',
      'POST /api/kit/games/g-77/plan {"active":true}',
      'POST /api/kit/games/g-77/plan {"active":false}',
      'GET /api/kit/plan',
    ],
  );
  assert.ok(calls.every(c => c.auth === 'Bearer gfk_test_token'));
});

test('plan in words: the tier, the month, the limits, capped and the slots', () => {
  const words = describeGame({
    game: { title: 'Moth' },
    tier: 'free',
    capped: true,
    comp: false,
    limits: { ...LIMITS, cpuMs: 50, rate: { game: 600, player: 120 } },
    monthCents: 130,
    includedCents: 100,
    slots: 2,
    used: 1,
  });
  assert.match(words, /^Moth: Free, capped for the rest of the month/);
  assert.match(words, /this month: \$1\.30 of \$1\.00 included/);
  assert.match(words, /50 ms of CPU a request, 600 requests a minute \(120 from one player\)/);
  assert.match(words, /paid slots: 1 of 2 in use/);
  const account = describeAccount({
    slots: 0,
    used: 0,
    billing: false,
    monthCents: 0,
    includedCents: 0,
    games: [{ tier: 'scale', title: 'Showground', monthCents: 999, comp: true }],
  });
  assert.match(account, /not open on this xgames.fun yet/);
  const paid = describeAccount({
    slots: 2,
    used: 1,
    payments: { on: true, cluster: 'mainnet-beta', currencies: ['SOL', 'USDC'] },
    periodEnd: Date.parse('2026-12-01T00:00:00Z'),
    creditCents: 500,
    monthCents: 120,
    includedCents: 2000,
    games: [],
  });
  assert.match(
    paid,
    /Game slots: 1 of 2 in use, paid through 2026-12-01 \(buy or renew on xgames.fun: your console → Plans, in SOL or USDC\)/,
  );
  // xgames.fun from 2026-11-08 answers gameSlots: 2 free slots for everyone, any more paid.
  const slots = describeAccount({
    slots: 1,
    used: 1,
    billing: false,
    payments: { on: true, cluster: 'mainnet-beta', currencies: ['SOL'] },
    monthCents: 0,
    games: [],
    gameSlots: { free: { slots: 2, used: 2 }, paid: { slots: 1, used: 1 }, granted: 0, open: 0 },
  });
  assert.match(slots, /^Free slots: 2 of 2 in use \(their games run on Free\); a new game needs one/);
  assert.match(slots, /\nPaid slots: 1 of 1 in use \(their games run on Creator\)/);
  assert.match(paid, /usage credit \$5\.00/);
  assert.match(account, /Scale {3}Showground {2}\$9\.99 {2}\(granted\)/);
});

test('plan --json: a refusal carries its code and the command that moves it on', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = path.join(tmp.dir, 'my game');
  await mkdir(dir);
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>g</title>\n');
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_STUDIO: ORIGIN };
  const r = run(['plan', 'my game', '--json'], { cwd: tmp.dir, env });
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'not-published');
  assert.match(out.next, / publish ['"]my game['"]$/);
  assert.match(out.error, /not on https:\/\/studio\.example yet/);
});
