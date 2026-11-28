// docs/CLIENT.md against the client it describes (lib/client/gamesfun.js): the numbers and recipes a game is written
// from are the ones the code has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const DOC = readFileSync(path.join(ROOT, 'docs', 'CLIENT.md'), 'utf8');
const CLIENT = readFileSync(path.join(ROOT, 'lib', 'client', 'gamesfun.js'), 'utf8');
const ms = name => Number(new RegExp(`var ${name} = (\\d+);`).exec(CLIENT)?.[1]);

test("Live: how soon a change reaches players already in the game is the client's own asking", () => {
  const section = DOC.slice(DOC.indexOf('## Live settings'), DOC.indexOf('`gamesfun.js` reads them'));
  assert.equal(ms('LIVE_POLL_MS'), 60_000);
  assert.equal(ms('LIVE_BANNER_MS'), 300_000);
  assert.match(section, /about a minute later when the game listens\s+with `GamesFun\.live\.onChange`/);
  assert.match(section, /every five\s+minutes/);
  assert.doesNotMatch(section, /Players get changes within about 35 seconds/);
});

test('Saves: the carry-over recipe moves a guest save only into a key the account does not have', () => {
  const recipe = /GamesFun\.onChange\(async player => \{[\s\S]*?\n\}\);/.exec(DOC.slice(DOC.indexOf('## Saves')))?.[0];
  assert.ok(recipe, 'the recipe is there');
  assert.match(
    recipe,
    /const \{ status \} = await GamesFun\.saves\.get\(key\);\s+if \(status === 404\) await GamesFun\.saves\.guest\.move\(key\);/,
  );
});

test('the sign-in client is asked for only where it is served', () => {
  assert.match(
    DOC,
    /xgames\.fun does not serve that address\s+yet, so on the game's own link and its own domain nothing is requested/,
  );
  assert.match(CLIENT, /var serves = w === 'dev' \|\|/);
});
