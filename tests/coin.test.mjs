// `xcore coin` (lib/coin.mjs, commands/coin.mjs): a coin that trades, launched through xgames.fun's launchpad and
// signed by a key file here. The launchpad builds the transactions, so the tests hold the check that stands between it
// and the key: real launches of both venues pass (tests/fixtures/coin-launch.json, built with the launchpad's own
// SDKs), and the same transactions with anything more in them are refused before a signature is made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeBase58 } from '@xgamesfun/solana/chain/base58';
import { fromBase64, toBase64 } from '@xgamesfun/solana/chain/bytes';
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
  CoinError,
  coinStatus,
  dropLaunch,
  launchCode,
  launchCoin,
  LEAST_SHARE_BPS,
  MOST_LAMPORTS,
  planText,
  solanaTools,
  VENUES,
} from '../lib/coin.mjs';
import { saveSecret } from '../lib/credentials.mjs';
import { lootProgram, solanaRoot } from '../lib/economy.mjs';
import { credentialKey } from '../lib/publish/client.mjs';
import { ROOT, run, runAsync, signIn, standIn, tempDir } from './helpers.mjs';

// (a new key that signs, as the launchpad's are: the package keeps it with its approval code, not among its exports)
const { freshKeypair } = await import(pathToFileURL(path.join(solanaRoot(), 'js', 'approve', 'ed25519.mjs')).href);
const FIXTURE = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'coin-launch.json'), 'utf8'));
const tools = await solanaTools();
const LOOT = lootProgram();
const SYSTEM = '11111111111111111111111111111111',
  TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  BUDGET = 'ComputeBudget111111111111111111111111111111',
  ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  PUMP_FEES = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ',
  DBC = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
const disc = name => new Uint8Array(createHash('sha256').update(`global:${name}`).digest().subarray(0, 8));
const le = (value, size) => {
  const b = Buffer.alloc(size);
  if (size === 8) b.writeBigUInt64LE(BigInt(value));
  else b.writeUInt32LE(Number(value));
  return new Uint8Array(b);
};
const bytes = (...parts) => new Uint8Array(Buffer.concat(parts.map(p => Buffer.from(p))));
const other = () => freshKeypair().address;

