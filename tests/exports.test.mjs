// The package's public API: one entry point (lib/api.mjs, with types in types/index.d.ts) and package.json. Every
// other module is internal: not reachable by an import of the package, so it can change in any release.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const PUBLIC = ['PLAN_LIMITS', 'adopt', 'check', 'publishCheck', 'publishStatus'];

test('exports: the entry point and package.json, nothing else', () => {
  assert.deepEqual(Object.keys(pkg.exports), ['.', './package.json']);
  assert.equal(pkg.exports['.'].types, './types/index.d.ts');
  assert.equal(pkg.types, './types/index.d.ts');
  assert.ok(pkg.files.includes('types/'), 'the types are published');
});

test('the entry point exports the documented calls, and its types declare the same', async () => {
  const api = await import(pkg.name);
  assert.deepEqual(Object.keys(api).sort(), PUBLIC);
  for (const name of PUBLIC.filter(n => n !== 'PLAN_LIMITS')) assert.equal(typeof api[name], 'function', name);
  assert.equal(api.PLAN_LIMITS.free.cpuMs, 50);
  const types = await readFile(new URL('../types/index.d.ts', import.meta.url), 'utf8');
  for (const name of PUBLIC) assert.match(types, new RegExp(`export (?:function|const) ${name}\\b`), name);
  const doc = await readFile(new URL('../docs/API.md', import.meta.url), 'utf8');
  for (const name of PUBLIC) assert.ok(doc.includes(`\`${name}`), `docs/API.md documents ${name}`);
});

test('an internal module is not public', async () => {
  for (const sub of ['review', 'publish', 'secret-store', 'credentials', 'publish/oidc', 'commands/publish'])
    await assert.rejects(import(`${pkg.name}/${sub}`), e => e.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED', sub);
});
