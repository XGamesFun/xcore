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
// The key file signs something this machine did not make, so each transaction is held to being a launch and nothing
// else before it is signed (checkLaunch): the instructions of a launch on the venue chosen, for the coin being
// launched, with a bound on the SOL it names. No buy, no move of a token the key holds, no change to another coin of
// the key's, and nothing of loot (the game's economy, which the same key may own). A transaction that is anything
// else is refused, in words that say what it held, and the launch is given up.
//
// Like `xcore loot approve --keypair`, a launch sends nothing until it is run again with the code it prints: the code
// covers every choice (the game, the name, the ticker, the description, the picture, the venue, the pair and the key).
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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

const SYSTEM = '11111111111111111111111111111111';
const BUDGET = 'ComputeBudget111111111111111111111111111111';
const ASSOCIATED_TOKEN = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
/**
 * A venue's own programs and the instructions of each that a launch is made of. Anything else of theirs (a buy, a
 * sell, a change of who a coin's fees go to) is not a launch.
 */
export const VENUES = Object.freeze({
  meteora: {
    name: 'Meteora',
    programs: {
      dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN: [
        'create_config',
        'initialize_virtual_pool_with_spl_token',
        'initialize_virtual_pool_with_token2022',
      ],
    },
  },
  pumpfun: {
    name: 'pump.fun',
    programs: {
      '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': ['create_v2', 'sweep_creator_fee'],
      pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ: ['create_fee_sharing_config', 'update_fee_shares_v2'],
    },
  },
});
/** A venue instruction that is about no coin yet: a curve's own settings, made before its pool. */
const NO_COIN = new Set(['create_config']);
/** The instruction that sets who a pump.fun coin's creator fee goes to, and the least of it the key keeps. */
const FEE_SPLIT = 'update_fee_shares_v2';
export const LEAST_SHARE_BPS = 5000;
/**
 * The most SOL a launch's transactions may name, all together: what the key's own instructions move (new accounts,
 * transfers) and its fees. A launch names far less; rent the venue's program takes for the coin's accounts is its own
 * (about 0.02 SOL) and is not in this sum.
 */
export const MOST_LAMPORTS = 100_000_000n;
/** What a launch takes from the key, about, and the least it should hold before one is begun. */
export const ABOUT_SOL = '0.03',
  LEAST_LAMPORTS = 30_000_000n;
/** How long the key's balance is waited for: it is a line of the plan, never a reason to hold one up. */
const BALANCE_MS = 6000;
const EXPLORER = address => `https://explorer.solana.com/address/${address}?cluster=devnet`;

/** An Anchor instruction's first eight bytes, as hex. */
const discriminator = name => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8).toString('hex');
const hex = bytes => Buffer.from(bytes).toString('hex');
const u32 = (data, at) => (data.length >= at + 4 ? Buffer.from(data).readUInt32LE(at) : null);
const u64 = (data, at) => (data.length >= at + 8 ? Buffer.from(data).readBigUInt64LE(at) : null);
const sol = lamports => {
  const s = (Number(lamports) / 1e9).toFixed(4);
  return s.replace(/0+$/, '').replace(/\.$/, '') || '0';
};

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
 * Holds a launch's transactions to being a launch, before the key signs them. `wires`: the transactions as the
 * launchpad built them (bytes), in order. `wallet`: the key's address. `venue`: the venue chosen. `mint`: the coin
 * the launchpad says it is launching. `resume`: the launchpad says the coin exists already and this is the rest of its
 * launch; then `begun` is the mint this folder recorded when it signed the first part (null: none recorded). `loot`:
 * loot's address. → {mint, lamports (the SOL the transactions name), steps: [what each instruction is, in words]}.
 * Throws a CoinError (`refused`) that says what it found.
 */
