// What a key file signs when xgames.fun's launchpad built it: the launch of one new coin, as the plan said (`xcore coin
// launch`, ./coin.mjs).
//
// The launchpad builds the launch's transactions on its own server, so the key would sign something this machine did
// not make, and the code the person approved covers only their own choices. Everything else is the server's to choose,
// so it is read here before a signature is made. A launch is held to:
//
// - Legacy transactions (no lookup table: every account is in the message, so every account is read), one to four,
//   each paid for by the key. Every other signer's signature is there and is checked (Ed25519, over the message): a
//   new account's own key, which the launchpad holds. No account named twice. Nothing that names loot's program, of
//   either cluster.
// - Only these programs, and of each only these instructions:
//   - Compute Budget: each of its four once at most, with no accounts. Its priority fee is counted as the key's SOL.
//   - Associated Token: one new token account, only in a pump.fun launch paired with a token (the fee vault's
//     account of that token), paid for by the key and counted as its rent.
//   - The venue's own, by name, each once and in order, with exactly the accounts its program takes, the key, the
//     coin and the pair in the places the program reads them, and its settings read (below). Nothing else of the
//     venue's: no buy, no sell, no change to another coin. And nothing of the System or Token programs.
// - Meteora (one transaction): `create_config`, the curve's settings, for a config whose own new key signs; then
//   `initialize_virtual_pool_with_spl_token` on that very config, for the coin, created and paid for by the key. The
//   settings charge no fee for making the pool and none for moving to it, give the key at least half of the creator's
//   side of trading fees and half of the liquidity, leave the launchpad's half of the liquidity locked, keep the
//   coin's supply fixed, and leave nobody able to mint more of it or rename it.
// - pump.fun: `create_v2` for the coin, with the key as its creator and none of its optional modes; then
//   `sweep_creator_fee`, `create_fee_sharing_config` and `update_fee_shares_v2` for the same coin, where the key keeps
//   at least half. A launch begun earlier whose first transaction landed is the rest alone, and only for the coin,
//   venue, name and ticker this folder recorded when it signed the first.
// - The coin: its own new key signs the first transaction, and its name, ticker and link on chain are the plan's,
//   byte for byte. The pair is the plan's.
// - At most MOST_LAMPORTS of the key's SOL named, all together (fees and that one token account). Rent the venue's
//   program takes for the coin's own accounts is the program's, not in this sum (about 0.02 SOL).
//
// What is not read here, and is said so in the plan:
// - The picture and the description: they are what the coin's link serves, on xgames.fun.
// - The curve's shape on Meteora (where its price starts, where it moves to its pool, how the supply is spread along
//   it, its fee schedule): xgames.fun's own. A shape that leaves supply over sends it to the launchpad's account.
// - Which cluster: nothing in a transaction names one. ./coin.mjs asks a devnet RPC that each transaction's blockhash
//   is one of devnet's and that the coin's address holds nothing yet, before the key signs.
// And what this leans on: that each venue's program does what its instruction says and takes its accounts in the
// order its published interface gives (Meteora's Dynamic Bonding Curve, pump.fun and pump.fun's fee program, as of
// the SDKs the launchpad uses: tests/fixtures/coin-launch.json is built with them), and the Associated Token program.
import { createHash } from 'node:crypto';

const BUDGET = 'ComputeBudget111111111111111111111111111111';
const SYSTEM = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ASSOCIATED_TOKEN = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const DBC = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_FEES = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
/** SOL as a pair: the mint a venue's instructions name for it. */
export const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';

/** The most of the key's SOL a launch's transactions may name, all together. */
export const MOST_LAMPORTS = 100_000_000n;
/** pump.fun: the least of the coin's creator fee the key keeps, in basis points. */
export const LEAST_SHARE_BPS = 5000;
/**
 * Meteora: the least the key keeps of the trading fee left after Meteora's own cut, and of the liquidity the coin
 * moves to its pool with, in percent. (Half of what is left after Meteora's fifth is the "about 40%" a launch is told.)
 */
export const LEAST_TRADING_FEE_PERCENT = 50,
  LEAST_LIQUIDITY_PERCENT = 50;
/** A new token account is counted as this much of the key's SOL (a classic one's rent is 2,039,280). */
const TOKEN_ACCOUNT_LAMPORTS = 3_000_000n;
/** Meteora's settings: the coin's keys are nobody's (no more minted, no rename). */
const IMMUTABLE = 1;

