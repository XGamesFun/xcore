// scripts/try-package.mjs, which the release runs before it publishes: the package as npm ships it installs and runs,
// and a package that imports a file it does not carry is refused, with the file named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, tempDir } from './helpers.mjs';

const SCRIPT = path.join(ROOT, 'scripts', 'try-package.mjs');
const tryPackage = (args = []) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 300_000, env: { ...process.env } });

test('the package as npm ships it installs, carries every file it imports, and runs', () => {
  const r = tryPackage();
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const line of [
    '✔ every file the package imports is in it',
    '✔ xcore --version',
    '✔ xcore --help',
    '✔ xcore adopt',
    '✔ xcore add signin',
    `@xgamesfun/xcore@${version} installs and runs.`,
  ])
    assert.ok(r.stdout.includes(line), `${line}\n${r.stdout}`);
  assert.match(r.stdout, /shasum [0-9a-f]{40}/);
});

test('a package whose code imports a file outside package.json "files" is refused before it is published', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const copy = path.join(tmp.dir, 'pkg');
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  for (const entry of [...pkg.files, 'package.json'])
    await cp(path.join(ROOT, entry), path.join(copy, entry), { recursive: true });
  // scripts/ is not shipped: a module that loads it works in the checkout and breaks once installed
  const api = path.join(copy, 'lib', 'api.mjs');
  await writeFile(api, `import '../scripts/pin-version.mjs';\n${await readFile(api, 'utf8')}`);
  const r = tryPackage(['--root', copy]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /files the package imports but does not carry/);
  assert.match(r.stderr, /lib[\\/]api\.mjs: Could not resolve "\.\.\/scripts\/pin-version\.mjs"/);
  assert.match(r.stderr, /The package is not ready/);
});
