// The play origin's contract: how xgames.fun stores a published game's files (a file tree), which types it serves them
// with, and the security headers every page gets. Pure module (no Node or DOM imports), shared by the page check
// (./publish/hosting.mjs) and the kit.
//
// A file-tree version is a list of files stored by content: blobs live at `blobs/<sha256>`, and the tree itself is
// canonical JSON at `trees/<treeSha>.json`. Games load their own files with relative URLs, so the URL prefix the play
// host serves them under never matters to them.

export const TREE_FORMAT = 'gf-tree-v1';
export const TREE_LIMITS = { files: 5000, totalBytes: 512 * 1024 * 1024, fileBytes: 128 * 1024 * 1024 };
export const SHA256 = /^[0-9a-f]{64}$/;
export const blobKey = sha => `blobs/${sha}`;
export const treeKey = sha => `trees/${sha}.json`;

// eslint-disable-next-line no-control-regex -- it exists to find control characters
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// A safe tree path: relative, forward slashes, no dot segments, no control characters.
export function treePath(path) {
  if (
    typeof path !== 'string' ||
    !path ||
    path.length > 512 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    CONTROL_CHARS.test(path)
  )
    throw Error(`Unsafe tree path: ${JSON.stringify(path)}`);
  const parts = path.split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) throw Error(`Unsafe tree path: ${JSON.stringify(path)}`);
  return path;
}

export const MIME = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  ink: 'text/plain; charset=utf-8',
  pzl: 'text/plain; charset=utf-8',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  ktx2: 'image/ktx2',
  hdr: 'application/octet-stream',
  exr: 'application/octet-stream',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  webmanifest: 'application/manifest+json',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  bin: 'application/octet-stream',
  wasm: 'application/wasm',
  pck: 'application/octet-stream',
  sog: 'application/octet-stream',
  ply: 'application/octet-stream',
  spz: 'application/octet-stream',
};
export const mimeFor = path =>
  MIME[(/\.([a-z0-9]+)$/i.exec(path)?.[1] ?? '').toLowerCase()] ?? 'application/octet-stream';