/** Where a coin may be launched: its name in words, and the programs and instructions its launch is made of. */
export const VENUES = Object.freeze({
  meteora: { name: 'Meteora', programs: { [DBC]: ['create_config', 'initialize_virtual_pool_with_spl_token'] } },
  pumpfun: {
    name: 'pump.fun',
    programs: {
      [PUMP]: ['create_v2', 'sweep_creator_fee'],
      [PUMP_FEES]: ['create_fee_sharing_config', 'update_fee_shares_v2'],
    },
  },
});

/** A launch that is not one: `message` says what it held, in words that go after "… is not one this key signs: ". */
export class NotALaunch extends Error {}
const no = why => new NotALaunch(why);

/** An Anchor instruction's first eight bytes, as hex. */
const discriminator = name => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8).toString('hex');
export const sol = lamports => {
  const s = (Number(lamports) / 1e9).toFixed(4);
  return s.replace(/0+$/, '').replace(/\.$/, '') || '0';
};

/** An instruction's data read in order (Borsh), after its eight-byte name. Reading past the end throws. */
class Reader {
  constructor(data) {
    this.b = Buffer.from(data.buffer, data.byteOffset, data.length);
    this.at = 8;
  }
  take(n) {
    if (this.at + n > this.b.length) throw new RangeError('short');
    const part = this.b.subarray(this.at, this.at + n);
    this.at += n;
    return part;
  }
  u8() {
    return this.take(1)[0];
  }
  u16() {
    return this.take(2).readUInt16LE(0);
  }
  u32() {
    return this.take(4).readUInt32LE(0);
  }
  u64() {
    return this.take(8).readBigUInt64LE(0);
  }
  /** A text's own bytes, after their count: compared as bytes, never decoded (two texts that show alike differ here). */
  text() {
    const n = this.u32();
    if (n > 400) throw new RangeError('long');
    return Buffer.from(this.take(n));
  }
  /** A value that may be absent: one byte, 0 or 1, then the value. */
  some(read) {
    const tag = this.u8();
    if (tag > 1) throw new RangeError('tag');
    return tag ? read() : null;
  }
  get done() {
    return this.at === this.b.length;
  }
}
/** `read(reader)` over an instruction's whole data, or null when it is not laid out that way to its last byte. */
function parsed(data, read) {
  try {
    const r = new Reader(data);
    const value = read(r);
    return r.done ? value : null;
  } catch {
    return null;
  }
}

/** Meteora's `create_config` settings: the ones a launch is held to, read in the order the program lays them out. */
const curveSettings = data =>
  parsed(data, r => {
    r.take(27); // the base fee: its start, its steps, its mode
    r.some(() => r.take(32)); // a fee that follows volatility
    r.take(3); // which token fees are taken in, where the coin moves to, what its schedule counts in
    const tokenType = r.u8();
    r.take(1); // the coin's decimals
    const [partnerFree, partnerLocked, creatorFree, creatorLocked] = [r.u8(), r.u8(), r.u8(), r.u8()];
    r.take(8 + 16 + 40 + 1); // where the curve ends and starts, a vesting of the creator's, the fee tier it moves to
    const supply = r.some(() => [r.u64(), r.u64()]); // the coin's supply, before and after it moves to its pool
    const tradingFee = r.u8();
    const authority = r.u8();
    const movingFee = r.u8(); // a share of what was raised, taken as the coin moves to its pool
    r.take(1 + 4); // the creator's part of that fee; the pool's own fee
    const creationFee = r.u64();
    r.take(13 + 13 + 1 + 16 + 1 + 2 + 2); // vestings of liquidity, the pool's fee schedule, its first trade, padding
    const points = r.u32();
    if (points < 1 || points > 20) throw new RangeError('curve');
    r.take(32 * points);
    return {
      tokenType,
      partnerFree,
      partner: partnerFree + partnerLocked,
      creator: creatorFree + creatorLocked,
      supply,
      tradingFee,
      authority,
      movingFee,
      creationFee,
    };
  });
/** A coin's name, ticker and link, as both venues' creating instructions begin: each its own bytes. */
const named = r => ({ name: r.text(), symbol: r.text(), uri: r.text() });

