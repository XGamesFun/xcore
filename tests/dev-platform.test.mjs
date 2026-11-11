// `xcore dev`'s platform (lib/dev/platform.mjs) answers as xgames.fun's does, on the plan it imitates (lib/dev/plans.mjs):
// the boards a page may make, a board read's player ids and its depth, the ranks' depth, a player's share of the
// game's saves and the floor, writes and reads a minute, the page's bodies, and env.GF.files' public types and the
// bodies it holds in memory. What is refused here is what the published game is refused; nothing more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPlatformStore } from '../lib/dev/platform.mjs';
import { startDev } from '../lib/dev/index.mjs';
import { createFileStore } from '../lib/dev/files.mjs';
import { PLANS, RULES, devPlan, planLine } from '../lib/dev/plans.mjs';
import { run, tempDir } from './helpers.mjs';

const MB = 1024 * 1024;

/** A store whose clock the test moves: tick() past the one-a-second rule, minute() to a new minute. */
async function storeOf(t, opts = {}) {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const clock = { now: Date.parse('2026-11-10T12:00:00Z') };
  const s = createPlatformStore({ dir: tmp.dir, slug: 'moth', now: () => clock.now, ...opts });
  return {
    s,
    dir: tmp.dir,
    tick: () => (clock.now += 1001),
    minute: () => (clock.now += 60_001),
  };
}
/** The dev host's store file, written before the store reads it (a board or saves too big to make one by one). */
async function seed(dir, data) {
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(path.join(dir, '.gamesfun', 'dev-platform.json'), JSON.stringify(data));
}

test('the plans: one table, Free by default, and a plan that is not one is refused', () => {
  assert.equal(devPlan().key, 'free');
  assert.equal(devPlan('Creator').scores.boards, 16);
  assert.equal(PLANS.free.scores.boards, 8);
  assert.equal(PLANS.free.reads.perMinute, 1200);
  assert.throws(() => devPlan('gold'), /no plan "gold": free, creator, scale/);
  assert.match(
    planLine(devPlan()),
    /^platform: imitating the Free plan \(--plan creator\|scale for another\): 8 boards/,
  );
  const help = run(['dev', '--help']);
  assert.match(
    help.stdout + help.stderr,
    /--plan <name>\s+the plan to imitate: free \(the default\), creator or scale/,
  );
  const bad = run(['dev', '--plan', 'gold']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--plan is free, creator or scale/);
});

test('boards a page makes: "high" only, two a player, half the plan’s boards; the server makes the rest', async t => {
  const { s, tick } = await storeOf(t);
  const low = await s.page('scores.submit', ['times', 'dev:a', 30, { order: 'low' }], 'dev:a');
  assert.equal(low.code, 'order');
  assert.match(low.why, /A page makes "high" boards only/);
  assert.equal((await s.run('scores.top', ['times'])).order, null, 'nothing was made');
  assert.equal((await s.page('scores.submit', ['a1', 'dev:a', 1], 'dev:a')).ok, true);
  tick();
  assert.equal((await s.page('scores.submit', ['a2', 'dev:a', 1], 'dev:a')).ok, true);
  tick();
  const third = await s.page('scores.submit', ['a3', 'dev:a', 1], 'dev:a');
  assert.deepEqual([third.code, /One player may make 2/.test(third.why)], ['too-many', true]);
  assert.equal((await s.page('scores.submit', ['b1', 'dev:b', 1], 'dev:b')).ok, true);
  tick();
  assert.equal((await s.page('scores.submit', ['b2', 'dev:b', 1], 'dev:b')).ok, true);
  tick();
  const fifth = await s.page('scores.submit', ['c1', 'dev:c', 1], 'dev:c');
  assert.deepEqual([fifth.code, /pages may make 4 of its 8 boards/.test(fifth.why)], ['too-many', true]);
  // the server's own: "low" too, up to the plan's 8
  for (const b of ['s1', 's2', 's3', 's4'])
    assert.equal((await s.run('scores.setup', [b, { order: 'low' }])).ok, true, b);
  const ninth = await s.run('scores.setup', ['s5']);
  assert.deepEqual([ninth.code, /allows 8 boards/.test(ninth.why)], ['too-many', true]);
  // a page's order never changes a board that is there
  tick();
  assert.equal((await s.page('scores.submit', ['a1', 'dev:a', 5, { order: 'low' }], 'dev:a')).ok, true);
  assert.equal((await s.run('scores.top', ['a1'])).order, 'high');
  const list = await s.run('scores.list', []);
  assert.deepEqual(list.limit, { boards: 8, page: 4 });
  assert.deepEqual(
    list.boards.map(b => [b.board, b.order, b.made, b.player ?? null]),
    [
      ['a1', 'high', 'page', 'dev:a'],
      ['a2', 'high', 'page', 'dev:a'],
      ['b1', 'high', 'page', 'dev:b'],
      ['b2', 'high', 'page', 'dev:b'],
      ['s1', 'low', 'server', null],
      ['s2', 'low', 'server', null],
      ['s3', 'low', 'server', null],
      ['s4', 'low', 'server', null],
    ],
  );
  // on Creator: 16 boards, 8 of them the pages'
  const c = await storeOf(t, { plan: 'creator' });
  assert.deepEqual((await c.s.run('scores.list', [])).limit, { boards: 16, page: 8 });
});