/** A wire transaction's parts as they were built: { payer, blockhash, instructions: [{ programId, keys, data }] }. */
function parts(b64) {
  const t = readTransaction(fromBase64(b64));
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
/** Those parts as the launchpad hands a transaction out: every signer but the payer has signed. */
function wireOf(p, { signed = true, ...more } = {}) {
  const message = compileMessage({ payer: p.payer, blockhash: p.blockhash, instructions: p.instructions, ...more });
  return wireTransaction(
    message,
    signersOf(message).map((_, i) => (i === 0 || !signed ? new Uint8Array(64) : new Uint8Array(64).fill(7))),
  );
}
/** A launch's wires with `change(parts of transaction n)` applied to it. */
const changed = (launch, n, change, options) =>
  launch.transactions.map((b64, i) => {
    if (i !== n) return fromBase64(b64);
    const p = parts(b64);
    change(p);
    return wireOf(p, options);
  });
const check = (launch, venue, wires = launch.transactions.map(fromBase64), more = {}) =>
  checkLaunch(wires, { wallet: launch.wallet, venue, mint: launch.mint, loot: LOOT, tools, ...more });
const refused = (act, words) =>
  assert.throws(act, e => {
    assert.ok(e instanceof CoinError, e.stack);
    assert.equal(e.code, 'refused');
    assert.match(e.message, /^The launch xgames\.fun built is not one this key signs: /);
    assert.match(e.message, words);
    assert.match(e.message, /Nothing was signed and nothing was sent\.$/);
    return true;
  });

test('a real launch of each venue passes: its instructions, the coin its own key signed, the SOL it names', () => {
  assert.deepEqual(check(FIXTURE.meteora, 'meteora'), {
    mint: FIXTURE.meteora.mint,
    lamports: 15_000n,
    steps: ['create_config', 'initialize_virtual_pool_with_spl_token'],
  });
  assert.deepEqual(check(FIXTURE.pumpfun, 'pumpfun').steps, [
    'create_v2',
    'sweep_creator_fee',
    'create_fee_sharing_config',
    'update_fee_shares_v2 (this key keeps 50% of the creator fee)',
  ]);
  // a pump.fun coin paired with a token also makes the fee vault's token account
  assert.deepEqual(check(FIXTURE.pumpfunUsdc, 'pumpfun').steps.slice(1, 4), [
    'sweep_creator_fee',
    'create_fee_sharing_config',
    'a token account',
  ]);
  // the mutations below take a fixture apart and build it again: built again as it was, it is the same launch
  for (const [launch, venue] of [
    [FIXTURE.meteora, 'meteora'],
    [FIXTURE.pumpfun, 'pumpfun'],
    [FIXTURE.pumpfunUsdc, 'pumpfun'],
  ])
    assert.deepEqual(
      check(
        launch,
        venue,
        launch.transactions.map(b64 => wireOf(parts(b64))),
      ),
      check(launch, venue),
    );
});

test('anything that is not a launch is refused, in words that say what it held', () => {
  const { meteora, pumpfun, pumpfunUsdc } = FIXTURE;
  const wallet = pumpfun.wallet,
    mint = pumpfun.mint;
  const signer = { pubkey: wallet, isSigner: true, isWritable: true };
  const add = (launch, n, ix, options) => changed(launch, n, p => p.instructions.push(ix), options);

  // a buy of the coin, in the launch's own transaction (the creator's SOL, or a token it holds, spent)
  for (const name of ['buy', 'buy_exact_sol_in', 'buy_exact_quote_in_v3', 'sell', 'set_creator'])
    refused(
      () =>
        check(
          pumpfun,
          'pumpfun',
          add(pumpfun, 0, {
            programId: PUMP,
            keys: [{ pubkey: mint, isSigner: false, isWritable: false }, signer],
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
          add(pumpfun, 1, {
            programId: PUMP_FEES,
            keys: [{ pubkey: mint, isSigner: false, isWritable: false }, signer],
            data: bytes(disc(name)),
          }),
        ),
      /transaction 2 of 2 holds an instruction of pump\.fun that is not part of a launch/,
    );
  for (const name of ['swap', 'swap2', 'transfer_pool_creator', 'claim_creator_trading_fee'])
    refused(
      () =>
        check(
          meteora,
          'meteora',
          add(meteora, 0, {
            programId: DBC,
            keys: [
              { pubkey: meteora.mint, isSigner: false, isWritable: false },
              { ...signer, pubkey: meteora.wallet },
            ],
            data: bytes(disc(name), le(5n, 8)),
          }),
        ),
      /its transaction holds an instruction of Meteora that is not part of a launch/,
    );
  // a token the key holds, moved; another program altogether; the other venue's
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        add(pumpfun, 1, {
          programId: TOKEN,
          keys: [
            { pubkey: other(), isSigner: false, isWritable: true },
            { pubkey: other(), isSigner: false, isWritable: true },
            signer,
          ],
          data: bytes([3], le(1_000_000n, 8)),
        }),
      ),
    new RegExp(`transaction 2 of 2 calls the program ${TOKEN}, which is no part of a launch on pump\\.fun`),
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

  // loot, the program of the game's economy: called, or only named by something else
  refused(
    () =>
      check(pumpfun, 'pumpfun', add(pumpfun, 1, { programId: LOOT, keys: [signer], data: bytes(disc('set_project')) })),
    /transaction 2 of 2 names loot, the program of the game’s economy/,
  );
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        changed(pumpfun, 1, p => p.instructions[0].keys.push({ pubkey: LOOT, isSigner: false, isWritable: false })),
      ),
    /names loot, the program of the game’s economy/,
  );

  // the System program: only a new account or a transfer of the key's own, and little
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        add(pumpfun, 1, { programId: SYSTEM, keys: [signer], data: bytes(le(1, 4), decodeBase58(TOKEN)) }),
      ),
    /holds a System instruction that is not a new account or a transfer of this key’s/,
  );
  const transfer = lamports => ({
    programId: SYSTEM,
    keys: [signer, { pubkey: other(), isSigner: false, isWritable: true }],
    data: bytes(le(2, 4), le(lamports, 8)),
  });
  assert.equal(check(pumpfun, 'pumpfun', add(pumpfun, 1, transfer(20_000_000n))).lamports, 20_015_000n);
  refused(
    () => check(pumpfun, 'pumpfun', add(pumpfun, 1, transfer(MOST_LAMPORTS))),
    /it names 0\.1 SOL of this key’s, more than the 0\.1 SOL a launch may name/,
  );
  // (two that are each under the most, in two transactions, are counted together)
  refused(
    () =>
      check(pumpfun, 'pumpfun', [
        ...add(pumpfun, 0, transfer(60_000_000n)).slice(0, 1),
        ...add(pumpfun, 1, transfer(60_000_000n)).slice(1),
      ]),
    /it names 0\.12 SOL of this key’s/,
  );
  // a priority fee of the launchpad's own choosing is the key's SOL too
  const budget = (kind, value, size) => ({ programId: BUDGET, keys: [], data: bytes([kind], le(value, size)) });
  assert.equal(
    check(
      pumpfun,
      'pumpfun',
      changed(pumpfun, 0, p => p.instructions.unshift(budget(2, 400_000, 4), budget(3, 1_000n, 8))),
    ).lamports,
    15_400n,
  );
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        changed(pumpfun, 0, p => p.instructions.unshift(budget(3, 1_000_000_000n, 8))),
      ),
    /it names 0\.2 SOL of this key’s/,
  );
  refused(
    () => check(pumpfun, 'pumpfun', add(pumpfun, 0, { programId: BUDGET, keys: [], data: bytes([9]) })),
    /a compute budget instruction of a kind not known here/,
  );
  // an associated-token instruction that is not a new account (2 moves the tokens of a nested account)
  refused(
    () =>
      check(
        pumpfunUsdc,
        'pumpfun',
        changed(pumpfunUsdc, 1, p => (p.instructions.find(ix => ix.programId === ATA).data = bytes([2]))),
      ),
    /holds an associated-token instruction that is not a new token account/,
  );

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
  // another key's transaction, one that wants a signature nobody gave, and what is no transaction
  refused(() => check({ ...pumpfun, wallet: other() }, 'pumpfun'), /transaction 1 of 2 is not paid for by this key/);
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        changed(pumpfun, 0, () => {}, { signed: false }),
      ),
    new RegExp(`wants a signature of ${mint}, which is not this key’s to give`),
  );
  refused(() => check(pumpfun, 'pumpfun', [new Uint8Array(40)]), /its transaction is not a transaction/);
  refused(() => check(pumpfun, 'pumpfun', []), /it is not one to four transactions/);
  refused(
    () => check(pumpfun, 'pumpfun', Array(5).fill(fromBase64(pumpfun.transactions[1]))),
    /not one to four transactions/,
  );
  refused(() => check({ ...pumpfun, mint: undefined }, 'pumpfun'), /it does not say which coin it launches/);
});