export function checkLaunch(wires, { wallet, venue, mint, resume = false, begun = null, loot = null, tools }) {
  const refuse = why =>
    new CoinError(
      `The launch xgames.fun built is not one this key signs: ${why}. Nothing was signed and nothing was sent.`,
      'refused',
    );
  const own = VENUES[venue];
  if (!own) throw refuse(`it is for a venue this command does not know (${venue})`);
  if (!Array.isArray(wires) || !wires.length || wires.length > 4) throw refuse('it is not one to four transactions');
  if (typeof mint !== 'string' || !mint) throw refuse('it does not say which coin it launches');
  const allowed = new Map();
  for (const [program, names] of Object.entries(own.programs))
    allowed.set(program, new Map(names.map(n => [discriminator(n), n])));

  const steps = [];
  let lamports = 0n,
    mintSigned = false;
  wires.forEach((wire, n) => {
    const where = wires.length > 1 ? `transaction ${n + 1} of ${wires.length}` : 'its transaction';
    let t, m;
    try {
      t = tools.readTransaction(wire);
      m = tools.readMessage(t.message);
    } catch {
      throw refuse(`${where} is not a transaction`);
    }
    if (m.version !== 'legacy' || m.lookups.length)
      throw refuse(`${where} loads accounts from a lookup table, so what it touches can’t be read here`);
    if (new Set(m.keys).size !== m.keys.length) throw refuse(`${where} names an account twice`);
    if (t.signers[0] !== wallet) throw refuse(`${where} is not paid for by this key`);
    // every other signer is a new account's own key (the coin's mint, a curve's settings), signed by the launchpad
    t.signers.forEach((signer, slot) => {
      if (slot === 0) return;
      if (!t.signatures[slot] || tools.isEmptySignature(t.signatures[slot]))
        throw refuse(`${where} wants a signature of ${signer}, which is not this key’s to give`);
      if (signer === mint && n === 0) mintSigned = true;
    });
    if (loot && m.keys.includes(loot)) throw refuse(`${where} names loot, the program of the game’s economy`);
    const at = i => {
      if (i >= m.keys.length) throw refuse(`${where} names an account it does not list`);
      return m.keys[i];
    };
    let limit = null,
      price = 0n,
      others = 0;
    for (const ix of m.instructions) {
      const program = at(ix.programIndex);
      const accounts = ix.accountIndexes.map(at);
      if (program === BUDGET) {
        const kind = ix.data[0];
        if (accounts.length || ![1, 2, 3, 4].includes(kind))
          throw refuse(`${where} holds a compute budget instruction of a kind not known here`);
        if (kind === 2) limit = BigInt(u32(ix.data, 1) ?? 0);
        if (kind === 3) price = u64(ix.data, 1) ?? 0n;
        continue;
      }
      others++;
      if (program === SYSTEM) {
        const kind = u32(ix.data, 0);
        const amount = u64(ix.data, 4);
        // 0: a new account, paid for by the key; 2: a transfer from the key
        if ((kind !== 0 && kind !== 2) || amount == null || accounts[0] !== wallet)
          throw refuse(`${where} holds a System instruction that is not a new account or a transfer of this key’s`);
        lamports += amount;
        steps.push(`${kind === 0 ? 'a new account' : 'a transfer'} of ${sol(amount)} SOL`);
        continue;
      }
      if (program === ASSOCIATED_TOKEN) {
        // none or 0: a token account for an owner and a mint; 1: the same, if it is not there yet
        if (ix.data.length > 1 || (ix.data.length === 1 && ix.data[0] > 1) || accounts[0] !== wallet)
          throw refuse(`${where} holds an associated-token instruction that is not a new token account`);
        steps.push('a token account');
        continue;
      }
      const names = allowed.get(program);
      if (!names)
        throw refuse(
          `${where} calls the program ${program}, which is no part of a launch on ${own.name}${program === loot ? ' (it is loot, the program of the game’s economy)' : ''}`,
        );
      const name = names.get(hex(ix.data.subarray(0, 8)));
      if (!name) throw refuse(`${where} holds an instruction of ${own.name} that is not part of a launch`);
      if (!NO_COIN.has(name) && !accounts.includes(mint))
        throw refuse(`${where} holds a ${name} that is not for the coin being launched`);
      if (name === FEE_SPLIT) {
        const share = feeShare(ix.data, wallet, tools);
        if (share == null) throw refuse(`${where} sets a split of the coin’s creator fee that can’t be read here`);
        if (share < LEAST_SHARE_BPS)
          throw refuse(`${where} gives this key ${share / 100}% of the coin’s creator fee, not the half it was told`);
        steps.push(`${name} (this key keeps ${share / 100}% of the creator fee)`);
      } else steps.push(name);
    }
    // its fees: 5,000 lamports a signature, and its priority fee at the most units it may use
    const units = limit ?? BigInt(Math.min(1_400_000, 200_000 * Math.max(1, others)));
    lamports += 5000n * BigInt(t.signers.length) + (units * price + 999_999n) / 1_000_000n;
  });
  if (lamports > MOST_LAMPORTS)
    throw refuse(
      `it names ${sol(lamports)} SOL of this key’s, more than the ${sol(MOST_LAMPORTS)} SOL a launch may name`,
    );
  // Which coin: a new one's own key signs the first transaction (so it is no coin that exists); the rest of a launch
  // begun earlier is for the coin this folder recorded then, and no other.
  if (resume) {
    if (!begun)
      throw refuse(
        'it is the rest of a launch that was not begun from this folder, so which coin it is for can’t be checked here: finish it where it was begun (the game’s console, Token tab)',
      );
    if (begun !== mint) throw refuse('it is for another coin than the one this folder began launching');
  } else if (!mintSigned) throw refuse('the coin it launches is not a new one (its own key did not sign)');
  return { mint, lamports, steps };
}

/**
 * This key's share of a pump.fun coin's creator fee in an update_fee_shares_v2's data, in basis points (0 when it is
 * not among the shareholders), or null when the data is not a list of {address, share}: eight bytes, a count, then 34
 * bytes a shareholder.
 */
function feeShare(data, wallet, tools) {
  const count = u32(data, 8);
  if (count == null || count < 1 || count > 10 || data.length !== 12 + 34 * count) return null;
  let share = 0,
    total = 0;
  for (let i = 0; i < count; i++) {
    const at = 12 + 34 * i;
    const bps = Buffer.from(data).readUInt16LE(at + 32);
    total += bps;
    if (tools.encodeBase58(data.subarray(at, at + 32)) === wallet) share += bps;
  }
  return total === 10_000 ? share : null;
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
  const venue = plan.venueSays ?? VENUES[plan.venue]?.name ?? plan.venue;
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
    'Before it signs, xcore holds each transaction to being a launch on that venue for this one new coin: no buy, no',
    "move of a token the key holds, nothing of loot (the game's economy), and at most " +
      `${sol(MOST_LAMPORTS)} SOL named. Anything else is refused.`,
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
      name: form.name,
      symbol: form.symbol,
      description: form.description ?? '',
      picture: form.picture,
      venue,
      venueSays: offered.says ?? null,
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
      // signed and handed over: whether it was sent is xgames.fun's to say
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
