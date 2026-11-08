// A game's own server code (lib/server/): what gamesfun.json → server may say, and what the bundle may not do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readServerConfig } from '../lib/server/contract.mjs';
import { bundleServer } from '../lib/server/bundle.mjs';
import { tempDir } from './helpers.mjs';

async function game(tmp, code, server = { main: 'server/index.js' }) {
  const dir = path.join(tmp.dir, `g${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(path.join(dir, 'server'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>g</title>');
  await writeFile(path.join(dir, 'server', 'index.js'), code);
  await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify({ server }));
  return dir;
}
const OK = 'export default { fetch: () => Response.json({ ok: true }) };\n';

test('a key gamesfun.json → server does not know is refused (a typo once dropped the Durable Objects)', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const typo = await game(tmp, OK, { main: 'server/index.js', object: [{ class: 'Pond', binding: 'POND' }] });
  const r = await readServerConfig(typo);
  assert.ok(
    r.problems.some(p =>
      /server has "object", which it does not know \(it takes main, objects, routes, compatibilityFlags\)/.test(p),
    ),
    r.problems.join('\n'),
  );
  const good = await game(tmp, OK, { main: 'server/index.js', objects: [], routes: '/api/*', compatibilityFlags: [] });
  assert.deepEqual((await readServerConfig(good)).problems, []);
});

test('a dynamic import() of a path built at run time is refused, however it is built', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  for (const code of [
    `export const z = p => import('./' + p);\n${OK}`,
    `export const z = p => import(\`./\${p}\`);\n${OK}`,
    `export const z = p => import(p);\n${OK}`,
  ]) {
    const r = await bundleServer(await game(tmp, code));
    assert.ok(
      r.problems.some(p => /dynamic import\(\) of a computed path/.test(p)),
      `${code.split('\n')[0]}: ${JSON.stringify(r.problems)}`,
    );
  }
  const fine = await bundleServer(
    await game(tmp, `export const z = () => import('./more.js');\n${OK}`).then(
      async d => (await writeFile(path.join(d, 'server', 'more.js'), 'export const x = 1;\n'), d),
    ),
  );
  assert.ok(!fine.problems.some(p => /computed path/.test(p)), JSON.stringify(fine.problems));
});

test('a named export the runtime cannot start with (a plain value) is refused; functions, classes and objects are not', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp, `export { RULES } from './rules.js';\nexport const SEASON = 5;\n${OK}`);
  await writeFile(path.join(dir, 'server', 'rules.js'), "export const RULES = 'x';\n");
  const r = await bundleServer(dir);
  assert.ok(
    r.problems.some(p => /exports SEASON = 5: the hosted runtime takes only functions, classes and objects/.test(p)),
    JSON.stringify(r.problems),
  );
  assert.ok(
    r.problems.some(p => /exports RULES = "x"/.test(p)),
    JSON.stringify(r.problems),
  );
  const fine = await bundleServer(
    await game(
      tmp,
      `export const helper = () => 1;\nexport function f() {}\nexport class K {}\nexport const TABLE = { a: 1 };\nexport const LIST = [1];\n${OK}`,
    ),
  );
  assert.deepEqual(fine.problems, []);
});