test('the launch is for one new coin: its own key signs, and nothing in it is for another', () => {
  const { pumpfun, meteora } = FIXTURE;
  const first = fromBase64(pumpfun.transactions[0]),
    second = fromBase64(pumpfun.transactions[1]);
  // the fee split of some other coin of the key's, slipped into this launch
  const theirs = other();
  for (const name of ['update_fee_shares_v2', 'create_fee_sharing_config', 'sweep_creator_fee'])
    refused(
      () =>
        check(
          pumpfun,
          'pumpfun',
          changed(pumpfun, 1, p => {
            const ix = p.instructions.find(i => Buffer.from(i.data.subarray(0, 8)).equals(Buffer.from(disc(name))));
            ix.keys = ix.keys.map(k => (k.pubkey === pumpfun.mint ? { ...k, pubkey: theirs } : k));
          }),
        ),
      new RegExp(`transaction 2 of 2 holds a ${name} that is not for the coin being launched`),
    );
  // a coin that exists already (its key did not sign), named as the one being launched
  refused(
    () => check({ ...meteora, mint: other() }, 'meteora'),
    /holds a initialize_virtual_pool_with_spl_token that is not for the coin being launched/,
  );
  refused(
    () => check(pumpfun, 'pumpfun', [second]),
    /the coin it launches is not a new one \(its own key did not sign\)/,
  );
  refused(() => check(pumpfun, 'pumpfun', [second, first]), /the coin it launches is not a new one/);

  // The rest of a launch begun earlier (a pump.fun coin that exists and wants its second transaction): only for the
  // coin this folder recorded when it signed the first.
  assert.deepEqual(check(pumpfun, 'pumpfun', [second], { resume: true, begun: pumpfun.mint }).steps.length, 3);
  refused(
    () => check(pumpfun, 'pumpfun', [second], { resume: true }),
    /the rest of a launch that was not begun from this folder.*finish it where it was begun/,
  );
  refused(
    () => check(pumpfun, 'pumpfun', [second], { resume: true, begun: theirs }),
    /it is for another coin than the one this folder began launching/,
  );
});

