// Talking to xgames.fun from the kit: signing in, and the publish calls (xgames.fun's kit routes).
//
// Sign in (`xcore login`) never sees a password: the person's own browser signs in to xgames.fun and approves this
// computer; the kit receives a one-time code on a loopback address only it listens on (127.0.0.1, a free port, for
// five minutes) and trades it, with a secret it never sent anywhere (PKCE), for a publish token. `--code` is the same
// without the loopback: the page shows the code and the person pastes it here. The token is kept by lib/credentials.mjs
// (the OS keychain, else a file only they can read), never in a game folder or in this checkout.
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import os from 'node:os';
import { deleteSecret, listEntries, loadSecret, saveSecret } from '../credentials.mjs';
import { CMD } from '../command.mjs';

/** xgames.fun's Studio. GAMESFUN_STUDIO points the kit at another one (a local Studio while developing). */
export const DEFAULT_STUDIO = 'https://xgames.fun'; // canonical Studio origin; old aliases remain available for existing clients
export function studioOrigin(env = process.env) {
  const raw = String(env.GAMESFUN_STUDIO ?? '').trim() || DEFAULT_STUDIO;
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`GAMESFUN_STUDIO is not an address: ${raw}`);
  }
  const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(u.hostname);
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && local)) || u.username || u.password)
    throw new Error(`GAMESFUN_STUDIO must be an https address (or http on this machine): ${raw}`);
  return u.origin;
}
// The key the sign-in is kept under. It is an identifier, not the platform's name: 0.1.0 and the kit save under "games.fun <origin>",
// so it stays that, or everyone would be signed out by an upgrade and their old token could not be revoked.
export const credentialKey = origin => `games.fun ${origin}`;
/**
 * xgames.fun's own origins for a Studio origin, as its publish route counts them (playOrigin and studioOriginFor): the
 * Studio and its play host, play.<studio host> (play.localhost:<port> for a Studio on this machine). A backend.json
 * that lists one of them is refused there; the game reaches its own host without listing it.
 */
export function ownOrigins(origin = studioOrigin()) {
  const u = new URL(origin);
  const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(u.hostname);
  return [u.origin, local ? `http://play.localhost${u.port ? `:${u.port}` : ''}` : `${u.protocol}//play.${u.host}`];
}

const b64url = buf => Buffer.from(buf).toString('base64url');
export const challengeFor = verifier => b64url(createHash('sha256').update(verifier).digest());
export const deviceLabel = () =>
  `${os.hostname().slice(0, 40) || 'a computer'} (${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'})`;

const PAGE = (title, text) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
  `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0e;color:#e6e6ea;font:16px/1.5 system-ui,sans-serif"><main style="max-width:30rem;padding:24px"><h1 style="font-size:1.4rem">${title}</h1><p>${text}</p></main></body>`;

/**
 * Sign in: → { email, expiresAt, store, device }. `open(url)` shows the page to the person (their browser);
 * `code: true` uses no loopback and asks `prompt()` for the code the page shows.
 */
export async function login({
  origin = studioOrigin(),
  open,
  code: byCode = false,
  prompt,
  timeoutMs = 5 * 60 * 1000,
  device = deviceLabel(),
  log = () => {},
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  // A xgames.fun without the kit's routes (not deployed yet) answers 404 here: say so now, not after a 5-minute wait.
  await call(origin, '/api/kit/me', { fetchImpl }).catch(e => {
    if (e.status !== 401) throw e;
  });
  const verifier = b64url(randomBytes(32)),
    state = b64url(randomBytes(16));
  const params = new URLSearchParams({ challenge: challengeFor(verifier), device, state });
  let code;
  if (byCode) {
    const url = `${origin}/kit/connect?${params}`;
    log(`Open this page, sign in to xgames.fun and approve this computer:\n  ${url}`);
    await open?.(url);
    code = String(await prompt('Paste the code the page shows: ')).trim();
  } else {
    code = await new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }
        const done = (status, title, text, result) => {
          res
            .writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            .end(PAGE(title, text));
          clearTimeout(timer);
          server.close();
          result();
        };
        if (u.searchParams.get('state') !== state) {
          res.writeHead(400, { 'content-type': 'text/plain' }).end('This sign-in was not started here.');
          return;
        }
        if (u.searchParams.get('error'))
          return done(
            200,
            'Not connected',
            'You cancelled, so this computer is not signed in. You can close this tab.',
            () => reject(new Error('Sign-in was cancelled in the browser.')),
          );
        const c = u.searchParams.get('code');
        if (!c) {
          res.writeHead(400).end();
          return;
        }
        done(200, 'The kit is signed in', 'You can close this tab and go back to your terminal.', () => resolve(c));
      });
      const timer = setTimeout(() => {
        server.close();
        reject(new Error('Sign-in timed out (5 minutes). Run `xcore login` again.'));
      }, timeoutMs);
      server.on('error', reject);
      server.listen(0, '127.0.0.1', async () => {
        params.set('port', String(server.address().port));
        const url = `${origin}/kit/connect?${params}`;
        log(`Opening xgames.fun in your browser to sign in. If it does not open, visit:\n  ${url}`);
        try {
          await open?.(url);
        } catch {}
      });
    });
  }
  const r = await call(origin, '/api/kit/token', { method: 'POST', body: { code, verifier }, fetchImpl });
  const saved = await saveSecret(
    credentialKey(origin),
    r.token,
    {
      studio: origin,
      email: r.email,
      device: r.device,
      tokenId: r.tokenId,
      expiresAt: new Date(r.expiresAt).toISOString(),
    },
    { env },
  );
  return { email: r.email, expiresAt: r.expiresAt, store: saved.store, device: r.device };
}

