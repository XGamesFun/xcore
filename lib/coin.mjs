// `xcore coin`: a coin that trades for a published game, launched through xgames.fun's launchpad and signed by a key
// file on this machine. The console's Token tab does the same with a browser wallet; this is the terminal's way, and
// opens no page.
//
//   GET    /api/kit/games/<id>/coin[?refresh=1]   → where the coin stands; the venues and pairs offered; pictures
//   POST   /api/kit/games/<id>/coin   {name, symbol, description?, picture, venue, pair, wallet}
//                                                  → {transactions: [base64], lastValidBlockHeight, mint, resume}
//   PUT    /api/kit/games/<id>/coin   {transactions: [base64]} (signed) → the status: the coin live, or `waiting`
//   DELETE /api/kit/games/<id>/coin                → gives up a launch that was never sent
//
// loot runs no market, so a coin that trades is launched on a venue (Meteora, pump.fun), and the game's economy then
// names its mint. xgames.fun's launchpad builds the launch's transactions; the key file signs them here; xgames.fun
// sends them and reads the chain.
//
// The key file signs something this machine did not make, and the code the person approves covers only their own
// choices. So before it signs, every transaction is read and held to being the launch the plan said, and nothing else
// (./coin-check.mjs has the whole rule): the venue's launch instructions only, with their settings read, for one new
// coin with the plan's name and ticker and this key as its creator; no fee beyond the venue's own, no buy, no move of
// a token the key holds, no change to another coin of the key's, and nothing of loot (the game's economy, which the
// same key may own). Anything else is refused, in words that say what it held, and the launch is given up.
//
// Like `xcore loot approve --keypair`, a launch sends nothing until it is run again with the code it prints: the code
// covers every choice (the game, the name, the ticker, the description, the picture, the venue, the pair and the key).
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkLaunch as holdToALaunch, MOST_LAMPORTS, NotALaunch, sol, VENUES } from './coin-check.mjs';
import { CMD } from './command.mjs';
import { lootProgram, solanaRoot } from './economy.mjs';
import { call, studioOrigin } from './publish/client.mjs';
import { readLinks } from './publish/index.mjs';
import { requireCredential } from './publish/oidc.mjs';
import { solanaRpc } from './solana-rpc.mjs';
import { stateFolder } from './state-folder.mjs';

/** A refusal in plain words; `code` is its word for scripts (`--json`). */
export class CoinError extends Error {
  constructor(message, code = 'coin') {
    super(message);
    this.code = code;
  }
}

export {
  LEAST_LIQUIDITY_PERCENT,
  LEAST_SHARE_BPS,
  LEAST_TRADING_FEE_PERCENT,
  MOST_LAMPORTS,
  VENUES,
} from './coin-check.mjs';
/**
 * What each venue gives the coin's creator, in the words the plan says: this command's own, never the server's, and
 * what ./coin-check.mjs holds a launch to.
 */
export const VENUE_WORDS = Object.freeze({
  meteora: 'Meteora: a curve of its own, then a pool. You keep about 40% of its trading fees.',
  pumpfun: 'pump.fun: its curve. The creator fee is shared half and half with xgames.fun.',
});
/** What a launch takes from the key, about, and the least it should hold before one is begun. */
export const ABOUT_SOL = '0.03',
  LEAST_LAMPORTS = 30_000_000n;
/** xgames.fun's refusals of a hand-in that mean nothing of it was sent to Solana. */
const NOT_SENT = new Set([
  'not-sent',
  'not-the-launch',
  'not-signed',
  'too-many',
  'not-published',
  'not-started',
  'launch-off',
]);
/** How long the key's balance is waited for: it is a line of the plan, never a reason to hold one up. */
const BALANCE_MS = 6000;
const EXPLORER = address => `https://explorer.solana.com/address/${address}?cluster=devnet`;

const NO_TOOLS =
  'The economy tools (@xgamesfun/solana) are not installed here: reinstall @xgamesfun/xcore (npm i @xgamesfun/xcore), or set GAMESFUN_SOLANA to a solana-kit checkout.';
