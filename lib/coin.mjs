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
// choices. So before it signs:
// - every transaction is read and held to being the launch the plan said (./coin-check.mjs has the whole rule, and
//   says what it does not read);
// - a devnet RPC is asked that each transaction is one of devnet's (its blockhash is among devnet's last 150) and that
//   the coin's address holds nothing yet. Nothing in a transaction names its cluster, so this is the only thing that
//   holds a launch to devnet: with no RPC to ask, nothing is signed. The RPC is the person's own (XSOLANA_RPC_URL),
//   else Solana's public one, else (when that does not answer) xgames.fun's own, said as that: it is the same party
//   as the launchpad, so it holds an accident, not a launchpad that means harm.
// Anything else is refused, in words that say what it held, and the launch is given up.
//
// Like `xcore loot approve --keypair`, a launch sends nothing until it is run again with the code it prints: the code
// covers every choice (the game, the name, the ticker, the description, the picture, the venue, the pair and the key).
//
// What xgames.fun sends back is shown on a terminal, so it is cleaned first (`clean`): no control character, no
// line break, nothing that hides or reorders text.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkLaunch as holdToALaunch, MOST_LAMPORTS, NotALaunch, sol, VENUES, WRAPPED_SOL } from './coin-check.mjs';
import { CMD } from './command.mjs';
import { lootProgram, solanaRoot } from './economy.mjs';
import { call, studioOrigin } from './publish/client.mjs';
import { readLinks } from './publish/index.mjs';
import { requireCredential } from './publish/oidc.mjs';
import { SHARED_RPC, solanaRpc } from './solana-rpc.mjs';
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
  WRAPPED_SOL,
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
/** loot's address on mainnet (devnet's is read from the installed tools): a launch names neither. */
export const LOOT_MAINNET = 'xgames8C758PyweWB9sDw8evvwsTVwyA2fGRUeAXVPy';
/** Solana's public devnet RPC, devnet's first block, and the account that lists devnet's last 150 blockhashes. */
export const DEVNET_RPC = 'https://api.devnet.solana.com';
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const RECENT_BLOCKHASHES = 'SysvarRecentB1ockHashes11111111111111111111';
const LOCAL = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?(\/|$)/i;
/** xgames.fun's refusals of a hand-in that say nothing of it was sent to Solana. */
const NOT_SENT = new Set([
  'not-sent',
  'not-the-launch',
  'not-signed',
  'too-many',
  'not-published',
  'not-started',
  'launch-off',
]);
/** How long one RPC is waited for before the next is asked. */
const RPC_MS = 8000;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/**
 * What a terminal must not be handed: the control characters (C0, DEL, C1), the Arabic letter mark, the zero-width
 * and direction marks, the line and paragraph separators, the embedding and isolate controls, the invisible
 * operators, and the byte order mark.
 */
const UNSHOWN = new RegExp(
  '[' +
    [
      [0x00, 0x1f],
      [0x7f, 0x9f],
      [0x61c, 0x61c],
      [0x200b, 0x200f],
      [0x2028, 0x202e],
      [0x2060, 0x206f],
      [0xfeff, 0xfeff],
    ]
      .map(([from, to]) => `\\u${from.toString(16).padStart(4, '0')}-\\u${to.toString(16).padStart(4, '0')}`)
      .join('') +
    ']',
  'g',
);
const EXPLORER = address => `https://explorer.solana.com/address/${address}?cluster=devnet`;

/**
 * Text from xgames.fun as a terminal may show it: no control character (an escape sequence hides or recolours what
 * follows; a line break forges a line), none of the marks that reorder or hide text, and no more than `most`
 * characters. What is not text is nothing.
 */
