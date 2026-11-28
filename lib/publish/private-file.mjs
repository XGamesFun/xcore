// Files xcore writes that are not the public's: a game's private project file (`xcore files get`), its players' data
// (`xcore data export`, `xcore db export`). Each is written where publish never takes it, readable by this user only,
// and never over a file that is there unless the person asked (--force). A path among the game's published files is
// refused: the next `xcore publish` would put it up as a public page file.
import { existsSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pageRoots } from './page.mjs';
import { leftOutOfPublish } from './tree.mjs';

/**
 * The path `file` has among the files a publish of `dir` puts up ("/"-separated), or null when publish leaves it out
 * (outside the published folder and the folder its build copies, or a hidden, evidence/, node_modules/ or other
 * left-out path).
 */
export function publishedPath(dir, file) {
  const roots = pageRoots(dir);
  const abs = path.resolve(file);
  // the published folder, and the one a build copies into it as it is (its files go up after the build)
  for (const root of new Set([roots.out, roots.static, roots.overlay].filter(Boolean))) {
    const rel = path.relative(root, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const posix = rel.split(path.sep).join('/');
    if (!leftOutOfPublish(posix)) return posix;
  }
  return null;
}

/**
 * Whether `file` may be written for the game in `dir`, said before anything is fetched: refused (in words, with
 * nothing written) for a path among the game's published files (code 'published-path') or a file that is there already
 * without `force` (code 'exists'). `what`: the file in words ("this project file", "your players' data"); `flag`: the
 * option that names another place. → the absolute path
 */
export function privateTarget(file, { dir, force = false, what = 'the file', flag = '--out <file>' }) {
  const abs = path.resolve(file);
  const published = publishedPath(dir, abs);
  if (published)
    throw Object.assign(
      new Error(
        `${abs} is among the game's published files (${published}), so the next publish would put ${what} up as a public page file. Leave out ${flag.split(' ')[0]} (the default place is under .gamesfun/, never published), or name a file outside the game's folder. Nothing was written.`,
      ),
      { code: 'published-path' },
    );
  if (existsSync(abs) && !force)
    throw Object.assign(
      new Error(`${abs} is there already: --force writes over it, or ${flag} names another file. Nothing was written.`),
      { code: 'exists' },
    );
  return abs;
}

/** Write `data` to `file` (privateTarget's rules), mode 0600 whether the file is new or not. → the absolute path */
export async function writePrivate(file, data, options) {
  const abs = privateTarget(file, options);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data, { mode: 0o600 });
  // a file that was there keeps its own mode through writeFile: made this user's only
  await chmod(abs, 0o600).catch(() => {});
  return abs;
}