/**
 * The key's share of a pump.fun coin's creator fee in an `update_fee_shares_v2`, in basis points (0 when it is not
 * among the shareholders), or null when the data is not a list of {address, share} that adds up to the whole.
 */
function feeShare(data, wallet, tools) {
  const shares = parsed(data, r => {
    const count = r.u32();
    if (count > 10) throw new RangeError('count');
    return Array.from({ length: count }, () => ({ address: tools.encodeBase58(r.take(32)), bps: r.u16() }));
  });
  if (!shares || shares.reduce((sum, s) => sum + s.bps, 0) !== 10_000) return null;
  return shares.filter(s => s.address === wallet).reduce((sum, s) => sum + s.bps, 0);
}

/** The venue instructions of a launch, each once and in this order; `optional` ones may be left out. */
function inOrder(found, order, venue) {
  let next = 0;
  const seen = {};
  for (const ix of found) {
    const at = order.findIndex((o, i) => i >= next && o.name === ix.name);
    if (at < 0)
      throw no(
        `${ix.where} holds a ${ix.name} where a launch on ${venue} has none (a second one, or out of its order)`,
      );
    for (const skipped of order.slice(next, at))
      if (!skipped.optional) throw no(`it has no ${skipped.name}, which a launch on ${venue} has`);
    seen[ix.name] = ix;
    next = at + 1;
  }
  for (const missing of order.slice(next))
    if (!missing.optional) throw no(`it has no ${missing.name}, which a launch on ${venue} has`);
  return seen;
}
const WHOSE = { coin: 'the coin being launched', pair: 'the pair in the plan' };
/**
 * Holds an instruction to the accounts its program takes: how many (`count`), and the ones in the places it reads
 * them from: {index: [address, what it is]}.
 */
function placed(ix, count, places) {
  if (ix.accounts.length !== count)
    throw no(`${ix.where} holds a ${ix.name} with ${ix.accounts.length} accounts, where its program takes ${count}`);
  for (const [index, [address, what]] of Object.entries(places))
    if (ix.accounts[index] !== address)
      throw no(`${ix.where} holds a ${ix.name} whose ${what} is not ${WHOSE[what] ?? 'this key'}`);
}
/** The coin's name, ticker and link on chain are the plan's, byte for byte. */
function asPlanned(ix, said, ctx) {
  if (!said) throw no(`${ix.where} holds a ${ix.name} that can’t be read here`);
  if (!said.name.equals(Buffer.from(ctx.name, 'utf8')) || !said.symbol.equals(Buffer.from(ctx.symbol, 'utf8')))
    throw no(`${ix.where} makes a coin with another name or ticker than the plan’s`);
  // The link is the coin's own on the xgames.fun the launch came from. With no https one to hold it to (a Studio on
  // this machine), it is still an https link of that one shape.
  const uri = said.uri.toString('latin1');
  const fits = ctx.origin
    ? uri === `${ctx.origin}/meta/token/${ctx.mint}.json`
    : new RegExp(`^https://[a-z0-9.-]+(:[0-9]+)?/meta/token/${ctx.mint}\\.json$`).test(uri);
  if (!fits) throw no(`${ix.where} gives the coin a link that is not its own on ${ctx.origin ?? 'xgames.fun'}`);
}

