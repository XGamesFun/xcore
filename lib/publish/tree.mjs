// The files `xcore publish` sends: a game folder as xgames.fun's file tree (gf-tree-v1: path, sha256, bytes for
// every file; the bytes go up separately, only those xgames.fun does not have yet).
//
// Left out, never uploaded:  evidence/ (verify's screenshots and verdicts), supabase/ (a backend's server-side SQL:
//                            not secret, but not the game; `xcore backend`), server/ (the game's own server code:
//                            it goes up bundled, as server code, never as a public file; docs/SERVER.md) and
//                            gamesfun.json (its settings; never served either),
//                            node_modules/, every hidden file or folder (.gitignore, .gamesfun/ where publish keeps
//                            the game's link and its last check), and the notes a folder keeps for its makers at its top
//                            (README.md, NOTES.md, LAUNCH.md, FRICTION.md, CLAUDE.md, AGENTS.md, TODO.md: how the
//                            game and its server work is no player's business).
// Refused (nothing is sent): a .env file anywhere in the folder, symbolic links (a tree holds ordinary files), the
//                            file types xgames.fun never serves (./scan.mjs REFUSED_TYPES: programs, installers,
//                            archives other than .zip), a path xgames.fun refuses (treePathProblem), and the players'
//                            data xcore writes (a .sql file, such as a db export; a data export's JSON).
// Added, in the upload only: foundation.lock.json and adaptation-plan.json when the game has none (xgames.fun keeps
// them with every version; a game made in the kit does not need them on disk). They are made from gf-three.json and
// spec.json, and the lock is the same for every kit publish, so each update of a game keeps it.
// Copied, in the upload only: spec.json without the names of the games it was made to look or play like
// (./names.mjs: the person's prompt keeps them on this machine; the published copy says "a reference game").
// A brought game (gamesfun.json → page: ./page.mjs) publishes its `out` folder: the tree is that folder's files, while
// server/, gamesfun.json and the kit's records stay the game folder's.
import { existsSync, realpathSync } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { referenceNames, redactJson } from './names.mjs';
import { refusedType } from './scan.mjs';
import { pageRoots, pageTitle } from './page.mjs';
import { CMD } from '../command.mjs';
import { plural, sha256, sizeText } from '../util.mjs';
import { KIT_RECORD } from '../games.mjs';

export const LEFT_OUT_DIRS = ['evidence', 'node_modules', 'supabase', 'server'];
export const LEFT_OUT_FILES = ['gamesfun.json'];
/** The notes a game folder keeps for the people and agents making it, at its top: never the game. */
export const MAKERS_NOTES = /^(README|NOTES|LAUNCH|FRICTION|CLAUDE|AGENTS|TODO)\.md$/i;

/**
 * Whether publish leaves the file at `rel` (a path in the page's folder, "/"-separated) out of what it puts up, as
 * buildTree does: a hidden file or folder, node_modules anywhere, a .env, and at the top the folders and files that are
 * the maker's (LEFT_OUT_DIRS, LEFT_OUT_FILES, MAKERS_NOTES). What serves the page before it is published (xcore check,
 * xcore dev) leaves the same out, so a page that loads one of them fails there as it would live.
 */
export const leftOutOfPublish = rel => {
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length) return false;
  if (parts.some(p => p.startsWith('.') || p === 'node_modules')) return true;
  if (parts.length > 1 && LEFT_OUT_DIRS.includes(parts[0])) return true;
  return parts.length === 1 && (LEFT_OUT_FILES.includes(parts[0]) || MAKERS_NOTES.test(parts[0]));
};
export const TREE_FORMAT = 'gf-tree-v1';

/** The longest path xgames.fun takes for a published file (../play-policy.mjs treePath). */
export const TREE_PATH_MAX = 512;
// eslint-disable-next-line no-control-regex -- it exists to find control characters
const CONTROL = /[\u0000-\u001f\u007f]/;
/**
 * Why xgames.fun would refuse `rel` as a published file's path (../play-policy.mjs treePath, the rule its begin
 * applies to every path), in words, or null. A refused path refuses the whole publish there, so it is said here.
 */
