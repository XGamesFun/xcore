// Which folder a command means: the one named, else the folder it runs in. A game here is any folder this package can
// check and publish: one with index.html at its root, or one `xcore adopt` recorded (gamesfun.json → page).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CMD } from './command.mjs';

const readJson = file => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** A folder this package can work on: index.html at its root, or gamesfun.json → page. */
export const isPageFolder = dir =>
  existsSync(path.join(dir, 'index.html')) || !!readJson(path.join(dir, 'gamesfun.json'))?.page;

/** The game's folder: `arg` (a path), else the folder it runs in. Throws with what to do when it is neither. */
export async function resolveGame(arg, { cwd = process.cwd() } = {}) {
  const dir = path.resolve(cwd, arg ?? '.');
  if (!existsSync(dir)) throw new Error(`${arg}: no such folder.`);
  if (!isPageFolder(dir))
    throw new Error(
      `${arg ?? 'This folder'}: not a game yet (no index.html at its root, and no gamesfun.json → page). Bring one with: ${CMD} adopt ${arg ?? '.'}`,
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
