#!/usr/bin/env node
// The package as npm would ship it, tried before it is published: `npm pack`, install the .tgz into an empty folder,
// then check that every file a shipped module imports is in the package, and run the installed xcore as a person
// would: --version, --help, `adopt` and `add signin` on a copy of a sample game. Exits 1 when anything fails.
//   node scripts/try-package.mjs [--root <package folder>]
// It prints the tarball's sha1 (npm's shasum); in GitHub Actions it also writes it to the step's outputs as `shasum`.
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { root: { type: 'string' } } });
const root = path.resolve(values.root ?? HERE);
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

/** npm's own CLI script, run with this Node (npm.cmd cannot be spawned without a shell on Windows). */
function npmCli() {
  const cands = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const cli = cands.find(p => p && /npm-cli\.js$/.test(p) && existsSync(p));
  if (!cli) throw new Error('npm was not found beside this Node');
  return cli;
}

const work = mkdtempSync(path.join(os.tmpdir(), 'xcore-package-'));
// the installed xcore runs as on a new machine: no sign-in, no kit, no Studio but xgames.fun
const env = { ...process.env, GAMESFUN_CONFIG_DIR: path.join(work, 'config'), GAMESFUN_KIT: '', NO_COLOR: '1' };
for (const name of ['GAMESFUN_STUDIO', 'ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN'])
  delete env[name];
const failed = [];

function run(what, cmd, args, { cwd = work, check } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout: 300_000, windowsHide: true });
  const why = r.error ? r.error.message : r.status !== 0 ? `exit ${r.status}` : (check?.(r.stdout) ?? null);
  if (why) {
    failed.push(what);
    console.error(`✖ ${what} (${why})\n${`${r.stdout ?? ''}${r.stderr ?? ''}`.trim()}\n`);
    return null;
  }
  console.log(`✔ ${what}`);
  return r.stdout;
}

/**
 * What the installed package's own modules import that it does not carry: esbuild (the package's own dependency)
 * follows every import from the command, each command and the API, as Node would load them, and says which it
 * cannot find. → ["<importer>: <what>"]
 */
async function missingImports(at) {
  const { build } = await import(pathToFileURL(createRequire(path.join(at, 'package.json')).resolve('esbuild')).href);
  const entryPoints = [
    path.join(at, 'bin', 'xcore.mjs'),
    path.join(at, 'lib', 'api.mjs'),
    ...readdirSync(path.join(at, 'commands'))
      .filter(f => f.endsWith('.mjs'))
      .map(f => path.join(at, 'commands', f)),
  ];
  try {
    await build({
      entryPoints,
      bundle: true,
      write: false,
      outdir: path.join(work, 'out'),
      platform: 'node',
      format: 'esm',
      packages: 'external',
      logLevel: 'silent',
    });
    return [];
  } catch (e) {
    if (!e.errors) throw e;
    return e.errors.map(m => `${m.location ? `${path.relative(at, m.location.file)}: ` : ''}${m.text}`);
  }
}

let shasum = null;
try {
  const npm = npmCli();
  const packed = run('npm pack', process.execPath, [npm, 'pack', '--json', '--pack-destination', work], {
    cwd: root,
  });
  if (packed) {
    const [{ filename, shasum: sum, entryCount }] = JSON.parse(packed);
    shasum = sum;
    console.log(`  ${filename}: ${entryCount} files, shasum ${sum}`);
    const app = path.join(work, 'app');
    mkdirSync(app);
    writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'try-xcore', private: true }));
    const installed = run(
      'npm install of the packed .tgz',
      process.execPath,
      [npm, 'install', path.join(work, filename), '--no-audit', '--no-fund', '--prefer-offline'],
      { cwd: app },
    );
    const at = path.join(app, 'node_modules', ...pkg.name.split('/'));
    if (installed !== null) {
      const missing = await missingImports(at);
      if (missing.length) {
        failed.push('imports');
        console.error(`✖ files the package imports but does not carry:\n  ${missing.join('\n  ')}\n`);
      } else console.log('✔ every file the package imports is in it');
      // on Windows npm puts a .cmd beside the link; everywhere else the link is what npx runs
      const bin =
        process.platform === 'win32'
          ? [process.execPath, [path.join(at, 'bin', 'xcore.mjs')]]
          : [path.join(app, 'node_modules', '.bin', 'xcore'), []];
      const xcore = (what, args, opts) => run(`xcore ${what}`, bin[0], [...bin[1], ...args], { cwd: app, ...opts });
      xcore('--version', ['--version'], {
        check: out => (out.trim() === pkg.version ? null : `printed ${JSON.stringify(out.trim())}, not ${pkg.version}`),
      });
      xcore('--help', ['--help'], { check: out => (/\badopt\b/.test(out) ? null : 'no command list') });
      run(
        'the package imports',
        process.execPath,
        ['--input-type=module', '-e', `await import(${JSON.stringify(pkg.name)})`],
        {
          cwd: app,
        },
      );
      const game = path.join(work, 'game');
      cpSync(path.join(HERE, 'tests', 'fixtures', 'byo', 'static'), game, { recursive: true });
      xcore('adopt', ['adopt', game]);
      xcore('add signin', ['add', 'signin', game], {
        check: () => (existsSync(path.join(game, 'gamesfun.js')) ? null : 'no gamesfun.js written'),
      });
    }
  }
} catch (e) {
  failed.push(e.message);
  console.error(`✖ ${e.message}`);
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (shasum && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `shasum=${shasum}\n`);
if (failed.length) {
  console.error(`The package is not ready: ${failed.join('; ')}`);
  process.exit(1);
}
console.log(`${pkg.name}@${pkg.version} installs and runs.`);
