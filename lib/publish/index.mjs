// `xcore publish`: a game to xgames.fun, at a link anyone can play (xgames.fun hosts it; the person needs no host of
// their own). A game brought from anywhere (`xcore adopt`) or made with the kit (@xgamesfun/kit, which passes its own
// check): the command, the kit's MCP tool and its studio's Publish tab all come here.
//
//   1. signed in?           ./client.mjs (xcore login)
//   2. the files            ./tree.mjs: refuses .env files, links, programs, installers and archives (as xgames.fun
//                           does); leaves out evidence/ and hidden files
//   3. no secrets           ./scan.mjs (xgames.fun runs the same scan again on its side)
//      no reference names   ./names.mjs: a file that names a game this one was made to look or play
//                           like refuses it (spec.json goes up as a copy without them; the person's records keep them)
//   4. its backend          backend.json → origins (`xcore backend connect`): the only other sites the game may
//                           talk to once published; xgames.fun's play host opens that game's CSP to exactly those
//   5. its server code      server/ (the gf-server-v1 contract, ../server/contract.mjs): bundled into one file and
//                           checked (it builds, no code from text, no Node built-in, no raw sockets or import() of a
//                           name made at run time, no secrets, its Durable Objects exported, its size); a problem
//                           refuses the publish. Sent only when
//                           xgames.fun says it takes server code (GET /api/kit/me → server.contracts has gf-server-v1);
//                           otherwise the files go up alone, and the person is told. server/ itself is never a
//                           public file.
//   6. the checks           ./gate.mjs: a check on these files; a fail publishes a private draft only. A brought game:
//                           the page check (../check.mjs). A game the kit made: the kit's six gates, its `check`; one
//                           without it is refused here, never checked by less
//      its preview picture  ../card.mjs: assets/card.jpg (or .png) among the files, what a shared link shows; a game
//                           without one xgames.fun can draw is refused here (before the check and the upload) unless
//                           it is a draft, the person said --no-card, or gamesfun.json says "card": false; one it draws
//                           but crops or blurs goes up with a warning. Only when the check
//                           is this package's own (a caller that passes its own check makes its own card), or the
//                           caller asks for it with `card: true`
//   7. upload               only the files (and the server bundle) xgames.fun does not have yet
//   8. the version + link   unlisted; an update is the next version at the same link. A first publish's link name is
//                           xgames.fun's, from the title; the kit says before it uploads when reserved words are left
//                           out of it (./names.mjs linkName)
// A brought game (gamesfun.json → page, ./page.mjs; `xcore adopt`) is built first when it has a build, and its `out`
// folder is what goes up (with its server/ bundle, as for any game); the files publish adds live in its `static` folder.
// Signed in by `xcore login`, or in a GitHub Actions job by the job's own OIDC token (./oidc.mjs; actions/publish).
// The link is remembered in <game>/.gamesfun/publish.json (public facts only: which xgames.fun, the game's id, its link),
// so the next publish of this folder updates the same game.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildTree, sourceBytes, sha256 } from './tree.mjs';
import {
  scanFile,
  secretsMessage,
  backendOrigins,
  isBinaryPath,
  looksText,
  SCAN_BYTES,
  BACKEND_FILE,
} from './scan.mjs';
import { findNames, linkNameNote, namesMessage } from './names.mjs';
import { gate } from './gate.mjs';
import { call, ownOrigins, signInState, studioOrigin } from './client.mjs';
import { shown as shownDir } from '../games.mjs';
import { publishCredential, requireCredential } from './oidc.mjs';
import { bundleServer } from '../server/bundle.mjs';
import { CONFIG_FILE, migrationsChanged, publishField, studioAccepts, studioFeatures } from '../server/contract.mjs';
import { economyFile, installPage, installServerCopy } from '../economy.mjs';
import { rpcWords, serverRpc, solanaRpc } from '../solana-rpc.mjs';
import { shadowedPath } from './hosting.mjs';
import { buildFailure, pageRoots, runBuild } from './page.mjs';
import { CMD } from '../command.mjs';
import { stateFolder } from '../state-folder.mjs';
import {
  CARD_FILES,
  CARD_MAX_BYTES,
  CARD_SIZE,
  cardFix,
  cardJson,
  cardReport,
  cardSetting,
  drawable,
  treePicture,
  typedPath,
} from '../card.mjs';

