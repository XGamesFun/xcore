// A new live voucher key points the grants the server pays at itself in the economy: the owner copies no address. The
// key it replaces goes out, the test key goes out on mainnet, a grant that counts people gets it as the issuer, and what
// this machine can't decide is said, never guessed. The live key reaches each grant PAY.check pays however it names
// it, and add vouchers run again keeps the owner's own code beside PAY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { addVouchers, keepSettings, newVoucherKey } from '../lib/add.mjs';
import { pointGrantsAt } from '../lib/voucher-key.mjs';
import { fixture, tempDir } from './helpers.mjs';

/** A PAY.check that names its grant through a variable, as an owner's own code may. */
const PAY_VIA_VARIABLE = `async check({ body }) {
    const grant = body.boss ? 'boss' : "clear";
    return { grant, round: body.runId, amount: 'grant' };
  },`;

/** A game with the economy `economy` and add vouchers' server; `check` replaces the template's PAY.check. */
async function game(t, economy, { check } = {}) {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await writeFile(path.join(dir, 'xsolana.json'), JSON.stringify(economy));
  const { address: test } = await addVouchers(dir);
  if (check) {
    const f = path.join(dir, 'server', 'vouchers.js');
    const text = await readFile(f, 'utf8');
    const out = text.replace(/async check\(\) \{\r?\n {4}return \{ why: [^\r\n]*\r?\n {2}\},/, check);
    assert.notEqual(out, text, 'the template check was replaced');
    await writeFile(f, out);
  }
  const read = async () => JSON.parse(await readFile(path.join(dir, 'xsolana.json'), 'utf8'));
  return { dir, test, read };
}
const key = async () => (await newVoucherKey()).address;

test('the first live key: beside the test key on devnet, the issuer where a grant counts people; the next replaces it', async t => {
  const g = await game(t, { grants: [{ key: 'clear', id: 1, limits: { perPerson: 1 } }] });
  let e = await g.read();
  e.grants[0].vouchers = [g.test];
  await writeFile(path.join(g.dir, 'xsolana.json'), JSON.stringify(e));
  const live = await key();
  const r = await pointGrantsAt(g.dir, live);
  assert.equal(r.changed.length, 2, r.changed.join('\n'));
  e = await g.read();
  assert.deepEqual(e.grants[0].vouchers, [g.test, live]);
  assert.equal(e.keys.issuer, live);
  // a new live key later: the old one goes, from the grant and as the issuer
  const next = await key();
  await pointGrantsAt(g.dir, next);
  e = await g.read();
  assert.deepEqual(e.grants[0].vouchers, [g.test, next]);
  assert.equal(e.keys.issuer, next);
});

test('on mainnet the test key goes out of the grant; a grant only PAY.check names is pointed too', async t => {
  const g = await game(t, {
    network: 'mainnet',
    grants: [
      { key: 'clear', id: 1 },
      { key: 'other', id: 2 },
    ],
  });
  const file = path.join(g.dir, 'server', 'vouchers.js');
  await writeFile(
    file,
    (await readFile(file, 'utf8')).replace(
      /async check\(\) \{\r?\n {4}return \{ why: [^\r\n]*\r?\n {2}\},/,
      "async check({ body }) {\n    return { grant: 'clear', round: body.runId, amount: 'grant' };\n  },",
    ),
  );
  let e = await g.read();
  e.grants[1].vouchers = [g.test];
  await writeFile(path.join(g.dir, 'xsolana.json'), JSON.stringify(e));
  const live = await key();
  await pointGrantsAt(g.dir, live);
  e = await g.read();
  assert.deepEqual(e.grants[0].vouchers, [live], 'named by PAY.check');
  assert.deepEqual(e.grants[1].vouchers, [live], 'the test key out, on mainnet');
});

test('an issuer the owner chose, and a key this machine cannot name, are left and said', async t => {
  const chosen = await key();
  const unknown = await key();
  const g = await game(t, {
    keys: { issuer: chosen },
    grants: [{ key: 'clear', id: 1, vouchers: [unknown], limits: { perPersonEach: { count: 1, every: '1d' } } }],
  });
  const live = await key();
  const r = await pointGrantsAt(g.dir, live);
  const e = await g.read();
  assert.deepEqual(e.grants[0].vouchers, [unknown, g.test, live], 'the test key added on devnet by add vouchers');
  assert.equal(e.keys.issuer, chosen);
  assert.ok(
    r.left.some(l => l.includes(unknown) && /take it out/.test(l)),
    r.left.join('\n'),
  );
  assert.ok(
    r.left.some(l => l.includes(chosen) && /which you chose/.test(l)),
    r.left.join('\n'),
  );
});

test('the live key reaches every grant PAY.check names as a string, and says so when none is named', async t => {
  const g = await game(
    t,
    {
      grants: [
        { key: 'clear', id: 1 },
        { key: 'boss', id: 2 },
        { key: 'other', id: 3 },
      ],
    },
    { check: PAY_VIA_VARIABLE },
  );
  const live = (await newVoucherKey()).address;
  const r = await pointGrantsAt(g.dir, live);
  const e = await g.read();
  assert.deepEqual(
    e.grants.map(x => x.vouchers ?? null),
    [[live], [live], null],
  );
  assert.equal(r.left.length, 0, r.left.join('\n'));

  const none = await game(t, { grants: [{ key: 'clear', id: 1 }] });
  const r2 = await pointGrantsAt(none.dir, live);
  assert.ok(r2.left.some(l => /No grant in xsolana\.json takes vouchers from/.test(l) && l.includes('"clear"')));
});

test('add vouchers on devnet puts the test key in the grants the server pays, and later the live key made before', async t => {
  const g = await game(t, { grants: [{ key: 'clear', id: 1 }] }, { check: PAY_VIA_VARIABLE });
  const live = (await newVoucherKey()).address;
  await pointGrantsAt(g.dir, live);
  // a grant added after the live key was made: add vouchers points it at both, no new key
  const e = await g.read();
  e.grants.push({ key: 'boss', id: 2 });
  await writeFile(path.join(g.dir, 'xsolana.json'), JSON.stringify(e));
  const r = await addVouchers(g.dir);
  const after = await g.read();
  assert.deepEqual(after.grants[1].vouchers, [live, g.test]);
  assert.ok(after.grants[0].vouchers.includes(g.test));
  assert.ok(r.written.some(l => /pointed the live voucher key/.test(l)));

  // mainnet: never the test key
  const m = await game(t, { network: 'mainnet', grants: [{ key: 'clear', id: 1 }] }, { check: PAY_VIA_VARIABLE });
  await addVouchers(m.dir);
  assert.equal((await m.read()).grants[0].vouchers, undefined);
});

test('add vouchers run again keeps what the owner wrote beside PAY, and a setting’s whole default', async t => {
  const g = await game(t, { grants: [{ key: 'clear', id: 1 }] });
  const f = path.join(g.dir, 'server', 'vouchers.js');
  await writeFile(
    f,
    (await readFile(f, 'utf8')) +
      '\n// my own scoring\nfunction scoreOf(body) {\n  return Number(body.score ?? 0);\n}\nconst BONUS = 2;\n',
  );
  for (let i = 0; i < 2; i++) await addVouchers(g.dir);
  const out = await readFile(f, 'utf8');
  assert.equal(out.match(/function scoreOf/g)?.length, 1);
  assert.equal(out.match(/const BONUS = 2/g)?.length, 1);

  const before = "export const RPC = {\n  scanPrograms: ['mine'],\n};\n";
  const now = "export const RPC = {\n  scanPrograms: ['9cwq'],\n  loot: ['xgamesVs', 'xgames8C'],\n};\n";
  assert.match(keepSettings(before, now, ['RPC']), /loot: \['xgamesVs', 'xgames8C'\]/);
});

test('an economy file that is not valid JSON is refused by name before add vouchers or a live key writes anything', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  // cut short: the file is there, and it does not parse
  const cut = '{\n  "grants": [\n    {';
  await writeFile(path.join(dir, 'xsolana.json'), cut);
  const before = (await readdir(dir)).sort();
  await assert.rejects(
    addVouchers(dir),
    e => e.code === 'not-json' && /^xsolana\.json is not valid JSON \(.+\); fix it first$/.test(e.message),
  );
  assert.deepEqual(
    (await readdir(dir)).sort(),
    before,
    'no .dev.vars, no server/, no gamesfun.json: the game is as it was',
  );
  await assert.rejects(pointGrantsAt(dir, await key()), /^Error: xsolana\.json is not valid JSON/);
  assert.deepEqual((await readdir(dir)).sort(), before, "the live key's address is not kept either");
  assert.equal(await readFile(path.join(dir, 'xsolana.json'), 'utf8'), cut);
  // a file that parses and holds no economy is said too
  await writeFile(path.join(dir, 'xsolana.json'), 'null');
  await assert.rejects(addVouchers(dir), /xsolana\.json holds no economy/);
  // a record of the last live key that does not read is no reason to stop: the key it named is left in the grant, and said
  const { dir: live, read } = await game(t, { grants: [{ key: 'clear', id: 1 }] }, { check: PAY_VIA_VARIABLE });
  const first = await key();
  await pointGrantsAt(live, first);
  await writeFile(path.join(live, '.gamesfun', 'vouchers.json'), '{ "liveKey": ');
  const second = await key();
  const r = await pointGrantsAt(live, second);
  assert.ok((await read()).grants[0].vouchers.includes(second));
  assert.match(r.left.join('\n'), new RegExp(`"clear" also takes vouchers from .*${first}`));
});
