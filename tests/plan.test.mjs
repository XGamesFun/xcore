// `xcore plan` (lib/publish/plans.mjs): the folder's own game and the saved sign-in, xgames.fun's routes and bodies,
// the account and the plan said in plain words, and an xgames.fun older than per-account plans said as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { saveSecret } from '../lib/credentials.mjs';
import { credentialKey } from '../lib/publish/client.mjs';
import {
  accountPlan,
  CAPPED,
  describeAccount,
  describeGame,
  gamePlan,
  graceDaysLeft,
  PER_ACCOUNT,
  perAccountError,
  unitDollars,
} from '../lib/publish/plans.mjs';
import plan from '../commands/plan.mjs';
import { ROOT, run, runAsync, signIn, standIn, tempDir } from './helpers.mjs';

const ORIGIN = 'https://studio.example';
const LIMITS = {
  cpuMs: 200,
  rate: { game: 6000, player: 600 },
  saves: { gameBytes: 1073741824 },
  scores: { boards: 16, entriesPerBoard: 1000000 },
};
const UNIT_PRICES = [
  { line: 'requests', label: 'Server requests', unit: 'million requests', cents: 60 },
  { line: 'rows_read', label: 'Saves read', unit: 'million rows', cents: 0.2 },
  { line: 'relay_calls', label: 'Solana relay calls', unit: 'million calls', cents: 2000 },
];
const CREATOR = {
  tier: 'creator',
  gameCap: 10,
  gamesUsed: 3,
  priceCents: 1500,
  includedCents: 1000,
  periodEnd: Date.parse('2026-12-20T00:00:00Z'),
  daysLeft: 25,
  inGrace: false,
  unitPrices: UNIT_PRICES,
};
const FREE = {
  tier: 'free',
  gameCap: 2,
  gamesUsed: 1,
  priceCents: 1500,
  includedCents: 100,
  periodEnd: null,
  daysLeft: null,
  inGrace: false,
  unitPrices: UNIT_PRICES,
};
const PAYMENTS = { on: true, cluster: 'mainnet-beta', currencies: ['SOL', 'USDC'] };

test('plan: the account and a game, through the routes xgames.fun takes; nothing is posted', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  const dir = path.join(tmp.dir, 'game');
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: u.pathname, auth: init.headers.authorization });
    if (u.pathname === '/api/kit/plan')
      return Response.json({ ok: true, slots: 0, used: 0, monthCents: 42, games: [], account: CREATOR });
    if (u.pathname === '/api/kit/games/g-77/plan')
      return Response.json({ ok: true, game: { id: 'g-77', title: 'Moth' }, tier: 'creator', account: CREATOR });
    return new Response('{"error":"no"}', { status: 404 });
  };
  const opts = { origin: ORIGIN, env, fetchImpl };
  await assert.rejects(gamePlan(dir, opts), /not on https:\/\/studio.example yet: publish it first/);
  await writeFile(path.join(dir, '.gamesfun', 'publish.json'), JSON.stringify({ [ORIGIN]: { projectId: 'g-77' } }));
  await assert.rejects(gamePlan(dir, opts), /not signed in/i);
  await saveSecret(credentialKey(ORIGIN), 'gfk_test_token', { studio: ORIGIN, email: 'a@example.com' }, { env });

  assert.equal((await gamePlan(dir, opts)).account.tier, 'creator');
  assert.equal((await accountPlan(opts)).account.gameCap, 10);
  assert.deepEqual(
    calls.slice(-2).map(c => `${c.method ?? 'GET'} ${c.path}`),
    ['GET /api/kit/games/g-77/plan', 'GET /api/kit/plan'],
  );
  assert.ok(calls.every(c => c.auth === 'Bearer gfk_test_token'));
  assert.ok(
    calls.every(c => (c.method ?? 'GET') === 'GET'),
    'no slot is moved',
  );
});

