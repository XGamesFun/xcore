// How the person runs this command here, for every line that tells them one to run. `xcore` on npm is someone else's
// package, so a bare `npx xcore` is only ever said where it finds this one (a project or the kit that has it
// installed): run through npx, it is `npx -y @xgamesfun/xcore`; installed globally, `xcore`; in its own checkout,
// `node bin/xcore.mjs`. XCORE_COMMAND says it outright.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = (() => {
  const f = fileURLToPath(import.meta.url);
  try {
    return realpathSync(f);
  } catch {
    return f;
  }
})();
const ROOT = path.resolve(path.dirname(HERE), '..');
const nameAt = file => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')).name;
  } catch {
    return null;
  }
};

/** → the command as the person types it, without the subcommand */
export function commandOf({ root = ROOT, env = process.env, cwd = process.cwd() } = {}) {
  if (env.XCORE_COMMAND) return env.XCORE_COMMAND;
  const p = root.split(path.sep).join('/');
  if (/\/_npx\//.test(p)) return 'npx -y @xgamesfun/xcore';
  // the npm global folder: <prefix>/lib/node_modules on macOS and Linux, %APPDATA%\npm\node_modules on Windows
  if (/\/(lib|npm)\/node_modules\/@xgamesfun\/xcore$/i.test(p)) return 'xcore';
  if (/\/node_modules\//.test(p)) return 'npx xcore';
  // the kit's own copy of this package, inside the kit's checkout: the kit installs it, so npx finds it there
  if (
    nameAt(path.join(root, '..', '..', 'package.json')) === '@xgamesfun/kit' &&
    existsSync(path.join(root, '..', '..', 'node_modules'))
  )
    return 'npx xcore';
  // its own checkout: from inside it, as its README says; from anywhere else, the path to it
  const rel = path.relative(cwd, root);
  if (!rel) return 'node bin/xcore.mjs';
  const bin = path.join(rel.startsWith('..') && rel.split(path.sep).length > 3 ? root : rel, 'bin', 'xcore.mjs');
  return `node ${/\s/.test(bin) ? JSON.stringify(bin) : bin}`;
}

/** The command here, e.g. `npx -y @xgamesfun/xcore`, for words like `${CMD} login`. */
export const CMD = commandOf();

/**
 * A word (a path, an argument) in a command to paste, quoted only when the shell needs it: on Windows in double quotes
 * as it is (cmd and PowerShell take its backslashes as they are), elsewhere in single quotes. → the word as typed
 */
export function typedPath(p, { platform = process.platform } = {}) {
  if (platform === 'win32') return /[\s"'$`&()^%;,]/.test(p) ? `"${p}"` : p;
  return /[^\w@%+=:,./~-]/.test(p) ? `'${p.replace(/'/g, `'\\''`)}'` : p;
}
