// `xcore loot add` (../commands/loot.mjs): a game's economy put where its build publishes it, with its page client.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pageRoots, readPage, writePage } from './publish/page.mjs';
import { CMD } from './command.mjs';
import { ECONOMY_FILE, economyFile, installPage, NO_SOLANA, solanaRoot } from './economy.mjs';

/** Where xcore keeps what it adds to an engine's export (a folder of the project, laid over the export: page.static). */
export const ENGINE_OVERLAY = 'gamesfun';

/**
 * `xcore loot add`: where a game's economy lives and its page client (@xgamesfun/solana's, as ./economy.mjs
 * installPage copies it). A brought game keeps both in the folder its build copies as it is (gamesfun.json page.static),
 * so its build serves them; a plain folder, in its own folder.
 * → {home, economy (its file, or null), page: {package, version, files, changed} | null, steps: [words]}
 */
export async function addLoot(dir, { env = process.env, cwd = process.cwd() } = {}) {
  if (!solanaRoot(env)) throw new Error(NO_SOLANA);
  let r = pageRoots(dir);
  if (r.brought && !r.static)
    throw new Error(
      `${dir} is a brought game with a build, and xcore does not know the folder its build copies as it is: adopt it again with --static <dir> (Vite, Next.js, Astro: public), so ${ECONOMY_FILE} and gf/loot/ are published with every build`,
    );
  // an engine's export is the engine's folder (an export can replace it, and it is often left out of git): the economy,
  // whose file holds the addresses it went live at, goes in a folder of the project's own, laid over the export
  const godot = existsSync(path.join(r.dir, 'project.godot'));
  const unity = existsSync(path.join(r.dir, 'ProjectSettings', 'ProjectVersion.txt'));
  if (r.brought && !r.build && r.static === r.out && r.out !== r.dir && (godot || unity) && !economyFile(r.out)) {
    const own = path.join(r.dir, ENGINE_OVERLAY);
    await mkdir(own, { recursive: true });
    // Godot imports every file under its project into the game's own package: not these
    if (godot && !existsSync(path.join(own, '.gdignore'))) await writeFile(path.join(own, '.gdignore'), '');
    await writePage(r.dir, { ...readPage(r.dir), static: ENGINE_OVERLAY });
    r = pageRoots(dir);
  }
  const home = r.static;
  const economy = economyFile(home);
  const page = economy ? await installPage(home, { env }) : null;
  const at = path.relative(r.dir, home).split(path.sep).join('/');
  const where = at ? `${at}/` : '';
  const name = economy ? path.basename(economy) : ECONOMY_FILE;
  // a command to run from the folder the person is in: the game and its economy file as that folder reaches them
  const fromHere = p => {
    const rel = path.relative(cwd, p).split(path.sep).join('/');
    return !rel ? '.' : rel.startsWith('..') || path.isAbsolute(rel) ? p : rel;
  };
  const game = fromHere(r.dir);
  const file = fromHere(path.join(home, name));
  const overlay = r.overlay && home === r.overlay;
  const laid = overlay
    ? [
        `${where.slice(0, -1)} is laid over the engine's export (${path.relative(r.dir, r.out).split(path.sep).join('/')}) when the game is published, checked or run with ${CMD} dev: export as before, and keep ${where} in git.`,
      ]
    : [];
  const steps = economy
    ? [
        ...laid,
        `The page client is in ${where}gf/loot/ (a copy: never edit it; publish keeps it current).`,
        `Load it from the page at run time with a page-relative URL: const { solanaApp, walletStandardSigner } = await import(new URL('gf/loot/play/index.js', document.baseURI).href) (a bundler leaves a URL import alone; Vite: add /* @vite-ignore */), and { solanaWallets, connectWallet, PAGE_RPC } from gf/loot/wallets.js; read the economy with fetch('${name}').`,
        "Give solanaApp rpcUrl: PAGE_RPC (the page's own /loot/v1/rpc: xgames.fun's relay once published, xcore dev's forward on this machine); a browser with no wallet is told so, with the game still playable.",
        `From Godot, Unity or a page with gamesfun.js (${CMD} add signin): GamesFun.loot.ready(), .connect() and .call('shop'), .call('buy', key, {listing}) … do the same with JSON in and out; play it all with ${CMD} dev.`,
        `Going live is signed with a key file on your own machine, after you confirm: ${CMD} loot keygen ~/.config/xsolana/<game>.json makes one for a new economy, then ${CMD} loot approve ${file} --keypair <that file> shows everything it would send, and sends it only when run again with the code it prints. That key owns the project until it hands it over (${CMD} loot handover). For real money, a browser wallet (--browser), which can keep its key on a hardware device, is the safer choice; the owner runs it themselves.`,
      ]
    : [
        `Design the economy with the xsolana-economy skill and the xsolana_* tools (${CMD} loot connect adds them): xsolana_guide, xsolana_examples, xsolana_check, xsolana_simulate, then xsolana_save {"spec": …, "file": "${where}${ECONOMY_FILE}"} (a path from the game's folder, where the tools run), or from a terminal: ${CMD} loot check|simulate|cost|explain ${file}.`,
        `Then ${CMD} loot add ${game} again: it copies the page client into ${where}gf/loot/ beside it (publish does too).`,
        ...laid,
      ];
  // the same, in short: what to do next (the rest is --verbose's)
  const next = economy
    ? [
        ...laid,
        `Use it from the page: GamesFun.loot (${CMD} add signin), or the page client in ${where}gf/loot/. Try it: ${CMD} dev ${game}`,
        `To go live: ${CMD} loot keygen ~/.config/xsolana/<game>.json, then ${CMD} loot approve ${file} --keypair <that file>.`,
      ]
    : [
        `Write the economy in ${where}${ECONOMY_FILE}. Start from an example: ${CMD} loot examples <what you want>. Check it: ${CMD} loot check ${file}.`,
        `Then run ${CMD} loot add ${game} again, to copy the page client into ${where}gf/loot/.`,
        ...laid,
      ];
  return { home, economy, page, steps, next };
}
