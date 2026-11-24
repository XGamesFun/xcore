// The package's public modules: package.json "exports" lists each one by name (no wildcards), so an internal module
// is not public by accident. The list is what the game-making kit imports (its builder imports these subpaths from
// its own copy of this package); each one must resolve and load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

/** The subpaths the kit's builder imports (xgames-kit: builder/, bin/ and tests/), as of 2026-11-24. */
const KIT_IMPORTS = [
  'browser',
  'check',
  'cli',
  'commands/check',
  'commands/publish',
  'config-dir',
  'credentials',
  'economy',
  'open',
  'package.json',
  'play-policy',
  'publish',
  'publish/adopt',
  'publish/client',
  'publish/gate',
  'publish/hosting',
  'publish/names',
  'publish/oidc',
  'publish/page',
  'publish/scan',
  'publish/tree',
  'secret-patterns',
  'secret-store',
  'server/bundle',
  'server/contract',
  'solana-rpc',
];

test('exports names each public module, with no wildcard', () => {
  for (const key of Object.keys(pkg.exports)) assert.doesNotMatch(key, /\*/, key);
});

test('every subpath the kit imports is exported, and every export loads', async () => {
  for (const sub of KIT_IMPORTS) assert.ok(pkg.exports[`./${sub}`], `./${sub} is exported`);
  for (const key of Object.keys(pkg.exports)) {
    if (key.endsWith('.json')) continue;
    const mod = await import(`${pkg.name}/${key.slice(2)}`);
    assert.ok(Object.keys(mod).length > 0, `${key} exports something`);
  }
});

test('an internal module is not public', async () => {
  await assert.rejects(import(`${pkg.name}/review`), e => e.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED');
  await assert.rejects(import(`${pkg.name}/commands/adopt`), e => e.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED');
});
