// Shared by the tests: temporary folders, the fixtures (web games made without games.fun), the command, and a stand-in
// games.fun that signs in and takes a publish in memory.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { challengeFor } from '../lib/publish/client.mjs';
import { sha256 } from '../lib/publish/tree.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'byo');
export const BIN = path.join(ROOT, 'bin', 'xcore.mjs');

export async function tempDir(prefix = 'gamesfun-test-') {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** A fixture copied into `tmp` (a project's packages counted as installed: node_modules/ is there). → its folder */
export async function fixture(tmp, name) {
  const dir = path.join(tmp.dir, name);
  await cp(path.join(FIXTURES, name), dir, { recursive: true });
  if (existsSync(path.join(dir, 'package.json'))) await mkdir(path.join(dir, 'node_modules'), { recursive: true });
  return dir;
}

/** Run the command. env: more of it; no kit is found unless GAMESFUN_KIT names one. → {status, stdout, stderr} */
export const run = (args, { cwd = ROOT, env = {} } = {}) =>
  spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 300_000,
    env: { ...process.env, GAMESFUN_KIT: '', ...env },
  });

/** A check that passes without Chrome (publish's own runs the page check: tests/check.test.mjs). */
export const passing = async () => ({
  pass: true,
  quick: true,
  passed: 4,
  ran: 4,
  failed: [],
  started: new Date().toISOString(),
  run: 'verify-1',
});

/** A stand-in games.fun: the token exchange and logout, and the publish calls, in memory. */
export async function standIn() {
  const state = { codes: new Map(), tokens: new Set(), blobs: new Set(), calls: [], version: 0 };
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : null,
      send = (s, v) => {
        res.writeHead(s, { 'content-type': 'application/json' });
        res.end(JSON.stringify(v));
      };
    const auth = (req.headers.authorization ?? '').slice(7);
    state.calls.push(`${req.method} ${req.url}`);
    if (req.url === '/api/kit/token' && req.method === 'POST') {
      const want = state.codes.get(json.code);
      if (!want || want !== challengeFor(json.verifier)) return send(400, { error: 'That sign-in code is not valid.' });
      state.tokens.add('gfk_' + 'a'.repeat(43));
      return send(200, {
        token: 'gfk_' + 'a'.repeat(43),
        tokenId: 't1',
        email: 'alice@example.com',
        device: 'test',
        expiresAt: Date.now() + 1e9,
      });
    }
    if (!state.tokens.has(auth)) return send(401, { error: 'Sign in first: npx gamesfun login' });
    if (req.url === '/api/kit/token' && req.method === 'DELETE') {
      state.tokens.delete(auth);
      return send(200, { revoked: true });
    }
    if (req.url === '/api/kit/me')
      return send(200, {
        email: 'alice@example.com',
        limits: { files: 3000, totalBytes: 1e8, fileBytes: 100 * 1048576 },
      });
    if (req.url === '/api/kit/publish') {
      state.beganWith = json.projectId ?? null;
      state.tree = json.tree;
      state.verify = json.verify;
      return send(200, {
        id: 'p1',
        projectId: 'g1',
        missing: json.tree.files.map(f => f.sha256).filter(s => !state.blobs.has(s)),
        newBytes: 100,
        draft: false,
      });
    }
    const m = /^\/api\/kit\/publish\/p1\/blobs\/([0-9a-f]{64})$/.exec(req.url);
    if (m) {
      if (json.content == null) return send(200, { upload: null });
      if (sha256(Buffer.from(json.content, 'base64')) !== m[1]) return send(400, { error: 'bad' });
      state.blobs.add(m[1]);
      return send(200, { stored: true });
    }
    // a test may make the last step time out, as games.fun's gateway does past the route's limit
    if (req.url === '/api/kit/publish/p1' && state.completeStatus)
      return send(state.completeStatus, { error: 'gateway timeout' });
    if (req.url === '/api/kit/publish/p1')
      return send(200, {
        projectId: 'g1',
        version: { id: 'v', number: ++state.version },
        draft: !state.verify.pass,
        published: state.verify.pass
          ? {
              published: true,
              slug: 'dot-catch',
              url: 'http://x/play/dot-catch',
              gameUrl: 'http://x/g',
              friendsUrl: null,
            }
          : null,
        studioUrl: 'http://x/studio/g1',
      });
    send(404, { error: 'no' });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { state, origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) };
}

/** Sign in against a stand-in: the "browser" approves at once, as the person would. */
export async function signIn(g, env) {
  const { login } = await import('../lib/publish/client.mjs');
  return login({
    origin: g.origin,
    env,
    open: async url => {
      const u = new URL(url),
        code = 'c'.repeat(43);
      g.state.codes.set(code, u.searchParams.get('challenge'));
      await fetch(
        `http://127.0.0.1:${u.searchParams.get('port')}/callback?code=${code}&state=${u.searchParams.get('state')}`,
      );
    },
  });
}
