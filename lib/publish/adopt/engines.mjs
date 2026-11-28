// Unity and Godot: a project's web export is the page; a Godot project's Web preset, made or fixed.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CMD } from '../../command.mjs';

/** A web export: an index.html beside a Unity build's loader, or a Godot export's .pck. */
const isWebExport = d =>
  existsSync(path.join(d, 'index.html')) &&
  (existsSync(path.join(d, 'index.pck')) ||
    readdirSafe(d).some(n => n.endsWith('.pck')) ||
    readdirSafe(path.join(d, 'Build')).some(n => /\.loader\.js$/.test(n)) ||
    existsSync(path.join(d, 'Build', 'UnityLoader.js')));
/** Which engine's web export `d` is ('Godot' | 'Unity'), from its files, or null. */
export function webExportOf(d) {
  if (!isWebExport(d)) return null;
  return existsSync(path.join(d, 'index.pck')) || readdirSafe(d).some(n => n.endsWith('.pck')) ? 'Godot' : 'Unity';
}
function readdirSafe(d) {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
}

/** A Unity or Godot project (its sources): xgames.fun hosts its web export, so that folder is the page. → a shape, or
 *  null when the folder is no engine's project */
export function engineProject(dir) {
  const unity =
    existsSync(path.join(dir, 'ProjectSettings', 'ProjectVersion.txt')) && existsSync(path.join(dir, 'Assets'));
  const godot = existsSync(path.join(dir, 'project.godot'));
  if (!unity && !godot) return null;
  const tried = [];
  if (godot) {
    // the Web preset's export path (export_presets.cfg), then the usual places
    const presets = (() => {
      try {
        return readFileSync(path.join(dir, 'export_presets.cfg'), 'utf8');
      } catch {
        return '';
      }
    })();
    for (const block of presets.split(/^\[preset\.\d+\]$/m))
      if (/^platform="Web"$/m.test(block)) {
        const p = /^export_path="([^"]*)"$/m.exec(block)?.[1];
        if (p) tried.push(path.posix.dirname(p.replace(/^res:\/\//, '')));
      }
  }
  tried.push(
    ...(unity
      ? ['Builds/WebGL', 'Build/WebGL', 'WebGL', 'Builds/Web', 'Builds', 'Build', 'docs']
      : ['build/web', 'export/web', 'exports/web', 'build', 'export', 'web', 'docs']),
  );
  const out = [...new Set(tried)].find(sub => sub && sub !== '.' && isWebExport(path.join(dir, sub)));
  const name = unity ? 'Unity' : 'Godot';
  if (out) return { kind: 'static', framework: null, build: null, out, static: out, why: null, engine: name };
  return {
    kind: 'none',
    framework: null,
    build: null,
    out: null,
    static: null,
    engine: name,
    why: `a ${name} project with no web export in it: xgames.fun hosts the export (index.html and what it loads), not the project`,
    fix: unity
      ? 'In Unity: File → Build Settings → WebGL, Player Settings → Publishing Settings: Compression Format Disabled (or Decompression Fallback on), then Build into a folder such as Builds/WebGL, and adopt again (or point adopt at it: --out Builds/WebGL)'
      : 'In Godot: Project → Export → Add… → Web, Thread Support off, export to build/web/index.html, and adopt again (or point adopt at it: --out build/web)',
  };
}

/** What to do with a Godot project's Web preset, in words. */
export function godotExportFix(preset) {
  const exportIt = `Export it: godot --headless --path . --export-release "${preset.name}" ${preset.path} (or Project → Export → ${preset.name} in the editor), then ${CMD} adopt again`;
  return preset.wrote
    ? `xcore wrote a Web export preset in export_presets.cfg (Thread Support off, to build/web/index.html, leaving xcore's folders out of the game's package; build/ has a .gdignore). ${exportIt}`
    : `Its Web export preset is there, with nothing exported yet. ${exportIt}${preset.threads ? '. It has Thread Support on: turn it off first (an xgames.fun page is not cross-origin isolated)' : ''}`;
}

/** What a Godot project's Web preset leaves out of the game's package: xcore's and the tools' folders. */
export const GODOT_EXCLUDE = 'build/*, evidence/*, gamesfun/*, server/*, node_modules/*, .work/*';

/**
 * A Web export preset for xgames.fun in a Godot project that has none (export_presets.cfg made or added to): Thread
 * Support off (an xgames.fun page is not cross-origin isolated), exported to build/web/index.html, with xcore's folders
 * left out of the package, and a .gdignore in build/ so the editor never imports the export's own files.
 * → {wrote, name, path (its export path from the project), threads}; with a Web preset already, that one, unchanged
 */
export async function godotWebPreset(dir) {
  const file = path.join(dir, 'export_presets.cfg');
  const had = existsSync(file) ? await readFile(file, 'utf8') : '';
  const web = had.split(/^(?=\[preset\.\d+\]\s*$)/m).find(b => /^platform="Web"\s*$/m.test(b));
  if (web) {
    const p = (/^export_path="([^"]*)"$/m.exec(web)?.[1] ?? '').replace(/^res:\/\//, '');
    if (p) await mkdir(path.join(dir, path.dirname(p)), { recursive: true });
    const name = /^name="([^"]*)"$/m.exec(web)?.[1] ?? 'Web';
    const threads = had.includes(`[${/^\[(preset\.\d+)\]/.exec(web)?.[1]}.options]`)
      ? /variant\/thread_support=true/.test(
          had.split(`[${/^\[(preset\.\d+)\]/.exec(web)[1]}.options]`)[1].split(/^\[/m)[0],
        )
      : false;
    return { wrote: false, name, path: p || 'build/web/index.html', threads };
  }
  const n = Math.max(-1, ...[...had.matchAll(/^\[preset\.(\d+)\]\s*$/gm)].map(m => Number(m[1]))) + 1;
  const preset = `[preset.${n}]

name="Web"
platform="Web"
runnable=true
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter="${GODOT_EXCLUDE}"
export_path="build/web/index.html"
encryption_include_filters=""
encryption_exclude_filters=""
encrypt_pck=false
encrypt_directory=false

[preset.${n}.options]

custom_template/debug=""
custom_template/release=""
variant/extensions_support=false
variant/thread_support=false
vram_texture_compression/for_desktop=true
vram_texture_compression/for_mobile=false
html/export_icon=true
html/custom_html_shell=""
html/head_include=""
html/canvas_resize_policy=2
html/focus_canvas_on_start=false
html/experimental_virtual_keyboard=false
progressive_web_app/enabled=false
`;
  await writeFile(file, had ? `${had.replace(/\s*$/, '')}\n\n${preset}` : preset);
  await mkdir(path.join(dir, 'build', 'web'), { recursive: true });
  if (!existsSync(path.join(dir, 'build', '.gdignore'))) await writeFile(path.join(dir, 'build', '.gdignore'), '');
  return { wrote: true, name: 'Web', path: 'build/web/index.html', threads: false };
}
