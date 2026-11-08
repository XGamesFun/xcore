// `xcore embed` and `xcore domain` (lib/publish/site.mjs, commands/embed.mjs, commands/domain.mjs): the names checked
// here first, then the commands as a person runs them against a stand-in games.fun: the routes and bodies it takes, the
// DNS records as a table, a plan's refusal and an older games.fun said plainly, and the warning for an old gamesfun.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { saveSecret } from '../lib/credentials.mjs';
import { credentialKey } from '../lib/publish/client.mjs';
import { domainName, embedOrigin, embedSnippet, recordsTable } from '../lib/publish/site.mjs';
import { BIN, ROOT, tempDir } from './helpers.mjs';

/** The command, run as a person runs it (async: the stand-in games.fun answers from this same process). */
const run = (args, { env = {} } = {}) =>
  new Promise(resolve => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: ROOT,
      env: { ...process.env, GAMESFUN_KIT: '', GAMESFUN_NO_UPDATE_CHECK: '1', ...env },
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', c => (stdout += c));
    child.stderr.on('data', c => (stderr += c));
    child.on('close', status => resolve({ status, stdout, stderr }));
  });

test('embed sites and domains: what games.fun would take, checked before any call', () => {
  assert.deepEqual(embedOrigin('mygame.com'), { origin: 'https://mygame.com' });
  assert.deepEqual(embedOrigin('https://MyGame.com/'), { origin: 'https://mygame.com' });
  assert.deepEqual(embedOrigin('http://localhost:5173'), { origin: 'http://localhost:5173' });
  for (const bad of ['', 'http://mygame.com', 'https://mygame.com/games', 'https://*.mygame.com', 'ftp://x.com'])
    assert.ok(embedOrigin(bad).problem, bad);
  assert.deepEqual(domainName('https://Play.MyGame.com/'), { hostname: 'play.mygame.com' });
  assert.deepEqual(domainName('mygame.com'), { hostname: 'mygame.com' });
  for (const bad of [
    '',
    'localhost',
    '10.0.0.1',
    'play.mygame.com:8080',
    'nodot',
    'x-play.xgames.fun',
    'xgames.fun',
    'a_b.com',
  ])
    assert.ok(domainName(bad).problem, bad);
  assert.equal(
    embedSnippet('https://moth-play.xgames.fun/'),
    '<iframe src="https://moth-play.xgames.fun/" allow="fullscreen; autoplay; gamepad" style="width:100%;aspect-ratio:16/9;border:0"></iframe>',
  );
  const apex = recordsTable({
    hostname: 'mygame.com',
    records: [{ type: 'CNAME', name: 'mygame.com', value: 'domains.xgames.fun', why: 'w' }],
  });
  assert.match(apex, /bare domain: a CNAME there needs your DNS provider's CNAME flattening or ALIAS/);
});

/** games.fun in miniature: the site routes for game g-9 (slug moth), the plan as `state.tier`. */
function standIn(state) {
  const site = () => ({
    ok: true,
    game: 'g-9',
    slug: 'moth',
    tier: state.tier,
    limits: { free: { embed: 3, domains: 0 }, creator: { embed: 10, domains: 1 } }[state.tier],
    embed: state.embed,
    domains: state.domains,
    domainsOn: state.domainsOn,
    ...(state.domainsOn ? {} : { why: 'Custom domains are not set up on this XGames.fun yet.' }),
  });
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : null;
    const url = new URL(req.url, 'http://x');
    state.calls.push({
      method: req.method,
      path: url.pathname + url.search,
      auth: req.headers.authorization,
      body: json,
    });
    const send = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(value === undefined ? '' : JSON.stringify(value));
    };
    if (state.older) return send(404);
    if (!url.pathname.startsWith('/api/kit/games/g-9/site')) return send(404, { error: 'no such game' });
    if (url.pathname.endsWith('/site') && req.method === 'GET') return send(200, site());
    if (url.pathname.endsWith('/site') && req.method === 'PUT') {
      state.embed = json.embed;
      return send(200, site());
    }
    if (url.pathname.endsWith('/site/domains') && req.method === 'POST') {
      if (state.tier === 'free') return send(403, { error: 'Free has no custom domains.', code: 'plan' });
      if (json.check) {
        state.domains = state.domains.map(d =>
          d.hostname === json.hostname ? { ...d, status: 'active', records: [] } : d,
        );
        return send(200, site());
      }
      state.domains.push({
        hostname: json.hostname,
        status: 'pending',
        url: `https://${json.hostname}/`,
        records: [
          { type: 'CNAME', name: json.hostname, value: 'domains.xgames.fun', why: 'points the domain at games.fun' },
          {
            type: 'TXT',
            name: `_cf-custom-hostname.${json.hostname}`,
            value: '0f1e2d3c-uuid',
            why: 'proves you own it',
          },
        ],
      });
      return send(200, site());
    }
    if (url.pathname.endsWith('/site/domains') && req.method === 'DELETE') {
      state.domains = state.domains.filter(d => d.hostname !== url.searchParams.get('hostname'));
      return send(200, site());
    }
    return send(404, { error: 'not here' });
  });
  return new Promise(r =>
    server.listen(0, '127.0.0.1', () => r({ port: server.address().port, close: () => server.close() })),
  );
}

