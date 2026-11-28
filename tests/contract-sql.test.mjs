// lib/server/contract.mjs's SQL readers, copied from xgames.fun's creator-studio/lib/game-database.mjs: run over the
// same cases as that copy, when it is there to read (a checkout of games.fun beside this one), and over fixed answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterWith, sqlStatements } from '../lib/server/contract.mjs';
import { ROOT } from './helpers.mjs';

const CASES = [
  ['WITH x AS (SELECT 1 AS n) SELECT n FROM x', 'SELECT'],
  ['with recursive c(n) as (select 1 union all select n+1 from c where n<3) select * from c', 'SELECT'],
  ["WITH x AS (SELECT 'a) DELETE' AS s) SELECT s FROM x", 'SELECT'],
  ['WITH x AS (SELECT 1) DELETE FROM t WHERE a IN (SELECT * FROM x)', 'DELETE'],
  ['WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x', 'INSERT'],
  ['WITH "sel""ect" AS (SELECT 1) UPDATE t SET a = 1', 'UPDATE'],
  ['WITH [a)b] AS (SELECT 1) SELECT 1', 'SELECT'],
  ['SELECT 1', null],
  ['WITHOUT', null],
];

test("afterWith: the statement a WITH clause leads into, as xgames.fun's query route reads it", () => {
  for (const [sql, word] of CASES) assert.equal(afterWith(sql), word, sql);
});

test('a trigger is one statement when triggers are taken', () => {
  const trig = 'CREATE TRIGGER tr AFTER INSERT ON t BEGIN UPDATE t SET a=a; END';
  assert.equal(sqlStatements(trig, { triggers: true }).length, 1);
  assert.equal(sqlStatements(trig).length, 2);
});

const STUDIO = path.join(ROOT, '..', 'games.fun', 'creator-studio', 'lib', 'game-database.mjs');
test(
  "the same answers as xgames.fun's own copy",
  { skip: existsSync(STUDIO) ? false : 'no games.fun checkout beside this one' },
  async () => {
    const studio = await import(pathToFileURL(STUDIO).href).catch(() => null);
    if (!studio?.afterWith) return;
    for (const [sql] of CASES) assert.equal(afterWith(sql), studio.afterWith(sql), sql);
  },
);