/** The parts of @xgamesfun/solana a launch needs (its key files, its transaction reader, its RPC client). */
export async function solanaTools(env = process.env) {
  const root = solanaRoot(env);
  if (!root) throw new CoinError(NO_TOOLS, 'tools');
  const at = (...rel) => import(pathToFileURL(path.join(root, 'js', ...rel)).href);
  let parts;
  try {
    parts = await Promise.all([
      at('approve', 'keyfile.mjs'),
      at('chain', 'tx.js'),
      at('chain', 'bytes.js'),
      at('chain', 'rpc.js'),
      at('chain', 'base58.js'),
    ]);
  } catch {
    throw new CoinError(
      `The economy tools here are too old to sign with a key file (they need @xgamesfun/solana 0.27.2 or later). ${NO_TOOLS}`,
      'tools',
    );
  }
  const [keyfile, tx, bytes, rpc, base58] = parts;
  return {
    readKeyFile: keyfile.readKeyFile,
    readTransaction: tx.readTransaction,
    readMessage: tx.readMessage,
    isEmptySignature: tx.isEmptySignature,
    fromBase64: bytes.fromBase64,
    toBase64: bytes.toBase64,
    rpcClient: rpc.rpcClient,
    encodeBase58: base58.encodeBase58,
  };
}

/**
 * ./coin-check.mjs's check, with its refusal as this command's: what the launch held, and that nothing was signed.
 * → {mint, lamports, steps}
 */
export function checkLaunch(wires, options) {
  try {
    return holdToALaunch(wires, options);
  } catch (e) {
    if (!(e instanceof NotALaunch)) throw e;
    throw new CoinError(
      `The launch xgames.fun built is not one this key signs: ${e.message}. Nothing was signed and nothing was sent.`,
      'refused',
    );
  }
}

/** The game's id on xgames.fun (from its publish record) and how to sign the call. Throws in plain words. */
async function target(dir, { origin, env, fetchImpl }) {
  const known = (await readLinks(dir))[origin];
  if (!known?.projectId)
    throw new CoinError(
      `this folder's game is not on ${origin} yet: a coin is launched for a published game. Publish it first (${CMD} publish).`,
      'not-published',
    );
  const cred = await requireCredential(origin, { env, fetchImpl });
  return { id: known.projectId, auth: await cred.auth() };
}
const route = (id, query = '') => `/api/kit/games/${encodeURIComponent(id)}/coin${query}`;
/** xgames.fun's answer, or its refusal as this command's: an xgames.fun from before the route says so. */
async function ask(origin, id, options, query = '') {
  try {
    return await call(origin, route(id, query), options);
  } catch (e) {
    if (e?.status === 404 && e.answered === false)
      throw new CoinError(`xgames.fun at ${origin} does not launch coins from the command line yet.`, 'launch-off');
    throw e;
  }
}

/** What this folder recorded of a launch it began: {mint, venue} for this xgames.fun, or null. */
const recordFile = dir => path.join(dir, '.gamesfun', 'coin.json');
async function readRecord(dir, origin) {
  try {
    const r = JSON.parse(await readFile(recordFile(dir), 'utf8'))[origin];
    return typeof r?.mint === 'string' ? r : null;
  } catch {
    return null;
  }
}
async function writeRecord(dir, origin, record) {
  let all = {};
  try {
    all = JSON.parse(await readFile(recordFile(dir), 'utf8')) ?? {};
  } catch {
    /* none yet */
  }
  all[origin] = record;
  await stateFolder(dir);
  await writeFile(recordFile(dir), JSON.stringify(all, null, 2) + '\n');
}