test('a board’s order: the server remakes a board a page made; one the server made keeps its own', async t => {
  const { s, tick } = await storeOf(t);
  assert.equal((await s.page('scores.submit', ['lap', 'dev:a', 90], 'dev:a')).ok, true);
  const remade = await s.run('scores.submit', ['lap', 'srv', 30, { order: 'low' }]);
  assert.deepEqual([remade.ok, remade.remade, remade.removed, remade.rank], [true, true, 1, 1]);
  assert.equal((await s.run('scores.list', [])).boards[0].made, 'server', 'the server’s from then on');
  assert.equal((await s.run('scores.setup', ['run', { order: 'low' }])).order, 'low');
  const differs = await s.run('scores.setup', ['run', { order: 'high' }]);
  assert.equal(differs.code, 'order-differs');
  const taken = await s.run('scores.submit', ['run', 'srv', 12, { order: 'high' }]);
  assert.deepEqual([taken.ok, taken.orderDiffers, taken.order], [true, true, 'low']);
  tick();
  // no order asks nothing of a board that is there
  const plain = await s.run('scores.submit', ['run', 'srv2', 10]);
  assert.deepEqual([plain.ok, plain.orderDiffers, plain.rank], [true, undefined, 1]);
});

test('ranks and offsets are counted to 10,000; a board takes the plan’s entries', async t => {
  const { s, dir } = await storeOf(t, { plan: 'creator' });
  const rows = Array.from({ length: 10_002 }, (_, i) => ({
    player: `p${i}`,
    name: '',
    score: 20_000 - i,
    at: i,
    tried: 0,
  }));
  await seed(dir, { boards: { deep: { order: 'high', rows } } });
  const last = await s.run('scores.best', ['deep', 'p10001']);
  assert.deepEqual([last.entry.rank, last.entry.rankAtLeast], [10_001, true]);
  const near = await s.run('scores.best', ['deep', 'p9999']);
  assert.deepEqual([near.entry.rank, near.entry.rankAtLeast], [10_000, undefined]);
  assert.deepEqual((await s.run('scores.top', ['deep', { offset: 10_001 }])).entries, []);
  assert.equal((await s.run('scores.top', ['deep', { offset: 10_000, limit: 2 }])).entries.length, 2);
  // Free keeps 10,000 entries a board; a player already there may still improve
  const free = await storeOf(t);
  await seed(free.dir, { boards: { full: { order: 'high', rows: rows.slice(0, 10_000) } } });
  const fullAnswer = await free.s.run('scores.submit', ['full', 'new', 1]);
  assert.deepEqual([fullAnswer.code, /allows 10,000 entries a board/.test(fullAnswer.why)], ['full', true]);
  assert.equal((await free.s.run('scores.submit', ['full', 'p5', 1e9])).ok, true);
});

