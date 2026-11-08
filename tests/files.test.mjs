// The game's project files (xgames.fun's STORAGE.md §2, §8.6–8.8): the path and type rules, the store env.GF.files
// answers from on this machine (.gamesfun/dev/files/), the public files on an origin of their own with the files
// domain's headers, `xcore files` here and --live against a stand-in xgames.fun, and env.GF.files from a game's server
// under `xcore dev` (that last needs Miniflare: GAMESFUN_SERVER_DEPS, as tests/dev.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import path from 'node:path';
import { FILES, filePathProblem, servedType, usesFiles } from '../lib/server/contract.mjs';
import { createFileStore, FILE_HEADERS, serveFiles } from '../lib/dev/files.mjs';
import { createPlatformStore } from '../lib/dev/platform.mjs';
import { pageHeaders } from '../lib/publish/hosting.mjs';
import { adopt } from '../lib/publish/adopt.mjs';
import { publishGame } from '../lib/publish/index.mjs';
import { fixture, passing, runAsync, signIn, standIn, tempDir } from './helpers.mjs';

const noMiniflare = process.env.GAMESFUN_SERVER_DEPS
  ? false
  : 'GAMESFUN_SERVER_DEPS (a folder with miniflare) is not set';

async function game(tmp, files = {}) {
  const dir = path.join(tmp.dir, `g${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>g</title>');
  for (const [p, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, p)), { recursive: true });
    await writeFile(path.join(dir, p), text);
  }
  return dir;
}

test('a file’s path and how the files domain serves its type (§8.6, §8.7)', () => {
  for (const ok of ['a.json', 'replays/2026-11-08/run_1.bin', 'x'.repeat(512)])
    assert.equal(filePathProblem(ok), null, ok);
  for (const no of ['', '/a', 'a/', 'a//b', 'a/../b', './a', 'a/.', 'a b', 'a%2Fb', 'é.png', 'x'.repeat(513)])
    assert.ok(filePathProblem(no), no);
  for (const t of [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/avif',
    'audio/ogg',
    'video/mp4',
    'font/woff2',
    'application/json',
  ])
    assert.deepEqual(servedType(t), { type: t, inline: true }, t);
  assert.deepEqual(servedType('text/plain'), { type: 'text/plain; charset=utf-8', inline: true });
  for (const t of [
    'text/html',
    'image/svg+xml',
    'application/javascript',
    'text/css',
    'application/xml',
    'application/pdf',
    '',
    'weird',
  ])
    assert.deepEqual(servedType(t), { type: 'application/octet-stream', inline: false }, t);
  assert.ok(usesFiles('await env.GF.files.put(p, b)') && usesFiles('const { saves, files } = env.GF;'));
  assert.ok(!usesFiles('const files = new Map(); files.get(1);'));
});

test('the files store: put, get, head, list a page at a time, delete, usage, and the caps', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp);
  const store = createFileStore({ dir, origin: () => 'http://127.0.0.1:9', cap: 1000, fileBytes: 600 });
  assert.deepEqual(await store.put('levels/a.json', '{"n":1}', { public: true }), {
    ok: true,
    path: 'levels/a.json',
    bytes: 7,
    url: 'http://127.0.0.1:9/levels/a.json',
  });
  const secret = await store.put('saves/world.bin', new Uint8Array([1, 2, 3]));
  assert.deepEqual(secret, { ok: true, path: 'saves/world.bin', bytes: 3 }, 'a private file has no url');
  const got = await store.get('levels/a.json');
  assert.deepEqual([got.body.toString(), got.type, got.bytes, got.public], ['{"n":1}', 'application/json', 7, true]);
  assert.equal((await store.head('saves/world.bin')).type, 'application/octet-stream');
  assert.equal((await store.get('nope.json')).code, 'unknown');
  assert.equal((await store.put('../x', 'a')).code, 'path');
  assert.equal((await store.put('big.bin', 'x'.repeat(601))).code, 'too-big');
  assert.equal((await store.put('levels', 'x')).code, 'path', 'a file where a folder is');
  assert.equal((await store.put('c.bin', 'x'.repeat(500))).ok, true);
  assert.equal((await store.put('d.bin', 'x'.repeat(500))).code, 'full', 'past the cap');
  assert.equal((await store.put('c.bin', 'x'.repeat(590))).ok, true, 'an overwrite counts its old size out');
  assert.deepEqual(await store.usage(), { ok: true, bytes: 600, files: 3, cap: 1000 });
  for (let i = 0; i < 5; i++) await store.put(`replays/r${i}.json`, String(i));
  const one = await store.list({ prefix: 'replays/', limit: 2 });
  assert.deepEqual(
    [one.items.map(f => f.path), one.after],
    [['replays/r0.json', 'replays/r1.json'], 'replays/r1.json'],
  );
  const two = await store.list({ prefix: 'replays/', limit: 10, after: one.after });
  assert.deepEqual([two.items.length, two.after], [3, null]);
  assert.equal((await store.list({ prefix: 'replays' })).code, 'prefix', 'a prefix ends with /');
  assert.deepEqual(await store.delete('c.bin'), { ok: true, deleted: true });
  assert.deepEqual(await store.delete('c.bin'), { ok: true, deleted: false });
  assert.ok(
    existsSync(path.join(dir, '.gamesfun', 'dev', 'files', 'levels', 'a.json')),
    'kept in .gamesfun/dev/files/',
  );
  // a store opened again reads the same files
  assert.equal((await createFileStore({ dir }).usage()).files, 7);
});

test('public files on an origin of their own: the files domain’s headers, types, ETag and ranges (§8.7)', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp);
  const store = createFileStore({ dir });
  await store.put('art/hero.png', Buffer.from('PNGDATA0123456789'), { public: true });
  await store.put('page.html', '<script>alert(1)</script>', { public: true, type: 'text/html' });
  await store.put('art/logo.svg', '<svg onload="x()"/>', { public: true, type: 'image/svg+xml' });
  await store.put('hidden.json', '{}');
  const files = await serveFiles(store);
  t.after(files.close);
  const get = (p, init) => fetch(`${files.origin}/${p}`, init);
  const headersOf = r => Object.fromEntries(Object.keys(FILE_HEADERS).map(k => [k, r.headers.get(k)]));
  let r = await get('art/hero.png');
  assert.equal(r.status, 200);
  assert.deepEqual(headersOf(r), { ...FILE_HEADERS });
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('content-disposition'), null, 'a picture is shown');
  assert.equal(await r.text(), 'PNGDATA0123456789');
  // what could carry a script is a download, never a page or a picture the browser runs
  for (const p of ['page.html', 'art/logo.svg']) {
    r = await get(p);
    assert.equal(r.headers.get('content-type'), 'application/octet-stream', p);
    assert.match(r.headers.get('content-disposition'), /^attachment/, p);
    assert.deepEqual(headersOf(r), { ...FILE_HEADERS }, p);
  }
  // a private file, an unknown one, an encoded slash, a dot segment: not served, still with the headers
  for (const [p, status] of [
    ['hidden.json', 404],
    ['nope.png', 404],
    ['art%2Fhero.png', 400],
    ['art/%2E%2E/hidden.json', 404],
  ]) {
    r = await get(p);
    assert.equal(r.status, status, p);
    assert.deepEqual(headersOf(r), { ...FILE_HEADERS }, p);
  }
  assert.equal((await get('art/hero.png', { method: 'POST', body: 'x' })).status, 405);
  assert.equal((await get('art/hero.png', { method: 'OPTIONS' })).status, 204);
  const head = await get('art/hero.png', { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '17');
  const etag = head.headers.get('etag');
  assert.equal((await get('art/hero.png', { headers: { 'if-none-match': etag } })).status, 304);
  r = await get('art/hero.png', { headers: { range: 'bytes=3-6' } });
  assert.deepEqual([r.status, r.headers.get('content-range'), await r.text()], [206, 'bytes 3-6/17', 'DATA']);
  r = await get('art/hero.png', { headers: { range: 'bytes=-4' } });
  assert.equal(await r.text(), '6789');
  assert.equal((await get('art/hero.png', { headers: { range: 'bytes=40-' } })).status, 416);
  // only this machine's names (a page elsewhere pointing its own name here is refused)
  const other = await new Promise((resolve, reject) =>
    request(`${files.origin}/art/hero.png`, { headers: { host: 'evil.example' } }, res => {
      res.resume();
      resolve(res.statusCode);
    })
      .on('error', reject)
      .end(),
  );
  assert.equal(other, 403);
  // the page may load pictures, sounds, fonts and data from the files origin, and nothing more from it
  const csp = pageHeaders([], null, [files.origin])['content-security-policy'];
  for (const d of ['img-src', 'media-src', 'connect-src', 'font-src'])
    assert.match(csp, new RegExp(`${d} [^;]*${files.origin.replace(/[.:/]/g, '\\$&')}`), d);
  assert.doesNotMatch(csp, new RegExp(`script-src [^;]*${files.origin.replace(/[.:/]/g, '\\$&')}`));
});

test('env.GF.files through the dev host: a file’s bytes go to the store as they are, and come back the same', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp);
  const s = createPlatformStore({ dir, slug: 'moth' });
  s.setFilesOrigin('http://127.0.0.1:7');
  const bytes = Buffer.from([0, 255, 10, 13, 128]);
  const host = (op, init) => s.handleHost(new Request(`http://gf.local/${op}`, { method: 'POST', ...init }));
  const put = await (await host('files.put?path=w%2Fa.bin&public=1', { body: bytes })).json();
  assert.deepEqual(put, { ok: true, path: 'w/a.bin', bytes: 5, url: 'http://127.0.0.1:7/w/a.bin' });
  const got = await host('files.get', { body: JSON.stringify(['w/a.bin']) });
  assert.deepEqual(JSON.parse(got.headers.get('x-gf-answer')), {
    ok: true,
    path: 'w/a.bin',
    bytes: 5,
    type: 'application/octet-stream',
    public: true,
    updatedAt: JSON.parse(got.headers.get('x-gf-answer')).updatedAt,
    etag: JSON.parse(got.headers.get('x-gf-answer')).etag,
  });
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), bytes);
  assert.equal((await (await host('files.get', { body: '["none"]' })).json()).code, 'unknown');
  assert.equal((await s.run('files.list', [{ prefix: 'w/' }])).items.length, 1);
  assert.deepEqual(await s.run('files.usage', []), { ok: true, bytes: 5, files: 1, cap: FILES.capBytes });
  assert.equal(
    (await (await host('files.put?path=big', { body: Buffer.alloc(FILES.fileBytes + 1) })).json()).code,
    'too-big',
  );
});

