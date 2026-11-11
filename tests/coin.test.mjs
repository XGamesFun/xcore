// `xcore coin` (lib/coin.mjs, lib/coin-check.mjs, commands/coin.mjs): a coin that trades, launched through xgames.fun's
// launchpad and signed by a key file here. The launchpad builds the transactions, so the tests hold what stands
// between it and the key: real launches of both venues pass (tests/fixtures/coin-launch.json, built with the
// launchpad's own SDKs), and the same launches with anything more, anything else or anything missing are refused before
// a signature is made. Each launch is made over with keys of this run, so the signatures the check verifies are real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeBase58, encodeBase58 } from '@xgamesfun/solana/chain/base58';
import { compactU16, fromBase64, toBase64 } from '@xgamesfun/solana/chain/bytes';
import {
  compileMessage,
  isEmptySignature,
  readMessage,
  readTransaction,
  signersOf,
  wireTransaction,
} from '@xgamesfun/solana/chain/tx';
import {
  checkLaunch,
  clean,
  cleanAddress,
  CoinError,
  coinStatus,
  DEVNET_RPC,
  devnetRpcs,
  dropLaunch,
  launchCode,
  launchCoin,
  LEAST_LIQUIDITY_PERCENT,
  LEAST_SHARE_BPS,
  LEAST_TRADING_FEE_PERCENT,
  LOOT_MAINNET,
  MOST_LAMPORTS,
  planText,
  solanaTools,
  localRpc,
  WRAPPED_SOL,
} from '../lib/coin.mjs';
import { saveSecret } from '../lib/credentials.mjs';
import { lootProgram, solanaRoot } from '../lib/economy.mjs';
import { credentialKey } from '../lib/publish/client.mjs';
import { SHARED_RPC } from '../lib/solana-rpc.mjs';
import { ROOT, run, runAsync, signIn, standIn, tempDir } from './helpers.mjs';

// (a new key that signs, as the launchpad's are: the package keeps it with its approval code, not among its exports)
const { freshKeypair } = await import(pathToFileURL(path.join(solanaRoot(), 'js', 'approve', 'ed25519.mjs')).href);
const FIXTURE = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'coin-launch.json'), 'utf8'));
const tools = await solanaTools();
const LOOT = [lootProgram(), LOOT_MAINNET];
const SYSTEM = '11111111111111111111111111111111',
  TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  BUDGET = 'ComputeBudget111111111111111111111111111111',
  ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  PUMP_FEES = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ',
  DBC = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN',
  USDC = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
  RECENT = 'SysvarRecentB1ockHashes11111111111111111111',
  DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const LINKS = 'https://xgames.example';
const disc = name => new Uint8Array(createHash('sha256').update(`global:${name}`).digest().subarray(0, 8));
const le = (value, size) => {
  const b = Buffer.alloc(size);
  if (size === 8) b.writeBigUInt64LE(BigInt(value));
  else b.writeUInt32LE(Number(value));
  return new Uint8Array(b);
};
const bytes = (...parts) => new Uint8Array(Buffer.concat(parts.map(p => Buffer.from(p))));
const other = () => freshKeypair().address;
/** A coin's name, ticker and link as both venues' creating instructions begin (three texts, each after its length). */
const words = (...texts) => bytes(...texts.flatMap(t => [le(Buffer.byteLength(t), 4), Buffer.from(t)]));
/** What a terminal must never be handed from a server: any control character, or the mark that turns text around. */
// eslint-disable-next-line no-control-regex
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u202e]/;

/** A wire transaction's parts as they were built: { payer, blockhash, instructions: [{ programId, keys, data }] }. */
function parts(b64) {
  const t = readTransaction(typeof b64 === 'string' ? fromBase64(b64) : b64);
  const m = readMessage(t.message);
  const { numRequiredSignatures: s, numReadonlySigned: rs, numReadonlyUnsigned: ru } = m.header;
  const writable = i => i < s - rs || (i >= s && i < m.keys.length - ru);
  return {
    payer: m.keys[0],
    blockhash: m.blockhash,
    instructions: m.instructions.map(ix => ({
      programId: m.keys[ix.programIndex],
      keys: ix.accountIndexes.map(i => ({ pubkey: m.keys[i], isSigner: i < s, isWritable: writable(i) })),
      data: ix.data,
    })),
  };
}
/**
 * Those parts as the launchpad hands a transaction out: every signer but the payer has signed, with its own key
 * (`keys`: address → key). `signed: false`: nobody has; `junk`: the slots are filled with bytes that are no signature.
 */
function wireOf(p, keys = {}, { signed = true, junk = false, ...more } = {}) {
  const message = compileMessage({ payer: p.payer, blockhash: p.blockhash, instructions: p.instructions, ...more });
  return wireTransaction(
    message,
    signersOf(message).map((address, i) =>
      i === 0 || !signed
        ? new Uint8Array(64)
        : junk
          ? new Uint8Array(64).fill(7)
          : (keys[address]?.sign(message) ?? new Uint8Array(64)),
    ),
  );
}
/** The instruction of `name` among a transaction's parts. */
const called = (p, name) =>
  p.instructions.find(ix => Buffer.from(ix.data.subarray(0, 8)).equals(Buffer.from(disc(name))));
/**
 * A fixture's launch made over with keys of this run: the coin's mint and (on Meteora) the curve's settings account
 * are new keys that really sign, the coin's link names the new mint, and all else is the launchpad's own bytes.
 * `wallet`: another key to make it for. → {wallet, mint, quote, partner, keys, transactions: [base64]}
 */
function remade(fixture, venue, quote, wallet = fixture.wallet) {
  const mintKey = freshKeypair(),
    configKey = freshKeypair();
  const built = fixture.transactions.map(parts);
  const config = venue === 'meteora' ? called(built[0], 'create_config').keys[0].pubkey : null;
  const swap = {
    [fixture.mint]: mintKey.address,
    [fixture.wallet]: wallet,
    ...(config ? { [config]: configKey.address } : {}),
  };
  for (const p of built) {
    p.payer = wallet;
    for (const ix of p.instructions) ix.keys = ix.keys.map(k => ({ ...k, pubkey: swap[k.pubkey] ?? k.pubkey }));
  }
  const making = called(built[0], venue === 'meteora' ? 'initialize_virtual_pool_with_spl_token' : 'create_v2');
  const link = words('Moth Coin', 'MOTH', `${LINKS}/meta/token/${mintKey.address}.json`);
  making.data =
    venue === 'meteora'
      ? bytes(making.data.subarray(0, 8), link)
      : bytes(making.data.subarray(0, 8), link, decodeBase58(wallet), new Uint8Array(11));
  if (venue === 'pumpfun' && wallet !== fixture.wallet) {
    // the fee split names its shareholders in its data: the key's half is the new wallet's
    const split = called(built[1], 'update_fee_shares_v2');
    split.data = bytes(split.data.subarray(0, 12), decodeBase58(wallet), split.data.subarray(44));
  }
  const keys = { [mintKey.address]: mintKey, [configKey.address]: configKey };
  return {
    wallet,
    mint: mintKey.address,
    quote,
    partner: fixture.partner,
    keys,
    transactions: built.map(p => toBase64(wireOf(p, keys))),
  };
}
const meteora = remade(FIXTURE.meteora, 'meteora', WRAPPED_SOL),
  pumpfun = remade(FIXTURE.pumpfun, 'pumpfun', WRAPPED_SOL),
  pumpfunUsdc = remade(FIXTURE.pumpfunUsdc, 'pumpfun', USDC);
/** A launch's wires with `change(parts of transaction n)` applied to it, signed again by its own keys. */
const changed = (launch, n, change, options) =>
  launch.transactions.map((b64, i) => {
    if (i !== n) return fromBase64(b64);
    const p = parts(b64);
    change(p);
    return wireOf(p, launch.keys, options);
  });
/** A message's bytes, laid out by hand: for what `compileMessage` would never make (an account twice, an index past the list). */
const rawMessage = m =>
  bytes(
    [m.header.numRequiredSignatures, m.header.numReadonlySigned, m.header.numReadonlyUnsigned],
    compactU16(m.keys.length),
    ...m.keys.map(k => decodeBase58(k)),
    decodeBase58(m.blockhash),
    compactU16(m.instructions.length),
    ...m.instructions.flatMap(ix => [
      [ix.programIndex],
      compactU16(ix.accountIndexes.length),
      ix.accountIndexes,
      compactU16(ix.data.length),
      ix.data,
    ]),
  );
/** The plan the launches were built to: a coin named Moth Coin (MOTH), linked on https://xgames.example. */
const PLAN = { name: 'Moth Coin', symbol: 'MOTH', origin: LINKS };
const check = (launch, venue, wires = launch.transactions.map(b => fromBase64(b)), more = {}) =>
  checkLaunch(wires, {
    wallet: launch.wallet,
    venue,
    mint: launch.mint,
    quote: launch.quote ?? WRAPPED_SOL,
    loot: LOOT,
    tools,
    ...PLAN,
    ...more,
  });
const refused = (act, said) =>
  assert.throws(act, e => {
    assert.ok(e instanceof CoinError, e.stack);
    assert.equal(e.code, 'refused');
    assert.match(e.message, /^The launch xgames\.fun built is not one this key signs: /);
    assert.match(e.message, said);
    assert.match(e.message, /Nothing was signed and nothing was sent\.$/);
    return true;
  });
/**
 * Where the settings a launch is held to sit in the fixture's `create_config` (a curve with a volatility fee and a
 * fixed supply, as the launchpad makes them): the first test reads the launchpad's own values at each.
 */
const SETTING = {
  tokenType: 71,
  partnerFree: 73,
  partnerLocked: 74,
  creatorFree: 75,
  creatorLocked: 76,
  supplyTag: 142,
  supplyBefore: 143,
  supplyAfter: 151,
  tradingFee: 159,
  authority: 160,
  movingFee: 161,
  creationFee: 167,
  points: 223,
};
const METEORA_STEPS = [
  'the curve’s settings (no fee for the pool; this key keeps its share of the trading fees)',
  'the coin and its pool',
];
const PUMP_STEPS = ['the coin, with this key as its creator', 'its creator fee: this key keeps 50%'];

test('a real launch of each venue passes: what it does in words, the SOL it names, each transaction’s blockhash', () => {
  // the launchpad's own bytes, with the signatures its SDKs' keys made
  for (const [launch, venue, quote, steps, lamports] of [
    [FIXTURE.meteora, 'meteora', WRAPPED_SOL, METEORA_STEPS, 15_000n],
    [FIXTURE.pumpfun, 'pumpfun', WRAPPED_SOL, PUMP_STEPS, 15_000n],
    // (paired with a token, a pump.fun launch also makes the fee vault's token account, counted as its rent)
    [FIXTURE.pumpfunUsdc, 'pumpfun', USDC, PUMP_STEPS, 3_015_000n],
  ]) {
    const r = check({ ...launch, quote }, venue);
    assert.deepEqual([r.mint, r.lamports, r.steps], [launch.mint, lamports, steps], venue);
    assert.deepEqual(
      r.blockhashes,
      launch.transactions.map(b => readMessage(readTransaction(fromBase64(b)).message).blockhash),
    );
  }
  // made over with keys of this run (what every test below starts from), they are the same launches
  assert.deepEqual(check(meteora, 'meteora').steps, METEORA_STEPS);
  assert.deepEqual(check(pumpfun, 'pumpfun').steps, PUMP_STEPS);
  const usdc = check(pumpfunUsdc, 'pumpfun');
  assert.deepEqual([usdc.steps, usdc.lamports], [PUMP_STEPS, 3_015_000n]);
  // the launchpad's own settings, where the tests below change them
  const d = Buffer.from(called(parts(FIXTURE.meteora.transactions[0]), 'create_config').data);
  assert.deepEqual(
    [
      d[SETTING.tokenType],
      d[SETTING.partnerFree],
      d[SETTING.partnerLocked],
      d[SETTING.creatorFree],
      d[SETTING.creatorLocked],
      d[SETTING.supplyTag],
      d[SETTING.tradingFee],
      d[SETTING.authority],
      d[SETTING.movingFee],
      d.readUInt32LE(SETTING.points),
    ],
    [0, 0, 50, 0, 50, 1, 50, 1, 0, 2],
  );
  assert.deepEqual(
    [
      d.readBigUInt64LE(SETTING.creationFee),
      d.readBigUInt64LE(SETTING.supplyBefore),
      d.readBigUInt64LE(SETTING.supplyAfter),
    ],
    [0n, 10n ** 15n, 10n ** 15n],
  );
});

test('every other signer really signed: a slot filled with anything else is no signature', () => {
  // A coin that exists (nobody here holds its key), named as the one being launched, with bytes in its slot: the
  // fee split of an old coin of the key's would ride in the second transaction.
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        changed(pumpfun, 0, () => {}, { junk: true }),
      ),
    new RegExp(`transaction 1 of 2 wants a signature of ${pumpfun.mint}, which is not there`),
  );
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        changed(pumpfun, 0, () => {}, { signed: false }),
      ),
    /wants a signature of/,
  );
  refused(
    () =>
      check(
        meteora,
        'meteora',
        changed(meteora, 0, () => {}, { junk: true }),
      ),
    /wants a signature of/,
  );
  // signed by a key, but not that address's
  const wrong = { ...pumpfun, keys: { [pumpfun.mint]: freshKeypair() } };
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        changed(wrong, 0, () => {}),
      ),
    /wants a signature of/,
  );
  // a signature over another message (the transaction was changed after its key signed)
  const first = readTransaction(fromBase64(pumpfun.transactions[0]));
  const moved = parts(pumpfun.transactions[0]);
  moved.blockhash = other();
  const later = readTransaction(wireOf(moved, {}));
  refused(
    () =>
      check(pumpfun, 'pumpfun', [
        wireTransaction(later.message, first.signatures),
        fromBase64(pumpfun.transactions[1]),
      ]),
    /wants a signature of/,
  );
});