export const linkFile = dir => path.join(dir, '.gamesfun', 'publish.json');
export async function readLinks(dir) {
  try {
    return JSON.parse(await readFile(linkFile(dir), 'utf8'));
  } catch {
    return {};
  }
}
async function writeLink(dir, origin, record) {
  const all = await readLinks(dir);
  all[origin] = record;
  await stateFolder(dir);
  await mkdir(path.dirname(linkFile(dir)), { recursive: true });
  await writeFile(linkFile(dir), JSON.stringify(all, null, 2) + '\n');
}

const mb = n => `${(n / 1048576).toFixed(1)} MB`;
const PACKAGE = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
/** Who checked a game, in the report xgames.fun keeps with its version: this package, unless the kit says it was. */
export const LABEL = `${PACKAGE.name} ${PACKAGE.version}`;
/** A game the kit made (its record, gf-three.json): its check is the kit's six gates, never this package's page check. */
export const madeByKit = dir => existsSync(path.join(dir, 'gf-three.json'));

/** This package's check for a game made anywhere: the page check, as the publish gate takes it. → its summary */
export async function pageCheck(dir, { onLine = () => {}, args = [], built = false } = {}) {
  const { pageVerify } = await import('../check.mjs');
  const r = await pageVerify(dir, {
    quick: true,
    noBuild: built || args.includes('--no-build'),
    justBuilt: built,
    log: onLine,
    port: Number(args.find(a => a.startsWith('--port='))?.slice('--port='.length)) || 0,
  });
  const ran = r.checks.filter(c => c.ok !== null);
  return {
    pass: r.pass,
    quick: true,
    passed: ran.filter(c => c.ok).length,
    ran: ran.length,
    failed: ran.filter(c => !c.ok),
    started: r.started,
    run: path.basename(r.outDir),
  };
}
export class PublishRefusal extends Error {
  constructor(message, details = {}) {
    super(message);
    Object.assign(this, details);
  }
}

/**
 * xgames.fun's refusal of the game's database migrations (STORAGE.md §8.4, §8.10), as words the person can act on:
 * 409 migration-changed, 409 migration-busy (another publish is applying them), 422 migration-failed (the SQL failed,
 * or a file was left partly applied: its why says how to undo it), 502 database-unavailable (Cloudflare, not the SQL). Any other answer goes on as it came.
 */
async function migrationWords(pending) {
  try {
    return await pending;
  } catch (e) {
    const a = e.answer ?? {};
    const name = typeof a.name === 'string' ? a.name : 'a migration';
    if (e.code === 'migration-changed')
      throw new PublishRefusal(
        `Nothing was published: ${name} changed after xgames.fun applied it to the game's database. A migration is never changed once applied: put ${name} back as it was, and make the change in a new migration after the last one.`,
        { code: e.code, name, status: e.status },
      );
    if (e.code === 'database-unavailable')
      throw new PublishRefusal(
        "Nothing new went live: xgames.fun could not reach the game's database (Cloudflare did not answer, or was busy). Nothing is wrong with the migrations, and the version before keeps playing: publish again in a minute.",
        { code: e.code, status: e.status },
      );
    if (e.code === 'migration-busy')
      throw new PublishRefusal(
        'Nothing was published: another publish of this game is applying its database migrations on xgames.fun right now. Try again in a minute.',
        { code: e.code, status: e.status },
      );
    if (e.code === 'migration-failed')
      throw new PublishRefusal(
        `Nothing new went live: ${name} failed on the game's database on xgames.fun${a.why ? ` (${String(a.why).replace(/\.$/, '')})` : ''}. The version before keeps playing. Fix ${name} (try it under ${CMD} dev, which applies the same migrations) and publish again.`,
        { code: e.code, name, why: a.why ?? null, status: e.status },
      );
    throw e;
  }
}

/** Step 5, offline: the game's server code as it would go up. → null (no server/) or the bundle's facts. */
export async function serverCheck(dir) {
  let b;
  try {
    b = await bundleServer(dir);
  } catch (e) {
    return {
      has: true,
      ok: false,
      problems: [e.message],
      hits: [],
      warnings: [],
      objects: [],
      compatibilityFlags: [],
      sources: [],
      bytes: 0,
      sha256: null,
      code: null,
    };
  }
  if (!b.has)
    return b.problems?.length ? { has: false, ok: false, problems: b.problems, hits: [], warnings: [] } : null;
  return b;
}