test('xcore files on this machine: put, ls, get, rm, usage', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp, { 'level.json': '{"tiles":[1,2]}' });
  const xc = args => runAsync(['files', ...args], { cwd: dir });
  let r = await xc(['put', 'level.json', 'levels/forest-3.json', '--public']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Put levels\/forest-3\.json on this machine \(15 bytes, public\)/);
  r = await xc(['ls', 'levels/']);
  assert.match(r.stdout, /public\s+15 bytes\s+levels\/forest-3\.json\s+\(application\/json\)/);
  r = await xc(['get', 'levels/forest-3.json', '--out', path.join(tmp.dir, 'back.json')]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(await readFile(path.join(tmp.dir, 'back.json'), 'utf8'), '{"tiles":[1,2]}');
  r = await xc(['get', 'levels/forest-3.json', '--out', path.join(tmp.dir, 'back.json')]);
  assert.equal(r.status, 2, 'it does not write over a file without --force');
  r = await xc(['usage', '--json']);
  assert.deepEqual(JSON.parse(r.stdout), { live: false, ok: true, bytes: 15, files: 1, cap: FILES.capBytes });
  r = await xc(['put', 'level.json', 'a/../b.json']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no "\." or "\.\." part/);
  r = await xc(['rm', 'levels/forest-3.json']);
  assert.match(r.stdout, /Deleted levels\/forest-3\.json on this machine/);
});