test('anything that is not a launch is refused, in words that say what it held', () => {
  const wallet = pumpfun.wallet,
    mint = pumpfun.mint;
  const signer = { pubkey: wallet, isSigner: true, isWritable: true };
  const to = () => ({ pubkey: other(), isSigner: false, isWritable: true });
  const add = (launch, n, ix, options) => changed(launch, n, p => p.instructions.push(ix), options);
  const coin = { pubkey: mint, isSigner: false, isWritable: false };

  // a buy of the coin, in the launch's own transaction (the creator's SOL, or a token it holds, spent)
  for (const name of ['buy', 'buy_exact_sol_in', 'buy_exact_quote_in_v3', 'sell', 'set_creator'])
    refused(
      () =>
        check(
          pumpfun,
          'pumpfun',
          add(pumpfun, 0, {
            programId: PUMP,
            keys: [coin, signer],
            data: bytes(disc(name), le(1_000_000_000n, 8), le(0n, 8)),
          }),
        ),
      /transaction 1 of 2 holds an instruction of pump\.fun that is not part of a launch/,
    );
  // who another coin's fees go to, handed on: an instruction of pump.fun's fee program that no launch holds
  for (const name of ['transfer_fee_sharing_authority', 'update_fee_shares', 'revoke_fee_sharing_authority'])
    refused(
      () =>
        check(
          pumpfun,
          'pumpfun',
          add(pumpfun, 1, { programId: PUMP_FEES, keys: [coin, signer], data: bytes(disc(name)) }),
        ),
      /transaction 2 of 2 holds an instruction of pump\.fun that is not part of a launch/,
    );
  for (const name of [
    'swap',
    'swap2',
    'transfer_pool_creator',
    'claim_creator_trading_fee',
    'initialize_virtual_pool_with_token2022',
  ])
    refused(
      () =>
        check(
          meteora,
          'meteora',
          add(meteora, 0, {
            programId: DBC,
            keys: [
              { ...coin, pubkey: meteora.mint },
              { ...signer, pubkey: meteora.wallet },
            ],
            data: bytes(disc(name), le(5n, 8)),
          }),
        ),
      /its transaction holds an instruction of Meteora that is not part of a launch/,
    );
  // A token the key holds, moved; the key's SOL, sent on, or put into a new account; its own account handed to
  // another program: nothing of the Token or System programs is part of a launch. Nor is the other venue's.
  for (const [program, data, keys] of [
    [TOKEN, bytes([3], le(1_000_000n, 8)), [to(), to(), signer]],
    [SYSTEM, bytes(le(2, 4), le(5n, 8)), [signer, to()]],
    [SYSTEM, bytes(le(0, 4), le(50_000_000n, 8), le(165n, 8), decodeBase58(TOKEN)), [signer, to()]],
    [SYSTEM, bytes(le(1, 4), decodeBase58(TOKEN)), [signer]],
  ])
    refused(
      () => check(pumpfun, 'pumpfun', add(pumpfun, 1, { programId: program, keys, data })),
      new RegExp(`transaction 2 of 2 calls the program ${program}, which is no part of a launch on pump\\.fun`),
    );
  refused(
    () => check(pumpfun, 'meteora'),
    new RegExp(`calls the program ${PUMP}, which is no part of a launch on Meteora`),
  );
  refused(
    () => check(meteora, 'pumpfun'),
    new RegExp(`calls the program ${DBC}, which is no part of a launch on pump\\.fun`),
  );
  refused(() => check(meteora, 'raydium'), /a venue this command does not know \(raydium\)/);

  // loot, the program of the game's economy, on either cluster: called, or only named by something else
  assert.equal(LOOT.length, 2);
  for (const loot of LOOT) {
    refused(
      () =>
        check(
          pumpfun,
          'pumpfun',
          add(pumpfun, 1, { programId: loot, keys: [signer], data: bytes(disc('set_project')) }),
        ),
      /transaction 2 of 2 names loot, the program of the game’s economy/,
    );
    refused(
      () =>
        check(
          pumpfun,
          'pumpfun',
          changed(pumpfun, 1, p => p.instructions[0].keys.push({ pubkey: loot, isSigner: false, isWritable: false })),
        ),
      /names loot, the program of the game’s economy/,
    );
  }
  // (and with loot's address not known here, nothing is signed at all: the rule is never silently off)
  for (const loot of [null, [], [''], undefined])
    refused(() => check(pumpfun, 'pumpfun', undefined, { loot }), /loot’s address is not known here/);

  // A priority fee of the launchpad's own choosing is the key's SOL: counted, and held to the most a launch names.
  const budget = (kind, value, size) => ({ programId: BUDGET, keys: [], data: bytes([kind], le(value, size)) });
  const first = (launch, n, ...ixs) => changed(launch, n, p => p.instructions.unshift(...ixs));
  assert.equal(
    check(pumpfun, 'pumpfun', first(pumpfun, 0, budget(2, 400_000, 4), budget(3, 1_000n, 8))).lamports,
    15_400n,
  );
  // (with no limit of its own, a transaction's fee is counted at 200,000 units an instruction, 1.4 million at most)
  assert.equal(check(pumpfun, 'pumpfun', first(pumpfun, 1, budget(3, 1_000_000n, 8))).lamports, 15_000n + 600_000n);
  const many = Array.from({ length: 9 }, () => budget(1, 0, 4));
  assert.equal(MOST_LAMPORTS, 100_000_000n);
  refused(
    () => check(pumpfun, 'pumpfun', first(pumpfun, 0, budget(3, 1_000_000_000n, 8))),
    /it names 0\.2 SOL of this key’s, more than the 0\.1 SOL a launch may name/,
  );
  // (two that are each under the most, in two transactions, are counted together)
  refused(
    () =>
      check(pumpfun, 'pumpfun', [
        first(pumpfun, 0, budget(3, 300_000_000n, 8))[0],
        first(pumpfun, 1, budget(2, 1_000_000, 4), budget(3, 50_000_000n, 8))[1],
      ]),
    /it names 0\.11 SOL of this key’s/,
  );
  const notBudget = /a compute budget instruction of a kind not known here, or one twice/;
  for (const ix of [
    { programId: BUDGET, keys: [], data: bytes([9]) },
    { programId: BUDGET, keys: [], data: bytes([0], le(5, 4)) },
    { programId: BUDGET, keys: [], data: bytes([3], le(5, 4)) },
    { programId: BUDGET, keys: [], data: bytes([2], le(5, 4), [0]) },
    { programId: BUDGET, keys: [signer], data: bytes([2], le(5, 4)) },
  ])
    refused(() => check(pumpfun, 'pumpfun', add(pumpfun, 0, ix)), notBudget);
  // (a price set twice: the second would not be the one counted)
  refused(
    () => check(pumpfun, 'pumpfun', first(pumpfun, 0, budget(3, 1n, 8), budget(3, 1_000_000_000n, 8))),
    notBudget,
  );
  refused(() => check(pumpfun, 'pumpfun', first(pumpfun, 0, ...many.slice(0, 2))), notBudget);

  // accounts loaded from a lookup table can't be read here, and a launch needs none
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        changed(pumpfun, 1, () => {}, { version: 0 }),
      ),
    /transaction 2 of 2 loads accounts from a lookup table/,
  );
  // another key's transaction, and what is no transaction
  refused(() => check({ ...pumpfun, wallet: other() }, 'pumpfun'), /transaction 1 of 2 is not paid for by this key/);
  refused(() => check(pumpfun, 'pumpfun', [new Uint8Array(40)]), /its transaction is not a transaction/);
  refused(() => check(pumpfun, 'pumpfun', []), /it is not one to four transactions/);
  refused(
    () => check(pumpfun, 'pumpfun', Array(5).fill(fromBase64(pumpfun.transactions[1]))),
    /not one to four transactions/,
  );
  refused(() => check({ ...pumpfun, mint: undefined }, 'pumpfun'), /it does not say which coin it launches/);
  refused(() => check({ ...pumpfun, mint: pumpfun.wallet }, 'pumpfun'), /it does not say which coin it launches/);
  for (const more of [{ name: '' }, { symbol: '' }, { quote: '' }])
    refused(
      () => check(pumpfun, 'pumpfun', undefined, more),
      /the plan it is checked against names no coin or no pair/,
    );

  // A message laid out as no builder lays one: an account named twice (so one name could stand for two places),
  // and an instruction that points past the accounts the message lists.
  const one = fromBase64(pumpfun.transactions[0]);
  const second = readTransaction(fromBase64(pumpfun.transactions[1]));
  const m = readMessage(second.message);
  const byHand = message => [one, wireTransaction(rawMessage(message), second.signatures)];
  assert.deepEqual(
    check(pumpfun, 'pumpfun', byHand(m)).steps,
    PUMP_STEPS,
    'laid out by hand as it was, it is the launch',
  );
  const twice = { ...m, keys: m.keys.map((k, i) => (i === m.keys.length - 1 ? m.keys[m.keys.length - 2] : k)) };
  refused(() => check(pumpfun, 'pumpfun', byHand(twice)), /transaction 2 of 2 names an account twice/);
  const past = {
    ...m,
    instructions: m.instructions.map((ix, i) =>
      i === 0 ? { ...ix, accountIndexes: ix.accountIndexes.map((a, j) => (j === 1 ? m.keys.length : a)) } : ix,
    ),
  };
  refused(() => check(pumpfun, 'pumpfun', byHand(past)), /transaction 2 of 2 names an account it does not list/);
});

test('a token account is made only where a launch has one: the fee vault’s, in a pump.fun launch paired with a token', () => {
  const tokenAccount = p => p.instructions.find(ix => ix.programId === ATA);
  const made = change => changed(pumpfunUsdc, 1, p => change(tokenAccount(p), p));
  const notOne = /holds an associated-token instruction that is no part of this launch/;
  // as the launchpad makes it: account 0 the key (it pays), 3 the pair's token, 4 the System program, 5 a token program
  const ix = tokenAccount(parts(pumpfunUsdc.transactions[1]));
  assert.deepEqual(
    [ix.keys.length, ix.keys[0].pubkey, ix.keys[3].pubkey, ix.keys[4].pubkey, ix.keys[5].pubkey, [...ix.data]],
    [6, pumpfunUsdc.wallet, USDC, SYSTEM, TOKEN, [1]],
  );
  const forWallet = launch => ({
    ...ix,
    keys: ix.keys.map(k => (k.pubkey === pumpfunUsdc.wallet ? { ...k, pubkey: launch.wallet } : k)),
  });
  // not in a launch paired with SOL, not on Meteora
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        changed(pumpfun, 1, p => p.instructions.splice(2, 0, forWallet(pumpfun))),
      ),
    notOne,
  );
  refused(
    () =>
      check(
        meteora,
        'meteora',
        changed(meteora, 0, p => p.instructions.push(forWallet(meteora))),
      ),
    notOne,
  );
  // (nor one of SOL's own token in a launch paired with SOL, nor one of the pair's token in a Meteora launch that
  // is paired with that token: a launch has one only where pump.fun's fee vault needs it)
  const ofSol = {
    ...forWallet(pumpfun),
    keys: forWallet(pumpfun).keys.map((k, i) => (i === 3 ? { ...k, pubkey: WRAPPED_SOL } : k)),
  };
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        changed(pumpfun, 1, p => p.instructions.splice(2, 0, ofSol)),
      ),
    notOne,
  );
  const withUsdc = p => {
    for (const ix of p.instructions)
      ix.keys = ix.keys.map(k => (k.pubkey === WRAPPED_SOL ? { ...k, pubkey: USDC } : k));
  };
  const meteoraUsdc = { ...meteora, quote: USDC, transactions: changed(meteora, 0, withUsdc).map(w => toBase64(w)) };
  assert.deepEqual(check(meteoraUsdc, 'meteora').steps, METEORA_STEPS, 'a Meteora launch paired with a token');
  refused(
    () =>
      check(
        meteoraUsdc,
        'meteora',
        changed(meteoraUsdc, 0, p => p.instructions.push(forWallet(meteora))),
      ),
    notOne,
  );
  // not a second one, not for another token, not paid by another, not to the key itself, not of another shape
  const another = { ...ix, keys: ix.keys.map((k, i) => (i === 1 || i === 2 ? { ...k, pubkey: other() } : k)) };
  refused(
    () =>
      check(
        pumpfunUsdc,
        'pumpfun',
        changed(pumpfunUsdc, 1, p => p.instructions.splice(3, 0, another)),
      ),
    notOne,
  );
  const elsewhere = () => ({ pubkey: other(), isSigner: false, isWritable: true });
  for (const change of [
    a => (a.keys[3] = { ...a.keys[3], pubkey: other() }),
    a => (a.keys[0] = elsewhere()),
    a => (a.keys[1] = { ...a.keys[1], pubkey: pumpfunUsdc.wallet }),
    a => (a.keys[4] = { ...a.keys[4], pubkey: other() }),
    a => (a.keys[5] = { ...a.keys[5], pubkey: other() }),
    a => a.keys.push(elsewhere()),
    a => a.keys.pop(),
    // (2 moves the tokens of a nested account; more data is no instruction of the program's)
    a => (a.data = bytes([2])),
    a => (a.data = bytes([1, 0])),
  ])
    refused(() => check(pumpfunUsdc, 'pumpfun', made(change)), notOne);
  for (const data of [[], [0]])
    assert.equal(
      check(
        pumpfunUsdc,
        'pumpfun',
        made(a => (a.data = bytes(data))),
      ).lamports,
      3_015_000n,
    );
});

