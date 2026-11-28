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
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildTree, leftOutOfPublish, sourceBytes, sha256 } from './tree.mjs';
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
import { madeByKit, shown as shownDir } from '../games.mjs';
import { publishCredential, requireCredential } from './oidc.mjs';
import { bundleServer } from '../server/bundle.mjs';
import { CONFIG_FILE, migrationsChanged, publishField, studioAccepts, studioFeatures } from '../server/contract.mjs';
import { ECONOMY_FILES, economyFile, installPage, installServerCopy, isObject, noEconomy } from '../economy.mjs';
import { economyCluster, LOOT_PROGRAMS, networkOf, rpcWords, serverRpc, solanaRpc } from '../solana-rpc.mjs';
import { shadowedPath } from './hosting.mjs';
import { buildFailure, pageRoots, runBuild } from './page.mjs';
import { CMD } from '../command.mjs';
import { seedAddress, VOUCHER_SEED_LINE } from '../voucher-seed.mjs';
import { stateFolder } from '../state-folder.mjs';
import { overLimit, plural, sizeText } from '../util.mjs';
import {
  CARD_FILES,
  CARD_MAX_BYTES,
  CARD_SIZE,
  cardFix,
  cardJson,
  cardReport,
  cardSetting,
  cardTarget,
  checkScreenshot,
  defaultCard,
  drawable,
  treePicture,
  typedPath,
} from '../card.mjs';

export const linkFile = dir => path.join(dir, '.gamesfun', 'publish.json');
/** What a publish record that does not read is told (`why`: what is wrong with it), with code 'publish-record'. */
const linkUnreadable = why =>
  Object.assign(
    new Error(
      `.gamesfun/publish.json ${why}. It is this folder's record of its game on xgames.fun (the game's id and link), and nothing was done: read as empty, the next publish would make a second game. Put it back from a copy, or write it again as {"${studioOrigin()}": {"projectId": "<the game's id>"}} (the id is in the game's address on your console, ${studioOrigin()}/console). To publish this folder as a new game instead, delete the file.`,
    ),
    { code: 'publish-record' },
  );
/**
 * The folder's game on each xgames.fun it was published to: {<origin>: {projectId, slug, url, …}}, or {} for a folder
 * never published. Throws, in words, on a record that is there and does not read: it is never taken for no record.
 */
