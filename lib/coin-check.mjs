// What a key file signs when xgames.fun's launchpad built it: the launch of one new coin, as the plan said, and nothing
// else (`xcore coin launch`, ./coin.mjs).
//
// The launchpad builds the launch's transactions on its own server, so the key would sign something this machine did
// not make, and the code the person approved covers only their own choices. Everything else is the server's to choose,
// so everything else is read here before a signature is made. A launch is held to:
//
// - Legacy transactions (no lookup table: every account is in the message, so every account is read), one to four,
//   each paid for by the key, with every other signer's signature already there (a new account's own key, held by the
//   launchpad). No account named twice. Nothing that names loot, the program of the game's economy.
// - Only these programs, and of each only these instructions:
//   - Compute Budget: any of its four, with no accounts. Its priority fee is counted as the key's SOL.
//   - System: a new account paid for by the key, or a transfer from the key. Their lamports are counted.
//   - Associated Token: a new token account paid for by the key, two at most, each counted as its rent.
//   - The venue's own, by name, each exactly once and in order, with the key and the coin in the places the program
//     reads them from, and with its settings read (below). Nothing else of the venue's: no buy, no sell, no change to
//     another coin.
// - Meteora (one transaction): `create_config`, the curve's settings, for a config whose own new key signs; then
//   `initialize_virtual_pool_with_spl_token` on that very config, for the coin, created and paid for by the key. The
//   settings must charge no fee for making the pool, give the key at least the share of trading fees and of liquidity
//   it was told, and leave the coin with nobody able to mint more or rename it.
// - pump.fun: `create_v2` for the coin, with the key as its creator and none of its optional modes; then
//   `sweep_creator_fee`, `create_fee_sharing_config` and `update_fee_shares_v2` for the same coin, where the key keeps
//   at least half. A launch begun earlier whose first transaction landed is the rest alone, and only for the coin this
//   folder recorded when it signed the first.
// - The coin: its own new key signs the first transaction (so it is no coin that exists), and its name, ticker and
//   link on chain are the plan's.
// - At most MOST_LAMPORTS of the key's SOL named, all together. Rent the venue's program takes for the coin's own
//   accounts is the program's, not in this sum, and is the same for every launch (about 0.02 SOL).
//
// What this leans on, and cannot read from here: that each venue's program does what its instruction says and takes
// the accounts in the order its published interface gives (Meteora's Dynamic Bonding Curve, pump.fun and pump.fun's
// fee program, as of the SDKs the launchpad uses: tests/fixtures/coin-launch.json is built with them).
import { createHash } from 'node:crypto';

const SYSTEM = '11111111111111111111111111111111';
const BUDGET = 'ComputeBudget111111111111111111111111111111';
const ASSOCIATED_TOKEN = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const DBC = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_FEES = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';

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
/** A new token account is counted as this much of the key's SOL (a classic one's rent is 2,039,280), two at most. */
const TOKEN_ACCOUNT_LAMPORTS = 3_000_000n,
  MOST_TOKEN_ACCOUNTS = 2;
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
  string() {
    const n = this.u32();
    if (n > 400) throw new RangeError('long');
    return new TextDecoder('utf-8', { fatal: true }).decode(this.take(n));
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
    const partner = r.u8() + r.u8();
    const creator = r.u8() + r.u8();
    r.take(8 + 16 + 40 + 1); // where the curve ends and starts, a vesting of the creator's, the fee tier it moves to
    r.some(() => r.take(16)); // the coin's supply
    const tradingFee = r.u8();
    const authority = r.u8();
    r.take(2 + 4); // a fee on moving to the pool; the pool's own fee
    const creationFee = r.u64();
    r.take(13 + 13 + 1 + 16 + 1 + 2 + 2); // vestings of liquidity, the pool's fee schedule, its first trade, padding
    const points = r.u32();
    if (points > 20) throw new RangeError('curve');
    r.take(32 * points);
    return { tokenType, partner, creator, tradingFee, authority, creationFee };
  });
/** A coin's name, ticker and link, as both venues' creating instructions begin. */
const named = r => ({ name: r.string(), symbol: r.string(), uri: r.string() });

/**
 * The key's share of a pump.fun coin's creator fee in an `update_fee_shares_v2`, in basis points (0 when it is not
 * among the shareholders), or null when the data is not a list of {address, share} that adds up to the whole.
 */
