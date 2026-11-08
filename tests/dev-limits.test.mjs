// `xcore dev`'s word on games.fun's plan limits (lib/dev/limits.mjs): the rate past Free's and past Creator's, once a
// minute, and a slow route once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimitWatch, PLAN_LIMITS } from '../lib/dev/limits.mjs';

test('dev limits: past 120 a minute names Free, past 600 names Creator, once each a minute; a slow route once', () => {
  let t = 0;
  const lines = [];
  const w = createLimitWatch({ log: l => lines.push(l), now: () => t });
  for (let i = 0; i < PLAN_LIMITS.free.perPlayer; i++) w.request('GET', '/api/state')();
  assert.equal(lines.length, 0, '120 in a minute is fine');
  w.request('GET', '/api/state')();
  assert.equal(lines.length, 1);
  assert.match(
    lines[0],
    /^limits: 121 requests .*\(the last: GET \/api\/state\). Published on Free, .* past 120 a minute are refused \(429/,
  );
  for (let i = 0; i < 600; i++) w.upgrade('/api/room');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /601 requests .* even on Creator/);
  t += 60_000;
  for (let i = 0; i < 121; i++) w.request('POST', '/api/move')();
  assert.equal(lines.length, 3, 'a new minute says it again');

  const done = w.request('GET', '/api/replay');
  t += 140;
  done();
  assert.match(lines[3], /^limits: GET \/api\/replay took 140 ms here\. .* 50 ms of CPU on Free \(200 on Creator\)/);
  const again = w.request('GET', '/api/replay');
  t += 300;
  again();
  assert.equal(lines.length, 4, 'one word per route');
});
