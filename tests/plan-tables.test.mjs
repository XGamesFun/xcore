// The kit states each plan's numbers twice: the contract (lib/server/contract.mjs PLAN_LIMITS, what a game is told)
// and the local platform (lib/dev/plans.mjs PLANS, what `xcore dev` enforces). They must never disagree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_LIMITS } from '../lib/server/contract.mjs';
import { PLANS } from '../lib/dev/plans.mjs';

test('every number the contract states for a plan is the one the local platform enforces', () => {
  assert.deepEqual(Object.keys(PLAN_LIMITS).sort(), Object.keys(PLANS).sort(), 'the same plans in both tables');
  for (const [plan, limits] of Object.entries(PLAN_LIMITS)) {
    for (const [area, value] of Object.entries(limits)) {
      if (value && typeof value === 'object') {
        for (const [name, n] of Object.entries(value))
          assert.equal(PLANS[plan][area]?.[name], n, `${plan}.${area}.${name}`);
      } else assert.equal(PLANS[plan][area], value, `${plan}.${area}`);
    }
  }
});
