// Key-shaped strings: the one list of them. The publish scan (./publish/scan.mjs) reads every pattern here, and the
// kit imports SECRET_PATTERNS for its own scanner. Pure: no imports.
//
// Every run in a pattern has an upper bound, so no match is longer than MAX_MATCH characters: the scan reads a big
// file in pieces that overlap by more than that, and finds a key that straddles two pieces (tests/scan.test.mjs checks
// each pattern's longest match against it). The bounds are far past any real key's length (a JWT with a large payload,
// a long secret pasted into code), so bounding a pattern never lets one through that an unbounded one caught.

/** The longest text any pattern here can match (the JWT's: 4,096 + 16,384 + 2,048 and its marks). */
export const MAX_MATCH = 32 * 1024;

/**
 * [kind, pattern]. Each kind is the words a refusal names it by. The last, 'JSON web token', is any JWT: the publish
 * scan reads a JWT's role instead (a Supabase anon key is public by design), and the kit replaces it the same way.
 */
export const SECRET_PATTERNS = [
  ['private key block', /-----BEGIN (?:[A-Z]{1,20} )?PRIVATE KEY-----/],
  // not inside a word or a class name (style-sk-aria-pressed): a key stands on its own
  [
    'OpenAI or Anthropic key',
    /(?<![A-Za-z0-9_-])sk-(?:(?:proj|ant|svcacct|admin)-[A-Za-z0-9_-]{20,500}|[A-Za-z0-9]{32,500})/,
  ],
  ['Meshy key', /\bmsy_[A-Za-z0-9_-]{16,500}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,500}|github_pat_[A-Za-z0-9_]{30,500})/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,500}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe secret key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,500}/],
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{16,500}/],
  ['Supabase access token', /\bsbp_[A-Za-z0-9]{20,500}/],
  ['database address with a password', /\bpostgres(?:ql)?:\/\/[^\s:@/'"]{1,200}:[^\s@/'"]{1,200}@/i],
  ['xgames.fun publish token', /\bgfk_[A-Za-z0-9_-]{30,500}/],
  // providers whose keys have a shape of their own (each prefix, length and alphabet as the provider issues them)
  ['Hugging Face token', /\bhf_[A-Za-z0-9]{34,500}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['GitLab token', /\bglpat-[A-Za-z0-9_-]{20,500}/],
  ['SendGrid key', /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/],
  ['Stripe webhook secret', /\bwhsec_[A-Za-z0-9]{32,500}/],
  ['Shopify token', /\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}\b/],
  ['Google OAuth client secret', /\bGOCSPX-[A-Za-z0-9_-]{28}\b/],
  ['DigitalOcean token', /\bdo[opr]_v1_[a-f0-9]{64}\b/],
  ['Telegram bot token', /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/],
  // a game's page never holds an RPC URL (it calls its own /loot/v1/rpc): one with a key in it is that key
  [
    'an RPC URL with its key (helius, alchemy, quicknode, infura)',
    /https?:\/\/[^\s"'`]{0,1000}(?:helius-rpc\.com[^\s"'`]{0,300}[?&]api-key=[A-Za-z0-9-]{16,200}|\.alchemy\.com\/v2\/[A-Za-z0-9_-]{20,200}|\.quiknode\.pro\/[A-Za-z0-9]{20,200}|\.infura\.io\/v3\/[a-f0-9]{32})/,
  ],
  [
    'a Solana keypair in code (fromSecretKey)',
    /\bfromSecretKey\s{0,20}\(\s{0,20}(?:(?:new\s{1,20}Uint8Array|Uint8Array\.from|bs58\.decode)\s{0,20}\(\s{0,20})?[["'`]/,
  ],
  [
    'secret assigned a literal',
    // not the first branch of a ternary (cond ? 'MySecretsText' : 'OtherText'); the value is its first group
    /(?<!\?\s*["']?)\b[A-Za-z0-9_]{0,100}(?:SECRET|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_TOKEN|SERVICE_ROLE|PASSWORD)[A-Za-z0-9_]{0,100}["']?\s{0,20}[:=]\s{0,20}["']([A-Za-z0-9+/_=.-]{16,16384})["']/i,
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
  // header, payload (16K: a token with many claims), signature (an RS512 one with a 8192-bit key is 1,366)
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{10,4096}\.eyJ[A-Za-z0-9_-]{10,16384}\.[A-Za-z0-9_-]{16,2048}/],
];