export async function readLinks(dir) {
  let text;
  try {
    text = await readFile(linkFile(dir), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return {};
    throw linkUnreadable(`could not be read (${e.message})`);
  }
  let links;
  try {
    links = JSON.parse(text);
  } catch (e) {
    throw linkUnreadable(`is not valid JSON (${e.message})`);
  }
  if (!links || typeof links !== 'object' || Array.isArray(links)) throw linkUnreadable('is not a JSON object');
  return links;
}
async function writeLink(dir, origin, record) {
  const all = await readLinks(dir);
  all[origin] = record;
  await stateFolder(dir);
  await mkdir(path.dirname(linkFile(dir)), { recursive: true });
  // written whole beside it, then moved into place: a write that is cut short never leaves half a record
  const text = JSON.stringify(all, null, 2) + '\n';
  const tmp = `${linkFile(dir)}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  try {
    await rename(tmp, linkFile(dir));
  } catch {
    // Windows refuses the move while another program holds the file open
    await writeFile(linkFile(dir), text);
    await rm(tmp, { force: true });
  }
}

const PACKAGE = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
/** Who checked a game, in the report xgames.fun keeps with its version: this package, unless the kit says it was. */
export const LABEL = `${PACKAGE.name} ${PACKAGE.version}`;
export { madeByKit };

/** This package's check for a game made anywhere: the page check, as the publish gate takes it. → its summary */
export async function pageCheck(dir, { onLine = () => {}, onOut, args = [], built = false } = {}) {
  // loaded when used: ../check.mjs loads this module too
  const { pageVerify } = await import('../check.mjs');
  const r = await pageVerify(dir, {
    ...(onOut ? { onOut } : {}),
    quick: true,
    noBuild: built || args.includes('--no-build'),
    justBuilt: built,
    log: onLine,
    port: Number(args.find(a => a.startsWith('--port='))?.slice('--port='.length)) || 0,
  });
  const ran = r.checks.filter(c => c.ok !== null);
  // what the person should know beside the verdict (an export older than its project)
  for (const w of r.warnings ?? []) onLine(`warning: ${w}`);
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
 * xgames.fun's refusal of the game's database migrations, as words the person can act on:
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

/**
 * xgames.fun's 409 for an update of a game that has no version yet: an earlier first publish made the game and stopped
 * before its first version went up (cut off, or refused at the last step), and that xgames.fun takes a first version
 * only as a new game. Said with the way on: publish as a new game, then archive the empty one, which still counts
 * toward the account's games.
 */
function unfinishedGame(dir, origin, known) {
  const at = typedDir(shownDir(dir));
  return new PublishRefusal(
    `Nothing was published: this folder's game on ${origin} (${known.projectId}) was made by an earlier publish that stopped before its first version went up, and xgames.fun does not take a first version for it now. Publish it as a new game: ${CMD} publish${at} --new (it prints the account and the game first, as a first publish does). Then archive the empty game in your console (${origin}/console), so it does not hold one of your account's games.`,
    { code: 'unfinished-game', status: 409, next: `${CMD} publish${at} --new` },
  );
}

/**
 * Why an economy's "live" section cannot be the one its "network" names, in words, or null: live.program is loot's
 * program on the other cluster (an economy put live on devnet whose "network" was then set to "mainnet", or the other
 * way). The page the players load would refuse to start ("its network and its live section name two clusters").
 */
export function liveClusterProblem(economy) {
  const program = economy?.live?.program;
  if (!economy || typeof economy !== 'object' || typeof program !== 'string') return null;
  const network = networkOf(economy);
  if (program === LOOT_PROGRAMS[network]) return null;
  // a program that is no cluster's loot (a local validator's, a test's) is not this check's to judge
  const other = Object.keys(LOOT_PROGRAMS).find(c => LOOT_PROGRAMS[c] === program);
  if (!other) return null;
  return [
    `its "network" is "${network}", and its "live" section is loot on ${other} (${program}), so the published page would refuse to start.`,
    other === 'devnet' && network === 'mainnet'
      ? `To go to mainnet: keep a copy of this file (it is the devnet economy), take its "live" section out, and put it live on mainnet (${CMD} loot approve). To stay on devnet, set "network" back to "devnet".`
      : `Set "network" back to "${other}", or take "live" out and put it live on ${network} (${CMD} loot approve).`,
  ].join(' ');
}

/**
 * Why a mainnet economy cannot go up with the test voucher key in it, in words, or null: a grant's "vouchers" or the
 * economy's keys.issuer is the key whose seed is VOUCHER_SEED in the game's .dev.vars (`xcore add vouchers`), in plain
 * text on this machine, so whoever reads that file signs vouchers that pay real money. On devnet it is the point.
 */
export async function testKeyProblem(dir, economy, { origin = studioOrigin() } = {}) {
  if (networkOf(economy) !== 'mainnet') return null;
  let seed;
  try {
    seed = VOUCHER_SEED_LINE.exec(await readFile(path.join(dir, '.dev.vars'), 'utf8'))?.[1] ?? null;
  } catch {
    return null;
  }
  if (!seed) return null;
  const test = await seedAddress(seed.toLowerCase());
  const grants = (Array.isArray(economy.grants) ? economy.grants : [])
    .filter(g => Array.isArray(g?.vouchers) && g.vouchers.includes(test))
    .map(g => `"${g.key}"`);
  const issuer = economy.keys?.issuer === test;
  if (!grants.length && !issuer) return null;
  const where = grants.length
    ? `${grants.length === 1 ? `grant ${grants[0]} takes` : `grants ${grants.join(', ')} take`} vouchers from the test voucher key (${test})${issuer ? ', and its keys.issuer is that key' : ''}`
    : `its keys.issuer is the test voucher key (${test})`;
  // the live key is kept on the game's server, so a folder never published makes its game on devnet first
  let published = true;
  try {
    published = !!(await readLinks(dir))[origin]?.projectId;
  } catch {
    // an unreadable record: publish says so itself
  }
  const first = published
    ? ''
    : `This folder's game is not on xgames.fun yet, and the live key is kept on its server: publish it on devnet first ("network": "devnet" in the economy file, then ${CMD} publish), then set "network" back to "mainnet". `;
  return `this economy is on mainnet, and ${where}, whose seed is in .dev.vars in plain text: anyone who reads that file can sign vouchers that pay real money. ${first}Make the live key, ${CMD} secret set VOUCHER_SEED --new-key (on mainnet it takes the test key out of the grants it points at the new one${issuer ? '; set keys.issuer to the new key too' : ''}), then ${CMD} loot approve, then publish.`;
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

/** The example first migration `xcore add database` writes (../client/server/0001_init.sql), as text. */
const EXAMPLE_MIGRATION = await readFile(new URL('../client/server/0001_init.sql', import.meta.url), 'utf8').catch(
  () => null,
);
/** Two texts the same but for their line endings (a checkout on Windows may turn \n into \r\n). */
const sameText = (data, text) =>
  text != null &&
  Buffer.from(data ?? '')
    .toString('utf8')
    .replace(/\r\n/g, '\n') === text.replace(/\r\n/g, '\n');

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
  // the game's economy file, among what goes up (xsolana.json, else loot.json)
  const economyName = ECONOMY_FILES.find(n => built.tree.files.some(f => f.path === n));
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
    // the files the host and the page read as JSON: one that is not is refused here, named
    if (f.path === BACKEND_FILE || f.path === economyName) {
      try {
        const value = JSON.parse(Buffer.from(bytes).toString('utf8'));
        if (!isObject(value))
          problems.push(f.path === BACKEND_FILE ? `${f.path} is not a JSON object` : noEconomy(f.path));
        else if (f.path === BACKEND_FILE) config = value;
        else {
          const why = liveClusterProblem(value);
          if (why) problems.push(`${f.path}: ${why}`);
          const test = await testKeyProblem(dir, value, { origin });
          if (test) problems.push(`${f.path}: ${test}`);
        }
      } catch (e) {
        problems.push(`${f.path} is not valid JSON (${e.message})`);
      }
    }
  }
  const server = await serverCheck(dir);
  if (server) {
    problems.push(...server.problems.map(p => `server code: ${p}`));
    hits.push(...server.hits);
  }
  // with a server, /api/* is the server's: a file there could never be reached
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
  // a game with no link here yet: the link name its first publish will get, when its title has words xgames.fun leaves
  // out. A publish record that does not read is a refusal of publish's: said with the rest.
  let links = null;
  try {
    links = await readLinks(dir);
  } catch (e) {
    problems.push(e.message);
  }
  // the example first migration `xcore add database` writes, still as written: once published it is the game's
  // database for good (a migration never changes), so it goes up only once someone has made it the game's own. One
  // this xgames.fun applied already stays as it is.
  const applied = new Set((links?.[origin]?.migrations ?? []).map(m => m.sha256));
  for (const m of server?.database?.migrations ?? [])
    if (!applied.has(m.sha256) && sameText(m.data, EXAMPLE_MIGRATION))
      problems.push(
        `${m.path ?? m.name}: it is still the example migration ${CMD} add database wrote (a sample players table). Once published, a migration is the game's database for good and is never changed, so write the game's own tables in it first. To keep the example as it is, take out its first line (the note that it is an example).`,
      );
  return {
    linkName: !links || links[origin] ? null : linkNameNote(built.title),
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
      ...(card.status === 'missing'
        ? [`  Or run ${CMD} check${at} first: publish then makes one from its screenshot.`]
        : []),
      `  Or go without: ${CMD} publish${at} --no-card   (or "card": false in gamesfun.json, so it is never asked)`,
    ].join('\n'),
    next: fix.command,
  };
}