test('saves: a page’s player keeps 1/128 of the game’s bytes; a full game keeps a 4 KB floor', async t => {
  const { s, dir } = await storeOf(t);
  const big = 'x'.repeat(50 * 1024);
  assert.equal((await s.page('saves.put', ['dev:a', 'one', big], 'dev:a')).ok, true);
  const second = await s.page('saves.put', ['dev:a', 'two', big], 'dev:a');
  assert.deepEqual([second.code, /may keep 80 KB of this game’s saves/.test(second.why)], ['full', true]);
  assert.equal((await s.run('saves.put', ['dev:a', 'two', big])).ok, true, 'the game’s server is not held to it');
  assert.equal((await s.page('saves.put', ['dev:a', 'one', 'small'], 'dev:a')).ok, true, 'a write that shrinks');
  // a game at its 10 MB: a player within 4 KB still saves; past it, refused
  const full = await storeOf(t);
  await seed(full.dir, { saves: { filler: { all: { value: 0, bytes: 10 * MB, updated: 1 } } } });
  assert.equal((await full.s.page('saves.put', ['dev:n', 'main', 'x'.repeat(3000)], 'dev:n')).ok, true);
  const past = await full.s.page('saves.put', ['dev:n', 'more', 'x'.repeat(3000)], 'dev:n');
  assert.deepEqual([past.code, /saves are full .* a player may still keep 4 KB/.test(past.why)], ['full', true]);
  assert.equal((await full.s.run('saves.put', ['srv', 'x', 'x'.repeat(5000)])).code, 'full', 'the server too');
  void dir;
});

test('writes a minute: a page’s player 60 saves and 30 scores; the server the plan’s 600', async t => {
  const { s, tick, minute } = await storeOf(t);
  for (let i = 0; i < RULES.page.saveWritesPerPlayerMinute; i++)
    assert.equal((await s.page('saves.put', ['dev:a', 'main', i], 'dev:a')).ok, true, `save ${i}`);
  const r = await s.page('saves.delete', ['dev:a', 'main'], 'dev:a');
  assert.deepEqual([r.code, r.why], ['rate', 'Too many saves this minute for one player (60).']);
  assert.equal((await s.page('saves.put', ['dev:b', 'main', 1], 'dev:b')).ok, true, 'another player’s own');
  for (let i = 0; i < RULES.page.scoreSubmitsPerPlayerMinute; i++) {
    tick();
    assert.equal((await s.page('scores.submit', ['best', 'dev:c', i], 'dev:c')).ok, true, `score ${i}`);
  }
  tick();
  assert.equal((await s.page('scores.submit', ['best', 'dev:c', 99], 'dev:c')).code, 'rate');
  minute();
  for (let i = 0; i < PLANS.free.saves.writesPerMinute; i++)
    assert.equal((await s.run('saves.put', [`srv${i}`, 'main', i])).ok, true);
  const over = await s.run('saves.put', ['srv', 'main', 1]);
  assert.deepEqual([over.code, /this game’s plan, Free, allows 600/.test(over.why)], ['rate', true]);
  assert.equal((await s.page('saves.put', ['dev:d', 'main', 1], 'dev:d')).ok, true, 'pages have their own minute');
});

test('reads a minute by plan: the server’s and the pages’ counted apart', async t => {
  const { s, minute } = await storeOf(t);
  for (let i = 0; i < PLANS.free.reads.perMinute; i++) await s.run('saves.get', ['srv', 'main']);
  const over = await s.run('scores.top', ['best']);
  assert.deepEqual([over.code, /Too many reads this minute .*Free, allows 1,200/.test(over.why)], ['rate', true]);
  assert.equal((await s.page('saves.list', ['dev:a'], 'dev:a')).ok, true, 'the pages’ own count');
  minute();
  assert.equal((await s.run('scores.best', ['best', 'srv'])).ok, true, 'a new minute');
  const c = await storeOf(t, { plan: 'creator' });
  for (let i = 0; i < PLANS.free.reads.perMinute + 1; i++) await c.s.run('saves.get', ['srv', 'main']);
  assert.equal((await c.s.run('saves.get', ['srv', 'main'])).ok, true, 'Creator reads 12,000 a minute');
});

