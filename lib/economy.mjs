// A game's Solana economy, on loot (the shared program; its tools and page client are @xgamesfun/solana, this package's
// dependency): which file holds the economy, where the package is, and its page client copied into the game as gf/loot/
// with this package's wallets.js beside it. publish brings the copy up to the installed package before a game goes up.
// The kit, until it moves to @xgamesfun/solana too, passes its own loot package and file (`root`, `files`).
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The file a game's economy lives in: xsolana.json (what `xsolana save` writes and `xsolana approve` reads); a game
 *  made before it was named so keeps loot.json, which is read the same. */
export const ECONOMY_FILE = 'xsolana.json';
export const ECONOMY_FILES = [ECONOMY_FILE, 'loot.json'];
/** The game's economy file in `dir` (its first of `files` that is there), or null. */
export const economyFile = (dir, files = ECONOMY_FILES) =>
  files.map(f => path.join(dir, f)).find(f => existsSync(f)) ?? null;

/** @xgamesfun/solana's folder: GAMESFUN_SOLANA (a solana-kit checkout) when it is set, else the installed package; or null. */
export function solanaRoot(env = process.env) {
  const own = env.GAMESFUN_SOLANA ? path.resolve(env.GAMESFUN_SOLANA) : null;
  if (own) return existsSync(path.join(own, 'package.json')) ? own : null;
  try {
    return path.dirname(createRequire(import.meta.url).resolve('@xgamesfun/solana/package.json'));
  } catch {
    return null;
  }
}
/**
 * loot's address as the installed tools have it (their IDL's): the program a game's economy runs on. Read from the
 * package, never written here, so a move of the program is the package's alone. → the address, or null with no tools.
 */
export function lootProgram(env = process.env) {
  const root = solanaRoot(env);
  if (!root) return null;
  try {
    return JSON.parse(readFileSync(path.join(root, 'js', 'client', 'idl', 'loot.json'), 'utf8')).address ?? null;
  } catch {
    return null;
  }
}
/** The package's own command (`xsolana check|simulate|approve|connect …`), run by node. → [node, its bin] or null */
export function solanaCommand(env = process.env) {
  const root = solanaRoot(env);
  if (!root) return null;
  const bin = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).bin?.xsolana ?? 'bin/xsolana.mjs';
  return [process.execPath, path.join(root, bin)];
}

/** Does the installed package's command have `command` (a version from before it says it has none)? Read from its
 *  command's own source, so nothing runs. */
export function solanaHas(command, env = process.env) {
  const xsolana = solanaCommand(env);
  if (!xsolana) return false;
  try {
    return new RegExp(`['"]${command}['"]`).test(readFileSync(xsolana[1], 'utf8'));
  } catch {
    return false;
  }
}

// ---- The page client in a game ---------------------------------------------------------------------------------------
// A published page has no node_modules: the package's page side (@xgamesfun/solana/play and every file it imports, all
// relative plain ES modules with no dependency) is copied into a game with an economy as gf/loot/. Its record
// (gf/loot/release.json) names the package, its version and each file's SHA-256, so a copy that is already the installed
// package's is left alone. The page imports gf/loot/play/index.js and gives solanaApp the page's own /loot/v1/rpc
// (./solana-rpc.mjs PAGE_RPC: the play host's relay).

/** The page client's folder in a game, and its record. */
export const PAGE_DIR = ['gf', 'loot'];
export const PAGE_RECORD = 'release.json';
const PAGE_ENTRY = 'play/index.js';
const OWN_PAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'loot-page'); // this package's own wallets.js
const OWN_PAGE_FILES = ['wallets.js'];
const sha256 = data => createHash('sha256').update(data).digest('hex');

/**
 * The files a copy of the package needs, relative to its js/: `entries` (default the page client, play/index.js) and
 * every file they import. Throws on a bare import (a copy has no node_modules).
 */