/** The offline check's summary (`publish --check`, gamesfun_publish_check, the Publish tab). */
export function checkSummary(p) {
  const s = p.server;
  return {
    ok: !p.problems.length && !p.secrets && !p.names,
    files: p.built.tree.files.length,
    bytes: p.built.bytes,
    skipped: p.built.skipped,
    added: p.built.added,
    copied: p.built.copied,
    problems: p.problems,
    secrets: p.secrets,
    names: p.names,
    nameWarnings: p.nameWarnings,
    backend: p.backend,
    card: cardJson(p.card),
    cardSetting: p.cardSetting,
    // its preview picture when it is missing, cannot be drawn, or will look worse than it could: a warning here, never
    // a refusal (publish is what stops for it)
    cardWarnings: ['warn', 'stop'].includes(p.cardWords?.level) ? [p.cardWords.line] : [],
    server: s
      ? {
          has: s.has,
          ok: s.ok,
          entry: s.entry ?? null,
          bytes: s.bytes,
          sha256: s.sha256,
          objects: (s.objects ?? []).map(o => `${o.class} (env.${o.binding})`),
          compatibilityFlags: s.compatibilityFlags ?? [],
          files: (s.sources ?? []).map(f => f.path),
          warnings: s.warnings ?? [],
          stock: !!s.stock,
          database: s.database?.has
            ? {
                binding: s.database.binding,
                migrations: s.database.migrations.map(m => m.path),
                ...(s.stock ? { collections: s.database.collections } : {}),
              }
            : null,
        }
      : null,
  };
}

/** Steps 2–5, offline: what would be sent, and every reason it would be refused. */
export async function preflight(dir, { origin = studioOrigin() } = {}) {
  const built = await buildTree(dir);
  const problems = built.refused.map(r => `${r.path}: ${r.why}`);
  const hits = [],
    named = [];
  let config = null;
  for (const f of built.tree.files) {
    // a file's own path names a reference game too (assets/<name>-logo.png)
    if (built.names.length) for (const h of findNames(f.path, built.names)) named.push({ ...h, path: f.path, line: 0 });
    if (isBinaryPath(f.path)) continue;
    const src = built.sources.get(f.sha256);
    const bytes = new Uint8Array(await sourceBytes(src));
    hits.push(...scanFile(f.path, bytes));
    if (built.names.length && looksText(f.path, bytes))
      for (const h of findNames(new TextDecoder().decode(bytes.subarray(0, SCAN_BYTES)), built.names))
        named.push({ ...h, path: f.path });
    if (f.path === BACKEND_FILE) {
      try {
        config = JSON.parse(Buffer.from(bytes).toString('utf8'));
      } catch {
        problems.push(`${BACKEND_FILE} is not valid JSON`);
      }
    }
  }
  const server = await serverCheck(dir);
  if (server) {
    problems.push(...server.problems.map(p => `server code: ${p}`));
    hits.push(...server.hits);
  }
  // with a server, /api/* is the server's: a file there could never be reached (the contract's §1)
  if (server?.has)
    for (const f of built.tree.files)
      if (f.path.startsWith('api/'))
        problems.push(
          `${f.path}: a game with its own server has no files under api/ (its /api/* is the server's); move it`,
        );
  // what the play host serves: index.html at the root is the entry; its own paths are never the game's files
  if (!built.refused.length && !built.tree.files.some(f => f.path === 'index.html'))
    problems.push("index.html: there is none at the root of what is published (the host serves it at the game's link)");
  for (const f of built.tree.files) {
    const why = !f.path.startsWith('api/') && shadowedPath(f.path);
    if (why) problems.push(`${f.path}: it ${why}, so it is never served; move it`);
  }
  const secrets = secretsMessage(hits);
  const backend = backendOrigins(config, { own: ownOrigins(origin) });
  problems.push(...backend.problems);
  const names = namesMessage(named);
  // its preview picture, among exactly the files that go up; gamesfun.json → card says whether the game wants one
  const setting = cardSetting(dir);
  if (setting.problem) problems.push(setting.problem);
  const card = await treePicture(built);
  // a game with no link here yet: the link name its first publish will get, when its title has words xgames.fun leaves out
  const linked = (await readLinks(dir))[origin];
  return {
    linkName: linked ? null : linkNameNote(built.title),
    built,
    hits,
    secrets,
    backend: backend.origins,
    problems,
    named: named.filter(h => !h.warn),
    nameWarnings: named.filter(h => h.warn),
    names,
    server,
    card,
    cardSetting: setting.value,
    cardWords: cardReport(card, dir, { off: !setting.value }),
  };
}

/** A folder as it is typed after a command: nothing for ".", quoted only when the shell needs it (../card.mjs typedPath). */
const typedDir = where => (where === '.' ? '' : ` ${typedPath(where)}`);

/**
 * Why publish stops for the preview picture, in words a person or an agent acts on: only for what xgames.fun cannot
 * draw (a picture it can draw goes up with a warning). card: ../card.mjs previewPicture's verdict; dir: the game's
 * folder. → {message, next (the command that fixes it, or null)}
 */