test('a launch is its venue’s instructions, each once and in order, with the key, the coin and the pair where the program reads them', () => {
  const first = fromBase64(pumpfun.transactions[0]),
    second = fromBase64(pumpfun.transactions[1]);
  const theirs = other();
  const set = (launch, n, name, place, key) =>
    changed(launch, n, p => (called(p, name).keys[place] = { ...called(p, name).keys[place], ...key }));
  const swapped = (launch, n, name, a, b) =>
    changed(launch, n, p => {
      const keys = called(p, name).keys;
      [keys[a], keys[b]] = [keys[b], keys[a]];
    });
  // The fee split, the fee settings or the sweep of some other coin of the key's, slipped into this launch: the
  // coin is read from the place the program reads it, so the new coin named elsewhere in it changes nothing.
  for (const [name, place] of [
    ['update_fee_shares_v2', 4],
    ['create_fee_sharing_config', 4],
    ['sweep_creator_fee', 2],
  ]) {
    refused(
      () => check(pumpfun, 'pumpfun', set(pumpfun, 1, name, place, { pubkey: theirs })),
      new RegExp(`transaction 2 of 2 holds a ${name} whose coin is not the coin being launched`),
    );
    // (the new coin still among its accounts, in another place)
    refused(
      () => check(pumpfun, 'pumpfun', swapped(pumpfun, 1, name, place, 1)),
      new RegExp(`holds a ${name} whose coin is not the coin being launched`),
    );
  }
  refused(
    () => check(pumpfun, 'pumpfun', swapped(pumpfun, 0, 'create_v2', 0, 4)),
    /holds a create_v2 whose coin is not the coin being launched/,
  );
  // the key in the places it acts from: another payer or authority is another's instruction
  for (const [n, name, place, what] of [
    [0, 'create_v2', 5, 'payer'],
    [1, 'sweep_creator_fee', 0, 'payer'],
    [1, 'create_fee_sharing_config', 2, 'payer'],
    [1, 'update_fee_shares_v2', 2, 'authority'],
    [1, 'update_fee_shares_v2', 19, 'authority'],
  ])
    refused(
      () => check(pumpfun, 'pumpfun', set(pumpfun, n, name, place, { pubkey: theirs, isSigner: false })),
      new RegExp(`holds a ${name} whose ${what} is not this key`),
    );
  // the pair, where each reads it: a launch against another token than the plan's is another launch
  for (const [launch, venue, n, name, place] of [
    [meteora, 'meteora', 0, 'create_config', 3],
    [meteora, 'meteora', 0, 'initialize_virtual_pool_with_spl_token', 4],
    [pumpfun, 'pumpfun', 1, 'sweep_creator_fee', 3],
    [pumpfun, 'pumpfun', 1, 'update_fee_shares_v2', 14],
    [pumpfunUsdc, 'pumpfun', 0, 'create_v2', 16],
  ])
    refused(
      () => check(launch, venue, set(launch, n, name, place, { pubkey: theirs })),
      new RegExp(`holds a ${name} whose pair is not the pair in the plan`),
    );
  // the token program, where each reads one: another program there would be handed the coin's or the pair's accounts
  for (const [launch, venue, n, name, place] of [
    [meteora, 'meteora', 0, 'initialize_virtual_pool_with_spl_token', 11],
    [meteora, 'meteora', 0, 'initialize_virtual_pool_with_spl_token', 12],
    [pumpfun, 'pumpfun', 0, 'create_v2', 7],
    [pumpfunUsdc, 'pumpfun', 0, 'create_v2', 18],
    [pumpfun, 'pumpfun', 1, 'sweep_creator_fee', 4],
    [pumpfun, 'pumpfun', 1, 'update_fee_shares_v2', 15],
  ])
    refused(
      () => check(launch, venue, set(launch, n, name, place, { pubkey: theirs })),
      new RegExp(`holds a ${name} whose token program is not`),
    );
  // (a pump.fun coin is a Token-2022 mint: SPL Token in its place is not its program)
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        set(pumpfun, 0, 'create_v2', 7, { pubkey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }),
      ),
    /whose token program is not Token-2022/,
  );
  // the key's own account of the pair, where a pump.fun split paired with a token pays its share
  refused(
    () => check(pumpfunUsdc, 'pumpfun', set(pumpfunUsdc, 1, 'update_fee_shares_v2', 20, { pubkey: theirs })),
    /pays this key’s share of the creator fee to an account that is not this key’s own/,
  );
  // (the whole of a launch paired with a token, where the plan said SOL, and the other way)
  refused(() => check({ ...pumpfunUsdc, quote: WRAPPED_SOL }, 'pumpfun'), /no part of this launch/);
  refused(() => check({ ...pumpfun, quote: USDC }, 'pumpfun'), /with 16 accounts, where its program takes 20/);
  refused(() => check({ ...meteora, quote: USDC }, 'meteora'), /whose pair is not the pair in the plan/);
  // exactly the accounts its program takes: one more (a token account of the key's, say, for the program to write)
  for (const [launch, venue, n, name, count] of [
    [meteora, 'meteora', 0, 'create_config', 8],
    [meteora, 'meteora', 0, 'initialize_virtual_pool_with_spl_token', 16],
    [pumpfun, 'pumpfun', 0, 'create_v2', 16],
    [pumpfunUsdc, 'pumpfun', 0, 'create_v2', 20],
    [pumpfun, 'pumpfun', 1, 'sweep_creator_fee', 13],
    [pumpfun, 'pumpfun', 1, 'create_fee_sharing_config', 13],
    [pumpfun, 'pumpfun', 1, 'update_fee_shares_v2', 20],
    [pumpfunUsdc, 'pumpfun', 1, 'update_fee_shares_v2', 21],
  ])
    refused(
      () =>
        check(
          launch,
          venue,
          changed(launch, n, p => called(p, name).keys.push({ pubkey: theirs, isSigner: false, isWritable: true })),
        ),
      new RegExp(`holds a ${name} with ${count + 1} accounts, where its program takes ${count}`),
    );

  // Each once and in order, and the ones a launch must have: no split, no launch (the coin's fees would be whoever's
  // the launchpad made them); two splits; the split before the rest.
  const dropLast = changed(pumpfun, 1, p => p.instructions.pop());
  refused(() => check(pumpfun, 'pumpfun', [first]), /it has no update_fee_shares_v2, which a launch on pump\.fun has/);
  refused(() => check(pumpfun, 'pumpfun', dropLast), /it has no update_fee_shares_v2/);
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        changed(pumpfun, 1, p => p.instructions.push(called(p, 'update_fee_shares_v2'))),
      ),
    /holds a update_fee_shares_v2 where a launch on pump\.fun has none \(a second one, or out of its order\)/,
  );
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        changed(pumpfun, 1, p => p.instructions.reverse()),
      ),
    /where a launch on pump\.fun has none/,
  );
  // A coin that exists already (its key signs nothing), named as the one being launched: the split alone, or with
  // the coin's making put second.
  refused(
    () => check(pumpfun, 'pumpfun', [second]),
    /the coin it launches is not a new one \(its own key did not sign\)/,
  );
  refused(() => check(pumpfun, 'pumpfun', [second, first]), /the coin it launches is not a new one/);
  refused(() => check({ ...pumpfun, mint: theirs }, 'pumpfun'), /the coin it launches is not a new one/);
  // The coin is made in the first transaction. Its key signing there some other way (an account of a token
  // account's making, here) while the coin is made later, or never, is not a launch.
  const signsOnly = p =>
    p.instructions
      .find(ix => ix.programId === ATA)
      .keys.push({ pubkey: pumpfunUsdc.mint, isSigner: true, isWritable: false });
  const firstIsSplit = wireOf(
    (() => {
      const p = parts(pumpfunUsdc.transactions[1]);
      signsOnly(p);
      return p;
    })(),
    pumpfunUsdc.keys,
  );
  refused(
    () => check(pumpfunUsdc, 'pumpfun', [firstIsSplit, fromBase64(pumpfunUsdc.transactions[0])]),
    /no part of this launch|does not make the coin in its first transaction|has none/,
  );
  // (with the coin's key as a plain extra signer of a first transaction that makes nothing: the making comes second)
  const padded = parts(pumpfun.transactions[1]);
  padded.instructions = [{ programId: BUDGET, keys: [], data: bytes([2], le(300_000, 4)) }];
  const emptyFirst = wireOf({ ...padded, instructions: [...padded.instructions] }, pumpfun.keys);
  refused(() => check(pumpfun, 'pumpfun', [emptyFirst, first, second]), /the coin it launches is not a new one/);
  // The fee split of a coin whose key the launchpad still holds (one that was made and never finished), dressed as
  // a new launch: the coin's key signs it, and nothing in it makes a coin.
  const splitAlone = parts(pumpfun.transactions[1]);
  for (const ix of splitAlone.instructions)
    ix.keys = ix.keys.map(k => (k.pubkey === pumpfun.mint ? { ...k, isSigner: true } : k));
  refused(
    () => check(pumpfun, 'pumpfun', [wireOf(splitAlone, pumpfun.keys)]),
    /it has no create_v2, which a launch on pump\.fun has/,
  );
  // create_v2 is what a launch that is not the rest of one must have
  refused(
    () => check(pumpfun, 'pumpfun', [second], { resume: false }),
    /the coin it launches is not a new one|it has no create_v2/,
  );

  // The rest of a launch begun earlier (a pump.fun coin that exists and wants its second transaction): only for the
  // coin this folder recorded when it signed the first, as it was planned then, and never with a coin made in it.
  const begun = { mint: pumpfun.mint, venue: 'pumpfun', name: 'Moth Coin', symbol: 'MOTH' };
  assert.deepEqual(check(pumpfun, 'pumpfun', [second], { resume: true, begun }).steps, [
    'its creator fee: this key keeps 50%',
  ]);
  refused(
    () => check(pumpfun, 'pumpfun', [second], { resume: true }),
    /the rest of a launch that was not begun from this folder.*finish it where it was begun/,
  );
  refused(() => check(pumpfun, 'pumpfun', [second], { resume: true, begun: {} }), /not begun from this folder/);
  refused(
    () => check(pumpfun, 'pumpfun', [second], { resume: true, begun: { ...begun, mint: theirs } }),
    /it is for another coin than the one this folder began launching/,
  );
  for (const was of [{ name: 'Other Coin' }, { symbol: 'OTHER' }, { venue: 'meteora' }])
    refused(
      () => check(pumpfun, 'pumpfun', [second], { resume: true, begun: { ...begun, ...was } }),
      /the rest of the launch this folder began, which was of another name, ticker or venue than this plan’s/,
    );
  refused(
    () => check(pumpfun, 'pumpfun', [first, second], { resume: true, begun }),
    /it is called the rest of an earlier launch and makes a coin all the same/,
  );
  refused(
    () =>
      check(meteora, 'meteora', undefined, {
        resume: true,
        begun: { ...begun, mint: meteora.mint, venue: 'meteora' },
      }),
    /the rest of an earlier launch, which a launch on Meteora never has/,
  );

  // Meteora: the settings and the pool, once each, in the one transaction; the pool on those very settings, whose
  // own new key signed; the coin and the key where the program reads them.
  const pool = 'initialize_virtual_pool_with_spl_token';
  const without = n => changed(meteora, 0, p => p.instructions.splice(n, 1));
  refused(() => check(meteora, 'meteora', without(0)), /it has no create_config, which a launch on Meteora has/);
  // (with no pool made, nothing makes the coin either: its key signs nothing)
  refused(() => check(meteora, 'meteora', without(1)), /the coin it launches is not a new one/);
  refused(
    () =>
      check(
        meteora,
        'meteora',
        changed(meteora, 0, p => p.instructions.push(p.instructions[0])),
      ),
    /holds a create_config where a launch on Meteora has none/,
  );
  refused(
    () => check(meteora, 'meteora', set(meteora, 0, pool, 0, { pubkey: theirs, isSigner: false, isWritable: false })),
    /makes the coin’s pool on other settings than the ones this launch makes/,
  );
  refused(
    () =>
      check(
        meteora,
        'meteora',
        changed(meteora, 0, p => {
          // settings at an account nobody's new key signed for (one that exists: another pool's, with its own fees)
          const config = called(p, 'create_config').keys[0].pubkey;
          for (const ix of p.instructions)
            ix.keys = ix.keys.map(k => (k.pubkey === config ? { ...k, pubkey: theirs, isSigner: false } : k));
        }),
      ),
    /makes its curve’s settings at an account whose own key did not sign/,
  );
  // (the coin's own address as the settings' account: it signs, and it is not a curve's settings)
  refused(
    () =>
      check(
        meteora,
        'meteora',
        changed(meteora, 0, p => {
          const config = called(p, 'create_config').keys[0].pubkey;
          called(p, 'create_config').keys[0] = { pubkey: meteora.mint, isSigner: true, isWritable: true };
          called(p, pool).keys[0] = { pubkey: meteora.mint, isSigner: false, isWritable: false };
          assert.notEqual(config, meteora.mint);
        }),
      ),
    /makes its curve’s settings at an account whose own key did not sign/,
  );
  for (const [place, what] of [
    [2, 'creator'],
    [10, 'payer'],
  ])
    refused(
      () => check(meteora, 'meteora', set(meteora, 0, pool, place, { pubkey: theirs, isSigner: false })),
      new RegExp(`holds a ${pool} whose ${what} is not this key`),
    );
  refused(
    () => check(meteora, 'meteora', set(meteora, 0, 'create_config', 4, { pubkey: theirs, isSigner: false })),
    /holds a create_config whose payer is not this key/,
  );
  // (the coin elsewhere in the pool's accounts, its key still signing)
  refused(
    () => check(meteora, 'meteora', swapped(meteora, 0, pool, 3, 5)),
    new RegExp(`holds a ${pool} whose coin is not the coin being launched`),
  );
  // Meteora's launch is one transaction: the settings in a first, signed by the coin's key too (named there as an
  // account of the settings'), and the pool in a second, is not it.
  const whole = parts(meteora.transactions[0]);
  const settingsOnly = { ...whole, instructions: [called(whole, 'create_config')] };
  settingsOnly.instructions[0] = {
    ...settingsOnly.instructions[0],
    keys: settingsOnly.instructions[0].keys.map((k, i) =>
      i === 1 ? { pubkey: meteora.mint, isSigner: true, isWritable: false } : k,
    ),
  };
  const poolOnly = { ...whole, instructions: [called(whole, pool)] };
  refused(
    () => check(meteora, 'meteora', [wireOf(settingsOnly, meteora.keys), wireOf(poolOnly, meteora.keys)]),
    /its Meteora launch is not in its first transaction/,
  );
  // Meteora's launch is its first transaction: its two instructions in a second one, after a first of nothing much
  // that the coin's key signs too
  const nothingMuch = wireOf(
    {
      payer: meteora.wallet,
      blockhash: other(),
      instructions: [
        { programId: BUDGET, keys: [], data: bytes([2], le(1, 4)) },
        // (an instruction that only names the coin's key as a signer, so it signs the first transaction)
        {
          programId: DBC,
          keys: [{ pubkey: meteora.mint, isSigner: true, isWritable: false }],
          data: bytes(disc('create_config')),
        },
      ],
    },
    meteora.keys,
  );
  refused(
    () => check(meteora, 'meteora', [nothingMuch, fromBase64(meteora.transactions[0])]),
    /holds a create_config where a launch on Meteora has none|its Meteora launch is not in its first transaction|with 1 accounts/,
  );
});

