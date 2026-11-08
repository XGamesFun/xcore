// `xcore embed` and `xcore domain`'s calls to games.fun: where a published game may be framed (sites of the creator's
// own that embed it) and the domains it is served on besides <slug>-play.xgames.fun. games.fun's routes:
//   GET    /api/kit/games/<gameId>/site                                 → the site
//   PUT    /api/kit/games/<gameId>/site            {"embed": [origin…]} → the site (the whole list, replaced)
//   POST   /api/kit/games/<gameId>/site/domains    {"hostname"}         → the site (one added, pending its DNS records)
//   POST   /api/kit/games/<gameId>/site/domains    {"hostname", "check": true} → the site (that one checked now)
//   DELETE /api/kit/games/<gameId>/site/domains?hostname=<hostname>     → the site
// The site: {ok, game, slug, tier, limits: {embed, domains}, embed: [origin], domains: [{hostname, status, records,
// error?, url, checkedAt?, activeAt?}], domainsOn, why?}. Refusals carry a code: 'plan' (over the plan's limit),
// 'taken' (a domain another game has), 'domains-off' (games.fun has not set custom domains up).
// The game is the folder's own (its .gamesfun/publish.json for this Studio); the credential is publish's.
import { readLinks } from './index.mjs';
import { call, studioOrigin } from './client.mjs';
import { publishCredential } from './oidc.mjs';
import { CMD } from '../command.mjs';

async function target(dir, { origin, env, fetchImpl }) {
  const known = (await readLinks(dir))[origin];
  if (!known?.projectId)
    throw new Error(`this folder's game is not on ${origin} yet: publish it first (${CMD} publish)`);
  const cred = await publishCredential(origin, { env, fetchImpl });
  if (!cred) throw new Error(`not signed in to ${origin}: run ${CMD} login first`);
  return { id: known.projectId, auth: await cred.auth() };
}
const route = (id, rest = '') => `/api/kit/games/${encodeURIComponent(id)}/site${rest}`;
/** A games.fun older than these routes answers 404 with no words of its own: said plainly. */
function older(e) {
  if (e?.status === 404 && e.answered === false)
    throw Object.assign(
      new Error(`this games.fun does not offer embedding and custom domains yet (it needs a newer games.fun).`),
      { status: 404 },
    );
  throw e;
}

/** An origin a site embeds the game from: "mygame.com" and "https://mygame.com/" → "https://mygame.com"; http only
 *  for this machine (http://localhost:<port>). → {origin} or {problem} */
export function embedOrigin(value) {
  let raw = String(value ?? '').trim();
  if (!raw) return { problem: 'an embed site is an address, like https://mygame.com' };
  if (raw.includes('*')) return { problem: `${raw}: name each site (no * wildcards)` };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { problem: `${value} is not an address` };
  }
  const local = /^(localhost|127\.\d+\.\d+\.\d+)$/.test(u.hostname);
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== ''))
    return { problem: `${value}: a site is its origin only (https://mygame.com), with no path` };
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && local)))
    return { problem: `${value}: an embed site is https (http only for localhost while you build it)` };
  return { origin: u.origin };
}

/** A custom domain: "https://Play.MyGame.com/" → "play.mygame.com". → {hostname} or {problem} */
export function domainName(value) {
  let raw = String(value ?? '')
    .trim()
    .toLowerCase();
  raw = raw.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
  if (!raw) return { problem: 'a domain is a name, like play.mygame.com' };
  if (raw.includes(':')) return { problem: `${value}: a domain has no port` };
  if (/^\d+(\.\d+){3}$/.test(raw) || raw === 'localhost')
    return { problem: `${value}: a domain is a name, not an address` };
  const labels = raw.split('.');
  if (
    labels.length < 2 ||
    raw.length > 253 ||
    labels.some(l => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) ||
    !/^[a-z]{2,}$|^xn--/.test(labels.at(-1))
  )
    return { problem: `${value} is not a domain name (like play.mygame.com)` };
  if (raw === 'xgames.fun' || raw.endsWith('.xgames.fun'))
    return { problem: `${value} is games.fun's own: every game has its xgames.fun link already` };
  return { hostname: raw };
}

