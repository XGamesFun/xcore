// scripts/pin-version.mjs, which a release runs after `npm version`: it pins every npx example, whatever folder the
// checkout is in (a space in its path, a Windows drive), and by a relative path as CONTRIBUTING.md runs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, tempDir } from './helpers.mjs';

test('pin-version pins the examples when run from a folder whose path has a space', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const repo = path.join(tmp.dir, 'my games', 'xcore checkout');
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await mkdir(path.join(repo, 'skills', 'bring-your-own-game'), { recursive: true });
  await cp(path.join(ROOT, 'scripts', 'pin-version.mjs'), path.join(repo, 'scripts', 'pin-version.mjs'));
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: '@xgamesfun/xcore', version: '9.8.7' }));
  const example = 'Run `npx -y @xgamesfun/xcore check .` or `npx -y @xgamesfun/xcore@0.1.0 adopt .`.\n';
  for (const rel of ['README.md', 'docs/COMMANDS.md', 'skills/bring-your-own-game/SKILL.md'])
    await writeFile(path.join(repo, rel), example);
  const r = spawnSync(process.execPath, [path.join('scripts', 'pin-version.mjs')], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    r.stdout,
    'pinned README.md to 9.8.7\npinned docs/COMMANDS.md to 9.8.7\npinned skills/bring-your-own-game/SKILL.md to 9.8.7\n',
  );
  for (const rel of ['README.md', 'docs/COMMANDS.md', 'skills/bring-your-own-game/SKILL.md'])
    assert.equal(
      await readFile(path.join(repo, rel), 'utf8'),
      'Run `npx -y @xgamesfun/xcore@9.8.7 check .` or `npx -y @xgamesfun/xcore@9.8.7 adopt .`.\n',
      rel,
    );
  // imported (as tests/docs.test.mjs does), it writes nothing and gives what it pins with
  const { pinned } = await import(new URL('../scripts/pin-version.mjs', import.meta.url).href);
  assert.equal(pinned('npx -y @xgamesfun/xcore dev', '1.2.3'), 'npx -y @xgamesfun/xcore@1.2.3 dev');
});
