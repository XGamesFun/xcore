// `xcore files ls|put|get|rm|usage`: the game's project files, which the developer or
// the game's server writes, never players (replays, generated levels, content packs). On this machine by default (the
// ones `xcore dev` gives env.GF.files, in .gamesfun/dev/files/: ./dev/files.mjs); with `live: true` the game's files on
// xgames.fun, through the owner's routes (each call is kept in the game's audit log there):
//   GET    /api/kit/games/<id>/files?prefix=&after=   the list
//   PUT    /api/kit/games/<id>/files/<path>           the raw bytes, content-type, x-gf-public: 1 for a public one
//   GET    /api/kit/games/<id>/files/<path>           the bytes
//   DELETE /api/kit/games/<id>/files/<path>
//   GET    /api/kit/games/<id>/files-usage            the bytes against the cap
// A public file is served at https://<slug>.xgamesusercontent.com/<path>, another site to the browser (here, at the
// files origin `xcore dev` prints: another origin, though the same site). Paths are checked here as xgames.fun checks
// them (../server/contract.mjs FILES).
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { call, studioOrigin } from './publish/client.mjs';
import { OIDC_KIND, requireCredential } from './publish/oidc.mjs';
import { notFromCi } from './db.mjs';
import { notPublished, readLinks } from './publish/index.mjs';
import { FILES, STUDIO_BODY_BYTES, fileType, filePathProblem, studioFeatures } from './server/contract.mjs';
import { createFileStore } from './dev/files.mjs';
import { sizeText } from './util.mjs';

const refuse = (why, code = 'files') => Object.assign(new Error(why), { code });
const encodePath = p => p.split('/').map(encodeURIComponent).join('/');

/** The game on xgames.fun, how to sign the call, and its files' domain; refused when xgames.fun has no files yet. */
async function target(dir, { origin, env, fetchImpl }) {
  const known = (await readLinks(dir))[origin];
  if (!known?.projectId) throw notPublished(origin, 'put its files', dir);
  const cred = await requireCredential(origin, { env, fetchImpl });
  const auth = await cred.auth();
  const me = await call(origin, '/api/kit/me', { ...auth, fetchImpl });
  if (!studioFeatures(me).has('files'))
    throw refuse(
      'this xgames.fun does not keep project files yet (GET /api/kit/me does not list "files"): on this machine, leave out --live',
      'feature',
    );
  return {
    id: known.projectId,
    auth,
    ci: cred.kind === OIDC_KIND,
    domain: me?.files?.domain ?? FILES.domain,
    slug: known.slug ?? null,
  };
}
const base = (origin, id) => `${origin}/api/kit/games/${encodeURIComponent(id)}`;

/** A call whose body or answer is a file's bytes (call() is JSON's). → the Response, refused in words when not ok */
async function raw(url, { method, auth, body, headers = {}, fetchImpl, ci = false }) {
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { ...headers, ...(auth.headers ?? {}), authorization: `Bearer ${auth.token}` },
      ...(body ? { body, duplex: 'half' } : {}),
    });
  } catch (e) {
    throw Object.assign(new Error(`Could not reach xgames.fun (${e.cause?.code ?? e.message}).`), {
      status: 0,
      code: 'unreachable',
    });
  }
  if (res.ok) return res;
  let a = null;
  try {
    a = await res.json();
  } catch {}
  // a GitHub Actions run may list and download, not change the files
  if (res.status === 403 && ci && (method === 'PUT' || method === 'DELETE'))
    throw Object.assign(new Error(notFromCi(method === 'PUT' ? 'put files' : 'delete files')), {
      status: 403,
      code: 'ci',
    });
  if (res.status === 413 && !a?.code)
    throw Object.assign(new Error(tooBigForStudio()), { status: 413, code: 'too-big' });
  throw Object.assign(new Error(a?.why ?? a?.error ?? `xgames.fun answered ${res.status}.`), {
    status: res.status,
    ...(a?.code ? { code: a.code } : {}),
  });
}

/** A size as the person reads it (./util.mjs sizeText, the one every command prints sizes with). */
export { sizeText };
/** Why a file is too big to go through xgames.fun's Studio (its host's limit on a request, STUDIO_BODY_BYTES), and what to do. */
const tooBigForStudio = (size = null) =>
  `${size === null ? 'xgames.fun answered 413: the file was too big for it to take.' : `This file is ${sizeText(size)}.`} A file put from this machine goes through xgames.fun's Studio, whose host takes at most ${sizeText(STUDIO_BODY_BYTES)} a request. A bigger one (up to ${sizeText(FILES.fileBytes)}) goes up from the game's server: env.GF.files.put(path, body) (docs/SERVER.md, "Project files").`;

const local = dir => createFileStore({ dir });
const answer = a => {
  if (a.ok === false) throw refuse(a.why, a.code);
  return a;
};

