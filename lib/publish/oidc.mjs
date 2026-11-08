// Publishing from GitHub Actions without a key: the job's own OIDC token in place of `xcore login`.
//
// A workflow with `permissions: id-token: write` gets two variables from GitHub: ACTIONS_ID_TOKEN_REQUEST_URL and
// ACTIONS_ID_TOKEN_REQUEST_TOKEN. With them the kit asks GitHub for a short-lived JWT (issuer
// token.actions.githubusercontent.com, audience https://xgames.fun, the repository and ref as claims) and sends it to
// games.fun's kit publish routes as `Authorization: Bearer <JWT>` with `x-gamesfun-credential: github-oidc`. games.fun
// checks the issuer, the audience and the repository + branch against the link its owner made once in Studio ("this
// repo and branch publish this game"), so nothing secret is stored in the repository or in GitHub.
//
// Used only when no `xcore login` is saved for that games.fun: a person's own sign-in always wins on their machine.
// The token lasts a few minutes, so it is asked for again before each call once it is four minutes old (a publish
// with verify runs longer than one token lives). GAMESFUN_OIDC_AUDIENCE changes the audience (a games.fun of your own).
import { savedLogin } from './client.mjs';

export const OIDC_AUDIENCE = 'https://xgames.fun';
export const OIDC_HEADER = 'x-gamesfun-credential';
export const OIDC_KIND = 'github-oidc';
const REFRESH_MS = 4 * 60 * 1000;

/** Is this a GitHub Actions job that may ask for an OIDC token (permissions: id-token: write)? */
export const oidcAvailable = (env = process.env) =>
  Boolean(env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);

/** One OIDC token from GitHub for `audience`. → the JWT. Throws with words when GitHub refuses. */
export async function githubOidcToken({
  env = process.env,
  audience = env.GAMESFUN_OIDC_AUDIENCE || OIDC_AUDIENCE,
  fetchImpl = fetch,
} = {}) {
  if (!oidcAvailable(env))
    throw new Error(
      'No GitHub OIDC token here: the workflow needs `permissions: id-token: write` (ACTIONS_ID_TOKEN_REQUEST_URL is not set).',
    );
  let url;
  try {
    url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  } catch {
    throw new Error('ACTIONS_ID_TOKEN_REQUEST_URL is not an address.');
  }
  url.searchParams.set('audience', audience);
  let res;
  try {
    res = await fetchImpl(url.href, {
      headers: {
        authorization: `bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`,
        accept: 'application/json; api-version=2.0',
      },
    });
  } catch (e) {
    throw new Error(`Could not reach GitHub for an OIDC token (${e.cause?.code ?? e.message}).`, { cause: e });
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || typeof body?.value !== 'string' || body.value.split('.').length !== 3)
    throw new Error(
      `GitHub did not give an OIDC token (${res.status}). Check the workflow's permissions: id-token: write.`,
    );
  return body.value;
}

/** The claims of a JWT, read without checking it (only to say which repository is publishing). */
export function claimsOf(jwt) {
  try {
    return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

/**
 * How this run signs its publish calls. → null (no way: not signed in, not in a GitHub job), or
 * { kind: 'login' | 'github-oidc', label, email, auth(): Promise<{ token, headers }> }.
 */
export async function publishCredential(origin, { env = process.env, fetchImpl = fetch } = {}) {
  const login = await savedLogin(origin, { env });
  if (login)
    return {
      kind: 'login',
      label: login.email,
      email: login.email,
      expiresAt: login.expiresAt,
      store: login.store,
      auth: async () => ({ token: login.token, headers: {} }),
    };
  if (!oidcAvailable(env)) return null;
  let token = null,
    at = 0,
    claims = {};
  const auth = async () => {
    if (!token || Date.now() - at > REFRESH_MS) {
      token = await githubOidcToken({ env, fetchImpl });
      at = Date.now();
      claims = claimsOf(token);
    }
    return { token, headers: { [OIDC_HEADER]: OIDC_KIND } };
  };
  await auth();
  const repo = claims.repository
    ? `${claims.repository}${claims.ref ? ` (${claims.ref})` : ''}`
    : 'this GitHub repository';
  return {
    kind: OIDC_KIND,
    label: `GitHub Actions: ${repo}`,
    email: null,
    repository: claims.repository ?? null,
    ref: claims.ref ?? null,
    auth,
  };
}
