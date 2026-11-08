// `xcore secret`'s calls to games.fun (the rules: ../server/secrets.mjs; games.fun's hosting contract, gf-server-v1):
//   GET    /api/kit/games/<gameId>/secrets            → {ok, game, names}
//   PUT    /api/kit/games/<gameId>/secrets/<NAME>     {"value"} → {ok, game, name, names}
//   DELETE /api/kit/games/<gameId>/secrets/<NAME>     → {ok, game, name, removed, names}
// The game is the folder's own (its .gamesfun/publish.json for this Studio); the credential is publish's.
import { readLinks } from './index.mjs';
import { call, studioOrigin } from './client.mjs';
import { requireCredential } from './oidc.mjs';
import { secretNameProblem, secretValueProblem } from '../server/secrets.mjs';
import { CMD } from '../command.mjs';

/** The game's id on games.fun (from its publish record) and how to sign the call. Throws in plain words.  (from its publish record) and how to sign the call. Throws in plain words. */
async function target(dir, { origin, env, fetchImpl }) {
  const known = (await readLinks(dir))[origin];
  if (!known?.projectId)
    throw new Error(
      `this folder's game is not on ${origin} yet: publish it with its server/ first (${CMD} publish), then set its secrets`,
    );
  const cred = await requireCredential(origin, { env, fetchImpl });
  return { id: known.projectId, auth: await cred.auth() };
}
const route = (id, name) =>
  `/api/kit/games/${encodeURIComponent(id)}/secrets${name ? `/${encodeURIComponent(name)}` : ''}`;

/** → {ok, game, names} */
export async function listSecrets(dir, { origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {}) {
  const t = await target(dir, { origin, env, fetchImpl });
  return call(origin, route(t.id), { ...t.auth, fetchImpl });
}

/** → {ok, game, name, names}. The value is checked here first, and is never printed. */
export async function setSecret(
  dir,
  name,
  value,
  { origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {},
) {
  const problem = secretNameProblem(name) ?? secretValueProblem(value);
  if (problem) throw new Error(problem);
  const t = await target(dir, { origin, env, fetchImpl });
  return call(origin, route(t.id, name), { method: 'PUT', body: { value }, ...t.auth, fetchImpl });
}

/** → {ok, game, name, removed, names} */
export async function deleteSecret(dir, name, { origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {}) {
  const problem = secretNameProblem(name);
  if (problem) throw new Error(problem);
  const t = await target(dir, { origin, env, fetchImpl });
  return call(origin, route(t.id, name), { method: 'DELETE', ...t.auth, fetchImpl });
}
