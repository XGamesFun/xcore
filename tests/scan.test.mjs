// The publish scan (lib/publish/scan.mjs): every kind of key it promises to refuse is refused, the keys made to be
// public pass, and ordinary game data is not mistaken for a key. Every fake key is assembled at run time, so this file
// holds nothing a secret scanner (GitHub's push protection, xgames.fun's own) would stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as scan from '../lib/publish/scan.mjs';
import { MAX_MATCH, SECRET_PATTERNS as ALL_PATTERNS } from '../lib/secret-patterns.mjs';

// a namespace, so this file also runs (and fails, rather than not load) on a scan without the newer exports
const {
  scanFile,
  secretsMessage,
  isPublicKey,
  SECRET_PATTERNS,
  SCAN_OVERLAP,
  SCAN_CHUNK,
  backendOrigin,
  backendOrigins,
} = scan;
const refusedType = scan.refusedType ?? (() => null);

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

test('a long key is still a key: a service-role JWT with a big payload', () => {
  /** A token whose payload is `n` characters of base64url: its claims padded to that length. */
  const sized = (claims, n) => {
    let pad = '';
    while (b64url({ ...claims, pad }).length < n) pad += 'x';
    return jwt({ ...claims, pad });
  };
  for (const n of [1132, 1500, 4000, 10_000, 16_000]) {
    const token = sized({ iss: 'supabase', role: 'service_role' }, n);
    assert.ok(token.split('.')[1].length >= n);
    assert.match(kinds('admin.js', `const key = "${token}";`).join(), /service-role/, `payload ${n}`);
    // and across the line between two pieces of a big file
    const text = `${'let a = 1;\n'.repeat(9000)}const key = "${token}";\n${'let b = 2;\n'.repeat(9000)}`;
    const at = text.indexOf(token) + 37;
    for (const chunk of [at, at + Math.floor(n / 2)])
      assert.match(
        scanFile('big.js', bytes(text), { chunk, overlap: MAX_MATCH })
          .map(h => h.kind)
          .join(),
        /service-role/,
        `payload ${n}, cut at ${chunk}`,
      );
  }
});