/** → the site */
export async function gameSite(dir, { origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {}) {
  const t = await target(dir, { origin, env, fetchImpl });
  return call(origin, route(t.id), { ...t.auth, fetchImpl }).catch(older);
}

/** Add (`add: true`) or remove one embed site. → {site, changed} */
export async function changeEmbed(
  dir,
  value,
  add,
  { origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {},
) {
  const o = embedOrigin(value);
  if (o.problem) throw new Error(o.problem);
  const t = await target(dir, { origin, env, fetchImpl });
  const site = await call(origin, route(t.id), { ...t.auth, fetchImpl }).catch(older);
  const now = site.embed ?? [];
  const next = add ? [...new Set([...now, o.origin])] : now.filter(x => x !== o.origin);
  if (next.length === now.length) return { site, changed: false, origin: o.origin };
  const out = await call(origin, route(t.id), { method: 'PUT', body: { embed: next }, ...t.auth, fetchImpl }).catch(
    older,
  );
  return { site: out, changed: true, origin: o.origin };
}

/** `verb`: 'add' | 'check' | 'remove'. → the site */
export async function changeDomain(
  dir,
  verb,
  value,
  { origin = studioOrigin(), env = process.env, fetchImpl = fetch } = {},
) {
  const d = domainName(value);
  if (d.problem) throw new Error(d.problem);
  const t = await target(dir, { origin, env, fetchImpl });
  const at = route(t.id, '/domains');
  const request =
    verb === 'remove'
      ? { method: 'DELETE', path: `${at}?hostname=${encodeURIComponent(d.hostname)}` }
      : {
          method: 'POST',
          path: at,
          body: verb === 'check' ? { hostname: d.hostname, check: true } : { hostname: d.hostname },
        };
  return call(origin, request.path, { method: request.method, body: request.body, ...t.auth, fetchImpl }).catch(older);
}

/** The game's address on the play edge for a Studio origin (https://xgames.fun → https://<slug>-play.xgames.fun/). */
export function edgeUrl(slug, origin = studioOrigin()) {
  const u = new URL(origin);
  return `${u.protocol}//${slug}-play.${u.host}/`;
}
/** Where the game plays: its first live domain, else its xgames.fun link. */
export const playUrl = (site, origin) =>
  site.domains?.find(d => d.status === 'active')?.url ?? (site.slug ? edgeUrl(site.slug, origin) : null);
/** The <iframe> a site puts in its page. */
export const embedSnippet = url =>
  `<iframe src="${url}" allow="fullscreen; autoplay; gamepad" style="width:100%;aspect-ratio:16/9;border:0"></iframe>`;

const STATUS = {
  pending: 'waiting for its DNS records',
  active: 'live',
  paused: "paused: the game's plan has no room for it, so it sends players to the game's xgames.fun link",
  failed: 'failed',
};
/** One domain in words: its status, and the records still to add while it waits. */
export function describeDomain(d) {
  const lines = [
    `${d.hostname}: ${STATUS[d.status] ?? d.status}${d.status === 'active' && d.url ? ` at ${d.url}` : ''}${d.error ? ` (${d.error})` : ''}`,
  ];
  if (d.status === 'pending' || d.status === 'failed') lines.push(recordsTable(d));
  return lines.join('\n');
}
/** The DNS records as a table, with what each is for. */
export function recordsTable(d) {
  const rows = [
    ['Type', 'Name', 'Value', 'What it is for'],
    ...(d.records ?? []).map(r => [r.type, r.name, r.value, r.why ?? '']),
  ];
  const width = rows[0].map((_, i) => Math.max(...rows.map(r => String(r[i]).length)));
  const lines = rows.map(r =>
    `  ${r.map((c, i) => String(c).padEnd(i < r.length - 1 ? width[i] : 0)).join('  ')}`.trimEnd(),
  );
  const apex = d.hostname.split('.').length === 2;
  return [
    `Add these at the company that runs ${d.hostname}'s DNS (where you bought it: Cloudflare, Namecheap, GoDaddy, Route 53…):`,
    ...lines,
    ...(apex
      ? [
          `${d.hostname} is a bare domain: a CNAME there needs your DNS provider's CNAME flattening or ALIAS record. If it has none, use www.${d.hostname} or play.${d.hostname} and redirect the bare name to it.`,
        ]
      : []),
  ].join('\n');
}
/** The whole site in words. */
export function describeSite(site, origin = studioOrigin()) {
  const lim = site.limits ?? {};
  const tier = { free: 'Free', creator: 'Creator', scale: 'Scale' }[site.tier] ?? site.tier;
  const lines = [`Plays at ${playUrl(site, origin) ?? '(not published yet)'}`];
  lines.push(
    site.embed?.length
      ? `Embedded on: ${site.embed.join(', ')} (${site.embed.length} of ${lim.embed ?? '?'} on ${tier})`
      : `Embedded on: no sites yet (${tier} allows ${lim.embed ?? '?'}: ${CMD} embed add https://mygame.com)`,
  );
  if (site.domainsOn === false) lines.push(`Custom domains: ${site.why ?? 'not set up on this games.fun yet'}`);
  else if (!site.domains?.length)
    lines.push(
      lim.domains
        ? `Custom domains: none yet (${tier} allows ${lim.domains}: ${CMD} domain add play.mygame.com)`
        : `Custom domains: not on ${tier}; Creator has 1 and Scale 5 (${CMD} plan activate)`,
    );
  else {
    lines.push(`Custom domains (${site.domains.length} of ${lim.domains ?? '?'} on ${tier}):`);
    for (const d of site.domains)
      lines.push(
        ...describeDomain(d)
          .split('\n')
          .map(l => `  ${l}`),
      );
  }
  return lines.join('\n');
}
