// A new live voucher key points the grants the server pays at itself in the economy: the owner copies no address. The
// key it replaces goes out, the test key goes out on mainnet, a grant that counts people gets it as the issuer, and what
// this machine can't decide is said, never guessed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { addVouchers, newVoucherKey } from '../lib/add.mjs';
import { pointGrantsAt } from '../lib/voucher-key.mjs';
import { fixture, tempDir } from './helpers.mjs';

async function game(t, economy) {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await writeFile(path.join(dir, 'xsolana.json'), JSON.stringify(economy));
  const { address: test } = await addVouchers(dir);
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
  assert.deepEqual(e.grants[0].vouchers, [unknown, live]);
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