export function cardRefusal(card, dir) {
  const at = typedDir(shownDir(dir));
  const fix = cardFix(card, dir);
  const what =
    card.status === 'missing'
      ? `this game has no preview picture (${CARD_FILES.join(', or ')}, in the files that go up).`
      : `its preview picture, ${card.path}, cannot be drawn: ${card.why}.`;
  return {
    message: [
      `Nothing was published: ${what}`,
      `  A preview picture is what a link to the game shows when it is shared (a post on X, a chat): a square picture behind its title. Without one xgames.fun can draw, the link shows a plain gradient with the title. It is ${CARD_FILES[0]} (or ${CARD_FILES[1]}): a JPEG or PNG named for what it is, at most ${CARD_MAX_BYTES.toLocaleString('en-US')} bytes, best square at ${CARD_SIZE}×${CARD_SIZE}.`,
      `  ${card.status === 'missing' ? 'Make one:     ' : 'Fix it:       '} ${fix.line}`,
      `  Or go without: ${CMD} publish${at} --no-card   (or "card": false in gamesfun.json, so it is never asked)`,
    ].join('\n'),
    next: fix.command,
  };
}

/**
 * Publish `dir`. Options: origin, draft (a private version only), newGame (ignore the remembered link), title,
 * runChecks (default true: check again when the files changed since the last pass), progress(line). The kit passes
 * check (its six gates, as ./gate.mjs takes a check), label (its name and version in the report), prepare(dir,
 * progress) (its own files' upkeep before the files are read), rpcFile (its workspace's .env) and economyPage(dir, env)
 * (its own economy package's page client, until the kit moves to @xgamesfun/solana). card: whether a game without a
 * preview picture xgames.fun can draw is refused (code 'card'); by default only when no `check` is passed (this package's own),
 * since a caller with its own check makes its own card; false is --no-card.
 * → { url, gameUrl, friendsUrl, slug, version, draft, verify, uploaded, alreadyThere, studioUrl, backend, projectId }
 */
