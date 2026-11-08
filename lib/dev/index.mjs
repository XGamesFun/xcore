// `xcore dev`: a game as xgames.fun hosts it, on this machine, with everything behind it that the play host gives a
// published game, so the whole game (page, server, sign-in, saves, rooms, economy) runs before it is published:
//   /game/*            the published files (gamesfun.json page.out), with the play host's headers (../check.mjs servePage)
//   /game/api/*        the game's own server/ under workerd (./server.mjs), WebSockets too, sent on as /api/*
//   /platform/v1/*     sign-in, saves and leaderboards (./platform.mjs), the store env.GF reads as well
//   /loot/v1/rpc       the economy's Solana RPC: forwarded to XSOLANA_RPC_URL when set (your own devnet RPC, its URL
//                      never shown), else to xgames.fun's shared relay, the one a published page talks to
// Every HTML page served gets a one-line marker (globalThis.GAMESFUN_DEV) so gamesfun.js uses this host's sign-in,
// saves, database and rooms instead of the browser-only stand-ins it uses on a plain local server.
import { existsSync, readFileSync, watch } from 'node:fs';
import path from 'node:path';
import { servePage } from '../check.mjs';
import { buildFailure, pageFile, pageRoots, runBuild } from '../publish/page.mjs';
import { backendOrigins, BACKEND_FILE } from '../publish/scan.mjs';
import { ownOrigins } from '../publish/client.mjs';
import { readServerConfig, API_PREFIX } from '../server/contract.mjs';
import { PAGE_RPC, rpcWords, solanaRpc } from '../solana-rpc.mjs';
import { handlePlatform, createPlatformStore } from './platform.mjs';
import { createLimitWatch } from './limits.mjs';

const readJson = file => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
export const DEV_MARK = '<script>globalThis.GAMESFUN_DEV=1</script>';
/** The marker gamesfun.js reads, first thing in <head> (or the page) so it is set before any script runs. */
export function markPage(html) {
  if (html.includes(DEV_MARK)) return html;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + DEV_MARK + html.slice(head.index + head[0].length);
  const doc = /<!doctype[^>]*>/i.exec(html);
  return doc
    ? html.slice(0, doc.index + doc[0].length) + DEV_MARK + html.slice(doc.index + doc[0].length)
    : DEV_MARK + html;
}

// ---- what xgames.fun's shared relay takes (its rules, said here so a game run against your own RPC hears what the
// published page would be refused) ------------------------------------------------------------------------------
export const RELAY_METHODS = Object.freeze([
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
]);
const LOOT_PROGRAM = '9cwqM1TXytPnFZsLfmUyv2dg4uW6Ch9C6UJVPns7NFQ';
/** The other scans the relay takes, each of one address's own accounts: a memcmp at this byte naming an address. */
const RELAY_SCANS = Object.freeze({
  CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d: 1, // a wallet's Core NFTs (the owner)
  AddressLookupTab1e1111111111111111111111111: 22, // a wallet's lookup tables (the authority)
});
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function scanAllowed(program, filters) {
  if (!Array.isArray(filters) || !filters.length) return false;
  if (program === LOOT_PROGRAM) return true;
  const at = Object.hasOwn(RELAY_SCANS, program) ? RELAY_SCANS[program] : null;
  return at !== null && filters.some(f => f?.memcmp?.offset === at && ADDRESS.test(String(f.memcmp.bytes ?? '')));
}
/** Would xgames.fun's shared relay refuse this JSON-RPC body? → null, or why */
export function relayRefuses(call) {
  if (Array.isArray(call)) return 'a batch (the relay takes one request a call)';
  if (!call || typeof call.method !== 'string') return 'not a JSON-RPC request';
  if (!RELAY_METHODS.includes(call.method)) return `${call.method} (not one of the methods loot's client calls)`;
  const p = Array.isArray(call.params) ? call.params : [];
  if (call.method === 'getProgramAccounts' && !scanAllowed(p[0], p[1]?.filters))
    return `getProgramAccounts on ${String(p[0]).slice(0, 8)}… (it relays it only for the loot program with a filter, and for one wallet's own Core NFTs or lookup tables)`;
  return null;
}

