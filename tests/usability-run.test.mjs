// What a new developer met in a usability run of 0.12.0: a pipe closed early, hints that name the paths they typed, a
// part asked for by the name of what it comes with, and a finding in a built bundle traced back to the source line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adopt, addLoot } from '../lib/publish/adopt.mjs';
import { ECONOMY_FILE } from '../lib/economy.mjs';
import { sourceFinder } from '../lib/publish/adopt/page-scan.mjs';
import { unknownKind } from '../commands/add.mjs';
import { ownWords } from '../commands/loot.mjs';
import { BIN, fixture, tempDir } from './helpers.mjs';

test('xcore loot into a reader that stops early (| head) ends quietly', async () => {
  const child = spawn(process.execPath, [BIN, 'loot', 'guide', 'boxes'], { env: { ...process.env, GAMESFUN_KIT: '' } });
  let stderr = '';
  child.stderr.on('data', c => (stderr += c));
  child.stdout.once('data', () => child.stdout.destroy());
  const status = await new Promise(resolve => child.on('close', resolve));
  assert.doesNotMatch(stderr, /EPIPE|Unhandled/);
  assert.equal(status, 0);
});

test('a leaderboard, saves or scores are said to come with signin', () => {
  for (const what of ['leaderboard', 'saves', 'scores'])
    assert.match(unknownKind(what), /comes with signin: .* add signin$/);
  assert.match(unknownKind('teleport'), /is not something xcore can add/);
});

test("xcore loot's header says the economy file as it was named", () => {
  const say = ownWords({ file: 'game/xsolana.json', named: 'xsolana.json' });
  assert.match(say('“Shop” (xsolana.json): a new economy'), /\(game\/xsolana\.json\)/);
});

test('loot add names the game and its economy file from the folder the command runs in', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'vite-like');
  await adopt(dir);
  const name = path.basename(dir);
  const before = await addLoot(dir, { cwd: path.dirname(dir) });
  assert.match(before.next.join('\n'), new RegExp(`loot check ${name}/public/${ECONOMY_FILE}`));
  assert.match(before.next.join('\n'), new RegExp(`test it with .*dev ${name}, which installs the page client`));
  await writeFile(path.join(dir, 'public', ECONOMY_FILE), '{}');
  const after = (await addLoot(dir, { cwd: path.dirname(dir) })).next.join('\n');
  assert.match(after, new RegExp(`dev ${name}\\b`));
  assert.match(after, new RegExp(`loot approve ${name}/public/${ECONOMY_FILE} --keypair`));
});

test('a path from the root in a built bundle is found in the source that wrote it', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = tmp.dir;
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await mkdir(path.join(dir, 'dist', 'assets'), { recursive: true });
  await writeFile(path.join(dir, 'src', 'main.js'), "const a = 1;\nconst b = 2;\nimg.src = '/assets/player.svg';\n");
  await writeFile(path.join(dir, 'dist', 'assets', 'index-abc.js'), "img.src='/assets/player.svg'");
  const find = sourceFinder(dir, 'dist');
  assert.equal(find('/assets/player.svg'), 'src/main.js:3');
  assert.equal(find('/assets/other.svg'), null);
});
