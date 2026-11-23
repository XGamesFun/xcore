// Shared by the tests: temporary folders, the fixtures (web games made without xgames.fun), the command, and a stand-in
// xgames.fun that signs in and takes a publish in memory.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
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

// A workflow with `id-token: write` (release.yml) has GitHub's OIDC variables, and xcore signs in with them instead of
// being signed out: the tests would publish as that workflow. Every test runs as on a person's machine; a test of the
// OIDC sign-in passes them itself.
delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

// Every folder tempDir made, removed once more as the test file's process ends. A test's own cleanup can run before
// what still writes there has stopped (node:test runs a test's after hooks in the order they were registered, and a dev
// host or a store closed after it writes its file one last time), which puts the folder back.
const made = new Set();
process.on('exit', () => {
  for (const dir of made)
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* still held open (Windows): left to the system's own temp cleaning */
    }
});

export async function tempDir(prefix = 'gamesfun-test-') {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  made.add(dir);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) };
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

/** The command, run as a person runs it, without blocking: a stand-in xgames.fun in this process can answer it. */
export const runAsync = (args, { cwd = ROOT, env = {} } = {}) =>
  new Promise(resolve => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, GAMESFUN_KIT: '', ...env } });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', c => (stdout += c));
    child.stderr.on('data', c => (stderr += c));
    child.stdin.end();
    child.on('close', status => resolve({ status, stdout, stderr }));
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

/**
 * A stand-in xgames.fun: the token exchange and logout, and the publish calls, in memory. A test may set
 * state.reach (the token exchange's {scope, games}: what the approval page gave the sign-in), state.me (more of GET
 * /api/kit/me's answer: server, features, its own limits), state.refuse ({at: 'begin' | 'complete', status,
 * body}: that publish step answers it), and state.handle(method, url, json, {req, raw, authed}) → [status, body] | [status, body,
 * headers] | null for routes of its own (the database's and the files' owner routes). state.published is the last
 * publish's body; state.uploads maps each uploaded blob's sha256 to its bytes.
 * A file's bytes go up inside the call, as xgames.fun takes a small one. With state.direct = true they go as it takes
 * a big one: the call answers an address in its storage with the method and headers to use, the bytes are PUT there
 * (state.putStatus: that PUT answers it instead), and a second call names the upload by its key. state.staged maps
 * each key to what was put.
 */
export async function standIn() {
  const state = {
    codes: new Map(),
    tokens: new Set(),
    blobs: new Set(),
    calls: [],
    version: 0,
    uploads: new Map(),
    signed: new Map(),
    staged: new Map(),
  };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks),
      body = raw.toString('utf8');
    let json = null;
    try {
      json = body ? JSON.parse(body) : null;
    } catch {
      /* a raw upload (a file's bytes): json stays null */
    }
    const send = (s, v, headers = {}) => {
      res.writeHead(s, { 'content-type': 'application/json', ...headers });
      res.end(Buffer.isBuffer(v) ? v : JSON.stringify(v));
    };
    const auth = (req.headers.authorization ?? '').slice(7);
    state.calls.push(`${req.method} ${req.url}`);
    // a test's own routes, told whether the call carried a signed-in token
    const own = state.handle?.(req.method, req.url, json, { req, raw, authed: state.tokens.has(auth) });
    if (own) return send(...own);
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
        ...(state.reach ?? {}),
      });
    }
    // an address in storage: it carries no sign-in, only the headers it was handed out with
    const address = /^\/storage\/([0-9a-f-]{36})$/.exec(req.url);
    if (address && req.method === 'PUT') {
      const signed = state.signed.get(address[1]);
      if (!signed || Object.entries(signed).some(([name, value]) => req.headers[name] !== value))
        return send(403, { error: 'SignatureDoesNotMatch' });
      if (state.putStatus) return send(state.putStatus, { error: 'storage' });
      state.staged.set(address[1], raw);
      return send(200, {});
    }
    if (!state.tokens.has(auth)) return send(401, { error: 'Sign in first.' });
    if (req.url === '/api/kit/token' && req.method === 'DELETE') {
      state.tokens.delete(auth);
      return send(200, { revoked: true });
    }
    if (req.url === '/api/kit/me')
      return send(200, {
        email: 'alice@example.com',
        limits: { files: 3000, totalBytes: 1e8, fileBytes: 100 * 1048576 },
        ...(state.me ?? {}),
      });
    if (req.url === '/api/kit/publish' && state.refuse?.at === 'begin')
      return send(state.refuse.status, state.refuse.body);
    if (req.url === '/api/kit/publish') {
      state.published = json;
      state.beganWith = json.projectId ?? null;
      state.tree = json.tree;
      state.verify = json.verify;
      state.askedDraft = json.draft === true;
      return send(200, {
        id: 'p1',
        projectId: 'g1',
        missing: [
          ...new Set([
            ...json.tree.files.map(f => f.sha256),
            ...(json.server?.modules ?? []).map(m => m.sha256),
            ...(json.server?.database?.migrations ?? []).map(m => m.sha256),
          ]),
        ].filter(s => !state.blobs.has(s)),
        newBytes: 100,
        draft: false,
      });
    }
    const m = /^\/api\/kit\/publish\/p1\/blobs\/([0-9a-f]{64})$/.exec(req.url);
    if (m) {
      // a file the account holds already (another publish stored it meanwhile) is not asked for
      if (state.blobs.has(m[1])) return send(200, { present: true });
      const keep = bytes => {
        if (bytes.length !== json.bytes || sha256(bytes) !== m[1]) return send(400, { error: 'bad' });
        state.blobs.add(m[1]);
        state.uploads.set(m[1], bytes);
        return send(200, { stored: true });
      };
      if (json.upload != null)
        return state.staged.has(json.upload) ? keep(state.staged.get(json.upload)) : send(400, { error: 'bad' });
      if (json.content != null) return keep(Buffer.from(json.content, 'base64'));
      if (!state.direct) return send(200, { upload: null });
      const key = randomUUID(),
        headers = { 'content-type': 'application/octet-stream', 'x-upload-signature': randomUUID() };
      state.signed.set(key, headers);
      return send(200, {
        upload: { key, url: `http://127.0.0.1:${server.address().port}/storage/${key}`, method: 'PUT', headers },
      });
    }
    // a test may make the last step time out, as xgames.fun's gateway does past the route's limit
    if (req.url === '/api/kit/publish/p1' && state.refuse?.at === 'complete')
      return send(state.refuse.status, state.refuse.body);
    if (req.url === '/api/kit/publish/p1' && state.completeStatus)
      return send(state.completeStatus, { error: 'gateway timeout' });
    if (req.url === '/api/kit/publish/p1')
      return send(200, {
        projectId: 'g1',
        version: { id: 'v', number: ++state.version },
        draft: state.askedDraft || !state.verify.pass,
        published:
          state.verify.pass && !state.askedDraft
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
  return {
    state,
    origin: `http://127.0.0.1:${server.address().port}`,
    // whatever is still open goes with it: a publish that failed part-way can have calls in flight
    close: () =>
      new Promise(r => {
        server.closeAllConnections();
        server.close(r);
      }),
  };
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
