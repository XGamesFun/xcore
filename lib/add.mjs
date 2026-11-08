// `xcore add signin|database`: games.fun's player sign-in, saves and leaderboards, and a database of the game's own,
// put into a game made without the kit, in the shape its engine takes:
//   - a web page: gamesfun.js beside the page (the folder its build copies as it is) and a <script> in index.html;
//   - a Godot 4 project: addons/gamesfun/gamesfun.gd, autoloaded as GamesFun in project.godot;
//   - a Unity project: Assets/Plugins/GamesFun/ (GamesFun.jslib and GamesFun.cs).
// The database is server code (docs/SERVER.md): server/database.js, one Durable Object with SQLite storage, and the
// Worker that routes api/db/ to it, declared in gamesfun.json → server. Publish puts it on games.fun with the game.
import { createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CMD } from './command.mjs';
import { CONFIG_FILE, pageRoots } from './publish/page.mjs';
import { BACKEND_FILE } from './publish/scan.mjs';
import { serverRpc } from './solana-rpc.mjs';
import { isPageFolder, shown as shownPath } from './games.mjs';
import { ECONOMY_FILE, economyFile, installServerCopy, solanaRoot } from './economy.mjs';

const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'client');
const read = rel => readFileSync(path.join(CLIENT, ...rel.split('/')), 'utf8');
const B64 = '__GAMESFUN_SOURCE_B64__';
export const CLIENT_FILE = 'gamesfun.js';
export const DATA_OBJECT = { class: 'GameData', binding: 'GAME_DATA' };
export const ROOM_OBJECT = { class: 'GameRoom', binding: 'GAME_ROOMS' };
export const VOUCHER_OBJECT = { class: 'GameVouchers', binding: 'GAME_VOUCHERS' };

/** What kind of project a folder is: 'godot', 'unity', 'page' (a web game), or null. */
export function engineOf(dir) {
  if (existsSync(path.join(dir, 'project.godot'))) return 'godot';
  if (existsSync(path.join(dir, 'ProjectSettings', 'ProjectVersion.txt')) && existsSync(path.join(dir, 'Assets')))
    return 'unity';
  return isPageFolder(dir) ? 'page' : null;
}

const clientSource = () => read('gamesfun.js');
const withSource = text => text.replace(B64, Buffer.from(clientSource(), 'utf8').toString('base64'));
const rel = (dir, file) => path.relative(dir, file).split(path.sep).join('/');

