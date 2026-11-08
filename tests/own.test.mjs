// The package stands alone: every relative import stays inside it, and every bare one is its own dependency or Node's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const own = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const walk = (p, out = []) => {
  if (statSync(p).isDirectory()) for (const e of readdirSync(p)) walk(path.join(p, e), out);
  else if (/\.(mjs|js)$/.test(p)) out.push(p);
  return out;
};
// what npm publishes (package.json "files"): dev tooling such as eslint.config.mjs is not part of the package
const shipped = () =>
  own.files
    .map(f => path.join(ROOT, f))
    .filter(existsSync)
    .flatMap(p => walk(p));

test('nothing outside the package, and no package it does not declare', () => {
  const declared = new Set(Object.keys(own.dependencies ?? {}));
  const re =
    /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const out = [];
  for (const f of shipped()) {
    if (f.includes(`${path.sep}loot-page${path.sep}`)) continue; // wallets.js runs in a game's page, beside gf/loot/
    // the database xcore writes into a game's server/ runs on games.fun's Workers, where cloudflare:workers is the runtime's
    if (f.includes(`${path.sep}lib${path.sep}client${path.sep}server${path.sep}`)) continue;
    // xcore dev's env.GF stand-in runs inside workerd beside the game's server, where cloudflare:workers is the runtime's
    if (f.endsWith(`${path.sep}lib${path.sep}dev${path.sep}gf-local.js`)) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(re)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith('.')) {
        if (!path.resolve(path.dirname(f), spec).startsWith(ROOT + path.sep))
          out.push(`${path.relative(ROOT, f)}: ${spec}`);
        continue;
      }
      const name = spec.startsWith('node:')
        ? null
        : spec.startsWith('@')
          ? spec.split('/').slice(0, 2).join('/')
          : spec.split('/')[0];
      if (name && !declared.has(name) && !builtinModules.includes(name)) out.push(`${path.relative(ROOT, f)}: ${spec}`);
    }
  }
  assert.deepEqual(out, []);
  assert.ok(!declared.has('@xgamesfun/kit'), 'it never depends on the kit');
});
