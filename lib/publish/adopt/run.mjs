// The adopt itself: read the shape, build, write gamesfun.json → page, and gather the report.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { BACKEND_FILE, backendOrigins } from '../scan.mjs';
import { ownOrigins } from '../client.mjs';
import { buildFailure, checkPage, CONFIG_FILE, pageFile, pageRoots, readPage, runBuild, writePage } from '../page.mjs';
import { preflight } from '../index.mjs';
import { CMD } from '../../command.mjs';
import { madeByKit, shown } from '../../games.mjs';
import { readJson } from '../../util.mjs';
import { detectShape, guessOut, installCommand, packagesInstalled } from './shape.mjs';
import { godotExportFix, godotWebPreset } from './engines.mjs';
import { pathRouter, scanPage, useCustom } from './page-scan.mjs';

/**
 * Adopt a folder: gamesfun.json → page is written unless it is refused. Options: build (a command), out, static
 * (folders), noBuild (read what is there, do not run the build), onLine (the build's output). → the report:
 * {dir, shape, page, wrote, built: {ran, code, seconds, tail} | null, refused: [{what, fix}], fix: [...], warn: [...],
 * origins: {declared, found}, files, bytes, ok}
 */
/** The hash-routing fix for a router adopt found (pathRouter's `how`); docs/HOSTING.md, "Routing by path", has all. */
function hashFix(how = '') {
  const own = /vue/i.test(how)
    ? 'createWebHashHistory()'
    : /nuxt/i.test(how)
      ? 'router: { options: { hashMode: true } } in nuxt.config'
      : /react router/i.test(how)
        ? 'createHashRouter or <HashRouter>'
        : /angular/i.test(how)
          ? 'withHashLocation() in provideRouter'
          : null;
  return `Use hash routing${own ? `: ${own}` : ''}. See docs/HOSTING.md, "Routing by path"`;
}