test('the coin is the plan’s: its name, its ticker and its link on chain, byte for byte', () => {
  const pool = 'initialize_virtual_pool_with_spl_token';
  const link = launch => `${LINKS}/meta/token/${launch.mint}.json`;
  for (const [launch, venue, name, tail] of [
    [meteora, 'meteora', pool, () => []],
    [pumpfun, 'pumpfun', 'create_v2', l => [decodeBase58(l.wallet), new Uint8Array(11)]],
  ]) {
    const renamed = (...said) =>
      changed(launch, 0, p => (called(p, name).data = bytes(disc(name), words(...said), ...tail(launch))));
    const mine = link(launch);
    assert.ok(check(launch, venue, renamed('Moth Coin', 'MOTH', mine)), 'as the launchpad made it');
    // another name or ticker than the plan's (the code the person approved covers theirs, not the launchpad's)
    const notPlanned = /makes a coin with another name or ticker than the plan’s/;
    refused(() => check(launch, venue, renamed('Moth Coin Classic', 'MOTH', mine)), notPlanned);
    refused(() => check(launch, venue, renamed('Moth Coin', 'MOTHS', mine)), notPlanned);
    refused(() => check(launch, venue, undefined, { symbol: 'moth' }), notPlanned);
    refused(() => check(launch, venue, undefined, { name: 'Moth  Coin' }), notPlanned);
    // text that shows the same and is not the same bytes: a byte order mark, a no-break space, a Cyrillic o, a NUL
    for (const [n, s] of [
      ['\ufeffMoth Coin', 'MOTH'],
      ['Moth Coin', '\ufeffMOTH'],
      ['Moth\u00a0Coin', 'MOTH'],
      ['M\u043eth Coin', 'MOTH'],
      ['Moth Coin\u0000', 'MOTH'],
      ['Moth\u200b Coin', 'MOTH'],
    ])
      refused(() => check(launch, venue, renamed(n, s, mine)), notPlanned);
    // a link that is not the coin's own on the xgames.fun the launch came from, to the byte
    for (const uri of [
      mine.replace('xgames.example', 'evil.example'),
      mine.replace('https:', 'http:'),
      `${LINKS}/meta/token/${other()}.json`,
      `${mine}?x=1`,
      `${mine}#x`,
      mine.replace('https://', 'https://xgames.example@'),
      mine.replace('https://', 'https://user:pass@'),
      `\ufeff${mine}`,
      `${mine} `,
      `\t${mine}`,
      `${mine}\n`,
      mine.replace('/meta/', '/x/../meta/'),
      mine.replace('/meta/', '\\meta/'),
      mine.toUpperCase(),
      'not a link',
      '',
    ])
      refused(
        () => check(launch, venue, renamed('Moth Coin', 'MOTH', uri)),
        /gives the coin a link that is not its own on https:\/\/xgames\.example/,
      );
    refused(
      () => check(launch, venue, undefined, { origin: 'https://other.example' }),
      /a link that is not its own on https:\/\/other\.example/,
    );
    // With no https xgames.fun to hold it to (a Studio on this machine), the link is still the coin's own, over
    // https, of that one shape.
    assert.ok(check(launch, venue, undefined, { origin: null }));
    for (const uri of [
      mine.replace('https:', 'http:'),
      `http://localhost/meta/token/${launch.mint}.json`,
      `${mine}?x=1`,
      mine.replace('https://', 'https://user:pass@'),
      `https://xgames.example/other/${launch.mint}.json`,
      `\ufeff${mine}`,
      `${mine}\n`,
    ])
      refused(
        () => check(launch, venue, renamed('Moth Coin', 'MOTH', uri), { origin: null }),
        /a link that is not its own on xgames\.fun/,
      );
    // data that is not three texts to its last byte
    refused(
      () =>
        check(
          launch,
          venue,
          changed(launch, 0, p => (called(p, name).data = bytes(called(p, name).data, [0]))),
        ),
      new RegExp(`holds a ${name} that can’t be read here`),
    );
    refused(
      () =>
        check(
          launch,
          venue,
          changed(launch, 0, p => (called(p, name).data = called(p, name).data.subarray(0, 20))),
        ),
      /can’t be read here/,
    );
    // (a text longer than any name, ticker or link: not read at all)
    refused(
      () => check(launch, venue, renamed('Moth Coin', 'MOTH', `${mine}${'x'.repeat(400)}`)),
      /can’t be read here/,
    );
  }
});

test('Meteora’s settings: no fee for the pool or for moving to it, the key’s share, locked liquidity, a fixed supply nobody can add to', () => {
  const data = change =>
    changed(meteora, 0, p => {
      const ix = called(p, 'create_config');
      // (`change` writes into its own copy of the settings, or hands back other bytes in their place)
      const copy = Buffer.from(ix.data);
      ix.data = new Uint8Array(change(copy) ?? copy);
    });
  const set = change =>
    data(d => {
      change(d);
      return d;
    });
  assert.deepEqual([LEAST_TRADING_FEE_PERCENT, LEAST_LIQUIDITY_PERCENT], [50, 50]);
  // A fee for making the pool, which the pool's creator pays: the venue lets a launchpad set up to 100 SOL.
  refused(
    () =>
      check(
        meteora,
        'meteora',
        set(d => d.writeBigUInt64LE(90_000_000_000n, SETTING.creationFee)),
      ),
    /sets a fee of 90000000000 lamports for making the pool, which this key would pay/,
  );
  refused(
    () =>
      check(
        meteora,
        'meteora',
        set(d => d.writeBigUInt64LE(1n, SETTING.creationFee)),
      ),
    /sets a fee of 1 lamports for making the pool/,
  );
  // A share of what the coin raises, taken as it moves to its pool (the venue allows up to 99%).
  refused(
    () =>
      check(
        meteora,
        'meteora',
        set(d => (d[SETTING.movingFee] = 99)),
      ),
    /takes 99% of what the coin raises as it moves to its pool/,
  );
  refused(
    () =>
      check(
        meteora,
        'meteora',
        set(d => (d[SETTING.movingFee] = 1)),
      ),
    /takes 1% of what the coin raises/,
  );
  // The key's share of the trading fees, and of the liquidity the coin moves to its pool with.
  refused(
    () =>
      check(
        meteora,
        'meteora',
        set(d => (d[SETTING.tradingFee] = 0)),
      ),
    /gives this key 0% of the creator’s side of the trading fees, not the 50% it was told/,
  );
  refused(
    () =>
      check(
        meteora,
        'meteora',
        set(d => (d[SETTING.tradingFee] = 49)),
      ),
    /gives this key 49%/,
  );
  assert.ok(
    check(
      meteora,
      'meteora',
      set(d => (d[SETTING.tradingFee] = 80)),
    ),
    'more for the key is no refusal',
  );
  refused(
    () =>
      check(
        meteora,
        'meteora',
        set(d => {
          d[SETTING.creatorLocked] = 0;
          d[SETTING.partnerLocked] = 100;
        }),
      ),
    /gives this key 0% of the coin’s liquidity, not the 50% it was told/,
  );
  refused(
    () =>
      check(
        meteora,
        'meteora',
        set(d => (d[SETTING.partnerLocked] = 10)),
      ),
    /of the coin’s liquidity/,
  );
  // (the key's half may be locked or free: both count as its own)
  assert.ok(
    check(
      meteora,
      'meteora',
      set(d => {
        d[SETTING.creatorLocked] = 20;
        d[SETTING.creatorFree] = 30;
      }),
    ),
  );
  // The launchpad's half free to be taken out while the key's is locked.
  refused(
    () =>
      check(
        meteora,
        'meteora',
        set(d => {
          d[SETTING.partnerFree] = 50;
          d[SETTING.partnerLocked] = 0;
        }),
      ),
    /leaves the launchpad’s part of the liquidity free to be taken out/,
  );
  // A supply that grows as the coin moves to its pool, none at all, or none set (then the venue mints as it goes).
  const notFixed = /does not keep the coin’s supply fixed/;
  refused(
    () =>
      check(
        meteora,
        'meteora',
        set(d => d.writeBigUInt64LE(10n ** 16n, SETTING.supplyAfter)),
      ),
    notFixed,
  );
  refused(
    () =>
      check(
        meteora,
        'meteora',
        set(d => {
          d.writeBigUInt64LE(0n, SETTING.supplyBefore);
          d.writeBigUInt64LE(0n, SETTING.supplyAfter);
        }),
      ),
    notFixed,
  );
  refused(
    () =>
      check(
        meteora,
        'meteora',
        data(d => Buffer.concat([d.subarray(0, SETTING.supplyTag), Buffer.from([0]), d.subarray(SETTING.tradingFee)])),
      ),
    notFixed,
  );
  // Someone left able to mint more of the coin or rename it (0, 2, 3, 4), or a coin of another token program.
  for (const authority of [0, 2, 3, 4])
    refused(
      () =>
        check(
          meteora,
          'meteora',
          set(d => (d[SETTING.authority] = authority)),
        ),
      /leaves someone able to mint more of the coin or rename it/,
    );
  refused(
    () =>
      check(
        meteora,
        'meteora',
        set(d => (d[SETTING.tokenType] = 1)),
      ),
    /leaves someone able to mint more/,
  );
  // settings that are not laid out as the program's to their last byte are not read as settings at all
  const unread = /holds curve settings that can’t be read here/;
  for (const change of [
    d => d.subarray(0, 100),
    d => Buffer.concat([d, Buffer.from([0])]),
    // (a value that may be absent, marked neither absent nor there)
    d => {
      d[35] = 7;
    },
    d => {
      d[SETTING.supplyTag] = 2;
    },
  ])
    refused(() => check(meteora, 'meteora', data(change)), unread);
  // (a curve of no points, or of more than the program takes)
  const curve = (points, fill = 1) =>
    data(d => {
      d.writeUInt32LE(points, SETTING.points);
      return Buffer.concat([d.subarray(0, SETTING.points + 4), Buffer.alloc(32 * points, fill)]);
    });
  refused(() => check(meteora, 'meteora', curve(0)), unread);
  refused(() => check(meteora, 'meteora', curve(21)), unread);
  assert.ok(check(meteora, 'meteora', curve(20)));
  assert.ok(check(meteora, 'meteora', curve(1)));
});