export async function publishGame(
  dir,
  {
    origin = studioOrigin(),
    draft = false,
    newGame = false,
    title = null,
    runChecks = true,
    progress = () => {},
    env = process.env,
    fetchImpl = fetch,
    check = null,
    label = LABEL,
    prepare = null,
    rpcFile,
    economyPage = (d, e) => installPage(d, { env: e }),
    card = null,
  } = {},
) {
  // the preview picture is asked for when this package's own check runs (a caller with its own check makes its own
  // card), unless the caller says otherwise: card false (--no-card) or true
  const askCard = card ?? !check;
  if (!check && madeByKit(dir))
    throw new PublishRefusal(
      `This game was made with the kit (it has gf-three.json): publish it with the kit, so its six gates run first (${CMD} publish there, with @xgamesfun/kit installed).`,
      { code: 'kit' },
    );
  check ??= pageCheck;
  const cred = await requireCredential(origin, { env, fetchImpl }).catch(e => {
    throw new PublishRefusal(e.message, { code: 'login', state: e.state, next: e.next });
  });
  if (cred.kind !== 'login') progress(`Signed in as ${cred.label} (GitHub's OIDC token; no key is stored anywhere).`);
  // every call signs with the credential's current token (a GitHub token is asked for again before it runs out)
  const api = async (route, opts = {}) => call(origin, route, { ...opts, ...(await cred.auth()), fetchImpl });
  const me = await api('/api/kit/me').catch(e => {
    if (e.status === 401) throw new PublishRefusal(`${e.message}`, { code: 'login' });
    throw e;
  });

  if (prepare) await prepare(dir, progress);
  // a game with an economy carries the page client as the installed package has it (../economy.mjs); a brought
  // game, in the folder its build copies as it is
  const roots = pageRoots(dir);
  const page = roots.static ? await economyPage(roots.static, env) : null;
  if (page?.changed)
    progress(
      `Copied ${page.package ?? 'loot'} ${page.version}'s page client into the game (${roots.brought && roots.static !== roots.dir ? `${path.relative(roots.dir, roots.static).split(path.sep).join('/')}/` : ''}gf/loot/, ${page.files} files).`,
    );
  // a server with its own voucher key (xcore add vouchers) signs with loot's own code: kept at the installed package too
  const signer = await installServerCopy(dir, { env });
  if (signer?.changed)
    progress(`Copied ${signer.package} ${signer.version}'s voucher signer into the game's server (server/gf-loot/).`);
  if (roots.build) {
    progress(`Building it (${roots.build})…`);
    const b = await runBuild(dir, { env, onLine: l => progress(`  ${l}`) });
    if (b.code !== 0)
      throw new PublishRefusal(
        `Nothing was published: its build (${roots.build}) failed with exit code ${b.code}${buildFailure(b) ? ` (${buildFailure(b)})` : ''}. Make it pass on its own first.`,
        { code: 'build', tail: b.tail },
      );
  }
  progress('Reading the game’s files…');
  let pre = await preflight(dir, { origin });
  if (pre.problems.length)
    throw new PublishRefusal(`Nothing was published:\n  - ${pre.problems.join('\n  - ')}`, {
      code: 'files',
      problems: pre.problems,
    });
  if (pre.secrets) throw new PublishRefusal(pre.secrets, { code: 'secrets', hits: pre.hits });
  if (pre.names) throw new PublishRefusal(pre.names, { code: 'names', hits: pre.named });
  // a preview picture xgames.fun cannot draw: said before the check and the upload, with the two ways on; one it can
  // draw that will look worse than it could (blurry, cropped) goes up with a warning
  if (askCard && pre.cardSetting && !drawable(pre.card) && !draft) {
    const r = cardRefusal(pre.card, dir);
    throw new PublishRefusal(r.message, {
      code: 'card',
      card: cardJson(pre.card),
      ...(r.next ? { next: r.next } : {}),
    });
  }
  if (askCard && pre.cardSetting && pre.card.status === 'warn')
    progress(`Worth fixing: its preview picture ${cardReport(pre.card, dir).line}`);
  // the page's documents have rules (database.collections) and nobody to answer them: every gf.db call would 404
  if (pre.server?.docsUnrouted)
    throw new PublishRefusal(
      `Nothing was published: ${CONFIG_FILE} → database.collections sets the rules of the page's documents (gf.db, at api/db/), and this game's own server does not route api/db/, so every gf.db call would answer 404. ${CMD} add database writes server/gf-docs.js; route it first thing in your server's fetch: const db = await handleDocs(request, env); if (db) return db; (import { handleDocs } from './gf-docs.js'). Or take "collections" out of ${CONFIG_FILE} if the page does not use gf.db.`,
      { code: 'db-route' },
    );
  const takes = pre.server?.has ? studioAccepts(me) : null;
  const database = pre.server?.database?.has ? pre.server.database : null;
  if (database) {
    // a database needs xgames.fun to make one (STORAGE.md §8.1): the game is not published without it
    if (!takes.ok)
      throw new PublishRefusal(
        `Nothing was published: this game has a database (${CONFIG_FILE} → database), which runs on the game's server, and ${takes.why}. Publish it again once it does.`,
        { code: 'feature', feature: 'server' },
      );
    if (!studioFeatures(me).has('d1'))
      throw new PublishRefusal(
        `Nothing was published: this game has a database (${CONFIG_FILE} → database), and this xgames.fun does not make databases for games yet (GET /api/kit/me does not list "d1"). Publish it again once it does, or take "database" out of ${CONFIG_FILE} to publish without one.`,
        { code: 'feature', feature: 'd1' },
      );
    // append only: what this folder put on this xgames.fun before still comes first, byte for byte
    const before = newGame ? [] : ((await readLinks(dir))[origin]?.migrations ?? []);
    const changed = migrationsChanged(database.migrations, before);
    if (changed)
      throw new PublishRefusal(`Nothing was published: ${changed.why}.`, { code: changed.code, name: changed.name });
  }
  if (takes?.ok && pre.server.usesFiles && !studioFeatures(me).has('files'))
    throw new PublishRefusal(
      `Nothing was published: this game's server uses its project files (env.GF.files), and this xgames.fun does not keep project files yet (GET /api/kit/me does not list "files"). Publish it again once it does.`,
      { code: 'feature', feature: 'files' },
    );
  if (takes && !takes.ok)
    progress(
      `This game has server code (server/), and ${takes.why}: only its files are published now, without its server. Its /api/ calls will not answer until xgames.fun takes server code; publish again then.`,
    );
  if (takes?.ok && pre.server.bytes > takes.maxBytes)
    throw new PublishRefusal(`The server bundle is ${mb(pre.server.bytes)}; xgames.fun takes ${mb(takes.maxBytes)}.`, {
      code: 'size',
    });
  for (const w of pre.server?.warnings ?? []) progress(`Server code: ${w}`);
  // a page's Solana calls go to the game's own RPC when its server has one (xcore add rpc: server/rpc.js at api/rpc,
  // the URL a secret of the server), else to /loot/v1/rpc on the play host, xgames.fun's shared relay, which counts
  // every call toward the game's plan
  if (economyFile(roots.out) || (roots.overlay && economyFile(roots.overlay))) {
    const ownRpc = pre.server?.has && existsSync(path.join(dir, 'server', 'rpc.js'));
    if (ownRpc) {
      progress(
        `Its economy's Solana calls go to the game's own RPC (server/rpc.js, api/rpc) once its server has XSOLANA_RPC_URL: ${CMD} secret set XSOLANA_RPC_URL (once; ${CMD} secret list shows whether it is set). Until then they use xgames.fun's shared relay.`,
      );
      // the server's entry (where api/rpc runs) may call only backend.json's origins: the RPC's must be one
      const local = serverRpc(dir);
      if (local && !(pre.backend ?? []).includes(local.origin))
        progress(
          `Worth fixing: ${BACKEND_FILE} origins does not name ${local.origin} (XSOLANA_RPC_URL in ${local.from}), so its server's calls to the RPC will be refused: ${CMD} add rpc adds it.`,
        );
      else if (!local && !(pre.backend ?? []).length)
        progress(
          `Worth fixing: ${BACKEND_FILE} names no origins, and a game's server (its entry, where api/rpc runs) may call only those: add your RPC's (https://host alone) to its "origins".`,
        );
    } else {
      const rpc = solanaRpc(env, rpcFile ? { file: rpcFile } : undefined);
      progress(
        `Its economy's Solana calls go through xgames.fun's shared relay once published, and each counts toward the game's plan ($10 a million; on Free's $1 a month, ~140 player-hours of an economy that reads every 5 s). Bring the game's own devnet RPC: ${CMD} add rpc${rpc.shared ? '' : ` (${rpcWords(rpc)} is used on this machine only)`}.`,
      );
    }
  }
  for (const w of pre.nameWarnings)
    progress(
      `Worth a look: ${w.path}:${w.line} says "${w.found}", the first word of a reference game's name (${w.name}). It goes up; take it out if it means that game.`,
    );
  if (pre.built.copied?.length)
    progress(
      `${pre.built.copied.join(', ')} goes up as a copy without the reference game${pre.built.names.length === 1 ? '' : 's'} named in it (the file on this machine keeps the words).`,
    );
  let { built } = pre;
  const L = me.limits ?? {};
  if (L.totalBytes && built.bytes > L.totalBytes)
    throw new PublishRefusal(`This game is ${mb(built.bytes)}; a published game may be ${mb(L.totalBytes)}.`, {
      code: 'size',
    });
  if (L.files && built.tree.files.length > L.files)
    throw new PublishRefusal(`This game has ${built.tree.files.length} files; a published game may have ${L.files}.`, {
      code: 'size',
    });
  const big = L.fileBytes ? built.tree.files.find(f => f.bytes > L.fileBytes) : null;
  if (big)
    throw new PublishRefusal(`${big.path} is ${mb(big.bytes)}; one file may be ${mb(L.fileBytes)}.`, { code: 'size' });

  // a brought game was built above: its check reads those files, never a second build (that would change them under it)
  const checked = await gate(dir, {
    check,
    run: runChecks,
    kit: label,
    onLine: l => progress(`  ${l}`),
    onRun: () =>
      progress(
        roots.brought
          ? 'Checking the game (its page in Chrome, about a minute)…'
          : 'Checking the game (about 2 minutes)…',
      ),
    ...(roots.build ? { args: ['--no-build'], built: true } : {}),
  });
  const report = { ...checked.report };
  // What goes up is exactly what was checked: read the files again, and a pass for other files is no pass.
  if (checked.fingerprint !== built.fingerprint) {
    pre = await preflight(dir, { origin });
    if (pre.problems.length || pre.secrets || pre.names)
      throw new PublishRefusal(
        pre.secrets ?? pre.names ?? `Nothing was published:\n  - ${pre.problems.join('\n  - ')}`,
        { code: pre.secrets ? 'secrets' : pre.names ? 'names' : 'files' },
      );
    built = pre.built;
    if (takes?.ok && !pre.server?.has)
      throw new PublishRefusal(
        'The game’s server code went away while it was being checked. Publish again when nothing is editing the game.',
        { code: 'changed' },
      );
    if (built.fingerprint !== checked.fingerprint) report.pass = false;
  }
  if (checked.reused)
    progress(
      `These exact files passed their checks (${report.passed}/${report.ran}, ${report.run ?? 'earlier'}), so they are not run again.`,
    );
  if (checked.changedDuring)
    progress(
      'The game’s files changed while it was checked, so this counts as not passed. Publish again when nothing is editing it.',
    );
  if (!report.pass && !draft)
    progress(
      `Its checks did not pass (${report.failed.map(c => `${c.n} ${c.name}`).join('; ') || 'the check did not run'}), so it goes up as a private draft: a version in your xgames.fun Studio, with no public link.`,
    );

  const links = await readLinks(dir),
    known = newGame ? null : (links[origin] ?? null);
  const name = title ?? built.title;
  const linkWords = known ? null : linkNameNote(name);
  if (linkWords) progress(linkWords);
  progress(
    `${known ? `Updating ${known.slug ? `/play/${known.slug}` : 'your game'}` : `Publishing “${name}”`} on ${origin}…`,
  );
  // the server bundle goes up through the same blob route as the files: its bytes are a source like theirs
  const server = takes?.ok ? pre.server : null;
  if (server) {
    built.sources.set(server.sha256, { data: Buffer.from(server.code) });
    for (const w of server.wasm ?? []) built.sources.set(w.sha256, { data: Buffer.from(w.bytes) }); // its wasm modules, the same way
    for (const m of database?.migrations ?? []) built.sources.set(m.sha256, { data: m.data }); // and its migrations
    progress(
      server.stock
        ? `With xcore's stock server (${(server.bytes / 1024).toFixed(1)} KB), which serves the page's api/db/ from the game's database.`
        : `With its server code: ${server.sources.length} file${server.sources.length === 1 ? '' : 's'} of server/ as one bundle (${(server.bytes / 1024).toFixed(1)} KB)${server.objects.length ? `, Durable Objects ${server.objects.map(o => o.class).join(', ')}` : ''}.`,
    );
    if (database)
      progress(
        `With its database (env.${database.binding}): ${database.migrations.length ? `${database.migrations.length} migration${database.migrations.length === 1 ? '' : 's'} (${database.migrations.map(m => m.name).join(', ')}); xgames.fun applies the new ones before the new version goes live` : 'no migrations'}.`,
      );
  }
  const begun = await migrationWords(
    api('/api/kit/publish', {
      method: 'POST',
      body: {
        title: name,
        ...(known?.projectId ? { projectId: known.projectId } : {}),
        tree: built.tree,
        verify: report,
        draft: draft === true,
        ...(server ? { server: publishField(server) } : {}),
      },
    }),
  );

  // the game exists from here on: remember it, so publishing again (after a failure below) updates this game, never
  // making another
  if (begun.projectId && begun.projectId !== known?.projectId)
    await writeLink(dir, origin, {
      ...(known ?? {}),
      studio: origin,
      projectId: begun.projectId,
      slug: known?.slug ?? null,
      at: new Date().toISOString(),
    });
  const missing = new Set(begun.missing);
  const alreadyThere = built.tree.files.filter(f => !missing.has(f.sha256)).length;
  let uploaded = 0;
  const queue = [...begun.missing];
  const worker = async () => {
    for (let sha = queue.shift(); sha; sha = queue.shift()) {
      const data = await sourceBytes(built.sources.get(sha)),
        bytes = data.length,
        route = `/api/kit/publish/${begun.id}/blobs/${sha}`;
      if (sha256(data) !== sha)
        throw new PublishRefusal(
          'A file changed while it was being published. Publish again when nothing is editing the game.',
          { code: 'changed' },
        );
      const first = await api(route, { method: 'POST', body: { bytes } });
      if (first?.present) continue;
      if (first?.upload === null)
        await api(route, { method: 'POST', body: { bytes, content: Buffer.from(data).toString('base64') } });
      else {
        const u = first.upload;
        const put = await fetchImpl(u.url, { method: u.method ?? 'PUT', headers: u.headers ?? {}, body: data });
        if (!put.ok)
          throw new Error(`Uploading a file failed (${put.status}). Run publish again; files already sent are kept.`);
        await api(route, { method: 'POST', body: { bytes, upload: u.key } });
      }
      uploaded++;
      if (uploaded % 10 === 0 || !queue.length) progress(`  uploaded ${uploaded} of ${begun.missing.length} new files`);
    }
  };
  progress(
    `Uploading ${begun.missing.length} new file${begun.missing.length === 1 ? '' : 's'} (${mb(begun.newBytes)}); ${alreadyThere} xgames.fun already has.`,
  );
  await Promise.all(Array.from({ length: Math.min(4, begun.missing.length) }, worker));

  let done;
  try {
    done = await migrationWords(api(`/api/kit/publish/${begun.id}`, { method: 'POST', body: { action: 'complete' } }));
  } catch (e) {
    if (e instanceof PublishRefusal) throw e;
    // xgames.fun can finish the publish after it stops answering (a large game's last step outlasts the request)
    if ([502, 503, 504].includes(e.status))
      throw Object.assign(
        new Error(
          `xgames.fun did not answer in time (${e.status}) while it finished the publish, which may have gone through anyway. Run \`${CMD} publish ${shownDir(dir)} --status\` before publishing again; publishing again updates this same game, it does not make a new one.`,
        ),
        { status: e.status, code: 'timeout' },
      );
    throw e;
  }
  const p = done.published;
  const result = {
    projectId: done.projectId,
    title: name,
    version: done.version,
    draft: done.draft,
    verify: report,
    uploaded,
    alreadyThere,
    url: p?.published ? p.url : null,
    gameUrl: p?.published ? p.gameUrl : null,
    friendsUrl: p?.published ? p.friendsUrl : null,
    slug: p?.slug ?? known?.slug ?? null,
    publishError: p && !p.published ? (p.error ?? 'not published') : null,
    studioUrl: done.studioUrl,
    backend: done.backend ?? [],
    skipped: built.skipped,
    added: built.added,
    card: pre.card,
    server: pre.server?.has
      ? server
        ? {
            sent: true,
            bytes: server.bytes,
            sha256: server.sha256,
            objects: server.objects.map(o => o.class),
            ...(server.stock ? { stock: true } : {}),
            ...(database ? { database: { binding: database.binding, migrations: database.migrations.length } } : {}),
            ...(done.server ? { games: done.server } : {}),
          }
        : { sent: false, why: takes?.why ?? 'not sent' }
      : null,
    credential: cred.kind,
  };
  await writeLink(dir, origin, {
    studio: origin,
    projectId: done.projectId,
    slug: result.slug,
    url: result.url ?? known?.url ?? null,
    gameUrl: result.gameUrl ?? known?.gameUrl ?? null,
    lastVersion: done.version?.number ?? null,
    draft: done.draft,
    // the migrations xgames.fun applied (a version that went up live has had them applied): the next publish
    // checks they come first, unchanged
    ...(database && server
      ? done.draft
        ? known?.migrations
          ? { migrations: known.migrations }
          : {}
        : { migrations: database.migrations.map(m => ({ name: m.name, sha256: m.sha256 })) }
      : known?.migrations
        ? { migrations: known.migrations }
        : {}),
    at: new Date().toISOString(),
  });
  return result;
}

