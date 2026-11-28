// The game's project files: the path and type rules, the store env.GF.files
// answers from on this machine (.gamesfun/dev/files/), the public files on an origin of their own with the files
// domain's headers, `xcore files` here and --live against a stand-in xgames.fun (where writing over a file or deleting
// one prints first and needs --yes <code>), and env.GF.files from a game's server under `xcore dev` (that last needs
// Miniflare: GAMESFUN_SERVER_DEPS, as tests/dev.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import path from 'node:path';
import { FILES, STUDIO_BODY_BYTES, filePathProblem, servedType, usesFiles } from '../lib/server/contract.mjs';
import { createFileStore, FILE_HEADERS, serveFiles } from '../lib/dev/files.mjs';
import { createPlatformStore } from '../lib/dev/platform.mjs';
import { DEFAULT_LIMITS, pageHeaders } from '../lib/publish/hosting.mjs';
import { adopt } from '../lib/publish/adopt.mjs';
import { leftOutOfPublish } from '../lib/publish/tree.mjs';
import { publishGame } from '../lib/publish/index.mjs';
import { sizeText as filesSizeText } from '../lib/files.mjs';
import { plural, sizeText } from '../lib/util.mjs';
import db from '../commands/db.mjs';
import { fixture, passing, ROOT, runAsync, signIn, standIn, tempDir } from './helpers.mjs';

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

test('sizes and counts are printed by one helper each: a size on the scale the limits are set in, a count with its word', async () => {
  // 1 MB is 1,048,576 bytes, as the limits are (a game's 100 MB, a file's 25 MB): a limit reads as the documents state it
  for (const [bytes, said] of [
    [0, '0 bytes'],
    [1, '1 byte'],
    [1023, '1023 bytes'],
    [1024, '1 KB'],
    [2355, '2.3 KB'],
    [1_048_575, '1 MB'],
    [4_600_000, '4.4 MB'],
    [FILES.fileBytes, '25 MB'],
    [DEFAULT_LIMITS.totalBytes, '100 MB'],
    [1.5 * 1024 ** 3, '1.5 GB'],
  ])
    assert.equal(sizeText(bytes), said);
  assert.equal(filesSizeText, sizeText, 'xcore files prints sizes with the same one');
  assert.deepEqual(
    [
      plural(0, 'file'),
      plural(1, 'file'),
      plural(2, 'file'),
      plural(1, 'entry', 'entries'),
      plural(3, 'entry', 'entries'),
    ],
    ['0 files', '1 file', '2 files', '1 entry', '3 entries'],
  );
  // Studio's limit on a request is one number wherever it is said: db import's help says what its refusal says
  const flat = text => text.replace(/\s+/g, ' ');
  assert.equal(sizeText(STUDIO_BODY_BYTES), '4.3 MB');
  assert.ok(flat(db.usage).includes('at most 5 MB (live, 4.3 MB as sent)'), db.usage);
  // no command formats a size of its own: each would drift from this one (the dev host's words are xgames.fun's own)
  const own = /\.toFixed\(\d\)\} ?(KB|MB|GB)\b/;
  for (const folder of ['commands', 'lib', 'lib/publish', 'lib/publish/adopt'])
    for (const name of (await readdir(path.join(ROOT, folder))).filter(f => f.endsWith('.mjs') && f !== 'util.mjs')) {
      const text = await readFile(path.join(ROOT, folder, name), 'utf8');
      assert.doesNotMatch(text, own, `${folder}/${name} formats a size itself: use sizeText (lib/util.mjs)`);
    }
});