test('pump.fun: this key is the coin’s creator, in none of its optional modes, and keeps the half it was told', () => {
  const made = change =>
    changed(pumpfun, 0, p => {
      const ix = called(p, 'create_v2');
      const data = Buffer.from(ix.data);
      change(data);
      ix.data = new Uint8Array(data);
    });
  // the creator is in the instruction's own data, after the three texts: another's, and the fees are another's
  const creatorAt = called(parts(pumpfun.transactions[0]), 'create_v2').data.length - 11 - 32;
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        made(d => Buffer.from(decodeBase58(other())).copy(d, creatorAt)),
      ),
    /makes the coin with another creator than this key, so its creator fees would not be this key’s/,
  );
  for (let i = 1; i <= 11; i++)
    refused(
      () =>
        check(
          pumpfun,
          'pumpfun',
          made(d => (d[d.length - i] = 1)),
        ),
      /makes the coin in a mode of pump\.fun’s that the plan did not say/,
    );

  const split = shares =>
    changed(pumpfun, 1, p => {
      const ix = p.instructions.at(-1);
      ix.data = bytes(
        ix.data.subarray(0, 8),
        le(shares.length, 4),
        ...shares.flatMap(([address, bps]) => [decodeBase58(address), [bps & 255, bps >> 8]]),
      );
    });
  const { wallet, partner } = pumpfun;
  assert.equal(LEAST_SHARE_BPS, 5000);
  assert.match(check(pumpfun, 'pumpfun', split([[wallet, 10_000]])).steps.at(-1), /this key keeps 100%/);
  assert.match(
    check(
      pumpfun,
      'pumpfun',
      split([
        [partner, 5000],
        [wallet, 5000],
      ]),
    ).steps.at(-1),
    /this key keeps 50%/,
  );
  const least = (shares, said) => refused(() => check(pumpfun, 'pumpfun', split(shares)), said);
  least(
    [
      [wallet, 4000],
      [partner, 6000],
    ],
    /gives this key 40% of the coin’s creator fee, not the half it was told/,
  );
  least([[partner, 10_000]], /gives this key 0% of the coin’s creator fee/);
  least(
    [
      [other(), 5000],
      [partner, 5000],
    ],
    /gives this key 0%/,
  );
  // shares that do not add up, none or too many, or data that is not a list of shareholders: not read as a split
  const unread = /a split of the coin’s creator fee that can’t be read here/;
  least(
    [
      [wallet, 5000],
      [partner, 4000],
    ],
    unread,
  );
  least([], unread);
  least(
    Array.from({ length: 11 }, (_, i) => [i ? other() : wallet, i ? 500 : 5000]),
    unread,
  );
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        changed(pumpfun, 1, p => (p.instructions.at(-1).data = bytes(p.instructions.at(-1).data, [0]))),
      ),
    /can’t be read here/,
  );
  // the two that take no settings carry none
  for (const name of ['sweep_creator_fee', 'create_fee_sharing_config'])
    refused(
      () =>
        check(
          pumpfun,
          'pumpfun',
          changed(pumpfun, 1, p => (called(p, name).data = bytes(called(p, name).data, [1]))),
        ),
      new RegExp(`holds a ${name} that can’t be read here`),
    );
});

// ---- the command's calls --------------------------------------------------------------------------------------------

// (the launches' coins are linked on this xgames.fun: a launch's link is held to the one the command talks to)
const ORIGIN = LINKS;
const OWN_RPC = 'https://rpc.example';
const RELAY = new URL(SHARED_RPC).origin;
const VENUE_LIST = [
  {
    venue: 'meteora',
    says: 'whatever the server says of it',
    pairs: [
      { symbol: 'SOL', name: 'Solana', mint: WRAPPED_SOL },
      { symbol: 'USDC', name: 'USDC', mint: USDC },
    ],
  },
  {
    venue: 'pumpfun',
    says: 'and of this one',
    pairs: [
      { symbol: 'SOL', name: 'Solana', mint: 'SOL' },
      { symbol: 'USDC', name: 'USDC', mint: USDC },
    ],
  },
];
const FORM = { name: 'Moth Coin', symbol: 'MOTH', description: 'For the moths.', picture: 'art/coin.png' };
const blockhashesOf = launch =>
  launch.transactions.map(b => readMessage(readTransaction(fromBase64(b)).message).blockhash);
/** An RPC's answer, as a devnet one gives it: `chain` is what it finds ({genesis, recent: [blockhash], accounts: Set, balance}). */
function rpcAnswer(chain, q) {
  const ok = result => ({ jsonrpc: '2.0', id: q.id, result });
  if (q.method === 'getGenesisHash') return ok(chain.genesis);
  if (q.method === 'getBalance') return ok({ context: { slot: 1 }, value: chain.balance });
  if (q.method === 'getMultipleAccounts')
    return ok({
      context: { slot: 1 },
      value: q.params[0].map(address => {
        const data =
          address === RECENT
            ? bytes(le(BigInt(chain.recent.length), 8), ...chain.recent.flatMap(h => [decodeBase58(h), le(5000n, 8)]))
            : chain.accounts.has(address)
              ? new Uint8Array(82)
              : null;
        return data
          ? { owner: SYSTEM, lamports: 1, data: [Buffer.from(data).toString('base64'), 'base64'], executable: false }
          : null;
      }),
    });
  return { jsonrpc: '2.0', id: q.id, error: { code: -32601, message: 'not here' } };
}

/** A game folder that was published, a saved sign-in, and a stand-in for xgames.fun's coin route and the RPCs. */
async function setup(t, { launch = meteora, balance = 500_000_000, ownRpc = true } = {}) {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const env = {
    GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'),
    GAMESFUN_CREDENTIALS: 'file',
    GAMESFUN_WORK: tmp.dir,
    ...(ownRpc ? { XSOLANA_RPC_URL: `${OWN_RPC}/key` } : {}),
  };
  const dir = path.join(tmp.dir, 'game');
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(path.join(dir, '.gamesfun', 'publish.json'), JSON.stringify({ [ORIGIN]: { projectId: 'g-9' } }));
  await saveSecret(credentialKey(ORIGIN), 'gfk_test_token', { studio: ORIGIN, email: 'a@example.com' }, { env });
  const idle = { on: true, started: false, sent: false, partly: false };
  const state = {
    calls: [],
    status: {
      ok: true,
      on: true,
      own: null,
      launch: idle,
      venues: VENUE_LIST,
      pictures: [{ path: 'art/coin.png', bytes: 900 }],
      morePictures: 0,
    },
    prepared: {
      ok: true,
      transactions: launch.transactions,
      lastValidBlockHeight: 99,
      mint: launch.mint,
      resume: false,
    },
    after: {
      ok: true,
      on: true,
      own: {
        kind: 'launched',
        status: 'live',
        name: 'Moth Coin',
        symbol: 'MOTH',
        mint: launch.mint,
        venue: 'meteora',
        pair: 'SOL',
      },
      launch: idle,
    },
    // what each RPC finds: the person's own, Solana's public one, xgames.fun's (null: it does not answer)
    chains: Object.fromEntries(
      [OWN_RPC, DEVNET_RPC, RELAY].map(o => [
        o,
        { genesis: DEVNET_GENESIS, recent: blockhashesOf(launch), accounts: new Set(), balance },
      ]),
    ),
  };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (Object.hasOwn(state.chains, u.origin)) {
      const q = JSON.parse(init.body);
      state.calls.push(['rpc', u.origin, q.method]);
      const chain = state.chains[u.origin];
      return chain ? Response.json(rpcAnswer(chain, q)) : new Response('no', { status: 503 });
    }
    const method = init.method ?? 'GET';
    state.calls.push([
      method,
      u.pathname + u.search,
      init.headers?.authorization,
      init.body ? JSON.parse(init.body) : null,
    ]);
    if (u.pathname !== '/api/kit/games/g-9/coin')
      return new Response('<!doctype html><title>404</title>', { status: 404 });
    if (method === 'GET') return Response.json(state.status);
    if (method === 'POST')
      return state.refusePrepare ? Response.json(state.refusePrepare, { status: 400 }) : Response.json(state.prepared);
    if (method === 'PUT')
      return state.refuseSubmit ? Response.json(state.refuseSubmit, { status: 502 }) : Response.json(state.after);
    return Response.json({ ...state.status, launch: { ...state.status.launch, started: false } });
  };
  const key = { dropped: 0, signed: [] };
  const keyReader = async file => ({
    file,
    address: launch.wallet,
    async signTransaction(wire) {
      const t2 = readTransaction(wire);
      key.signed.push(wire);
      return wireTransaction(
        t2.message,
        t2.signatures.map((s, i) => (i === 0 ? new Uint8Array(64).fill(9) : s)),
      );
    },
    drop: () => key.dropped++,
  });
  const opts = { origin: ORIGIN, env, fetchImpl, tools, keyReader, keyFile: '~/.config/xsolana/moth.json' };
  const sent = method => state.calls.filter(c => c[0] === method);
  const rpcs = () => state.calls.filter(c => c[0] === 'rpc');
  return { dir, env, state, key, opts, sent, rpcs };
}
/** A plan's code, then the launch run with it: → {result} or {error}. `change(state)` between the two. */
async function launched(s, form = FORM, change = () => {}) {
  const { code } = await launchCoin(s.dir, form, s.opts);
  change(s.state);
  try {
    return { code, result: await launchCoin(s.dir, form, { ...s.opts, yes: code }), error: null };
  } catch (error) {
    return { code, result: null, error };
  }
}

test('a launch sends nothing until it is run with the code it printed; the code covers every choice', async t => {
  const { dir, key, opts, sent, rpcs } = await setup(t);
  const planned = await launchCoin(dir, FORM, opts);
  assert.deepEqual([planned.ok, planned.planned, typeof planned.code, planned.code.length], [true, true, 'string', 8]);
  assert.deepEqual(
    { ...planned.plan },
    {
      game: 'g-9',
      name: 'Moth Coin',
      symbol: 'MOTH',
      description: 'For the moths.',
      picture: 'art/coin.png',
      venue: 'meteora',
      pair: 'SOL',
      quote: WRAPPED_SOL,
      wallet: meteora.wallet,
      resume: false,
      balance: 500_000_000n,
    },
  );
  assert.deepEqual(
    [sent('POST').length, sent('PUT').length, key.signed.length, key.dropped],
    [0, 0, 0, 1],
    'nothing begun, nothing signed, the key let go',
  );
  assert.equal(sent('GET')[0][2], 'Bearer gfk_test_token');
  assert.deepEqual(rpcs(), [
    ['rpc', OWN_RPC, 'getGenesisHash'],
    ['rpc', OWN_RPC, 'getBalance'],
  ]);

  const text = planText(planned.plan, {
    game: 'moth-run',
    keyFile: opts.keyFile,
    code: planned.code,
    command: 'xcore coin launch --name "Moth Coin"',
  });
  for (const said of [
    /A coin for moth-run, launched on Solana devnet:/,
    /name +Moth Coin/,
    /ticker +MOTH/,
    /picture +art\/coin\.png/,
    // the venue in this command's own words, never the server's
    /where +Meteora: a curve of its own, then a pool\. You keep about 40% of its trading fees\./,
    /paired with +SOL\n/,
    new RegExp(`signed by +${meteora.wallet} \\(the key file ~/\\.config/xsolana/moth\\.json\\)`),
    /it holds 0\.5 SOL\n/,
    /takes about 0\.03 SOL from the key/,
    /creator fees belong to\nthis key's address/,
    /holds it to the launch above: this name,\nticker and pair, this key as the coin's creator with the share above, no fee beyond the venue's own, no buy, no\nmove of a token the key holds, nothing of loot/,
    /at most 0\.1 SOL in fees of its own\. It\nalso asks a devnet RPC that the transactions are devnet's and the coin's address is new\. Anything else is refused\nand nothing is signed\./,
    /What xcore cannot read is xgames\.fun’s to get right: the picture and the description .*\n.*on Meteora the curve’s shape/,
    /It can’t be undone: a game has one coin/,
    /A devnet coin trades nothing of value/,
    /nothing here is legal advice/,
    new RegExp(
      `Nothing was sent\\. To launch it, run this again with the code:\\n  xcore coin launch --name "Moth Coin" --yes ${planned.code}$`,
    ),
  ])
    assert.match(text, said);
  assert.doesNotMatch(text, /whatever the server says/);

  // the same choices give the same code, whatever the key holds; any other choice, another
  assert.equal(launchCode(planned.plan), planned.code);
  assert.equal(launchCode({ ...planned.plan, balance: 1n }), planned.code);
  for (const [k, v] of [
    ['game', 'g-10'],
    ['name', 'Moth Coin '],
    ['symbol', 'MOTHS'],
    ['description', ''],
    ['picture', 'art/other.png'],
    ['venue', 'pumpfun'],
    ['pair', 'USDC'],
    ['quote', USDC],
    ['wallet', other()],
    ['resume', true],
  ])
    assert.notEqual(launchCode({ ...planned.plan, [k]: v }), planned.code, k);

  // a code that is for other choices sends nothing
  for (const [form, yes] of [
    [FORM, 'deadbeef'],
    [{ ...FORM, name: 'Moth Coin Two' }, planned.code],
    [{ ...FORM, venue: 'pumpfun' }, planned.code],
    [{ ...FORM, pair: 'USDC' }, planned.code],
  ])
    await assert.rejects(
      launchCoin(dir, form, { ...opts, yes }),
      e => e instanceof CoinError && e.code === 'code' && /That code is not for this launch/.test(e.message),
    );
  // What is sent is held to the plan this folder kept when it was printed, choice by choice, not to the code alone:
  // a plan kept with another choice (what a server steering the defaults between the runs would give, even with a
  // code that matched) sends nothing, and with no kept plan nothing is sent.
  const planFile = path.join(dir, '.gamesfun', 'coin-plan.json');
  const kept = JSON.parse(await readFile(planFile, 'utf8'));
  const origin = Object.keys(kept)[0];
  for (const [k, v] of [
    ['pair', 'USDC'],
    ['venue', 'pumpfun'],
    ['quote', USDC],
    ['resume', true],
  ]) {
    const steered = structuredClone(kept);
    steered[origin].choices = steered[origin].choices.map(([c, was]) => [c, c === k ? v : was]);
    await writeFile(planFile, JSON.stringify(steered));
    const e = await launchCoin(dir, FORM, { ...opts, yes: planned.code }).catch(x => x);
    assert.equal(e?.code, 'code', k);
  }
  await writeFile(planFile, '{}');
  assert.equal((await launchCoin(dir, FORM, { ...opts, yes: planned.code }).catch(x => x))?.code, 'code');
  // (a venue named like what every object has is no venue)
  assert.equal((await launchCoin(dir, { ...FORM, venue: 'constructor' }, opts).catch(x => x))?.code, 'usage');
  assert.deepEqual([sent('POST').length, sent('PUT').length, key.signed.length], [0, 0, 0]);
});

