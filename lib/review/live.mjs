// Live (--live): the published game asked as a stranger, with no sign-in and a forged one; read-only.
import { CMD } from '../command.mjs';
import { finding } from './server.mjs';

/** A sign-in token in the shape the play host's are, signed by nobody. */
const FORGED = (() => {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${b64({ alg: 'EdDSA', typ: 'JWT' })}.${b64({ sub: 'review-forged', exp: 4102444800 })}.${'A'.repeat(86)}`;
})();
/** Routes that pay, sign or spend: asked with an empty body only, so even an open one has nothing to act on. */
const ACTS = /\/(pay|claim|sign|link|mint|buy|spend|withdraw|transfer|report|redeem|grant|voucher)s?(\/|$)/i;
/** Routes every game may answer anyone: the voucher key's address, whether it has its own RPC. */
const PUBLIC = new Set(['api/vouchers/key', 'api/rpc']);

/** One request: → {status, ok (the JSON's ok, or null), said (its why or error, short)} */
async function ask(fetchImpl, url, { method, auth, body, timeoutMs }) {
  try {
    const res = await fetchImpl(url, {
      method,
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        ...(auth ? { authorization: `Bearer ${FORGED}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    const said = json?.why ?? json?.error ?? json?.code ?? (json ? null : text.trim().slice(0, 80) || null);
    return {
      status: res.status,
      ok: json && typeof json === 'object' && 'ok' in json ? json.ok === true : null,
      said: said == null ? null : String(said).slice(0, 120),
    };
  } catch (e) {
    return { status: 0, ok: null, said: e.name === 'TimeoutError' ? 'no answer in time' : e.message };
  }
}

const accepted = a => a.status >= 200 && a.status < 300 && a.ok === true;

/**
 * The game at `base` (its play origin, or xcore dev's /game/), asked as a stranger. routes: [{path}]; keys: the voucher
 * keys the grants name; testKey: the test key's address; economyPath: the economy file's path in the page; localLive:
 * this folder's economy `live`. → {base, probes, key, economy, findings}
 */
export async function liveReview(
  base,
  {
    routes = [],
    keys = [],
    testKey = null,
    economyPath = null,
    localLive = null,
    vouchers = false,
    fetchImpl = fetch,
    timeoutMs = 10_000,
  } = {},
) {
  const root = base.endsWith('/') ? base : `${base}/`;
  const findings = [];
  const add = (...a) => findings.push(finding('live', ...a));
  const probes = [];
  for (const { path: p } of routes) {
    const url = new URL(p, root).href;
    const body = ACTS.test(p) ? {} : { runId: 'review-probe', id: 'review-probe', seq: 1, score: 1 };
    const asked = {};
    for (const [method, auth] of [
      ['GET', false],
      ['GET', true],
      ['POST', false],
      ['POST', true],
    ]) {
      const a = await ask(fetchImpl, url, { method, auth, body: method === 'POST' ? body : undefined, timeoutMs });
      asked[`${method} ${auth ? 'forged' : 'none'}`] = a;
      probes.push({ route: p, method, auth: auth ? 'forged' : 'none', ...a });
    }
    const posted = ['POST none', 'POST forged'].filter(k => accepted(asked[k]));
    if (posted.length)
      add(
        'live-open-post',
        'high',
        `POST ${p} answered ok to a request with ${posted.map(k => (k.endsWith('forged') ? 'a forged sign-in' : 'no sign-in')).join(' and with ')}: anyone can do what it does.`,
        'Verify the player first in that route (env.GF.verifyPlayer(token), and refuse when it is not ok), before anything it reads or writes.',
        p,
      );
    if (accepted(asked['GET forged']) && !accepted(asked['GET none']))
      add(
        'live-forged-token',
        'high',
        `GET ${p} refuses no sign-in but answers ok to a forged one: it reads the token without checking its signature.`,
        'Verify the token with env.GF.verifyPlayer(token) and use the player it answers, never what the token says by itself.',
        p,
      );
    else if (accepted(asked['GET none']) && !PUBLIC.has(p))
      add(
        'live-open-get',
        'medium',
        `GET ${p} answers ok to anyone, with no sign-in: fine for what is public (a leaderboard), never for a player's own data or a step of a run.`,
        'If it is not public, verify the player in that route first.',
        p,
      );
  }

  let key = null;
  if (vouchers || routes.some(r => r.path === 'api/vouchers/key')) {
    const url = new URL('api/vouchers/key', root).href;
    try {
      const res = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = await res.json().catch(() => null);
      key = { status: res.status, publicKey: json?.ok ? (json.publicKey ?? null) : null, said: json?.why ?? null };
    } catch (e) {
      key = { status: 0, publicKey: null, said: e.message };
    }
    if (!key.publicKey)
      add(
        'live-key-unset',
        'medium',
        `api/vouchers/key gives no key (${key.status}${key.said ? `: ${key.said}` : ''}): the live server signs no voucher.`,
        `${CMD} secret set VOUCHER_SEED --new-key (it points the grants the server pays at the key), then ${CMD} loot approve.`,
      );
    else if (testKey && key.publicKey === testKey)
      add(
        'live-test-key',
        'high',
        "The live server signs with the test key, whose seed is in this folder's .dev.vars: anyone with a copy of the folder signs what it signs.",
        `Make the live key (${CMD} secret set VOUCHER_SEED --new-key: made and sent to xgames.fun only; it points the grants the server pays at it), then ${CMD} loot approve and publish.`,
      );
    else if (!keys.includes(key.publicKey))
      add(
        'live-key-unnamed',
        'medium',
        `The live server's key (${key.publicKey}) is in no grant's "vouchers": every voucher it signs is refused on chain.`,
        `Put that address in the grant that pays results, then ${CMD} loot approve and ${CMD} publish.`,
      );
  }

  let economy = null;
  if (economyPath) {
    const url = new URL(economyPath, root).href;
    try {
      const res = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = res.ok ? await res.json().catch(() => null) : null;
      const same = (a, b) =>
        (a?.project ?? null) === (b?.project ?? null) && (a?.program ?? null) === (b?.program ?? null);
      economy = {
        path: economyPath,
        status: res.status,
        live: json?.live ? { program: json.live.program ?? null, project: json.live.project ?? null } : null,
        same: json ? same(json.live, localLive) : false,
      };
    } catch (e) {
      economy = { path: economyPath, status: 0, live: null, same: false, said: e.message };
    }
    if (!economy.same)
      add(
        'live-economy-stale',
        'medium',
        economy.status !== 200
          ? `The published ${economyPath} could not be read (${economy.status || economy.said}).`
          : `The published ${economyPath} is live at ${economy.live?.project ?? 'nothing'}, this folder's at ${localLive?.project ?? 'nothing'}: the page players have talks to another economy.`,
        `${CMD} publish, so the page carries the economy as it is live now.`,
      );
  }
  return { base: root, probes, key, economy, findings };
}