test('a file’s path and how the files domain serves its type', () => {
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
  assert.deepEqual(await store.put('levels/a.json', '{"n":1}', { public: true, type: 'application/json' }), {
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
  assert.equal((await store.get('nope.json')).code, 'not-found');
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

test('the files store: a path named __proto__, constructor or toString is a file like any other', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp);
  const store = createFileStore({ dir });
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty'])
    assert.equal((await store.head(name)).code, 'not-found', `${name} before it is put`);
  for (const name of ['__proto__', 'constructor', 'toString', 'levels/constructor'])
    assert.deepEqual(await store.put(name, name, { public: true, type: 'text/plain' }), {
      ok: true,
      path: name,
      bytes: name.length,
    });
  assert.equal((await store.get('__proto__')).body.toString(), '__proto__');
  assert.match(await readFile(path.join(dir, '.gamesfun', '.gitignore'), 'utf8'), /^\*$/m, 'kept out of git');
  assert.deepEqual(await store.usage(), { ok: true, bytes: 9 + 11 + 8 + 18, files: 4, cap: FILES.capBytes });
  // kept on disk and read back the same by another store
  const again = createFileStore({ dir });
  assert.deepEqual(
    (await again.list()).items.map(f => f.path),
    ['__proto__', 'constructor', 'levels/constructor', 'toString'],
  );
  assert.equal((await again.served('toString'))?.meta.public, true);
  assert.deepEqual(await again.delete('constructor'), { ok: true, deleted: true });
  assert.deepEqual(await again.delete('valueOf'), { ok: true, deleted: false });
  assert.equal((await again.usage()).files, 3);
});

test('.gamesfun/ gets a .gitignore of its own (*) the first time xcore writes there; one of yours is left alone', async t => {
  const { stateFolder, STATE_GITIGNORE } = await import('../lib/state-folder.mjs');
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp);
  assert.equal(await stateFolder(dir), path.join(dir, '.gamesfun'));
  assert.equal(await readFile(path.join(dir, '.gamesfun', '.gitignore'), 'utf8'), STATE_GITIGNORE);
  await writeFile(path.join(dir, '.gamesfun', '.gitignore'), 'exports/\n');
  await stateFolder(dir);
  assert.equal(await readFile(path.join(dir, '.gamesfun', '.gitignore'), 'utf8'), 'exports/\n');
  // what its words say works: deleted, it comes back; changed (even emptied), it is kept as written
  const { rm } = await import('node:fs/promises');
  assert.doesNotMatch(STATE_GITIGNORE, /delete this file/);
  assert.match(STATE_GITIGNORE, /deleting it does not\n# let anything in: change it instead/);
  await rm(path.join(dir, '.gamesfun', '.gitignore'));
  await stateFolder(dir);
  assert.equal(await readFile(path.join(dir, '.gamesfun', '.gitignore'), 'utf8'), STATE_GITIGNORE);
  await writeFile(path.join(dir, '.gamesfun', '.gitignore'), '');
  await stateFolder(dir);
  assert.equal(await readFile(path.join(dir, '.gamesfun', '.gitignore'), 'utf8'), '');
});

test('public files on an origin of their own: the files domain’s headers, types, ETag and ranges', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp);
  let store = createFileStore({ dir });
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('DATA01234')]);
  await store.put('art/hero.png', png, { public: true, type: 'image/png' });
  // what a browser runs is never public, as xgames.fun refuses it
  for (const [p, body, type] of [
    ['page.html', '<script>alert(1)</script>', 'text/html'],
    ['art/logo.svg', '<svg onload="x()"/>', 'image/svg+xml'],
  ]) {
    assert.equal((await store.put(p, body, { public: true, type })).code, 'type', p);
    await store.put(p, body, { type });
  }
  await store.put('hidden.json', '{}', { type: 'application/json' });
  // a file kept public before the type check (an older xcore dev) is served, but only as a download
  const index = path.join(dir, '.gamesfun', 'dev', 'files.json');
  const kept = JSON.parse(await readFile(index, 'utf8'));
  for (const p of ['page.html', 'art/logo.svg']) kept[p].public = true;
  await writeFile(index, JSON.stringify(kept));
  store = createFileStore({ dir });
  const files = await serveFiles(store);
  t.after(files.close);
  const get = (p, init) => fetch(`${files.origin}/${p}`, init);
  const headersOf = r => Object.fromEntries(Object.keys(FILE_HEADERS).map(k => [k, r.headers.get(k)]));
  let r = await get('art/hero.png');
  assert.equal(r.status, 200);
  assert.deepEqual(headersOf(r), { ...FILE_HEADERS });
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('content-disposition'), null, 'a picture is shown');
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), png);
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
  r = await get('art/hero.png', { headers: { range: 'bytes=8-11' } });
  assert.deepEqual([r.status, r.headers.get('content-range'), await r.text()], [206, 'bytes 8-11/17', 'DATA']);
  r = await get('art/hero.png', { headers: { range: 'bytes=-4' } });
  assert.equal(await r.text(), '1234');
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
  // bytes of no public type stay private (public: refused, as xgames.fun refuses them)
  assert.equal((await (await host('files.put?path=w%2Fa.bin&public=1', { body: bytes })).json()).code, 'type');
  const put = await (await host('files.put?path=w%2Fa.bin', { body: bytes })).json();
  assert.deepEqual(put, { ok: true, path: 'w/a.bin', bytes: 5 });
  const got = await host('files.get', { body: JSON.stringify(['w/a.bin']) });
  assert.deepEqual(JSON.parse(got.headers.get('x-gf-answer')), {
    ok: true,
    path: 'w/a.bin',
    bytes: 5,
    type: 'application/octet-stream',
    public: false,
    updatedAt: JSON.parse(got.headers.get('x-gf-answer')).updatedAt,
    etag: JSON.parse(got.headers.get('x-gf-answer')).etag,
  });
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), bytes);
  assert.equal((await (await host('files.get', { body: '["none"]' })).json()).code, 'not-found');
  assert.equal((await s.run('files.list', [{ prefix: 'w/' }])).items.length, 1);
  assert.deepEqual(await s.run('files.usage', []), { ok: true, bytes: 5, files: 1, cap: FILES.capBytes });
  assert.equal(
    (await (await host('files.put?path=big', { body: Buffer.alloc(FILES.fileBytes + 1) })).json()).code,
    'too-big',
  );
  // a stream (as gf-local.js marks one): held to exactly its length; with none, read up to 1 MB
  const stream = (q, body) => host(`files.put?path=s.bin&stream=1${q}`, { body }).then(r => r.json());
  assert.deepEqual(await stream('&length=3', Buffer.from('abc')), { ok: true, path: 's.bin', bytes: 3 });
  assert.match((await stream('&length=4', Buffer.from('abc'))).why, /fewer bytes than its length \(4\)/);
  assert.match((await stream('&length=2', Buffer.from('abc'))).why, /more bytes than its length \(2\)/);
  assert.equal((await stream('', Buffer.alloc(1024 * 1024))).ok, true, 'up to 1 MB with no length');
  const unsized = await stream('', Buffer.alloc(1024 * 1024 + 1));
  assert.deepEqual(
    [unsized.code, /needs its length: put\(path, stream, \{length\}\)/.test(unsized.why)],
    ['body', true],
  );
  assert.equal((await stream(`&length=${FILES.fileBytes + 1}`, Buffer.from('a'))).code, 'too-big');
  assert.equal((await stream('&length=1048577', Buffer.alloc(1048577))).ok, true, 'a length: past 1 MB');
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
  assert.equal(r.status, 1, 'it does not write over a file without --force: a refusal, not a usage mistake');
  assert.match(r.stderr, /back\.json is there already: --force writes over it, or --out <file>\n$/);
  r = await xc(['get', 'levels/forest-3.json', '--out', path.join(tmp.dir, 'back.json'), '--json']);
  assert.deepEqual(
    [JSON.parse(r.stdout).code, / --out .*back\.json --force/.test(JSON.parse(r.stdout).next)],
    ['exists', true],
  );
  // by default a download goes where publish never takes it, readable by this user only; a file among the published
  // files is refused, since the next publish would make a private file public
  r = await xc(['get', 'levels/forest-3.json']);
  assert.equal(r.status, 0, r.stderr);
  const kept = path.join(dir, '.gamesfun', 'downloads', 'levels', 'forest-3.json');
  assert.equal(await readFile(kept, 'utf8'), '{"tiles":[1,2]}');
  if (process.platform !== 'win32') assert.equal((await stat(kept)).mode & 0o777, 0o600);
  assert.equal(leftOutOfPublish('.gamesfun/downloads/levels/forest-3.json'), true);
  r = await xc(['get', 'levels/forest-3.json', '--out', path.join(dir, 'forest-3.json')]);
  assert.equal(r.status, 1);
  assert.match(
    r.stderr,
    /is among the game's published files \(forest-3\.json\), so the next publish would put this project file up as a public page file/,
  );
  assert.equal(existsSync(path.join(dir, 'forest-3.json')), false);
  // --force over a file that was there: its mode becomes this user's only too
  const loose = path.join(tmp.dir, 'loose.json');
  await writeFile(loose, 'old', { mode: 0o644 });
  r = await xc(['get', 'levels/forest-3.json', '--out', loose, '--force']);
  assert.equal(r.status, 0, r.stderr);
  if (process.platform !== 'win32') assert.equal((await stat(loose)).mode & 0o777, 0o600);
  r = await xc(['usage', '--json']);
  assert.deepEqual(JSON.parse(r.stdout), { live: false, ok: true, bytes: 15, files: 1, cap: FILES.capBytes });
  r = await xc(['put', 'level.json', 'a/../b.json']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no "\." or "\.\." part/);
  // what the store refuses is a refusal here too, in its words, never a result: a file that is not there, a page
  // made public
  r = await xc(['get', 'levels/none.json', '--out', path.join(tmp.dir, 'none.json')]);
  assert.deepEqual([r.status, r.stdout], [1, '']);
  assert.equal(r.stderr, 'xcore: No such file.\n');
  assert.equal(existsSync(path.join(tmp.dir, 'none.json')), false, 'nothing was written for it');
  await writeFile(path.join(dir, 'page.html'), '<script>alert(1)</script>');
  r = await xc(['put', 'page.html', '--public', '--json']);
  assert.equal(r.status, 1);
  assert.deepEqual(
    (({ ok, code }) => ({ ok, code }))(JSON.parse(r.stdout)),
    { ok: false, code: 'type' },
    'refused as the store refuses it',
  );
  assert.equal((await xc(['ls', '--json'])).stdout.includes('page.html'), false, 'and not kept');
  // on this machine a delete goes at once: no code
  r = await xc(['rm', 'levels/forest-3.json']);
  assert.match(r.stdout, /Deleted levels\/forest-3\.json on this machine/);
  r = await xc(['rm', 'levels/forest-3.json']);
  assert.match(r.stdout, /levels\/forest-3\.json was not there on this machine/);
});

