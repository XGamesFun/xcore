// lib/play-policy.mjs is xcore's copy of xgames.fun's play-origin contract: the headers xcore check and xcore dev serve
// a game's pages with are the ones its published pages get. tests/fixtures/play-headers.json is what xgames.fun's own
// copy (creator-studio/lib/play-policy.mjs) answers for the same input, and where a checkout of games.fun sits beside
// this one, that copy is asked too, so a header xgames.fun changes says here where xcore's has to follow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { playHeaders } from '../lib/play-policy.mjs';
import { ROOT } from './helpers.mjs';

const CASES = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'play-headers.json'), 'utf8'));

test("a game's pages get the headers xgames.fun's play edge sends", () => {
  assert.ok(CASES.length >= 2);
  for (const { input, headers } of CASES) assert.deepEqual(playHeaders(input), headers, JSON.stringify(input));
});

test('a page names its origin, never its path, to the pages it opens', () => {
  assert.equal(playHeaders({ studioOrigin: 'https://xgames.fun' })['referrer-policy'], 'strict-origin');
});

const STUDIO = path.join(ROOT, '..', 'games.fun', 'creator-studio', 'lib', 'play-policy.mjs');
test(
  "the same headers as xgames.fun's own copy",
  { skip: existsSync(STUDIO) ? false : 'no games.fun checkout beside this one' },
  async () => {
    const studio = await import(pathToFileURL(STUDIO).href);
    for (const { input } of CASES)
      assert.deepEqual(playHeaders(input), studio.playHeaders(input), JSON.stringify(input));
  },
);