async function body(req, cap = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > cap) throw new Error('too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/**
 * Start the dev host for `dir`. Options: port (default 8787; 0 any), noBuild, log, env, fetchImpl (the RPC forward's).
 * → {url, origin, rpc, server (the game server's status, or null), store, reload(), close()}
 */
/** A Host header naming this machine: localhost, 127.0.0.1, [::1] or a name under .localhost, with any port. */
export const isLocalHost = host =>
  /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(:\d{1,5})?$/i.test(String(host ?? ''));

export async function startDev(
  dir,
  { port = 8787, noBuild = false, log = m => console.log(m), env = process.env, fetchImpl = fetch } = {},
) {
  const game = path.resolve(dir);
  const roots = pageRoots(game);
  if (roots.build && !noBuild) {
    log(`build: ${roots.build}`);
    const b = await runBuild(game, { onLine: l => log(`  build: ${l}`), env });
    if (b.code !== 0)
      throw new Error(
        `the build failed (${roots.build}, exit ${b.code})${buildFailure(b) ? `: ${buildFailure(b)}` : ''}`,
      );
  }
  if (!existsSync(path.join(roots.out, 'index.html')))
    throw new Error(
      `no index.html in ${path.relative(game, roots.out) || '.'}: ${roots.build ? 'build the game first' : "export the game for the Web there first (or adopt it again with --out <the export's folder>)"}`,
    );

  const store = createPlatformStore({ dir: game, log: m => log(`platform: ${m}`) });
  const cfg = await readServerConfig(game);
  let server = null;
  if (cfg.has) {
    const { startLocalServer } = await import('./server.mjs');
    server = await startLocalServer({ dir: game, store, log: m => log(`server: ${m}`), env });
    const s = server.status();
    if (s.running) log(`server: running${s.objects.length ? ` (${s.objects.join(', ')})` : ''}`);
    else for (const p of [s.error, ...s.problems].filter(Boolean)) log(`server: ${p}`);
    for (const w of s.warnings) log(`server: ${w}`);
  }

  const rpc = solanaRpc(env, { file: path.join(game, '.env') });
  if (rpc.problem) log(`rpc: ${rpc.problem}`);
  const warned = new Set();
  async function forwardRpc(req, res) {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end();
      return;
    }
    const sent = await body(req);
    if (!rpc.shared) {
      let call = null;
      try {
        call = JSON.parse(sent.toString('utf8'));
      } catch {}
      const why = relayRefuses(call);
      if (why && !warned.has(why)) {
        warned.add(why);
        log(`rpc: published, xgames.fun's shared relay would refuse ${why}; it reached your own RPC here`);
      }
    }
    let a;
    try {
      a = await fetchImpl(rpc.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: sent,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: `The RPC did not answer (${e.name}).` },
        }),
      );
      return;
    }
    const text = await a.text();
    if (a.status !== 200) {
      let m = '?';
      try {
        m = []
          .concat(JSON.parse(sent.toString('utf8')))
          .map(x => x.method)
          .join(',');
      } catch {}
      log(`rpc: ${m} answered ${a.status}: ${text.slice(0, 200)}`);
    }
    res.writeHead(a.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(text);
  }

  const limits = createLimitWatch({ log });
  const apiAt = `/game${API_PREFIX}`; // the page's api/ beside it: /game/api/
  const route = async (req, res, url) => {
    // only this machine's own names: a page on another site that points a name of its own at 127.0.0.1 (DNS rebinding)
    // must not reach the platform, its sign-in tokens or the game's server here
    if (!isLocalHost(req.headers.host)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('xcore dev answers only localhost, 127.0.0.1 and [::1].');
      return true;
    }
    if (url.pathname === PAGE_RPC) return (await forwardRpc(req, res), true);
    if (await handlePlatform(req, res, url, store)) return true;
    if (url.pathname.startsWith(apiAt) || url.pathname === apiAt.slice(0, -1)) {
      const rest = url.pathname.slice('/game'.length) + url.search;
      if (!server) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'no-server', message: 'This game has no server/ (docs/SERVER.md).' }));
        return true;
      }
      const done = limits.request(req.method, url.pathname.slice('/game'.length));
      await server.proxy(req, res, rest, `http://${req.headers.host ?? '127.0.0.1'}`);
      done();
      return true;
    }
    return false;
  };
  const backend = backendOrigins(readJson(pageFile(roots, BACKEND_FILE)), { own: ownOrigins() }).origins;
  let site;
  try {
    site = await servePage(roots.out, {
      backend,
      server: cfg.has,
      route,
      html: markPage,
      port,
      overlay: roots.overlay,
    });
  } catch (e) {
    // the page could not be served (a port in use): the game's server started above stops with it
    if (server) await server.close().catch(() => {});
    throw e;
  }
  site.server.on('upgrade', (req, socket, head) => {
    if (!isLocalHost(req.headers.host)) return socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    const u = new URL(req.url, 'http://x');
    if (server && u.pathname.startsWith(apiAt)) {
      limits.upgrade(u.pathname.slice('/game'.length));
      server.upgrade(req, socket, head, u.pathname.slice('/game'.length) + u.search);
    } else socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  });

  // a change under server/, to gamesfun.json, to .dev.vars (the server's secrets here) or to a file of the game's own
  // that the server imports from outside server/ (rules shared with the page) rebuilds and reloads it
  const watchers = [];
  const shared = new Map(); // a file the server's bundle reads from outside server/ → its watcher
  // a change waits 200 ms for the next (an editor saves several files): `timer`, cleared by close(), after which no
  // reload starts (closed)
  let timer = null,
    closed = false;
  if (server) {
    const watchShared = () => {
      const want = new Set(
        (server.status().inputs ?? [])
          .filter(p => !p.startsWith('server/') && !p.split('/').includes('node_modules'))
          .map(p => path.join(game, p)),
      );
      for (const [file, w] of shared)
        if (!want.has(file)) {
          w.close();
          shared.delete(file);
        }
      for (const file of want)
        if (!shared.has(file) && existsSync(file))
          try {
            shared.set(
              file,
              watch(file, {}, () => again(path.relative(game, file).split(path.sep).join('/'))),
            );
          } catch {
            /* restart xcore dev after changing it */
          }
    };
    const again = what => {
      if (closed) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        timer = null;
        const s = await server.reload();
        if (closed) return;
        watchShared();
        log(
          s.running
            ? `server: reloaded (${what} changed)`
            : `server: ${what} changed, and it does not start: ${[s.error, ...s.problems].filter(Boolean).join('; ')}`,
        );
      }, 200);
    };
    for (const [target, what, opts] of [
      [path.join(game, 'server'), 'server/', { recursive: true }],
      [path.join(game, 'gamesfun.json'), 'gamesfun.json', {}],
    ])
      if (existsSync(target))
        try {
          watchers.push(watch(target, opts, () => again(what)));
        } catch {
          /* a platform without recursive watch: restart xcore dev after a change */
        }
    watchShared();
    // .dev.vars may not exist yet: watch the folder itself for it
    try {
      watchers.push(watch(game, {}, (_e, f) => String(f) === '.dev.vars' && again('.dev.vars')));
    } catch {
      /* restart xcore dev after adding .dev.vars */
    }
  }

  return {
    url: site.url,
    origin: site.origin,
    rpc: rpcWords(rpc),
    server: server ? server.status() : null,
    store,
    reload: () => server?.reload(),
    async close() {
      closed = true;
      clearTimeout(timer);
      for (const w of [...watchers, ...shared.values()]) w.close();
      await site.close();
      if (server) await server.close();
      else await store.flush();
    },
  };
}