/**
 * A signed-in stand-in xgames.fun that keeps game g1's project files as xgames.fun's owner routes do: one copy of each,
 * a put writes over it, a file that is not there answers 404 with code "not-found". → {g, env, dir, kept (path → its
 * file), seen (each call to the files routes), xc (the command, --live)}
 */
async function liveFiles(t, files) {
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
  const dir = await game(tmp, files);
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(
    path.join(dir, '.gamesfun', 'publish.json'),
    JSON.stringify({ [g.origin]: { projectId: 'g1', slug: 'moth' } }),
  );
  const kept = new Map(),
    seen = [];
  const at = '/api/kit/games/g1/files/';
  g.state.handle = (method, url, json, { req, raw, authed }) => {
    if (!url.startsWith('/api/kit/games/g1/files')) return null;
    if (!authed) return [401, { error: 'Sign in first.' }];
    seen.push({
      method,
      url,
      type: req.headers['content-type'],
      pub: req.headers['x-gf-public'],
      // the length Studio's owner route reads; x-gf-length is Studio's own, to the platform
      ...(method === 'PUT' ? { length: req.headers['content-length'], gfLength: req.headers['x-gf-length'] } : {}),
      body: raw.toString(),
    });
    if (url === '/api/kit/games/g1/files-usage')
      return [
        200,
        {
          ok: true,
          bytes: [...kept.values()].reduce((n, f) => n + f.body.length, 0),
          files: kept.size,
          cap: 104857600,
        },
      ];
    if (url.startsWith('/api/kit/games/g1/files?'))
      return [
        200,
        {
          ok: true,
          items: [...kept].map(([p, f]) => ({
            path: p,
            bytes: f.body.length,
            type: f.type,
            public: f.public,
            updatedAt: 1,
          })),
          after: null,
        },
      ];
    const p = decodeURIComponent(url.slice(at.length));
    if (method === 'PUT') {
      kept.set(p, { body: raw, type: req.headers['content-type'], public: req.headers['x-gf-public'] === '1' });
      return [
        200,
        {
          ok: true,
          path: p,
          bytes: raw.length,
          ...(kept.get(p).public ? { url: `https://moth.xgamesusercontent.com/${p}` } : {}),
        },
      ];
    }
    const file = kept.get(p);
    if (method === 'DELETE') return [200, { ok: true, deleted: kept.delete(p) }];
    if (!file) return [404, { error: 'That file is not there.', code: 'not-found' }];
    // as xgames.fun answers a download: always an attachment, the file's own type in x-gf-type, and its length when
    // the platform gave one (a test sets `unsized` on a file for when it did not)
    return [
      200,
      file.body,
      {
        'content-type': 'application/octet-stream',
        'x-gf-type': file.type,
        'x-gf-public': file.public ? '1' : '0',
        ...(file.unsized ? {} : { 'content-length': String(file.body.length) }),
      },
    ];
  };
  const xc = args => runAsync(['files', ...args, '--live'], { env, cwd: dir });
  const sent = method => seen.filter(c => c.method === method).length;
  return { tmp, g, env, dir, kept, seen, sent, xc };
}