export async function adopt(
  dir,
  { build = null, out = null, static: stat = null, noBuild = false, onLine = () => {}, env = process.env } = {},
) {
  const root = path.resolve(dir);
  const report = {
    dir: root,
    shape: null,
    page: null,
    wrote: false,
    built: null,
    refused: [],
    fix: [],
    warn: [],
    made: [], // files adopt wrote in the project besides its record (a Godot Web preset)
    origins: { declared: [], found: [] },
    files: 0,
    bytes: 0,
    ok: false,
  };
  if (!existsSync(root)) {
    report.refused.push({ what: `${dir}: no such folder`, fix: 'Give the folder of your game' });
    return report;
  }
  if (madeByKit(root)) {
    report.refused.push({
      what: 'this is already a kit game (gf-three.json)',
      fix: `It needs no adopting: the kit's verify and publish work on it as it is`,
    });
    return report;
  }
  if (readJson(path.join(root, 'base.json'))?.schema === 'gf-base-release/1') {
    report.refused.push({
      what: "this is a copy of one of the kit's starts (base.json)",
      fix: "It needs no adopting: change it by its EDITING.md, then the kit's verify",
    });
    return report;
  }

  // adopting again: what the last adopt recorded counts as given, unless this run gives its own
  let saved;
  try {
    saved = readPage(root);
  } catch (e) {
    // a gamesfun.json that is not valid JSON is the person's to fix (it may hold more than the page record): refused
    // here, before a build runs
    if (e.code === 'not-json') throw e;
    saved = null; // a record that does not read is written again from what is found
  }
  if (saved && !build && !out && !stat) {
    build = saved.build ?? null;
    out = saved.out;
    stat = saved.build || saved.static !== saved.out ? (saved.static ?? null) : null;
    report.fromRecord = true;
  } else if (saved) {
    // a flag changes its own part of the record; the rest stays as recorded (a custom build kept when only --static
    // is given; the folder loot add chose kept when only --out is). A new --build makes its own output folder.
    report.kept = [];
    if (!build && saved.build) {
      build = saved.build;
      report.kept.push(`build (${saved.build})`);
    }
    if (!out && saved.out && !(build && build !== saved.build)) {
      out = saved.out;
      report.kept.push(`out (${saved.out})`);
    }
    if (!stat && saved.static && (saved.build || saved.static !== saved.out)) {
      stat = saved.static;
      report.kept.push(`static (${saved.static})`);
    }
  }
  const shape = detectShape(root);
  report.shape = {
    kind: shape.kind,
    framework: shape.framework,
    ...(shape.server ? { server: shape.server } : {}),
    ...(shape.engine ? { engine: shape.engine } : {}),
    ...(shape.exported ? { exported: shape.exported } : {}),
  };
  const given = build || out;
  if (!given && (shape.kind === 'server' || shape.kind === 'none')) {
    // a Godot project with no Web export yet: its preset written for xgames.fun (single-threaded, into build/web/)
    const preset = shape.engine === 'Godot' ? await godotWebPreset(root) : null;
    if (preset?.wrote) report.made.push('export_presets.cfg (a Web preset)', 'build/.gdignore');
    report.refused.push({ what: shape.why, fix: preset ? godotExportFix(preset) : shape.fix });
    return report;
  }
  // what is given wins; an unknown build's output is found after it runs; a folder with no build is its own static folder
  const page = { build: build ?? shape.build, out: out ?? shape.out, static: stat ?? null };
  if (page.build && !stat) page.static = shape.static ?? null;
  if (!page.build && !page.out) page.out = '.';
  let buildStarted = null;
  if (
    shape.kind === 'build' &&
    shape.base !== undefined &&
    shape.base !== null &&
    !['./', '', '.'].includes(shape.base)
  )
    report.fix.push({
      what: `vite.config sets base: '${shape.base}'`,
      fix: `Use base: './': the game is served under a folder in xgames.fun Studio's preview and under ${CMD} dev, so paths from the root break there`,
    });

  if (page.build && !noBuild) {
    if (
      existsSync(path.join(root, 'package.json')) &&
      !packagesInstalled(root) &&
      /^(npm|pnpm|yarn|bun)\b/.test(page.build)
    ) {
      report.refused.push({
        what: 'its packages are not installed (no node_modules)',
        setup: true,
        fix: `Install them first (${installCommand(root)}), then adopt again`,
      });
      return report;
    }
    buildStarted = Date.now();
    report.built = await runBuild(root, { build: page.build, onLine, env });
    if (report.built.code !== 0) {
      report.refused.push({
        what: `the build (${page.build}) failed with exit code ${report.built.code}`,
        fix: `Make it pass on its own first: ${page.build}${buildFailure(report.built) ? ` (it said: ${buildFailure(report.built)})` : ''}`,
      });
      return report;
    }
  }
  if (!page.out) page.out = guessOut(root, buildStarted);
  if (!page.out) {
    report.refused.push({
      what: `the build ran but no folder of its output has an index.html (looked in dist/, build/, out/, public/ …)`,
      fix: 'Say where it writes: --out <dir> (--out . when the build writes index.html into the project folder itself)',
    });
    return report;
  }
  if (!existsSync(path.join(root, ...page.out.split('/'), 'index.html'))) {
    report.refused.push(
      noBuild && page.build
        ? {
            what: `${page.out}/index.html is not there yet`,
            fix: `Build it (${page.build}), or adopt without --no-build`,
          }
        : {
            what: `no index.html in ${page.out === '.' ? 'the folder' : `${page.out}/`}${page.build ? ' after the build' : ''}: nothing static to serve`,
            fix:
              shape.kind === 'build'
                ? 'A hosted game is static files: check that the build makes a static site (not a server), or say where it writes with --out <dir>'
                : 'Point adopt at the folder with index.html (--out <dir>)',
          },
    );
    // a Godot project named with the folder its export goes to, before the first export: its preset, and the command
    if (!page.build && existsSync(path.join(root, 'project.godot'))) {
      const preset = await godotWebPreset(root);
      if (preset.wrote) report.made.push('export_presets.cfg (a Web preset)', 'build/.gdignore');
      report.refused[report.refused.length - 1].fix = godotExportFix(preset);
    }
    return report;
  }
  try {
    report.page = checkPage({
      build: page.build ?? undefined,
      out: page.out,
      ...(page.static ? { static: page.static } : {}),
      // the name the person gave the game: kept when adopt runs again
      ...(saved?.title ? { title: saved.title } : {}),
    });
  } catch (e) {
    report.refused.push({ what: e.message, fix: "Give folders inside the game's folder" });
    return report;
  }
  if (page.build && !page.static)
    report.warn.push({
      what: 'xcore does not know which folder this build copies as it is (its public folder)',
      fix: `Say it with --static <dir> before \`${CMD} loot add\` or \`${CMD} backend use\`: the files they add (backend.json, xsolana.json, gf/loot/) go there so every build carries them`,
    });

  report.page = await writePage(root, report.page);
  report.wrote = true;
  const roots = pageRoots(root);
  const backendFile = pageFile(roots, BACKEND_FILE);
  // (a backend.json that is not valid JSON counts for nothing here, and is named below with what publish refuses)
  const declared = backendOrigins(readJson(backendFile), { own: ownOrigins() }).origins;
  report.origins.declared = declared;
  const hasServer = existsSync(path.join(root, 'server')) || !!readJson(path.join(root, CONFIG_FILE))?.server;
  report.hasServer = hasServer;
  const scanned = await scanPage(roots.out, {
    backend: declared,
    prefix: report.page.out,
    hasServer,
    game: shown(root),
    framework: shape.framework,
    source: roots.build ? root : null,
  });
  report.files = scanned.files;
  report.bytes = scanned.bytes;
  report.fix.push(...scanned.fix);
  report.warn.push(...scanned.warn);
  const program = [
    [
      'a Python program',
      ['run.py', 'app.py', 'server.py', 'main.py', 'manage.py', 'requirements.txt', 'pyproject.toml'],
    ],
    ['a Go program', ['go.mod']],
    ['a Ruby program', ['Gemfile']],
    ['a Rust program', ['Cargo.toml']],
    ['a PHP program', ['composer.json']],
  ].find(([, files]) => files.some(f => existsSync(path.join(root, f))));
  const apiFix = report.fix.find(f => /calls api\/ on its own origin/.test(f.what));
  if (apiFix && program)
    apiFix.what += `; the folder has ${program[0]} (${program[1].find(f => existsSync(path.join(root, f)))}), which xgames.fun does not run`;
  const router = pathRouter(root, report.page.out);
  if (router)
    report.warn.push({
      what: `${router.where} routes by path (${router.how}): a reload of /level/2 answers "not found" once hosted, and under a folder no route matches`,
      fix: router.fix ?? hashFix(router.how),
    });
  // the engine's export alone: it publishes as it is, but what xcore adds (sign-in, a database) goes into the project,
  // and an edit here is gone at the next export
  if (shape.exported)
    report.warn.push({
      what: `this is a ${shape.exported} web export (the files ${shape.exported} writes), not the ${shape.exported} project`,
      fix:
        shape.exported === 'Godot'
          ? `It publishes as it is. For sign-in and the rest xcore adds (${CMD} add signin), run them in the Godot project's folder (the one with project.godot): there they go into the project (an autoload), and the next export carries them; an edit to this index.html is gone at the next export. Adopting the project folder instead publishes its export from there`
          : `It publishes as it is. For sign-in and the rest xcore adds (${CMD} add signin), run them in the Unity project's folder (the one with Assets/ and ProjectSettings/), so the next build carries them; an edit to this index.html is gone at the next build. Adopting the project folder instead publishes its build from there`,
    });
  if (report.page.out === '.' && existsSync(path.join(root, 'package.json')))
    report.warn.push({
      what: 'the published folder is the whole project: its source, package.json, README and every other file go up',
      fix: 'Fine if they may be public. Otherwise build the page into its own folder (dist/) and adopt with --out dist, or start private names with a dot',
    });
  if (shape.server) {
    const named = `${shape.server.framework}${shape.server.start ? `, \`${shape.server.start}\`` : ''}`;
    report.warn.push(
      hasServer
        ? {
            what: `its Node server (${named}) is not published; its server/ is, and xgames.fun runs that at /api/*`,
            fix: `Fine if server/ does its work (try it with ${CMD} dev). If the page still needs the Node server, host it yourself and declare it: ${useCustom(shown(root))} --url https://<your server>`,
          }
        : {
            what: `its server (${named}) is not published: xgames.fun hosts ${report.page.out}/ only`,
            fix: `Move its work into server/ (docs/SERVER.md; ${CMD} add multiplayer and add database start rooms and a database), or host it yourself and declare it: ${useCustom(shown(root))} --url https://<your server>. See docs/HOSTING.md, "A game with its own Node server"`,
          },
    );
  }
  report.origins.found = scanned.origins;
  // publish's own refusals, on exactly what would go up: no index.html, .env files, links, the host's own paths,
  // secrets, backend.json, server/
  const pre = await preflight(root);
  // (each problem says its own fix: "…: move it out of the game")
  for (const p of pre.problems) report.fix.push({ what: p, fix: 'Publish stops until this is fixed' });
  if (pre.secrets)
    report.fix.push({
      what: pre.secrets.replace(/^Nothing was published: /, ''),
      fix: 'Move the key to your backend or server/ (a page may only hold public keys). If the file was ever shared, committed or published, revoke the key and make a new one',
    });
  if (pre.names) report.fix.push({ what: pre.names, fix: 'Take the name out' });
  report.ok = !report.refused.length && !report.fix.length;
  return report;
}
