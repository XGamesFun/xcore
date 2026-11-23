// The published folder, read as xgames.fun hosts it: everything that does not fit (paths from the root, a router that
// reads the path, other sites' scripts and frames, files over the limits …), each with its fix.
import { existsSync, readdirSync } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_LIMITS, servedTyped, UNTYPED_CODE } from '../hosting.mjs';
import { CMD, typedPath } from '../../command.mjs';
import { configText, readText } from './shape.mjs';
import { overLimit } from '../../util.mjs';

/**
 * A router that reads the path, in the project's own source (not node_modules, not the built output): Vue Router's
 * createWebHistory, React Router's browser router or framework mode, Nuxt pages without hashMode, Angular's router
 * without hash location. → {where, how, fix?} or null (`fix`: when the usual one, a hash router, is not there)
 */
export function pathRouter(root, out) {
  // React Router's framework mode routes by path, with no hash mode, and renders the page for / when it builds
  if (configText(root, 'react-router.config'))
    return {
      where: 'react-router.config',
      how: "React Router's framework mode",
      fix: `Its framework mode has no hash routing, and under a folder React stops with error #418 (the page it built for / does not match), so ${CMD} check fails it and publish saves a private draft; at the game's own link it works. For a game that runs everywhere, use React Router as a library in a Vite app, with createHashRouter, or one page that changes screens itself`,
    };
  // Nuxt routes its pages/ folder by path unless its config turns on hash mode
  const nuxt = configText(root, 'nuxt.config');
  if (
    nuxt &&
    ['pages', 'app/pages', 'src/pages'].some(d => existsSync(path.join(root, d))) &&
    !/\bhashMode\s*:\s*true\b/.test(nuxt)
  )
    return { where: 'nuxt.config', how: 'Nuxt pages, without hashMode' };
  const skip = new Set(['node_modules', '.git', '.svelte-kit', '.next', '.nuxt', '.output', 'evidence', '.gamesfun']);
  const outTop = out && out !== '.' ? out.split('/')[0] : null;
  const rules = [
    [/\bcreateWebHistory\s*\(/, 'Vue Router createWebHistory'],
    [/\bcreateBrowserRouter\s*\(|<BrowserRouter\b|\bcreateBrowserHistory\s*\(/, 'React Router browser routing'],
  ];
  let seen = 0,
    angular = null,
    hashed = false;
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      if (seen > 3000) return null;
      if (skip.has(e.name) || (!rel && e.name === outTop) || e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const hit = walk(path.join(dir, e.name), r);
        if (hit) return hit;
        continue;
      }
      if (!/\.(m?[jt]sx?|vue|svelte)$/.test(e.name)) continue;
      seen++;
      const text = readText(path.join(dir, e.name));
      for (const [re, how] of rules) {
        const m = re.exec(text);
        if (m) return { where: `${r}:${lineAt(text, m.index)}`, how };
      }
      if (/withHashLocation\s*\(|useHash\s*:\s*true/.test(text)) hashed = true;
      const ng = /\bprovideRouter\s*\(|RouterModule\.forRoot\s*\(/.exec(text);
      if (ng && !angular) angular = { where: `${r}:${lineAt(text, ng.index)}`, how: 'Angular router, path location' };
    }
    return null;
  };
  return walk(root, '') ?? (angular && !hashed ? angular : null);
}

/** How each known build makes its paths relative. */
const ROOT_PATH_FIX =
  "Vite: base: './' in vite.config (not with React Router's framework mode: it then loads its routes from assets/assets/ and reloads for ever; it has no relative mode, see the README); Next.js static export with one page: assetPrefix: '.' in next.config (production builds only, so next dev keeps working; with more than one page Next.js has no relative mode: see the README); Astro with one page: build: { assetsPrefix: '.' } in astro.config (base: './' does not do it); Nuxt: ssr: false, app: { cdnURL: './' } and router: { options: { hashMode: true } } in nuxt.config, and in templates :src=\"'x.png'\" for a file in public/ (src=\"./x.png\" is read as an import); Create React App: \"homepage\": \".\" in package.json; Parcel: --public-url ./; hand-written HTML: ./x";

// Origins a bundled library names that a game never calls: XML namespaces, specifications, documentation and error pages.
const NOISE_DOMAINS = [
  'w3.org',
  'whatwg.org',
  'ecma-international.org',
  'ietf.org',
  'schema.org',
  'json-schema.org',
  'example.com',
  'example.org',
  'example.net',
  'reactjs.org',
  'react.dev',
  'vuejs.org',
  'svelte.dev',
  'github.com',
  'githubusercontent.com',
  'mozilla.org',
  'developer.chrome.com',
  'web.dev',
  'npmjs.com',
  'npmjs.org',
  'nodejs.org',
  'stackoverflow.com',
  'wikipedia.org',
  'goo.gl',
  'bit.ly',
  'fb.me',
  'khronos.org',
  'threejs.org',
  'babeljs.io',
  'tc39.es',
  'ns.adobe.com',
  'purl.org',
  'xmlns.com',
  'openxmlformats.org',
  'apple.com',
  'microsoft.com',
  'chromium.org',
  'creativecommons.org',
  'opensource.org',
  'spdx.org',
  'mit-license.org',
  'apache.org',
  'gnu.org',
  'jquery.com',
  'jquery.org',
  'lodash.com',
  'underscorejs.org',
  'feross.org',
  'tailwindcss.com',
  'vitejs.dev',
  'webpack.js.org',
  'esbuild.github.io',
  'rollupjs.org',
  'parceljs.org',
  'nextjs.org',
  'vercel.com',
  'angular.io',
  'emberjs.com',
  'getbootstrap.com',
  'fontawesome.com',
  'unicode.org',
];
const NOISE = new RegExp(`(^|\\.)(${NOISE_DOMAINS.map(d => d.replaceAll('.', '\\.')).join('|')})$`, 'i');
const ORIGIN_IN_TEXT =
  /\b((?:https?|wss?):)\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+|localhost|127\.0\.0\.1)(:\d{2,5})?(?=[/"'`\s?#)\\]|$)/gi;
const CODE_EXT = /\.(m?js|cjs|html?|css|json|svg)$/i;
const lineAt = (text, i) => text.slice(0, i).split('\n').length;

/** Every file of the published folder (hidden files listed apart, never read). → {files: [{rel, bytes, link}], hidden: [rel]} */
async function filesOf(root) {
  const files = [],
    hidden = [];
  async function walk(abs, rel) {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? `${rel}/${e.name}` : e.name,
        full = path.join(abs, e.name);
      if (
        e.name === 'node_modules' ||
        (!rel && ['evidence', 'server', 'supabase'].includes(e.name) && e.isDirectory()) ||
        (!rel && e.name === 'gamesfun.json')
      )
        continue;
      if (e.name.startsWith('.')) {
        hidden.push(r + (e.isDirectory() ? '/' : ''));
        continue;
      }
      const st = await lstat(full);
      if (st.isSymbolicLink()) {
        files.push({ rel: r, bytes: 0, link: true });
        continue;
      }
      if (st.isDirectory()) await walk(full, r);
      else if (st.isFile()) files.push({ rel: r, bytes: st.size, link: false });
    }
  }
  await walk(root, '');
  return { files, hidden };
}

/** The command that declares a backend, for the game's folder as the person types it (`game`; else a placeholder):
 *  backend.json goes in that folder, so a fix run from another folder still writes it where it belongs. */
export const useCustom = game => `${CMD} backend use custom ${game ? typedPath(game) : '<folder>'}`;

/**
 * The published folder read against the hosting (no browser): {files, bytes, fix: [{what, fix}], warn: [{what, fix}],
 * origins: [{origin, where, kind}]} — `origins` are the other sites the code names that backend.json does not list.
 * `game`: the game's folder as the person types it, for the commands a fix names.
 */
export async function scanPage(
  out,
  { backend = [], limits = DEFAULT_LIMITS, prefix = '.', hasServer = false, game = null } = {},
) {
  // a file as the person finds it: under the published folder (dist/index.html), not as the host serves it
  const at = rel => (prefix && prefix !== '.' ? `${prefix}/${rel}` : rel);
  // hosts the fix list already names (a CDN, a font service): not repeated as sites to declare
  const loadedFrom = new Set();
  const hostOf = url => url.replace(/^\/\//, 'https://').split('/').slice(0, 3).join('/');
  const fix = [],
    warn = [],
    named = new Map();
  const { files, hidden } = await filesOf(out);
  // what the entry page names as an engine's files: a Unity build's loader config (hashed names too), a Godot export
  const entryText = await readFile(path.join(out, 'index.html'), 'utf8').catch(() => '');
  const unityNamed = new Set(
    [
      ...entryText.matchAll(
        /\b(loaderUrl|frameworkUrl|codeUrl|dataUrl|symbolsUrl)\s*[:=]\s*(?:buildUrl\s*\+\s*)?["'`]([^"'`]+)["'`]/g,
      ),
    ].map(m => m[2].replace(/^\.?\//, '')),
  );
  const unityBuild =
    unityNamed.size > 0 || files.some(f => /(^|\/)Build\/[^/]+\.loader\.js$|(^|\/)UnityLoader\.js$/.test(f.rel));
  const namedByUnity = rel => [...unityNamed].some(n => rel === n || rel.endsWith(`/${n}`));
  // the data an engine fetches itself (Unity's .data and .unityweb, Godot's .pck): no type needed
  const engineData = rel =>
    (unityBuild && (/\.(data|unityweb|symbols\.json)$/i.test(rel) || namedByUnity(rel))) || /\.pck$/i.test(rel);
  const bytes = files.reduce((n, f) => n + f.bytes, 0);
  if (files.length > limits.files)
    fix.push({
      what: `${files.length} files; a published game may have ${limits.files}`,
      fix: 'Pack small files together (a sprite sheet, an audio sprite, one bundle) or leave out what the game never loads',
    });
  if (bytes > limits.totalBytes)
    fix.push({
      what: `${overLimit(bytes, limits.totalBytes).join(' in all; a published game may be ')}`,
      fix: 'Compress pictures (WebP, KTX2) and sounds (Ogg, lower bit rates), and leave out what the game never loads',
    });
  for (const f of files.filter(x => x.bytes > limits.fileBytes))
    fix.push({
      what: `${at(f.rel)} is ${overLimit(f.bytes, limits.fileBytes).join('; one file may be ')}`,
      fix: 'Split it, or compress it (Draco or meshopt for models, KTX2 for textures, a lower bit rate for sounds and videos)',
    });
  const untyped = files.filter(f => UNTYPED_CODE.test(f.rel));
  if (untyped.length)
    warn.push({
      what: `${untyped
        .slice(0, 5)
        .map(f => f.rel)
        .join(
          ', ',
        )}${untyped.length > 5 ? ', …' : ''}: the host serves these as plain bytes (application/octet-stream), so a browser will not run them as code`,
      fix: 'Publish what the build makes from them (.js, .css), not the sources; a page that loads one of these by URL needs it built first',
    });
  // Unity's WebGL build compressed with Brotli or Gzip (its default) and no decompression fallback: the loader expects the
  // server to send these with Content-Encoding, and the play host serves every file as it is
  const packedAll = files.filter(f => /\.(framework\.js|wasm|data|symbols\.json)\.(br|gz)$/i.test(f.rel));
  // an older build's packed files beside the unpacked ones the page loads: left over, never fetched
  const unpacked = new Set(files.map(f => f.rel));
  const leftover = packedAll.filter(f => unpacked.has(f.rel.replace(/\.(br|gz)$/i, '')));
  const unityPacked = packedAll.filter(f => !leftover.includes(f));
  if (leftover.length)
    warn.push({
      what: `${at(leftover[0].rel)}${leftover.length > 1 ? ` and ${leftover.length - 1} more` : ''}: compressed copies of a Unity build's files that sit beside the files themselves (an earlier build's)`,
      fix: 'The page loads the uncompressed files, so these are never fetched: delete them to publish less',
    });
  if (unityPacked.length)
    fix.push({
      what: `${at(unityPacked[0].rel)}${unityPacked.length > 1 ? ` and ${unityPacked.length - 1} more` : ''}: a Unity build compressed for a server that sends Content-Encoding, which the play host does not; the loader stops with "Unable to parse ${unityPacked[0].rel.split('/').pop()}"`,
      fix: 'In Unity, Player Settings → Publishing Settings: Compression Format Disabled, or keep the compression and turn on Decompression Fallback (the loader then unpacks the files itself). Then build again',
    });
  // a Godot export inside its project: the editor imports the export's own pictures, and writes .import files beside them
  const godotImports = files.some(f => /\.pck$/i.test(f.rel)) ? files.filter(f => /\.import$/i.test(f.rel)) : [];
  if (godotImports.length)
    warn.push({
      what: `${at(godotImports[0].rel)}${godotImports.length > 1 ? ` and ${godotImports.length - 1} more` : ''}: the Godot editor imported the export's own files`,
      fix: 'Delete them, and put an empty file named .gdignore in the export folder: the editor then leaves the folder alone',
    });
  const odd = files.filter(
    f =>
      !godotImports.includes(f) &&
      !servedTyped(f.rel) &&
      !UNTYPED_CODE.test(f.rel) &&
      /\.[a-z0-9]+$/i.test(f.rel) &&
      !packedAll.includes(f) &&
      !engineData(f.rel),
  );
  if (odd.length)
    warn.push({
      what: `${odd.length} file${odd.length === 1 ? '' : 's'} of a type the host does not know (${[...new Set(odd.map(f => f.rel.split('.').pop()))].slice(0, 6).join(', ')}): served as application/octet-stream`,
      fix: 'Fine for data the game reads with fetch(); a picture, sound or script in such a file will not play from its URL',
    });
  // what the entry page loads from its own folder and the folder lacks (a build that was not made, or not copied)
  const absent = [];
  for (const m of entryText.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const src = m[1].split(/[?#]/)[0];
    if (/^([a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(src) || src.includes('${') || src.includes('{{')) continue;
    let rel;
    try {
      rel = decodeURIComponent(path.posix.normalize(src).replace(/^\.\//, ''));
    } catch {
      continue;
    }
    if (!rel.startsWith('..') && !unpacked.has(rel))
      absent.push(`${at('index.html')}:${lineAt(entryText, m.index)} loads ${rel}`);
  }
  for (const n of unityNamed)
    if (!files.some(f => f.rel === n || f.rel.endsWith(`/${n}`))) absent.push(`its Unity loader names ${n}`);
  if (absent.length)
    fix.push({
      what: `${absent.slice(0, 3).join('; ')}${absent.length > 3 ? ` and ${absent.length - 3} more` : ''}, which ${absent.length === 1 ? 'is' : 'are'} not in the folder`,
      fix: unityBuild
        ? "The Unity build's Build/ folder is missing (git often leaves it out): build again into this folder, or adopt the folder the build went to"
        : 'Build the game first, or point adopt at the folder the build writes (--out <dir>)',
    });
  const ownHidden = new Set(['.gamesfun/', '.git/', '.gitignore', '.DS_Store']);
  const theirs = hidden.filter(h => !ownHidden.has(h));
  if (theirs.length)
    warn.push({
      what: `hidden files never go up: ${theirs.slice(0, 5).join(', ')}${theirs.length > 5 ? ', …' : ''}`,
      fix: 'If the game loads one of them, give it a name without the leading dot',
    });

  let rootPaths = 0,
    sw = false,
    fullscreen = false, // a way to go full screen: the page's own button, an engine's, or GamesFun.fullscreen()
    devices = new Map(), // what it asks for → where
    callsApi = [];
  // a file the page loads by a path from the root: the first three are listed, the rest counted
  const fromRoot = (what, own) => {
    if (fix.some(x => x.what === what)) return; // the same path twice on a line of a bundle
    if (rootPaths++ >= 3) return;
    const long = `Use relative paths: the game is served under a folder in xgames.fun Studio's preview and under ${CMD} dev, so /x breaks there. ${ROOT_PATH_FIX}`;
    fix.push({ what, fix: own ?? (fix.some(x => x.fix === long) ? 'The same fix: relative paths' : long) });
  };
  // a page written as name.html (SvelteKit's default, some others): the host serves /name.html and /name/ (from
  // name/index.html), never /name, so a link or a reload of /name answers "not found"
  const present = new Set(files.map(f => f.rel));
  const pages = files
    .map(f => f.rel)
    .filter(
      r =>
        /\.html?$/i.test(r) &&
        !/(^|\/)(index|404|_not-found|200)\.html?$/i.test(r) && // the entry, and the error pages builds write
        !present.has(`${r.replace(/\.html?$/i, '')}/index.html`),
    )
    .map(r => {
      const base = r
        .replace(/\.html?$/i, '')
        .split('/')
        .pop()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return { rel: r, re: new RegExp(`["'\`](?:\\.{1,2}/|/)(?:[\\w.-]+/)*${base}/?["'\`?#]`) };
    });
  const pageLinked = new Map();
  // an engine's own files (a Godot export's index.js and worklets, a Unity build's loader and framework): what they can
  // do (a service worker, the microphone) and the sites their comments name are the engine's, not the game's
  const godotExe = /GODOT_CONFIG\s*=\s*\{[^]*?"executable"\s*:\s*"([^"]+)"/.exec(entryText)?.[1];
  const engineFile = rel =>
    (godotExe &&
      new RegExp(
        `^${godotExe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(js|audio\\.worklet\\.js|audio\\.position\\.worklet\\.js|service\\.worker\\.js)$`,
      ).test(rel)) ||
    /(^|\/)Build\/[^/]+\.(loader|framework)\.js$|(^|\/)UnityLoader\.js$/.test(rel) ||
    (unityBuild && /\.js$/i.test(rel) && namedByUnity(rel));
  for (const f of files.filter(x => CODE_EXT.test(x.rel) && !x.link && x.bytes < 8 * 1024 * 1024)) {
    const text = await readFile(path.join(out, ...f.rel.split('/')), 'utf8').catch(() => '');
    const engine = engineFile(f.rel);
    if (/\.html?$/i.test(f.rel)) {
      for (const m of text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi)) {
        loadedFrom.add(hostOf(m[1]));
        fix.push({
          what: `${at(f.rel)}:${lineAt(text, m.index)} loads a script from ${hostOf(m[1])}`,
          fix: 'The hosted page runs scripts from its own files only: install it as a package (it is bundled) or put a copy of the file in the game and load that',
        });
      }
      // an import map sends bare imports ("three") to whatever URL it names
      for (const m of text.matchAll(/<script\b[^>]*\btype\s*=\s*["']?importmap["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
        let map;
        try {
          map = JSON.parse(m[1]);
        } catch {
          continue;
        }
        const urls = [...Object.values(map?.imports ?? {}), ...Object.values(map?.scopes ?? {}).flatMap(Object.values)];
        const hosts = [...new Set(urls.filter(u => typeof u === 'string' && /^(https?:)?\/\//.test(u)).map(hostOf))];
        for (const u of urls.filter(u => typeof u === 'string' && /^\/(?!\/)/.test(u)))
          fromRoot(
            `${at(f.rel)}:${lineAt(text, m.index)} has an import map entry ${u} from the root`,
            `Use a relative path (./${u.slice(1)}): the game is served under a folder in xgames.fun Studio's preview and under ${CMD} dev`,
          );
        for (const h of hosts) loadedFrom.add(h);
        if (hosts.length)
          fix.push({
            what: `${at(f.rel)}:${lineAt(text, m.index)} has an import map that loads modules from ${hosts.join(', ')}`,
            fix: 'The hosted page runs scripts from its own files only: copy the library into the game (only the files it imports, with its licence) and point the import map at the copy (./vendor/…)',
          });
      }
      for (const m of text.matchAll(/<link\b[^>]*\bhref\s*=\s*["']((?:https?:)?\/\/[^"']+)["'][^>]*>/gi)) {
        const fonts = /fonts\.(googleapis|gstatic)\.com/.test(m[1]);
        // a preconnect or dns-prefetch hint loads nothing; it goes with the font or file link it serves
        if (fonts || /rel\s*=\s*["']?(preconnect|dns-prefetch)/i.test(m[0])) loadedFrom.add(hostOf(m[1]));
        if (fonts) loadedFrom.add('https://fonts.gstatic.com');
        if (/rel\s*=\s*["']?(stylesheet|preload|modulepreload|icon|manifest)/i.test(m[0])) {
          loadedFrom.add(hostOf(m[1]));
          fix.push({
            what: `${at(f.rel)}:${lineAt(text, m.index)} loads ${fonts ? 'web fonts' : 'a file'} from ${hostOf(m[1])}`,
            fix: fonts
              ? "The hosted page loads fonts from its own files only: open the Google Fonts CSS link, download the .woff2 files it names (only the subsets for the scripts the game shows: latin for English, every subset listed for Japanese, Chinese or Korean), copy its @font-face rules into the game's CSS pointing at the copies, and keep the font's licence (OFL.txt) beside them"
              : 'The hosted page loads style sheets and fonts from its own files only: download them into the game and link the copies',
          });
        }
      }
      for (const m of text.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi))
        fix.push({
          what: `${at(f.rel)}:${lineAt(text, m.index)} frames ${m[1].split('/').slice(0, 3).join('/')}`,
          fix: 'The hosted page cannot frame other sites: link to it instead',
        });
      if (/<base\b[^>]*href/i.test(text))
        fix.push({
          what: `${at(f.rel)} has a <base href>`,
          fix: 'The hosted page refuses <base>: take it out and use relative URLs. A router that reads the path needs a hash router then (Angular: remove <base href> from src/index.html and add withHashLocation() to provideRouter; React Router: createHashRouter; Vue Router: createWebHashHistory; Nuxt: router: { options: { hashMode: true } })',
        });
      if (/<form\b[^>]*\baction\s*=/i.test(text))
        warn.push({
          what: `${at(f.rel)} has a form with an action`,
          fix: 'The hosted page sends no form posts: handle the form in script (fetch to your backend or /api/)',
        });
      // a tag with its attributes (not JSDoc's Array<Object>)
      const plugin = /<(?:object|embed)\s[^>]*\b(?:data|src|type)\s*=/i.exec(text);
      if (plugin)
        fix.push({
          what: `${at(f.rel)}:${lineAt(text, plugin.index)} has an <object> or <embed>`,
          fix: 'The hosted page loads none (plug-in content is off): show the file with <img>, <video>, <iframe> of your own page, or a canvas',
        });
      // srcset="/a.png 1x, /a@2x.png 2x": each picture in the list
      for (const m of text.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) {
        const root = m[1]
          .split(',')
          .map(c => c.trim().split(/\s+/)[0])
          .find(u => /^\/(?!\/)/.test(u));
        if (root) fromRoot(`${at(f.rel)}:${lineAt(text, m.index)} loads ${root} from the root (srcset)`);
      }
      // url(/x) in a <style> or a style="" attribute
      for (const m of text.matchAll(/url\(\s*["']?(\/(?!\/)[^"')]+)/gi))
        fromRoot(
          `${at(f.rel)}:${lineAt(text, m.index)} uses ${m[1]} from the root, in a style`,
          `Use a relative path (url(./${m[1].slice(1)})): the game is served under a folder in xgames.fun Studio's preview and under ${CMD} dev`,
        );
      for (const m of text.matchAll(/\b(?:src|href|poster)\s*=\s*["'](\/(?!\/)[^"']*)["']/gi)) {
        const tag = text.slice(text.lastIndexOf('<', m.index), text.indexOf('>', m.index) + 1);
        if (/^<(a|base)\b/i.test(tag)) continue; // a link the player follows, or <base> (its own finding): no file the page loads
        if (/\brel\s*=\s*["']?[^"'>]*icon/i.test(tag)) {
          // one line for the icon, however many pages name it
          const same = warn.find(w => w.icon === m[1]);
          if (same) same.pages++;
          else
            warn.push({
              icon: m[1],
              pages: 1,
              what: `${at(f.rel)}:${lineAt(text, m.index)} names its tab icon ${m[1]} from the root`,
              fix: `It shows at the game's own link, not in Studio's preview or under ${CMD} dev: a relative path shows it everywhere`,
            });
          continue;
        }
        if (/^\/socket\.io\//.test(m[1])) {
          fix.push({
            what: `${at(f.rel)}:${lineAt(text, m.index)} loads ${m[1]}, which your Socket.IO server serves`,
            fix: `xgames.fun serves only the game's files, not your server's: copy the client (node_modules/socket.io-client/dist/socket.io.min.js) into the game and load the copy, then connect with io('https://<your server>') instead of io(), and declare that server: ${useCustom(game)} --url https://<your server>`,
          });
          continue;
        }
        fromRoot(`${at(f.rel)}:${lineAt(text, m.index)} loads ${m[1]} from the root`);
      }
    }
    if (/\.css$/i.test(f.rel)) {
      for (const m of text.matchAll(/@import\s+(?:url\()?\s*["']?(https?:\/\/[^"')\s]+)/gi)) {
        loadedFrom.add(hostOf(m[1]));
        fix.push({
          what: `${at(f.rel)}:${lineAt(text, m.index)} imports a style sheet from ${m[1].split('/').slice(0, 3).join('/')}`,
          fix: 'Download it (and its fonts) into the game and import the copy',
        });
      }
      for (const m of text.matchAll(/url\(\s*["']?(\/(?!\/)[^"')]+)/gi))
        fromRoot(
          `${at(f.rel)}:${lineAt(text, m.index)} uses ${m[1]} from the root`,
          'Use a path relative to the style sheet',
        );
    }
    if (/\.(m?js|cjs|html?)$/i.test(f.rel)) {
      const imported = new Map();
      for (const m of text.matchAll(/\b(?:from|import)\s*\(?\s*["']((?:https?:)?\/\/[^"']+)["']/g))
        if (!imported.has(hostOf(m[1]))) imported.set(hostOf(m[1]), lineAt(text, m.index));
      for (const [h, line] of imported) {
        loadedFrom.add(h);
        fix.push({
          what: `${at(f.rel)}:${line} imports a module from ${h}`,
          fix: 'The hosted page runs scripts from its own files only: install it as a package (it is bundled) or put a copy in the game and import that',
        });
      }
      if (!engine && /serviceWorker\s*\.\s*register\s*\(/.test(text)) sw = true;
      if (
        /\b(?:webkitR|r)equestFullscreen\b|\bfullscreen\s*\(|gf:fullscreen|window_set_mode|\bSetFullscreen\b/.test(text)
      )
        fullscreen = true;
      for (const [what, re] of [
        ['the camera or microphone', /getUserMedia\s*\(/],
        ['the location', /geolocation\s*\.\s*(getCurrentPosition|watchPosition)/],
        ['USB or payments', /navigator\s*\.\s*usb\b|PaymentRequest\s*\(/],
        ['SharedArrayBuffer (threads)', /\bnew\s+SharedArrayBuffer\s*\(|\bAtomics\s*\.\s*wait\s*\(/],
      ]) {
        if (engine && !/threads/.test(what)) continue;
        const m = re.exec(text);
        if (m && !devices.has(what)) devices.set(what, `${at(f.rel)}:${lineAt(text, m.index)}`);
      }
      // the page calling its own api/: only the game's own server/ answers there once hosted
      // a fetch of api/…, or a path to /api/… handed to the game's own helper (call('GET', '/api/state'))
      const api = /\bfetch\s*\(\s*["'`](?:\.?\/)?api\/[^"'`]*|["'`]\/api\/[A-Za-z][^"'`\s]*["'`]/.exec(text);
      // (xcore's own copies name the host's paths: the platform answers those, not the game's server)
      const ownCopy = /^gf\/(loot|platform)\//.test(f.rel) || f.rel === 'gamesfun.js';
      if (api && !hasServer && !ownCopy) callsApi.push(`${at(f.rel)}:${lineAt(text, api.index)}`);
      // paths from the root built in a script: fetch('/x'), import('/x'), el.src = '/x', new Audio('/x'),
      // setAttribute('src', '/x'), and the engines' loaders: Phaser load.image('key', '/x'), three.js loader.load('/x'),
      // PIXI Assets.load('/x') and Texture.from('/x')
      for (const m of text.matchAll(
        /(?:\b(?:fetch|import|importScripts)\s*\(\s*|\bnew\s+(?:(?:Shared)?Worker|Audio)\s*\(\s*|\.src\s*=\s*|\.setAttribute\s*\(\s*["'](?:src|href|poster)["']\s*,\s*|\bload\.(?:image|audio|spritesheet|atlas|json|tilemapTiledJSON|bitmapFont|video|text|glsl|svg|multiatlas|aseprite)\s*\(\s*["'`][^"'`]*["'`]\s*,\s*|\.load\s*\(\s*|\b(?:Assets\.(?:load|add)|Texture\.from)\s*\(\s*)["'`](\/(?!\/)(?!api\/)[^"'`$\s]*)/g,
      ))
        fromRoot(
          `${at(f.rel)}:${lineAt(text, m.index)} loads ${m[1]} from the root, in a script`,
          `Use a relative path (./${m[1].slice(1)}): the game is served under a folder in xgames.fun Studio's preview and under ${CMD} dev`,
        );
    }
    if (/\.(m?js|html?)$/i.test(f.rel))
      for (const pg of pages) {
        if (pageLinked.has(pg.rel)) continue;
        const m = pg.re.exec(text);
        if (m) pageLinked.set(pg.rel, `${at(f.rel)}:${lineAt(text, m.index)}`);
      }
    ORIGIN_IN_TEXT.lastIndex = 0;
    // a package manifest names sites (homepage, repository) the page never loads
    if (/(^|\/)(package(-lock)?\.json|composer\.json)$/.test(f.rel)) continue;
    // xcore's own copies in the game (loot's page client, the platform client) name their defaults; not the game's
    if (/^gf\/(loot|platform)\//.test(f.rel) || f.rel === 'gamesfun.js' || engine) continue;
    for (const m of text.matchAll(ORIGIN_IN_TEXT)) {
      const proto = m[1].toLowerCase(),
        host = m[2].toLowerCase();
      if (NOISE.test(host)) continue;
      // a bare "http://localhost" is a URL parser's base (new URL(path, 'http://localhost'), as React Router's and
      // Nuxt's runtimes write), not an address the page calls; one with a port or a path is a dev server
      if (host === 'localhost' && proto === 'http:' && !m[3] && /^\/?["'`]/.test(text.slice(m.index + m[0].length)))
        continue;
      let origin;
      try {
        origin = new URL(`${proto}//${host}${m[3] ?? ''}`).origin;
      } catch {
        continue;
      }
      if (proto === 'ws:' || proto === 'wss:') origin = `${proto}//${host}${m[3] ?? ''}`;
      if (backend.includes(origin)) continue;
      if (!named.has(origin))
        named.set(origin, {
          origin,
          where: `${at(f.rel)}:${lineAt(text, m.index)}`,
          kind: /^wss?:/.test(proto) ? 'websocket' : 'address',
        });
    }
  }
  if (rootPaths > 3)
    fix.push({ what: `${rootPaths - 3} more paths from the root`, fix: 'The same fix: relative paths' });
  for (const w of warn.filter(w => w.icon)) {
    if (w.pages > 1) w.what += ` (and ${w.pages - 1} more page${w.pages === 2 ? '' : 's'})`;
    delete w.icon;
    delete w.pages;
  }
  // no tab icon: every browser then asks for /favicon.ico, and the live page's console shows a 404 for it
  const entry = entryText;
  if (entry && !/<link\b[^>]*\brel\s*=\s*["']?[^"'>]*\bicon\b/i.test(entry) && !present.has('favicon.ico'))
    warn.push({
      what: `${at('index.html')} names no tab icon: browsers ask for /favicon.ico, and the live game's console shows a 404 for it`,
      fix: 'Add one beside the page and link it relatively: <link rel="icon" href="./icon.png"> (or put a favicon.ico at the root of what is published)',
    });
  // most players come from a post on X or a phone, where the game first shows in a small frame
  if (!fullscreen && files.some(f => /\.html?$/i.test(f.rel)))
    warn.push({
      what: 'it has no way to go full screen: in a post on X and on a phone the game first shows in a small frame',
      fix: "Give it a full screen button that calls GamesFun.fullscreen() (gamesfun.js, xcore add signin): on xgames.fun the page around it goes full screen (or fills the screen in an app's own browser, X's among them), and elsewhere the browser does, or the game opens in a tab of its own. Or call the browser's element.requestFullscreen() from a click",
    });
  if (sw)
    warn.push({
      what: 'it registers a service worker',
      fix: "Allowed, but it keeps the old files after you publish a new version until it updates itself: make it check for updates (or leave it out). Never let it cache the host's answers (api/, /platform/v1/, /loot/v1/, /player/v1/): a player would see another moment's scores, saves and balances",
    });
  if (callsApi.length)
    fix.push({
      what: `the page calls api/ on its own origin (${callsApi.slice(0, 3).join(', ')}), and the game has no server/`,
      fix: `xgames.fun answers a game's api/ only from its own server/ (a Worker, docs/SERVER.md). Either move that logic into server/, run the server on a host of your own and call it there (${useCustom(game)} --url <https://…>), or run the logic in the page (WebAssembly runs: Pyodide for Python, for example). Ask the person before a change of that size`,
    });
  const threads = devices.get('SharedArrayBuffer (threads)');
  devices.delete('SharedArrayBuffer (threads)');
  // Godot 4.3+ writes its export's choice into the page; with threads it waits for cross-origin isolation and never starts
  const godotThreads = /\bGODOT_THREADS_ENABLED\s*=\s*true\b/.test(entry);
  if (godotThreads)
    fix.push({
      what: `${at('index.html')} is a Godot export built with Thread Support: it needs a cross-origin isolated page, which xgames.fun does not give a brought game, so it stops at "missing features: Cross Origin Isolation, SharedArrayBuffer"`,
      fix: 'In Godot (4.3 or later), Project → Export → Web: turn Thread Support off and export again (Godot 4.0 to 4.2 always export with threads: upgrade the project)',
    });
  else if (threads)
    warn.push({
      what: `${threads} uses SharedArrayBuffer or Atomics.wait: an xgames.fun page is not cross-origin isolated, so SharedArrayBuffer is undefined there`,
      fix: 'Keep a path without it (the game should still start), or export single-threaded: an engine built with threads (Emscripten pthreads, Godot or Unity with thread support) does not start on xgames.fun',
    });
  if (devices.size)
    warn.push({
      what: `it asks for ${[...devices.entries()].map(([what, where]) => `${what} (${where})`).join(' and ')}`,
      fix: 'The play host turns these off for every game: give the player another way',
    });
  for (const [rel, where] of pageLinked)
    fix.push({
      what: `${at(rel)} is a page of its own, and ${where} links to it without .html: a link or a reload there answers "not found" once hosted`,
      fix: `The host serves ${rel.replace(/\.html?$/i, '')}/ from ${rel.replace(/\.html?$/i, '')}/index.html, and ${rel} as it is, never the name alone. Build each page as a folder: SvelteKit export const trailingSlash = 'always' (in +layout.js); Next.js trailingSlash: true; Astro build.format: 'directory' (its default); or link to the .html file`,
    });
  const origins = [...named.values()];
  const local = origins.filter(o => /\/\/(localhost|127\.0\.0\.1)(:|$)/.test(o.origin));
  for (const o of local)
    fix.push({
      what: `${o.where} names ${o.origin}, on this machine`,
      fix: `A published game cannot reach this machine: point it at your hosted backend (and declare it: ${useCustom(game)} --url <https://…>), or at /api/ (server/, docs/SERVER.md)`,
    });
  const others = origins.filter(o => !local.includes(o) && !loadedFrom.has(o.origin));
  if (others.length)
    warn.push({
      what: `the code names ${others.length} other site${others.length === 1 ? '' : 's'} that backend.json does not list: ${others
        .slice(0, 8)
        .map(o => `${o.origin} (${o.where})`)
        .join(', ')}${others.length > 8 ? ', …' : ''}`,
      fix: `The hosted page reaches only its own origin and backend.json's origins (at most 8). If the game calls one of these, declare it: ${useCustom(game)} --url <its origin> [--origin wss://…]. A library's own links (documentation, licences) need nothing; ${CMD} check shows which ones the page really calls`,
    });
  return { files: files.length, bytes, fix, warn, origins: others };
}