test('the pair is what the plan shows: SOL is SOL’s own mint, and a token is named by its address', async t => {
  const s = await setup(t, { launch: pumpfunUsdc });
  const { dir, state, opts, sent, key } = s;
  const form = { ...FORM, venue: 'pumpfun', pair: 'USDC' };
  const planned = await launchCoin(dir, form, opts);
  assert.deepEqual([planned.plan.pair, planned.plan.quote], ['USDC', USDC]);
  assert.match(
    planText(planned.plan, { game: 'g', keyFile: 'k', code: planned.code, command: 'c' }),
    new RegExp(`paired with +USDC \\(the token ${USDC}\\)\\n`),
  );
  const named = (pair, mint) => ({
    ...state.status,
    venues: VENUE_LIST.map(v => ({ ...v, pairs: v.pairs.map(p => (p.symbol === pair ? { ...p, mint } : p)) })),
  });
  // xgames.fun names another token as USDC after the plan was read: the code is for the one that was shown
  state.status = named('USDC', other());
  await assert.rejects(launchCoin(dir, form, { ...opts, yes: planned.code }), e => e.code === 'code');
  // SOL is SOL's own mint whatever xgames.fun says, and a token is an address that is not SOL's
  for (const [pair, mint] of [
    ['SOL', USDC],
    ['SOL', undefined],
    ['USDC', WRAPPED_SOL],
    ['USDC', 'SOL'],
    ['USDC', 'nope'],
    ['USDC', undefined],
  ]) {
    state.status = named(pair, mint);
    await assert.rejects(
      launchCoin(dir, { ...form, pair }, opts),
      e => e.code === 'pair' && /names a token for .* that is not one a coin is paired with/.test(e.message),
      `${pair} as ${mint}`,
    );
  }
  assert.equal(sent('POST').length, 0);
  // the launch that is built is held to the pair: one paired with SOL, where the plan said USDC, is not signed
  state.status = named('USDC', USDC);
  const withSol = remade(FIXTURE.pumpfun, 'pumpfun', WRAPPED_SOL, pumpfunUsdc.wallet);
  state.prepared = { ok: true, transactions: withSol.transactions, mint: withSol.mint, resume: false };
  state.chains[OWN_RPC].recent = blockhashesOf(withSol);
  await assert.rejects(launchCoin(dir, form, { ...opts, yes: planned.code }), e => e.code === 'refused');
  assert.deepEqual([sent('PUT').length, key.signed.length], [0, 0]);
  // and the launch paired with that token is
  state.prepared = { ok: true, transactions: pumpfunUsdc.transactions, mint: pumpfunUsdc.mint, resume: false };
  state.chains[OWN_RPC].recent = blockhashesOf(pumpfunUsdc);
  state.after = { ...state.after, own: { ...state.after.own, mint: pumpfunUsdc.mint } };
  const done = await launchCoin(dir, form, { ...opts, yes: planned.code });
  assert.deepEqual([done.launched, done.coin.pair, key.signed.length], [true, 'USDC', 2]);
});

test('with the code: begun for the key’s address, read, asked of devnet, signed here, handed back, and the coin is live', async t => {
  const s = await setup(t);
  const { dir, state, key, sent, rpcs } = s;
  const { result: r } = await launched(s);
  assert.deepEqual(r, {
    ok: true,
    launched: true,
    waiting: false,
    partly: false,
    mint: meteora.mint,
    // (the coin's words are the plan's own: nothing of xgames.fun's answer is repeated but that it is live)
    coin: { name: 'Moth Coin', symbol: 'MOTH', venue: 'meteora', pair: 'SOL', mint: meteora.mint },
    explorer: `https://explorer.solana.com/address/${meteora.mint}?cluster=devnet`,
    steps: METEORA_STEPS,
    checkedThrough: 'your own RPC (XSOLANA_RPC_URL)',
    independent: true,
  });
  assert.deepEqual(sent('POST')[0][3], {
    name: 'Moth Coin',
    symbol: 'MOTH',
    description: 'For the moths.',
    picture: 'art/coin.png',
    venue: 'meteora',
    pair: 'SOL',
    wallet: meteora.wallet,
  });
  // devnet was asked, of the person's own RPC and no other, before the key signed
  assert.ok(rpcs().every(c => c[1] === OWN_RPC));
  assert.deepEqual(
    rpcs()
      .slice(-3)
      .map(c => c[2]),
    ['getGenesisHash', 'getMultipleAccounts', 'getMultipleAccounts'],
  );
  assert.ok(state.calls.findIndex(c => c[0] === 'PUT') > state.calls.findLastIndex(c => c[0] === 'rpc'));
  // what went back is what was built, with the key's signature in its own slot and the others as they were
  const back = fromBase64(sent('PUT')[0][3].transactions[0]);
  const built = readTransaction(fromBase64(meteora.transactions[0])),
    signed = readTransaction(back);
  assert.deepEqual(signed.message, built.message);
  assert.deepEqual(signed.signatures[0], new Uint8Array(64).fill(9));
  assert.deepEqual(signed.signatures.slice(1), built.signatures.slice(1));
  assert.equal(key.signed.length, 1);
  assert.equal(key.dropped, 2, 'the key is let go after each run');
  // the folder remembers which coin it began, and as what (kept out of git with the rest of .gamesfun)
  const record = JSON.parse(await readFile(path.join(dir, '.gamesfun', 'coin.json'), 'utf8'))[ORIGIN];
  assert.deepEqual(
    [record.mint, record.venue, record.name, record.symbol],
    [meteora.mint, 'meteora', 'Moth Coin', 'MOTH'],
  );
  assert.match(await readFile(path.join(dir, '.gamesfun', '.gitignore'), 'utf8'), /^\*$/m);
  // xgames.fun saying "live" of another coin than the one that was signed is not this launch being live
  const b = await setup(t);
  b.state.after = { ...b.state.after, own: { ...b.state.after.own, mint: other(), name: 'Other', symbol: 'OTHER' } };
  const { result: odd } = await launched(b);
  assert.deepEqual([odd.launched, odd.waiting, odd.coin, odd.mint], [false, true, null, meteora.mint]);
});

test('devnet is asked before the key signs: its own blockhashes, a coin that is new there; with no RPC, nothing is signed', async t => {
  const tried = async (change, { ownRpc = true, launch = meteora, form = FORM } = {}) => {
    const s = await setup(t, { ownRpc, launch });
    return { ...s, ...(await launched(s, form, state => change(state.chains))) };
  };
  const nothing = s =>
    assert.deepEqual(
      [s.key.signed.length, s.sent('PUT').length, s.sent('DELETE').length],
      [0, 0, 1],
      'not signed, not sent, and the launch given up',
    );
  // A transaction that is not one of devnet's (a mainnet launch would be signed just the same: nothing in it names
  // its cluster), or one built too long ago.
  let s = await tried(chains => (chains[OWN_RPC].recent = [other(), other()]));
  assert.equal(s.error?.code, 'refused');
  assert.match(s.error.message, /a transaction of it is not one of devnet’s, or was built too long ago/);
  nothing(s);
  // (every transaction of it, not only the first)
  const two = parts(pumpfun.transactions[1]);
  two.blockhash = other();
  const later = { ...pumpfun, transactions: [pumpfun.transactions[0], toBase64(wireOf(two, pumpfun.keys))] };
  s = await tried(chains => (chains[OWN_RPC].recent = blockhashesOf(later).slice(0, 1)), {
    launch: later,
    form: { ...FORM, venue: 'pumpfun' },
  });
  assert.equal(s.error?.code, 'refused');
  assert.match(s.error.message, /not one of devnet’s/);
  nothing(s);
  s = await tried(() => {}, { launch: later, form: { ...FORM, venue: 'pumpfun' } });
  assert.equal(s.error, null);
  // The coin's address holds something on devnet already: it is no new coin.
  s = await tried(chains => chains[OWN_RPC].accounts.add(meteora.mint));
  assert.equal(s.error?.code, 'refused');
  assert.match(s.error.message, /the coin it launches is on devnet already, so it is not a new one/);
  nothing(s);
  // An RPC of the person's own that is another cluster's: said as that, and nothing signed.
  s = await tried(chains => (chains[OWN_RPC].genesis = MAINNET_GENESIS));
  assert.deepEqual(
    [s.error?.code, s.error?.message],
    ['not-devnet', 'XSOLANA_RPC_URL is not a devnet RPC, and coins are launched on devnet only. Nothing was signed.'],
  );
  nothing(s);
  // Their own RPC does not answer: no other is asked in its place, and nothing is signed.
  s = await tried(chains => (chains[OWN_RPC] = null));
  assert.equal(s.error?.code, 'chain');
  assert.match(
    s.error.message,
    /^Solana devnet could not be read from here \(.*\), and whether a launch is devnet’s is not asked of xgames\.fun, which built it\. Try again in a minute, or set XSOLANA_RPC_URL to a devnet RPC of your own\. Nothing was signed\.$/,
  );
  assert.ok(s.rpcs().every(c => c[1] === OWN_RPC));
  nothing(s);
  // What devnet's list of blockhashes should be is not there: not read as "all are devnet's".
  s = await tried(chains => (chains[OWN_RPC].recent = []));
  assert.equal(s.error?.code, 'chain');
  nothing(s);

  // With no RPC of their own: Solana's public one is asked. xgames.fun's is listed (the key's balance may be read
  // there) but never decides a signature: with the public one away, nothing is signed.
  assert.deepEqual(
    devnetRpcs({}).map(r => [r.url, r.independent]),
    [
      [DEVNET_RPC, true],
      [SHARED_RPC, false],
    ],
  );
  assert.deepEqual(
    devnetRpcs({ XSOLANA_RPC_URL: 'https://mine.example/x' }).map(r => [r.url, r.own, r.independent]),
    [['https://mine.example/x', true, true]],
  );
  s = await tried(() => {}, { ownRpc: false });
  assert.deepEqual(
    [s.error, s.result.launched, s.result.checkedThrough, s.result.independent],
    [null, true, 'Solana’s public devnet RPC', true],
  );
  assert.ok(s.rpcs().every(c => c[1] === DEVNET_RPC));
  s = await tried(chains => (chains[DEVNET_RPC] = null), { ownRpc: false });
  assert.equal(s.error?.code, 'chain');
  assert.match(s.error.message, /not asked of xgames\.fun, which built it/);
  nothing(s);
  // (and held to the same there: a public RPC that answers "another cluster" is not passed over for the next)
  s = await tried(chains => (chains[DEVNET_RPC].genesis = MAINNET_GENESIS), { ownRpc: false });
  assert.equal(s.error?.code, 'not-devnet');
  nothing(s);
  s = await tried(
    chains => {
      chains[DEVNET_RPC] = null;
      chains[RELAY] = null;
    },
    { ownRpc: false },
  );
  assert.equal(s.error?.code, 'chain');
  nothing(s);
});

test('a launch that is anything more is given up before a signature is made; what the flow holds it to is the plan’s', async t => {
  const { dir, state, key, opts, sent } = await setup(t, { launch: pumpfun });
  const form = { ...FORM, venue: 'pumpfun' };
  const { code } = await launchCoin(dir, form, opts);
  const b64 = wires => wires.map(w => toBase64(w));
  const refusedFor = async (prepared, said) => {
    state.prepared = { ok: true, mint: pumpfun.mint, resume: false, transactions: pumpfun.transactions, ...prepared };
    const before = sent('DELETE').length;
    await assert.rejects(
      launchCoin(dir, form, { ...opts, yes: code }),
      e => e.code === 'refused' && said.test(e.message),
      String(said),
    );
    assert.deepEqual(
      [key.signed.length, sent('PUT').length, sent('DELETE').length - before],
      [0, 0, 1],
      'not signed, not sent, and the launch given up',
    );
  };
  const signer = { pubkey: pumpfun.wallet, isSigner: true, isWritable: true };
  const making = (name, symbol, uri) =>
    changed(
      pumpfun,
      0,
      p =>
        (called(p, 'create_v2').data = bytes(
          disc('create_v2'),
          words(name, symbol, uri),
          decodeBase58(pumpfun.wallet),
          new Uint8Array(11),
        )),
    );
  // the launchpad (or whoever answers as it) adds a transfer of the key's SOL to the launch
  await refusedFor(
    {
      transactions: b64(
        changed(pumpfun, 1, p =>
          p.instructions.push({
            programId: SYSTEM,
            keys: [signer, { pubkey: other(), isSigner: false, isWritable: true }],
            data: bytes(le(2, 4), le(900_000_000n, 8)),
          }),
        ),
      ),
    },
    /calls the program 11111111111111111111111111111111, which is no part of a launch on pump\.fun.*Nothing was signed and nothing was sent\./,
  );
  // it names loot's mainnet address (the flow hands the check both of loot's)
  await refusedFor(
    {
      transactions: b64(
        changed(pumpfun, 1, p =>
          p.instructions[0].keys.push({ pubkey: LOOT_MAINNET, isSigner: false, isWritable: false }),
        ),
      ),
    },
    /names loot/,
  );
  // its coin is linked on another site than the xgames.fun the command talks to (the flow hands the check its origin)
  await refusedFor(
    { transactions: b64(making('Moth Coin', 'MOTH', `https://evil.example/meta/token/${pumpfun.mint}.json`)) },
    /a link that is not its own on https:\/\/xgames\.example/,
  );
  // its coin has another name than the plan's
  await refusedFor(
    { transactions: b64(making('Moth Coin Pro', 'MOTH', `${LINKS}/meta/token/${pumpfun.mint}.json`)) },
    /another name or ticker than the plan’s/,
  );
  // it is called the rest of an earlier launch, and the plan said a new one
  await refusedFor(
    { resume: true, transactions: [pumpfun.transactions[1]] },
    /it is the rest of an earlier launch, and the plan said a new one/,
  );
  // and what is no transaction at all, or none
  await refusedFor({ transactions: ['AAAA'] }, /could not be read here|is not a transaction/);
  await refusedFor({ transactions: undefined }, /not one to four transactions/);
  await refusedFor({ mint: undefined }, /does not say which coin/);
});