/** The saved sign-in for `origin`: { token, email, expiresAt, store } or null. */
export async function savedLogin(origin = studioOrigin(), { env = process.env } = {}) {
  const s = await loadSecret(credentialKey(origin), { env });
  return s ? { token: s.secret, email: s.meta.email, expiresAt: s.meta.expiresAt, store: s.store } : null;
}

/** The words for where a token is kept (`store` as saveSecret names it). */
export const storeWords = store =>
  store === 'file'
    ? 'a file only you can read'
    : store === 'dpapi'
      ? 'a file encrypted for your Windows user'
      : store === 'keychain'
        ? 'the macOS keychain'
        : store === 'secret-service'
          ? 'the Secret Service'
          : (store ?? 'the secret store');

/**
 * Where this computer's sign-in to `origin` stands, in one word, with what to run next:
 *   signed-out --login--> signed-in --(30 days)--> expired --login--> signed-in;   signed-in --logout--> signed-out
 *   unreadable: the record says a token is kept in a store this session cannot read (the Secret Service over SSH,
 *   a locked keyring); signing in again here fixes it.
 * → { state, studio, email?, expiresAt?, store?, token? (signed-in only), words, next }
 */
export async function signInState(origin = studioOrigin(), { env = process.env, now = Date.now() } = {}) {
  const entry = (await listEntries({ env }))[credentialKey(origin)];
  if (!entry)
    return { state: 'signed-out', studio: origin, words: `Not signed in to ${origin}.`, next: `${CMD} login` };
  const facts = { studio: origin, email: entry.email ?? null, expiresAt: entry.expiresAt ?? null, store: entry.store };
  const s = await savedLogin(origin, { env });
  if (!s)
    return {
      state: 'unreadable',
      ...facts,
      words: `Signed in to ${origin} as ${facts.email}, but its token is kept in ${storeWords(entry.store)}, which this session cannot read (over SSH the Secret Service is not reachable). Sign in again here, or use the session that signed in.`,
      next: `${CMD} login`,
    };
  if (s.expiresAt && Date.parse(s.expiresAt) <= now)
    return {
      state: 'expired',
      ...facts,
      words: `The sign-in to ${origin} as ${facts.email} ended on ${s.expiresAt.slice(0, 10)}. Sign in again.`,
      next: `${CMD} login`,
    };
  return {
    state: 'signed-in',
    ...facts,
    token: s.token,
    words: `Signed in to ${origin} as ${facts.email} until ${facts.expiresAt} (token in ${storeWords(entry.store)}).`,
    next: `${CMD} publish`,
  };
}

/**
 * Log out: revoke the token at xgames.fun (when it answers) and forget it here. → { revoked, forgot, why? }
 * `why`, when something was forgotten but not revoked: 'unreadable' (this session cannot read the token, so it was
 * never sent), 'ended' (xgames.fun says it had already expired or been revoked), 'offline' (xgames.fun did not answer)
 * or 'refused' (xgames.fun answered with an error).
 */
export async function logout(origin = studioOrigin(), { env = process.env, fetchImpl = fetch } = {}) {
  const s = await savedLogin(origin, { env });
  let revoked = false,
    why = 'unreadable';
  if (s) {
    try {
      await call(origin, '/api/kit/token', { method: 'DELETE', token: s.token, fetchImpl });
      revoked = true;
    } catch (e) {
      why = e.status === 401 || e.status === 403 ? 'ended' : e.status === 0 || e.status >= 500 ? 'offline' : 'refused';
    }
  }
  const forgot = await deleteSecret(credentialKey(origin), { env });
  return forgot && !revoked ? { revoked, forgot, why } : { revoked, forgot };
}

/** One JSON call to xgames.fun (`headers`: more, such as the GitHub OIDC credential's). Throws an Error with xgames.fun's own words (and .status). */
export async function call(origin, route, { method = 'GET', body, token, headers = {}, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(origin + route, {
      method,
      headers: {
        ...headers,
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw Object.assign(new Error(`Could not reach xgames.fun at ${origin} (${e.cause?.code ?? e.message}).`), {
      status: 0,
    });
  }
  const text = await res.text();
  let value = null;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const words =
      value?.error ??
      (res.status === 404
        ? `xgames.fun at ${origin} does not offer publishing from the command line yet.`
        : `xgames.fun answered ${res.status}.`);
    // `code`: xgames.fun's word for why ('plan', 'taken'…); `answered`: false when the route itself is not there (a
    // xgames.fun older than the command)
    throw Object.assign(new Error(words), {
      status: res.status,
      answered: value != null,
      ...(value?.code ? { code: value.code } : {}),
    });
  }
  return value;
}