test('xcore files --live: refused until xgames.fun lists "files", then through the owner routes (§8.8)', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = {
    GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'),
    GAMESFUN_CREDENTIALS: 'file',
    GAMESFUN_STUDIO: g.origin,
  };
  await signIn(g, env);
  const dir = await game(tmp, { 'hero.png': 'PNG!' });
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(
    path.join(dir, '.gamesfun', 'publish.json'),
    JSON.stringify({ [g.origin]: { projectId: 'g1', slug: 'moth' } }),
  );
  const seen = [];
  g.state.handle = (method, url, json, { req, raw, authed }) => {
    if (!url.startsWith('/api/kit/games/g1/files')) return null;
    if (!authed) return [401, { error: 'Sign in first.' }];
    seen.push({
      method,
      url,
      type: req.headers['content-type'],
      pub: req.headers['x-gf-public'],
      body: raw.toString(),
    });
    if (url === '/api/kit/games/g1/files-usage') return [200, { ok: true, bytes: 4, files: 1, cap: 104857600 }];
    if (url.startsWith('/api/kit/games/g1/files?'))
      return [
        200,
        {
          ok: true,
          items: [{ path: 'art/hero.png', bytes: 4, type: 'image/png', public: true, updatedAt: 1 }],
          after: null,
        },
      ];
    if (method === 'PUT')
      return [
        200,
        { ok: true, path: 'art/hero.png', bytes: 4, url: 'https://moth.xgamesusercontent.com/art/hero.png' },
      ];
    if (method === 'GET') return [200, Buffer.from('PNG!'), { 'content-type': 'image/png' }];
    if (method === 'DELETE') return [200, { ok: true, deleted: true }];
    return null;
  };
  const xc = args => runAsync(['files', ...args, '--live'], { env, cwd: dir });
  let r = await xc(['usage']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /does not keep project files yet .*"files"/);
  assert.equal(seen.length, 0, 'nothing was asked of the files routes');
  g.state.me = {
    server: { contracts: ['gf-server-v1'], features: ['d1', 'files'] },
    files: { domain: 'xgamesusercontent.com' },
  };
  r = await xc(['put', 'hero.png', 'art/hero.png', '--public']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /https:\/\/moth\.xgamesusercontent\.com\/art\/hero\.png/);
  assert.deepEqual(seen.at(-1), {
    method: 'PUT',
    url: '/api/kit/games/g1/files/art/hero.png',
    type: 'image/png',
    pub: '1',
    body: 'PNG!',
  });
  r = await xc(['ls', 'art']);
  assert.match(r.stdout, /public\s+4 bytes\s+art\/hero\.png/);
  assert.equal(seen.at(-1).url, '/api/kit/games/g1/files?prefix=art%2F');
  r = await xc(['get', 'art/hero.png', '--out', path.join(tmp.dir, 'h.png')]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(await readFile(path.join(tmp.dir, 'h.png'), 'utf8'), 'PNG!');
  r = await xc(['rm', 'art/hero.png']);
  assert.match(r.stdout, /Deleted art\/hero\.png on xgames\.fun/);
  assert.equal(seen.at(-1).method, 'DELETE');
  r = await xc(['usage']);
  assert.match(r.stdout, /1 file, 4 bytes of 100\.0 MB/);
});