test('the rest of a pump.fun launch is signed only for the coin this folder began, as it was planned then', async t => {
  const s = await setup(t, { launch: pumpfun });
  const { dir, state, key, opts, sent } = s;
  const form = { ...FORM, venue: 'pumpfun' };
  const partly = { on: true, started: true, sent: false, partly: true };
  const launching = {
    kind: 'launching',
    status: 'pending',
    name: 'Moth Coin',
    symbol: 'MOTH',
    mint: null,
    venue: 'pumpfun',
  };
  const live = {
    kind: 'launched',
    status: 'live',
    name: 'Moth Coin',
    symbol: 'MOTH',
    mint: pumpfun.mint,
    venue: 'pumpfun',
    pair: 'SOL',
  };
  const rejects = (f, said) =>
    assert.rejects(
      async () => launchCoin(dir, f, { ...opts, yes: (await launchCoin(dir, f, opts)).code }),
      e => e.code === 'refused' && said.test(e.message),
    );
  // the first run: both transactions signed and handed in; the chain took the first only
  state.after = { ...state.status, own: launching, launch: partly };
  const { code, result: first } = await launched(s, form);
  assert.deepEqual(
    [first.launched, first.waiting, first.partly, first.coin, key.signed.length],
    [false, true, true, null, 2],
  );
  // again: xgames.fun hands out the second transaction alone, and the coin is on devnet by now
  state.status = state.after;
  state.prepared = { ok: true, transactions: [pumpfun.transactions[1]], mint: pumpfun.mint, resume: true };
  state.chains[OWN_RPC].accounts.add(pumpfun.mint);
  state.after = { ...state.status, own: live, launch: { on: true, started: false, sent: false, partly: false } };
  // (the old code is not the rest's: the rest of a launch is another plan, read again)
  const stale = await launchCoin(dir, form, { ...opts, yes: code }).catch(e => e);
  assert.equal(stale.code, 'code');
  const again = await launchCoin(dir, form, opts);
  assert.equal(again.plan.resume, true);
  assert.notEqual(again.code, code, 'the rest of a launch is another plan, with another code');
  const restCode = again.code;
  assert.match(
    planText(again.plan, { game: 'g', keyFile: 'k', code: restCode, command: 'c' }),
    /launched on Solana devnet \(the rest of a launch begun earlier\):/,
  );
  // (the plan says the rest of a launch, and what was built is a new one)
  const rest = state.prepared;
  state.prepared = { ok: true, transactions: pumpfun.transactions, mint: pumpfun.mint, resume: false };
  await rejects(form, /it is a new launch, and the plan said the rest of an earlier one/);
  state.prepared = rest;
  // (the coin it is the rest of is not on devnet)
  state.chains[OWN_RPC].accounts.delete(pumpfun.mint);
  await rejects(form, /the coin it is the rest of is not on devnet/);
  state.chains[OWN_RPC].accounts.add(pumpfun.mint);
  assert.equal(key.signed.length, 2);
  await launchCoin(dir, form, opts);
  const done = await launchCoin(dir, form, { ...opts, yes: restCode });
  assert.deepEqual([done.launched, key.signed.length, sent('PUT').at(-1)[3].transactions.length], [true, 3, 1]);
  // for another coin, under another name, or from a folder that began none, it is not signed
  state.prepared = { ...rest, mint: pumpfunUsdc.mint };
  await rejects(form, /another coin than the one this folder began/);
  state.prepared = rest;
  await rejects({ ...form, name: 'Moth Coin Two' }, /of another name, ticker or venue than this plan’s/);
  await writeFile(path.join(dir, '.gamesfun', 'coin.json'), '{}');
  await rejects(form, /not begun from this folder/);
  assert.equal(key.signed.length, 3);
});

test('a venue named like what every object has is no venue; an XSOLANA_RPC_URL that can’t be used is said, not passed over', async t => {
  refused(() => check(meteora, 'constructor'), /a venue this command does not know/);
  refused(() => check(meteora, '__proto__'), /a venue this command does not know/);
  const { dir, state, key, opts, sent } = await setup(t);
  state.status = {
    ...state.status,
    venues: [...state.status.venues, { venue: 'constructor', pairs: [{ symbol: 'SOL', name: 'Solana', mint: 'SOL' }] }],
  };
  assert.equal((await launchCoin(dir, { ...FORM, venue: 'constructor' }, opts).catch(x => x))?.code, 'usage');
  // (http to another machine: not a setting this command uses, and not swapped for Solana's public RPC either)
  const bad = { ...opts, env: { ...opts.env, XSOLANA_RPC_URL: 'http://rpc.example/devnet' } };
  const planned = await launchCoin(dir, FORM, bad);
  const e = await launchCoin(dir, FORM, { ...bad, yes: planned.code }).catch(x => x);
  assert.deepEqual([e?.code, /Fix XSOLANA_RPC_URL/.test(e?.message ?? '')], ['rpc', true]);
  assert.deepEqual([sent('PUT').length, key.signed.length], [0, 0]);
});

test('what a launch is refused for before anything is begun', async t => {
  const { dir, state, key, opts, sent } = await setup(t);
  const fresh = state.status;
  const refusedFor = async (status, form, code, said) => {
    state.status = status;
    await assert.rejects(
      launchCoin(dir, form, opts),
      e => e instanceof CoinError && e.code === code && said.test(e.message),
      `${code}`,
    );
  };
  // the coin's words, as they will read on chain: said before anything is asked of xgames.fun
  for (const [form, said] of [
    [{ ...FORM, name: '' }, /--name is the coin’s name/],
    [{ ...FORM, name: 'x'.repeat(33) }, /at most 32 bytes/],
    [{ ...FORM, name: 'Moth\u001b[8mCoin' }, /plain text/],
    [{ ...FORM, name: 'Moth\u202eCoin' }, /plain text/],
    [{ ...FORM, symbol: 'M' }, /--ticker is 2 to 10 letters or digits/],
    [{ ...FORM, symbol: 'MO TH' }, /--ticker/],
    [{ ...FORM, symbol: 'M\u00d6TH' }, /--ticker/],
    [{ ...FORM, symbol: 'ELEVENCHARS' }, /--ticker/],
  ])
    await assert.rejects(launchCoin(dir, form, opts), e => e.code === 'usage' && said.test(e.message));
  assert.equal(state.calls.length, 0);
  // (a ticker is launched in capitals, with no $ before it: the plan says so)
  const tidied = await launchCoin(dir, { ...FORM, symbol: ' $moth ', name: '  Moth Coin ' }, opts);
  assert.deepEqual([tidied.plan.symbol, tidied.plan.name], ['MOTH', 'Moth Coin']);

  const off = 'Launching a coin from here is not on for this XGames.fun yet.';
  await refusedFor(
    { ok: true, on: false, why: 'The Token tab is not on.' },
    FORM,
    'launch-off',
    /The Token tab is not on/,
  );
  await refusedFor(
    { ...fresh, launch: { on: false, why: off }, venues: undefined },
    FORM,
    'launch-off',
    /not on for this XGames\.fun yet/,
  );
  await refusedFor(
    { ...fresh, own: { kind: 'launched', symbol: 'MOTH', mint: meteora.mint } },
    FORM,
    'has-token',
    /already launched: \$MOTH .* A game has one\./,
  );
  await refusedFor(
    { ...fresh, own: { kind: 'linked', symbol: 'BONK', mint: other() } },
    FORM,
    'has-token',
    /uses \$BONK, a token made elsewhere/,
  );
  await refusedFor(
    { ...fresh, launch: { ...fresh.launch, started: true, sent: true } },
    FORM,
    'launch-sent',
    /already sent to Solana/,
  );
  await refusedFor({ ...fresh, venues: [] }, FORM, 'no-venue', /not offering a venue right now/);
  // (a venue this command does not know how to hold a launch to is not one it offers)
  await refusedFor(
    { ...fresh, venues: [{ venue: 'raydium', pairs: [{ symbol: 'SOL', mint: 'SOL' }] }] },
    FORM,
    'no-venue',
    /not offering a venue/,
  );
  await refusedFor(fresh, { ...FORM, venue: 'raydium' }, 'usage', /--venue is one of: meteora, pumpfun/);
  await refusedFor(
    fresh,
    { ...FORM, pair: 'BONK' },
    'usage',
    /--pair is one of: SOL, USDC \(what Meteora pairs a coin with here\)/,
  );
  await refusedFor(
    fresh,
    { ...FORM, picture: 'art/nope.png' },
    'usage',
    /--picture is a picture among the published game's files: art\/coin\.png/,
  );
  await refusedFor({ ...fresh, pictures: [] }, FORM, 'usage', /has no picture a coin can use/);
  // a game with more pictures than the list shows: xgames.fun decides
  state.status = { ...fresh, morePictures: 40 };
  assert.equal((await launchCoin(dir, { ...FORM, picture: 'art/deep/one.png' }, opts)).planned, true);

  // a key with too little SOL is told so in the plan, and nothing is begun for it
  state.status = fresh;
  state.chains[OWN_RPC].balance = 4_000_000;
  const poor = await launchCoin(dir, FORM, opts);
  assert.match(
    planText(poor.plan, { game: 'g', keyFile: 'k', code: poor.code, command: 'c' }),
    /it holds 0\.004 SOL: too little, send it devnet SOL first \(a launch takes about 0\.03\)/,
  );
  await assert.rejects(
    launchCoin(dir, FORM, { ...opts, yes: poor.code }),
    e => e.code === 'balance' && new RegExp(`Send devnet SOL to ${meteora.wallet}`).test(e.message),
  );
  // an RPC that does not answer holds no plan up: it says so, and the launch itself waits for one that does
  const down = state.chains[OWN_RPC];
  state.chains[OWN_RPC] = null;
  const blind = await launchCoin(dir, FORM, opts);
  assert.equal(blind.plan.balance, null);
  assert.match(
    planText(blind.plan, { game: 'g', keyFile: 'k', code: blind.code, command: 'c' }),
    /its SOL could not be read from here/,
  );
  state.chains[OWN_RPC] = { ...down, balance: 500_000_000 };
  state.refusePrepare = { error: 'That wallet does not hold enough SOL for the launch.', code: 'balance' };
  await assert.rejects(
    launchCoin(dir, FORM, { ...opts, yes: blind.code }),
    e => e.code === 'balance' && /does not hold enough SOL/.test(e.message),
  );
  assert.deepEqual([sent('PUT').length, key.signed.length], [0, 0]);
});

