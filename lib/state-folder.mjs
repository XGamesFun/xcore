// <game>/.gamesfun/: xcore's own files for one game (the publish link, the local database and files, the dev
// platform's saves, exports of the players' data). Hidden, so never published; and kept out of git by a .gitignore of
// its own (`*`), written whenever xcore writes into the folder and finds none, so an export of players' data is not
// committed by a `git add .`.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const STATE_FOLDER = '.gamesfun';
export const STATE_GITIGNORE = `# xcore's own files for this game: the publish link, the local database and files, exports of your players' data.
# Never published, and kept out of git. xcore writes this file again whenever it is missing, so deleting it does not
# let anything in: change it instead (it is left as you write it). A line such as !publish.json commits that file.
*
`;

/** <dir>/.gamesfun, made with its .gitignore when either is missing. → the folder */
export async function stateFolder(dir) {
  const folder = path.join(dir, STATE_FOLDER);
  await mkdir(folder, { recursive: true });
  const ignore = path.join(folder, '.gitignore');
  if (!existsSync(ignore)) await writeFile(ignore, STATE_GITIGNORE, { flag: 'wx' }).catch(() => {});
  return folder;
}