/** A game folder with only a page, under xcore dev on any port. */
async function devHost(t, opts = {}) {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = path.join(tmp.dir, 'moth');
  await mkdir(dir);
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>moth</title>');
  const logs = [];
  const dev = await startDev(dir, { port: 0, filesPort: 0, log: m => logs.push(m), env: {}, ...opts });
  t.after(() => dev.close());
  const call = async (p, { token, ...init } = {}) => {
    const headers = { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) };
    const r = await fetch(`${dev.origin}/platform/v1/${p}`, { ...init, headers });
    return { status: r.status, json: await r.json() };
  };
  const signIn = async name => (await call('dev/token', { method: 'POST', body: JSON.stringify({ name }) })).json;
  const send = (p, token, body, method = 'POST') =>
    call(p, { method, token, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { dev, dir, logs, call, signIn, send };
}

test('a board read: each player a per-game id with me on the caller’s own; the top 100 without a token', async t => {
  const { dev, logs, call, signIn, send } = await devHost(t);
  assert.ok(
    logs.some(l => /^platform: imitating the Free plan/.test(l)),
    'says which plan it imitates',
  );
  const ana = await signIn('Ana'),
    bo = await signIn('Bo');
  assert.equal((await send('scores/best', ana.token, { score: 10 })).status, 200);
  assert.equal((await send('scores/best', bo.token, { score: 20 })).status, 200);
  const mine = (await call('scores/best', { token: ana.token })).json.entries;
  assert.deepEqual(
    mine.map(e => [e.name, e.me ?? false]),
    [
      ['Bo', false],
      ['Ana', true],
    ],
  );
  for (const e of mine) {
    assert.match(e.player, /^[a-z2-7]{16}$/, 'a per-game id');
    assert.ok(![ana.player.id, bo.player.id].includes(e.player), 'never the account’s own id');
  }
  // the same id on every read, signed in or not; nothing marked without a good token
  const open = (await call('scores/best?limit=5')).json.entries;
  assert.deepEqual(
    open.map(e => [e.player, e.me]),
    mine.map(e => [e.player, undefined]),
  );
  assert.equal((await call('scores/best', { token: 'nonsense' })).json.entries[1].me, undefined);
  // the env.GF read keeps the raw ids
  assert.deepEqual(
    (await dev.store.run('scores.top', ['best'])).entries.map(e => e.player),
    [bo.player.id, ana.player.id],
  );
  // past the top 100 with no token: 401
  const deep = await call('scores/best?offset=95&limit=10');
  assert.deepEqual([deep.status, deep.json.code], [401, 'player']);
  assert.match(deep.json.why, /Sign in to read past the top 100/);
  assert.equal((await call('scores/best?offset=95&limit=10', { token: ana.token })).status, 200);
  assert.equal((await call('scores/best?offset=90&limit=10')).status, 200, 'the top 100 itself');
});

test('a board read with no token: the same read within 5 s may be the one before; a tenth of the reads a minute', async t => {
  const { s, tick, minute } = await storeOf(t);
  await s.run('scores.submit', ['best', 'p1', 10]);
  const first = await s.page('scores.top', ['best', { limit: 10 }], '', { anon: true });
  await s.run('scores.submit', ['best', 'p2', 20]);
  const cached = await s.page('scores.top', ['best', { limit: 10 }], '', { anon: true });
  assert.deepEqual(cached.entries, first.entries, 'answered from the cache');
  assert.equal((await s.page('scores.top', ['best', { limit: 10 }], 'p1')).entries.length, 2, 'signed in: fresh');
  tick();
  tick();
  tick();
  tick();
  tick();
  assert.equal((await s.page('scores.top', ['best', { limit: 10 }], '', { anon: true })).entries.length, 2);
  minute();
  const max = PLANS.free.reads.perMinute / RULES.page.anonReadsDivisor;
  // each read another page of the board (the same one again would come from the cache, and cost nothing)
  for (let i = 0; i < max; i++) {
    const page = { offset: i % 91, limit: 1 + Math.floor(i / 91) };
    assert.equal((await s.page('scores.top', ['best', page], '', { anon: true })).ok, true, `${i}`);
  }
  const over = await s.page('scores.top', ['best', { offset: 77 }], '', { anon: true });
  assert.deepEqual([over.code, /not signed in .*allows 120/.test(over.why)], ['rate', true]);
  assert.equal((await s.page('scores.top', ['best', { offset: 77 }], 'p1')).ok, true, 'a player’s read is not');
});

test('the page’s bodies: JSON only, at most 96 KB; a name that reads as another’s @handle is not taken', async t => {
  const { call, signIn, send } = await devHost(t);
  const ana = await signIn('Ana');
  const plain = await call('saves/main', { method: 'PUT', token: ana.token, body: '{"value":1}' });
  assert.deepEqual([plain.status, plain.json.code], [415, 'failed']);
  const huge = await send('saves/main', ana.token, { value: 'x'.repeat(97 * 1024) }, 'PUT');
  assert.deepEqual([huge.status, huge.json.code], [413, 'too-big']);
  assert.equal((await send('scores/best', ana.token, { score: 5, name: '@elon' })).status, 200);
  assert.equal((await call('scores/best')).json.entries[0].name, 'Ana', 'posted under the player’s own name');
});

test('env.GF.files: a public file is plainly media or data; a body in memory is at most 1 MB; calls a minute', async t => {
  const { s, dir } = await storeOf(t);
  const host = (op, init) => s.handleHost(new Request(`http://gf.local/${op}`, { method: 'POST', ...init }));
  const put = (q, body) => host(`files.put?${q}`, { body }).then(r => r.json());
  const html = await put('path=a.html&public=1&type=text%2Fhtml', '<p>hi</p>');
  assert.deepEqual([html.code, /A public file is an image/.test(html.why)], ['type', true]);
  const none = await put('path=a.png&public=1', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  assert.equal(none.code, 'type', 'no type is application/octet-stream, never public');
  const fake = await put('path=b.png&public=1&type=image%2Fpng', 'not a picture');
  assert.deepEqual([fake.code, /first bytes are not image\/png/.test(fake.why)], ['type', true]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
  assert.equal((await put('path=c.png&public=1&type=image%2Fpng', png)).ok, true);
  assert.equal((await put('path=d.json&public=1&type=application%2Fjson', ' {"a":1}')).ok, true);
  assert.equal((await put('path=e.html&type=text%2Fhtml', '<p>kept private</p>')).ok, true, 'private: any type');
  const big = await put('path=f.bin', Buffer.alloc(MB + 1));
  assert.deepEqual([big.code, /at most 1\.0 MB; send a larger file as a byte stream/.test(big.why)], ['body', true]);
  assert.equal((await put(`path=g.bin&stream=1&length=${MB + 1}`, Buffer.alloc(MB + 1))).ok, true, 'a stream');
  // the CLI's own puts (xcore files, the owner's) keep the same public rule
  const local = createFileStore({ dir });
  assert.equal((await local.put('x.svg', '<svg/>', { public: true, type: 'image/svg+xml' })).code, 'type');
  // every call spends one (the eight puts above too, refused or not) of the plan's file calls a minute (120 on Free)
  for (let i = 0; i < PLANS.free.files.opsPerMinute - 8; i++) await s.run('files.usage', []);
  const over = await s.run('files.head', ['c.png']);
  assert.deepEqual([over.code, /Too many file calls this minute .*allows 120/.test(over.why)], ['rate', true]);
});

test('names a request brings ("constructor", "__proto__") are keys like any other: no tab, board, rule or save every object has', async t => {
  const { s, tick, dir } = await storeOf(t);
  // the page's question with no tap, for a tab named like what every object has: nobody, until that tab signs in
  for (const tab of ['constructor', 'tostring', 'hasownproperty', 'valueof'])
    assert.equal(await s.signinSession(tab), null, tab);
  await s.signinForget('constructor');
  await s.signinRemember('constructor', 'Ana');
  assert.equal((await s.signinSession('constructor')).player.name, 'Ana');
  await s.signinForget('constructor');
  assert.equal(await s.signinSession('constructor'), null);
  // a board, a rule and a player named so
  assert.deepEqual((await s.run('scores.top', ['constructor'])).entries ?? [], [], 'no such board yet');
  assert.equal((await s.page('scores.submit', ['constructor', 'dev:a', 5], 'dev:a')).ok, true);
  tick();
  assert.equal((await s.run('scores.top', ['constructor'])).entries[0].score, 5);
  assert.equal((await s.run('scores.setup', ['__proto__', { writer: 'server' }])).ok, true);
  tick();
  assert.equal((await s.page('scores.submit', ['__proto__', 'dev:a', 1], 'dev:a')).code, 'server-only');
  assert.deepEqual((await s.run('saves.get', ['constructor', 'main'])).value, null);
  assert.equal((await s.run('saves.put', ['dev:a', '__proto__', { level: 2 }])).ok, true);
  assert.deepEqual((await s.run('saves.get', ['dev:a', '__proto__'])).value, { level: 2 });
  assert.deepEqual(
    (await s.run('saves.list', ['dev:a'])).keys.map(k => k.key),
    ['__proto__'],
  );
  // and they are kept as written, read back the same by the next store
  await s.flush();
  const again = createPlatformStore({ dir, slug: 'moth' });
  assert.deepEqual((await again.run('saves.get', ['dev:a', '__proto__'])).value, { level: 2 });
  assert.equal(await again.signinSession('tostring'), null);
});
