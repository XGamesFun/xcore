// The economy's own review: @xgamesfun/solana's `xsolana review --json`, run on the economy file, and the environment
// (the RPC) the kit's tools run in for the review.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { solanaCommand, solanaHas, solanaRoot } from '../economy.mjs';
import { economyCluster, solanaRpc } from '../solana-rpc.mjs';
import { readJson } from '../util.mjs';

/** What the installed @xgamesfun/solana is: {version, root} or null. */
export function solanaPackage(env) {
  const root = solanaRoot(env);
  if (!root) return null;
  return { root, version: readJson(path.join(root, 'package.json'))?.version ?? null };
}

export const NO_REVIEW =
  'the economy review needs @xgamesfun/solana with `review` (xsolana review): update @xgamesfun/xcore once it is released, or set GAMESFUN_SOLANA to the folder of a copy of @xgamesfun/solana that has it';

/**
 * @xgamesfun/solana's review of the economy file: `xsolana review <file> --json`, run in the file's folder.
 * → {available: true, version, ok, routes, findings, tradeoffs} or {available: false, version, why}
 */
export function economyReview(file, { env = process.env } = {}) {
  const pkg = solanaPackage(env);
  const xsolana = solanaCommand(env);
  if (!pkg || !xsolana)
    return { available: false, version: null, why: 'the economy tools (@xgamesfun/solana) are not installed here' };
  if (!solanaHas('review', env)) return { available: false, version: pkg.version, why: NO_REVIEW };
  const r = spawnSync(xsolana[0], [xsolana[1], 'review', path.basename(file), '--json'], {
    cwd: path.dirname(file),
    encoding: 'utf8',
    timeout: 120_000,
    // (the RPC on the economy's own cluster; on mainnet the shared relay answers published games' players only, so with
    // no RPC of the person's own the review is left to the tools' default)
    env: reviewEnv(env, economyCluster(path.dirname(file))),
  });
  const said = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  if (/no command\W+review/i.test(said)) return { available: false, version: pkg.version, why: NO_REVIEW };
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {}
  if (!json || typeof json !== 'object')
    return {
      available: false,
      version: pkg.version,
      why: `xsolana review gave no JSON (${said.trim().split('\n')[0] || `exit code ${r.status}`})`,
    };
  // the spec refused (the economy check stops it going live): each refusal a high finding, in its own words
  if (!Array.isArray(json.findings) && Array.isArray(json.refusals) && json.refusals.length)
    return {
      available: true,
      version: pkg.version,
      ok: false,
      refused: true,
      routes: [],
      findings: json.refusals.map(x => ({
        id: String(x.code ?? 'refused'),
        severity: 'high',
        route: x.where ?? null,
        message: String(x.message ?? x.why ?? 'the economy check refuses this spec'),
        fix: x.fix
          ? String(x.fix)
          : `The economy check refuses the spec, so it can't go live as it is: fix it (xcore loot check ${path.basename(file)}), then run review again.`,
      })),
      tradeoffs: '',
    };
  if (!Array.isArray(json.findings))
    return {
      available: false,
      version: pkg.version,
      why: `xsolana review could not read the economy: ${json.error ?? json.message ?? JSON.stringify(json).slice(0, 200)}`,
    };
  return {
    available: true,
    version: pkg.version,
    ok: json.ok !== false,
    routes: Array.isArray(json.routes) ? json.routes : [],
    findings: json.findings,
    tradeoffs: typeof json.tradeoffs === 'string' ? json.tradeoffs : '',
  };
}

/** The environment a review runs in: XSOLANA_RPC_URL the person's own, else the shared relay on devnet, else unset. */
export function reviewEnv(env, cluster) {
  const own = env.XSOLANA_RPC_URL?.trim();
  if (own) return { ...env, XSOLANA_RPC_URL: own };
  const rpc = solanaRpc(env, { cluster });
  if (rpc.shared && cluster === 'mainnet') {
    const { XSOLANA_RPC_URL: _unset, ...rest } = env;
    return rest;
  }
  return { ...env, XSOLANA_RPC_URL: rpc.url };
}