/** → xgames.fun's status of the game's coin (`launch`, `own`, and while launching is on `venues`, `pictures`). */
export async function coinStatus(
  dir,
  { refresh = false, origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {},
) {
  const t = await target(dir, { origin, env, fetchImpl });
  return ask(origin, t.id, { ...t.auth, fetchImpl }, refresh ? '?refresh=1' : '');
}

/** Gives up a launch that was begun and never sent. → the status */
export async function dropLaunch(dir, { origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {}) {
  const t = await target(dir, { origin, env, fetchImpl });
  return ask(origin, t.id, { method: 'DELETE', ...t.auth, fetchImpl });
}

/** The code a launch is sent with: eight hex digits over every choice, so one read is the one sent. */
export function launchCode(plan) {
  const parts = ['game', 'name', 'symbol', 'description', 'picture', 'venue', 'pair', 'wallet'].map(k => [
    k,
    plan[k] ?? '',
  ]);
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 8);
}

/** The key's SOL, or null when no RPC answers (never a refusal: the launch itself is checked by the launchpad). */
async function balanceOf(address, { env, tools, fetchImpl }) {
  let timer;
  try {
    const rpc = solanaRpc(env);
    const read = tools.rpcClient(rpc.url, { fetchImpl, sleepImpl: async () => {} }).balance(address);
    read.catch(() => {});
    return await Promise.race([read, new Promise(resolve => (timer = setTimeout(resolve, BALANCE_MS, null)))]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** What a launch would do, in the words the person reads before they say yes. */
export function planText(plan, { game, keyFile, code, command }) {
  const venue = VENUE_WORDS[plan.venue] ?? VENUES[plan.venue]?.name ?? plan.venue;
  const lines = [
    `A coin for ${game}, launched on Solana devnet${plan.resume ? ' (the rest of a launch begun earlier)' : ''}:`,
    `  name         ${plan.name}`,
    `  ticker       ${plan.symbol}`,
    ...(plan.description ? [`  description  ${plan.description}`] : []),
    `  picture      ${plan.picture} (a file of the published game)`,
    `  where        ${venue}`,
    `  paired with  ${plan.pair}`,
    `  signed by    ${plan.wallet} (the key file ${keyFile})`,
    plan.balance == null
      ? '               its SOL could not be read from here'
      : `               it holds ${sol(plan.balance)} SOL${plan.balance < LEAST_LAMPORTS ? `: too little, send it devnet SOL first (a launch takes about ${ABOUT_SOL})` : ''}`,
    '',
    `What happens: xgames.fun's launchpad builds the launch, this key file signs it here, and xgames.fun sends it. It`,
    `takes about ${ABOUT_SOL} SOL from the key (rent for the coin's accounts, and fees). The coin's creator fees belong to`,
    `this key's address from then on: whoever holds the key file collects them, and nothing restores a lost one.`,
    '',
    'Before it signs, xcore reads every transaction the launchpad built and holds it to the launch above: this name and',
    "ticker, this key as the coin's creator with the share above, no fee beyond the venue's own, no buy, no move of a",
    "token the key holds, nothing of loot (the game's economy), and at most " +
      `${sol(MOST_LAMPORTS)} SOL in transfers and fees of`,
    'its own. Anything else is refused and nothing is signed.',
    '',
    'It can’t be undone: a game has one coin, and its name, ticker and picture stay as launched. Anyone can trade it',
    'from the moment it lands. A devnet coin trades nothing of value. Selling a token for real money is regulated in',
    'most places: that is yours to check before mainnet, and nothing here is legal advice.',
    '',
    `Nothing was sent. To launch it, run this again with the code:`,
    `  ${command} --yes ${code}`,
  ];
  return lines.join('\n');
}

/**
 * Plans a launch, and with `yes` (the code the plan printed) sends it. `form`: {name, symbol, description?, picture,
 * venue?, pair?}; `keyFile`: the key file's path.
 * → without `yes`: {ok, planned: true, code, plan}; with it: {ok, launched, waiting, mint, coin, explorer, steps}.
 */
export async function launchCoin(
  dir,
  form,
  { keyFile, yes = null, origin = studioOrigin(), env = process.env, fetchImpl = fetch, tools = null, keyReader } = {},
) {
  // The coin's words as they will read on chain (xgames.fun's own rules, held here first so the plan says what is
  // launched): the name as it is, less the spaces around it; the ticker in capitals, with no $ before it.
  const name = String(form.name ?? '').trim();
  const symbol = String(form.symbol ?? '')
    .trim()
    .replace(/^\$/, '')
    .toUpperCase();
  if (!name || Buffer.byteLength(name) > 32)
    throw new CoinError('--name is the coin’s name, at most 32 bytes.', 'usage');
  if (!/^[A-Z0-9]{2,10}$/.test(symbol))
    throw new CoinError('--ticker is 2 to 10 letters or digits (a coin’s ticker is launched in capitals).', 'usage');
  const kit = tools ?? (await solanaTools(env));
  const t = await target(dir, { origin, env, fetchImpl });
  const key = await (keyReader ?? kit.readKeyFile)(keyFile);
  try {
    const status = await ask(origin, t.id, { ...t.auth, fetchImpl });
    const off = !status?.launch?.on;
    if (off)
      throw new CoinError(
        status?.launch?.why ?? status?.why ?? 'Launching a coin is not on for this XGames.fun yet.',
        'launch-off',
      );
    const own = status.own ?? null;
    if (own?.kind === 'launched')
      throw new CoinError(
        `This game's coin is already launched: $${own.symbol} (${own.mint}). A game has one.`,
        'has-token',
      );
    if (own?.kind === 'linked')
      throw new CoinError(
        `This game uses $${own.symbol}, a token made elsewhere. Stop using it first (the game's console, Token tab) to launch a coin of its own.`,
        'has-token',
      );
    if (status.launch.sent)
      throw new CoinError(
        `This game's launch was already sent to Solana. See where it stands: ${CMD} coin`,
        'launch-sent',
      );
    const venues = Array.isArray(status.venues) ? status.venues : [];
    if (!venues.length)
      throw new CoinError('The launchpad is not offering a venue right now. Try again in a moment.', 'no-venue');
    const venue = form.venue ?? (venues.find(v => v.venue === 'meteora') ?? venues[0]).venue;
    const offered = venues.find(v => v.venue === venue);
    if (!offered || !VENUES[venue])
      throw new CoinError(`--venue is one of: ${venues.map(v => v.venue).join(', ')}`, 'usage');
    const pair = form.pair ?? (offered.pairs.find(p => p.symbol === 'SOL') ?? offered.pairs[0])?.symbol;
    if (!offered.pairs.some(p => p.symbol === pair))
      throw new CoinError(
        `--pair is one of: ${offered.pairs.map(p => p.symbol).join(', ')} (what ${VENUES[venue].name} pairs a coin with here)`,
        'usage',
      );
    const pictures = Array.isArray(status.pictures) ? status.pictures.map(p => p.path) : [];
    if (!form.picture || (!pictures.includes(form.picture) && !status.morePictures))
      throw new CoinError(
        pictures.length
          ? `--picture is a picture among the published game's files: ${pictures.slice(0, 12).join(', ')}${pictures.length > 12 ? ', …' : ''}`
          : 'The published game has no picture a coin can use (a PNG, JPEG or WebP among its files). Add one and publish, then launch.',
        'usage',
      );
    const plan = {
      game: t.id,
      name,
      symbol,
      description: String(form.description ?? '').trim(),
      picture: form.picture,
      venue,
      pair,
      wallet: key.address,
      resume: !!status.launch.partly,
      balance: await balanceOf(key.address, { env, tools: kit, fetchImpl }),
    };
    const code = launchCode(plan);
    if (!yes) return { ok: true, planned: true, code, plan };
    if (String(yes).trim().toLowerCase() !== code)
      throw new CoinError(
        'That code is not for this launch (a choice or the key changed since it was printed). Run it without --yes, read what it prints, and use the code it ends with.',
        'code',
      );
    if (plan.balance != null && plan.balance < LEAST_LAMPORTS)
      throw new CoinError(
        `The key holds ${sol(plan.balance)} SOL and a launch takes about ${ABOUT_SOL}. Send devnet SOL to ${key.address}, then run this again.`,
        'balance',
      );

    const prepared = await ask(origin, t.id, {
      method: 'POST',
      body: {
        name: plan.name,
        symbol: plan.symbol,
        description: plan.description,
        picture: plan.picture,
        venue,
        pair,
        wallet: key.address,
      },
      ...t.auth,
      fetchImpl,
    });
    const begun = await readRecord(dir, origin);
    let checked, wires;
    try {
      wires = (Array.isArray(prepared?.transactions) ? prepared.transactions : []).map(b => kit.fromBase64(b));
      checked = checkLaunch(wires, {
        wallet: key.address,
        venue,
        mint: prepared?.mint,
        name: plan.name,
        symbol: plan.symbol,
        origin: origin.startsWith('https://') ? origin : null,
        resume: !!prepared?.resume,
        begun: begun?.mint ?? null,
        loot: lootProgram(env),
        tools: kit,
      });
    } catch (e) {
      // never signed, so never sent: the launch is given up, and the game can begin another
      await ask(origin, t.id, { method: 'DELETE', ...t.auth, fetchImpl }).catch(() => {});
      throw e instanceof CoinError
        ? e
        : new CoinError(
            'The launch xgames.fun built could not be read here. Nothing was signed and nothing was sent.',
            'refused',
          );
    }
    await writeRecord(dir, origin, { mint: checked.mint, venue, begun: new Date().toISOString() });
    const signed = [];
    for (const wire of wires) signed.push(kit.toBase64(await key.signTransaction(wire)));
    let result;
    try {
      result = await ask(origin, t.id, { method: 'PUT', body: { transactions: signed }, ...t.auth, fetchImpl });
    } catch (e) {
      // xgames.fun said it sent nothing (in its own words), or its answer never came: then whether it was sent is
      // xgames.fun's to say, and `xcore coin` asks it
      if (NOT_SENT.has(e?.code)) throw Object.assign(new CoinError(e.message, e.code), { mint: checked.mint });
      throw Object.assign(
        new CoinError(
          `${e.message} The launch was signed and handed to xgames.fun; see where it stands with: ${CMD} coin`,
          typeof e.code === 'string' ? e.code : 'unknown',
        ),
        { mint: checked.mint, next: `${CMD} coin` },
      );
    }
    const coin = result?.own ?? null;
    const launched = coin?.kind === 'launched';
    return {
      ok: true,
      launched,
      waiting: !launched,
      partly: !!result?.launch?.partly,
      mint: checked.mint,
      coin,
      explorer: EXPLORER(checked.mint),
      steps: checked.steps,
    };
  } finally {
    key.drop?.();
  }
}

/** A coin's page on the explorer (devnet). */
export const explorerOf = EXPLORER;