export function treePathProblem(rel) {
  if (rel.includes('\\'))
    return 'its name has a backslash (\\), which xgames.fun refuses in a published path: rename it';
  if (CONTROL.test(rel))
    return 'its name has a control character (a tab, a line break), which xgames.fun refuses in a published path: rename it';
  if (rel.length > TREE_PATH_MAX)
    return `its path is ${rel.length} characters, and xgames.fun takes at most ${TREE_PATH_MAX}: shorten it`;
  return null;
}

/** A path as it can be printed on one line: a control character as its escape (\t, \n, \u0007). */
const printablePath = rel => rel.replace(new RegExp(CONTROL.source, 'g'), c => JSON.stringify(c).slice(1, -1));

// Every publish sends this lock, a brought game's too. xgames.fun refuses a revision whose lock differs from the game's
// ("A revision must preserve its foundation lock"), so changing it here would refuse the next update of every game
// already published. A truer lock for brought games needs xgames.fun to accept the change.
export const KIT_LOCK = Object.freeze({
  schemaVersion: 1,
  id: 'gf-three',
  version: 'kit',
  adapter: 'gamesfun-kit publish',
});

export { sha256 };
/** Canonical JSON (sorted keys), as xgames.fun hashes trees. */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map(k => JSON.stringify(k) + ':' + canonical(value[k]))
      .join(',') +
    '}'
  );
}

const readJson = async file => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
};

/** The names of the games this one was made to look or play like (./names.mjs), from its spec and its loop's ledger. */
export async function referenceNamesOf(dir) {
  const spec = await readJson(path.join(dir, 'spec.json'));
  const state = await readJson(path.join(dir, '.gf-loop', 'state.json'));
  return referenceNames({ spec, ledger: state?.ledger ?? null });
}

/**
 * What a publish uploads, in words, the same in `xcore check` and `xcore publish --check`: "3 files to upload (1 file
 * from the game, plus 2 small records xgames.fun keeps with every version), 1.2 KB" (foundation.lock.json and
 * adaptation-plan.json, which xcore adds). gamesfun.json, server/
 * (sent as one bundle), hidden files and evidence/ are never among them. `files`, `bytes`, `added`: the tree's counts.
 */
export function uploadWords({ files, bytes, added = [] }) {
  const own = files - added.length;
  const extra = added.length
    ? ` (${plural(own, 'file')} from the game, plus ${added.length === 1 ? 'a small record' : `${added.length} small records`} xgames.fun keeps with every version)`
    : '';
  return `${plural(files, 'file')} to upload${extra}, ${sizeText(bytes)}`;
}

/** The two files xgames.fun keeps with every version, made from the game's own records (`names` taken out). */
export async function kitRecords(dir, { names = [] } = {}) {
  const raw = (await readJson(path.join(dir, 'spec.json'))) ?? {};
  const spec = names.length ? redactJson(raw, names) : raw;
  const game = (await readJson(path.join(dir, 'config', 'game.json'))) ?? {};
  const record = (await readJson(path.join(dir, KIT_RECORD))) ?? {};
  const brought = pageRoots(dir).brought;
  // a start that is a page of its own has no spec or config: its multiplayer.json names it; any other folder, its page
  // (its <title>, else its package.json name, else the folder's), as the first publish's printout names it
  const title =
    game.text?.title ?? spec.title ?? (await readJson(path.join(dir, 'multiplayer.json')))?.title ?? pageTitle(dir);
  const plan = {
    brief: String(
      spec.prompt ||
        spec.hook ||
        (brought
          ? `${title}, a web game published to xgames.fun with xcore.`
          : `${title}, made with the xgames.fun kit.`),
    ).slice(0, 2000),
    requirements: [
      spec.hook,
      ...(spec.mechanics ?? []).map(m => `${m.id}: ${m.as ?? ''}`.trim()),
      ...(spec.accept ?? []),
    ]
      .filter(Boolean)
      .slice(0, 40),
    selectionRationale: brought
      ? `Made outside the kit and published as it is (${CMD} adopt: its own page, checked as a page).`
      : `Made with xgames-kit on ${record.kit?.profile ? `${record.kit.runtime}/${record.kit.profile}` : (record.kit?.runtime ?? 'three')} (kit ${record.kit?.version ?? 'unknown'}) and published from it.`,
    missingFeatures: Array.isArray(spec.notInV1) ? spec.notInV1 : [],
  };
  if (!plan.requirements.length) plan.requirements = ['Publish the game as built.'];
  return { lock: KIT_LOCK, plan, title };
}

