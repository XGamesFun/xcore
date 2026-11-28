// What CI and the release workflow promise, held to their files (.github): the publish right is held only by a job that
// runs no dependency's code, a release is tested on all three systems and installed from its tarball first, the tests
// that need the server tools run on Linux, Godot and .NET check the engine glue, every action is pinned to a commit,
// and dependency updates come as pull requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const workflow = name => readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8');
/** A workflow's top (everything before `jobs:`) and each job's text, by its name. */
function parts(text) {
  const at = text.search(/^jobs:\s*$/m);
  assert.ok(at > 0, 'a jobs: section');
  const jobs = {};
  for (const block of text
    .slice(at)
    .split(/^(?= {2}[\w-]+:\s*$)/m)
    .slice(1))
    jobs[/^ {2}([\w-]+):/.exec(block)[1]] = block;
  return { top: text.slice(0, at), jobs };
}
/** A workflow's text without its comments. */
const uncommented = job =>
  job
    .split('\n')
    .filter(l => !/^\s*#/.test(l))
    .join('\n');

test('only the publish job can publish, and it runs no install, install script, test or cache while it can', () => {
  const { top, jobs } = parts(workflow('release.yml'));
  assert.doesNotMatch(uncommented(top), /id-token/, 'the workflow itself grants no OIDC token');
  for (const [name, job] of Object.entries(jobs))
    assert.equal(/id-token:\s*write/.test(job), name === 'publish', `${name}: id-token`);
  const publish = uncommented(jobs.publish);
  assert.match(publish, /environment: npm/);
  assert.match(publish, /needs: \[test, package\]/);
  for (const banned of [
    /npm ci\b/,
    /npm install\b/,
    /npm i\b/,
    /npm test\b/,
    /npm run\b/,
    /\bcache:/,
    /node scripts\//,
  ])
    assert.doesNotMatch(publish, banned, `publish runs ${banned}`);
  assert.match(publish, /npm publish --ignore-scripts --tag "\$tag"/);
  assert.match(publish, /npm pack --dry-run --json --ignore-scripts/);
});

test('a tag publishes only a commit that is on main', () => {
  const publish = uncommented(parts(workflow('release.yml')).jobs.publish);
  assert.match(publish, /fetch-depth: 0/);
  assert.match(publish, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  // checked before anything is published
  assert.ok(publish.indexOf('merge-base') < publish.indexOf('npm publish'));
});

test('a release is tested on Linux, macOS and Windows, and its tarball installed and run, before it publishes', () => {
  const { jobs } = parts(workflow('release.yml'));
  assert.match(jobs.test, /os: \[ubuntu-latest, macos-latest, windows-latest\]/);
  assert.match(jobs.test, /fail-fast: false/);
  assert.match(jobs.test, /- run: npm test/);
  assert.match(jobs.package, /run: node scripts\/try-package\.mjs/);
  assert.match(jobs.package, /shasum: \$\{\{ steps\.try\.outputs\.shasum \}\}/);
  // the package published is the one the package job tried
  assert.match(jobs.publish, /TRIED: \$\{\{ needs\.package\.outputs\.shasum \}\}/);
  assert.match(jobs.publish, /"\$shasum" != "\$TRIED"/);
});

test('on Linux the server tools are installed and every test must run, in CI and in the release', () => {
  for (const file of ['ci.yml', 'release.yml']) {
    const { jobs } = parts(workflow(file));
    const step = /- name: The server tools[^\n]*\n\s+if: matrix\.os == 'ubuntu-latest'\n[\s\S]*?(?=\n\s+- )/.exec(
      jobs.test,
    );
    assert.ok(step, `${file}: a server tools step on Linux`);
    assert.match(step[0], /\n\s+dir="\$\(node scripts\/server-tools\.mjs "\$RUNNER_TEMP\/server-tools"\)"\n/);
    assert.match(step[0], /echo "GAMESFUN_SERVER_DEPS=\$dir" >> "\$GITHUB_ENV"/);
    assert.match(step[0], /XCORE_TEST_ALL=1/);
    assert.ok(
      jobs.test.indexOf('The server tools') < jobs.test.indexOf('- run: npm test'),
      `${file}: before the tests`,
    );
  }
});

test('Godot parses the Godot glue and .NET compiles the Unity glue, with a Godot whose sum is checked', () => {
  const { engines } = parts(workflow('ci.yml')).jobs;
  assert.ok(engines, 'an engines job');
  assert.match(engines, /GODOT_SHA512: [0-9a-f]{128}\n/);
  assert.match(engines, /sha512sum -c -/);
  assert.match(engines, /node scripts\/check-engines\.mjs --godot "\$GODOT_BIN" --dotnet dotnet/);
  assert.match(engines, /- run: npm ci/);
});

test('every action is pinned to a commit', () => {
  for (const file of ['ci.yml', 'release.yml'])
    for (const [, ref] of workflow(file).matchAll(/uses: ([^\s#]+)/g))
      assert.match(ref, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${file}: ${ref}`);
});

test('dependency updates come weekly, two weeks after a release, for npm and the actions; nothing is overridden', () => {
  const text = readFileSync(path.join(ROOT, '.github', 'dependabot.yml'), 'utf8');
  for (const ecosystem of ['npm', 'github-actions']) {
    const block = new RegExp(`- package-ecosystem: ${ecosystem}\\n([\\s\\S]*?)(?=\\n  - |$)`).exec(text);
    assert.ok(block, ecosystem);
    assert.match(block[1], /interval: weekly/, ecosystem);
    assert.match(block[1], /default-days: 14/, ecosystem);
    assert.match(block[1], /groups:/, ecosystem);
  }
  // an override pins a package under another one's feet, with no place in package.json to say why
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.overrides, undefined);
});
