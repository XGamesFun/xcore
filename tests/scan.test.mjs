// The publish scan (lib/publish/scan.mjs): every kind of key it promises to refuse is refused, the keys made to be
// public pass, and ordinary game data is not mistaken for a key. Every fake key is assembled at run time, so this file
// holds nothing a secret scanner (GitHub's push protection, xgames.fun's own) would stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanFile, secretsMessage, isPublicKey } from '../lib/publish/scan.mjs';

const bytes = text => new TextEncoder().encode(text);
const kinds = (path, text) => scanFile(path, typeof text === 'string' ? bytes(text) : text).map(h => h.kind);

/** A deterministic stream of bytes (xorshift32), so a failure can be run again exactly. */
function pseudoRandom(n, seed = 0x9e3779b9) {
  const out = new Uint8Array(n);
  let x = seed >>> 0;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(buf) {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex')),
    s = '';
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of buf) {
    if (b) break;
    s = '1' + s;
  }
  return s;
}
const b64url = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = payload => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.${'s'.repeat(43)}`;
const alnum = n => 'aB3dE5gH7jK9mN2pQ4sT6vW8yZ0cF1hL'.repeat(4).slice(0, n);

test('every kind of key the scan promises to refuse is refused', () => {
  const cases = [
    ['private key block', '-----BEGIN ' + 'PRIVATE KEY-----\nMIIE…'],
    ['private key block', '-----BEGIN RSA ' + 'PRIVATE KEY-----'],
    ['OpenAI or Anthropic key', `const k = "${'sk-' + 'proj-' + alnum(40)}";`],
    ['OpenAI or Anthropic key', `key: '${'sk-' + 'ant-api03-' + alnum(40)}'`],
    ['OpenAI or Anthropic key', `"${'sk-' + alnum(48)}"`],
    ['AWS access key', `${'AKIA' + 'ABCDEFGHIJKLMNOP'}`],
    ['GitHub token', `${'ghp_' + alnum(36)}`],
    ['GitHub token', `${'github_pat_' + alnum(40)}`],
    ['Slack token', `${'xoxb-' + '1234567890-abcdefghij'}`],
    ['Google API key', `${'AIza' + alnum(35)}`],
    ['Stripe secret key', `${'sk_' + 'live_' + alnum(24)}`],
    ['Stripe secret key', `${'rk_' + 'test_' + alnum(24)}`],
    ['Supabase secret key', `${'sb_' + 'secret_' + alnum(24)}`],
    ['database address with a password', `const db = "${'postgres://' + 'app:hunter2pass@db.example.net:5432/x'}";`],
    ['xgames.fun publish token', `${'gfk_' + alnum(40)}`],
    ['secret assigned a literal', `const CLIENT_SECRET = "${alnum(24)}";`],
    ['secret assigned a literal', `{"apiKey": "${alnum(32)}"}`],
  ];
  for (const [kind, text] of cases) assert.ok(kinds('game.js', text).includes(kind), `${kind}: ${text.slice(0, 40)}…`);
});

test("keys with a provider's own shape are refused (each made here, at run time)", () => {
  const hex = n => '0123456789abcdef'.repeat(8).slice(0, n);
  const cases = [
    ['Hugging Face token', `t = "${'hf_' + alnum(34)}"`],
    ['npm token', `t = "${'npm_' + alnum(36)}"`],
    ['GitLab token', `t = "${'glpat-' + alnum(20)}"`],
    ['SendGrid key', `t = "${'SG.' + alnum(22) + '.' + alnum(43)}"`],
    ['Stripe webhook secret', `t = "${'whsec_' + alnum(32)}"`],
    ['Shopify token', `t = "${'shpat_' + hex(32)}"`],
    ['Google OAuth client secret', `t = "${'GOCSPX-' + alnum(28)}"`],
    ['DigitalOcean token', `t = "${'dop_v1_' + hex(64)}"`],
    ['Telegram bot token', `t = "${'1234567890:AA' + alnum(33)}"`],
    [
      'an RPC URL with its key (helius, alchemy, quicknode, infura)',
      `rpc = "https://mainnet.helius-rpc.com/?api-key=${hex(32)}"`,
    ],
    [
      'an RPC URL with its key (helius, alchemy, quicknode, infura)',
      `rpc = "https://solana-mainnet.g.alchemy.com/v2/${alnum(32)}"`,
    ],
    [
      'a Solana keypair in code (fromSecretKey)',
      `Keypair.fromSecretKey(Uint8Array.from([${Array.from({ length: 64 }, (_, i) => i).join(',')}]))`,
    ],
  ];
  for (const [kind, text] of cases) assert.ok(kinds('game.js', text).includes(kind), `${kind}: ${text.slice(0, 40)}…`);
  // what games and libraries really carry stays allowed
  for (const text of [
    'static fromSecretKey(secretKey, options) { return new Keypair(secretKey); }',
    'const rpc = "/loot/v1/rpc";',
    'fetch("https://api.devnet.solana.com", opts)',
    'const ratio = "1920:1080";',
  ])
    assert.deepEqual(kinds('lib.js', text), [], text);
});

test('a Solana secret key is refused however it is written, and a 64-byte keypair array too', () => {
  for (let i = 0; i < 50; i++) {
    const key = base58(pseudoRandom(64, 1000 + i));
    for (const text of [
      `const SECRET = "${key}";`,
      `PRIVATE_KEY=${key}\n`,
      `bs58.decode(\`${key}\`)`,
      `key ${key} here`,
    ])
      assert.ok(kinds('game.js', text).includes('Solana secret key (base58)'), text.slice(0, 30));
  }
  const keypair = JSON.stringify(Array.from(pseudoRandom(64, 7)));
  assert.ok(kinds('wallet.json', keypair).includes('a wallet keypair (64-byte array)'));
});

