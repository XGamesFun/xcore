// Key-shaped strings: the one list of them. The publish scan (./publish/scan.mjs) reads every pattern here, and the
// kit imports SECRET_PATTERNS for its own scanner. Pure: no imports.
//
// Every pattern runs in time linear in the file, as xgames.fun's own scan does: every run has an upper bound, nothing
// optional repeats inside a repeat, a look-behind reads a few characters at most, and a pattern that starts inside a run
// of the characters it then reads (a JWT, an RPC URL's host) starts only where that run begins, so a long run is read once
// rather than once for each place it could start (tests/scan.test.mjs times each on 4 MiB of text written to hold it
// up). No match is longer than MAX_MATCH characters, so the scan reads a big file in pieces that overlap by more than
// that, and finds a key that straddles two pieces (tests/scan.test.mjs checks each pattern's longest match against it).
// Each pattern xgames.fun's own scan has is here as it is there, with the same bounds, so the kit refuses what the
// host refuses, and nothing the host would publish (tests/scan.test.mjs holds the *_SECRET literal's bounds to it).
// Three are the kit's own, for the key formats it writes itself (a signing key's seed, a {pub, seed} key file, secret
// key bytes in code): the host does not read those, and a publish that carries one is refused here first.

/** The longest text any pattern here can match (the JWT's: 8,192 + 16,384 + 8,192 and its marks). */
export const MAX_MATCH = 40 * 1024;

/**
 * [kind, pattern]. Each kind is the words a refusal names it by. The last, 'JSON web token', is any JWT: the publish
 * scan reads a JWT's role instead (a Supabase anon key is public by design), and the kit replaces it the same way.
 */
export const SECRET_PATTERNS = [
  ['private key block', /-----BEGIN (?:[A-Z]{1,32} )?PRIVATE KEY-----/],
  // not inside a word or a class name (style-sk-aria-pressed): a key stands on its own
  [
    'OpenAI or Anthropic key',
    /(?<![A-Za-z0-9_-])sk-(?:(?:proj|ant|svcacct|admin)-[A-Za-z0-9_-]{20,256}|[A-Za-z0-9]{32,256})/,
  ],
  ['Meshy key', /\bmsy_[A-Za-z0-9_-]{16,256}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,256}|github_pat_[A-Za-z0-9_]{30,256})/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,256}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe secret key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,256}/],
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{16,256}/],
  ['Supabase access token', /\bsbp_[A-Za-z0-9]{20,256}/],
  ['database address with a password', /\bpostgres(?:ql)?:\/\/[^\s:@/'"]{1,256}:[^\s@/'"]{1,256}@/i],
  ['xgames.fun publish token', /\bgfk_[A-Za-z0-9_-]{30,256}/],
  // providers whose keys have a shape of their own (each prefix, length and alphabet as the provider issues them)
  ['Hugging Face token', /\bhf_[A-Za-z0-9]{34,256}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['GitLab token', /\bglpat-[A-Za-z0-9_-]{20,256}/],
  ['SendGrid key', /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/],
  ['Stripe webhook secret', /\bwhsec_[A-Za-z0-9]{32,256}/],
  ['Shopify token', /\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}\b/],
  ['Google OAuth client secret', /\bGOCSPX-[A-Za-z0-9_-]{28}\b/],
  ['DigitalOcean token', /\bdo[opr]_v1_[a-f0-9]{64}\b/],
  ['Telegram bot token', /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/],
  // a game's page never holds an RPC URL (it calls its own /loot/v1/rpc): one with a key in it is that key. The host is
  // read only from where it starts (right after the scheme) and up to a DNS name's 253 characters; helius's key is in
  // the query, at most 512 characters along
  [
    'an RPC URL with its key (helius, alchemy, quicknode, infura)',
    /https?:\/\/[A-Za-z0-9.-]{0,253}(?:helius-rpc\.com[^\s"'`]{0,512}?[?&]api-key=[A-Za-z0-9-]{16,256}|\.alchemy\.com\/v2\/[A-Za-z0-9_-]{20,256}|\.quiknode\.pro\/[A-Za-z0-9]{20,256}|\.infura\.io\/v3\/[a-f0-9]{32})/,
  ],
  [
    'a Solana keypair in code (fromSecretKey)',
    /\bfromSecretKey\s{0,16}\(\s{0,16}(?:(?:new\s{1,16}Uint8Array|Uint8Array\.from|bs58\.decode)\s{0,16}\(\s{0,16})?[["'`]/,
  ],
  [
    'secret assigned a literal',
    // not the first branch of a ternary (cond ? 'MySecretsText' : 'OtherText'), the spaces looked back over up to 16
    // (unbounded, the look-behind read every space before every place in a file of spaces); the value is its first group
    /(?<!\?\s{0,16}["']?)\b[A-Za-z0-9_]{0,64}(?:SECRET|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_TOKEN|SERVICE_ROLE|PASSWORD)[A-Za-z0-9_]{0,64}["']?\s{0,16}[:=]\s{0,16}["']([A-Za-z0-9+/_=.-]{16,1024})["']/i,
  ],
  // a signing key's 32-byte seed in hex, by its name (VOUCHER_SEED=…, voucherSeed: '…'): xcore add vouchers' format
  [
    'signing key seed (hex)',
    /\b[A-Za-z0-9_]{0,100}(?:VOUCHER|WALLET|SIGNER|SIGNING|KEY)_?SEED[A-Za-z0-9_]{0,100}["']?\s{0,20}[:=]\s{0,20}["'`]?[0-9a-fA-F]{64}(?![0-9a-fA-F])/i,
  ],
  // a key file as a script writes one: {"pub": "<address>", "seed": "<64 hex>"} (either order)
  [
    'key file (pub and seed)',
    /["']seed["']\s{0,20}:\s{0,20}["'][0-9a-fA-F]{64}["'][\s\S]{0,200}?["']pub(?:lic)?(?:Key)?["']\s{0,20}:|["']pub(?:lic)?(?:Key)?["']\s{0,20}:\s{0,20}["'][1-9A-HJ-NP-Za-km-z]{32,44}["'][\s\S]{0,200}?["']seed["']\s{0,20}:\s{0,20}["'][0-9a-fA-F]{64}["']/,
  ],
  // a 64-byte secret key written into code by its name (const SECRET_KEY = [12, 200, …] or new Uint8Array([…]))
  [
    'secret key bytes in code',
    /\b[A-Za-z0-9_]{0,100}(?:SECRET|PRIVATE|KEYPAIR|SEED)[A-Za-z0-9_]{0,100}["']?\s{0,20}[:=]\s{0,20}(?:new\s{1,20}Uint8Array\(\s{0,20})?\[\s{0,20}(?:\d{1,3}\s{0,20},\s{0,20}){31,63}\d{1,3}\s{0,20}\]/i,
  ],
  // never touching + / = : those break up base64 data (an inlined picture), where a run of base58 letters is chance
  ['Solana secret key (base58)', /(?<![A-Za-z0-9+/])[1-9A-HJ-NP-Za-km-z]{86,90}(?![A-Za-z0-9+/=])/],
  // header, payload (16K: a token with many claims), signature (an RS512 one with a 8192-bit key is 1,366); it starts
  // where its run of base64url letters starts, never at an "eyJ" inside one
  ['JSON web token', /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,8192}\.eyJ[A-Za-z0-9_-]{10,16384}\.[A-Za-z0-9_-]{16,8192}/],
];