test('xcore files --live: refused until xgames.fun lists "files", then through the owner routes', async t => {
  const { tmp, g, dir, kept, seen, xc } = await liveFiles(t, { 'hero.png': 'PNG!' });
  let r = await xc(['usage']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /does not keep project files yet .*"files"/);
  assert.equal(seen.length, 0, 'nothing was asked of the files routes');
  g.state.me = {
    server: { contracts: ['gf-server-v1'], features: ['d1', 'files'] },
    files: { domain: 'xgamesusercontent.com' },
  };
  // a path xgames.fun does not have yet is put at once
  r = await xc(['put', 'hero.png', 'art/hero.png', '--public']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /https:\/\/moth\.xgamesusercontent\.com\/art\/hero\.png/);
  assert.deepEqual(seen.at(-1), {
    method: 'PUT',
    url: '/api/kit/games/g1/files/art/hero.png',
    type: 'image/png',
    pub: '1',
    length: '4',
    gfLength: undefined,
    body: 'PNG!',
  });
  // over Studio's 4,500,000 bytes (its host's limit on a request): refused here, with the way that takes it
  await writeFile(path.join(dir, 'world.bin'), Buffer.alloc(4_600_000));
  const before = seen.length;
  r = await xc(['put', 'world.bin']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /This file is 4\.4 MB\..*at most 4\.3 MB a request\. A bigger one .*env\.GF\.files\.put/s);
  assert.equal(seen.length, before, 'not sent, and nothing asked');
  r = await xc(['ls', 'art']);
  assert.match(r.stdout, /public\s+4 bytes\s+art\/hero\.png/);
  assert.equal(seen.at(-1).url, '/api/kit/games/g1/files?prefix=art%2F');
  // a list is a page at a time: --after asks for the next one, and a page with more says the command for it
  r = await xc(['ls', 'art', '--after', 'art/a.png']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(seen.at(-1).url, '/api/kit/games/g1/files?prefix=art%2F&after=art%2Fa.png');
  const handle = g.state.handle;
  g.state.handle = (method, url, ...rest) => {
    const answer = handle(method, url, ...rest);
    return url.startsWith('/api/kit/games/g1/files?') ? [200, { ...answer[1], after: 'art/hero.png' }] : answer;
  };
  r = await xc(['ls', 'art/']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /… more after art\/hero\.png: .* files list art\/ --after art\/hero\.png --live\n$/);
  g.state.handle = handle;
  assert.equal((await xc(['usage', '--after', 'x'])).status, 2, '--after is for list alone');
  r = await xc(['get', 'art/hero.png', '--out', path.join(tmp.dir, 'h.png')]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Got art\/hero\.png .*image\/png\)/);
  assert.equal(await readFile(path.join(tmp.dir, 'h.png'), 'utf8'), 'PNG!');
  r = await xc(['usage']);
  assert.match(r.stdout, /1 file, 4 bytes of 100 MB/);
  assert.equal(kept.size, 1);
});

