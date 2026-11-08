// The game's own Solana RPC on games.fun, written into server/ by `xcore add rpc`. Part of the game's server code
// (docs/SERVER.md): the economy's page client (gamesfun.js → GamesFun.loot) reads and sends through the game's own
// api/rpc instead of games.fun's shared relay (/loot/v1/rpc), so the game's calls go to the RPC its owner pays for
// (Helius, Triton, QuickNode: a devnet one, like loot) and never count toward the game's plan as relay calls.
//
// The RPC's URL (its key in it) is a secret of the game's server, never the page's:
//   xcore secret set XSOLANA_RPC_URL <folder>     on games.fun (asked for, never shown)
//   XSOLANA_RPC_URL=… in the folder's .dev.vars   under xcore dev
// Unset, api/rpc says so and the page keeps using games.fun's shared relay: nothing breaks.
//
//   GET  api/rpc   → {gamesfun: 'rpc', own: true | false}       what the page asks first, once a page load
//   POST api/rpc   one JSON-RPC request → the RPC's own answer
//
// It passes on only what loot's page client asks (RPC below: its methods, scans of loot's own programs, and the game's
// own transactions), so a stranger calling the game's api/rpc cannot spend the RPC's credits on anything else. Each
// call counts as one request to the game's server (its plan's rates).

export const RPC = {
  /** The JSON-RPC methods loot's page client calls (the same list as games.fun's shared relay). */
  methods: [
    'getAccountInfo',
    'getAsset',
    'getAssetProof',
    'getBalance',
    'getBlockHeight',
    'getFeeForMessage',
    'getGenesisHash',
    'getLatestBlockhash',
    'getMinimumBalanceForRentExemption',
    'getMultipleAccounts',
    'getProgramAccounts',
    'getSignatureStatuses',
    'getSlot',
    'getTokenAccountBalance',
    'getTransaction',
    'sendTransaction',
    'simulateTransaction',
  ],
  /** The programs getProgramAccounts may scan: loot, Metaplex Core (NFTs) and address lookup tables. */
  scanPrograms: [
    '9cwqM1TXytPnFZsLfmUyv2dg4uW6Ch9C6UJVPns7NFQ',
    'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d',
    'AddressLookupTab1e1111111111111111111111111',
  ],
  /** sendTransaction passes a transaction with an instruction of loot's (the first of scanPrograms), or one made only
   *  of these programs' instructions (a throwaway key sending SOL back): System and Compute Budget. */
  plainPrograms: ['11111111111111111111111111111111', 'ComputeBudget111111111111111111111111111111'],
  /** The largest request body passed on, in bytes. */
  maxBody: 64 * 1024,
  /** How long the RPC has to answer, in ms. */
  timeoutMs: 20_000,
};

