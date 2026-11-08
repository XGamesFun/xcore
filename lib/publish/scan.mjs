// What a published game may carry. The kit checks these rules before a publish, for a fast answer; xgames.fun runs the
// same rules again on its side for every publish, whatever the kit already checked.
//
// 1. Secrets. A published game's files are public: anyone can download them. A file that
//    looks like a key is refused, in plain words, naming the file and line and never echoing the value. Keys that are
//    DESIGNED to be public pass: a Supabase anon key (a JWT whose role is "anon"; row-level security is what protects
//    the data), a Supabase publishable key (sb_publishable_…) and a Firebase web config's apiKey (security rules
//    protect the data). A service-role key, a secret key (sb_secret_…), any other JWT, any other Google key (Gemini),
//    private keys, cloud and payment keys, .env files and wallet keypairs are refused.
// 2. Backend origins. A game that talks to its own backend (its Supabase project, its server) names the origins in
//    backend.json → origins at the game's root (`xcore backend use custom` writes it; the kit's `backend connect` too).
//    The play host adds exactly those to that game's content-security policy (connect-src; the https ones also
//    img-src and media-src) and nothing else; every other third-party request stays refused.
import { CMD } from '../command.mjs';

/** Key-shaped strings (the kit's general scanner, lib/secret-patterns.mjs, plus Supabase's). */
export const SECRET_PATTERNS = [
  ['private key block', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g],
  // not inside a word or a class name (style-sk-aria-pressed): a key stands on its own
  [
    'OpenAI or Anthropic key',
    /(?<![A-Za-z0-9_-])sk-(?:(?:proj|ant|svcacct|admin)-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{32,})/g,
  ],
  ['Meshy key', /\bmsy_[A-Za-z0-9_-]{16,}/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['Stripe secret key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{16,}/g],
  ['Supabase access token', /\bsbp_[A-Za-z0-9]{20,}/g],
  ['database address with a password', /\bpostgres(?:ql)?:\/\/[^\s:@/'"]+:[^\s@/'"]+@/gi],
  ['xgames.fun publish token', /\bgfk_[A-Za-z0-9_-]{30,}/g],
  // providers whose keys have a shape of their own (each prefix, length and alphabet as the provider issues them)
  ['Hugging Face token', /\bhf_[A-Za-z0-9]{34,}\b/g],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/g],
  ['GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}/g],
  ['SendGrid key', /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g],
  ['Stripe webhook secret', /\bwhsec_[A-Za-z0-9]{32,}/g],
  ['Shopify token', /\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}\b/g],
  ['Google OAuth client secret', /\bGOCSPX-[A-Za-z0-9_-]{28}\b/g],
  ['DigitalOcean token', /\bdo[opr]_v1_[a-f0-9]{64}\b/g],
  ['Telegram bot token', /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g],
  // a game's page never holds an RPC URL (it calls its own /loot/v1/rpc): one with a key in it is that key
  [
    'an RPC URL with its key (helius, alchemy, quicknode, infura)',
    /https?:\/\/[^\s"'`]*(?:helius-rpc\.com[^\s"'`]*[?&]api-key=[A-Za-z0-9-]{16,}|\.alchemy\.com\/v2\/[A-Za-z0-9_-]{20,}|\.quiknode\.pro\/[A-Za-z0-9]{20,}|\.infura\.io\/v3\/[a-f0-9]{32})/g,
  ],
  [
    'a Solana keypair in code (fromSecretKey)',
    /\bfromSecretKey\s*\(\s*(?:(?:new\s+Uint8Array|Uint8Array\.from|bs58\.decode)\s*\(\s*)?[["'`]/g,
  ],
  [
    'secret assigned a literal',
    // not the first branch of a ternary (cond ? 'MySecretsText' : 'OtherText')
    /(?<!\?\s*["']?)\b[A-Za-z0-9_]*(?:SECRET|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_TOKEN|SERVICE_ROLE|PASSWORD)[A-Za-z0-9_]*["']?\s*[:=]\s*["']([A-Za-z0-9+/_=.-]{16,})["']/gi,
  ],
  // never touching + / = : those break up base64 data (an inlined picture), where a run of base58 letters is chance
  // a signing key's 32-byte seed in hex, by its name (VOUCHER_SEED=…, voucherSeed: '…'): xcore add vouchers' format
  [
    'signing key seed (hex)',
    /\b[A-Za-z0-9_]*(?:VOUCHER|WALLET|SIGNER|SIGNING|KEY)_?SEED[A-Za-z0-9_]*["']?\s*[:=]\s*["'`]?[0-9a-fA-F]{64}(?![0-9a-fA-F])/gi,
  ],
  // a key file as a script writes one: {"pub": "<address>", "seed": "<64 hex>"} (either order)
  [
    'key file (pub and seed)',
    /["']seed["']\s*:\s*["'][0-9a-fA-F]{64}["'][\s\S]{0,200}?["']pub(?:lic)?(?:Key)?["']\s*:|["']pub(?:lic)?(?:Key)?["']\s*:\s*["'][1-9A-HJ-NP-Za-km-z]{32,44}["'][\s\S]{0,200}?["']seed["']\s*:\s*["'][0-9a-fA-F]{64}["']/g,
  ],
  // a 64-byte secret key written into code by its name (const SECRET_KEY = [12, 200, …] or new Uint8Array([…]))
  [
    'secret key bytes in code',
    /\b[A-Za-z0-9_]*(?:SECRET|PRIVATE|KEYPAIR|SEED)[A-Za-z0-9_]*["']?\s*[:=]\s*(?:new\s+Uint8Array\(\s*)?\[\s*(?:\d{1,3}\s*,\s*){31,63}\d{1,3}\s*\]/gi,
  ],
  ['Solana secret key (base58)', /(?<![A-Za-z0-9+/])[1-9A-HJ-NP-Za-km-z]{86,90}(?![A-Za-z0-9+/=])/g],
];
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}/g;

/** Files refused by name, wherever they are in the folder. */
export const REFUSED_FILES = [
  [/(^|\/)\.env(\.[^/]*)?$/i, 'a .env file (secrets live there, never in a game)'],
  [/\.(pem|key|p12|pfx)$/i, 'a key or certificate file'],
  [/(^|\/)id_(rsa|ed25519|ecdsa)[^/]*$/, 'an SSH key'],
  [/\.keypair\.json$/i, 'a wallet keypair'],
  [/(^|\/)service[-_]?account[^/]*\.json$/i, 'a cloud service-account key'],
];

const TEXT_EXT =
  /\.(m?js|cjs|json|jsonl|md|txt|html?|css|ya?ml|toml|ini|cfg|env|sh|ps1|py|ts|tsx|jsx|svg|csv|xml|example|map|glsl|wgsl|vert|frag)$/i;
const BINARY_EXT =
  /\.(glb|gltf|png|jpe?g|gif|webp|avif|ktx2|hdr|exr|wasm|bin|ogg|mp3|wav|m4a|flac|mp4|webm|zip|gz|woff2?|ttf|otf|ico|pck)$/i;
/** Files the scanner never reads (pictures, models, sounds, wasm): known binary extensions. */
export const isBinaryPath = path => BINARY_EXT.test(path);
/** Whether the scanner reads a file: known text extensions, or no NUL byte in the first 8 KB and not a known binary. */
export const looksText = (path, bytes) =>
  TEXT_EXT.test(path) || (!BINARY_EXT.test(path) && !bytes.subarray(0, 8192).includes(0));
/** The scanner reads text files up to this size; bigger text (a bundled engine) is still scanned, in its first part. */
export const SCAN_BYTES = 4 * 1024 * 1024;

function base64urlJson(part) {
  try {
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const text = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return JSON.parse(
      decodeURIComponent(Array.from(text, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')),
    );
  } catch {
    return null;
  }
}
/** A JWT's role claim (Supabase keys carry one), or null when it is not a readable JWT. */
export function jwtRole(token) {
  const payload = base64urlJson(String(token).split('.')[1] ?? '');
  return payload && typeof payload === 'object' ? (typeof payload.role === 'string' ? payload.role : '') : null;
}
/** Keys designed to ship inside a browser game: a Supabase anon key, or a Supabase publishable key. */
export const isPublicKey = value =>
  /^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(value) ||
  (/^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) && jwtRole(value) === 'anon');

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

// A Firebase web config: its authDomain or its web appId, a few lines from the key
const FIREBASE_CONFIG =
  /authDomain["']?\s*:\s*["'][a-z0-9-]+\.(?:firebaseapp\.com|web\.app)["']|appId["']?\s*:\s*["']1:\d+:web:[0-9a-f]+["']/;
/**
 * A Google API key that is the apiKey of a Firebase web config ({apiKey: 'AIza…', authDomain: '….firebaseapp.com', …}):
 * designed to ship in the page (Firebase's security rules protect the data), as a Supabase anon key is. The same shape
 * anywhere else (a Gemini or a server-side Maps key) is refused. `index`: where the key starts in `text`.
 */
export const isFirebaseWebKey = (text, index) =>
  /apiKey["']?\s*:\s*["'`]$/.test(text.slice(Math.max(0, index - 20), index)) &&
  FIREBASE_CONFIG.test(text.slice(Math.max(0, index - 400), index + 400));

/** Is the base58 text at `at` the value of a `signature` (JSON or JS: "signature": "…", signature: '…')? */
const SIGNATURE_KEY = /(?:^|[{,\s])["']?signature["']?\s*:\s*["']$/;
export const isSignature = (text, at) => SIGNATURE_KEY.test(text.slice(Math.max(0, at - 40), at));

/**
 * Every secret-shaped thing in one file: [{path, line, kind}]. Never returns the value. `bytes` is a Uint8Array.
 * Binary files are not read (a key inside a PNG is not a thing anyone ships by accident).
 */
export function scanFile(path, bytes) {
  const hits = [];
  for (const [re, why] of REFUSED_FILES)
    if (re.test(path)) {
      hits.push({ path, line: 0, kind: why });
      break;
    }
  if (!looksText(path, bytes)) return hits;
  const text = new TextDecoder().decode(bytes.subarray(0, SCAN_BYTES));
  for (const [kind, re] of SECRET_PATTERNS) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(text));) {
      if (kind === 'secret assigned a literal' && isPublicKey(m[1])) continue;
      if (kind === 'Google API key' && isFirebaseWebKey(text, m.index)) continue;
      if (
        kind === 'secret assigned a literal' &&
        /^AIza/.test(m[1]) &&
        isFirebaseWebKey(text, m.index + m[0].lastIndexOf(m[1]))
      )
        continue;
      // a real key is random: a run of one letter (a tile map row) is not one; and a transaction's signature is the
      // same length (an economy's xsolana.json records the ones that put it live, and a server that imports it carries them)
      if (kind === 'Solana secret key (base58)' && (new Set(m[0]).size < 20 || isSignature(text, m.index))) continue;
      hits.push({ path, line: lineAt(text, m.index), kind });
      break; // one hit per kind per file is enough to refuse it
    }
  }
  JWT.lastIndex = 0;
  for (let m; (m = JWT.exec(text));) {
    const role = jwtRole(m[0]);
    if (role === 'anon') continue;
    hits.push({
      path,
      line: lineAt(text, m.index),
      kind:
        role === 'service_role'
          ? 'Supabase service-role key (it bypasses row-level security: never in a game)'
          : role
            ? `a signed token with role "${role}"`
            : 'a signed token (JWT)',
    });
    break;
  }
  if (/\.json$/i.test(path)) {
    try {
      const v = JSON.parse(text);
      if (Array.isArray(v) && v.length === 64 && v.every(n => Number.isInteger(n) && n >= 0 && n < 256))
        hits.push({ path, line: 1, kind: 'a wallet keypair (64-byte array)' });
    } catch {
      /* not JSON */
    }
  }
  return hits;
}

/** The refusal, in plain words, for a list of hits (or null). */
export function secretsMessage(hits) {
  if (!hits.length) return null;
  const files = new Set(hits.map(h => h.path)).size;
  const shown = hits
    .slice(0, 5)
    .map(h => `${h.path}${h.line ? `:${h.line}` : ''} (${h.kind})`)
    .join('; ');
  return (
    `Nothing was published: ${files === 1 ? 'a file looks like it holds a secret' : `${files} files look like they hold secrets`}: ${shown}${hits.length > 5 ? '; …' : ''}. ` +
    "A published game is public, file by file. Keep keys on your own machine or in your backend; a browser game may only carry keys made to be public (a Supabase anon or publishable key with row-level security on, a Firebase web config's apiKey)."
  );
}

// ---- Backend origins ---------------------------------------------------------------------------------------------

export const MAX_BACKEND_ORIGINS = 8;
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;
const LOCAL_NAME = /(^|\.)(localhost|local|internal|lan|home|test|example|invalid)$/i;

/**
 * One backend origin, checked: https: or wss:, a public DNS name (no IP literal, no localhost or private suffix), no
 * path, query, credentials or wildcard, and not the Studio or the play host itself. → the normalised origin; throws
 * an Error whose message says what is wrong.
 */
export function backendOrigin(value, { own = [] } = {}) {
  const bad = why => Error(`backend.json origins: ${JSON.stringify(value)} ${why}.`);
  if (typeof value !== 'string' || !value.trim()) throw bad('is not an origin');
  if (value.length > 200) throw bad('is too long');
  if (value.includes('*')) throw bad('has a wildcard; name each origin');
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw bad('is not a URL');
  }
  const loopback = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(url.hostname) || /\.localhost$/i.test(url.hostname);
  if (loopback)
    throw bad('is on this machine: a published game cannot reach it. Connect a hosted project before publishing');
  if (!['https:', 'wss:'].includes(url.protocol)) throw bad('must start with https:// or wss://');
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== ''))
    throw bad('must be an origin only (no path, query or user)');
  if (value.trim().replace(/\/+$/, '').toLowerCase() !== url.origin) throw bad(`must be written as ${url.origin}`);
  const host = url.hostname.toLowerCase();
  if (IP_LITERAL.test(host) || !host.includes('.') || LOCAL_NAME.test(host))
    throw bad('must be a public name (no IP address, localhost or private name)');
  if (
    own.some(o => {
      try {
        return new URL(o).hostname.toLowerCase() === host;
      } catch {
        return false;
      }
    })
  )
    throw bad('is xgames.fun itself; the game reaches its own host without listing it');
  return url.origin;
}

/** The game's backend settings file, at its root (public values only). */
export const BACKEND_FILE = 'backend.json';

/**
 * The origins a game's backend.json asks for: {origins, problems}. `backend` is the parsed backend.json (or null:
 * no backend, the default). Strict for publishing (problems refuse it); the play host uses only `origins`.
 */
export function backendOrigins(backend, { own = [] } = {}) {
  const list = backend?.origins;
  if (backend == null || list == null)
    return {
      origins: [],
      problems: backend?.url
        ? [`backend.json has a url but no origins; run \`${CMD} backend connect\` again to write them.`]
        : [],
    };
  if (!Array.isArray(list))
    return {
      origins: [],
      problems: [
        'backend.json origins must be a list of origins, like ["https://abcd.supabase.co", "wss://abcd.supabase.co"].',
      ],
    };
  const origins = [],
    problems = [];
  for (const value of list) {
    try {
      const o = backendOrigin(value, { own });
      if (!origins.includes(o)) origins.push(o);
    } catch (e) {
      problems.push(e.message);
    }
  }
  if (origins.length > MAX_BACKEND_ORIGINS) {
    problems.push(`backend.json origins names ${origins.length} origins; at most ${MAX_BACKEND_ORIGINS}.`);
    origins.length = MAX_BACKEND_ORIGINS;
  }
  // The url the game's client calls must be one of them (else the published game would be refused at its first call).
  if (typeof backend.url === 'string' && backend.url) {
    let at = null;
    try {
      at = new URL(backend.url).origin;
    } catch {
      problems.push(`backend.json url ${JSON.stringify(backend.url)} is not an address.`);
    }
    if (at && !origins.includes(at) && !problems.length) problems.push(`backend.json url ${at} is not in its origins.`);
  }
  return { origins, problems };
}
