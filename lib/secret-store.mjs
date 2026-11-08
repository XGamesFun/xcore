// Where the kit keeps a person's own sign-in tokens (a backend provider's access token, a generated database
// password): never in a game folder, never in this checkout, never in a log. One small store, three systems:
//
//   macOS    the login keychain, through Apple's `security` tool in its interactive mode (`security -i`), so the
//            secret travels on stdin and never in a process's arguments
//   Linux    the Secret Service (GNOME Keyring, KWallet) through `secret-tool` when it is installed and a session bus
//            is running; else a file (below)
//   Windows  a file whose content is encrypted for this Windows user with DPAPI (PowerShell's ConvertFrom-SecureString,
//            the same protection Credential Manager uses); the plain text goes through stdin
//   anywhere a 0600 JSON file under the user's config folder (`configDir()`); folders 0700. On Windows the mode bits
//            are not enforced; the user profile's own permissions protect it
//
// GAMESFUN_SECRET_STORE=file forces the file (tests, a machine whose keychain prompts get in the way);
// GAMESFUN_CONFIG_DIR moves the config folder (tests). Names are [a-z0-9-], at most 64 characters.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { userConfigDir } from './config-dir.mjs';
import { findProgram } from './browser.mjs';

const SERVICE = 'gamesfun-kit';
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The user's config folder for the kit, per system. */
export function configDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  return userConfigDir({ platform, env, home });
}

function checkName(name) {
  if (typeof name !== 'string' || !NAME.test(name)) throw new Error(`bad secret name ${JSON.stringify(name)}`);
}

const run = (cmd, args, input) => spawnSync(cmd, args, { input, encoding: 'utf8', windowsHide: true, timeout: 20000 });

// ---------------------------------------------------------------- the file store (and Windows' DPAPI file)
function secretsDir(env) {
  const dir = path.join(configDir({ env }), 'secrets');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {}
  return dir;
}
const fileOf = (name, ext, env) => path.join(secretsDir(env), `${name}.${ext}`);

function writePrivate(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {}
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, text, { mode: 0o600 });
    rmSync(tmp, { force: true });
  } // Windows: EPERM/EBUSY
}

const fileStore = {
  kind: 'file',
  where: env => path.join(configDir({ env }), 'secrets'),
  get(name, env) {
    try {
      return readFileSync(fileOf(name, 'secret', env), 'utf8');
    } catch {
      return null;
    }
  },
  set(name, value, env) {
    writePrivate(fileOf(name, 'secret', env), value);
  },
  delete(name, env) {
    const f = fileOf(name, 'secret', env);
    const had = existsSync(f);
    rmSync(f, { force: true });
    return had;
  },
};

// ---------------------------------------------------------------- Windows: DPAPI for this user
const PS_PROTECT =
  '$t=[Console]::In.ReadToEnd(); ConvertTo-SecureString -String $t -AsPlainText -Force | ConvertFrom-SecureString';
const PS_UNPROTECT =
  '$s=ConvertTo-SecureString -String ([Console]::In.ReadToEnd().Trim()); $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }';
const dpapiStore = ps => ({
  kind: 'windows-dpapi',
  where: env => path.join(configDir({ env }), 'secrets'),
  get(name, env) {
    let blob;
    try {
      blob = readFileSync(fileOf(name, 'dpapi', env), 'utf8');
    } catch {
      return null;
    }
    const r = run(ps, ['-NoProfile', '-NonInteractive', '-Command', PS_UNPROTECT], blob);
    if (r.status !== 0) throw new Error('Windows could not decrypt the saved sign-in (DPAPI). Sign in again.');
    return r.stdout;
  },
  set(name, value, env) {
    const r = run(ps, ['-NoProfile', '-NonInteractive', '-Command', PS_PROTECT], value);
    if (r.status !== 0 || !r.stdout.trim()) throw new Error('Windows could not encrypt the sign-in (DPAPI).');
    writePrivate(fileOf(name, 'dpapi', env), r.stdout.trim());
  },
  delete(name, env) {
    const f = fileOf(name, 'dpapi', env);
    const had = existsSync(f);
    rmSync(f, { force: true });
    return had;
  },
});