/**
 * Where a folder's game stands on one xgames.fun, from its remembered link (.gamesfun/publish.json):
 *   never --publish begins--> started --a version goes up--> public | draft
 *   public --a version whose checks failed--> draft-over-public (the earlier version stays live) --publish--> public
 * `started`: xgames.fun made the game but no version finished going up (an interrupted first publish); publishing
 * again goes on with the same game.
 */
export function linkState(known) {
  if (!known?.projectId) return 'never';
  if (known.lastVersion == null) return 'started';
  if (known.draft) return known.url ? 'draft-over-public' : 'draft';
  return 'public';
}

/** The game's remembered link and what xgames.fun says about it now (`xcore publish --status`). */
export async function publishStatus(dir, { origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {}) {
  const links = await readLinks(dir),
    known = links[origin] ?? null;
  let oidcError = null;
  const cred = await publishCredential(origin, { env, fetchImpl }).catch(e => {
    oidcError = e.message;
    return null;
  });
  const { token: _token, words: _words, ...signIn } = await signInState(origin, { env });
  let live = null;
  if (known?.projectId && cred) {
    try {
      live = await call(origin, `/api/kit/games/${known.projectId}`, { ...(await cred.auth()), fetchImpl });
    } catch (e) {
      live = { error: e.message };
    }
  }
  return {
    studio: origin,
    signedIn: cred
      ? cred.kind === 'login'
        ? { email: cred.email, expiresAt: cred.expiresAt, store: cred.store }
        : { email: null, via: cred.kind, as: cred.label }
      : null,
    // the saved sign-in's state ('signed-in' | 'signed-out' | 'expired' | 'unreadable') and what to run next;
    // `oidcError`: a GitHub Actions job whose OIDC token could not be had
    signIn: {
      ...signIn,
      ...(cred && cred.kind !== 'login' ? { via: cred.kind } : {}),
      ...(oidcError ? { oidcError } : {}),
    },
    link: linkState(known),
    known,
    live,
  };
}
