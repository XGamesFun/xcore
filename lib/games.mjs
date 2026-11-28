// Which folder a command means: the one named, else the folder it runs in. A game here is any folder this package can
// check and publish: one with index.html at its root, or one `xcore adopt` recorded (gamesfun.json → page).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CMD, typedPath } from './command.mjs';
import { readOwnJson } from './util.mjs';

/** The kit's record of a game it made. */
export const KIT_RECORD = 'gf-three.json';
/** A game the kit made (its record, gf-three.json): its check is the kit's six gates, never this package's page check. */
export const madeByKit = dir => existsSync(path.join(dir, KIT_RECORD));
/**
 * A folder this package can work on: index.html at its root, or gamesfun.json → page. Throws, in words that name the
 * file, on a gamesfun.json that is not valid JSON, whatever else the folder has: no command goes on as if it were
 * not there.
 */
export const isPageFolder = dir => {
  const file = path.join(dir, 'gamesfun.json');
  const page = readOwnJson(file, shown(file))?.page;
  return existsSync(path.join(dir, 'index.html')) || !!page;
};

/** The game's folder: `arg` (a path), else the folder it runs in. Throws with what to do when it is neither. */
export async function resolveGame(arg, { cwd = process.cwd() } = {}) {
  const dir = path.resolve(cwd, arg ?? '.');
  if (!existsSync(dir)) throw Object.assign(new Error(`${arg}: no such folder.`), { code: 'no-folder' });
  if (!isPageFolder(dir))
    throw Object.assign(
      new Error(
        `${arg ?? 'This folder'}: not a game yet (no index.html at its root, and no gamesfun.json → page). Bring one with: ${CMD} adopt ${arg ?? '.'}`,
      ),
      { code: 'not-a-game' },
    );
  return dir;
}

/** A folder in a sentence: its name when it is the folder the command runs in ("." reads as nothing), else shown(). */
export function named(dir, { cwd = process.cwd() } = {}) {
  const s = shown(dir, { cwd });
  return s === '.' ? path.basename(path.resolve(dir)) : s;
}

/** A folder as the person reads it: relative to where they run the command when it is inside, else absolute. */
export function shown(dir, { cwd = process.cwd() } = {}) {
  const rel = path.relative(cwd, dir);
  return !rel ? '.' : rel.startsWith('..') || path.isAbsolute(rel) ? dir : rel;
}

/** A folder as a word in a command to paste: shown(), quoted when the shell needs it ("." for the folder it runs in). */
export const typedDir = (dir, opts) => typedPath(shown(dir, opts));

/**
 * The refusal of a command that needs the folder's game on xgames.fun, when its publish record names none there: one
 * code ('not-published'), and `next`, publish with the folder as the person typed it. `then`: what to do once it is
 * published (", then put its files"); `cwd`: where the person runs the command. → the Error, to throw
 */
export function notPublished(dir, origin, then = '', { cwd = process.cwd() } = {}) {
  const next = `${CMD} publish${shown(dir, { cwd }) === '.' ? '' : ` ${typedDir(dir, { cwd })}`}`;
  return Object.assign(new Error(`this folder's game is not on ${origin} yet: publish it first (${next})${then}`), {
    code: 'not-published',
    next,
  });
}