// ---------------------------------------------------------------- macOS: the login keychain
// Inside `security -i` a line is split like a shell's words; the value is base64 (no quotes or spaces to escape).
const macStore = sec => ({
  kind: 'macos-keychain',
  where: () => 'the login keychain (service gamesfun-kit)',
  get(name) {
    const r = run(sec, ['find-generic-password', '-s', SERVICE, '-a', name, '-w']);
    if (r.status !== 0) return null;
    return Buffer.from(r.stdout.trim(), 'base64').toString('utf8');
  },
  set(name, value) {
    const b64 = Buffer.from(value, 'utf8').toString('base64');
    const r = run(
      sec,
      ['-i'],
      `add-generic-password -U -s ${SERVICE} -a ${name} -l "xgames.fun kit ${name}" -w ${b64}\n`,
    );
    if (r.status !== 0 || /error/i.test(r.stderr ?? ''))
      throw new Error(`the keychain refused the sign-in: ${(r.stderr || '').trim().slice(0, 200)}`);
  },
  delete(name) {
    return run(sec, ['delete-generic-password', '-s', SERVICE, '-a', name]).status === 0;
  },
});

// ---------------------------------------------------------------- Linux: the Secret Service
const libsecretStore = tool => ({
  kind: 'libsecret',
  where: () => 'the Secret Service keyring (service gamesfun-kit)',
  get(name) {
    const r = run(tool, ['lookup', 'service', SERVICE, 'account', name]);
    return r.status === 0 && r.stdout ? r.stdout : null;
  },
  set(name, value) {
    const r = run(tool, ['store', `--label=xgames.fun kit ${name}`, 'service', SERVICE, 'account', name], value);
    if (r.status !== 0) throw new Error(`the keyring refused the sign-in: ${(r.stderr || '').trim().slice(0, 200)}`);
  },
  delete(name) {
    return run(tool, ['clear', 'service', SERVICE, 'account', name]).status === 0;
  },
});

/** The store this machine uses. `{ kind, where }` says it in words. */
export function pickStore({ platform = process.platform, env = process.env } = {}) {
  if (env.GAMESFUN_SECRET_STORE === 'file') return fileStore;
  if (platform === 'darwin') {
    const s = findProgram(['security'], { platform, env }) ?? '/usr/bin/security';
    if (existsSync(s)) return macStore(s);
  }
  if (platform === 'win32') {
    const ps = findProgram(['powershell.exe', 'pwsh.exe'], { platform, env });
    if (ps) return dpapiStore(ps);
  }
  if (platform === 'linux' && env.DBUS_SESSION_BUS_ADDRESS) {
    const t = findProgram(['secret-tool'], { platform, env });
    if (t) return libsecretStore(t);
  }
  return fileStore;
}

/** → { kind, where } for messages ("saved in the login keychain"). */
export function storeInfo(opts = {}) {
  const s = pickStore(opts);
  return { kind: s.kind, where: s.where(opts.env ?? process.env) };
}

/** The saved value, or null. A keyring that fails falls back to the file a previous save may have used. */
export function getSecret(name, { env = process.env, platform = process.platform } = {}) {
  checkName(name);
  const s = pickStore({ env, platform });
  let v = null;
  try {
    v = s.get(name, env);
  } catch (e) {
    if (s === fileStore) throw e;
  }
  if (v == null && s !== fileStore) v = fileStore.get(name, env);
  return v;
}

/** Save it. A keyring that refuses (a locked or missing Secret Service) falls back to the 0600 file. → { kind, where } */
export function setSecret(name, value, { env = process.env, platform = process.platform } = {}) {
  checkName(name);
  if (typeof value !== 'string' || !value) throw new Error('nothing to save');
  const s = pickStore({ env, platform });
  try {
    s.set(name, value, env);
    if (s !== fileStore) fileStore.delete(name, env);
    return { kind: s.kind, where: s.where(env) };
  } catch (e) {
    if (s === fileStore || s.kind === 'windows-dpapi') throw e;
    fileStore.set(name, value, env);
    return { kind: 'file', where: fileStore.where(env), fellBack: e.message };
  }
}

/** Remove it from every place it may be. → whether anything was there. */
export function deleteSecret(name, { env = process.env, platform = process.platform } = {}) {
  checkName(name);
  const s = pickStore({ env, platform });
  let had = false;
  try {
    had = !!s.delete(name, env);
  } catch {}
  if (s !== fileStore) had = fileStore.delete(name, env) || had;
  return had;
}
