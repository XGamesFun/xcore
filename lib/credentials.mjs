// The games.fun sign-in (`xcore login` / `publish` / `logout`) on top of one secret store,
// lib/secret-store.mjs (macOS keychain, Linux Secret Service, Windows DPAPI, else a 0600 file; the kit's backend sign-ins
// live there too). This module adds only what publishing needs beside the secret: a public index of who is signed in
// where and until when, credentials.json in the person's config folder (0600; never a secret in it).
//
// Names. The secret store takes names of [a-z0-9-]; a sign-in's key is `games.fun <origin>`, so its secret is kept
// under `publish-<first 16 hex of sha256(key)>`. The backend's names are `backend-supabase`, `backend-supabase-app`,
// `supabase-db-<ref>`, `railway-token` and `railway-client`: no `publish-` among them, so a login and a backend connect
// never overwrite each other.
//
// GAMESFUN_CREDENTIALS=file (an older switch, kept for compatibility) still forces the file, as GAMESFUN_SECRET_STORE=file
// does; GAMESFUN_CONFIG_DIR moves the folder.
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configDir, deleteSecret as storeDelete, getSecret, setSecret, storeInfo } from './secret-store.mjs';

export { configDir };
export const credentialsFile = opts => path.join(configDir(opts), 'credentials.json');

/** The secret store's name for a sign-in key (`games.fun https://…`). */
export const secretName = key => `publish-${createHash('sha256').update(String(key)).digest('hex').slice(0, 16)}`;

// the old switch keeps working: GAMESFUN_CREDENTIALS=file → the store's file
const storeEnv = env =>
  env.GAMESFUN_CREDENTIALS === 'file' && env.GAMESFUN_SECRET_STORE !== 'file'
    ? { ...env, GAMESFUN_SECRET_STORE: 'file' }
    : env;
// the store's kinds, in the words `xcore login` already uses
const STORE = { file: 'file', 'windows-dpapi': 'dpapi', 'macos-keychain': 'keychain', libsecret: 'secret-service' };

async function readAll(file) {
  try {
    const v = JSON.parse(await readFile(file, 'utf8'));
    return v && typeof v === 'object' && v.entries ? v : { version: 1, entries: {} };
  } catch {
    return { version: 1, entries: {} };
  }
}
async function writeAll(file, data) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await chmod(tmp, 0o600).catch(() => {});
  try {
    await rename(tmp, file);
  } catch {
    await writeFile(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    await rm(tmp, { force: true });
  } // Windows: EPERM/EBUSY
  await chmod(file, 0o600).catch(() => {});
}

/** Which store this system uses for new secrets, in words (`xcore login` says it). */
export function storeName({ env = process.env, platform = process.platform } = {}) {
  const s = storeInfo({ env: storeEnv(env), platform });
  return s.kind === 'file'
    ? `a file readable by you only (in ${s.where})`
    : s.kind === 'windows-dpapi'
      ? `a file in your profile, encrypted for your Windows user (in ${s.where})`
      : s.where;
}

/**
 * Keep `secret` under `key` (e.g. "games.fun https://xgames.fun"), with `meta` (public: email, expiry).
 * → { store: 'keychain' | 'secret-service' | 'dpapi' | 'file', file }
 */
export async function saveSecret(key, secret, meta = {}, { env = process.env, platform = process.platform } = {}) {
  const file = credentialsFile({ env, platform }),
    all = await readAll(file);
  const saved = setSecret(secretName(key), secret, { env: storeEnv(env), platform });
  const store = STORE[saved.kind] ?? saved.kind;
  all.entries[key] = { ...meta, savedAt: new Date().toISOString(), store, name: secretName(key) };
  await writeAll(file, all);
  return { store, file };
}

/** → { secret, meta, store } or null. */
export async function loadSecret(key, { env = process.env, platform = process.platform } = {}) {
  const all = await readAll(credentialsFile({ env, platform }));
  const e = all.entries[key];
  if (!e) return null;
  const { secret: legacy, store, name, ...meta } = e;
  // an entry written by an older version kept a file-store secret inline
  const secret = legacy && store === 'file' ? legacy : getSecret(secretName(key), { env: storeEnv(env), platform });
  return secret ? { secret, meta, store } : null;
}

/** Forget `key` everywhere it may be. → whether there was one. */
export async function deleteSecret(key, { env = process.env, platform = process.platform } = {}) {
  const file = credentialsFile({ env, platform }),
    all = await readAll(file);
  const had = Boolean(all.entries[key]);
  storeDelete(secretName(key), { env: storeEnv(env), platform });
  delete all.entries[key];
  await writeAll(file, all);
  return had;
}

/** The public part of every entry (never a secret): for `xcore login --status`. */
export async function listEntries(opts = {}) {
  const all = await readAll(credentialsFile(opts));
  return Object.fromEntries(Object.entries(all.entries).map(([k, { secret, ...rest }]) => [k, rest]));
}
