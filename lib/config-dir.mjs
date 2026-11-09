// The folder that keeps a person's xgames.fun sign-in on this machine (and an installed kit's state, under state/): the
// same folder for this package and the kit, so signing in with either is signing in with both.
import os from 'node:os';
import path from 'node:path';

/** %APPDATA%\\gamesfun on Windows, ~/Library/Application Support/gamesfun on macOS, $XDG_CONFIG_HOME/gamesfun or
 *  ~/.config/gamesfun on Linux; GAMESFUN_CONFIG_DIR moves it. */
export function userConfigDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (env.GAMESFUN_CONFIG_DIR) return path.resolve(env.GAMESFUN_CONFIG_DIR);
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'gamesfun');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'gamesfun');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'gamesfun');
}