test("a transaction's signature (an economy's live record, in xsolana.json or a server that imports it) is not a key", () => {
  for (let i = 0; i < 10; i++) {
    const sig = base58(pseudoRandom(64, 2000 + i));
    for (const text of [
      `{"transactions": [{"signature": "${sig}"}]}`,
      `{"transactions":[{"signature":"${sig}"}]}`,
      `var live = { transactions: [{ signature: "${sig}" }] };`,
      `x={signature:'${sig}'}`,
    ])
      assert.ok(!kinds('xsolana.json', text).includes('Solana secret key (base58)'), text.slice(0, 40));
    // the same text under any other name is still refused
    for (const text of [`{"secretKey": "${sig}"}`, `{"signatures": "${sig}"}`, `const sig = "${sig}";`])
      assert.ok(kinds('game.js', text).includes('Solana secret key (base58)'), text.slice(0, 30));
  }
});

test('JWTs: a Supabase anon key passes, a service-role key and any other signed token are refused', () => {
  const anon = jwt({ iss: 'supabase', role: 'anon' });
  assert.ok(isPublicKey(anon));
  assert.deepEqual(kinds('supabase.js', `createClient(url, "${anon}")`), []);
  assert.deepEqual(kinds('supabase.js', `const SUPABASE_ANON_KEY = "${anon}";`), [], 'named like a secret, but public');
  assert.ok(isPublicKey('sb_publishable_' + alnum(24)));
  assert.match(kinds('admin.js', `"${jwt({ role: 'service_role' })}"`).join(), /service-role/);
  assert.match(kinds('x.js', `"${jwt({ role: 'authenticated' })}"`).join(), /role "authenticated"/);
});

test("a Firebase web config's apiKey passes; the same Google key shape anywhere else (Gemini) is refused", () => {
  const key = 'AIza' + 'Sy' + alnum(33);
  const config = `const firebaseConfig = {\n  apiKey: "${key}",\n  authDomain: "my-game.firebaseapp.com",\n  projectId: "my-game",\n  appId: "1:1234567890:web:abcdef123456"\n};`;
  assert.deepEqual(kinds('firebase.js', config), []);
  assert.deepEqual(kinds('bundle.js', `initializeApp({apiKey:"${key}",authDomain:"g.web.app",projectId:"g"})`), []);
  assert.deepEqual(kinds('ai.js', `const ai = new GoogleGenAI({ apiKey: "${key}" });`), [
    'Google API key',
    'secret assigned a literal',
  ]);
  // beside a Firebase config, but not its apiKey
  assert.deepEqual(
    kinds('both.js', `const GEMINI_KEY = "${key}";\ninitializeApp({apiKey:"x",authDomain:"g.firebaseapp.com"})`),
    ['Google API key'],
  );
});

test("a signing key's seed in hex is refused by its name; a hash or a level seed is not", () => {
  const h = 'c3'.repeat(32);
  for (const text of [`VOUCHER_SEED=${h}\n`, `const voucherSeed = '${h}';`, `{"walletSeed": "${h}"}`])
    assert.deepEqual(kinds('server/x.js', text), ['signing key seed (hex)'], text);
  for (const text of [`seed: "${h}"`, `const levelSeed = '${h}';`, `sha256: ${h}`])
    assert.deepEqual(kinds('data/x.json', text), [], text);
});

