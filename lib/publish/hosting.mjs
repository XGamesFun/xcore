// What xgames.fun's play host does with a published game's files, as the kit checks it before a publish (pure: no Node
// imports; the headers and types are the play origin's own, ../play-policy.mjs). README.md is the person's page for
// it; ./scan.mjs holds the secret scan and the backend origins, which the service runs again on its side.
//
//   Static files only   a published game is a file tree served as it is (GET and HEAD); index.html at its root is the
//                       entry. A folder URL ending in "/" serves that folder's index.html; any other missing path is
//                       the host's "not found" page (no fallback to index.html, so a deep link of a client-side router
//                       works only from the entry page). No server-side rendering: code that runs on a server goes in
//                       server/ (gf-server-v1, docs/SERVER.md), answering /api/*.
//   Where it is served  at its own origin's root once published; under a folder in xgames.fun Studio's preview and in
//                       the kit's dev server (/game/). Paths from the root (/assets/x.js) break there: a game uses
//                       relative URLs.
//   Paths the host owns /api/* (the game's server, when it has one), /platform/v1/* (sign-in, saves, scores), the
//                       multiplayer signaling, the live watch, world saves, player keys and /loot/v1/* (Solana RPC).
//                       A file of the game under one of them is never reached.
//   The page's policy   pageHeaders below: the page loads scripts, styles, fonts and frames from its own origin only;
//                       it connects to its own origin and to its backend.json origins (pictures and sounds from those
//                       https ones too); no <base>, no form posts; no camera, microphone, location, payment or USB.
//   Files               hidden files and folders never go up; a file whose extension the host does not know is served
//                       as application/octet-stream with nosniff (a browser will not run it as a script or a style).
//   Limits              what GET /api/kit/me says (`limits`); DEFAULT_LIMITS when the kit cannot ask (offline).
import { MIME, mimeFor, playHeaders } from '../play-policy.mjs';

/** The host's limits for one published game, as xgames.fun states them today (README.md "What the hosting takes"); publish reads the account's own. */
export const DEFAULT_LIMITS = Object.freeze({
  files: 3000,
  totalBytes: 100 * 1024 * 1024,
  fileBytes: 100 * 1024 * 1024, // as large as the whole game: one engine file (a Godot 4 index.wasm, ~36 MB) fits
});

/** Paths on the game's origin the play host answers itself (the page calls them with root paths; never files of the game). */
export const HOST_PATHS = Object.freeze([
  '/platform/v1/',
  '/signal/v1',
  '/watch/v1',
  '/world/v1/',
  '/player/v1/',
  '/loot/v1/',
]);
const underPath = (p, prefix) =>
  p === prefix.replace(/\/$/, '') || p.startsWith(prefix.endsWith('/') ? prefix : prefix + '/');
/** Is this URL path (starting with "/") one the play host answers itself? `server`: the game has its own server (/api/*). */
export const isHostPath = (urlPath, { server = false } = {}) =>
  HOST_PATHS.some(p => underPath(urlPath, p)) || (server && underPath(urlPath, '/api/'));

/** A file of the tree (posix, relative) the host would never serve, and why; null when it is served. */
export function shadowedPath(rel, { server = false } = {}) {
  const p = '/' + rel;
  if (server && underPath(p, '/api/')) return "is under api/, which the game's own server answers";
  return HOST_PATHS.some(h => underPath(p, h))
    ? `is under ${HOST_PATHS.find(h => underPath(p, h)).replace(/^\//, '')}, which the play host answers itself`
    : null;
}

/** The extensions the play host serves with their own type (its MIME table); any other file is application/octet-stream. */
export const SERVED_TYPES = Object.freeze(Object.keys(MIME));
/** Is a file served with a type of its own (not as application/octet-stream)? */
export const servedTyped = rel => Object.hasOwn(MIME, (/\.([a-z0-9]+)$/i.exec(rel)?.[1] ?? '').toLowerCase());
export { mimeFor };
/** Script-like files a browser refuses to run when served as application/octet-stream with nosniff. */
export const UNTYPED_CODE = /\.(cjs|jsx|tsx?|vue|svelte|scss|sass|less)$/i;

/**
 * The headers the play host sends with a published game's files, for its backend origins (backend.json → origins,
 * already checked: lib/publish/scan.mjs backendOrigins): the play origin's own (lib/play-policy.mjs
 * playHeaders). The page check sends the same. `framedBy`: the origin of the page that frames it (the play page's; the
 * check's own stand-in for it), added to frame-ancestors.
 */
export const pageHeaders = (backend = [], mime = null, files = [], framedBy = null) =>
  playHeaders({ studioOrigin: framedBy, backend, files, ...(mime ? { mime } : {}) });
/** The page policy (Content-Security-Policy) alone. */
export const pagePolicy = (backend = []) => pageHeaders(backend)['content-security-policy'];

/** What a request of `kind` to `origin` needs on the hosted page: null (allowed) or why it is refused. */
export function hostedRefusal(origin, kind, { backend = [] } = {}) {
  const declared = backend.includes(origin);
  if (['script', 'stylesheet', 'font', 'document', 'frame', 'iframe', 'object', 'manifest'].includes(kind))
    return `a ${kind === 'stylesheet' ? 'style sheet' : kind === 'document' || kind === 'iframe' ? 'frame' : kind} from ${origin}: the hosted page loads ${kind === 'font' ? 'fonts' : kind === 'stylesheet' ? 'style sheets' : kind === 'script' ? 'scripts' : 'that'} from its own files only; put a copy in the game`;
  if (['image', 'media', 'img'].includes(kind))
    return declared && origin.startsWith('https:')
      ? null
      : `${kind === 'media' ? 'a sound or video' : 'a picture'} from ${origin}, not in backend.json origins`;
  return declared ? null : `a connection to ${origin}, not in backend.json origins`;
}