// A *_SECRET literal is read as xgames.fun reads it: names up to 64 characters on either side of the word, up to 16
// spaces around the = or :, and a value of 16 to 1,024 characters. What the host would publish, the kit does not refuse.
test("a secret assigned a literal: the host's bounds, no wider and no narrower", () => {
  const val = n =>
    alnum(32)
      .repeat(Math.ceil(n / 32))
      .slice(0, n);
  const literal = text => kinds('config.js', text).includes('secret assigned a literal');
  for (const n of [16, 200, 1024]) assert.ok(literal(`const GAME_SECRET = "${val(n)}";`), `value ${n}`);
  for (const n of [1025, 1132, 16_000])
    assert.ok(!literal(`x_SECRET='${val(n)}'`), `value ${n}: the host publishes it`);
  assert.ok(literal(`${'a'.repeat(63)}_SECRET = "${val(20)}"`));
  assert.ok(!literal(`${'a'.repeat(65)}SECRET = "${val(20)}"`), 'a name of 65 characters before the word');
  assert.ok(literal(`MY_SECRET${' '.repeat(16)}=${' '.repeat(16)}"${val(20)}"`));
  assert.ok(!literal(`MY_SECRET${' '.repeat(17)}= "${val(20)}"`), '17 spaces');
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

/**
 * The longest text a regular expression can match, from its source: Infinity when a run has no upper bound. Knows the
 * syntax the secret patterns use (classes, groups, alternatives, look-arounds, quantifiers).
 */
function longestMatch(source) {
  let i = 0;
  const alternatives = () => {
    let best = 0,
      now = 0;
    for (;;) {
      if (i >= source.length || source[i] === ')') return Math.max(best, now);
      if (source[i] === '|') {
        best = Math.max(best, now);
        now = 0;
        i++;
        continue;
      }
      now += quantified(atom());
    }
  };
  const atom = () => {
    const c = source[i++];
    if (c === '\\') return /[bB]/.test(source[i++]) ? 0 : 1;
    if (c === '^' || c === '$') return 0;
    if (c === '[') {
      if (source[i] === '^') i++;
      if (source[i] === ']') i++;
      while (source[i] !== ']') i += source[i] === '\\' ? 2 : 1;
      i++;
      return 1;
    }
    if (c === '(') {
      let zero = false;
      if (source[i] === '?') {
        const look = /^\?(?:<?[=!])/.exec(source.slice(i));
        zero = !!look;
        i += look ? look[0].length : source[i + 1] === ':' ? 2 : source.indexOf('>', i) - i + 1;
      }
      const n = alternatives();
      i++; // )
      return zero ? 0 : n;
    }
    return 1;
  };
  const quantified = n => {
    const q = /^(?:\?|\*|\+|\{(\d+)(,(\d*))?\})\??/.exec(source.slice(i));
    if (!q) return n;
    i += q[0].length;
    if (q[0][0] === '?') return n;
    if (q[0][0] === '*' || q[0][0] === '+') return n ? Infinity : 0;
    const most = q[2] === undefined ? Number(q[1]) : q[3] === '' ? Infinity : Number(q[3]);
    return n * most;
  };
  return alternatives();
}

test('one list of patterns: the publish scan runs every pattern lib/secret-patterns.mjs has, as it is there', () => {
  const kept = ALL_PATTERNS.filter(([kind]) => kind !== 'JSON web token');
  assert.deepEqual(
    SECRET_PATTERNS.map(([kind, re]) => [kind, re.source]),
    kept.map(([kind, re]) => [kind, re.source]),
  );
  assert.ok(
    ALL_PATTERNS.some(([kind]) => kind === 'JSON web token'),
    'the JWT shape the kit replaces by name',
  );
});

test("no pattern can match more than MAX_MATCH characters, and a piece of a big file reaches past the next one's start by more", () => {
  assert.equal(longestMatch('ab{2,3}(?:c|de)?(?<!x)\\b[a-z]{4}'), 1 + 3 + 2 + 4);
  assert.equal(longestMatch('a+'), Infinity);
  for (const [kind, re] of ALL_PATTERNS) {
    const n = longestMatch(re.source);
    assert.ok(n <= MAX_MATCH, `${kind}: up to ${n} characters`);
  }
  assert.ok(SCAN_OVERLAP >= MAX_MATCH);
});

test('a text file is scanned whole, however big: a key past the first 4 MiB, and one across two pieces', () => {
  const key = 'sk-' + 'proj-' + alnum(40);
  const filler = 'let a = 1;\n'.repeat(Math.ceil((9 * 1048576) / 11)); // 9 MiB of ordinary code
  const late = `${filler}const k = "${key}";\n`;
  assert.deepEqual(scanFile('engine.js', bytes(late)), [
    { path: 'engine.js', line: filler.split('\n').length, kind: 'OpenAI or Anthropic key' },
  ]);
  // a key cut by every line between two pieces, small pieces so there are many
  const chunk = 70_000;
  const lines = 'x\n'.repeat(chunk / 2 - 3);
  for (const shift of [0, 1, 7, 20, 40, 44, 45, 60, 505, 509, 510, 511, 515]) {
    const text = `${lines.slice(0, lines.length - shift * 2)}${'.'.repeat(shift % 2)}"${key}"\n${'y = 2;\n'.repeat(30_000)}`;
    const hits = scanFile('big.js', bytes(text), { chunk, overlap: 1024 });
    const at = text.slice(0, text.indexOf(key)).split('\n').length;
    assert.deepEqual(hits, [{ path: 'big.js', line: at, kind: 'OpenAI or Anthropic key' }], `shifted ${shift}`);
  }
  // the default pieces too: a key across the 4 MiB line
  const edge = 'z'.repeat(4 * 1048576 - 20) + ` "${key}" ` + 'q'.repeat(100);
  assert.equal(scanFile('edge.js', bytes(edge)).length, 1);
  // a multi-byte character cut between two pieces is read whole, and the line count stays right
  const wide = `${'é\n'.repeat(chunk)}"${key}"`;
  assert.deepEqual(
    scanFile('wide.js', bytes(wide), { chunk: chunk + 1, overlap: 1024 }).map(h => h.line),
    [chunk + 1],
  );
});

test('a run of base58 letters cut by the end of a piece is not taken for a key: the next piece sees it go on', () => {
  // base64 data whose letters, from a "/" on, are base58 for longer than a key: one key-length run ends at the cut
  const run = alnum(32).replace(/0/g, '1').repeat(5); // 160 base58 letters, no + / = in them
  const data = `"data:image/png;base64,${'A'.repeat(5000)}/${run}"`;
  const chunk = 5000 + 23 + 1 + 87; // the piece ends 87 letters into the run
  assert.deepEqual(kinds('art.js', data), []);
  assert.deepEqual(
    scanFile('art.js', bytes(data), { chunk, overlap: 1024 }).map(h => h.kind),
    [],
  );
});

// ---- Time: every pattern runs in time linear in the file, as xgames.fun's scan does -----------------------------------

const SCAN = fileURLToPath(new URL('../lib/publish/scan.mjs', import.meta.url));
// Text written to hold a scanner up: a long run of what a pattern reads, its start repeated inside it.
const HOSTILE = {
  rpc: "n => repeat('http://helius-rpc.com', n)",
  alchemy: "n => repeat('https://a.alchemy.com/v2/', n)",
  secret: "n => repeat('SECRET', n)",
  names: "n => repeat('a_SECRET = \"', n)",
  spaces: "n => ' '.repeat(n)",
  newlines: "n => '\\n'.repeat(n)",
  ternary: "n => '?' + ' '.repeat(n - 1)",
  jwt: "n => repeat('eyJ-', n)",
  keypair: "n => 'fromSecretKey(' + ' '.repeat(n - 14)",
  seed: "n => repeat('wallet_seed: \"', n)",
  bytes: "n => repeat('SECRET = [1, ', n)",
  keyfile: 'n => repeat(\'"seed": "\', n)',
  database: "n => repeat('postgres://a', n)",
};
/** scanFile on each hostile text at each size, in a child process stopped after `limit` ms. → {which: [ms]} or null */
function hostileTimes(sizes, limit) {
  const script = `const {scanFile} = await import(${JSON.stringify(pathToFileURL(SCAN).href)});
    const repeat = (s, n) => s.repeat(Math.ceil(n / s.length)).slice(0, n);
    const HOSTILE = {${Object.entries(HOSTILE)
      .map(([k, f]) => `${k}: ${f}`)
      .join(',')}};
    const out = {};
    for (const [k, f] of Object.entries(HOSTILE)) out[k] = ${JSON.stringify(sizes)}.map(n => {
      const b = new TextEncoder().encode(f(n)); let best = Infinity;
      for (let i = 0; i < 2; i++) { const t = performance.now(); scanFile('notes.js', b); best = Math.min(best, performance.now() - t); }
      return best; });
    console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { timeout: limit, encoding: 'utf8' });
  return r.status === 0 ? JSON.parse(r.stdout) : null;
}

test('scan time: every pattern is linear; 4 MiB of any hostile text scans in a few seconds at most', () => {
  const sizes = [SCAN_CHUNK / 16, SCAN_CHUNK / 4, SCAN_CHUNK];
  const times = hostileTimes(sizes, 120_000);
  assert.ok(times, `scanFile on ${sizes.at(-1)} bytes of hostile text did not finish in two minutes`);
  for (const [which, ms] of Object.entries(times)) {
    assert.ok(ms[2] < 5_000, `${which}: 4 MiB took ${ms[2].toFixed(0)} ms`);
    // linear: 4x the text is about 4x the time (allowing for noise on small times)
    assert.ok(
      ms[2] <= Math.max(ms[1], 5) * 8 && ms[1] <= Math.max(ms[0], 5) * 8,
      `${which}: ${ms.map(t => t.toFixed(1)).join(' → ')} ms for 4x, 16x the text`,
    );
  }
});

test('the bounded patterns still find every key xgames.fun refuses', () => {
  const hx = n => '0123456789abcdef'.repeat(8).slice(0, n);
  const found = text => kinds('game.js', text);
  assert.ok(found(`rpc = "https://mainnet.helius-rpc.com/?api-key=${hx(32)}"`).some(k => /RPC URL/.test(k)));
  assert.ok(
    found(`rpc = "https://rpc.helius-rpc.com/v0/x?cluster=devnet&api-key=${hx(36)}"`).some(k => /RPC URL/.test(k)),
  );
  assert.ok(found(`u = 'https://solana-mainnet.g.alchemy.com/v2/${hx(32)}'`).some(k => /RPC URL/.test(k)));
  assert.ok(found(`const MY_SERVICE_SECRET = "${hx(40)}";`).includes('secret assigned a literal'));
  assert.ok(found(`{"api_key":   "${hx(24)}"}`).includes('secret assigned a literal'));
  assert.ok(found(`const GAME_SECRET =                "${hx(24)}";`).includes('secret assigned a literal'));
  assert.ok(!found(`x = ok ? 'MySecretsTextHere' : 'other';`).includes('secret assigned a literal'));
  assert.ok(
    found(`Keypair.fromSecretKey(  new Uint8Array( [1,2])`).includes('a Solana keypair in code (fromSecretKey)'),
  );
  // a private key block whose type is a long word, as xgames.fun reads it
  assert.ok(found('-----BEGIN ' + 'ENCRYPTEDPRIVATEKEYMATERIALX ' + 'PRIVATE KEY-----').includes('private key block'));
  // a token with a long header and signature: xgames.fun reads each up to 8,192 characters
  const long = `${b64url({ alg: 'RS512', typ: 'JWT', x5c: alnum(32).repeat(150) })}.${b64url({ role: 'service_role' })}.${alnum(32).repeat(150)}`;
  assert.match(found(`const t = "${long}";`).join(), /service-role/);
  // a run of base64url letters that only has "eyJ" inside it is not a token
  assert.deepEqual(found(`x = "${'eyJ-'.repeat(5000)}";`), []);
});

test('programs, installers and archives other than .zip are refused by their type, as xgames.fun refuses them', () => {
  for (const name of [
    'setup.exe',
    'bin/Game.DLL',
    'tools/run.bat',
    'game.apk',
    'mac/Game.dmg',
    'linux/game.AppImage',
    'server.jar',
    'saves.7z',
    'levels.rar',
    'build.tar.gz',
    'build.tgz',
    'pack.tar',
    'disc.iso',
  ])
    assert.match(refusedType(name) ?? '', /a program or an installer|an archive/, name);
  for (const name of [
    'levels.zip',
    'Build/game.data.gz',
    'Build/game.wasm.br',
    'index.html',
    'game.pck',
    'readme.txt',
    'exe.js',
    'notes.tar.md',
  ])
    assert.equal(refusedType(name), null, name);
});

test("a backend origin whose host the page's security policy cannot name is refused, as xgames.fun refuses it", () => {
  assert.equal(backendOrigin('https://abcd.supabase.co'), 'https://abcd.supabase.co');
  assert.throws(() => backendOrigin('https://my_api.example.net'), /content-security policy cannot name/);
  assert.deepEqual(backendOrigins({ origins: ['https://my_api.example.net'] }).origins, []);
});