function feeShare(data, wallet, tools) {
  const shares = parsed(data, r => {
    const count = r.u32();
    if (count < 1 || count > 10) throw new RangeError('count');
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
/** Holds an instruction's accounts to the places its program reads them from: {index: [address, what it is]}. */
function placed(ix, places) {
  for (const [index, [address, what]] of Object.entries(places))
    if (ix.accounts[index] !== address)
      throw no(
        `${ix.where} holds a ${ix.name} whose ${what} is not ${what === 'coin' ? 'the coin being launched' : 'this key'}`,
      );
}
/** The coin's name, ticker and link on chain are the plan's. */
function asPlanned(ix, said, ctx) {
  if (!said) throw no(`${ix.where} holds a ${ix.name} that can’t be read here`);
  if (said.name !== ctx.name || said.symbol !== ctx.symbol)
    throw no(
      `${ix.where} makes a coin named ${JSON.stringify(said.name)} with the ticker ${JSON.stringify(said.symbol)}, not the one in the plan`,
    );
  let link = null;
  try {
    link = new URL(said.uri);
  } catch {
    /* not a link */
  }
  const fits =
    link &&
    link.protocol === 'https:' &&
    !link.search &&
    !link.hash &&
    !link.username &&
    link.pathname === `/meta/token/${ctx.mint}.json` &&
    (!ctx.origin || link.origin === ctx.origin);
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
    // create_config: 0 the new config (its own key signs), 4 who pays
    placed(config, { 4: [ctx.wallet, 'payer'] });
    const settings = config.accounts[0];
    if (settings === ctx.wallet || settings === ctx.mint || !config.signers.includes(settings))
      throw no(`${config.where} makes its curve’s settings at an account whose own key did not sign`);
    const s = curveSettings(config.data);
    if (!s) throw no(`${config.where} holds curve settings that can’t be read here`);
    if (s.creationFee !== 0n)
      throw no(`${config.where} sets a fee of ${sol(s.creationFee)} SOL for making the pool, which this key would pay`);
    if (s.tradingFee < LEAST_TRADING_FEE_PERCENT)
      throw no(
        `${config.where} gives this key ${s.tradingFee}% of the creator’s side of the trading fees, not the ${LEAST_TRADING_FEE_PERCENT}% it was told`,
      );
    if (s.creator < LEAST_LIQUIDITY_PERCENT || s.creator + s.partner !== 100)
      throw no(
        `${config.where} gives this key ${s.creator}% of the coin’s liquidity, not the ${LEAST_LIQUIDITY_PERCENT}% it was told`,
      );
    if (s.authority !== IMMUTABLE || s.tokenType !== 0)
      throw no(`${config.where} leaves someone able to mint more of the coin or rename it`);
    // initialize_virtual_pool_with_spl_token: 0 the config, 2 the creator, 3 the coin's mint, 10 who pays
    placed(pool, { 2: [ctx.wallet, 'creator'], 3: [ctx.mint, 'coin'], 10: [ctx.wallet, 'payer'] });
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
    const steps = [];
    const create = seen.create_v2;
    if (create) {
      if (ctx.resume) throw no('it is called the rest of an earlier launch and makes a coin all the same');
      if (create.n !== 0) throw no('it does not make the coin in its first transaction');
      // create_v2: 0 the coin's mint, 5 who makes it and pays
      placed(create, { 0: [ctx.mint, 'coin'], 5: [ctx.wallet, 'payer'] });
      const said = parsed(create.data, r => ({
        ...named(r),
        creator: tools58(ctx, r.take(32)),
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
    // sweep_creator_fee: 0 who pays, 2 the coin; it takes no settings
    if (seen.sweep_creator_fee) {
      placed(seen.sweep_creator_fee, { 0: [ctx.wallet, 'payer'], 2: [ctx.mint, 'coin'] });
      if (seen.sweep_creator_fee.data.length !== 8)
        throw no(`${seen.sweep_creator_fee.where} holds a sweep_creator_fee that can’t be read here`);
    }
    // create_fee_sharing_config: 2 who pays, 4 the coin; it takes no settings
    if (seen.create_fee_sharing_config) {
      placed(seen.create_fee_sharing_config, { 2: [ctx.wallet, 'payer'], 4: [ctx.mint, 'coin'] });
      if (seen.create_fee_sharing_config.data.length !== 8)
        throw no(`${seen.create_fee_sharing_config.where} holds a create_fee_sharing_config that can’t be read here`);
    }
    // update_fee_shares_v2: 2 whose coin it is, 4 the coin
    const split = seen.update_fee_shares_v2;
    placed(split, { 2: [ctx.wallet, 'authority'], 4: [ctx.mint, 'coin'] });
    const share = feeShare(split.data, ctx.wallet, ctx.tools);
    if (share == null) throw no(`${split.where} sets a split of the coin’s creator fee that can’t be read here`);
    if (share < LEAST_SHARE_BPS)
      throw no(`${split.where} gives this key ${share / 100}% of the coin’s creator fee, not the half it was told`);
    steps.push(`its creator fee: this key keeps ${share / 100}%`);
    return steps;
  },
};
const tools58 = (ctx, bytes) => ctx.tools.encodeBase58(bytes);

/**
 * Holds a launch's transactions to being the launch the plan said, before the key signs them. `wires`: the
 * transactions as the launchpad built them (bytes), in order. `wallet`: the key's address. `venue`, `name`, `symbol`:
 * the plan's. `mint`: the coin the launchpad says it is launching. `origin`: the xgames.fun the launch came from (an
 * https origin: the coin's link must be on it), or null. `resume`: the launchpad says the coin exists already and this
 * is the rest of its launch; then `begun` is the mint this folder recorded when it signed the first part (null: none
 * recorded). `loot`: loot's address. `tools`: @xgamesfun/solana's readTransaction, readMessage, isEmptySignature and
 * encodeBase58. → {mint, lamports (the key's SOL the transactions name), steps: [what it does, in words]}. Throws a
 * NotALaunch that says what it found.
 */
export function checkLaunch(
  wires,
  { wallet, venue, mint, name, symbol, origin = null, resume = false, begun = null, loot = null, tools },
) {
  const own = VENUES[venue];
  if (!own || !LAUNCHES[venue]) throw no(`it is for a venue this command does not know (${venue})`);
  if (!Array.isArray(wires) || !wires.length || wires.length > 4) throw no('it is not one to four transactions');
  if (typeof mint !== 'string' || !mint || mint === wallet) throw no('it does not say which coin it launches');
  if (typeof name !== 'string' || !name || typeof symbol !== 'string' || !symbol)
    throw no('the plan it is checked against names no coin');
  const names = new Map();
  for (const [program, list] of Object.entries(own.programs))
    names.set(program, new Map(list.map(n => [discriminator(n), n])));

  const found = [];
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
    // every other signer is a new account's own key (the coin's mint, a curve's settings), signed by the launchpad
    t.signers.forEach((signer, slot) => {
      if (slot === 0) return;
      if (!t.signatures[slot] || tools.isEmptySignature(t.signatures[slot]))
        throw no(`${where} wants a signature of ${signer}, which is not this key’s to give`);
      if (signer === mint && n === 0) mintSigned = true;
    });
    if (loot && m.keys.includes(loot)) throw no(`${where} names loot, the program of the game’s economy`);
    const at = i => {
      if (i >= m.keys.length) throw no(`${where} names an account it does not list`);
      return m.keys[i];
    };
    let limit = null,
      price = 0n,
      others = 0;
    for (const ix of m.instructions) {
      const program = at(ix.programIndex);
      const accounts = ix.accountIndexes.map(at);
      const data = Buffer.from(ix.data.buffer, ix.data.byteOffset, ix.data.length);
      if (program === BUDGET) {
        const kind = data[0];
        if (accounts.length || ![1, 2, 3, 4].includes(kind) || data.length !== (kind === 3 ? 9 : 5))
          throw no(`${where} holds a compute budget instruction of a kind not known here`);
        if (kind === 2) limit = BigInt(data.readUInt32LE(1));
        if (kind === 3) price = data.readBigUInt64LE(1);
        continue;
      }
      others++;
      if (program === SYSTEM) {
        // 0: a new account, paid for by the key (then its size and owner); 2: a transfer from the key
        const kind = data.length >= 4 ? data.readUInt32LE(0) : null;
        const whole = (kind === 0 && data.length === 52) || (kind === 2 && data.length === 12);
        if (!whole || accounts.length !== 2 || accounts[0] !== wallet || accounts[1] === wallet)
          throw no(`${where} holds a System instruction that is not a new account or a transfer of this key’s`);
        lamports += data.readBigUInt64LE(4);
        continue;
      }
      if (program === ASSOCIATED_TOKEN) {
        // none or 0: a token account for an owner and a mint; 1: the same, if it is not there yet
        if (data.length > 1 || (data.length === 1 && data[0] > 1) || accounts[0] !== wallet)
          throw no(`${where} holds an associated-token instruction that is not a new token account`);
        if (++tokenAccounts > MOST_TOKEN_ACCOUNTS)
          throw no(`it makes more than ${MOST_TOKEN_ACCOUNTS} token accounts, each paid for by this key`);
        lamports += TOKEN_ACCOUNT_LAMPORTS;
        continue;
      }
      const known = names.get(program);
      if (!known)
        throw no(
          `${where} calls the program ${program}, which is no part of a launch on ${own.name}${program === loot ? ' (it is loot, the program of the game’s economy)' : ''}`,
        );
      const called = known.get(data.subarray(0, 8).toString('hex'));
      if (!called) throw no(`${where} holds an instruction of ${own.name} that is not part of a launch`);
      found.push({ n, where, name: called, accounts, data, signers: t.signers });
    }
    // its fees: 5,000 lamports a signature, and its priority fee at the most units it may use
    const units = limit ?? BigInt(Math.min(1_400_000, 200_000 * Math.max(1, others)));
    lamports += 5000n * BigInt(t.signers.length) + (units * price + 999_999n) / 1_000_000n;
  });

  // Which coin: a new one's own key signs the first transaction (so it is no coin that exists); the rest of a launch
  // begun earlier is for the coin this folder recorded then, and no other.
  if (resume) {
    if (!begun)
      throw no(
        'it is the rest of a launch that was not begun from this folder, so which coin it is for can’t be checked here: finish it where it was begun (the game’s console, Token tab)',
      );
    if (begun !== mint) throw no('it is for another coin than the one this folder began launching');
  } else if (!mintSigned) throw no('the coin it launches is not a new one (its own key did not sign)');

  const steps = LAUNCHES[venue](found, { wallet, mint, name, symbol, origin, resume, tools });
  if (lamports > MOST_LAMPORTS)
    throw no(`it names ${sol(lamports)} SOL of this key’s, more than the ${sol(MOST_LAMPORTS)} SOL a launch may name`);
  return { mint, lamports, steps };
}