test("xgames.fun's 409 per-account is said in xcore's words, with the command that shows the account", async t => {
  assert.equal(
    PER_ACCOUNT,
    'Plans are per account now: a Creator account runs every game you own (up to 10). Buy or renew it in your console → Plans.',
  );
  const studio = Object.assign(new Error('Plans are per account now. A Creator account runs …'), {
    status: 409,
    code: 'per-account',
  });
  const e = perAccountError(studio);
  assert.equal(e.message, PER_ACCOUNT);
  assert.equal(e.code, 'per-account');
  assert.match(e.next, / plan --all$/);
  // any other refusal is left as it was
  const other = Object.assign(new Error('no'), { status: 409, code: 'no-free-slot' });
  assert.equal(perAccountError(other), other);

  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  await saveSecret(credentialKey(ORIGIN), 'gfk_test_token', { studio: ORIGIN }, { env });
  const fetchImpl = async () =>
    Response.json({ error: 'Plans are per account now. …', code: 'per-account' }, { status: 409 });
  await assert.rejects(accountPlan({ origin: ORIGIN, env, fetchImpl }), { message: PER_ACCOUNT, code: 'per-account' });
});

test('plan activate and deactivate exit 2 with the per-account words, and ask xgames.fun nothing', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  // an origin nobody answers: a call to it would fail with "Could not reach", not this
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_STUDIO: 'http://127.0.0.1:9' };
  for (const verb of ['activate', 'deactivate']) {
    const r = run(['plan', verb, tmp.dir], { cwd: tmp.dir, env });
    assert.equal(r.status, 2, verb);
    assert.equal(r.stderr.trim(), `xcore: ${PER_ACCOUNT}`);
    const j = run(['plan', verb, '--json'], { cwd: tmp.dir, env });
    assert.equal(j.status, 2);
    const out = JSON.parse(j.stdout);
    assert.deepEqual([out.ok, out.code, out.error], [false, 'per-account', PER_ACCOUNT]);
    assert.match(out.next, / plan --all$/);
  }
  assert.doesNotMatch(plan.usage, /activate|paid slot|free slot/i, 'the help names neither, nor a slot to move');
});