test('xcore files rm --live: a file xgames.fun has is deleted only with the code its printout ends with', async t => {
  const { g, kept, sent, xc } = await liveFiles(t);
  g.state.me = { server: { features: ['files'] } };
  for (const p of ['art/hero.png', 'art/old.png'])
    kept.set(p, { body: Buffer.from('PNG!'), type: 'image/png', public: true });
  // without a code: what it deletes, that nothing brings it back, the code and the command; nothing is deleted
  let r = await xc(['rm', 'art/hero.png']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stdout,
    /^This deletes art\/hero\.png \(4 bytes, public, image\/png\) from .*'s project files on xgames\.fun \(game g1\)\.\nIt is gone for good: xgames\.fun keeps one copy of a file and no earlier one\. .*files get art\/hero\.png --live keeps a copy first\.\nNothing was deleted\. To go on, run this again with the code:\n {2}.*files rm art\/hero\.png --live --yes [0-9a-f]{8}\n$/,
  );
  const code = r.stdout.match(/--yes ([0-9a-f]{8})/)[1];
  r = await xc(['rm', 'art/hero.png', '--json']);
  const planned = JSON.parse(r.stdout);
  assert.deepEqual([r.status, planned.ok, planned.planned], [0, true, true]);
  assert.notEqual(planned.code, code, 'each printout its own code');
  assert.deepEqual(planned.plan, {
    action: 'delete',
    origin: g.origin,
    game: 'g1',
    path: 'art/hero.png',
    type: 'image/png',
    public: true,
    bytes: 4,
  });
  assert.match(planned.confirm, new RegExp(`files rm art/hero\\.png --live --yes ${planned.code}$`));
  // a code printed for another file, a made-up one and a bare --yes are all refused
  for (const args of [
    ['rm', 'art/old.png', '--yes', code],
    ['rm', 'art/hero.png', '--yes', '00000000'],
  ]) {
    r = await xc(args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /That code is not for this change/);
  }
  r = await xc(['rm', 'art/hero.png', '--yes']);
  assert.equal(r.status, 2, 'a bare --yes is a usage error');
  assert.deepEqual([sent('DELETE'), kept.size], [0, 2], 'nothing was deleted by any of them');
  // the file changed on xgames.fun since the printout (the game's server wrote it again): the code is no longer its
  kept.get('art/hero.png').body = Buffer.from('PNG!!');
  r = await xc(['rm', 'art/hero.png', '--yes', code]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /That code is not for this change/);
  kept.get('art/hero.png').body = Buffer.from('PNG!');
  // with its code
  r = await xc(['rm', 'art/hero.png', '--yes', code]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'Deleted art/hero.png on xgames.fun.\n');
  assert.deepEqual([sent('DELETE'), [...kept.keys()]], [1, ['art/old.png']]);
  // a file whose size xgames.fun did not say is asked about the same, without it
  kept.get('art/old.png').unsized = true;
  r = await xc(['rm', 'art/old.png', '--json']);
  assert.deepEqual(
    [r.status, JSON.parse(r.stdout).plan],
    [0, { action: 'delete', origin: g.origin, game: 'g1', path: 'art/old.png', type: 'image/png', public: true }],
  );
  r = await xc(['rm', 'art/old.png']);
  assert.match(r.stdout, /^This deletes art\/old\.png \(public, image\/png\) from /);
  // a file that is not there has nothing to lose: said at once, with no code and no delete sent
  r = await xc(['rm', 'art/hero.png']);
  assert.deepEqual([r.status, r.stdout], [0, 'art/hero.png was not there on xgames.fun.\n']);
  r = await xc(['rm', 'art/hero.png', '--json']);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, live: true, deleted: false });
  assert.equal(sent('DELETE'), 1);
});

