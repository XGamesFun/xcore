#!/usr/bin/env node
// The Godot and Unity glue, checked by the engines themselves: `xcore add signin` writes it into a new Godot project
// and a new Unity project, then Godot parses both .gd files (--check-only) and the .NET compiler builds GamesFun.cs
// against scripts/unity-stub/UnityEngine.cs, once as a WebGL build and once as the editor. CI runs it (ci.yml, job
// engines); on your machine:
//   node scripts/check-engines.mjs --godot <Godot 4 binary> --dotnet <dotnet>
// Either one alone checks that engine only. It exits 1 when an engine refuses the glue.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { godot: { type: 'string' }, dotnet: { type: 'string' } } });
if (!values.godot && !values.dotnet) {
  console.error('usage: node scripts/check-engines.mjs --godot <Godot 4 binary> --dotnet <dotnet>');
  process.exit(2);
}

const work = mkdtempSync(path.join(os.tmpdir(), 'xcore-engines-'));
// xcore runs here as on a new machine: no sign-in, no Studio but xgames.fun, nothing written outside `work`
const env = { ...process.env, GAMESFUN_CONFIG_DIR: path.join(work, 'config'), GAMESFUN_KIT: '' };
delete env.GAMESFUN_STUDIO;
const failed = [];

function run(what, cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env, timeout: 300_000, ...opts });
  const said = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  if (r.status !== 0 || r.error) {
    failed.push(what);
    console.error(`✖ ${what}${r.error ? ` (${r.error.message})` : ` (exit ${r.status})`}\n${said}\n`);
    return false;
  }
  console.log(`✔ ${what}`);
  return true;
}

/** A new project in work/<name> made of `files`, with the glue `xcore add signin` writes into it. → its folder, or null */
function project(name, files) {
  const dir = path.join(work, name);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return run(`xcore add signin (${name})`, process.execPath, [
    path.join(ROOT, 'bin', 'xcore.mjs'),
    'add',
    'signin',
    dir,
  ])
    ? dir
    : null;
}

try {
  if (values.godot) {
    const dir = project('godot', { 'project.godot': 'config_version=5\n\n[application]\n\nconfig/name="engines"\n' });
    if (dir)
      for (const file of ['addons/gamesfun/gamesfun.gd', 'addons/gamesfun/gamesfun_peer.gd'])
        run(`Godot parses ${file}`, values.godot, ['--headless', '--path', dir, '--check-only', '--script', file], {
          // Godot keeps its own settings under HOME: here, inside `work`
          env: { ...env, HOME: path.join(work, 'home'), XDG_DATA_HOME: path.join(work, 'home', 'data') },
        });
  }

  if (values.dotnet) {
    const dir = project('unity', {
      'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 6000.0.0f1\n',
      'Assets/.keep': '',
    });
    if (dir) {
      const stub = readFileSync(path.join(ROOT, 'scripts', 'unity-stub', 'UnityEngine.cs'), 'utf8');
      // Unity's scripting profile is .NET Standard 2.1, and its compiler takes C# 9 at most
      for (const [build, defines] of [
        ['WebGL build', 'UNITY_WEBGL'],
        ['editor', 'UNITY_EDITOR'],
      ]) {
        const out = path.join(work, `cs-${defines}`);
        mkdirSync(out, { recursive: true });
        writeFileSync(path.join(out, 'UnityEngine.cs'), stub);
        writeFileSync(
          path.join(out, 'GamesFun.csproj'),
          `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>netstandard2.1</TargetFramework>
    <LangVersion>9.0</LangVersion>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <DefineConstants>${defines}</DefineConstants>
    <TreatWarningsAsErrors>false</TreatWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="UnityEngine.cs" />
    <Compile Include="${path.join(dir, 'Assets', 'Plugins', 'GamesFun', 'GamesFun.cs')}" />
  </ItemGroup>
</Project>
`,
        );
        run(`GamesFun.cs compiles (${build})`, values.dotnet, ['build', '--nologo', '-v', 'quiet', out], {
          env: { ...env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' },
        });
      }
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failed.length) {
  console.error(`${failed.length} engine check${failed.length === 1 ? '' : 's'} failed: ${failed.join('; ')}`);
  process.exit(1);
}