export function clean(text, most = 300) {
  if (typeof text !== 'string') return '';
  return text.replace(UNSHOWN, '').slice(0, most);
}
/** An address from xgames.fun, or the words for one that is not an address. */
export const cleanAddress = text => (typeof text === 'string' && ADDRESS.test(text) ? text : '(not an address)');

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
      at('approve', 'ed25519.mjs'),
      at('chain', 'tx.js'),
      at('chain', 'bytes.js'),
      at('chain', 'rpc.js'),
      at('chain', 'base58.js'),
    ]);
  } catch {
    parts = null;
  }
  const [keyfile, ed25519, tx, bytes, rpc, base58] = parts ?? [];
  if (!keyfile?.readKeyFile || !ed25519?.verifySignature || !rpc?.rpcClient)
    throw new CoinError(
      `The economy tools here are too old to sign with a key file (they need @xgamesfun/solana 0.27.2 or later). ${NO_TOOLS}`,
      'tools',
    );
  return {
    readKeyFile: keyfile.readKeyFile,
    verifySignature: ed25519.verifySignature,
    readTransaction: tx.readTransaction,
    readMessage: tx.readMessage,
    fromBase64: bytes.fromBase64,
    toBase64: bytes.toBase64,
    rpcClient: rpc.rpcClient,
    encodeBase58: base58.encodeBase58,
  };
}

/**
 * ./coin-check.mjs's check, with its refusal as this command's: what the launch held, and that nothing was signed.
 * → {mint, lamports, steps, blockhashes}
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
/** xgames.fun's answer, or its refusal as this command's: its words cleaned, an xgames.fun from before the route said so. */
async function ask(origin, id, options, query = '') {
  try {
    return await call(origin, route(id, query), options);
  } catch (e) {
    if (e?.status === 404 && e.answered === false)
      throw new CoinError(`xgames.fun at ${origin} does not launch coins from the command line yet.`, 'launch-off');
    if (typeof e?.message === 'string') e.message = clean(e.message, 400);
    if (typeof e?.code === 'string') e.code = clean(e.code, 40);
    throw e;
  }
}

/** What this folder recorded of a launch it began: {mint, venue, name, symbol} for this xgames.fun, or null. */
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

/** Asks xgames.fun to give up a launch that was begun and never sent. → the status */
export async function dropLaunch(dir, { origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {}) {
  const t = await target(dir, { origin, env, fetchImpl });
  return ask(origin, t.id, { method: 'DELETE', ...t.auth, fetchImpl });
}

/** The code a launch is sent with: eight hex digits over every choice, so one read is the one sent. */
export function launchCode(plan) {
  const parts = ['game', 'name', 'symbol', 'description', 'picture', 'venue', 'pair', 'quote', 'wallet'].map(k => [
    k,
    plan[k] ?? '',
  ]);
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 8);
}

/**
 * The devnet RPCs a launch is checked against, in the order they are asked: the person's own, else Solana's public
 * one and then xgames.fun's own. → [{name, url, own (theirs), independent (not xgames.fun's)}]
 */
