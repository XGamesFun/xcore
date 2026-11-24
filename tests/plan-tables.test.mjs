// A plan's numbers are written once, in the contract (lib/server/contract.mjs PLAN_LIMITS and PLATFORM_LIMITS, what
// a game is told), and the local platform (lib/dev/plans.mjs PLANS and RULES, what `xcore dev` enforces) takes them
// from there. They must never disagree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_LIMITS, PLATFORM_LIMITS } from '../lib/server/contract.mjs';
import { PLANS, RULES } from '../lib/dev/plans.mjs';

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

test('a number the contract states for every plan is the one the local platform enforces', () => {
  let held = 0;
  for (const area of ['saves', 'scores'])
    for (const [name, n] of Object.entries(PLATFORM_LIMITS[area])) {
      // (a plan's own numbers, Free's here, are PLANS's: the test above)
      if (!Object.hasOwn(RULES[area], name)) continue;
      assert.equal(RULES[area][name], n, `${area}.${name}`);
      held++;
    }
  assert.equal(held, 4, "a player id's length, a name's, a player's second between scores and a board read's depth");
});