/** → {ok, live, items: [{path, bytes, type, public, updatedAt}], after} */
export async function filesList(
  dir,
  { live = false, prefix = '', after = '', origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {},
) {
  if (prefix && !prefix.endsWith('/')) prefix += '/';
  if (!live) return { live: false, ...answer(await local(dir).list({ prefix, after, limit: FILES.listMax })) };
  const t = await target(dir, { origin, env, fetchImpl });
  const q = new URLSearchParams({ ...(prefix ? { prefix } : {}), ...(after ? { after } : {}) });
  const route = `/api/kit/games/${encodeURIComponent(t.id)}/files${q.size ? `?${q}` : ''}`;
  return { live: true, ...(await call(origin, route, { ...t.auth, fetchImpl })) };
}

/**
 * What a put of `file` to `to` (default: its own name) would send, refused here when it could not go: a path that is
 * none, a file that is not there or too big. → {path, bytes, type}
 */
export async function putOf(file, to, { live = false, type = null } = {}) {
  const p = to ?? path.basename(file);
  const bad = filePathProblem(p);
  if (bad) throw refuse(bad, 'path');
  let size;
  try {
    size = (await stat(file)).size;
  } catch {
    throw refuse(`${file} is not there`);
  }
  if (size > FILES.fileBytes)
    throw refuse(`${file} is ${sizeText(size)}; a file may be ${FILES.fileBytes / 1048576} MB`, 'too-big');
  if (live && size > STUDIO_BODY_BYTES) throw refuse(tooBigForStudio(size), 'too-big');
  return { path: p, bytes: size, type: type ?? fileType(p) };
}

/**
 * The file at `p` among the game's files on xgames.fun, if there is one: asked before a put or a delete, because
 * xgames.fun keeps one copy of a file and no earlier one, so writing over it or deleting it loses its bytes for good.
 * xgames.fun has no call for a file's facts alone: this asks for the file and stops at the answer's headers, reading
 * none of its bytes. → {origin, game, path, file: {type, public, bytes?} | null}
 */
export async function liveFile(dir, p, { origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {}) {
  const bad = filePathProblem(p);
  if (bad) throw refuse(bad, 'path');
  const t = await target(dir, { origin, env, fetchImpl });
  const at = { origin, game: t.id, path: p };
  let res;
  try {
    res = await raw(`${base(origin, t.id)}/files/${encodePath(p)}`, { method: 'GET', auth: t.auth, fetchImpl });
  } catch (e) {
    if (e.code === 'not-found') return { ...at, file: null };
    throw e;
  }
  await res.body?.cancel().catch(() => {});
  const length = res.headers.get('content-length');
  return {
    ...at,
    file: {
      type: res.headers.get('x-gf-type') ?? res.headers.get('content-type') ?? 'application/octet-stream',
      public: res.headers.get('x-gf-public') === '1',
      ...(length === null ? {} : { bytes: Number(length) }),
    },
  };
}

/** A file from this machine to `to` (default: its own name). → {ok, live, path, bytes, url?} */
export async function filesPut(
  dir,
  file,
  to,
  { live = false, isPublic = false, type = null, origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {},
) {
  const { path: p, bytes: size, type: kind } = await putOf(file, to, { live, type });
  if (!live) {
    const { readFile } = await import('node:fs/promises');
    return { live: false, ...answer(await local(dir).put(p, await readFile(file), { type: kind, public: isPublic })) };
  }
  const t = await target(dir, { origin, env, fetchImpl });
  const res = await raw(`${base(origin, t.id)}/files/${encodePath(p)}`, {
    method: 'PUT',
    auth: t.auth,
    body: Readable.toWeb(createReadStream(file)),
    // Studio's owner route reads the length from content-length, and passes it on to the platform itself (as
    // content-length and x-gf-length), which streams the body to R2 held to exactly that many bytes
    headers: {
      'content-type': kind,
      'content-length': String(size),
      ...(isPublic ? { 'x-gf-public': '1' } : {}),
    },
    fetchImpl,
    ci: t.ci,
  });
  const a = await res.json().catch(() => ({}));
  const url = a.url ?? (isPublic && t.slug ? `https://${t.slug}.${t.domain}/${p}` : null);
  return { ok: true, live: true, path: p, bytes: a.bytes ?? size, ...(url ? { url } : {}) };
}

/** A file's bytes. → {ok, live, path, body (a Buffer), type, bytes, public} */
export async function filesGet(
  dir,
  p,
  { live = false, origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {},
) {
  const bad = filePathProblem(p);
  if (bad) throw refuse(bad, 'path');
  if (!live) return { live: false, path: p, ...answer(await local(dir).get(p)) };
  const t = await target(dir, { origin, env, fetchImpl });
  const res = await raw(`${base(origin, t.id)}/files/${encodePath(p)}`, { method: 'GET', auth: t.auth, fetchImpl });
  const body = Buffer.from(await res.arrayBuffer());
  return {
    ok: true,
    live: true,
    path: p,
    body,
    // xgames.fun sends every download as an attachment (octet-stream) and the file's own type in x-gf-type
    type: res.headers.get('x-gf-type') ?? res.headers.get('content-type') ?? 'application/octet-stream',
    bytes: body.length,
    public: res.headers.get('x-gf-public') === '1',
  };
}

/** → {ok, live, deleted} */
export async function filesRemove(
  dir,
  p,
  { live = false, origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {},
) {
  const bad = filePathProblem(p);
  if (bad) throw refuse(bad, 'path');
  if (!live) return { live: false, ...answer(await local(dir).delete(p)) };
  const t = await target(dir, { origin, env, fetchImpl });
  const res = await raw(`${base(origin, t.id)}/files/${encodePath(p)}`, {
    method: 'DELETE',
    auth: t.auth,
    fetchImpl,
    ci: t.ci,
  });
  const a = await res.json().catch(() => ({}));
  return { ok: true, live: true, deleted: a.deleted ?? true };
}

/** → {ok, live, bytes, files, cap} */
export async function filesUsage(
  dir,
  { live = false, origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {},
) {
  if (!live) return { live: false, ...answer(await local(dir).usage()) };
  const t = await target(dir, { origin, env, fetchImpl });
  return {
    live: true,
    ...(await call(origin, `/api/kit/games/${encodeURIComponent(t.id)}/files-usage`, { ...t.auth, fetchImpl })),
  };
}