test('xcore files put --live over a file xgames.fun has: written over only with the code; a new path is put at once', async t => {
  const { g, dir, kept, sent, xc } = await liveFiles(t, { 'forest.json': '{"tiles":[1,2]}' });
  g.state.me = { server: { features: ['files'] } };
  kept.set('levels/forest.json', { body: Buffer.from('{"tiles":[]}'), type: 'application/json', public: true });
  const put = (...more) => xc(['put', 'forest.json', 'levels/forest.json', '--public', ...more]);
  let r = await put();
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stdout,
    /^.*'s project files on xgames\.fun \(game g1\) have levels\/forest\.json already \(12 bytes, public, application\/json\)\. This writes over it:\n {2}file {4}forest\.json \(15 bytes, public, application\/json\)\n {2}sha256 {2}[0-9a-f]{64}\nThe file there now is gone for good: xgames\.fun keeps one copy of a file and no earlier one\. .*files get levels\/forest\.json --live keeps a copy first\.\nNothing was put\. To go on, run this again with the code:\n {2}.*files put forest\.json levels\/forest\.json --public --live --yes [0-9a-f]{8}\n$/,
  );
  const code = r.stdout.match(/--yes ([0-9a-f]{8})/)[1];
  r = await put('--json');
  const planned = JSON.parse(r.stdout);
  assert.notEqual(planned.code, code, 'each printout its own code');
  assert.deepEqual(planned.plan, {
    action: 'replace',
    origin: g.origin,
    game: 'g1',
    path: 'levels/forest.json',
    was: { type: 'application/json', public: true, bytes: 12 },
    file: 'forest.json',
    bytes: 15,
    sha256: planned.plan.sha256,
    type: 'application/json',
    public: true,
  });
  // the code is for this file's bytes, served this way: private instead, or the file edited since, is another change
  r = await xc(['put', 'forest.json', 'levels/forest.json', '--yes', code]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /That code is not for this change/);
  await writeFile(path.join(dir, 'forest.json'), '{"tiles":[9,9]}');
  r = await put('--yes', code);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /That code is not for this change/);
  assert.deepEqual([sent('PUT'), kept.get('levels/forest.json').body.toString()], [0, '{"tiles":[]}'], 'nothing put');
  await writeFile(path.join(dir, 'forest.json'), '{"tiles":[1,2]}');
  r = await put('--yes', code);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Put levels\/forest\.json on xgames\.fun \(15 bytes, public\)/);
  assert.deepEqual([sent('PUT'), kept.get('levels/forest.json').body.toString()], [1, '{"tiles":[1,2]}']);
  // a path xgames.fun does not have loses nothing: put at once, code or none
  r = await xc(['put', 'forest.json', 'levels/forest-2.json']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Put levels\/forest-2\.json on xgames\.fun \(15 bytes, only the game’s server reads it\)/);
  assert.equal(sent('PUT'), 2);
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
        // a stream is held to its length; one without a length is read up to 1 MB
        if (u.pathname === '/api/sized') {
          const n = Number(u.searchParams.get('n')), length = u.searchParams.has('length') ? Number(u.searchParams.get('length')) : undefined;
          return Response.json(await env.GF.files.put('s.bin', new Blob([new Uint8Array(n)]).stream(), { length }));
        }
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
    const sized = async q => (await fetch(`${dev.url}api/sized?${q}`)).json();
    assert.deepEqual(await sized('n=5&length=5'), { ok: true, path: 's.bin', bytes: 5 });
    assert.match((await sized('n=5&length=6')).why, /fewer bytes than its length \(6\)/);
    assert.match((await sized('n=7&length=6')).why, /more bytes than its length \(6\)/);
    assert.equal((await sized('n=2000000&length=2000000')).ok, true);
    assert.match((await sized('n=2000000')).why, /needs its length: put\(path, stream, \{length\}\)/);
    const page = await fetch(dev.url);
    assert.match(
      page.headers.get('content-security-policy'),
      new RegExp(`img-src [^;]*${dev.files.replace(/[.:/]/g, '\\$&')}`),
    );
  },
);

test('files put says the size a live put takes from this machine, not only the 25 MB the game’s server can write', async () => {
  const files = (await import('../commands/files.mjs')).default;
  const help = files.usage.replace(/\s+/g, ' ');
  assert.match(
    help,
    new RegExp(
      `with --live up to ${sizeText(STUDIO_BODY_BYTES).replace('.', '\\.')} \\(it goes through xgames\\.fun's Studio`,
    ),
  );
  assert.match(
    help,
    /A bigger file, up to 25 MB, can only be written by the game's own server \(env\.GF\.files\.put\)/,
  );
});