export function pageFiles(root, entries = [PAGE_ENTRY]) {
  const base = path.join(root, 'js'),
    seen = new Set();
  const walk = rel => {
    if (seen.has(rel)) return;
    seen.add(rel);
    // comments are dropped first: the client's own usage notes name its package's '/play'
    const code = readFileSync(path.join(base, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const m of code.matchAll(
      /\b(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g,
    )) {
      const spec = m[1] ?? m[2];
      if (!spec.startsWith('.'))
        throw new Error(`the page client imports ${spec} (${rel}), which a published page cannot load`);
      walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)));
    }
  };
  for (const entry of entries) walk(entry);
  return [...seen].sort();
}

/**
 * Copy the package's `entries` (and what they import) into `target`, with `own` files of this package beside them and
 * a record (release.json) naming the package, its version and each file's SHA-256. A copy that is already the installed
 * package's is left alone. → {package, version, files, changed}
 */
async function installCopy(target, root, { entries, own = [] }) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const sources = [
    ...pageFiles(root, entries).map(rel => [rel, path.join(root, 'js', rel)]),
    ...own.map(rel => [rel, path.join(OWN_PAGE, rel)]),
  ];
  const files = Object.fromEntries(sources.map(([rel, from]) => [rel, sha256(readFileSync(from))]));
  const record = { package: pkg.name, version: pkg.version, entry: entries[0], files };
  let had = null;
  try {
    had = JSON.parse(readFileSync(path.join(target, PAGE_RECORD), 'utf8'));
  } catch {}
  const same =
    had?.package === pkg.name &&
    had?.version === pkg.version &&
    JSON.stringify(had.files) === JSON.stringify(files) &&
    Object.entries(files).every(([rel, sum]) => {
      try {
        return sha256(readFileSync(path.join(target, rel))) === sum;
      } catch {
        return false;
      }
    });
  const out = { package: pkg.name, version: pkg.version, files: Object.keys(files).length };
  if (same) return { ...out, changed: false };
  await rm(target, { recursive: true, force: true });
  for (const [rel, from] of sources) {
    await mkdir(path.dirname(path.join(target, rel)), { recursive: true });
    await cp(from, path.join(target, rel));
  }
  for (const f of ['LICENSE', 'NOTICE'])
    if (existsSync(path.join(root, f))) await cp(path.join(root, f), path.join(target, f));
  await writeFile(path.join(target, PAGE_RECORD), JSON.stringify(record, null, 2) + '\n');
  return { ...out, changed: true };
}

/**
 * Put the page client in a game that has an economy, or bring it up to the installed package. root: the package (default
 * @xgamesfun/solana); files: the economy's file names. → null (no economy, or no package here), else {package, version,
 * files, changed}.
 */
export async function installPage(
  gameDir,
  { env = process.env, root = solanaRoot(env), files: names = ECONOMY_FILES } = {},
) {
  if (!economyFile(gameDir, names) || !root) return null;
  // the package's page client, and this package's own wallets.js beside it (the Wallet Standard handshake, the page's RPC)
  return installCopy(path.join(gameDir, ...PAGE_DIR), root, { entries: [PAGE_ENTRY], own: OWN_PAGE_FILES });
}

// ---- The voucher signer in a game's server ---------------------------------------------------------------------------
// `xcore add vouchers` gives a game's server its own voucher key (server/vouchers.js). The voucher's bytes are loot's,
// so the server signs with the package's own code, copied into server/gf-loot/ (results/index.js for signVoucher,
// chain/rpc.js to read a grant's incarnation, and what they import): bundled with the server, never a public file.
// publish brings the copy up to the installed package, so a server's vouchers follow loot when this package does.

/** The voucher signer's folder in a game, from the game's folder (where server/ is). */
export const SERVER_COPY_DIR = ['server', 'gf-loot'];
const SERVER_ENTRIES = ['results/index.js', 'chain/rpc.js'];

/**
 * Put the voucher signer in the game's server, or bring it up to the installed package. `always`: write it even when the
 * game has none yet (add vouchers); otherwise only a copy already there is kept current (publish). → null, or
 * {package, version, files, changed}
 */
export async function installServerCopy(gameDir, { env = process.env, root = solanaRoot(env), always = false } = {}) {
  const target = path.join(gameDir, ...SERVER_COPY_DIR);
  if (!root || (!always && !existsSync(path.join(target, PAGE_RECORD)))) return null;
  return installCopy(target, root, { entries: SERVER_ENTRIES });
}
