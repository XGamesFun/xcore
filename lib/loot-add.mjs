// `xcore loot add` (../commands/loot.mjs): a game's economy put where its build publishes it, with its page client.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pageRoots, readPage, writePage } from './publish/page.mjs';
import { CMD } from './command.mjs';
import { ECONOMY_FILE, economyFile, installPage, NO_SOLANA, readEconomy, solanaRoot } from './economy.mjs';

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
  // an economy file that does not read is refused, named, before anything is copied or written
  readEconomy(dir);
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
        `Publish keeps the client in ${where}gf/loot/ up to date.`,
        `The client is the solana kit (@xgamesfun/solana), and its docs cover every call. In a web page with gamesfun.js (${CMD} add signin ${game}), const { data } = await GamesFun.loot.app() gives the kit's app, set up for this game's network and relay: data.app.shop(), .buy(key, { listing }), .openBox(key, { listing }), .recover(). Call app() again after GamesFun.loot.connect() to sign with the wallet.`,
        "For Godot or Unity, use GamesFun.loot.call('shop'), the same calls with JSON in and out. The shop call returns listings in data.",
        'For a page without gamesfun.js, import gf/loot/play/index.js relative to the page. Pass the network from your spec to the wallet and RPC. See docs/CLIENT.md for both examples.',
        `Preview setup with ${CMD} loot approve ${file} --keypair <key file>. Read the transactions before confirming with the code. For a browser wallet, run the command yourself with --browser instead of --keypair.`,
      ]
    : [
        `In the game folder, save your spec as ${where}${ECONOMY_FILE}. Use ${CMD} loot examples <idea> for a starting point. Check it with ${CMD} loot check ${file}.`,
        `With a coding agent, use xsolana_save {"spec": …, "file": "${where}${ECONOMY_FILE}"} from the game folder.`,
        `${CMD} dev ${game} and publish install the page client next to it, so there is no second ${CMD} loot add. Publish keeps it up to date.`,
        ...laid,
      ];
  // the same, in short: what to do next (the rest is --verbose's)
  const next = economy
    ? [
        ...laid,
        `In a web page, use the solana kit through GamesFun.loot.app() with gamesfun.js (${CMD} add signin ${game}); in Godot or Unity, GamesFun.loot.call. See docs/CLIENT.md. Test with ${CMD} dev ${game}.`,
        `Create a project key with ${CMD} loot keygen ~/.config/xsolana/my-game.json. Preview setup with ${CMD} loot approve ${file} --keypair ~/.config/xsolana/my-game.json.`,
      ]
    : [
        `Save your spec as ${where}${ECONOMY_FILE} in the game folder. Check it with ${CMD} loot check ${file}.`,
        `Then test it with ${CMD} dev ${game}, which installs the page client.`,
        ...laid,
      ];
  return { home, economy, page, steps, next };
}