export function devnetRpcs(env = process.env) {
  const set = solanaRpc(env);
  if (!set.shared) return [{ name: 'your own RPC (XSOLANA_RPC_URL)', url: set.url, own: true, independent: true }];
  return [
    { name: 'Solana’s public devnet RPC', url: DEVNET_RPC, own: false, independent: true },
    { name: 'xgames.fun’s own devnet RPC', url: SHARED_RPC, own: false, independent: false },
  ];
}
/** `work(rpc)` on the first RPC that answers. → {value, through: its name, independent}. Throws when none does. */
async function onDevnet(work, { env, tools, fetchImpl }) {
  let said = null;
  for (const chain of devnetRpcs(env)) {
    const rpc = tools.rpcClient(chain.url, {
      fetchImpl,
      sleepImpl: ms => new Promise(r => setTimeout(r, Math.min(ms, 300))),
    });
    let timer;
    try {
      const value = await Promise.race([
        (async () => {
          // which cluster it is, whatever its address says (a validator on this machine is its own)
          const genesis = await rpc.call('getGenesisHash');
          if (genesis !== DEVNET_GENESIS && !LOCAL.test(chain.url))
            throw new CoinError(
              `${chain.own ? 'XSOLANA_RPC_URL' : chain.name} is not a devnet RPC, and coins are launched on devnet only. Nothing was signed.`,
              'not-devnet',
            );
          return work(rpc);
        })(),
        new Promise((_, reject) => (timer = setTimeout(reject, RPC_MS, new Error('no answer in time')))),
      ]);
      return { value, through: chain.name, independent: chain.independent };
    } catch (e) {
      if (e instanceof CoinError) throw e;
      said = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new CoinError(
    `Solana devnet could not be read from here (${clean(String(said?.message ?? 'no answer'), 120)}). Try again in a minute, or set XSOLANA_RPC_URL to a devnet RPC of your own.`,
    'chain',
  );
}
/** The blockhashes in devnet's own list of its last 150, as addresses read. */
function recentBlockhashes(account, tools) {
  const data = account?.data ? Buffer.from(account.data) : null;
  if (!data || data.length < 8) return null;
  const hashes = new Set();
  for (let at = 8; at + 40 <= data.length; at += 40) hashes.add(tools.encodeBase58(data.subarray(at, at + 32)));
  return hashes;
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
    `  paired with  ${plan.pair}${plan.quote === WRAPPED_SOL ? '' : ` (the token ${plan.quote})`}`,
    `  signed by    ${plan.wallet} (the key file ${keyFile})`,
    plan.balance == null
      ? '               its SOL could not be read from here'
      : `               it holds ${sol(plan.balance)} SOL${plan.balance < LEAST_LAMPORTS ? `: too little, send it devnet SOL first (a launch takes about ${ABOUT_SOL})` : ''}`,
    '',
    `What happens: xgames.fun's launchpad builds the launch, this key file signs it here, and xgames.fun sends it. It`,
    `takes about ${ABOUT_SOL} SOL from the key (rent for the coin's accounts, and fees). The coin's creator fees belong to`,
    `this key's address from then on: whoever holds the key file collects them, and nothing restores a lost one.`,
    '',
    'Before it signs, xcore reads every transaction the launchpad built and holds it to the launch above: this name,',
    "ticker and pair, this key as the coin's creator with the share above, no fee beyond the venue's own, no buy, no",
    `move of a token the key holds, nothing of loot (the game's economy), and at most ${sol(MOST_LAMPORTS)} SOL in fees of its own. It`,
    "also asks a devnet RPC that the transactions are devnet's and the coin's address is new. Anything else is refused",
    'and nothing is signed.',
    '',
    'What xcore cannot read is xgames.fun’s to get right: the picture and the description (they are what the coin’s',
    'link serves), and on Meteora the curve’s shape (its prices, and how the supply is spread along it).',
    '',
    'It can’t be undone: a game has one coin, and its name and ticker stay as launched. Anyone can trade it from the',
    'moment it lands. A devnet coin trades nothing of value. Selling a token for real money is regulated in most',
    'places: that is yours to check before mainnet, and nothing here is legal advice.',
    '',
    `Nothing was sent. To launch it, run this again with the code:`,
    `  ${command} --yes ${code}`,
  ];
  return lines.join('\n');
}

/**
 * Plans a launch, and with `yes` (the code the plan printed) sends it. `form`: {name, symbol, description?, picture,
 * venue?, pair?}; `keyFile`: the key file's path.
 * → without `yes`: {ok, planned: true, code, plan}; with it: {ok, launched, waiting, partly, mint, coin, explorer,
 *   steps, checkedThrough (the RPC that said it is devnet's), independent (whether that RPC is not xgames.fun's)}.
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
  if (!name || Buffer.byteLength(name) > 32 || name !== clean(name))
    throw new CoinError('--name is the coin’s name: plain text of at most 32 bytes.', 'usage');
  if (!/^[A-Z0-9]{2,10}$/.test(symbol))
    throw new CoinError('--ticker is 2 to 10 letters or digits (a coin’s ticker is launched in capitals).', 'usage');
  const kit = tools ?? (await solanaTools(env));
  const loot = [lootProgram(env), LOOT_MAINNET].filter(Boolean);
  const t = await target(dir, { origin, env, fetchImpl });
  const key = await (keyReader ?? kit.readKeyFile)(keyFile);
  try {
    const status = await ask(origin, t.id, { ...t.auth, fetchImpl });
    if (!status?.launch?.on)
      throw new CoinError(
        clean(status?.launch?.why ?? status?.why) || 'Launching a coin is not on for this XGames.fun yet.',
        'launch-off',
      );
    const own = status.own ?? null;
    if (own?.kind === 'launched')
      throw new CoinError(
        `This game's coin is already launched: $${clean(own.symbol, 20)} (${cleanAddress(own.mint)}). A game has one.`,
        'has-token',
      );
    if (own?.kind === 'linked')
      throw new CoinError(
        `This game uses $${clean(own.symbol, 20)}, a token made elsewhere. Stop using it first (the game's console, Token tab) to launch a coin of its own.`,
        'has-token',
      );
    if (status.launch.sent)
      throw new CoinError(
        `This game's launch was already sent to Solana. See where it stands: ${CMD} coin`,
        'launch-sent',
      );
    const venues = (Array.isArray(status.venues) ? status.venues : []).filter(
      v => VENUES[v?.venue] && Array.isArray(v.pairs),
    );
    if (!venues.length)
      throw new CoinError('The launchpad is not offering a venue right now. Try again in a moment.', 'no-venue');
    const venue = form.venue ?? (venues.find(v => v.venue === 'meteora') ?? venues[0]).venue;
    const offered = venues.find(v => v.venue === venue);
    if (!offered) throw new CoinError(`--venue is one of: ${venues.map(v => v.venue).join(', ')}`, 'usage');
    const pairs = offered.pairs.filter(p => typeof p?.symbol === 'string' && /^[A-Za-z0-9.-]{1,16}$/.test(p.symbol));
    const pair = form.pair ?? (pairs.find(p => p.symbol === 'SOL') ?? pairs[0])?.symbol;
    const paired = pairs.find(p => p.symbol === pair);
    if (!paired)
      throw new CoinError(
        `--pair is one of: ${pairs.map(p => p.symbol).join(', ')} (what ${VENUES[venue].name} pairs a coin with here)`,
        'usage',
      );
    // What the pair is on chain: SOL is SOL's own mint, whatever xgames.fun says; any other is the token it names,
    // which the plan shows, the code covers and the launch is held to.
    const isSol = paired.symbol === 'SOL';
    const fits = isSol
      ? paired.mint === 'SOL' || paired.mint === WRAPPED_SOL
      : ADDRESS.test(paired.mint ?? '') && paired.mint !== WRAPPED_SOL;
    if (!fits)
      throw new CoinError(
        `xgames.fun names a token for ${pair} that is not one a coin is paired with. Nothing was begun.`,
        'pair',
      );
    const quote = isSol ? WRAPPED_SOL : paired.mint;
    const pictures = Array.isArray(status.pictures)
      ? status.pictures.map(p => clean(p?.path, 200)).filter(Boolean)
      : [];
    if (!form.picture || (!pictures.includes(form.picture) && !status.morePictures))
      throw new CoinError(
        pictures.length
          ? `--picture is a picture among the published game's files: ${pictures.slice(0, 12).join(', ')}${pictures.length > 12 ? ', …' : ''}`
          : 'The published game has no picture a coin can use (a PNG, JPEG or WebP among its files). Add one and publish, then launch.',
        'usage',
      );
    const read = await onDevnet(rpc => rpc.balance(key.address), { env, tools: kit, fetchImpl }).catch(() => null);
    const plan = {
      game: t.id,
      name,
      symbol,
      description: clean(String(form.description ?? '').trim(), 1000),
      picture: form.picture,
      venue,
      pair,
      quote,
      wallet: key.address,
      resume: !!status.launch.partly,
      balance: read?.value ?? null,
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
    let checked, wires, chain;
    try {
      // the plan said a new launch, or the rest of one: what was built is that
      if (!!prepared?.resume !== plan.resume)
        throw new CoinError(
          `The launch xgames.fun built is not one this key signs: it is ${prepared?.resume ? 'the rest of an earlier launch' : 'a new launch'}, and the plan said ${plan.resume ? 'the rest of an earlier one' : 'a new one'}. Nothing was signed and nothing was sent.`,
          'refused',
        );
      wires = (Array.isArray(prepared?.transactions) ? prepared.transactions : []).map(b => kit.fromBase64(b));
      checked = checkLaunch(wires, {
        wallet: key.address,
        venue,
        mint: prepared?.mint,
        name: plan.name,
        symbol: plan.symbol,
        quote,
        origin: origin.startsWith('https://') ? origin : null,
        resume: plan.resume,
        begun,
        loot,
        tools: kit,
      });
      // Devnet's, and a coin that is new there (or, for the rest of a launch, one that is there): asked of a devnet
      // RPC. With none to ask, nothing is signed.
      chain = await onDevnet(
        async rpc => {
          const recent = recentBlockhashes(await rpc.account(RECENT_BLOCKHASHES), kit);
          const there = await rpc.account(checked.mint);
          if (!recent?.size) throw new Error('devnet’s recent blockhashes could not be read');
          if (!checked.blockhashes.every(b => recent.has(b)))
            throw new CoinError(
              'The launch xgames.fun built is not one this key signs: a transaction of it is not one of devnet’s, or was built too long ago to be sent. Nothing was signed and nothing was sent. Run the launch again.',
              'refused',
            );
          if (plan.resume ? !there : !!there)
            throw new CoinError(
              `The launch xgames.fun built is not one this key signs: ${plan.resume ? 'the coin it is the rest of is not on devnet' : 'the coin it launches is on devnet already, so it is not a new one'}. Nothing was signed and nothing was sent.`,
              'refused',
            );
          return true;
        },
        { env, tools: kit, fetchImpl },
      );
    } catch (e) {
      // never signed, so never sent: the launch is given up, and the game can begin another
      await ask(origin, t.id, { method: 'DELETE', ...t.auth, fetchImpl }).catch(() => {});
      if (e instanceof CoinError)
        throw e.code === 'chain' ? new CoinError(`${e.message} Nothing was signed.`, 'chain') : e;
      throw new CoinError(
        'The launch xgames.fun built could not be read here. Nothing was signed and nothing was sent.',
        'refused',
      );
    }
    await writeRecord(dir, origin, {
      mint: checked.mint,
      venue,
      name: plan.name,
      symbol: plan.symbol,
      begun: new Date().toISOString(),
    });
    const signed = [];
    for (const wire of wires) signed.push(kit.toBase64(await key.signTransaction(wire)));
    let result;
    try {
      result = await ask(origin, t.id, { method: 'PUT', body: { transactions: signed }, ...t.auth, fetchImpl });
    } catch (e) {
      // Signed and handed over. Whatever xgames.fun then says of it is its word: only it knows what it sent, so
      // every refusal ends with where to ask how the launch stands.
      throw Object.assign(
        new CoinError(
          NOT_SENT.has(e?.code)
            ? `xgames.fun says: ${e.message} (The launch was signed and handed to it; ${CMD} coin says where it stands.)`
            : `${e.message} The launch was signed and handed to xgames.fun; see where it stands with: ${CMD} coin`,
          typeof e.code === 'string' && e.code ? e.code : 'unknown',
        ),
        { mint: checked.mint, next: `${CMD} coin` },
      );
    }
    const coin = result?.own ?? null;
    const launched = coin?.kind === 'launched' && coin.mint === checked.mint;
    return {
      ok: true,
      launched,
      waiting: !launched,
      partly: !launched && !!result?.launch?.partly,
      mint: checked.mint,
      coin: launched ? { name: plan.name, symbol: plan.symbol, venue, pair, mint: checked.mint } : null,
      explorer: EXPLORER(checked.mint),
      steps: checked.steps,
      checkedThrough: chain.through,
      independent: chain.independent,
    };
  } finally {
    key.drop?.();
  }
}

/** A coin's page on the explorer (devnet). */
export const explorerOf = EXPLORER;