/**
 * Build the tree for `dir`. → { tree: {schemaVersion, format, files:[{path, sha256, bytes}]}, sources: Map<sha256,
 * {file?, data?}>, bytes, skipped: [path], refused: [{path, why}], added: [path], copied: [path] (sent as a copy
 * without the reference names), names (those names), fingerprint, title }
 * `fingerprint` names exactly these files with these contents (the check gate keys its pass on it), and the server's
 * sources too; `filesFingerprint` names the files that go up alone (what the page is made of).
 */
/** `server/**` (no hidden files, no node_modules) and `gamesfun.json`, as [{path, sha256}] sorted by path; [] when neither exists. */
export async function serverSources(root) {
  const out = [];
  async function walk(abs, rel) {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const relPath = `${rel}/${e.name}`,
        full = path.join(abs, e.name);
      if (e.isDirectory()) await walk(full, relPath);
      else if (e.isFile()) out.push({ path: relPath, sha256: sha256(await readFile(full)) });
    }
  }
  await walk(path.join(root, 'server'), 'server');
  try {
    out.push({ path: 'gamesfun.json', sha256: sha256(await readFile(path.join(root, 'gamesfun.json'))) });
  } catch {}
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function buildTree(dir) {
  const root = path.resolve(dir),
    files = [],
    sources = new Map(),
    skipped = [],
    refused = [],
    copied = [];
  const names = await referenceNamesOf(root);
  const { out, brought, build, overlay } = pageRoots(root);
  if (brought && !existsSync(out))
    refused.push({
      path: path.relative(root, out).split(path.sep).join('/') || '.',
      why: `the folder this game publishes is not there${build ? ` yet: build it (${build}); publish and verify build it first` : ''}`,
    });
  async function walk(abs, rel) {
    const entries = (await readdir(abs, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name,
        full = path.join(abs, e.name);
      if (/^\.env(\..*)?$/i.test(e.name)) {
        refused.push({
          path: relPath,
          why: 'a .env file. Secrets do not belong in a game folder: move it out of the game',
        });
        continue;
      }
      if (e.name.startsWith('.')) {
        skipped.push(relPath + (e.isDirectory() ? '/' : ''));
        continue;
      }
      if (!rel && LEFT_OUT_DIRS.includes(e.name) && e.isDirectory()) {
        skipped.push(relPath + '/');
        continue;
      }
      if (!rel && (LEFT_OUT_FILES.includes(e.name) || MAKERS_NOTES.test(e.name)) && e.isFile()) {
        skipped.push(relPath);
        continue;
      }
      if (e.name === 'node_modules') {
        skipped.push(relPath + '/');
        continue;
      }
      const badPath = treePathProblem(relPath);
      if (badPath) {
        refused.push({ path: printablePath(relPath), why: badPath });
        continue;
      }
      const st = await lstat(full);
      if (st.isSymbolicLink()) {
        refused.push({ path: relPath, why: 'a symbolic link: a published game holds ordinary files only' });
        continue;
      }
      if (st.isDirectory()) {
        await walk(full, relPath);
        continue;
      }
      if (!st.isFile()) {
        refused.push({ path: relPath, why: 'not an ordinary file' });
        continue;
      }
      const type = refusedType(relPath);
      if (type) {
        refused.push({ path: relPath, why: type });
        continue;
      }
      if (/\.sql$/i.test(e.name)) {
        refused.push({
          path: relPath,
          why: `a SQL file, such as a database export (${CMD} db export), which holds players' data: publish never makes one a public file. Move it out of the published files (.gamesfun/exports/ is where db export writes)`,
        });
        continue;
      }
      let data = await readFile(full),
        own = false;
      if (
        /\.json$/i.test(e.name) &&
        /^\s*\{\s*"gamesfun"\s*:\s*"data-export-v\d+"/.test(data.subarray(0, 200).toString('utf8'))
      ) {
        refused.push({
          path: relPath,
          why: `a players' data export (${CMD} data export): publish never makes one a public file. Move it out of the published files (.gamesfun/exports/ is where data export writes)`,
        });
        continue;
      }
      // the spec goes up as a copy without the reference games' names (the file on disk keeps the person's words)
      if (relPath === 'spec.json' && names.length) {
        try {
          const red = Buffer.from(JSON.stringify(redactJson(JSON.parse(data.toString('utf8')), names), null, 2) + '\n');
          if (!red.equals(data)) {
            data = red;
            own = true;
            copied.push(relPath);
          }
        } catch {
          /* not JSON: scanned as it is */
        }
      }
      const sha = sha256(data);
      files.push({ path: relPath, sha256: sha, bytes: data.length });
      if (!sources.has(sha)) sources.set(sha, own ? { data } : { file: full });
    }
  }
  // the folders published are the game's own: one that is (or sits under) a link to elsewhere is refused, as a link
  // inside them is (gamesfun.json can name only a path inside the game, and a link would take what it points at)
  const outside = folder => {
    if (!existsSync(folder)) return false;
    const real = realpathSync(folder);
    const home = realpathSync(root);
    if (real === home || real.startsWith(home + path.sep)) return false;
    refused.push({
      path: path.relative(root, folder).split(path.sep).join('/') || '.',
      why: 'a symbolic link to a folder outside the game: publish only what the game folder holds (copy it in, or build into it)',
    });
    return true;
  };
  const outOut = outside(out);
  const overlayOut = overlay ? outside(overlay) : false;
  if (existsSync(out) && !outOut) await walk(out, '');
  if (overlay && existsSync(overlay) && !overlayOut) {
    // a file in both is the overlay's (what xcore keeps there is the one to publish)
    const before = files.length;
    await walk(overlay, '');
    const laid = new Set(files.slice(before).map(f => f.path));
    for (let i = before - 1; i >= 0; i--) if (laid.has(files[i].path)) files.splice(i, 1);
  }
  const added = [],
    { lock, plan, title } = await kitRecords(root, { names });
  for (const [name, value] of [
    ['foundation.lock.json', lock],
    ['adaptation-plan.json', plan],
  ]) {
    if (files.some(f => f.path === name)) continue;
    const data = Buffer.from(JSON.stringify(value, null, 2) + '\n'),
      sha = sha256(data);
    files.push({ path: name, sha256: sha, bytes: data.length });
    if (!sources.has(sha)) sources.set(sha, { data });
    added.push(name);
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const tree = { schemaVersion: 1, format: TREE_FORMAT, files };
  // The server's sources are not published files, but they are checked: a change to server/ or gamesfun.json must make
  // the check gate run verify again. A game without either keeps the fingerprint it always had.
  const server = await serverSources(root);
  const fingerprint = server.length ? sha256(canonical({ files, server })) : sha256(canonical(files));
  return {
    tree,
    sources,
    bytes: files.reduce((n, f) => n + f.bytes, 0),
    skipped,
    refused,
    added,
    copied,
    names,
    fingerprint,
    filesFingerprint: sha256(canonical(files)),
    title,
  };
}

/** A file's bytes for upload: from disk, or the made-up records. */
export async function sourceBytes(source) {
  return source.data ?? readFile(source.file);
}