/** A file inside the game, relative to it, with "/". */
const posixRel = (dir, file) => path.relative(dir, file).split(path.sep).join('/');

/** Does the game have a preview picture of its own where `xcore card` writes it? (../card.mjs defaultCard's test) */
const hasCard = dir => {
  const target = cardTarget(pageRoots(dir));
  return target.how !== 'no-static' && CARD_FILES.some(f => existsSync(path.join(target.folder, ...f.split('/'))));
};

/**
 * Why the page check's screenshot `shot` (evidence/verify-N/…) is not one to make the game's preview picture from, or
 * null when it is: its run must have finished (record.json), passed, and seen the game's files as they are now. Only
 * what can change the page counts: a file publish puts up, or a source a build makes them from. What publish leaves
 * out (./tree.mjs leftOutOfPublish: the maker's notes, server/, evidence/, hidden files, node_modules) does not, and
 * neither does a build's output folder, which the build writes again from those sources. A game with no build whose
 * check saved the fingerprint of the files that go up (record.json filesFingerprint) is judged by their contents, so a
 * checkout or a copy that only touches the files' times leaves the screenshot good.
 */
export async function shotProblem(dir, shot) {
  let record;
  try {
    record = JSON.parse(await readFile(path.join(path.dirname(shot), 'record.json'), 'utf8'));
  } catch {
    return 'that check did not finish (it has no record.json)';
  }
  if (record?.pass !== true) return 'that check did not pass, so its screenshot may show a broken page';
  const ended = Date.parse(record.started) + (Number(record.seconds) || 0) * 1000;
  if (!Number.isFinite(ended)) return 'that check does not say when it ran';
  const roots = pageRoots(dir);
  if (!roots.build && typeof record.filesFingerprint === 'string')
    return (await buildTree(dir)).filesFingerprint === record.filesFingerprint
      ? null
      : "the game's files changed after that check ran";
  const builtInto = roots.build && roots.out !== roots.dir ? roots.out : null;
  const newer = async (abs, rel) => {
    for (const e of await readdir(abs, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(abs, e.name),
        r = rel ? `${rel}/${e.name}` : e.name;
      // a folder is left out when everything in it would be
      if (leftOutOfPublish(e.isDirectory() ? `${r}/-` : r) || full === builtInto) continue;
      if (e.isDirectory()) {
        const found = await newer(full, r);
        if (found) return found;
      } else if (e.isFile() && (await stat(full)).mtimeMs > ended + 1000) return r;
    }
    return null;
  };
  const changed = await newer(path.resolve(dir), '');
  return changed ? `the game's files changed after that check ran (${changed}, for one)` : null;
}

/**
 * Publish `dir`. Options: origin, draft (a private version only), newGame (ignore the remembered link), title,
 * runChecks (default true: check again when the files changed since the last pass), progress(line). The kit passes
 * check (its six gates, as ./gate.mjs takes a check), label (its name and version in the report), prepare(dir,
 * progress) (its own files' upkeep before the files are read), rpcFile (its workspace's .env) and economyPage(dir, env)
 * (its own economy package's page client, until the kit moves to @xgamesfun/solana). card: whether a game without a
 * preview picture xgames.fun can draw is refused (code 'card'); by default only when no `check` is passed (this package's own),
 * since a caller with its own check makes its own card; false is --no-card. onMade(projectId): called once xgames.fun
 * has made a new game (the first publish's code is used up then).
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
    onMade = null,
  } = {},
) {
  // the preview picture is asked for when this package's own check runs (a caller with its own check makes its own
  // card), unless the caller says otherwise: card false (--no-card) or true
  const askCard = card ?? !check;
  if (!check && madeByKit(dir))
    throw new PublishRefusal(
      `Nothing was published: this folder has gf-three.json, the record of a game made in the game-making kit, so its publish is the kit's (the kit's six gates run first), and the kit is not released yet. If this game was not made in the kit, that gf-three.json is a stray copy: move it out of the folder, then publish again.`,
      { code: 'kit' },
    );
  check ??= pageCheck;
  // the folder's record of its game: one that does not read refuses here, before anything is asked, built or sent
  await readLinks(dir);
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

  // whether the newest check's screenshot can be the preview picture (below) is read before anything here writes
  // into the game (the kit's upkeep, the page client's copy)
  const wantsCard = askCard && !draft && cardSetting(dir).value && !hasCard(dir);
  const shot = wantsCard ? checkScreenshot(dir) : null;
  const stale = shot ? await shotProblem(dir, shot) : null;
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
  // A voucher server written before it named its economy's cluster reads every grant at its devnet address: on a
  // mainnet economy it pays nobody. The game's server is its own code, which publish never rewrites (a game may have
  // made vouchers.js its own, or name the cluster in a file of its own: any of its server's files that calls loot's
  // useCluster, under any name, does); add vouchers writes the template again, keeping the settings at its top.
  const serverDir = path.join(dir, 'server');
  const namesCluster = async () => {
    for (const f of await readdir(serverDir).catch(() => []))
      if (/\.m?js$/.test(f) && (await readFile(path.join(serverDir, f), 'utf8').catch(() => '')).includes('useCluster'))
        return true;
    return false;
  };
  if (economyCluster(dir) === 'mainnet' && existsSync(path.join(serverDir, 'vouchers.js')) && !(await namesCluster()))
    throw new PublishRefusal(
      `Nothing was published: server/vouchers.js was written by an older xcore, and on this mainnet economy it reads each grant at its devnet address, so it pays nobody. Run ${CMD} add vouchers again (it keeps PAY, VOUCHERS and the settings at its top), then publish.`,
      { code: 'vouchers-cluster' },
    );
  // no preview picture of its own: one made from the page check's newest screenshot, before the build copies it, and
  // only from a check that passed on the game as it is now (a failed or cut-short run, or one of older files, shows a
  // page that is not the one going up)
  if (wantsCard) {
    if (stale)
      progress(
        `No preview picture was made from ${posixRel(dir, shot)}: ${stale}. Run ${CMD} check${typedDir(shownDir(dir))} again (publish then makes one from its screenshot), or make one with ${CMD} card${typedDir(shownDir(dir))}.`,
      );
    const made = stale ? null : await defaultCard(dir);
    if (made)
      progress(
        `No preview picture, so ${posixRel(dir, made.file)} was made from the page check's screenshot (${posixRel(dir, made.from)}). Look at it; to use another: ${CMD} card${typedDir(shownDir(dir))} --force, or add --from <picture>.`,
      );
  }
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
  // the page's documents have rules (database.collections) and nobody to answer them: every GamesFun.db call would 404
  if (pre.server?.docsUnrouted)
    throw new PublishRefusal(
      `Nothing was published: ${CONFIG_FILE} → database.collections sets the rules of the page's documents (GamesFun.db, at api/db/), and this game's own server does not route api/db/, so every GamesFun.db call would answer 404. ${CMD} add database writes server/gf-docs.js; route it first thing in your server's fetch: const db = await handleDocs(request, env); if (db) return db; (import { handleDocs } from './gf-docs.js'). Or take "collections" out of ${CONFIG_FILE} if the page does not use GamesFun.db.`,
      { code: 'db-route' },
    );
  const takes = pre.server?.has ? studioAccepts(me) : null;
  const database = pre.server?.database?.has ? pre.server.database : null;
  if (database) {
    // a database needs xgames.fun to make one: the game is not published without it
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
    throw new PublishRefusal(
      `The server bundle is ${sizeText(pre.server.bytes)}; xgames.fun takes ${sizeText(takes.maxBytes)}.`,
      {
        code: 'size',
      },
    );
  for (const w of pre.server?.warnings ?? []) progress(`Server code: ${w}`);
  // a page's Solana calls go to the game's own RPC when its server has one (xcore add rpc: server/rpc.js at api/rpc,
  // the URL a secret of the server), else to /loot/v1/rpc on the play host, xgames.fun's shared relay, whose calls are
  // billed (docs/FEES.md "What counts as use") but never count toward the cap
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
      const rpc = solanaRpc(env, { ...(rpcFile ? { file: rpcFile } : {}), cluster: economyCluster(dir) });
      progress(
        `Its economy's Solana calls go through xgames.fun's shared relay once published. They are billed: they use up the included amount, counted at cost ($10 a million; $1 lasts ~140 player-hours of an economy that reads every 5 s), and past it are charged from usage credit at $20 a million. They never count toward the cap that switches the game's server off. Bring the game's own ${rpc.cluster} RPC: ${CMD} add rpc${rpc.shared ? '' : ` (${rpcWords(rpc)} is used on this machine only)`}.`,
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
    throw new PublishRefusal(
      `This game is ${overLimit(built.bytes, L.totalBytes).join('; a published game may be ')}.`,
      {
        code: 'size',
      },
    );
  if (L.files && built.tree.files.length > L.files)
    throw new PublishRefusal(`This game has ${built.tree.files.length} files; a published game may have ${L.files}.`, {
      code: 'size',
    });
  const big = L.fileBytes ? built.tree.files.find(f => f.bytes > L.fileBytes) : null;
  if (big)
    throw new PublishRefusal(`${big.path} is ${overLimit(big.bytes, L.fileBytes).join('; one file may be ')}.`, {
      code: 'size',
    });

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
      `These exact files passed their checks (${report.passed} of ${report.ran}, ${report.run ?? 'earlier'}), so they are not run again.`,
    );
  if (checked.changedDuring)
    progress(
      'The game’s files changed while it was checked, so this counts as not passed. Publish again when nothing is editing it.',
    );
  if (!report.pass && !draft)
    progress(
      `Its checks did not pass (${report.failed.map(c => `${c.n} ${c.name}`).join('; ') || 'the check did not run'}), so it goes up as a private draft: a private version on your xgames.fun console, with no public link.`,
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
        ? `With xcore's stock server (${sizeText(server.bytes)}), which serves the page's api/db/ from the game's database.`
        : `With its server code: ${plural(server.sources.length, 'file')} of server/ as one bundle (${sizeText(server.bytes)})${server.objects.length ? `, Durable Objects ${server.objects.map(o => o.class).join(', ')}` : ''}.`,
    );
    if (database)
      progress(
        `With its database (env.${database.binding}): ${database.migrations.length ? `${plural(database.migrations.length, 'migration')} (${database.migrations.map(m => m.name).join(', ')}); xgames.fun applies the new ones before the new version goes live` : 'no migrations'}.`,
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
    }).catch(e => {
      throw known?.projectId && e.status === 409 && !e.code && /\bno version yet\b/i.test(e.message)
        ? unfinishedGame(dir, origin, known)
        : e;
    }),
  );

  // the game exists from here on: remember it, so publishing again (after a failure below) updates this game, never
  // making another
  if (begun.projectId && begun.projectId !== known?.projectId) {
    await writeLink(dir, origin, {
      ...(known ?? {}),
      studio: origin,
      projectId: begun.projectId,
      slug: known?.slug ?? null,
      at: new Date().toISOString(),
    });
    await onMade?.(begun.projectId);
  }
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
      if (uploaded % 10 === 0 || !queue.length)
        progress(`  uploaded ${uploaded} of ${plural(begun.missing.length, 'new file')}`);
    }
  };
  progress(
    `Uploading ${plural(begun.missing.length, 'new file')} (${sizeText(begun.newBytes)}); ${alreadyThere} xgames.fun already has.`,
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
    // a version xgames.fun kept but could not put live (its server's upload failed, no room for an archived game, no
    // free link name): not a draft, and not live; the version before, if any, still plays
    kept: !!(p && !p.published && !done.draft),
    ...(p && !p.published && p.takenDown ? { takenDown: true } : {}),
    liveBefore: known?.url && known.lastVersion != null ? { version: known.lastVersion, url: known.url } : null,
    studioUrl: done.studioUrl,
    // the game's database as xgames.fun measured it after this publish: {name, applied, sizeBytes, cap, warning?}
    database: done.database ?? null,
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
    // a kept version is not the live one: the record keeps what was live, and says what was kept
    ...(result.kept
      ? {
          lastVersion: known?.lastVersion ?? null,
          draft: known?.draft ?? false,
          kept: { version: done.version?.number ?? null, why: result.publishError },
        }
      : { lastVersion: done.version?.number ?? null, draft: done.draft }),
    // the migrations xgames.fun applied (a version that went up live has had them applied): the next publish
    // checks they come first, unchanged
    ...(database && server
      ? done.draft || result.kept
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
 *   any --a version xgames.fun kept but could not put live--> kept --publish--> public | draft
 * `started`: xgames.fun made the game but no version finished going up (an interrupted first publish). `kept`: the
 * last version is in the Studio but not live (`kept: {version, why}`); `lastVersion` is still the one that was live.
 */
export function linkState(known) {
  if (!known?.projectId) return 'never';
  if (known.kept) return 'kept';
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