test("plan's help names both ways to pay for Creator: a card renews by itself, a prepaid period does not", () => {
  const flat = plan.usage.replace(/\s+/g, ' ');
  assert.match(
    flat,
    /by card: it renews automatically every 30 days, charging the card, until you cancel it in Manage billing/,
  );
  assert.match(flat, /prepaid in SOL or USDC, 1 to 12 periods at a time: it does not renew by itself/);
  // use past the included: on the card's invoice up to the spending cap, or from usage credit when prepaid
  assert.match(flat, /paid by card, it goes on the card's invoice, up to the monthly spending cap you set/);
  assert.match(flat, /prepaid, usage credit \(bought in SOL or USDC\) pays for it/);
  assert.doesNotMatch(flat, /\$15 per 30 days, prepaid in SOL or USDC/, 'never SOL or USDC as the only way');
});

test('plan in words: the tier, the month, the limits, capped and the slots (an xgames.fun without accounts)', () => {
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
  // what a cap does is said as the help and the documents say it: the server is off, never "slow"
  assert.match(
    words,
    /\n {2}capped: its server is switched off \(every api\/ request answers 451\), its pages keep loading, and saves and scores slow down, until the month ends or it gets more room\n/,
  );
  assert.doesNotMatch(words, /answers slowly|60 requests a minute/);
  assert.match(words, /this month: \$1\.30 of \$1\.00 included/);
  assert.match(words, /50 ms of CPU a request, 600 requests a minute \(120 from one player\)/);
  assert.match(words, /paid slots: 1 of 2 in use/);
  assert.doesNotMatch(words, /Account:/);
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
    payments: PAYMENTS,
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
  // xgames.fun answers gameSlots: 2 free slots for everyone, any more paid.
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
  assert.doesNotMatch(slots, /move one to a paid slot/, 'no command moves a slot any more');
  assert.match(slots, /\nPaid slots: 1 of 1 in use \(their games run on Creator\)/);
  assert.match(paid, /usage credit \$5\.00/);
  assert.match(account, /Scale {3}Showground {2}\$9\.99 {2}\(granted\)/);
  assert.doesNotMatch(describeAccount({ slots: 0, used: 0, games: [] }, { verbose: true }), /unit prices|per million/i);
});

test('the account in words: Creator with its games, period, shared use and credit; Free with what Creator adds', () => {
  const creator = describeAccount({
    ok: true,
    slots: 0,
    used: 0,
    payments: PAYMENTS,
    monthCents: 310,
    includedCents: 1000,
    creditCents: 500,
    games: [
      { tier: 'creator', title: 'Moth', monthCents: 210 },
      { tier: 'creator', title: 'Bubble', monthCents: 100, capped: false },
    ],
    account: CREATOR,
  });
  assert.equal(
    creator,
    [
      'Account: Creator, 3 of 10 games, paid through 2026-12-20 (25 days left)',
      '  this month: $3.10 of $10.00 included, shared by your games; usage credit $5.00',
      '  renew: your console → Plans, in SOL or USDC ($15.00 per 30 days; it does not renew by itself)',
      'Games:',
      '  Creator Moth  $2.10',
      '  Creator Bubble  $1.00',
    ].join('\n'),
  );
  assert.doesNotMatch(creator, /slot/i);
  assert.doesNotMatch(creator, /per million/, 'unit prices with --verbose only');

  // paid by card: it renews by itself, and use past what is included goes on the card invoice up to the cap
  const card = describeAccount(
    { ok: true, payments: PAYMENTS, monthCents: 0, capCents: 2500, games: [], account: { ...CREATOR, method: 'card' } },
    { verbose: true },
  );
  assert.match(
    card,
    /\n {2}renews: by card on 2026-12-20; change the card or cancel in your console → Plans → Manage billing\n/,
  );
  assert.doesNotMatch(card, /does not renew by itself|usage credit pays/);
  assert.match(
    card,
    /Past what is included, use goes on your card invoice at these prices, up to your spending cap \(\$25\.00\):/,
  );
  assert.match(
    describeAccount({ games: [], account: { ...CREATOR, method: 'card' } }, { verbose: true }),
    /up to your spending cap \(none set\):/,
  );

  const free = describeAccount({ ok: true, payments: PAYMENTS, monthCents: 42, games: [], account: FREE });
  assert.match(
    free,
    /^Account: Free, 1 of 2 games\n {2}this month: \$0\.42 in all; \$1\.00 of use included per game\n/,
  );
  assert.match(
    free,
    /\n {2}Creator: \$15\.00 per 30 days runs every game you own \(up to 10\) at Creator limits, with \$10\.00 of use a month shared: your console → Plans, in SOL or USDC$/,
  );

  // at the cap, said plainly
  assert.match(
    describeAccount({ games: [], account: { ...FREE, gamesUsed: 2 } }),
    /all 2 games Free allows are in use: a new game is refused until you archive one \(your console\) or buy a Creator account/,
  );
  assert.match(
    describeAccount({ games: [], account: { ...CREATOR, gamesUsed: 10 } }),
    /every game the account may have is in use: a new game is refused until you archive one/,
  );
  // in grace: what happens if it is not renewed, and the grace's days left (daysLeft is 0 then: graceUntil says)
  const ended = Date.parse('2026-11-20T00:00:00Z');
  const now = Date.parse('2026-11-25T12:00:00Z');
  const inGrace = { ...CREATOR, inGrace: true, periodEnd: ended, daysLeft: 0, graceUntil: ended + 7 * 86_400_000 };
  assert.match(
    describeAccount({ games: [], account: inGrace }, { now }),
    /^Account: Creator, 3 of 10 games; its period ended 2026-11-20 and it is in its 7 days' grace \(2 days left\): renew it, or every game drops to Free limits \(nothing is taken down\)/,
  );
  // an xgames.fun that sends no graceUntil: the period's end and 7 days
  const { graceUntil: _g, ...noGrace } = inGrace;
  assert.match(describeAccount({ games: [], account: noGrace }, { now }), /7 days' grace \(2 days left\)/);
  assert.equal(graceDaysLeft(noGrace, ended + 7 * 86_400_000 - 1), 1);
  assert.equal(graceDaysLeft(noGrace, ended + 8 * 86_400_000), 0);
  assert.equal(graceDaysLeft({ graceUntil: null, periodEnd: null }), null);
  assert.equal(graceDaysLeft({ ...inGrace, graceUntil: ended + 86_400_000 }, ended + 1), 1, 'graceUntil wins');

  // a card account in its grace days is never told it renews: a failed charge, or an ended subscription
  const LIVE_PAY = { card: { ok: false, code: 'has-subscription' }, solana: { ok: false, code: 'card' } };
  const ENDED_PAY = { card: { ok: true }, solana: { ok: true } };
  const failed = describeAccount(
    { games: [], account: { ...inGrace, method: 'card', pay: LIVE_PAY }, capCents: 2500 },
    { now, verbose: true },
  );
  assert.match(
    failed,
    /^Account: Creator, 3 of 10 games; its card payment failed and it is in its 7 days' grace \(2 days left\): update the card in your console → Plans → Manage billing, or every game drops to Free limits/,
  );
  assert.doesNotMatch(failed, /renews: by card on \d/);
  assert.match(
    failed,
    /\n {2}renews: by card once the card pays; update the card or cancel in your console → Plans → Manage billing\n/,
  );
  const endedCard = describeAccount(
    { games: [], payments: PAYMENTS, account: { ...inGrace, method: 'card', pay: ENDED_PAY } },
    { now, verbose: true },
  );
  assert.match(
    endedCard,
    /^Account: Creator, 3 of 10 games; its card subscription ended \(paid through 2026-11-20\) and it is in its 7 days' grace \(2 days left\): renew it in your console → Plans/,
  );
  assert.doesNotMatch(endedCard, /renews:|card invoice/);
  assert.match(
    endedCard,
    /\n {2}renew: your console → Plans, in SOL or USDC, or by card \(\$15\.00 per 30 days; a cancelled card subscription does not renew\)/,
  );
  assert.match(endedCard, /usage credit pays for use at these prices/);
  // cancelled with days left: paid through its end, and no renewal promised
  const cancelled = describeAccount({
    games: [],
    payments: PAYMENTS,
    account: { ...CREATOR, method: 'card', pay: ENDED_PAY },
  });
  assert.match(
    cancelled,
    /^Account: Creator, 3 of 10 games, paid through 2026-12-20 \(25 days left\); its card subscription is cancelled\n/,
  );
  assert.doesNotMatch(cancelled, /renews:/);
  // a live one with xgames.fun's pay still renews
  assert.match(
    describeAccount({ games: [], account: { ...CREATOR, method: 'card', pay: LIVE_PAY } }),
    /\n {2}renews: by card on 2026-12-20;/,
  );

  // --verbose: the unit prices xgames.fun published, to the fraction of a cent they need
  const verbose = describeAccount({ games: [], account: CREATOR }, { verbose: true });
  assert.match(verbose, /\nPast what is included, usage credit pays for use at these prices:\n/);
  assert.match(verbose, /\n {2}Server requests {5}\$0\.60 per million requests\n/);
  assert.match(verbose, /\n {2}Saves read {10}\$0\.002 per million rows\n/);
  assert.match(verbose, /\n {2}Solana relay calls {2}\$20\.00 per million calls$/);
  assert.match(
    describeAccount({ games: [], account: { ...CREATOR, unitPrices: [] } }, { verbose: true }),
    /xgames.fun did not list them \(docs\/FEES.md has them\)/,
  );
  assert.deepEqual([0.2, 1.5, 60, 2000].map(unitDollars), ['$0.002', '$0.015', '$0.60', '$20.00']);
});

test("a game in words on a Creator account: the account first, the game's part of the shared use", () => {
  const words = describeGame(
    {
      game: { title: 'Moth' },
      tier: 'creator',
      capped: false,
      comp: false,
      limits: LIMITS,
      monthCents: 210,
      includedCents: 1000,
      slots: 0,
      used: 0,
      account: CREATOR,
    },
    { pool: { monthCents: 310, creditCents: 0, payments: PAYMENTS } },
  );
  assert.match(words, /^Account: Creator, 3 of 10 games, paid through 2026-12-20 \(25 days left\)\n/);
  assert.match(words, /\n {2}this month: \$3\.10 of \$10\.00 included, shared by your games\n/);
  assert.match(words, /\n\nMoth: Creator\n {2}this month: \$2\.10 \(its part of what the account includes\)\n/);
  assert.doesNotMatch(words, /slot/i);
  // without the account's own answer, its month is left out, not guessed
  const alone = describeGame({
    game: { title: 'Moth' },
    tier: 'free',
    monthCents: 42,
    includedCents: 100,
    account: FREE,
  });
  assert.match(alone, /^Account: Free, 1 of 2 games\n {2}this month: \$1\.00 of use included per game\n/);
  assert.match(alone, /\nMoth: Free\n {2}this month: \$0\.42 of \$1\.00 included/);
  assert.match(describeGame({ tier: 'free', account: FREE }, { verbose: true }), /\n {2}Server requests/);
});

test('what a cap does to a game is one statement: `xcore plan`, its help, docs/HOSTING.md and docs/SERVER.md agree', async () => {
  const flat = text => text.replace(/\s+/g, ' ');
  assert.ok(flat(plan.usage).includes(`the game is capped until the month ends: ${CAPPED}`), plan.usage);
  const hosting = flat(await readFile(path.join(ROOT, 'docs', 'HOSTING.md'), 'utf8'));
  assert.match(
    hosting,
    /a game is \*\*capped\*\* until the month ends: \*\*its server is switched off\*\* \(every `api\/\*` request answers 451 /,
  );
  assert.match(hosting, /and saves and scores slow down .* Its pages keep loading/);
  const server = flat(await readFile(path.join(ROOT, 'docs', 'SERVER.md'), 'utf8'));
  assert.match(
    server,
    /\*\*A game that is unpublished, taken down or capped\*\* .* has its server switched off: every `api\/\*` request answers `451 /,
  );
});

test('plan --all: the account as words, and --json with the account and the fields older versions printed', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  await signIn(g, env);
  const answer = {
    ok: true,
    slots: 0,
    used: 0,
    gameSlots: { free: { slots: 2, used: 0 }, paid: { slots: 0, used: 0 }, granted: 0, open: 2 },
    payments: PAYMENTS,
    monthCents: 310,
    includedCents: 1000,
    creditCents: 0,
    periodEnd: CREATOR.periodEnd,
    games: [{ tier: 'creator', title: 'Moth', monthCents: 310 }],
    account: CREATOR,
  };
  let reply = answer;
  const game = {
    ok: true,
    game: { title: 'Moth' },
    tier: 'creator',
    limits: LIMITS,
    monthCents: 310,
    account: CREATOR,
  };
  g.state.handle = (method, url) =>
    method !== 'GET'
      ? null
      : url === '/api/kit/plan'
        ? [200, reply]
        : url === '/api/kit/games/g-77/plan'
          ? [200, game]
          : null;
  const cli = { env: { ...env, GAMESFUN_STUDIO: g.origin } };
  // one game: the account first, its month from the account's own answer
  const dir = path.join(tmp.dir, 'moth');
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>Moth</title>\n');
  await writeFile(path.join(dir, '.gamesfun', 'publish.json'), JSON.stringify({ [g.origin]: { projectId: 'g-77' } }));
  const one = await runAsync(['plan', dir], cli);
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /^Account: Creator, 3 of 10 games.*\n {2}this month: \$3\.10 of \$10\.00 included/);
  assert.match(one.stdout, /\nMoth: Creator\n/);
  assert.deepEqual(JSON.parse((await runAsync(['plan', dir, '--json'], cli)).stdout), game);
  const words = await runAsync(['plan', '--all', '--verbose'], cli);
  assert.equal(words.status, 0, words.stderr);
  assert.match(words.stdout, /^Account: Creator, 3 of 10 games/);
  assert.match(words.stdout, /\n {2}Creator Moth {2}\$3\.10\n/);
  assert.match(words.stdout, /Solana relay calls {2}\$20\.00 per million calls/);
  const json = JSON.parse((await runAsync(['plan', '--all', '--json'], cli)).stdout);
  assert.deepEqual(json.account, CREATOR);
  for (const old of ['slots', 'used', 'gameSlots', 'games', 'includedCents', 'monthCents', 'creditCents', 'periodEnd'])
    assert.ok(Object.hasOwn(json, old), old);

  // the xgames.fun of today, with no account: the slots, as before
  const { account: _, ...old } = answer;
  reply = old;
  const before = await runAsync(['plan', '--all'], cli);
  assert.match(before.stdout, /^Free slots: 0 of 2 in use \(their games run on Free\)\nPaid slots: 0 of 0 in use/);
  assert.equal(JSON.parse((await runAsync(['plan', '--all', '--json'], cli)).stdout).account, undefined);
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