const PATH = /\/api\/rpc\/?$/;
const answer = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const refuse = (id, code, message, status = 400) =>
  answer({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, status);

/** The game's RPC from env.XSOLANA_RPC_URL: a devnet https URL, else null. */
function ownRpc(env) {
  const value = typeof env?.XSOLANA_RPC_URL === 'string' ? env.XSOLANA_RPC_URL.trim() : '';
  if (!value || /mainnet/i.test(value)) return null; // loot runs on devnet only until it is audited
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(url.hostname))
      ? value
      : null;
  } catch {
    return null;
  }
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(text) {
  let n = 0n;
  for (const c of text) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error('not base58');
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  for (; n > 0n; n >>= 8n) bytes.unshift(Number(n & 255n));
  for (const c of text) {
    if (c !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}
const toBase58 = bytes => {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  for (; n > 0n; n /= 58n) out = B58[Number(n % 58n)] + out;
  for (const b of bytes) {
    if (b) break;
    out = '1' + out;
  }
  return out;
};

/** The programs a wire transaction's instructions call (legacy or v0), or null when it can't be read. */
export function transactionPrograms(wire, encoding = 'base58') {
  try {
    const tx = encoding === 'base64' ? Uint8Array.from(atob(String(wire)), c => c.charCodeAt(0)) : base58(String(wire));
    let at = 0;
    const shortvec = () => {
      let len = 0;
      for (let size = 0; ; size++) {
        const b = tx[at++];
        if (b === undefined) throw new Error('short');
        len |= (b & 0x7f) << (7 * size);
        if (!(b & 0x80)) return len;
      }
    };
    const signatures = shortvec();
    at += 64 * signatures;
    if (tx[at] & 0x80) at++; // v0
    at += 3; // header
    const keys = [];
    for (let n = shortvec(), i = 0; i < n; i++, at += 32) keys.push(toBase58(tx.subarray(at, at + 32)));
    at += 32; // recent blockhash
    const programs = [];
    for (let n = shortvec(), i = 0; i < n; i++) {
      const p = keys[tx[at++]];
      if (!p) return null; // a program must be a static key
      programs.push(p);
      const accounts = shortvec();
      at += accounts;
      const data = shortvec();
      at += data;
    }
    return at <= tx.length && programs.length ? programs : null;
  } catch {
    return null;
  }
}

/** api/rpc, or null for any other path (server/index.js tries the next part). */
export async function handleRpc(request, env) {
  if (!PATH.test(new URL(request.url).pathname)) return null;
  const rpc = ownRpc(env);
  if (request.method === 'GET') return answer({ gamesfun: 'rpc', own: Boolean(rpc) });
  if (request.method !== 'POST') return answer({ error: 'GET or POST' }, 405);
  if (!rpc)
    return refuse(
      null,
      -32000,
      "This game has no RPC of its own (XSOLANA_RPC_URL, a devnet https URL): use games.fun's /loot/v1/rpc.",
      503,
    );
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > RPC.maxBody)
    return refuse(null, -32600, 'The request is too large.', 413);
  let call;
  try {
    call = JSON.parse(text);
  } catch {
    return refuse(null, -32700, 'The request is not JSON.');
  }
  if (Array.isArray(call)) return refuse(null, -32600, 'One request a call, not a batch.');
  if (!call || typeof call.method !== 'string') return refuse(null, -32600, 'Not a JSON-RPC request.');
  if (!RPC.methods.includes(call.method))
    return refuse(call.id, -32601, `${call.method} is not passed on (RPC.methods in server/rpc.js).`);
  const params = Array.isArray(call.params) ? call.params : [];
  if (call.method === 'getProgramAccounts' && !(Array.isArray(params[1]?.filters) && params[1].filters.length))
    return refuse(call.id, -32602, 'getProgramAccounts needs filters (a scan of a whole program is not passed on).');
  if (call.method === 'getProgramAccounts' && !RPC.scanPrograms.includes(String(params[0])))
    return refuse(
      call.id,
      -32602,
      `getProgramAccounts of ${String(params[0]).slice(0, 44)} is not passed on (RPC.scanPrograms).`,
    );
  if (call.method === 'sendTransaction') {
    const programs = transactionPrograms(params[0], params[1]?.encoding);
    const loot = RPC.scanPrograms[0];
    if (!programs || !(programs.includes(loot) || programs.every(p => RPC.plainPrograms.includes(p))))
      return refuse(call.id, -32602, "Only the game's own transactions are sent here (loot's, or plain SOL sends).");
  }
  let upstream;
  try {
    upstream = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: text,
      signal: AbortSignal.timeout(RPC.timeoutMs),
    });
  } catch (e) {
    // never the URL: it carries the key
    return refuse(
      call.id,
      -32000,
      `The game's RPC did not answer (${e?.name === 'TimeoutError' ? 'timed out' : 'unreachable'}).`,
      502,
    );
  }
  const type = upstream.headers.get('content-type') ?? '';
  if (!upstream.ok && !type.includes('json')) {
    // games.fun's own refusal (an origin not in backend.json) or the RPC's: in words, never the URL with its key
    const said = (await upstream.text()).split(rpc).join(new URL(rpc).origin).slice(0, 300);
    return refuse(call.id, -32000, `The game's RPC call was refused (${upstream.status}): ${said}`, 502);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': type || 'application/json', 'cache-control': 'no-store' },
  });
}
