// What CI promises, held to its files (.github/workflows): the tests that need the server tools run on Linux, and every
// action is pinned to a commit.
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

test('on Linux the server tools are installed and every test must run', () => {
  for (const file of ['ci.yml']) {
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

test('every action is pinned to a commit', () => {
  for (const file of ['ci.yml', 'release.yml'])
    for (const [, ref] of workflow(file).matchAll(/uses: ([^\s#]+)/g))
      assert.match(ref, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${file}: ${ref}`);
});