test('a {pub, seed} key file and secret key bytes written into code are refused; data that only looks alike is not', () => {
  const h = 'd4'.repeat(32),
    addr = '4KQMYSRB7QiBgEDcgNNoCtWCQREaEZpvZP59pVgQCFng';
  assert.deepEqual(kinds('keys/a.json', `{"pub":"${addr}","seed":"${h}"}`), ['key file (pub and seed)']);
  assert.deepEqual(kinds('keys/b.json', `{"seed": "${h}", "pub": "${addr}"}`), ['key file (pub and seed)']);
  const bytes64 = Array.from({ length: 64 }, (_, i) => (i * 37) % 256).join(', ');
  assert.deepEqual(kinds('src/k.js', `const secretKey = new Uint8Array([${bytes64}]);`), ['secret key bytes in code']);
  assert.deepEqual(kinds('src/k.js', `const WALLET_SEED = [${bytes64.split(', ').slice(0, 32).join(', ')}];`), [
    'secret key bytes in code',
  ]);
  assert.deepEqual(kinds('src/t.js', `const table = [${bytes64}];`), [], 'a lookup table is not a key');
  assert.deepEqual(kinds('data/d.json', `{"seed": "${h}", "level": 3}`), [], 'a level seed alone is not a key file');
});

test('files refused by their name alone', () => {
  for (const name of [
    '.env',
    'config/.env.production',
    'cert.pem',
    'tls.key',
    'id_rsa',
    'deploy.keypair.json',
    'service-account.json',
  ])
    assert.equal(scanFile(name, bytes('nothing secret')).length, 1, name);
});

test('game data is not mistaken for a key: inlined pictures, binary files, ordinary code', () => {
  // a bundler inlines pictures and sounds as base64; a run of base58 letters inside one is chance, not a key
  for (let i = 0; i < 40; i++) {
    const data = Buffer.from(pseudoRandom(256 * 1024, 50 + i)).toString('base64');
    assert.deepEqual(kinds('assets/index.js', `const s = "data:image/png;base64,${data}";`), [], `asset ${i}`);
  }
  // a key-shaped string inside a picture is not read (nobody ships a key in a PNG by accident)
  assert.deepEqual(kinds('sprite.png', bytes('sk-' + 'proj-' + alnum(40))), []);
  const code = 'export function update(dt) { player.x += player.vx * dt; if (player.x > 480) player.x = 0; }\n';
  assert.deepEqual(kinds('game.js', code.repeat(200)), []);
  assert.deepEqual(kinds('game.js', 'const PASSWORD_MIN_LENGTH = 8; const apiKeyLabel = "Your API key";'), []);
});

test('shapes found in real game builds that are not keys', () => {
  // a tile map row: base58 letters, but one of them 87 times
  assert.deepEqual(kinds('layouts/act_desert.json', `{"row": "${'E'.repeat(87)}"}`), []);
  // a CSS class in a bundle, which starts like an OpenAI key after a dash
  assert.deepEqual(kinds('assets.json', '{"id": "code.index.style-sk-aria-pressed-state-button-x"}'), []);
  // a ternary in a game's dialogue whose first text names a secret
  assert.deepEqual(kinds('mid.js', "say(up ? 'CopycatsHouse2FPCMySecretsText' : 'CopycatsHouse2FPCCantSeeText')"), []);
  // while the same name given a literal is still refused
  assert.deepEqual(kinds('x.js', `const MY_SECRET = "${alnum(24)}";`), ['secret assigned a literal']);
});

test('the refusal counts files, names each finding, and never repeats the value', () => {
  const key = 'sk-' + 'proj-' + alnum(40);
  const hits = scanFile('game.js', bytes(`const OPENAI_API_KEY = "${key}";`));
  assert.equal(hits.length, 2, 'two findings: the key shape, and a secret assigned a literal');
  const words = secretsMessage(hits);
  assert.match(words, /^Nothing was published: a file looks like it holds a secret: game\.js:1/);
  assert.ok(!words.includes(key), 'the key itself is never shown');
  assert.match(secretsMessage([...hits, { path: 'other.js', line: 3, kind: 'x' }]), /2 files look like/);
  assert.equal(secretsMessage([]), null);
});