/** Validate a tree object; returns it with paths sorted (canonical order). Throws with a readable message. */
export function validateTree(tree) {
  if (!tree || tree.schemaVersion !== 1 || tree.format !== TREE_FORMAT || !Array.isArray(tree.files))
    throw Error('Not a gf-tree-v1 tree.');
  if (tree.files.length === 0 || tree.files.length > TREE_LIMITS.files)
    throw Error(`A tree holds 1–${TREE_LIMITS.files} files.`);
  const seen = new Set();
  let total = 0;
  for (const f of tree.files) {
    treePath(f.path);
    if (seen.has(f.path)) throw Error(`Duplicate tree path ${f.path}.`);
    seen.add(f.path);
    if (!SHA256.test(f.sha256 ?? '')) throw Error(`Bad sha256 for ${f.path}.`);
    if (!Number.isInteger(f.bytes) || f.bytes < 0 || f.bytes > TREE_LIMITS.fileBytes)
      throw Error(`Bad size for ${f.path}.`);
    total += f.bytes;
  }
  if (total > TREE_LIMITS.totalBytes) throw Error('Tree is larger than the play-origin limit.');
  if (!seen.has('index.html')) throw Error('A tree needs index.html at its root.');
  return {
    schemaVersion: 1,
    format: TREE_FORMAT,
    files: [...tree.files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map(f => ({ path: f.path, sha256: f.sha256, bytes: f.bytes, mime: f.mime ?? mimeFor(f.path) })),
  };
}

/** A connect-src origin: ws:, wss: or https: with a host, no path, query, credentials or wildcard. Returns it normalised; throws otherwise. */
export function connectOrigin(value) {
  const bad = () => Error(`Bad connect origin: ${JSON.stringify(value)}`);
  if (typeof value !== 'string' || value.includes('*')) throw bad();
  let url;
  try {
    url = new URL(value);
  } catch {
    throw bad();
  }
  if (
    !['ws:', 'wss:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    value.replace(/\/+$/, '').toLowerCase() !== url.origin
  )
    throw bad();
  return url.origin;
}

/**
 * Headers for every play-origin response. Games may be framed by `studioOrigin` (one origin or a list) and by the play
 * origin itself ('self'): the multiplayer party page frames its own game from the same origin.
 * Same-origin requests (fetch, workers, wasm) are allowed; every third-party request is refused.
 * `isolated` (assets.json `runtime.crossOriginIsolated: true`) adds COOP/COEP for SharedArrayBuffer games.
 * `embedders`: more origins that may frame it (published games only: PUBLIC_EMBEDDERS).
 * `connect`: more origins the page may open connections to (connect-src): the live relay's wss:// origin for published
 * games. Only ws:, wss: and https: origins, no paths, no wildcards; else it throws.
 * `backend`: the game's own backend origins (its backend.json → origins, checked by ./publish/scan.mjs
 * backendOrigins): added to connect-src, and the https ones to img-src and media-src (pictures and sounds from the
 * game's own storage). Per game: each tree's files carry only that tree's origins.
 */
export function playHeaders({ studioOrigin, isolated = false, mime, embedders = [], connect = [], backend = [] }) {
  const own = backend.map(connectOrigin);
  const extraConnect = [...new Set([...connect.map(connectOrigin), ...own])];
  const media = own.filter(o => o.startsWith('https:'));
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
    "worker-src 'self' blob:",
    ["connect-src 'self' blob: data:", ...extraConnect].join(' '),
    ["img-src 'self' data: blob:", ...media].join(' '),
    ["media-src 'self' data: blob:", ...media].join(' '),
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    // 'self': the multiplayer party page frames the game from the same origin.
    `frame-ancestors ${["'self'", ...[studioOrigin].flat(), ...embedders].filter(Boolean).join(' ')}`,
  ].join('; ');
  const h = {
    'content-security-policy': csp,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    // A COEP:require-corp embedder (Studio framing an isolated game) can only load a cross-origin sub-document that
    // opts in with `cross-origin`; `same-origin` here would make Chrome refuse that framing. Non-isolated
    // games keep the tighter default, since nothing embedding them sets COEP.
    'cross-origin-resource-policy': isolated ? 'cross-origin' : 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  };
  if (mime) h['content-type'] = mime;
  if (isolated) {
    h['cross-origin-opener-policy'] = 'same-origin';
    h['cross-origin-embedder-policy'] = 'require-corp';
  }
  return h;
}

/**
 * Who else may frame a published game's files (/p/ only; never /v/ or /d/, whose URLs carry a token): X, so a post
 * linking /play/<slug> plays the game inside the post. The game listens to its ancestors for the host bridge, which
 * is why this is a short list and not every site.
 */
export const PUBLIC_EMBEDDERS = Object.freeze([
  'https://x.com',
  'https://*.x.com',
  'https://twitter.com',
  'https://*.twitter.com',
]);

// ---- The play and Studio origins -------------------------------------------------------------------------------------
// PLAY_HOST is one configured value (env), never derived from a request. Normally it is "play." plus the Studio host
// (same port); when it is not, STUDIO_ORIGIN names the Studio origin (studioOriginFor). Exact loopback names, or any
// *.localhost subdomain (Chrome resolves those to loopback too), are served over http.
const LOOPBACK_HOSTNAME = /^(localhost|127\.0\.0\.1|\[?::1\]?)$|\.localhost$/i;
const originFor = host => `${LOOPBACK_HOSTNAME.test((host ?? '').split(':')[0]) ? 'http' : 'https'}://${host}`;

/** The absolute play origin ("https://play.example.com"), or null when PLAY_HOST is unset. */
export function playOrigin(env = process.env) {
  const host = env.PLAY_HOST?.trim();
  return host ? originFor(host) : null;
}
/** The Studio origin that frames play-origin games, derived from PLAY_HOST by stripping its "play." prefix. */
export function studioOriginFromPlayHost(playHost) {
  if (!playHost) return null;
  const [hostname, port] = playHost.split(':');
  const stripped = hostname.startsWith('play.') ? hostname.slice(5) : hostname;
  return originFor(stripped + (port ? ':' + port : ''));
}

/**
 * The Studio origin allowed to frame play-origin games (CSP frame-ancestors). STUDIO_ORIGIN wins when set (a host
 * that cannot have a "play." subdomain); otherwise it is PLAY_HOST with its "play." prefix stripped.
 */
export function studioOriginFor(env = process.env) {
  const explicit = env.STUDIO_ORIGIN?.trim().replace(/\/+$/, '');
  return explicit || studioOriginFromPlayHost(env.PLAY_HOST?.trim());
}