test('a pump.fun coin’s creator fee: the key keeps the half it was told, or the launch is not signed', () => {
  const { pumpfun } = FIXTURE;
  const split = shares =>
    changed(pumpfun, 1, p => {
      const ix = p.instructions.at(-1);
      ix.data = bytes(
        ix.data.subarray(0, 8),
        le(shares.length, 4),
        ...shares.flatMap(([address, bps]) => [decodeBase58(address), [bps & 255, bps >> 8]]),
      );
    });
  assert.equal(LEAST_SHARE_BPS, 5000);
  assert.match(
    check(pumpfun, 'pumpfun', split([[pumpfun.wallet, 10_000]])).steps.at(-1),
    /keeps 100% of the creator fee/,
  );
  assert.match(
    check(
      pumpfun,
      'pumpfun',
      split([
        [pumpfun.partner, 5000],
        [pumpfun.wallet, 5000],
      ]),
    ).steps.at(-1),
    /keeps 50%/,
  );
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        split([
          [pumpfun.wallet, 4000],
          [pumpfun.partner, 6000],
        ]),
      ),
    /gives this key 40% of the coin’s creator fee, not the half it was told/,
  );
  refused(
    () => check(pumpfun, 'pumpfun', split([[pumpfun.partner, 10_000]])),
    /gives this key 0% of the coin’s creator fee/,
  );
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        split([
          [other(), 5000],
          [pumpfun.partner, 5000],
        ]),
      ),
    /gives this key 0%/,
  );
  // shares that do not add up, or data that is not a list of shareholders: not read as a split at all
  refused(
    () =>
      check(
        pumpfun,
        'pumpfun',
        split([
          [pumpfun.wallet, 5000],
          [pumpfun.partner, 4000],
        ]),
      ),
    /a split of the coin’s creator fee that can’t be read here/,
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
});

test('every instruction a venue’s launch is made of is one its program has, and no trade is among them', () => {
  for (const venue of Object.values(VENUES))
    for (const names of Object.values(venue.programs))
      for (const name of names)
        assert.doesNotMatch(name, /buy|sell|swap|claim|withdraw|transfer|migrate|set_|admin/, name);
});

// ---- the command's calls --------------------------------------------------------------------------------------------