test('after it is handed in, what was sent is xgames.fun’s to say: its word is given as its word, with where to ask', async t => {
  const s = await setup(t);
  const { dir, state, key, opts } = s;
  const { code } = await launchCoin(dir, FORM, opts);
  const handIn = () => launchCoin(dir, FORM, { ...opts, yes: code }).catch(e => e);
  // xgames.fun says nothing was sent (in its own words): said as what it says, never as what this command knows
  state.refuseSubmit = {
    error: 'Solana did not take the launch, so nothing was sent. Start the launch again.',
    code: 'not-sent',
  };
  const said = await handIn();
  assert.ok(said instanceof CoinError);
  assert.deepEqual([said.code, said.mint], ['not-sent', meteora.mint]);
  assert.match(
    said.message,
    /^xgames\.fun says: Solana did not take the launch, so nothing was sent\. Start the launch again\. \(The launch was signed and handed to it; .*coin says where it stands\.\)$/,
  );
  assert.match(said.next, /coin$/);
  // any other failure of the hand-in: signed and handed over, and where it stands is to be asked
  state.refuseSubmit = { error: 'The launchpad did not answer.' };
  const lost = await handIn();
  assert.deepEqual([lost.code, lost.mint], ['unknown', meteora.mint]);
  assert.match(
    lost.message,
    /^The launchpad did not answer\. The launch was signed and handed to xgames\.fun; see where it stands with: .*coin$/,
  );
  // a refusal dressed to forge a line or hide one on a terminal is shown as plain text on one line
  state.refuseSubmit = {
    error: 'nothing was sent\n\u001b[2Kxcore: the coin is live \u202e',
    code: 'not-sent\u001b[8m',
  };
  const forged = await handIn();
  assert.doesNotMatch(forged.message + forged.code, HIDDEN);
  assert.match(forged.message, /nothing was sent\[2Kxcore: the coin is live /);
  assert.equal(key.signed.length, 3);
});

test('status and drop: the folder’s game, the saved sign-in; a folder never published is told to publish', async t => {
  const { dir, opts, sent } = await setup(t);
  assert.equal((await coinStatus(dir, { ...opts, refresh: true })).launch.on, true);
  assert.equal(sent('GET').at(-1)[1], '/api/kit/games/g-9/coin?refresh=1');
  assert.equal((await dropLaunch(dir, opts)).launch.started, false);
  assert.deepEqual(sent('DELETE').at(-1).slice(0, 3), ['DELETE', '/api/kit/games/g-9/coin', 'Bearer gfk_test_token']);
  await writeFile(path.join(dir, '.gamesfun', 'publish.json'), '{}');
  for (const act of [() => coinStatus(dir, opts), () => dropLaunch(dir, opts), () => launchCoin(dir, FORM, opts)])
    await assert.rejects(
      act,
      e => e.code === 'not-published' && /a coin is launched for a published game\. Publish it first/.test(e.message),
    );
  // an xgames.fun from before the route
  await writeFile(path.join(dir, '.gamesfun', 'publish.json'), JSON.stringify({ [ORIGIN]: { projectId: 'g-old' } }));
  await assert.rejects(
    coinStatus(dir, opts),
    e => e.code === 'launch-off' && /does not launch coins from the command line yet/.test(e.message),
  );
});

test('what xgames.fun sends is cleaned before a terminal shows it', () => {
  assert.equal(clean('a\u001b[8mb\nc\u202ed\ufeffe\u0000f\u009bg\u200bh\u2028i\u2066j'), 'a[8mbcdefghij');
  assert.equal(clean('x'.repeat(500)).length, 300);
  assert.equal(clean('x'.repeat(500), 20).length, 20);
  assert.equal(clean('Moth Coin (MOTH) à la carte'), 'Moth Coin (MOTH) à la carte');
  // what shows as nothing: no-break and other spaces, the soft hyphen, the fillers, the blank Braille cell, the
  // variation selectors, the tag characters, the grapheme joiner, the Mongolian separator
  const nothingShown = [
    0xa0, 0xad, 0x34f, 0x115f, 0x180e, 0x2007, 0x202f, 0x205f, 0x2800, 0x3000, 0x3164, 0xfe0f, 0xffa0, 0xe0041, 0xe0100,
  ];
  for (const c of nothingShown) assert.equal(clean(`a${String.fromCodePoint(c)}b`), 'ab', c.toString(16));
  // a validator on this machine, and only that, is its own cluster
  for (const url of ['http://localhost:8899', 'http://127.0.0.1:8899/', 'http://[::1]:8899'])
    assert.ok(localRpc(url), url);
  for (const url of [
    'http://localhost.evil.example:8899',
    'https://example.com/http://localhost',
    'http://127.0.0.1.evil.example',
    'xhttp://localhost',
  ])
    assert.ok(!localRpc(url), url);
  for (const not of [undefined, null, 7, {}, ['a']]) assert.equal(clean(not), '');
  assert.equal(cleanAddress(WRAPPED_SOL), WRAPPED_SOL);
  for (const not of ['x', `${WRAPPED_SOL}\n`, `${WRAPPED_SOL} \u001b[8m`, undefined, 7, 'O'.repeat(40)])
    assert.equal(cleanAddress(not), '(not an address)');
});

// ---- the command, with a real key file --------------------------------------------------------------------------------

test('the command: a plan, then a launch signed by a real key file, against a stand-in xgames.fun and devnet', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
  // (the stand-in is on this machine: its RPC is a validator's of its own, and its links are not held to an origin)
  const env = {
    GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'),
    GAMESFUN_CREDENTIALS: 'file',
    GAMESFUN_STUDIO: g.origin,
    XSOLANA_RPC_URL: `${g.origin}/rpc`,
  };
  await signIn(g, env);
  const dir = path.join(tmp.dir, 'moth-run');
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>Moth Run</title>');
  await writeFile(path.join(dir, '.gamesfun', 'publish.json'), JSON.stringify({ [g.origin]: { projectId: 'g1' } }));
  const keyFile = path.join(tmp.dir, 'keys', 'moth.json');
  const made = run(['loot', 'keygen', keyFile], { cwd: dir, env });
  assert.equal(made.status, 0, made.stderr);
  const address = made.stdout.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/)[0];

  const seen = { posts: [], puts: [], live: false, launch: null, own: null, why: null };
  g.state.handle = (method, url, json, { authed }) => {
    if (url === '/rpc')
      return [
        200,
        rpcAnswer(
          {
            genesis: 'a-validator-of-this-machine',
            recent: seen.launch ? blockhashesOf(seen.launch) : [],
            accounts: new Set(),
            balance: 400_000_000,
          },
          json,
        ),
      ];
    if (!url.startsWith('/api/kit/games/g1/coin')) return null;
    if (!authed) return [401, { error: 'Sign in first.' }];
    const live = {
      kind: 'launched',
      status: 'live',
      name: 'Moth Coin',
      symbol: 'MOTH',
      mint: seen.launch?.mint,
      venue: 'meteora',
      pair: 'SOL',
    };
    const status = {
      ok: true,
      on: true,
      launch: { on: !seen.why, started: false, sent: false, partly: false, ...(seen.why ? { why: seen.why } : {}) },
      own: seen.own ?? (seen.live ? live : null),
      venues: VENUE_LIST,
      pictures: [{ path: 'art/coin.png', bytes: 900 }],
      morePictures: 0,
    };
    if (method === 'GET') return [200, status];
    if (method === 'POST') {
      seen.posts.push(json);
      // a launch as the launchpad builds one (the fixture's own bytes, with its real settings), made over for the
      // wallet that asks, a coin and a curve of new keys that really sign, and the coin's link on xgames.fun
      seen.launch = remade(FIXTURE.meteora, 'meteora', WRAPPED_SOL, json.wallet);
      return [
        200,
        {
          ok: true,
          transactions: seen.launch.transactions,
          lastValidBlockHeight: 9,
          mint: seen.launch.mint,
          resume: false,
        },
      ];
    }
    if (method === 'PUT') {
      seen.puts.push(json);
      seen.live = true;
      return [200, { ...status, own: live }];
    }
    return [200, status];
  };
  const xc = args => runAsync(['coin', ...args], { env, cwd: dir });

  let r = await xc([]);
  assert.equal(r.status, 0, r.stderr);
  // the venues in this command's own words, with what xgames.fun says each pairs a coin with
  assert.match(
    r.stdout,
    /moth-run has no coin yet\.\n +meteora +Meteora: a curve of its own.*Pairs: SOL, USDC\n +pumpfun +pump\.fun: its curve.*Pairs: SOL, USDC\n +pictures +art\/coin\.png\nLaunch one: .*coin launch --name <name> --ticker <TICKER> --picture <file> --keypair <keyfile>/s,
  );
  assert.doesNotMatch(r.stdout, /whatever the server says/);

  const launch = [
    'launch',
    '--name',
    'Moth Coin',
    '--ticker',
    'moth',
    '--picture',
    'art/coin.png',
    '--keypair',
    keyFile,
  ];
  r = await xc(launch);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ticker +MOTH\n/);
  assert.match(r.stdout, new RegExp(`signed by +${address} \\(the key file `));
  assert.match(r.stdout, /it holds 0\.4 SOL\n/);
  const code = r.stdout.match(/--yes ([0-9a-f]{8})\n$/)?.[1];
  assert.ok(code, r.stdout);
  assert.match(
    r.stdout,
    /coin launch --name 'Moth Coin' --ticker moth --picture art\/coin\.png --keypair \S+ --yes [0-9a-f]{8}\n$/,
  );
  assert.equal(seen.posts.length, 0, 'the plan begins nothing');
  // the plan as JSON, for an agent: the code and the command that sends it
  const asJson = JSON.parse((await xc([...launch, '--json'])).stdout);
  assert.deepEqual(
    [asJson.planned, asJson.code, asJson.plan.wallet, asJson.plan.balance, asJson.plan.quote],
    [true, code, address, '400000000', WRAPPED_SOL],
  );
  assert.match(asJson.next, new RegExp(`--yes ${code}$`));

  r = await xc([...launch, '--yes', '00000000']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /That code is not for this launch/);
  assert.equal(seen.posts.length, 0);

  r = await xc([...launch, '--yes', code]);
  assert.equal(r.status, 0, r.stderr);
  const mint = seen.launch.mint;
  assert.match(
    r.stdout,
    new RegExp(
      `^\\$MOTH \\(Moth Coin\\) is live on Solana devnet, on Meteora, paired with SOL\\.\\n +mint +${mint}\\n +explorer +https://explorer\\.solana\\.com/address/${mint}\\?cluster=devnet\\n`,
    ),
  );
  assert.match(r.stdout, new RegExp(`loot token ${mint} prints its entry`));
  assert.doesNotMatch(r.stdout, /public RPC did not answer/, 'read through the person’s own RPC: nothing to add');
  assert.deepEqual(seen.posts[0], {
    name: 'Moth Coin',
    symbol: 'MOTH',
    description: '',
    picture: 'art/coin.png',
    venue: 'meteora',
    pair: 'SOL',
    wallet: address,
  });
  // the key file's own signature, over the message that was built, and no other signature touched
  const sent = readTransaction(fromBase64(seen.puts[0].transactions[0]));
  const builtFor = readTransaction(fromBase64(seen.launch.transactions[0]));
  assert.equal(sent.signers[0], address);
  assert.ok(!sent.signatures.some(isEmptySignature));
  assert.deepEqual(sent.message, builtFor.message);
  assert.deepEqual(sent.signatures.slice(1), builtFor.signatures.slice(1));
  const pub = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(decodeBase58(address))]),
    format: 'der',
    type: 'spki',
  });
  assert.equal(verify(null, sent.message, pub, sent.signatures[0]), true, 'the key file signed the launch');
  // neither the plan nor the launch printed anything of the key file but its address and its path
  const secret = JSON.parse(await readFile(keyFile, 'utf8'));
  assert.ok(Array.isArray(secret) && secret.length === 64);
  for (const leak of [
    Buffer.from(secret.slice(0, 32)).toString('hex'),
    secret.slice(0, 8).join(','),
    encodeBase58(new Uint8Array(secret)),
  ])
    assert.ok(!r.stdout.includes(leak) && !r.stderr.includes(leak));

  r = await xc([]);
  assert.match(
    r.stdout,
    /moth-run's coin is live on Solana devnet: \$MOTH \(Moth Coin\), on Meteora, paired with SOL\./,
  );
  r = await xc([...launch, '--yes', code]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already launched: \$MOTH/);

  // What xgames.fun says of a coin is its text: a ticker or a reason dressed to hide the real lines, or to forge
  // some, is shown as plain text, and what is no address is not shown as one.
  seen.own = {
    kind: 'launched',
    status: 'live',
    symbol: 'MOTH\u001b[8m',
    name: 'Moth\nxcore: all good\u001b[2K',
    mint: `${mint}\n  mint      ${other()}`,
    venue: 'meteora\u001b[1A',
    pair: 'SOL\r',
  };
  r = await xc([]);
  assert.doesNotMatch(r.stdout.replaceAll('\n', ''), HIDDEN);
  // (and a coin xgames.fun names that is not the one this folder's key launched is said as that, never shown as the
  // game's: here it is no address at all)
  assert.match(
    r.stdout,
    new RegExp(
      `^xgames\\.fun names \\(not an address\\) as moth-run's coin, but the coin this folder's key launched is ${mint} \\(\\$MOTH, recorded in \\.gamesfun/coin\\.json\\)\\.\\n`,
    ),
  );
  assert.equal(r.stdout.split('\n').filter(l => /^ +mint /.test(l)).length, 0);
  // the same through --json: the server's text with every hiding character escaped, and `differs` said
  // (a direction mark JSON itself leaves as it is: escaped all the same)
  seen.own = { ...seen.own, name: `${seen.own.name}${String.fromCodePoint(0x202e)}` };
  const j = await xc(['--json']);
  assert.match(j.stdout, /\\u202e/);
  assert.doesNotMatch(j.stdout.replaceAll('\n', ''), HIDDEN);
  assert.deepEqual([JSON.parse(j.stdout).differs, JSON.parse(j.stdout).recorded.mint], [true, mint]);
  // another coin, at an address: the same
  seen.own = { ...seen.own, mint: other(), symbol: 'MOTH', name: 'Moth Coin', venue: 'meteora', pair: 'SOL' };
  r = await xc([]);
  assert.match(r.stdout, /^xgames\.fun names \S+ as moth-run's coin, but the coin this folder's key launched is /);
  seen.own = null;
  seen.live = false;
  seen.why = 'off\n\u001b[2Kxcore: launched \u202e';
  r = await xc([]);
  assert.equal(r.stdout, 'moth-run has no coin yet.\noff[2Kxcore: launched \n');
  seen.why = null;

  // usage: what a launch needs, said before the folder is looked at
  for (const [args, said] of [
    [['launch'], /launch needs --name/],
    [['launch', '--name', 'A'], /launch needs --ticker/],
    [['launch', '--name', 'A', '--ticker', 'AB', '--picture', 'a.png'], /launch needs --keypair/],
  ]) {
    const u = run(['coin', ...args], { cwd: tmp.dir, env });
    assert.equal(u.status, 2);
    assert.match(u.stderr, said);
  }
  const drop = await xc(['drop']);
  assert.equal(drop.status, 0, drop.stderr);
  assert.match(drop.stdout, /xgames\.fun gave up moth-run's launch \(it does so only for one it never sent\)\./);
});