test('publish: a server that uses env.GF.files is refused until xgames.fun lists "files"', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  const env = { GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'), GAMESFUN_CREDENTIALS: 'file' };
  await signIn(g, env);
  const dir = await fixture(tmp, 'static');
  await adopt(dir);
  await mkdir(path.join(dir, 'server'), { recursive: true });
  await writeFile(
    path.join(dir, 'server', 'index.js'),
    'export default { async fetch(req, env) { return Response.json(await env.GF.files.usage()); } };\n',
  );
  g.state.me = { server: { contracts: ['gf-server-v1'] } };
  await assert.rejects(
    publishGame(dir, { origin: g.origin, env, check: passing }),
    e => e.code === 'feature' && e.feature === 'files',
  );
  g.state.me = { server: { contracts: ['gf-server-v1'], features: ['files'] } };
  assert.equal((await publishGame(dir, { origin: g.origin, env, check: passing })).server.sent, true);
});

test(
  'xcore dev: env.GF.files from the game’s server, its public files on their own origin, the page allowed to load them',
  { skip: noMiniflare, timeout: 120_000 },
  async t => {
    const { startDev } = await import('../lib/dev/index.mjs');
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await game(tmp, {
      'server/index.js': `export default { async fetch(req, env) {
        const u = new URL(req.url);
        if (u.pathname === '/api/save') {
          const stream = new Blob(['{"wave":3}']).stream();
          return Response.json(await env.GF.files.put('replays/one.json', stream, { type: 'application/json', public: true }));
        }
        if (u.pathname === '/api/secret') return Response.json(await env.GF.files.put('keep/x.txt', 'only the server'));
        if (u.pathname === '/api/read') {
          const f = await env.GF.files.get('keep/x.txt');
          return Response.json({ ...f, body: await new Response(f.body).text() });
        }
        if (u.pathname === '/api/list') return Response.json(await env.GF.files.list({ prefix: '' }));
        if (u.pathname === '/api/bad') return Response.json(await env.GF.files.put('../up', 'x'));
        return new Response('no', { status: 404 });
      } };\n`,
    });
    const dev = await startDev(dir, { port: 0, log: () => {}, env: process.env });
    t.after(() => dev.close());
    assert.equal(dev.server.running, true, JSON.stringify(dev.server));
    assert.notEqual(new URL(dev.files).port, new URL(dev.origin).port, 'another origin');
    const put = await (await fetch(`${dev.url}api/save`)).json();
    assert.deepEqual(put, { ok: true, path: 'replays/one.json', bytes: 10, url: `${dev.files}/replays/one.json` });
    const served = await fetch(put.url);
    assert.equal(served.headers.get('content-security-policy'), "sandbox; default-src 'none'");
    assert.equal(served.headers.get('access-control-allow-origin'), '*');
    assert.equal(await served.text(), '{"wave":3}');
    assert.deepEqual(await (await fetch(`${dev.url}api/secret`)).json(), { ok: true, path: 'keep/x.txt', bytes: 15 });
    assert.equal((await fetch(`${dev.files}/keep/x.txt`)).status, 404, 'a private file is not served');
    const read = await (await fetch(`${dev.url}api/read`)).json();
    assert.deepEqual([read.ok, read.body, read.public], [true, 'only the server', false]);
    assert.deepEqual(
      (await (await fetch(`${dev.url}api/list`)).json()).items.map(f => f.path),
      ['keep/x.txt', 'replays/one.json'],
    );
    assert.equal((await (await fetch(`${dev.url}api/bad`)).json()).code, 'path');
    const page = await fetch(dev.url);
    assert.match(
      page.headers.get('content-security-policy'),
      new RegExp(`img-src [^;]*${dev.files.replace(/[.:/]/g, '\\$&')}`),
    );
  },
);