const LAUNCHES = {
  /** One transaction: a curve's settings under a new key, then the coin's pool on those very settings. */
  meteora(found, ctx) {
    if (ctx.resume) throw no('it is called the rest of an earlier launch, which a launch on Meteora never has');
    const { create_config: config, initialize_virtual_pool_with_spl_token: pool } = inOrder(
      found,
      [{ name: 'create_config' }, { name: 'initialize_virtual_pool_with_spl_token' }],
      'Meteora',
    );
    if (config.n !== 0 || pool.n !== 0) throw no('its Meteora launch is not in its first transaction');
    // create_config: 0 the new config (its own key signs), 3 the pair, 4 who pays
    placed(config, 8, { 3: [ctx.quote, 'pair'], 4: [ctx.wallet, 'payer'] });
    const settings = config.accounts[0];
    if (settings === ctx.wallet || settings === ctx.mint || !config.signers.includes(settings))
      throw no(`${config.where} makes its curve’s settings at an account whose own key did not sign`);
    const s = curveSettings(config.data);
    if (!s) throw no(`${config.where} holds curve settings that can’t be read here`);
    if (s.creationFee !== 0n)
      throw no(`${config.where} sets a fee of ${s.creationFee} lamports for making the pool, which this key would pay`);
    if (s.movingFee !== 0)
      throw no(`${config.where} takes ${s.movingFee}% of what the coin raises as it moves to its pool`);
    if (s.tradingFee < LEAST_TRADING_FEE_PERCENT)
      throw no(
        `${config.where} gives this key ${s.tradingFee}% of the creator’s side of the trading fees, not the ${LEAST_TRADING_FEE_PERCENT}% it was told`,
      );
    if (s.creator < LEAST_LIQUIDITY_PERCENT || s.creator + s.partner !== 100)
      throw no(
        `${config.where} gives this key ${s.creator}% of the coin’s liquidity, not the ${LEAST_LIQUIDITY_PERCENT}% it was told`,
      );
    if (s.partnerFree !== 0)
      throw no(`${config.where} leaves the launchpad’s part of the liquidity free to be taken out`);
    if (!s.supply || s.supply[0] !== s.supply[1] || s.supply[0] === 0n)
      throw no(`${config.where} does not keep the coin’s supply fixed`);
    if (s.authority !== IMMUTABLE || s.tokenType !== 0)
      throw no(`${config.where} leaves someone able to mint more of the coin or rename it`);
    // initialize_virtual_pool_with_spl_token: 0 the config, 2 the creator, 3 the coin's mint, 4 the pair, 10 who pays
    placed(pool, 16, {
      2: [ctx.wallet, 'creator'],
      3: [ctx.mint, 'coin'],
      4: [ctx.quote, 'pair'],
      10: [ctx.wallet, 'payer'],
    });
    if (pool.accounts[0] !== settings)
      throw no(`${pool.where} makes the coin’s pool on other settings than the ones this launch makes`);
    asPlanned(pool, parsed(pool.data, named), ctx);
    return [
      'the curve’s settings (no fee for the pool; this key keeps its share of the trading fees)',
      'the coin and its pool',
    ];
  },

  /** The coin, then its fee split; or, for a coin whose first transaction landed earlier, the split alone. */
  pumpfun(found, ctx) {
    const seen = inOrder(
      found,
      [
        { name: 'create_v2', optional: ctx.resume },
        { name: 'sweep_creator_fee', optional: true },
        { name: 'create_fee_sharing_config', optional: true },
        { name: 'update_fee_shares_v2' },
      ],
      'pump.fun',
    );
    const token = ctx.quote !== WRAPPED_SOL; // paired with a token: the instructions carry its accounts too
    const steps = [];
    const create = seen.create_v2;
    if (create) {
      if (ctx.resume) throw no('it is called the rest of an earlier launch and makes a coin all the same');
      // (it is in the first transaction: the coin's key signs that one, and nothing of pump.fun's comes before this)
      // create_v2: 0 the coin's mint, 5 who makes it and pays; paired with a token, 16 that token
      placed(create, token ? 20 : 16, {
        0: [ctx.mint, 'coin'],
        5: [ctx.wallet, 'payer'],
        ...(token ? { 16: [ctx.quote, 'pair'] } : {}),
      });
      const said = parsed(create.data, r => ({
        ...named(r),
        creator: ctx.tools.encodeBase58(r.take(32)),
        modes: [...r.take(11)],
      }));
      asPlanned(create, said, ctx);
      if (said.creator !== ctx.wallet)
        throw no(
          `${create.where} makes the coin with another creator than this key, so its creator fees would not be this key’s`,
        );
      if (said.modes.some(Boolean))
        throw no(`${create.where} makes the coin in a mode of pump.fun’s that the plan did not say`);
      steps.push('the coin, with this key as its creator');
    }
    // sweep_creator_fee: 0 who pays, 2 the coin, 3 the pair; it takes no settings
    if (seen.sweep_creator_fee) {
      placed(seen.sweep_creator_fee, 13, { 0: [ctx.wallet, 'payer'], 2: [ctx.mint, 'coin'], 3: [ctx.quote, 'pair'] });
      if (seen.sweep_creator_fee.data.length !== 8)
        throw no(`${seen.sweep_creator_fee.where} holds a sweep_creator_fee that can’t be read here`);
    }
    // create_fee_sharing_config: 2 who pays, 4 the coin; it takes no settings
    if (seen.create_fee_sharing_config) {
      placed(seen.create_fee_sharing_config, 13, { 2: [ctx.wallet, 'payer'], 4: [ctx.mint, 'coin'] });
      if (seen.create_fee_sharing_config.data.length !== 8)
        throw no(`${seen.create_fee_sharing_config.where} holds a create_fee_sharing_config that can’t be read here`);
    }
    // update_fee_shares_v2: 2 whose coin it is, 4 the coin, 14 the pair, 19 who shared it before (the key alone)
    const split = seen.update_fee_shares_v2;
    placed(split, token ? 21 : 20, {
      2: [ctx.wallet, 'authority'],
      4: [ctx.mint, 'coin'],
      14: [ctx.quote, 'pair'],
      19: [ctx.wallet, 'authority'],
    });
    const share = feeShare(split.data, ctx.wallet, ctx.tools);
    if (share == null) throw no(`${split.where} sets a split of the coin’s creator fee that can’t be read here`);
    if (share < LEAST_SHARE_BPS)
      throw no(`${split.where} gives this key ${share / 100}% of the coin’s creator fee, not the half it was told`);
    steps.push(`its creator fee: this key keeps ${share / 100}%`);
    return steps;
  },
};

