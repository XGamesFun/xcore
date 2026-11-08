// Key-shaped strings: the general secret scanner, which the kit imports and extends with Supabase's own shapes.
// ./publish/scan.mjs keeps its own superset for the publish scan. Pure: no imports.
export const SECRET_PATTERNS = [
  ['private key block', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  [
    'OpenAI or Anthropic key',
    /(?<![A-Za-z0-9_-])sk-(?:(?:proj|ant|svcacct|admin)-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{32,})/,
  ],
  ['Meshy key', /\bmsy_[A-Za-z0-9_-]{16,}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/],
  ['Hugging Face token', /\bhf_[A-Za-z0-9]{34,}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}/],
  ['SendGrid key', /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/],
  ['Stripe webhook secret', /\bwhsec_[A-Za-z0-9]{32,}/],
  ['Shopify token', /\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}\b/],
  ['Google OAuth client secret', /\bGOCSPX-[A-Za-z0-9_-]{28}\b/],
  ['DigitalOcean token', /\bdo[opr]_v1_[a-f0-9]{64}\b/],
  ['Telegram bot token', /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/],
  [
    'an RPC URL with its key',
    /https?:\/\/[^\s"'`]*(?:helius-rpc\.com[^\s"'`]*[?&]api-key=[A-Za-z0-9-]{16,}|\.alchemy\.com\/v2\/[A-Za-z0-9_-]{20,}|\.quiknode\.pro\/[A-Za-z0-9]{20,}|\.infura\.io\/v3\/[a-f0-9]{32})/,
  ],
  [
    'a Solana keypair in code (fromSecretKey)',
    /\bfromSecretKey\s*\(\s*(?:(?:new\s+Uint8Array|Uint8Array\.from|bs58\.decode)\s*\(\s*)?[["'`]/,
  ],
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}/],
  [
    'secret assigned a literal',
    /(?<!\?\s*["']?)\b[A-Za-z0-9_]*(?:SECRET|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_TOKEN|SERVICE_ROLE|PASSWORD)[A-Za-z0-9_]*["']?\s*[:=]\s*["'][A-Za-z0-9+/_=.-]{16,}["']/i,
  ],
  // never touching + / = : those break up base64 data (an inlined picture), where a run of base58 letters is chance
  ['Solana secret key (base58)', /(?<![A-Za-z0-9+/])[1-9A-HJ-NP-Za-km-z]{86,90}(?![A-Za-z0-9+/=])/],
];
