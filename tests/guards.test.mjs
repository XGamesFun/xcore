// Guards that keep a game, its players and its owner safe, each held by one plain assertion: a backend.json origin on a
// private name, the page's frame-ancestors, a Studio over plain http, a bare Node built-in in a game's server, and the
// database's size limit in bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { register } from 'node:module';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PUBLIC_EMBEDDERS, playHeaders } from '../lib/play-policy.mjs';
import { pageHeaders } from '../lib/publish/hosting.mjs';
import { studioOrigin } from '../lib/publish/client.mjs';
import { backendOrigin, backendOrigins } from '../lib/publish/scan.mjs';
import { bundleServer } from '../lib/server/bundle.mjs';
import { tempDir } from './helpers.mjs';

// the database imports cloudflare:workers (a Durable Object's base class); here a stand-in, as tests/add.test.mjs
register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(s, c, next) { if (s === 'cloudflare:workers') return { url: 'data:text/javascript,' + encodeURIComponent('export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }'), shortCircuit: true }; return next(s, c); }`,
    ),
);
const { createData } = await import('../lib/client/server/database.js');

test('a backend origin on a private or reserved name is refused: a published game could never reach it', () => {
  for (const host of [
    'api.corp.internal',
    'internal',
    'nas.lan',
    'router.home',
    'printer.local',
    'api.test',
    'api.example',
    'x.invalid',
    'db.localhost',
  ]) {
    const origin = `https://${host}`;
    assert.throws(() => backendOrigin(origin), /must be a public name|is on this machine/, origin);
    const { origins, problems } = backendOrigins({ origins: [origin] });
    assert.deepEqual(origins, [], origin);
    assert.equal(problems.length, 1, origin);
  }
  // a public name that only contains one of those words is a public name
  for (const origin of ['https://internal.example.com', 'https://api.home-games.dev', 'https://local.supabase.co'])
    assert.equal(backendOrigin(origin), origin);
});

test('who may frame a game is exactly its own origin, the play page and the listed embedders: never "*"', async t => {
  const ancestors = headers => {
    const rule = headers['content-security-policy'].split('; ').find(r => r.startsWith('frame-ancestors '));
    assert.ok(rule, 'a frame-ancestors rule');
    return rule.split(' ').slice(1);
  };
  // what the check and the dev host send: framed by the check's own stand-in for the play page
  assert.deepEqual(ancestors(pageHeaders([], null, [], 'http://localhost:5173')), ["'self'", 'http://localhost:5173']);
  assert.deepEqual(ancestors(pageHeaders()), ["'self'"]);
  // the play host: the Studio and the public embedders, each named
  const hosted = ancestors(playHeaders({ studioOrigin: 'https://xgames.fun', embedders: PUBLIC_EMBEDDERS }));
  assert.deepEqual(hosted, ["'self'", 'https://xgames.fun', ...PUBLIC_EMBEDDERS]);
  // a wildcard only ever stands for a subdomain of a named site (https://*.x.com), never for any site
  for (const source of hosted) assert.match(source, /^('self'|https:\/\/(\*\.)?[a-z0-9.-]+\.[a-z]+)$/, source);
  // and the page the check serves carries it
  const { servePage } = await import('../lib/check.mjs');
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  await writeFile(path.join(tmp.dir, 'index.html'), '<!doctype html><title>x</title>');
  const site = await servePage(tmp.dir);
  t.after(site.close);
  const served = (await fetch(`${site.url}index.html`)).headers.get('content-security-policy');
  const rule = served.split('; ').find(r => r.startsWith('frame-ancestors '));
  assert.equal(rule, `frame-ancestors 'self' ${site.framedOrigin}`);
});

test('the Studio is reached over https only, or over http on this machine: a publish token never travels in the clear', () => {
  for (const raw of [
    'http://xgames.fun',
    'http://studio.example.com',
    'http://10.0.0.1:3000',
    'http://192.168.1.5',
    'http://localhost.example.com',
    'ftp://xgames.fun',
    'https://user:pass@xgames.fun',
  ])
    assert.throws(
      () => studioOrigin({ GAMESFUN_STUDIO: raw }),
      /GAMESFUN_STUDIO must be an https address \(or http on this machine\)/,
      raw,
    );
  for (const [raw, origin] of [
    ['https://studio.example.com/', 'https://studio.example.com'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://127.0.0.1:3000', 'http://127.0.0.1:3000'],
    ['http://[::1]:3000', 'http://[::1]:3000'],
  ])
    assert.equal(studioOrigin({ GAMESFUN_STUDIO: raw }), origin, raw);
  assert.equal(studioOrigin({}), 'https://xgames.fun');
});

test("a game's server that imports a Node built-in by its bare name is refused in words, as node:<name> is", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  for (const [name, code] of [
    ['fs', "import fs from 'fs';\nexport const read = () => fs.readFileSync;"],
    ['fs/promises', "import { readFile } from 'fs/promises';\nexport const read = () => readFile;"],
    ['crypto', "import { createHash } from 'crypto';\nexport const h = () => createHash;"],
  ]) {
    const dir = path.join(tmp.dir, name.replace('/', '-'));
    await mkdir(path.join(dir, 'server'), { recursive: true });
    await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>g</title>');
    await writeFile(
      path.join(dir, 'server', 'index.js'),
      `${code}\nexport default { fetch: () => Response.json({ ok: true }) };\n`,
    );
    await writeFile(path.join(dir, 'gamesfun.json'), JSON.stringify({ server: { main: 'server/index.js' } }));
    const b = await bundleServer(dir);
    assert.equal(b.ok, false, name);
    const said = b.problems.find(p => p.includes(`imports ${JSON.stringify(name)}`));
    assert.ok(said, `${name}: ${JSON.stringify(b.problems)}`);
    assert.match(said, /one of Node's built-in modules, which a game's server on xgames\.fun does not have/);
    assert.match(said, /crypto\.subtle/);
  }
});

test("the database's document limit counts bytes, so text in any language gets the same room", async () => {
  const db = new DatabaseSync(':memory:');
  const data = createData((q, ...b) => db.prepare(q).all(...b), {
    rules: { notes: { read: 'owner', write: 'owner' } },
    limits: { valueBytes: 200, docsPerPlayer: 10, list: 10 },
    now: () => 1,
  });
  // a JSON string of k two-byte letters is 2k + 2 bytes and k + 2 characters
  assert.equal((await data.put('notes', 'fits', 'é'.repeat(99), {}, 'p1')).ok, true, '200 bytes fit');
  assert.equal((await data.put('notes', 'over', 'é'.repeat(100), {}, 'p1')).code, 'too-big', '202 bytes do not');
  // three-byte and four-byte text the same way: 102 and 52 characters, 302 and 202 bytes
  assert.equal((await data.put('notes', 'han', '漢'.repeat(100), {}, 'p1')).code, 'too-big');
  assert.equal((await data.put('notes', 'emoji', '🎮'.repeat(50), {}, 'p1')).code, 'too-big');
  assert.equal((await data.put('notes', 'ascii', 'x'.repeat(198), {}, 'p1')).ok, true);
});
