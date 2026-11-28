// tests/helpers.mjs runs every test as on a person's machine that has never signed in, whatever the shell that started
// `npm test` has set: a local Studio, a config folder of its own, another command name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './helpers.mjs';

test('a Studio, a config folder or a command name from the shell never reaches a test', () => {
  const at = rel => JSON.stringify(pathToFileURL(path.join(ROOT, rel)).href);
  const code = `
    await import(${at('tests/helpers.mjs')});
    const { ownOrigins, studioOrigin } = await import(${at('lib/publish/client.mjs')});
    const { existsSync } = await import('node:fs');
    console.log(JSON.stringify({
      studio: process.env.GAMESFUN_STUDIO ?? null,
      command: process.env.XCORE_COMMAND ?? null,
      config: process.env.GAMESFUN_CONFIG_DIR,
      made: existsSync(process.env.GAMESFUN_CONFIG_DIR),
      origin: studioOrigin(),
      own: ownOrigins(),
    }));`;
  const mine = path.join(os.tmpdir(), `a-person-s-own-config-${process.pid}`);
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
    env: { ...process.env, GAMESFUN_STUDIO: 'https://127.0.0.1:9', GAMESFUN_CONFIG_DIR: mine, XCORE_COMMAND: 'gf' },
  });
  assert.equal(r.status, 0, r.stderr);
  const seen = JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.deepEqual([seen.studio, seen.command, seen.origin], [null, null, 'https://xgames.fun']);
  // the play host counts as xgames.fun's own, as it does for every person who publishes
  assert.deepEqual(seen.own, ['https://xgames.fun', 'https://play.xgames.fun']);
  assert.match(path.basename(seen.config), /^gamesfun-test-config-/);
  assert.equal(seen.made, true, 'a new config folder while the tests run');
  assert.equal(existsSync(seen.config), false, 'removed once they end');
  assert.equal(existsSync(mine), false, "the shell's own folder is never made or written");
});
