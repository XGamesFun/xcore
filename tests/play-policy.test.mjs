// lib/play-policy.mjs is xcore's copy of xgames.fun's play-origin contract: the headers xcore check and xcore dev serve
// a game's pages with are the ones its published pages get. tests/fixtures/play-headers.json is what xgames.fun's own
// copy (creator-studio/lib/play-policy.mjs) answers for the same input; when xgames.fun changes a header, that file is
// made again from its copy and this test says where xcore's has to follow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