test('xcore embed and xcore domain, as a person runs them', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const state = { tier: 'free', embed: [], domains: [], domainsOn: true, calls: [], older: false };
  const s = await standIn(state);
  t.after(s.close);
  const ORIGIN = `http://127.0.0.1:${s.port}`;
  const env = {
    GAMESFUN_STUDIO: ORIGIN,
    GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'),
    GAMESFUN_CREDENTIALS: 'file',
    GAMESFUN_SECRET_STORE: 'file',
  };
  await saveSecret(credentialKey(ORIGIN), 'gfk_test_token', { studio: ORIGIN, email: 'a@example.com' }, { env });
  const dir = path.join(tmp.dir, 'game');
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><script src="./gamesfun.js"></script><p>moth</p>');
  // an older xcore's copy of the client: on its own domain it could not tell which game it is
  await writeFile(
    path.join(dir, 'gamesfun.js'),
    readFileSync(path.join(ROOT, 'lib', 'client', 'gamesfun.js'), 'utf8').replace("'1.3.0'", "'1.1.0'"),
  );
  await writeFile(
    path.join(dir, '.gamesfun', 'publish.json'),
    JSON.stringify({ [ORIGIN]: { projectId: 'g-9', slug: 'moth' } }),
  );
  const xc = args => run(args, { env });

  let r = await xc(['embed', 'add', 'mygame.com', dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(state.calls.at(-1), {
    method: 'PUT',
    path: '/api/kit/games/g-9/site',
    auth: 'Bearer gfk_test_token',
    body: { embed: ['https://mygame.com'] },
  });
  assert.match(r.stdout, /https:\/\/mygame\.com may now show the game/);
  assert.match(r.stdout, /<iframe src="http:\/\/moth-play\.127\.0\.0\.1:\d+\/" allow="fullscreen; autoplay; gamepad"/);
  r = await xc(['embed', 'add', 'https://mygame.com/', dir]);
  assert.match(r.stdout, /was already allowed/);
  assert.equal(state.calls.at(-1).method, 'GET', 'nothing to change: no PUT');
  r = await xc(['embed', 'add', 'https://mygame.com/play', dir]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /origin only/);

  r = await xc(['domain', 'add', 'play.mygame.com', dir]);
  assert.equal(r.status, 1);
  assert.match(
    r.stderr,
    /Free has no custom domains\. Custom domains come with Creator \(1\) and Scale \(5\): put the game in a slot with .* plan activate/,
  );
  const before = state.calls.length;
  r = await xc(['domain', 'add', 'moth-play.xgames.fun', dir]);
  assert.match(r.stderr, /games.fun's own/);
  assert.equal(state.calls.length, before, 'refused here: nothing sent');

  state.tier = 'creator';
  r = await xc(['domain', 'add', 'https://Play.MyGame.com', dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(state.calls.at(-1).body, { hostname: 'play.mygame.com' });
  const out = r.stdout.split('\n');
  assert.match(out[0], /^play\.mygame\.com: waiting for its DNS records$/);
  assert.ok(
    out.some(l => /^\s+Type\s+Name\s+Value\s+What it is for$/.test(l)),
    r.stdout,
  );
  assert.ok(
    out.some(l => /^\s+CNAME\s+play\.mygame\.com\s+domains\.xgames\.fun\s+points the domain at games\.fun$/.test(l)),
    r.stdout,
  );
  assert.ok(
    out.some(l => /^\s+TXT\s+_cf-custom-hostname\.play\.mygame\.com\s+0f1e2d3c-uuid\s+proves you own it$/.test(l)),
    r.stdout,
  );
  assert.match(r.stdout, /Then: .* domain check play\.mygame\.com/);
  assert.match(r.stdout, /gamesfun\.js is older than this xcore's: .* add signin .* publish/);

  r = await xc(['domain', 'check', 'play.mygame.com', dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(state.calls.at(-1).body, { hostname: 'play.mygame.com', check: true });
  assert.match(r.stdout, /^play\.mygame\.com: live at https:\/\/play\.mygame\.com\/$/m);
  assert.doesNotMatch(r.stdout, /Then:/);

  r = await xc(['embed', dir]);
  assert.match(r.stdout, /^Plays at https:\/\/play\.mygame\.com\/$/m, 'its live domain first');
  assert.match(r.stdout, /Embedded on: https:\/\/mygame\.com \(1 of 10 on Creator\)/);
  r = await xc(['embed', 'add', 'shop.mygame.com', dir]);
  assert.match(r.stdout, /<iframe src="https:\/\/play\.mygame\.com\/"/);
  r = await xc(['domain', 'list', dir, '--json']);
  assert.equal(JSON.parse(r.stdout).domains[0].status, 'active');

  r = await xc(['domain', 'remove', 'play.mygame.com', dir]);
  assert.equal(state.calls.at(-1).path, '/api/kit/games/g-9/site/domains?hostname=play.mygame.com');
  assert.equal(state.calls.at(-1).method, 'DELETE');
  assert.match(r.stdout, /no longer serves the game/);
  r = await xc(['embed', 'remove', 'mygame.com', dir]);
  assert.match(r.stdout, /https:\/\/mygame\.com may no longer show the game/);
  assert.deepEqual(state.embed, ['https://shop.mygame.com']);

  state.domainsOn = false;
  r = await xc(['domain', dir]);
  assert.match(r.stdout, /Custom domains: Custom domains are not set up on this XGames.fun yet\./);

  state.older = true;
  for (const args of [
    ['domain', dir],
    ['embed', 'add', 'x.com', dir],
  ]) {
    r = await xc(args);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /this games\.fun does not offer embedding and custom domains yet/);
  }
  r = await run(['domain', 'add'], { env });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /add needs a domain/);
});