const ORIGIN = 'https://studio.example';
const VENUE_LIST = [
  {
    venue: 'meteora',
    says: 'Meteora: a curve of its own, then a pool. You keep about 40% of its trading fees.',
    pairs: [
      { symbol: 'SOL', name: 'Solana', mint: 'So11111111111111111111111111111111111111112' },
      { symbol: 'USDC', name: 'USDC', mint: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr' },
    ],
  },
  {
    venue: 'pumpfun',
    says: 'pump.fun: its curve. The creator fee is shared half and half with XGames.fun.',
    pairs: [{ symbol: 'SOL', name: 'Solana', mint: 'So11111111111111111111111111111111111111112' }],
  },
];
const FORM = { name: 'Moth Coin', symbol: 'MOTH', description: 'For the moths.', picture: 'art/coin.png' };

/** A game folder that was published, a saved sign-in, and a stand-in for xgames.fun's coin route and the RPC. */
async function setup(t, { launch = FIXTURE.meteora, balance = 500_000_000 } = {}) {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const env = {
    GAMESFUN_CONFIG_DIR: path.join(tmp.dir, 'config'),
    GAMESFUN_CREDENTIALS: 'file',
    XSOLANA_RPC_URL: 'https://rpc.example/key',
  };
  const dir = path.join(tmp.dir, 'game');
  await mkdir(path.join(dir, '.gamesfun'), { recursive: true });
  await writeFile(path.join(dir, '.gamesfun', 'publish.json'), JSON.stringify({ [ORIGIN]: { projectId: 'g-9' } }));
  await saveSecret(credentialKey(ORIGIN), 'gfk_test_token', { studio: ORIGIN, email: 'a@example.com' }, { env });
  const state = {
    calls: [],
    status: {
      ok: true,
      on: true,
      own: null,
      launch: { on: true, started: false, sent: false, partly: false },
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
      launch: { on: true, started: false, sent: false, partly: false },
    },
    balance,
  };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.origin === 'https://rpc.example') {
      const q = JSON.parse(init.body);
      state.calls.push(['rpc', q.method, q.params[0]]);
      if (state.balance == null) return new Response('no', { status: 500 });
      return Response.json({ jsonrpc: '2.0', id: q.id, result: { context: { slot: 1 }, value: state.balance } });
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
  return { dir, env, state, key, opts, sent };
}

test('a launch sends nothing until it is run with the code it printed; the code covers every choice', async t => {
  const { dir, state, key, opts, sent } = await setup(t);
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
      venueSays: VENUE_LIST[0].says,
      pair: 'SOL',
      wallet: FIXTURE.meteora.wallet,
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
  assert.deepEqual(
    state.calls.find(c => c[0] === 'rpc'),
    ['rpc', 'getBalance', FIXTURE.meteora.wallet],
  );

  const text = planText(planned.plan, {
    game: 'moth-run',
    keyFile: opts.keyFile,
    code: planned.code,
    command: 'xcore coin launch --name "Moth Coin"',
  });
  for (const words of [
    /A coin for moth-run, launched on Solana devnet:/,
    /name +Moth Coin/,
    /ticker +MOTH/,
    /picture +art\/coin\.png/,
    /where +Meteora: a curve of its own/,
    /paired with +SOL/,
    new RegExp(`signed by +${FIXTURE.meteora.wallet} \\(the key file ~/\\.config/xsolana/moth\\.json\\)`),
    /it holds 0\.5 SOL\n/,
    /takes about 0\.03 SOL from the key/,
    /creator fees belong to\nthis key's address/,
    /no buy, no\nmove of a token the key holds, nothing of loot/,
    /It can’t be undone: a game has one coin/,
    /A devnet coin trades nothing of value/,
    /nothing here is legal advice/,
    new RegExp(
      `Nothing was sent\\. To launch it, run this again with the code:\\n  xcore coin launch --name "Moth Coin" --yes ${planned.code}$`,
    ),
  ])
    assert.match(text, words);

  // the same choices give the same code, whatever the key holds; any other choice, another
  assert.equal(launchCode(planned.plan), planned.code);
  assert.equal(launchCode({ ...planned.plan, balance: 1n, venueSays: 'x', resume: true }), planned.code);
  for (const [k, v] of [
    ['game', 'g-10'],
    ['name', 'Moth Coin '],
    ['symbol', 'MOTHS'],
    ['description', ''],
    ['picture', 'art/other.png'],
    ['venue', 'pumpfun'],
    ['pair', 'USDC'],
    ['wallet', other()],
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
  assert.deepEqual([sent('POST').length, sent('PUT').length, key.signed.length], [0, 0, 0]);
});

test('with the code: begun for the key’s address, checked, signed here, handed back, and the coin is live', async t => {
  const { dir, key, opts, sent } = await setup(t);
  const { code } = await launchCoin(dir, FORM, opts);
  const r = await launchCoin(dir, FORM, { ...opts, yes: code.toUpperCase() });
  assert.deepEqual(
    { ...r, coin: r.coin.symbol },
    {
      ok: true,
      launched: true,
      waiting: false,
      partly: false,
      mint: FIXTURE.meteora.mint,
      coin: 'MOTH',
      explorer: `https://explorer.solana.com/address/${FIXTURE.meteora.mint}?cluster=devnet`,
      steps: ['create_config', 'initialize_virtual_pool_with_spl_token'],
    },
  );
  assert.deepEqual(sent('POST')[0][3], {
    name: 'Moth Coin',
    symbol: 'MOTH',
    description: 'For the moths.',
    picture: 'art/coin.png',
    venue: 'meteora',
    pair: 'SOL',
    wallet: FIXTURE.meteora.wallet,
  });
  // what went back is what was built, with the key's signature in its own slot and the others as they were
  const [back] = sent('PUT')[0][3].transactions.map(fromBase64);
  const built = readTransaction(fromBase64(FIXTURE.meteora.transactions[0])),
    signed = readTransaction(back);
  assert.deepEqual(signed.message, built.message);
  assert.deepEqual(signed.signatures[0], new Uint8Array(64).fill(9));
  assert.deepEqual(signed.signatures.slice(1), built.signatures.slice(1));
  assert.equal(key.signed.length, 1);
  assert.equal(key.dropped, 2, 'the key is let go after each run');
  // the folder remembers which coin it began (kept out of git with the rest of .gamesfun)
  const record = JSON.parse(await readFile(path.join(dir, '.gamesfun', 'coin.json'), 'utf8'))[ORIGIN];
  assert.deepEqual([record.mint, record.venue], [FIXTURE.meteora.mint, 'meteora']);
  assert.match(await readFile(path.join(dir, '.gamesfun', '.gitignore'), 'utf8'), /^\*$/m);
});

test('a launch that is anything more is given up before a signature is made', async t => {
  const { dir, state, key, opts, sent } = await setup(t, { launch: FIXTURE.pumpfun });
  const form = { ...FORM, venue: 'pumpfun' };
  const { code } = await launchCoin(dir, form, opts);
  // the launchpad (or whoever answers as it) adds a transfer of the key's SOL to the launch
  const p = parts(FIXTURE.pumpfun.transactions[1]);
  p.instructions.push({
    programId: SYSTEM,
    keys: [
      { pubkey: FIXTURE.pumpfun.wallet, isSigner: true, isWritable: true },
      { pubkey: other(), isSigner: false, isWritable: true },
    ],
    data: bytes(le(2, 4), le(900_000_000n, 8)),
  });
  state.prepared = { ...state.prepared, transactions: [FIXTURE.pumpfun.transactions[0], toBase64(wireOf(p))] };
  await assert.rejects(
    launchCoin(dir, form, { ...opts, yes: code }),
    e =>
      e.code === 'refused' &&
      /it names 0\.9 SOL of this key’s.*Nothing was signed and nothing was sent\./.test(e.message),
  );
  assert.deepEqual(
    [key.signed.length, sent('PUT').length, sent('DELETE').length],
    [0, 0, 1],
    'not signed, not sent, and the launch given up',
  );
  // and what is no transaction at all
  state.prepared = { ...state.prepared, transactions: ['AAAA'] };
  await assert.rejects(launchCoin(dir, form, { ...opts, yes: code }), e => e.code === 'refused');
  state.prepared = { ok: true };
  await assert.rejects(
    launchCoin(dir, form, { ...opts, yes: code }),
    e => e.code === 'refused' && /not one to four transactions/.test(e.message),
  );
  assert.equal(key.signed.length, 0);
  assert.equal(sent('DELETE').length, 3);
});

test('the rest of a pump.fun launch is signed only for the coin this folder began', async t => {
  const { dir, state, key, opts, sent } = await setup(t, { launch: FIXTURE.pumpfun });
  const form = { ...FORM, venue: 'pumpfun' };
  // the first run: both transactions signed and sent; the chain took the first only
  state.after = {
    ...state.status,
    own: { kind: 'launching', status: 'pending', name: 'Moth Coin', symbol: 'MOTH', mint: null, venue: 'pumpfun' },
    launch: { on: true, started: true, sent: false, partly: true },
  };
  const { code } = await launchCoin(dir, form, opts);
  const first = await launchCoin(dir, form, { ...opts, yes: code });
  assert.deepEqual([first.launched, first.waiting, first.partly, key.signed.length], [false, true, true, 2]);
  // again: xgames.fun hands out the second transaction alone
  state.status = state.after;
  state.prepared = {
    ok: true,
    transactions: [FIXTURE.pumpfun.transactions[1]],
    mint: FIXTURE.pumpfun.mint,
    resume: true,
  };
  state.after = {
    ...state.status,
    own: {
      kind: 'launched',
      status: 'live',
      name: 'Moth Coin',
      symbol: 'MOTH',
      mint: FIXTURE.pumpfun.mint,
      venue: 'pumpfun',
      pair: 'SOL',
    },
    launch: { on: true, started: false, sent: false, partly: false },
  };
  const again = await launchCoin(dir, form, opts);
  assert.equal(again.plan.resume, true);
  assert.equal(again.code, code, 'the same choices, the same code');
  const done = await launchCoin(dir, form, { ...opts, yes: code });
  assert.deepEqual([done.launched, key.signed.length, sent('PUT').at(-1)[3].transactions.length], [true, 3, 1]);
  // for another coin, or from a folder that began none, it is not signed
  state.status = { ...state.status, own: state.status.own };
  state.prepared = { ...state.prepared, mint: FIXTURE.pumpfunUsdc.mint };
  await assert.rejects(
    launchCoin(dir, form, { ...opts, yes: code }),
    e => e.code === 'refused' && /not for the coin being launched|another coin/.test(e.message),
  );
  await writeFile(path.join(dir, '.gamesfun', 'coin.json'), '{}');
  state.prepared = { ...state.prepared, mint: FIXTURE.pumpfun.mint };
  await assert.rejects(
    launchCoin(dir, form, { ...opts, yes: code }),
    e => e.code === 'refused' && /not begun from this folder/.test(e.message),
  );
  assert.equal(key.signed.length, 3);
});

test('what a launch is refused for before anything is begun', async t => {
  const { dir, state, key, opts, sent } = await setup(t);
  const fresh = state.status;
  const refusedFor = async (status, form, code, words) => {
    state.status = status;
    await assert.rejects(
      launchCoin(dir, form, opts),
      e => e instanceof CoinError && e.code === code && words.test(e.message),
      `${code}`,
    );
  };
  await refusedFor(
    { ok: true, on: false, why: 'The Token tab is not on for this XGames.fun yet.' },
    FORM,
    'launch-off',
    /The Token tab is not on/,
  );
  await refusedFor(
    {
      ...fresh,
      launch: { on: false, why: 'Launching a coin from here is not on for this XGames.fun yet.' },
      venues: undefined,
    },
    FORM,
    'launch-off',
    /not on for this XGames\.fun yet/,
  );
  await refusedFor(
    { ...fresh, own: { kind: 'launched', symbol: 'MOTH', mint: FIXTURE.meteora.mint } },
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
  await refusedFor(fresh, { ...FORM, venue: 'raydium' }, 'usage', /--venue is one of: meteora, pumpfun/);
  await refusedFor(
    fresh,
    { ...FORM, venue: 'pumpfun', pair: 'USDC' },
    'usage',
    /--pair is one of: SOL \(what pump\.fun pairs a coin with here\)/,
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
  state.balance = 4_000_000;
  const poor = await launchCoin(dir, FORM, opts);
  assert.match(
    planText(poor.plan, { game: 'g', keyFile: 'k', code: poor.code, command: 'c' }),
    /it holds 0\.004 SOL: too little, send it devnet SOL first \(a launch takes about 0\.03\)/,
  );
  await assert.rejects(
    launchCoin(dir, FORM, { ...opts, yes: poor.code }),
    e => e.code === 'balance' && new RegExp(`Send devnet SOL to ${FIXTURE.meteora.wallet}`).test(e.message),
  );
  // an RPC that does not answer holds nothing up: the plan says so, and xgames.fun's own check decides
  state.balance = null;
  const blind = await launchCoin(dir, FORM, opts);
  assert.equal(blind.plan.balance, null);
  assert.match(
    planText(blind.plan, { game: 'g', keyFile: 'k', code: blind.code, command: 'c' }),
    /its SOL could not be read from here/,
  );
  state.refusePrepare = {
    error: 'the wallet holds 4000000 lamports; the launch needs 25000000 (rent and fees)',
    code: 'insufficient_balance',
  };
  await assert.rejects(
    launchCoin(dir, FORM, { ...opts, yes: blind.code }),
    e => e.code === 'insufficient_balance' && /the launch needs 25000000/.test(e.message),
  );
  assert.deepEqual([sent('PUT').length, key.signed.length], [0, 0]);

  // signed and handed over, and xgames.fun's answer was a failure: said as that, with where to look
  state.refusePrepare = null;
  state.balance = 500_000_000;
  state.refuseSubmit = { error: 'The launchpad did not answer.' };
  await assert.rejects(
    launchCoin(dir, FORM, { ...opts, yes: blind.code }),
    e =>
      e instanceof CoinError &&
      /The launchpad did not answer\. The launch was signed and handed to xgames\.fun; see where it stands with: .*coin$/.test(
        e.message,
      ) &&
      e.mint === FIXTURE.meteora.mint,
  );
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

// ---- the command, with a real key file --------------------------------------------------------------------------------

test('the command: a plan, then a launch signed by a real key file, against a stand-in xgames.fun', async t => {
  const tmp = await tempDir(),
    g = await standIn();
  t.after(async () => {
    await g.close();
    await tmp.cleanup();
  });
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

  const mintKey = freshKeypair(),
    configKey = freshKeypair();
  const seen = { posts: [], puts: [], live: false };
  g.state.handle = (method, url, json, { authed }) => {
    if (url === '/rpc')
      return [200, { jsonrpc: '2.0', id: json.id, result: { context: { slot: 1 }, value: 400_000_000 } }];
    if (!url.startsWith('/api/kit/games/g1/coin')) return null;
    if (!authed) return [401, { error: 'Sign in first.' }];
    const status = {
      ok: true,
      on: true,
      launch: { on: true, started: false, sent: false, partly: false },
      own: seen.live
        ? {
            kind: 'launched',
            status: 'live',
            name: 'Moth Coin',
            symbol: 'MOTH',
            mint: mintKey.address,
            venue: 'meteora',
            pair: 'SOL',
          }
        : null,
      venues: VENUE_LIST,
      pictures: [{ path: 'art/coin.png', bytes: 900 }],
      morePictures: 0,
    };
    if (method === 'GET') return [200, status];
    if (method === 'POST') {
      seen.posts.push(json);
      // a launch as the launchpad builds one: a curve's settings and the coin's pool, signed by their own new keys
      const signer = { pubkey: json.wallet, isSigner: true, isWritable: true };
      const message = compileMessage({
        payer: json.wallet,
        blockhash: other(),
        instructions: [
          {
            programId: DBC,
            keys: [{ pubkey: configKey.address, isSigner: true, isWritable: true }, signer],
            data: bytes(disc('create_config'), le(7n, 8)),
          },
          {
            programId: DBC,
            keys: [
              { pubkey: configKey.address, isSigner: false, isWritable: false },
              signer,
              { pubkey: mintKey.address, isSigner: true, isWritable: true },
            ],
            data: bytes(disc('initialize_virtual_pool_with_spl_token'), le(9n, 8)),
          },
        ],
      });
      const signatures = signersOf(message).map(a =>
        a === mintKey.address
          ? mintKey.sign(message)
          : a === configKey.address
            ? configKey.sign(message)
            : new Uint8Array(64),
      );
      return [
        200,
        {
          ok: true,
          transactions: [toBase64(wireTransaction(message, signatures))],
          lastValidBlockHeight: 9,
          mint: mintKey.address,
          resume: false,
        },
      ];
    }
    if (method === 'PUT') {
      seen.puts.push(json);
      seen.live = true;
      return [
        200,
        {
          ...status,
          own: {
            kind: 'launched',
            status: 'live',
            name: 'Moth Coin',
            symbol: 'MOTH',
            mint: mintKey.address,
            venue: 'meteora',
            pair: 'SOL',
          },
        },
      ];
    }
    return [200, status];
  };
  const xc = args => runAsync(['coin', ...args], { env, cwd: dir });

  let r = await xc([]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stdout,
    /moth-run has no coin yet\.\n +meteora +Meteora: a curve of its own.*Pairs: SOL, USDC\n +pumpfun .*Pairs: SOL\n +pictures +art\/coin\.png\nLaunch one: .*coin launch --name <name> --ticker <TICKER> --picture <file> --keypair <keyfile>/s,
  );

  const launch = [
    'launch',
    '--name',
    'Moth Coin',
    '--ticker',
    'MOTH',
    '--picture',
    'art/coin.png',
    '--keypair',
    keyFile,
  ];
  r = await xc(launch);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`signed by +${address} \\(the key file `));
  assert.match(r.stdout, /it holds 0\.4 SOL\n/);
  const code = r.stdout.match(/--yes ([0-9a-f]{8})\n$/)?.[1];
  assert.ok(code, r.stdout);
  assert.match(
    r.stdout,
    /coin launch --name 'Moth Coin' --ticker MOTH --picture art\/coin\.png --keypair \S+ --yes [0-9a-f]{8}\n$/,
  );
  assert.equal(seen.posts.length, 0, 'the plan begins nothing');
  // the plan as JSON, for an agent: the code and the command that sends it
  const asJson = JSON.parse((await xc([...launch, '--json'])).stdout);
  assert.deepEqual(
    [asJson.planned, asJson.code, asJson.plan.wallet, asJson.plan.balance],
    [true, code, address, '400000000'],
  );
  assert.match(asJson.next, new RegExp(`--yes ${code}$`));

  r = await xc([...launch, '--yes', '00000000']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /That code is not for this launch/);
  assert.equal(seen.posts.length, 0);

  r = await xc([...launch, '--yes', code]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(
    r.stdout,
    new RegExp(
      `^\\$MOTH \\(Moth Coin\\) is live on Solana devnet, on Meteora, paired with SOL\\.\\n +mint +${mintKey.address}\\n +explorer +https://explorer\\.solana\\.com/address/${mintKey.address}\\?cluster=devnet\\n`,
    ),
  );
  assert.match(r.stdout, new RegExp(`loot token ${mintKey.address} prints its entry`));
  assert.equal(seen.posts[0].wallet, address);
  // the key file's own signature, over the message that was built, and no other signature touched
  const sent = readTransaction(fromBase64(seen.puts[0].transactions[0]));
  assert.equal(sent.signers[0], address);
  assert.ok(!sent.signatures.some(isEmptySignature));
  const pub = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(decodeBase58(address))]),
    format: 'der',
    type: 'spki',
  });
  assert.equal(verify(null, sent.message, pub, sent.signatures[0]), true, 'the key file signed the launch');
  // neither the plan nor the launch printed anything of the key file but its address and its path
  const secret = JSON.parse(await readFile(keyFile, 'utf8'));
  assert.ok(Array.isArray(secret) && secret.length === 64);
  assert.ok(
    !r.stdout.includes(Buffer.from(secret.slice(0, 32)).toString('hex')) &&
      !r.stdout.includes(secret.slice(0, 8).join(',')),
  );

  r = await xc([]);
  assert.match(
    r.stdout,
    /moth-run's coin is live on Solana devnet: \$MOTH \(Moth Coin\), on Meteora, paired with SOL\./,
  );
  r = await xc([...launch, '--yes', code]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already launched: \$MOTH/);

  // usage: what a launch needs, said before the folder is looked at
  for (const [args, words] of [
    [['launch'], /launch needs --name/],
    [['launch', '--name', 'A'], /launch needs --ticker/],
    [['launch', '--name', 'A', '--ticker', 'AB', '--picture', 'a.png'], /launch needs --keypair/],
  ]) {
    const u = run(['coin', ...args], { cwd: tmp.dir, env });
    assert.equal(u.status, 2);
    assert.match(u.stderr, words);
  }
  const drop = await xc(['drop']);
  assert.equal(drop.status, 0, drop.stderr);
  assert.match(drop.stdout, /Gave up moth-run's launch: nothing of it was sent\./);
});