/** `export const NAME = {…}` in a file's text: where it starts and ends, or null. */
function settingsBlock(text, name) {
  const m = new RegExp(`^export const ${name} = \\{`, 'm').exec(text);
  if (!m) return null;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return { start: m.index, end: i + 1, text: text.slice(m.index, i + 1) };
  }
  return null;
}
/** The top-level keys of an object literal's text, comments left out. */
const keysOf = block => {
  const body = block.replace(/\/\*[^]*?\*\/|\/\/[^\n]*/g, '');
  const keys = [];
  let depth = 0;
  for (const m of body.matchAll(/[{}]|(?:^|[{,\s])(['"]?)([\w*-]+)\1\s*:/g)) {
    if (m[0] === '{') depth++;
    else if (m[0] === '}') depth--;
    else if (depth === 1) keys.push(m[2]);
  }
  return keys;
};

/**
 * A server part's new text with the settings the person changed kept: `export const ROOM`, `LIMITS`, `RULES`, `RPC`, `PAY`, `VOUCHERS` as they
 * are in the file now, with any setting this version adds put in at its default.
 */
export function keepSettings(before, text, names = ['ROOM', 'LIMITS', 'RULES', 'RPC', 'PAY', 'VOUCHERS']) {
  let out = text;
  for (const name of names) {
    const old = settingsBlock(before, name),
      now = settingsBlock(out, name);
    if (!old || !now || old.text === now.text) continue;
    let kept = old.text;
    if (name !== 'RULES') {
      // settings this version adds, at their defaults
      const have = new Set(keysOf(old.text));
      const body = now.text.replace(/\/\*[^]*?\*\//g, '');
      for (const key of keysOf(now.text).filter(k => !have.has(k))) {
        const v = new RegExp(`(?:^|[{,\\s])${key}\\s*:\\s*([^,\\n}]+)`).exec(body)?.[1]?.trim();
        if (v === undefined) continue;
        kept = /\n\s*\}$/.test(kept)
          ? kept.replace(/\n(\s*)\}$/, (_, sp) => `\n${sp}  ${key}: ${v},\n${sp}}`)
          : kept.replace(/\s*\}$/, `, ${key}: ${v} }`);
      }
    }
    out = out.slice(0, now.start) + kept + out.slice(now.end);
  }
  return out;
}

const IMPORT = /^import\s[^;]*?from\s*['"][^'"]+['"];?[ \t]*$|^import\s*['"][^'"]+['"];?[ \t]*$/gm;
/**
 * A server part's new text with the imports the person added kept (a PAY.check that reads their database needs its
 * import): each import statement in the file now from a module the new text doesn't import from, after the new text's
 * own imports.
 */
export function keepImports(before, text) {
  // a module the new text imports from is the template's own (it may import more of it now): only others are the person's
  const from = line => /['"]([^'"]+)['"];?[ \t]*$/.exec(line)?.[1];
  const ours = new Set((text.match(IMPORT) ?? []).map(from));
  const added = (before.match(IMPORT) ?? []).filter(l => !ours.has(from(l)));
  if (!added.length) return text;
  const all = [...text.matchAll(IMPORT)];
  const at = all.length ? all.at(-1).index + all.at(-1)[0].length : 0;
  return `${text.slice(0, at)}${at ? '\n' : ''}${added.join('\n')}${at ? '' : '\n'}${text.slice(at)}`;
}

async function put(file, text, written, dir, { settings = false } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  const before = existsSync(file) ? await readFile(file, 'utf8') : null;
  if (before !== null && settings) text = keepImports(before, keepSettings(before, text));
  if (before === text) return;
  await writeFile(file, text);
  written.push(`${before === null ? 'wrote' : 'updated'} ${rel(dir, file)}`);
}

/** project.godot with GamesFun autoloaded (the [autoload] section made or added to). */
export function withAutoload(project) {
  const line = 'GamesFun="*res://addons/gamesfun/gamesfun.gd"';
  if (/^GamesFun\s*=/m.test(project)) return project.replace(/^GamesFun\s*=.*$/m, line);
  if (/^\[autoload\]\s*$/m.test(project)) return project.replace(/^\[autoload\]\s*$/m, `[autoload]\n\n${line}`);
  return `${project.replace(/\s*$/, '\n')}\n[autoload]\n\n${line}\n`;
}

/** A page that loads the client already. */
export const CLIENT_TAG = /<script\b[^>]*\bsrc\s*=\s*["']?\.?\/?gamesfun\.js\b/i;

/** index.html with the client loaded first in <head> (unchanged when it already loads it). */
export function withScript(html) {
  if (CLIENT_TAG.test(html)) return html;
  const tag = '<script src="./gamesfun.js"></script>';
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, m => `${m}\n    ${tag}`);
  return `${tag}\n${html}`;
}

/**
 * The client files `add signin` wrote that are not this package's own copy any more (an older xcore wrote them): what
 * `add signin` again would bring up to date. → [path from the game's folder]
 */
export async function staleClient(dir) {
  const engine = engineOf(dir);
  const want =
    engine === 'godot'
      ? [
          ['addons/gamesfun/gamesfun.gd', withSource(read('godot/gamesfun.gd'))],
          ['addons/gamesfun/gamesfun_peer.gd', read('godot/gamesfun_peer.gd')],
        ]
      : engine === 'unity'
        ? [
            ['Assets/Plugins/GamesFun/GamesFun.jslib', withSource(read('unity/GamesFun.jslib'))],
            ['Assets/Plugins/GamesFun/GamesFun.cs', read('unity/GamesFun.cs')],
          ]
        : engine === 'page' && pageRoots(dir).static
          ? [
              [
                path
                  .relative(dir, path.join(pageRoots(dir).static, CLIENT_FILE))
                  .split(path.sep)
                  .join('/'),
                clientSource(),
              ],
            ]
          : [];
  const out = [];
  for (const [rel, text] of want) {
    const file = path.join(dir, ...rel.split('/'));
    if (existsSync(file) && (await readFile(file, 'utf8')) !== text) out.push(rel);
  }
  return out;
}

/**
 * Sign-in, saves and leaderboards (and the database's page calls) for the game in `dir`. → {engine, written, steps}
 */
export async function addSignin(dir) {
  const engine = engineOf(dir);
  const written = [];
  if (engine === 'godot') {
    await put(path.join(dir, 'addons', 'gamesfun', 'gamesfun.gd'), withSource(read('godot/gamesfun.gd')), written, dir);
    await put(path.join(dir, 'addons', 'gamesfun', 'gamesfun_peer.gd'), read('godot/gamesfun_peer.gd'), written, dir);
    const projectFile = path.join(dir, 'project.godot');
    const project = await readFile(projectFile, 'utf8');
    const next = withAutoload(project);
    if (next !== project) {
      await writeFile(projectFile, next);
      written.push('autoloaded GamesFun in project.godot');
    }
    return {
      engine,
      written,
      steps: [
        'From GDScript: var player = await GamesFun.sign_in() (from a button press), GamesFun.player_changed, await GamesFun.saves_put("main", {...}), await GamesFun.scores_submit("best", score), await GamesFun.scores_top("best"); the calls are listed at the top of addons/gamesfun/gamesfun.gd.',
        'When the browser keeps the sign-in window shut (a phone, a post on X), GamesFun.sign_in_code gives {code, site}: show "Go to <site>/go and enter <code>".',
        'A script that also runs without the autoload (headless tests, godot --script) cannot use the bare name GamesFun: there, get_node_or_null("/root/GamesFun"), and play on when it is null.',
        'Export for the Web with Thread Support off, then adopt the project with that folder: ' +
          `${CMD} adopt . --out <the export folder>.`,
        'In the editor and in a desktop build, sign-in, saves, leaderboards and the database answer an error and the game plays on; on games.fun and under xcore check they work (a local player on this machine).',
      ],
    };
  }
  if (engine === 'unity') {
    const home = path.join(dir, 'Assets', 'Plugins', 'GamesFun');
    await put(path.join(home, 'GamesFun.jslib'), withSource(read('unity/GamesFun.jslib')), written, dir);
    await put(path.join(home, 'GamesFun.cs'), read('unity/GamesFun.cs'), written, dir);
    return {
      engine,
      written,
      steps: [
        'From C#: string player = await GamesFun.SignIn() (from a button press), GamesFun.PlayerChanged, await GamesFun.SavesPut("main", json), await GamesFun.ScoresSubmit("best", score), await GamesFun.ScoresTop("best"); the calls are listed at the top of Assets/Plugins/GamesFun/GamesFun.cs.',
        'When the browser keeps the sign-in window shut (a phone, a post on X), GamesFun.SignInCode gives {code, site}: show "Go to <site>/go and enter <code>".',
        'Build for WebGL with Compression Format Disabled (or Decompression Fallback on) and threads off, then adopt the project with the build folder: ' +
          `${CMD} adopt . --out <the build folder>.`,
        'In the editor every call answers an error and the game plays on; in a WebGL build, on games.fun and under xcore check, it works (a local player on this machine).',
      ],
    };
  }
  if (engine !== 'page')
    throw new Error(
      `${dir}: not a game xcore knows (no index.html, no gamesfun.json → page, no project.godot, no Unity project). Bring a web game first: ${CMD} adopt <folder>`,
    );
  const roots = pageRoots(dir);
  if (roots.brought && !roots.static)
    throw new Error(
      `${dir} has a build, and xcore does not know the folder it copies as it is: adopt it again with --static <dir> (Vite, Next.js, Astro: public), so ${CLIENT_FILE} is published with every build.`,
    );
  let home = roots.static;
  if (!roots.brought) {
    // not adopted yet: a build (Vite's) publishes what it copies, not the project's root
    const { detectShape } = await import('./publish/adopt.mjs');
    const shape = detectShape(dir);
    if (shape.kind === 'build' && !shape.static)
      throw new Error(
        `${dir} is built (${shape.framework}), and xcore does not know the folder the build copies as it is: adopt it first (${CMD} adopt ${dir} --static <dir>), so ${CLIENT_FILE} is published with every build.`,
      );
    if (shape.kind === 'build') home = path.join(dir, shape.static);
  }
  await put(path.join(home, CLIENT_FILE), clientSource(), written, dir);
  // the page that loads it: the project's own index.html for a build (Vite's), else the published one
  const entry = [path.join(dir, 'index.html'), path.join(home, 'index.html')].find(f => existsSync(f));
  let loaded = false;
  if (entry) {
    const html = await readFile(entry, 'utf8');
    const next = withScript(html);
    loaded = true;
    if (next !== html) {
      await writeFile(entry, next);
      written.push(`loaded it in ${rel(dir, entry)}`);
    }
  }
  return {
    engine,
    written,
    steps: [
      ...(loaded ? [] : [`Load it first in the page: <script src="./${CLIENT_FILE}"></script>.`]),
      ...(loaded && roots.build
        ? [
            `If ${roots.build} writes index.html from another file (a template), put the same tag in that file: ${CMD} check says when the built page does not load ${CLIENT_FILE}.`,
          ]
        : []),
      'In the game: const gf = GamesFun; const player = await gf.signIn() (from a click), gf.onChange(player => …), await gf.saves.put("main", {...}), await gf.scores.submit("best", score), await gf.scores.top("best"); every call is listed at the top of gamesfun.js.',
      'When the browser keeps the sign-in window shut (a phone, a post on X), gf.onCode(({code, site, window}) => …) says what to show: "Go to <site>/go and enter <code>". Show it plainly when window is false (the browser blocked the window). When a window opened, show it only as a quiet line, never an overlay: the player is still signing in there, and X’s login page hides from the game whether that window is still open.',
      'On this machine (localhost, xcore check) a local player and this browser’s storage stand in; under xcore dev a local sign-in, the platform and the game’s server answer as games.fun will; once published, games.fun signs players in.',
    ],
  };
}

// what xcore puts in server/: each part its file, its Durable Object and its route in server/index.js
const PARTS = {
  database: {
    file: 'database.js',
    object: DATA_OBJECT,
    handler: 'handleDatabase',
    what: 'its database answers api/db/',
  },
  rooms: {
    file: 'rooms.js',
    object: ROOM_OBJECT,
    handler: 'handleRooms',
    what: 'its multiplayer rooms answer api/rooms/',
  },
  rpc: {
    file: 'rpc.js',
    object: null,
    handler: 'handleRpc',
    what: "the economy's Solana calls go to the game's own RPC at api/rpc",
  },
  vouchers: {
    file: 'vouchers.js',
    object: VOUCHER_OBJECT,
    handler: 'handleVouchers',
    what: 'its voucher key pays the results PAY.check in vouchers.js stands behind, at api/vouchers/',
  },
};
const OURS = 'Written by `xcore add';

/** server/index.js for the parts xcore wrote (only ever rewritten while it is xcore's own). */
export function serverIndex(parts) {
  const list = Object.keys(PARTS).filter(k => parts.includes(k));
  const commands = list.map(k => (k === 'rooms' ? 'multiplayer' : k)).join('` and `xcore add ');
  return `// The game's server on games.fun (docs/SERVER.md in @xgamesfun/xcore). ${OURS} ${commands}\`:
// ${list.map(k => PARTS[k].what).join('; ')}. To add routes of the game's own, delete the words "Written by" above
// first: xcore then leaves this file alone (and says which two lines to add for anything it adds later).
${list.map(k => `import { ${PARTS[k].handler} } from './${PARTS[k].file}';`).join('\n')}

${list
  .filter(k => PARTS[k].object)
  .map(k => `export { ${PARTS[k].object.class} } from './${PARTS[k].file}';`)
  .join('\n')}

export default {
  async fetch(request, env) {
${list.map(k => `    const ${k} = await ${PARTS[k].handler}(request, env);\n    if (${k}) return ${k};`).join('\n')}${
    list.includes('rpc')
      ? ''
      : `\n    // gamesfun.js asks once a page load whether the game has its own RPC (xcore add rpc): it has not
    if (request.method === 'GET' && /\\/api\\/rpc\\/?$/.test(new URL(request.url).pathname))
      return Response.json({ gamesfun: 'rpc', own: false });`
  }
    return new Response('not found', { status: 404 });
  },
};
`;
}

/** One part of server code (the database, the rooms) into the game: its file, its object, its route. */
async function addPart(dir, part, { render = text => text } = {}) {
  const signin = await addSignin(dir);
  const written = [...signin.written];
  const spec = PARTS[part];
  const server = path.join(dir, 'server');
  // the settings at its top (ROOM, RULES, LIMITS, PAY) are the person's: kept as they set them
  await put(path.join(server, spec.file), render(read(`server/${spec.file}`)), written, dir, { settings: true });
  const index = ['index.js', 'index.mjs'].map(f => path.join(server, f)).find(f => existsSync(f));
  const indexText = index ? await readFile(index, 'utf8') : null;
  const ours = indexText === null || indexText.includes(OURS);
  if (ours) {
    const parts = Object.keys(PARTS).filter(k => k === part || existsSync(path.join(server, PARTS[k].file)));
    await put(index ?? path.join(server, 'index.js'), serverIndex(parts), written, dir);
  }
  // gamesfun.json → server.objects: the part's Durable Object, beside any the server has
  const cfgFile = path.join(dir, CONFIG_FILE);
  let cfg = {};
  if (existsSync(cfgFile)) {
    try {
      cfg = JSON.parse(await readFile(cfgFile, 'utf8'));
    } catch (e) {
      throw new Error(`${CONFIG_FILE} is not valid JSON (${e.message}); fix it first`, { cause: e });
    }
  }
  const objects = Array.isArray(cfg.server?.objects) ? cfg.server.objects : [];
  if (spec.object && !objects.some(o => o?.binding === spec.object.binding)) {
    if (objects.length >= 8)
      throw new Error(`${CONFIG_FILE} already declares 8 Durable Objects, the most a game's server may have.`);
    cfg.server = { ...(cfg.server ?? {}), objects: [...objects, spec.object] };
    await writeFile(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
    written.push(`declared ${spec.object.class} (${spec.object.binding}) in ${CONFIG_FILE} → server.objects`);
  }
  const route =
    ours || indexText.includes(spec.handler)
      ? []
      : [
          `server/${path.basename(index)} is your own: route ${{ rooms: 'the rooms', database: "the database's calls", rpc: 'api/rpc', vouchers: 'api/vouchers/' }[part]} in it.${spec.object ? ` Add \`export { ${spec.object.class} } from './${spec.file}';\` at the top, and` : ''} First thing in fetch: \`const r = await ${spec.handler}(request, env); if (r) return r;\` (with \`import { ${spec.handler} } from './${spec.file}';\`).`,
        ];
  return { signin, written, route };
}

/**
 * The RPC's origin in backend.json → origins, which is all a game's server may call on games.fun: the folder's own
 * XSOLANA_RPC_URL (.dev.vars, else .env), its origin only (the key is in its path or query). → the step to say, or null.
 */
async function allowRpc(dir, written) {
  const rpc = serverRpc(dir);
  const roots = pageRoots(dir);
  const file = path.join(roots.brought && roots.static ? roots.static : dir, BACKEND_FILE);
  let backend = null;
  if (existsSync(file)) {
    try {
      backend = JSON.parse(await readFile(file, 'utf8'));
    } catch (e) {
      throw new Error(`${BACKEND_FILE} is not valid JSON (${e.message}); fix it first`, { cause: e });
    }
  }
  const origins = Array.isArray(backend?.origins) ? backend.origins : [];
  if (!rpc)
    return `A game's server may call only the origins in ${BACKEND_FILE}: add your RPC's (its https://host alone, like https://devnet.helius-rpc.com) to "origins", or put XSOLANA_RPC_URL in .dev.vars and run ${CMD} add rpc again, which adds it.`;
  if (origins.includes(rpc.origin)) return null;
  await writeFile(
    file,
    JSON.stringify({ version: 1, ...(backend ?? {}), origins: [...origins, rpc.origin] }, null, 2) + '\n',
  );
  written.push(
    `added ${rpc.origin} (XSOLANA_RPC_URL in ${rpc.from}) to ${rel(dir, file)} origins, which the server may call`,
  );
  return null;
}

/** The economy's Solana calls through the game's own RPC (server/rpc.js at api/rpc). → {engine, written, steps} */
export async function addRpc(dir) {
  const { signin, written, route } = await addPart(dir, 'rpc');
  const origin = await allowRpc(dir, written);
  return {
    engine: signin.engine,
    written,
    steps: [
      ...route,
      `Get a devnet RPC URL of your own (Helius, Triton or QuickNode; their free plans fit a small game). Under ${CMD} dev, put XSOLANA_RPC_URL=… in the folder's .dev.vars (a hidden file publish never sends; keep it out of git).`,
      ...(origin ? [origin] : []),
      `Publish (${CMD} publish), then give the URL to the game's server: \`${CMD} secret set XSOLANA_RPC_URL\` (it asks for it; games.fun keeps it on the server, never the page, and it reaches the next request with no publish). Until it is set, api/rpc says so and the page keeps using games.fun's shared relay, so nothing breaks.`,
      "Why: games.fun's shared relay counts every call toward the game's plan ($10 a million calls, the economy's biggest cost a player); through the game's own RPC a call is one request to its server (about $0.30 a million) and the RPC's own plan.",
      "Each call counts toward the game server's requests (on Free 120 a minute from one player and 600 a game): the economy's reads every few seconds fit; RPC.methods at the top of server/rpc.js is what it passes on.",
    ],
  };
}

/** The voucher key in .dev.vars (VOUCHER_SEED), made when there is none. → {address, made} */
async function voucherSeed(dir, written) {
  const file = path.join(dir, '.dev.vars');
  const text = existsSync(file) ? await readFile(file, 'utf8') : '';
  let seed = /^\s*VOUCHER_SEED\s*=\s*["']?([0-9a-fA-F]{64})["']?\s*$/m.exec(text)?.[1] ?? null;
  const made = !seed;
  if (made) {
    if (/^\s*VOUCHER_SEED\s*=/m.test(text))
      throw new Error(
        `.dev.vars has a VOUCHER_SEED that is not a 32-byte seed in hex (64 characters): fix it or delete that line, and run this again.`,
      );
    seed = randomBytes(32).toString('hex');
    await writeFile(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}VOUCHER_SEED=${seed}\n`, { mode: 0o600 });
    written.push(
      'made a test voucher key for xcore dev: its seed is VOUCHER_SEED in .dev.vars (hidden, never published)',
    );
  }
  // keep .dev.vars out of git where the folder is in git
  const ignore = path.join(dir, '.gitignore');
  if (existsSync(ignore) || existsSync(path.join(dir, '.git'))) {
    const have = existsSync(ignore) ? await readFile(ignore, 'utf8') : '';
    if (!/^\/?\.dev\.vars\s*$/m.test(have)) {
      await writeFile(ignore, `${have}${have && !have.endsWith('\n') ? '\n' : ''}.dev.vars\n`);
      written.push('added .dev.vars to .gitignore');
    }
  }
  return { address: await seedAddress(seed), made };
}

/** An Ed25519 key's address (base58) from its 32-byte seed in hex. */
export async function seedAddress(seed) {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed, 'hex')]);
  const spki = createPublicKey(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })).export({
    format: 'der',
    type: 'spki',
  });
  const root = solanaRoot();
  if (!root)
    throw new Error(
      'The economy tools (@xgamesfun/solana) are not installed here: reinstall @xgamesfun/xcore (npm i @xgamesfun/xcore), or set GAMESFUN_SOLANA to a solana-kit checkout.',
    );
  const { encodeBase58 } = await import(pathToFileURL(path.join(root, 'js', 'chain', 'base58.js')).href);
  return encodeBase58(new Uint8Array(spki.subarray(-32)));
}

/** A new voucher key: {seed (hex), address}. The live key is made this way and sent to games.fun, never kept here. */
export async function newVoucherKey() {
  const seed = randomBytes(32).toString('hex');
  return { seed, address: await seedAddress(seed) };
}

/**
 * The game's own voucher key (server/vouchers.js, and loot's signer in server/gf-loot/): a result the server checked is
 * paid by a grant, with no keeper in between. → {engine, written, steps}
 */
export async function addVouchers(dir) {
  const roots = pageRoots(dir);
  const home = roots.brought && roots.static ? roots.static : dir;
  const economy = economyFile(home);
  if (!economy)
    throw new Error(
      `${dir} has no economy yet: a voucher is claimed from a grant in it. Make it first (${CMD} loot add ${shownPath(dir)}, then a grant in ${ECONOMY_FILE}), and run this again.`,
    );
  let from = path.relative(path.join(dir, 'server'), economy).split(path.sep).join('/');
  if (!from.startsWith('.')) from = `./${from}`;
  const { signin, written, route } = await addPart(dir, 'vouchers', {
    render: text => text.replace('__ECONOMY__', from),
  });
  const copy = await installServerCopy(dir, { always: true });
  if (copy?.changed)
    written.push(`copied ${copy.package} ${copy.version}'s voucher signer into server/gf-loot/ (${copy.files} files)`);
  const { address } = await voucherSeed(dir, written);
  let spec = {};
  try {
    spec = JSON.parse(await readFile(economy, 'utf8'));
  } catch {}
  const grants = Array.isArray(spec.grants) ? spec.grants : [];
  const named = grants.filter(g => Array.isArray(g.vouchers) && g.vouchers.includes(address)).map(g => g.key);
  const where = rel(dir, economy);
  return {
    engine: signin.engine,
    written,
    address,
    steps: [
      ...route,
      `Two keys sign vouchers: a test key for ${CMD} dev (its seed in .dev.vars; address ${address}) and the live key, made on games.fun so it is never on this machine. A copy of this folder can sign only what the grant lets the test key sign.`,
      `Once published (${CMD} publish): ${CMD} secret set VOUCHER_SEED --new-key makes the live key on the server and prints its address. Put that address in the grant that pays results, in ${where}: "vouchers": ["<the live key's address>"] (up to three keys; the keeper's can stay beside it); then ${CMD} loot check, ${CMD} loot approve, ${CMD} publish.`,
      named.length
        ? `${where} names the test key in ${named.map(k => `"${k}"`).join(', ')}: claims signed under ${CMD} dev pay on devnet. Take it out of the grant before the economy holds anything of value.`
        : `To claim a voucher signed under ${CMD} dev, add the test key's address too (devnet only; take it out before the economy holds anything of value).`,
      ...(grants.length
        ? []
        : [`${where} has no grant yet: add one that pays results (xsolana_examples "rewards for a score").`]),
      'Write PAY.check at the top of server/vouchers.js: what your server checks before a result pays (docs/SERVER.md, "How much your server can check"), and PAY.paid to count what was paid. Until then nothing is paid. Every wallet is a new player and a wallet sign-in is free: for rewards worth farming set VOUCHERS.payOnly to \'x\' (players signed in with X) and give the grant a perDay total.',
      `The page links its wallet once (await gf.loot.link(): the wallet signs that it is this player's; a wallet sign-in needs none), then asks and claims: const r = await gf.api('vouchers/pay', {method: 'POST', body: {runId}}); then await gf.loot.call('claimGrant', '<grant>', {voucher: r.data.voucher}). A voucher pays only a wallet the player proved. Your server's own code (a room that decided a match) pays with voucherFor(env, {grant, wallet: await walletOf(env, player), round}) from './vouchers.js'.`,
      `Each pay is one request to the game's server and one read of the grant through the relay (or your own RPC: ${CMD} add rpc); publish keeps server/gf-loot/ at the installed @xgamesfun/solana, so the vouchers follow loot when xcore does.`,
    ],
  };
}

/** The game's own database (server/database.js) and the page calls for it. → {engine, written, steps} */
export async function addDatabase(dir) {
  const { signin, written, route } = await addPart(dir, 'database');
  const call = { godot: 'await GamesFun.db_add("levels", {...})', unity: 'await GamesFun.DbAdd("levels", json)' };
  return {
    engine: signin.engine,
    written,
    steps: [
      ...signin.steps.filter(x => !/^(In the game|From GDScript|From C#):/.test(x)),
      ...route,
      `From the game: ${call[signin.engine] ?? 'await gf.db.add("levels", {...})'}, get, put, list, delete (documents in collections, any JSON up to 64 KB). Anyone reads; a signed-in player writes only their own documents. Change that per collection in RULES at the top of server/database.js, and use write: "server" for anything players must not set themselves (a prize, a verified score).`,
      'Your server code reaches it past those rules with dataOf(env) (import { dataOf } from "./database.js").',
      `On this machine the page keeps documents in the browser instead; ${CMD} publish puts the database on games.fun with the game (a Durable Object with SQLite storage, kept between publishes).`,
      "Every call counts toward the game server's requests (on Free 120 a minute from one player and 600 shared by all its players; on Creator 600 and 6,000): read and write when something happens (a level saved, a profile changed), not every frame.",
    ],
  };
}

/** Multiplayer rooms (server/rooms.js) and the engine's way into them. → {engine, written, steps} */
export async function addMultiplayer(dir) {
  const { signin, written, route } = await addPart(dir, 'rooms');
  const how = {
    godot: [
      "From GDScript, Godot's own multiplayer: `var peer = await GamesFun.join_room(code)` then `multiplayer.multiplayer_peer = peer` in place of an ENetMultiplayerPeer (null: GamesFun.room_error says why). The first player in is the server (id 1); RPCs, MultiplayerSpawner and MultiplayerSynchronizer work as over ENet, all reliable and ordered. In the editor and a desktop build the same call makes a local ENet game (Debug → Customize Run Instances to run two).",
      'A code: GamesFun.room_from_link() (the room a shared link opened) or GamesFun.room_code() (a new one); share GamesFun.room_link(code), which opens the game in that room on games.fun and in a post on X.',
      'Godot\'s ENet does not run in a browser: replace ENetMultiplayerPeer.create_server/create_client with join_room, and keep the rest of the game\'s multiplayer code. A Host button: join_room(GamesFun.room_code(), {"host": true}); a Join button: join_room(code, {"host": false}), which fails as ENet does when no one is there. A variable typed ENetMultiplayerPeer becomes MultiplayerPeer.',
      "The peer leaves its room when the game lets go of it (multiplayer.multiplayer_peer = null with no variable holding it) or on peer.close(). ROOM.maxPlayers in server/rooms.js is create_server's max_clients, for every room. Every packet is reliable and ordered, unreliable ones too; a frame's packets go to the room as one message.",
      "When the host leaves, its clients see server_disconnected, as over ENet (Godot's server is never handed on).",
    ],
    unity: [
      "From C#: `var room = await GamesFun.JoinRoom(code)` (null: GamesFun.RoomError says why; JoinRoom(code, name, host: true) opens a new room only, host: false joins one only); room.Id, room.Host, room.IsHost; room.OnMessage, OnBytes, OnJoin, OnLeave, OnHost, OnClose; room.Send(json, to), room.SendBytes(bytes, to), room.Lock(), room.Leave(). The first player in is the host (Id 1); to: a player's id, 0 everyone else, -id everyone but one.",
      'A code: await GamesFun.RoomFromLink() (the room a shared link opened) or GamesFun.RoomCode(); share await GamesFun.RoomLink(code), which opens the game in that room on games.fun and in a post on X.',
      "A netcode library's own transport (Netcode for GameObjects, Mirror) needs a server of its own: run game logic on the host (IsHost) and send state with room.Send / SendBytes instead.",
    ],
    page: [
      'In the game: `const { data: room, error } = await GamesFun.rooms.join(code)` (opts {name, host}: host true opens a new room only, false joins one only); room.id, room.host, room.isHost, room.peers; room.on("message" | "bytes" | "join" | "leave" | "host" | "close", …); room.send(data, to), room.sendBytes(bytes, to), room.lock(), room.leave(). The first player in is the host (id 1); to: a player\'s id, 0 everyone else, -id everyone but one.',
      'A code: GamesFun.rooms.fromLink() (the room a shared link opened) or GamesFun.rooms.code(); share GamesFun.rooms.link(code), which opens the game in that room on games.fun and in a post on X.',
    ],
  };
  return {
    engine: signin.engine,
    written,
    steps: [
      ...signin.steps.filter(x => !/^(In the game|From GDScript|From C#):/.test(x)),
      ...route,
      ...how[signin.engine],
      "A room is a relay: the host's game decides what happens, and the room never reads a message. ROOM at the top of server/rooms.js sets the most players (16), whether only signed-in players may join, and the message limits.",
      `On this machine, tabs of the same browser share a room (open the game twice); ${CMD} publish puts the rooms on games.fun with the game. A player's connection counts once toward the game server's requests (on Free 120 a minute from one player and 600 a game; on Creator 600 and 6,000), however many messages it carries.`,
    ],
  };
}