/**
 * Holds a launch's transactions to being the launch the plan said, before the key signs them. `wires`: the
 * transactions as the launchpad built them (bytes), in order. `wallet`: the key's address. `venue`, `name`, `symbol`:
 * the plan's. `quote`: the mint of what the plan pairs the coin with (WRAPPED_SOL for SOL). `mint`: the coin the
 * launchpad says it is launching. `origin`: the xgames.fun the launch came from (an https origin: the coin's link
 * must be on it), or null. `resume`: the launchpad says the coin exists already and this is the rest of its launch;
 * then `begun` is what this folder recorded when it signed the first part ({mint, venue, name, symbol}, or null).
 * `loot`: loot's program addresses (all of them, never none). `tools`: @xgamesfun/solana's readTransaction,
 * readMessage, verifySignature and encodeBase58. → {mint, lamports (the key's SOL the transactions name), steps:
 * [what it does, in words], blockhashes: [each transaction's]}. Throws a NotALaunch that says what it found.
 */
export function checkLaunch(
  wires,
  { wallet, venue, mint, name, symbol, quote, origin = null, resume = false, begun = null, loot, tools },
) {
  const own = VENUES[venue];
  if (!own || !LAUNCHES[venue]) throw no(`it is for a venue this command does not know (${venue})`);
  if (!Array.isArray(wires) || !wires.length || wires.length > 4) throw no('it is not one to four transactions');
  if (typeof mint !== 'string' || !mint || mint === wallet) throw no('it does not say which coin it launches');
  if (typeof name !== 'string' || !name || typeof symbol !== 'string' || !symbol || typeof quote !== 'string' || !quote)
    throw no('the plan it is checked against names no coin or no pair');
  if (!Array.isArray(loot) || !loot.length || !loot.every(a => typeof a === 'string' && a))
    throw no('loot’s address is not known here, so a launch can’t be held clear of the game’s economy');
  const names = new Map();
  for (const [program, list] of Object.entries(own.programs))
    names.set(program, new Map(list.map(n => [discriminator(n), n])));

  const found = [];
  const blockhashes = [];
  let lamports = 0n,
    tokenAccounts = 0,
    mintSigned = false;
  wires.forEach((wire, n) => {
    const where = wires.length > 1 ? `transaction ${n + 1} of ${wires.length}` : 'its transaction';
    let t, m;
    try {
      t = tools.readTransaction(wire);
      m = tools.readMessage(t.message);
    } catch {
      throw no(`${where} is not a transaction`);
    }
    if (m.version !== 'legacy' || m.lookups.length)
      throw no(`${where} loads accounts from a lookup table, so what it touches can’t be read here`);
    if (new Set(m.keys).size !== m.keys.length) throw no(`${where} names an account twice`);
    if (t.signers[0] !== wallet) throw no(`${where} is not paid for by this key`);
    // Every other signer is a new account's own key (the coin's mint, a curve's settings), which the launchpad holds:
    // its signature over this very message is there. A slot that is filled with anything else is no signature.
    t.signers.forEach((signer, slot) => {
      if (slot === 0) return;
      if (!t.signatures[slot] || !tools.verifySignature(signer, t.message, t.signatures[slot]))
        throw no(`${where} wants a signature of ${signer}, which is not there (and is not this key’s to give)`);
      if (signer === mint && n === 0) mintSigned = true;
    });
    for (const address of loot)
      if (m.keys.includes(address)) throw no(`${where} names loot, the program of the game’s economy`);
    blockhashes.push(m.blockhash);
    const at = i => {
      if (i >= m.keys.length) throw no(`${where} names an account it does not list`);
      return m.keys[i];
    };
    const budgets = new Set();
    let limit = null,
      price = 0n,
      others = 0;
    for (const ix of m.instructions) {
      const program = at(ix.programIndex);
      const accounts = ix.accountIndexes.map(at);
      const data = Buffer.from(ix.data.buffer, ix.data.byteOffset, ix.data.length);
      if (program === BUDGET) {
        const kind = data[0];
        if (
          accounts.length ||
          ![1, 2, 3, 4].includes(kind) ||
          data.length !== (kind === 3 ? 9 : 5) ||
          budgets.has(kind)
        )
          throw no(`${where} holds a compute budget instruction of a kind not known here, or one twice`);
        budgets.add(kind);
        if (kind === 2) limit = BigInt(data.readUInt32LE(1));
        if (kind === 3) price = data.readBigUInt64LE(1);
        continue;
      }
      others++;
      if (program === ASSOCIATED_TOKEN) {
        // One new token account (none or 0: made; 1: made if it is not there yet), for the pair's token, paid for by
        // the key: the fee vault's own, in a pump.fun launch paired with a token. Nowhere else.
        const fits =
          venue === 'pumpfun' &&
          quote !== WRAPPED_SOL &&
          (data.length === 0 || (data.length === 1 && data[0] <= 1)) &&
          accounts.length === 6 &&
          accounts[0] === wallet &&
          accounts[1] !== wallet &&
          accounts[3] === quote &&
          accounts[4] === SYSTEM &&
          (accounts[5] === TOKEN || accounts[5] === TOKEN_2022);
        if (!fits || ++tokenAccounts > 1)
          throw no(`${where} holds an associated-token instruction that is no part of this launch`);
        lamports += TOKEN_ACCOUNT_LAMPORTS;
        continue;
      }
      const known = names.get(program);
      if (!known)
        throw no(
          `${where} calls the program ${program}, which is no part of a launch on ${own.name}${loot.includes(program) ? ' (it is loot, the program of the game’s economy)' : ''}`,
        );
      const called = known.get(data.subarray(0, 8).toString('hex'));
      if (!called) throw no(`${where} holds an instruction of ${own.name} that is not part of a launch`);
      found.push({ n, where, name: called, accounts, data, signers: t.signers });
    }
    // its fees: 5,000 lamports a signature, and its priority fee at the most units it may use
    const units = limit ?? BigInt(Math.min(1_400_000, 200_000 * Math.max(1, others)));
    lamports += 5000n * BigInt(t.signers.length) + (units * price + 999_999n) / 1_000_000n;
  });

  // Which coin: a new one's own key signs the first transaction (so it is a key the launchpad made for this launch);
  // the rest of a launch begun earlier is for the coin this folder recorded then, as it was planned then.
  if (resume) {
    if (!begun?.mint)
      throw no(
        'it is the rest of a launch that was not begun from this folder, so which coin it is for can’t be checked here: finish it where it was begun (the game’s console, Token tab)',
      );
    if (begun.mint !== mint) throw no('it is for another coin than the one this folder began launching');
    if (begun.venue !== venue || begun.name !== name || begun.symbol !== symbol)
      throw no(
        'it is the rest of the launch this folder began, which was of another name, ticker or venue than this plan’s',
      );
  } else if (!mintSigned) throw no('the coin it launches is not a new one (its own key did not sign)');

  const steps = LAUNCHES[venue](found, { wallet, mint, name, symbol, quote, origin, resume, tools });
  if (lamports > MOST_LAMPORTS)
    throw no(`it names ${sol(lamports)} SOL of this key’s, more than the ${sol(MOST_LAMPORTS)} SOL a launch may name`);
  return { mint, lamports, steps, blockhashes };
}
