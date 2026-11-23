// The example PAY.check in the comment at the top of server/vouchers.js (lib/client/server/vouchers.js) is code a new
// game can use: taken from the comment as it is written, and run on the server/gf-db.js that `xcore add database`
// writes beside it, over a stand-in for the game's D1 database (node:sqlite).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { addDatabase, addVouchers } from '../lib/add.mjs';
import { fixture, tempDir } from './helpers.mjs';

test('the payout example in server/vouchers.js runs on what xcore add database writes into a new game', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await writeFile(path.join(dir, 'xsolana.json'), JSON.stringify({ grants: [{ key: 'clear', name: 'Clear', id: 1 }] }));
  await addVouchers(dir);
  await addDatabase(dir);
  const server = path.join(dir, 'server');
  assert.ok(existsSync(path.join(server, 'gf-db.js')), 'the database helper a game with a server gets');
  assert.ok(!existsSync(path.join(server, 'database.js')), 'the older database is not written into a new game');

  // the example and the import it says to add, as the comment has them
  const lines = (await readFile(path.join(server, 'vouchers.js'), 'utf8')).split('\n');
  const from = lines.findIndex(l => l.startsWith(' *   async check('));
  const to = lines.findIndex((l, i) => i > from && l === ' *   },');
  assert.ok(from > 0 && to > from, 'the example is there');
  const example = lines
    .slice(from, to + 1)
    .map(l => l.replace(/^ \* {3}/, '  '))
    .join('\n');
  const imports = /`(import \{[^`]+\} from '\.\/[\w-]+\.js';)`/.exec(lines.slice(from - 4, from).join('\n'))?.[1];
  assert.ok(imports, 'the comment names the import the example needs');
  const file = path.join(server, 'pay-example.mjs');
  await writeFile(file, `${imports}\nexport const PAY = {\n${example}\n};\n`);
  const { PAY } = await import(pathToFileURL(file).href);
  const { db } = await import(pathToFileURL(path.join(server, 'gf-db.js')).href);

  // the game's database, with the table the example reads (a migration of the owner's)
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('CREATE TABLE runs (id TEXT PRIMARY KEY, player TEXT NOT NULL, started_at INTEGER NOT NULL)');
  const env = {
    DB: {
      prepare: sql => ({
        bind: (...params) => ({
          first: async () => sqlite.prepare(sql).get(...params) ?? null,
          run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } }),
        }),
      }),
    },
  };
  const start = (id, player, at) =>
    db(env).run('INSERT INTO runs (id, player, started_at) VALUES (?, ?, ?)', id, player, at);
  await start('r1', 'x:1', Date.now() - 120_000);
  await start('r2', 'x:1', Date.now());
  const check = (runId, sub) => PAY.check({ body: { runId }, player: { sub }, env });
  assert.deepEqual(await check('r1', 'x:1'), { grant: 'clear', round: 'r1', amount: 'grant' });
  assert.deepEqual(await check('r1', 'x:2'), { why: 'Not a run this server started for you.' });
  assert.deepEqual(await check('r2', 'x:1'), { why: 'Faster than the game allows.' });
  assert.deepEqual(await check('none', 'x:1'), { why: 'Not a run this server started for you.' });
});
