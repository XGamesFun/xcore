// gamesfun.js: sign-in, saves, leaderboards, the game's own database and multiplayer rooms for a game published on
// xgames.fun, from any engine. One file with no dependencies: a <script src="gamesfun.js"> in the page (or an import of it), and Godot's and
// Unity's glue (xcore add signin) load the same file. It sets globalThis.GamesFun; every call answers
// {data, error, status} and none throws, so a game plays on, as a guest, wherever xgames.fun is not there. A refusal from
// xgames.fun also carries code, its word for why (for example 'server-only': a board only the game's server writes).
//
//   const gf = GamesFun;
//   await gf.ready;                                   // what the page already knows (a sign-in the xgames.fun page has)
//   gf.player;                                        // null, or {id, name, level, wallet, x, google}
//   gf.local;                                         // true on this machine (localhost, xcore check, xcore dev)
//   gf.dev;                                           // true under xcore dev, where the game's server, saves and
//                                                     // sign-in answer as xgames.fun's will: "no server here" is
//                                                     // gf.local && !gf.dev, never gf.local alone
//   await gf.signIn();                                // from a tap: the player signs in → player | null (on the
//                                                     // game's own link the tab goes to X and back, and the game
//                                                     // starts again, signed in: call it inside the tap)
//   await gf.signIn('google');                        // the same with Google ('x', the default: with X)
//   await gf.signIn({stay: true});                    // never leave the page: a window on xgames.fun instead
//   gf.signInLink('x');                               // the address for a game's own <a href> button, or ''
//   gf.signInEnded;                                   // 'cancelled' | 'failed' when that sign-in came back with nobody
//   gf.onChange(player => …);                         // sign-in and sign-out
//   gf.onCode(({code, site, url, window}) => …);      // the code: show it plainly when window is false (no window
//                                                     // opened and this file drew no panel); when true, only as a
//                                                     // quiet line: X's login hides the window's state
//   await gf.fullscreen();                            // from a click: full screen (again: back); → {on, how}
//   gf.onFullscreen(on => …);                         // it went in or out (Esc, the page, the browser)
//   gf.canOpenWallet();                               // true: no wallet here, and the game can open in a wallet
//                                                     // app (the play page, or on its own host xgames.fun's wallet
//                                                     // page); false: a wallet is here; null: not known
//   gf.onCanOpenWallet(can => …);                     // it changed (a wallet can show up after the page loads)
//   gf.walletNeeded();                                // a Claim button shows: the page gets ready (once a load)
//   gf.openWallet('phantom');                         // from inside the tap, no await before it: the game opens in
//                                                     // Phantom ('solflare', 'browser'), signed in (on its own host
//                                                     // this tab goes to xgames.fun's wallet page and comes back)
//   await gf.saves.put('main', {level: 3});           // this player's saves: JSON, 64 KB each, 16 a player
//   await gf.scores.submit('best', 1200);             // leaderboards: a player's best is kept
//   await gf.db.add('levels', {name: 'Moon'});        // the game's own database (xcore add database): each player
//                                                     // their own documents; gf.db.list pages with {after}
//   await gf.api('scores', {method: 'POST', body: {}}); // the game's own server (server/), signed in
//   const {data: room} = await gf.rooms.join(gf.rooms.fromLink() ?? gf.rooms.code()); // multiplayer (xcore add multiplayer)
//   room.on('message', (from, data) => …); room.send({x: 1}); share gf.rooms.link(room.code)
//   const {data: live} = await gf.live.get();         // what the owner set on xgames.fun/console (Live), no republish:
//                                                     // {announcement, config, version, maintenance}; a banner shows
//                                                     // the announcement (gf.live.banner(false) turns it off)
//   gf.live.onChange(live => …);                      // asked again every minute while the page is in view
//
// Where sign-in comes from (xgames.fun's player sign-in: X or Google; a wallet is linked to that account on xgames.fun's
// account page and comes with every sign-in, but never signs anyone in: a copycat game could relay that signature):
// - inside xgames.fun's play page, the page above signs the player in and hands this page a token (gf:host / gf:auth);
//   only xgames.fun's own page may: framed by any other site (one embedding the game), the game signs in by itself;
// - on the game's own link (<slug>-play.<site>), its own domain or inside a post on X, the game signs in by itself.
//   On its own link xgames.fun is asked who is here as the page loads (and again shortly before the token's hour
//   ends): a player who chose to sign in to this game in this browser is signed in with no tap. There the tap on Sign
//   in takes this tab to X (or Google) and back, and the game starts again signed in; a sign-in that ends with nobody
//   comes back with #gf-signin=cancelled or failed, which this file takes out of the address (gf.signInEnded). Where
//   the tab cannot be moved (a frame: a post on X, a site that embeds the game), or the game asked to stay, and on its
//   own domain: a small window on xgames.fun at the player's tap (where no window opens, a panel of this file's own
//   with the link to tap, and the code to type at <site>/go behind "Sign in on another device"), and this page asks
//   the play host until it is answered (/player/v1/request). A reload keeps the sign-in everywhere (this tab keeps the
//   token until it ends), and Sign out sticks: xgames.fun is told to forget, and nothing signs in by itself again
//   until the next tap on Sign in;
// - on this machine (localhost, 127.0.0.1, xcore check), a local player and this browser's storage stand in, so the
//   game can be made and tested before it is published;
// - in `xcore dev` (its pages set globalThis.GAMESFUN_DEV), the dev host answers as xgames.fun would: a local sign-in
//   (each tab its own player), saves and scores on its platform, the game's own server for the database and rooms.
// The token lasts an hour. This tab keeps it (sessionStorage) until it ends, and only on a host that serves this one
// game: never where games share an origin. A server checks it with env.GF.verifyPlayer (server/), or any JWT library
// against <play host>/player/v1/key (a server of your own).
(function () {
  'use strict';
  if (globalThis.GamesFun) return;
  var VERSION = '1.9.0';
  var PLATFORM = '/platform/v1/';
  var SEG = /^[A-Za-z0-9_-]{1,64}$/;
  var loc = globalThis.location || { host: '', hostname: '', pathname: '/', protocol: 'https:', origin: '', href: '' };

  // ---- where this page is ----
  // a published game: <slug>-play.<site>/ (the play edge) or play.<site>/p/<slug>/ (the play host)
  var pathSlug = (/^\/p\/([a-z0-9]+(?:-[a-z0-9]+)*)\//.exec(loc.pathname) || [])[1] || null;
  var edge = pathSlug ? null : /^([a-z0-9]+(?:-[a-z0-9]+)*)-play\.([a-z0-9.-]+(?::\d+)?)$/.exec(loc.host);
  var slug = pathSlug || (edge ? edge[1] : null);
  var local = loc.protocol === 'file:' || /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(loc.hostname);
  // xcore dev: everything goes to the dev host, as it would to xgames.fun; only the sign-in is its own
  var dev = local && !!globalThis.GAMESFUN_DEV;
  if (dev) local = false;
  // on the game's own domain (play.mygame.com, xcore domain): xgames.fun's play edge says which game this is and where
  // xgames.fun is (GET /platform/v1/site, asked once at load; gf.ready waits for it)
  var site = null;
  function siteOrigin(v) {
    try {
      var u = new URL(v);
      if (u.origin !== v) return null;
      if (u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.\d+\.\d+\.\d+)$/.test(u.hostname)))
        return u.origin;
      // a stand-in xgames.fun in tests (http on a name this machine resolves)
      return u.protocol === 'http:' && /\.test$/.test(u.hostname) ? u.origin : null;
    } catch {
      return null;
    }
  }
  function studio() {
    if (site) return site;
    var h = loc.host;
    return /^play\./.test(h) ? loc.protocol + '//' + h.slice(5) : edge ? loc.protocol + '//' + edge[2] : loc.origin;
  }
  // the game's own address: the folder this file is in (it sits beside the game's index.html), else the page's
  var here = (globalThis.document && document.currentScript && document.currentScript.src) || loc.href;
  var root;
  try {
    root = new URL('.', here).href;
  } catch {
    root = '/';
  }

  // Back from a sign-in that took this tab to X and ended with nobody signed in (the player said no there, or it
  // failed): xgames.fun says so in the address, #gf-signin=cancelled or #gf-signin=failed. Taken out of the address at
  // once, before the game reads it, and kept as gf.signInEnded.
  var returned = (/^#gf-signin=(cancelled|failed)$/.exec(loc.hash || '') || [])[1] || null;
  if (returned) {
    try {
      globalThis.history.replaceState(globalThis.history.state, '', loc.pathname + (loc.search || ''));
    } catch {
      /* the address stays as it came */
    }
  }

  // ---- state and events ----
  var gf = {
    version: VERSION,
    slug: slug,
    local: local || dev,
    dev: dev,
    player: null,
    token: '',
    expires: 0,
    code: null,
    signInEnded: returned,
  };
  var changeFns = [],
    codeFns = [];
  function emit(list, value) {
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](value);
      } catch {
        /* a listener's own error */
      }
    }
  }
  gf.onChange = function (fn) {
    if (typeof fn === 'function') changeFns.push(fn);
    return function () {
      changeFns = changeFns.filter(function (f) {
        return f !== fn;
      });
    };
  };
  gf.onCode = function (fn) {
    if (typeof fn === 'function') codeFns.push(fn);
    return function () {
      codeFns = codeFns.filter(function (f) {
        return f !== fn;
      });
    };
  };
  function setPlayer(player, token, expires) {
    var before = JSON.stringify([gf.player, gf.token]);
    gf.player = player;
    gf.token = token || '';
    gf.expires = expires || 0;
    if (JSON.stringify([gf.player, gf.token]) !== before) emit(changeFns, gf.player);
  }

  // ---- HTTP ----
  function call(url, init, label) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl
      ? setTimeout(function () {
          ctl.abort();
        }, 15000)
      : null;
    return fetch(url, Object.assign({ cache: 'no-store' }, init, ctl ? { signal: ctl.signal } : {}))
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return null;
          })
          .then(function (data) {
            if (res.ok && !(data && data.ok === false)) return { data: data, error: null, status: res.status };
            var why = (data && (data.why || data.error)) || label + ' answered ' + res.status;
            var no = { data: null, error: why, status: res.status };
            if (data && data.code) no.code = data.code;
            // the game was paused (Live, maintenance) while it was open: the banner says so at once (xgames.fun's
            // refusal is a 503; a game's own server that says 'maintenance' with another status is its own business)
            if (res.status === 503 && data && data.code === 'maintenance') liveMaintenance(data);
            return no;
          });
      })
      .catch(function (e) {
        return {
          data: null,
          error: label + ' could not be reached (' + (e && e.name === 'AbortError' ? 'timed out' : 'offline') + ')',
          status: 0,
        };
      })
      .finally(function () {
        if (timer) clearTimeout(timer);
      });
  }
  function bearer() {
    return gf.token ? { authorization: 'Bearer ' + gf.token } : {};
  }
  function json(method, url, body, label) {
    var headers = bearer();
    if (body !== undefined) headers['content-type'] = 'application/json';
    return call(
      url,
      { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) },
      label,
    );
  }
  function bad(what) {
    return Promise.resolve({
      data: null,
      error: 'not a ' + what + ' (letters, digits, - and _, at most 64)',
      status: 0,
    });
  }
  function signedOut() {
    return Promise.resolve({ data: null, error: 'Sign in first.', status: 401 });
  }
  /** xgames.fun's word for a refusal (r.code), kept on the answer made from r. */
  function withCode(answer, r) {
    if (r.code) answer.code = r.code;
    return answer;
  }
  function pick(r, f) {
    return withCode({ data: r.data ? f(r.data) : null, error: r.error, status: r.status }, r);
  }

  // ---- on this machine: a local player and this browser's storage ----
  var LOCAL_PLAYER = { id: 'local:player', name: 'Local player', level: 1, wallet: '', x: null, local: true };
  function store(key, value) {
    var k = 'gamesfun:' + (slug || 'local') + ':' + key;
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(k) || 'null');
      if (value === null) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(value));
    } catch {
      /* storage blocked: nothing kept */
    }
    return null;
  }
  function ok(data) {
    return Promise.resolve({ data: data, error: null, status: 200 });
  }

  // ---- xcore dev: a local sign-in from the dev host, one player a tab (two tabs play a room together) ----
  /** This tab's own value for the game (sessionStorage): read, written, or with null removed. */
  function tabStore(key, value) {
    var k = 'gamesfun:' + (slug || 'local') + ':' + key;
    try {
      if (value === undefined) return JSON.parse(sessionStorage.getItem(k) || 'null');
      if (value === null) sessionStorage.removeItem(k);
      else sessionStorage.setItem(k, JSON.stringify(value));
    } catch {
      /* storage blocked: nothing kept */
    }
    return null;
  }
  function devTab(value) {
    try {
      if (value === undefined) return JSON.parse(sessionStorage.getItem('gamesfun:dev') || 'null');
      sessionStorage.setItem('gamesfun:dev', JSON.stringify(value));
    } catch {
      /* storage blocked: a new player each load */
    }
    return null;
  }
  var devMade = '';
  /** This tab's player on the dev host: the same one after a reload, another in another tab. */
  function devId() {
    var was = devTab() || {};
    if (/^[a-z0-9]{6,24}$/.test(String(was.id || ''))) return was.id;
    devMade =
      devMade ||
      Math.random()
        .toString(36)
        .slice(2, 12)
        .replace(/[^a-z0-9]/g, '0') + 'dev';
    devTab({ id: devMade, name: was.name || '' });
    return devMade;
  }
  /** The dev host's sign-in for this tab's player (the click, with no window). → {player, token, expires} | null */
  function devAsk(opts) {
    var id = devId();
    var was = devTab() || {};
    return call(
      PLATFORM + 'dev/token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: id, name: (opts && opts.name) || was.name || '' }),
      },
      'xcore dev sign-in',
    ).then(function (r) {
      if (!r.data || !r.data.token) return null;
      devTab({ id: id, name: r.data.player.name });
      return { player: r.data.player, token: r.data.token, expires: r.data.expires };
    });
  }

  // ---- the page above (xgames.fun's play page) ----
  var above = null; // the parent window, once it answered gf:host
  var aboveAuth = false;
  var framed;
  try {
    framed = globalThis.parent && globalThis.parent !== globalThis;
  } catch {
    framed = true;
  }
  var waiters = [];
  // a token from xgames.fun: the player as the platform knows them (the token's subject), said once
  function takeToken(token, guess, expires) {
    gf.token = token;
    gf.expires = expires;
    return json('GET', PLATFORM + 'me', undefined, 'who the player is').then(function (r) {
      if (gf.token === token) setPlayer(r.data && r.data.player ? r.data.player : guess, token, expires);
      return gf.player;
    });
  }
  function takeAuth(a) {
    var token = typeof a.token === 'string' && a.token && (a.level || 0) > 0 ? a.token : '';
    var done = Promise.resolve();
    if (!token) {
      if (gf.token && a.status !== 'signing') setPlayer(null, '', 0);
    } else if (token !== gf.token) {
      var x = a.x && a.x.handle ? a.x : null;
      // the name players see: @handle for X; a Google account's player name (never with an @, which only X has)
      var g = a.google && a.google.name ? { name: String(a.google.name) } : null;
      var guess = {
        id: '',
        name: x ? '@' + x.handle : g ? g.name : a.short || '',
        level: a.level,
        wallet: a.wallet || '',
        x: x,
        google: g,
      };
      done = takeToken(token, guess, a.expires || Date.now() + 3600e3);
    }
    return done.then(function () {
      var w = waiters;
      waiters = [];
      for (var i = 0; i < w.length; i++) w[i](a);
    });
  }
  var readyResolve;
  gf.ready = new Promise(function (resolve) {
    readyResolve = resolve;
  });
  // A message from the page above counts only from xgames.fun's own page (its origin, or www. of it): a site that
  // embeds the game can't hand it a sign-in or take its sign-in over.
  function fromSite(origin) {
    var s = studio();
    if (origin === s) return true;
    try {
      var a = new URL(s),
        b = new URL(origin);
      return b.protocol === a.protocol && b.host === 'www.' + a.host;
    } catch {
      return false;
    }
  }
  var discover =
    !slug && !local && !dev && /^https?:$/.test(loc.protocol)
      ? call(PLATFORM + 'site', { method: 'GET' }, 'where this game is').then(function (r) {
          var d = r.data;
          var s = d && d.gamesfun === 'site' && typeof d.site === 'string' ? siteOrigin(d.site) : null;
          if (s && typeof d.slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug)) {
            slug = d.slug;
            gf.slug = d.slug;
            site = s;
          }
        })
      : null;
  function start() {
    if (local) {
      setPlayer(store('signedIn') ? LOCAL_PLAYER : null, store('signedIn') ? 'local' : '', 0);
      readyResolve(gf.player);
    } else if (dev) {
      // the dev host signs in as xgames.fun would: the tab's player again after a reload, with no click
      own();
    } else if (framed && globalThis.addEventListener) {
      globalThis.addEventListener('message', function (e) {
        if (e.source !== globalThis.parent || !e.data || typeof e.data !== 'object') return;
        if (!fromSite(e.origin)) return;
        if (e.data.type === 'gf:host') {
          above = e.source;
          aboveAuth = e.data.auth !== false;
          // openWallet: true, false, or not said (an older page): sent again when it changes
          setWalletOffer(typeof e.data.openWallet === 'boolean' ? e.data.openWallet : null);
          if (walletWanted) tellWalletNeed();
          readyResolve(gf.player);
        } else if (e.data.type === 'gf:fullscreen-state') {
          setFull(e.data.on === true);
        } else if (e.data.type === 'gf:auth') {
          above = e.source;
          takeAuth(e.data).then(function () {
            readyResolve(gf.player);
          });
        }
      });
      // xgames.fun's own page frames this one (its play page, slow to answer): it signs the player in, so the game
      // asks xgames.fun nothing of its own while that page may still answer
      var siteAbove = framedBySite();
      // at boot, then every second until a page answers (40 s at most), as the kit's games say it
      var tries = 0;
      var hello = function () {
        if (above) return;
        if (tries++ > 40) {
          if (siteAbove) own(); // it never answered: the game signs in by itself after all
          return;
        }
        try {
          globalThis.parent.postMessage({ type: 'gf:host-ready', v: 1 }, '*');
        } catch {
          /* gone */
        }
        setTimeout(hello, 1000);
      };
      hello();
      // no page above that answers (a post on X frames the game alone): the game signs in by itself
      setTimeout(function () {
        if (above || siteAbove) readyResolve(gf.player);
        else own();
      }, 1500);
    } else own();
  }
  /** Is the page that frames this one xgames.fun's own, as far as this page can tell before it answers? */
  function framedBySite() {
    try {
      var a = loc.ancestorOrigins;
      if (a && a.length) return fromSite(a[0]);
    } catch {
      /* not said */
    }
    try {
      var r = globalThis.document && document.referrer;
      return !!r && fromSite(new URL(r).origin);
    } catch {
      return false;
    }
  }

  // ---- signing in by itself: the sign-in client ---------------------------------------------------------------------
  // On the game's own link, its own domain, inside a post on X and under `xcore dev`, this page signs the player in by
  // itself, and everything it says to xgames.fun to do so is the one function below. The same function can be served
  // at its newest at one address on the game's own host (SIGNIN_URL, further down; `xcore dev` serves it): a game asks
  // for it as it loads and uses it when it comes, so a change to sign-in could reach a game without publishing it
  // again; the copy here is what runs wherever that address answers nothing.
  //
  // What this file hands it (`host`, version 1: these names keep their meaning for as long as that address is served):
  //   v: 1 · slug · site (xgames.fun's origin) · framed (no xgames.fun play page answered above this page)
  //   panel (may it draw its own sign-in panel) · stay (must a sign-in never leave the page)
  //   returned ('cancelled' | 'failed' | null: how a sign-in that left came back)
  //   back() → this page's address with no fragment: where a sign-in that takes the tab to X comes back to
  //   where: 'edge' (<slug>-play.<site>) | 'domain' (the game's own domain) | 'path' (a host games share) | 'dev'
  //   tab, ask: xcore dev only (each tab is its own player there, signed in by the dev host): null on xgames.fun
  //   state() → {player, token, expires} · set(player, token, expires, said): `said` is the player as xgames.fun
  //   said it (null when not known), for a page that reads more of it · code(value): gf.code, said to gf.onCode
  //   mark(value?) → 'in' | 'out' | null: whether the player signed in or out here last, kept in this browser
  //   kept(value?) → what this tab keeps (the token until it ends): null, always, on a host that games share
  // What it answers: {version, start() → Promise<player | null>, signIn(opts) → Promise<player | null>, signOut(),
  // link(opts) → the address of a real link for a page that draws the provider's button itself, or '',
  // refresh() → the sign-in asked of xgames.fun again (a wallet linked meanwhile), hold(session): a session the page
  // got by a way of its own, held like any other from then on}.
  /* signin-client:start */
  function signin(host) {
    var VERSION = '1.1.0';
    var POLL_MS = 2000; // a sign-in request is asked about this often
    var RENEW_MS = 300e3; // a token is renewed this long before it ends
    var BEGUN_MS = 600e3; // a sign-in that took this tab to X can still be answered this long after the tap
    var BEGUN_ASKS = 3; // and xgames.fun is asked about it this often at most, when the player is back in view
    var ASK_GAP_MS = 5000; // back in view, xgames.fun is asked no more often than this
    var HOUR_ASKS = 12; // and never more than this often in an hour, from this tab, without the player's tap
    var QUIET_MS = 600e3; // told "too many" (429) with no Retry-After: not asked again for this long
    var slug = host.slug,
      site = host.site,
      doc = globalThis.document;
    // Who is here, with no tap: xgames.fun answers a game's own host (<slug>-play.<site>, CORS for that origin only)
    // from its own cookie, so it is asked there: the top window, and a frame that no xgames.fun play page answered (a
    // post on X, a site that embeds the game). Never from the game's own domain (another site, which xgames.fun
    // answers nothing) nor a host games share (not the game's own origin). The tab itself goes to X and back only
    // from the top window: a frame cannot move it, so a frame signs in by the second page (a window, or the panel).
    var asks = host.where === 'edge' || host.where === 'dev';
    var top = asks && !host.framed;
    var mine = ''; // the token this client set: it never ends or renews one the page above handed over
    var timer = null; // the renewal, or the token's end
    var pending = null; // one sign-in at a time: {promise, resolve, timer, popup, req, how, flight, begun}
    var asking = null; // the question to xgames.fun on its way
    var asked = 0; // when it was last asked
    var panel = null; // this file's own sign-in panel, while it shows

    function call(url, init) {
      var ctl = typeof AbortController === 'function' ? new AbortController() : null;
      var end = ctl
        ? setTimeout(function () {
            ctl.abort();
          }, 15000)
        : null;
      return fetch(url, Object.assign({ cache: 'no-store' }, init, ctl ? { signal: ctl.signal } : {}))
        .then(function (res) {
          return res
            .json()
            .catch(function () {
              return null;
            })
            .then(function (data) {
              // Retry-After, where the answer lets this page read it
              var after = res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
              return { ok: res.ok, status: res.status, data: data, after: after };
            });
        })
        .catch(function () {
          return { ok: false, status: 0, data: null, after: null };
        })
        .finally(function () {
          if (end) clearTimeout(end);
        });
    }
    // a wait that holds nothing open by itself (where this runs outside a page: a test)
    function later(fn, ms) {
      var t = setTimeout(fn, ms);
      if (t && typeof t.unref === 'function') t.unref();
      return t;
    }
    function post(url, body, more) {
      return call(
        url,
        Object.assign(
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
          more,
        ),
      );
    }
    function me(token) {
      return call('/platform/v1/me', { method: 'GET', headers: { authorization: 'Bearer ' + token } });
    }

    // ---- what this tab keeps: {s: the session {token, expires, player}, r: a sign-in request not yet answered,
    // b: a sign-in that took this tab to X {at, n}, q: the questions asked of xgames.fun {until, at}} ----
    function keptPart(part) {
      var k = host.kept();
      return k && typeof k === 'object' && k[part] && typeof k[part] === 'object' ? k[part] : null;
    }
    function keep(part, value) {
      var k = host.kept();
      var next = { s: (k && k.s) || null, r: (k && k.r) || null, b: (k && k.b) || null, q: (k && k.q) || null };
      next[part] = value || null;
      host.kept(next.s || next.r || next.b || next.q ? next : null);
    }
    // the sign-in that took this tab to X, while it can still be answered
    function begun() {
      var b = keptPart('b');
      if (b && b.at > Date.now() - BEGUN_MS && (b.n | 0) < BEGUN_ASKS) return b;
      if (b) keep('b', null);
      return null;
    }
    // xgames.fun answers the question a number of times a session and game an hour. This tab asks it as the page loads,
    // before a token ends, and when the player is back from a sign-in; never on a timer, never more than HOUR_ASKS
    // times an hour (kept for the tab, so a reload counts), and not at all, until it says, after it answered 429.
    // `tapped`: the question the player's own tap on Sign in is waiting for, which is always asked.
    var budget = null; // {until: no question before then, at: when the last hour's were asked}
    function may(tapped) {
      var now = Date.now();
      var q = budget || keptPart('q') || {};
      var at = (Array.isArray(q.at) ? q.at : []).filter(function (t) {
        return typeof t === 'number' && t > now - 3600e3 && t <= now;
      });
      budget = { until: q.until > now ? q.until : 0, at: at };
      if (!tapped && (budget.until || at.length >= HOUR_ASKS)) return false;
      at.push(now);
      keep('q', budget);
      return true;
    }
    function hush(after) {
      var s = Number(after);
      budget = budget || { until: 0, at: [] };
      budget.until = Date.now() + (s > 0 && s <= 86400 ? s * 1000 : QUIET_MS);
      keep('q', budget);
    }

    // ---- the session ----
    function mineNow() {
      return !!mine && host.state().token === mine;
    }
    // a session from xgames.fun ({player, token, expires}) as the game sees it: the player as the platform knows them
    // (the token's subject), asked once
    function take(s) {
      var pl = s.player || {};
      var x = pl.x && pl.x.handle ? pl.x : null;
      // the name players see: @handle for X; a Google account's player name (never with an @, which only X has)
      var g = pl.google && pl.google.name ? { name: String(pl.google.name) } : null;
      var guess = {
        id: '',
        name: x ? '@' + x.handle : g ? g.name : pl.name || pl.wallet || '',
        level: pl.level,
        wallet: pl.wallet || '',
        x: x,
        google: g,
      };
      return me(s.token).then(function (r) {
        return {
          player: r.ok && r.data && r.data.player ? r.data.player : guess,
          token: s.token,
          expires: s.expires,
          // the player as xgames.fun said it, for a page that reads more of it than the platform's player has
          said: s.player || null,
        };
      });
    }
    function adopt(s) {
      mine = s.token;
      host.mark('in');
      if (keptPart('b')) keep('b', null);
      keep('s', { token: s.token, expires: s.expires, player: s.player, said: s.said || null });
      plan(s.expires);
      host.set(s.player, s.token, s.expires, s.said || null);
    }
    // this client's sign-in is over on this page (its token ran out, or the player signed out)
    function drop() {
      clearTimeout(timer);
      var was = mineNow();
      mine = '';
      keep('s', null);
      if (was) host.set(null, '', 0);
    }
    // renewed five minutes before its end where xgames.fun can be asked; anywhere else it ends when the token does
    function plan(expires) {
      clearTimeout(timer);
      var left = expires - Date.now();
      var wait = asks ? Math.max(left - RENEW_MS, 10e3) : Math.max(left, 0);
      timer = later(asks ? renew : drop, Math.min(wait, 2e9));
    }
    function renew() {
      clearTimeout(timer);
      if (!mineNow()) return;
      if (host.mark() === 'out') return drop(); // signed out in another tab of this game
      var token = mine;
      resume().then(function (s) {
        if (s || mine !== token || !mineNow()) return; // renewed (resume took it), or no longer this client's
        var left = host.state().expires - Date.now();
        // not renewed. xgames.fun said nobody is signed in (the player signed out there): the sign-in ends with its
        // token. It could not be reached, or not asked (too many questions this hour): tried again each minute, until
        // the token ends
        if (s === false || left <= 75e3) timer = later(drop, Math.max(left, 0));
        else timer = later(renew, 60e3);
      });
    }
    // The question to xgames.fun, with no click and nothing shown: is this browser's player signed in to this game?
    // → the session (taken already), false (asked, and nobody is), or null (not asked, or no answer). `clicked`: the
    // player's own click on Sign in took this tab to X, so it is asked even after a sign-out here, and counted.
    function resume(clicked) {
      var b = clicked ? begun() : null;
      if (!asks || (!b && host.mark() === 'out')) return Promise.resolve(null);
      if (asking) return asking;
      // the first question after the tap is the one it waits for; a later one (back in view again) is not
      if (!may(!!b && !(b.n | 0))) return Promise.resolve(null);
      if (b) keep('b', { at: b.at, n: (b.n | 0) + 1 });
      asked = Date.now();
      var was = host.state().token;
      asking = call(
        site +
          '/api/player/v1/session?slug=' +
          encodeURIComponent(slug || '') +
          (host.tab ? '&tab=' + encodeURIComponent(host.tab) : ''),
        { method: 'GET', credentials: 'include' },
      )
        .then(function (r) {
          if (r.status === 429) hush(r.after);
          var s = r.ok && r.data && typeof r.data === 'object' ? r.data : null;
          if (!s) return null;
          if (!s.player || typeof s.token !== 'string' || !s.token || !(s.expires > Date.now())) return false;
          return take(s).then(function (session) {
            // signed out, or signed in another way (a click, the page above), while this was on its way: it changes
            // nothing
            if ((!b && host.mark() === 'out') || (b && !keptPart('b')) || host.state().token !== was) return null;
            adopt(session);
            if (pending) endSignIn(pending, session.player); // a click that was waiting has its answer
            return session;
          });
        })
        .then(function (out) {
          asking = null;
          return out;
        });
      return asking;
    }
    // A token taken back from this tab is asked of the platform once: one it no longer takes (its key was replaced,
    // xcore dev started again) is not kept, and xgames.fun is asked instead.
    function check(token) {
      me(token).then(function (r) {
        if (r.status !== 401 || mine !== token || !mineNow()) return;
        resume().then(function (s) {
          if (!s && mine === token && mineNow()) drop();
        });
      });
    }
    // A sign-in request this tab made and then left (its page opened in this very tab, and the player came back):
    // asked about once; answered, the player is signed in. → the player, or null
    function back() {
      var r = keptPart('r');
      if (!r || !(r.expires > Date.now()) || typeof r.id !== 'string' || typeof r.secret !== 'string') {
        if (r) keep('r', null);
        return Promise.resolve(null);
      }
      return post('/player/v1/request/status', { id: r.id, secret: r.secret }).then(function (a) {
        var s = a.data || {};
        if (s.state === 'expired') keep('r', null);
        if (s.state !== 'signed-in' || typeof s.token !== 'string' || !s.token) return null;
        keep('r', null);
        return take(s).then(function (session) {
          if (host.state().token) return null;
          adopt(session);
          return session.player;
        });
      });
    }
    function start() {
      var k = keptPart('s');
      var out = host.mark() === 'out';
      if (out && k) {
        // signed out in another tab of this game: what this tab kept goes too
        keep('s', null);
        k = null;
      }
      // back from a sign-in that took this tab to X and ended with nobody signed in: it is over
      if (host.returned) keep('b', null);
      if (k && typeof k.token === 'string' && k.token && (k.player || k.said) && k.expires > Date.now() + 60e3) {
        // a reload inside the token's hour: this tab's own sign-in, taken back as it was
        if (host.state().token) return Promise.resolve(host.state().player);
        mine = k.token;
        plan(k.expires);
        host.set(k.player || null, k.token, k.expires, k.said || null);
        check(k.token);
        return Promise.resolve(k.player || k.said);
      }
      if (k) keep('s', null);
      // a sign-in the player began by their own click, and that left this tab, may be answered by now: one that went
      // to xgames.fun's page (back), one that took the whole tab to X and came back here (begun)
      return back().then(function (player) {
        if (player) return player;
        var b = begun();
        // signed out here: nothing signs in by itself until the player clicks Sign in
        if (out && !b) return null;
        return resume(!!b).then(function (s) {
          // nobody is signed in to this game in this browser any more: the next load waits for nobody
          if (s === false && host.mark() === 'in') host.mark(null);
          return s ? s.player : null;
        });
      });
    }

    // ---- a sign-in by the player's click: a request answered on xgames.fun ----
    function address(req, how) {
      var url = String(req.url || '');
      if (!/^https?:\/\//.test(url)) return '';
      return url + (url.indexOf('?') < 0 ? '?' : '&') + 'with=' + how;
    }
    function openWindow(url) {
      var s = globalThis.screen || {};
      try {
        return globalThis.open(
          url,
          'gamesfun-signin',
          'popup,width=440,height=600,left=' +
            Math.max(0, Math.round((s.availWidth || 1200) / 2 - 220)) +
            ',top=' +
            Math.max(0, Math.round((s.availHeight || 800) / 2 - 300)),
        );
      } catch {
        return null;
      }
    }
    function closeWindow(p) {
      try {
        if (p.popup) p.popup.close();
      } catch {
        /* closed */
      }
      p.popup = null;
    }
    function hidePanel() {
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      panel = null;
    }
    // This file's own panel, when no window could open (an app's own browser, a blocker): the link the player taps,
    // which a browser never blocks, and the code for another device behind a line of its own. Only on a page of its
    // own: in a frame on another site a link opens no more than a window does, so there the game shows the code, as
    // it always has. Drawn with text and styles set from here (no HTML, no style attributes in markup).
    function showPanel(p) {
      hidePanel();
      if (!host.panel || host.framed || !doc || !doc.body || typeof doc.createElement !== 'function') return false;
      var href = address(p.req, p.how);
      if (!href) return false;
      var el = function (tag, css, text) {
        var e = doc.createElement(tag);
        e.style.cssText = css;
        if (text) e.textContent = text;
        return e;
      };
      var box = doc.createElement('div');
      box.setAttribute('data-gamesfun', 'signin');
      var root = box.attachShadow ? box.attachShadow({ mode: 'open' }) : box;
      var shade = el(
        'div',
        'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;display:flex;align-items:center;' +
          'justify-content:center;background:rgba(0,0,0,.6);font:16px/1.4 system-ui,-apple-system,sans-serif',
      );
      var card = el(
        'div',
        'box-sizing:border-box;width:340px;max-width:calc(100vw - 32px);padding:20px;border-radius:14px;' +
          'background:#1d1d26;color:#e8e8f0;border:1px solid #3a3a4a;box-shadow:0 8px 30px rgba(0,0,0,.5);' +
          'text-align:center',
      );
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-label', 'Sign in');
      var link = el(
        'a',
        'display:block;padding:13px 16px;border-radius:10px;background:#fff;color:#111;font-weight:600;' +
          'text-decoration:none',
        'Sign in with ' + (p.how === 'google' ? 'Google' : 'X'),
      );
      link.href = href;
      link.target = '_blank';
      // the page it opens is xgames.fun's own, told which page opened it, as the window is
      link.rel = 'opener';
      var small = 'all:unset;cursor:pointer;display:block;margin:14px auto 0;font-size:13px;';
      var other = el('button', small + 'text-decoration:underline;opacity:.85', 'Sign in on another device');
      var words = el(
        'p',
        'display:none;margin:10px 0 0;font-size:14px;overflow-wrap:anywhere',
        'On any device, go to ' + p.req.site + '/go and enter ' + p.req.code,
      );
      other.addEventListener('click', function () {
        words.style.display = words.style.display === 'none' ? 'block' : 'none';
      });
      var no = el('button', small + 'opacity:.6', 'Not now');
      no.addEventListener('click', function () {
        endSignIn(p, null);
      });
      card.appendChild(link);
      card.appendChild(other);
      card.appendChild(words);
      card.appendChild(no);
      shade.appendChild(card);
      root.appendChild(shade);
      doc.body.appendChild(box);
      panel = box;
      return true;
    }
    // the sign-in `p` is over: answered with `player` (once; nothing if it ended already). Its request, when it was
    // not answered, stays this tab's for the next click (the same one, not a new one).
    function endSignIn(p, player) {
      if (pending !== p) return;
      pending = null;
      clearTimeout(p.timer);
      host.code(null);
      closeWindow(p);
      hidePanel();
      p.resolve(player);
    }
    function finish(p, s) {
      p.req = null;
      keep('r', null);
      host.code(null);
      closeWindow(p);
      hidePanel();
      // still this sign-in's until the token is taken: a click meanwhile waits for the same player
      take(s).then(function (session) {
        if (pending !== p) return; // signed out meanwhile
        adopt(session);
        endSignIn(p, session.player);
      });
    }
    function poll(p, wait) {
      if (pending !== p || !p.req || p.flight) return;
      clearTimeout(p.timer);
      if (p.req.expires <= Date.now()) {
        keep('r', null);
        return endSignIn(p, null);
      }
      p.timer = setTimeout(
        function () {
          if (pending !== p || !p.req || p.flight) return;
          p.flight = true;
          post('/player/v1/request/status', { id: p.req.id, secret: p.req.secret }).then(function (r) {
            p.flight = false;
            if (pending !== p || !p.req) return; // signed out (or ended) while this was on its way
            var s = r.data || {};
            if (s.state === 'signed-in') return finish(p, s);
            if (s.state === 'expired') {
              keep('r', null);
              return endSignIn(p, null);
            }
            poll(p);
          });
        },
        wait === undefined ? POLL_MS : wait,
      );
    }
    // the request's page for the player: the window opened at the click goes there (`there`: it opened there); with
    // no window, this file's panel (or, where it draws none, the code, which the game then shows)
    function show(p, there) {
      if (p.popup && !p.popup.closed) {
        try {
          if (!there) p.popup.location.href = address(p.req, p.how) || p.req.url;
        } catch {
          p.popup = null;
        }
      } else p.popup = null;
      var drawn = !p.popup && showPanel(p);
      // always said: the game may show the code, and must when `window` is false (no window opened and no panel is
      // drawn: a frame on another site, a game that turned the panel off)
      host.code({ code: p.req.code, site: p.req.site, url: p.req.url, window: !!p.popup || drawn, panel: drawn });
    }
    // ---- a sign-in that takes this tab to X (or Google) and back: the top window of the game's own link ----
    // One tap in the game, the provider's own screen, and the game again, signed in: no window, no request, no code.
    // The tab goes to xgames.fun, which sends it straight on to the provider and afterwards back to this address; the
    // page then loads afresh and start() finds the player (the question above). So the game starts again: what it held
    // in memory is gone, which is why a game can ask to stay (signIn({stay: true}), or GAMESFUN_SIGNIN_STAY for the
    // page), and gets the second page instead. This is how the top window of the game's own link signs in, on a phone
    // and a computer alike: a wallet app's browser shows its wallet to the top window only, and xgames.fun names a
    // player to the game with no tap afterwards in a browser where they chose to sign in to it.
    // xcore dev does the same (its own stand-in for X), except for a dev player given a name (signIn({name})), whom
    // the dev host signs in at once.
    function leaves(opts) {
      if (!top || host.stay || opts.stay === true) return false;
      return !(host.ask && opts.name);
    }
    // where the tab goes: xgames.fun, then X or Google, then back to this page's address with no fragment (a sign-in
    // that ends with nobody comes back with #gf-signin=cancelled or failed, taken off again as the page loads)
    function beginAt(how) {
      return (
        site +
        '/api/player/v1/' +
        (how === 'google' ? 'google' : 'x') +
        '/begin?slug=' +
        encodeURIComponent(slug || '') +
        (host.tab ? '&tab=' + encodeURIComponent(host.tab) : '') +
        '&back=' +
        encodeURIComponent(host.back())
      );
    }
    // `linked`: the player is following a real link to that address (link(), below), so nothing is moved from here
    function leave(p, how, linked) {
      p.begun = true;
      p.how = how;
      keep('b', { at: Date.now(), n: 0 });
      // where a phone hands the login to X's app, this page may never be left: then it waits here, and is asked about
      // when the player is back (again, below); it ends by itself when the login can no longer be answered
      clearTimeout(p.timer);
      p.timer = later(function () {
        endSignIn(p, null);
      }, BEGUN_MS);
      if (linked) return;
      try {
        // from inside the click, before anything is awaited: the browser reports the move as the player's own
        globalThis.location.assign(beginAt(how));
      } catch {
        keep('b', null);
        endSignIn(p, null);
      }
    }
    /**
     * A session the page got by a way of its own (a kit that makes its own sign-in request and goes on asking about it,
     * so a wallet linked later shows): held like any other from then on, kept for the tab, renewed, ended by Sign out.
     * `s`: {token, expires, said (the player as xgames.fun said it), player?}.
     */
    function hold(s) {
      if (!s || typeof s.token !== 'string' || !s.token || !(s.expires > Date.now())) return;
      adopt({ player: s.player || null, token: s.token, expires: s.expires, said: s.said || null });
    }
    /**
     * The player's sign-in as xgames.fun has it now, asked again (they linked a wallet on xgames.fun's account page, in
     * another tab): only for a player this client signed in, and only where xgames.fun can be asked. → the session
     * (taken already: the game hears of the new token), false (nobody is signed in any more), or null.
     */
    function refresh() {
      return mineNow() ? resume() : Promise.resolve(null);
    }
    /**
     * For a page that draws the provider's button itself (a kit's own sign-in sheet): the address its button goes to
     * as a real link, where a sign-in takes this tab to X or Google ('' where it does not: the page then calls signIn
     * from its click, and gets the window). The link's own click says so with signIn({how, link: true}), which moves
     * nothing: the player's tap on the link does.
     */
    function link(opts) {
      opts = opts || {};
      try {
        return leaves(opts) ? beginAt(opts.how === 'google' ? 'google' : 'x') : '';
      } catch {
        return '';
      }
    }
    function signIn(opts) {
      opts = opts || {};
      var how = opts.how === 'google' ? 'google' : 'x';
      if (pending) {
        // a click on a sign-in already on its way: the same one. Its window again, if the player closed it
        var q = pending;
        if (q.begun) leave(q, how, opts.link === true);
        else if (q.req && !(q.popup && !q.popup.closed)) {
          q.how = how;
          q.popup = openWindow(address(q.req, how) || q.req.url);
          if (q.popup) hidePanel();
          else if (!panel) showPanel(q);
        }
        return q.promise;
      }
      var p = { promise: null, resolve: null, timer: null, popup: null, req: null, how: how, flight: false };
      p.promise = new Promise(function (resolve) {
        p.resolve = resolve;
      });
      pending = p;
      if (leaves(opts)) {
        leave(p, how, opts.link === true);
        return p.promise;
      }
      if (host.ask) {
        // xcore dev: the dev host signs this tab's player in, with no window
        host.ask(opts).then(
          function (s) {
            if (pending !== p) return;
            if (!s || typeof s.token !== 'string' || !s.token) return endSignIn(p, null);
            finish(p, s);
          },
          function () {
            endSignIn(p, null);
          },
        );
        return p.promise;
      }
      if (!slug) {
        endSignIn(p, null);
        return p.promise;
      }
      var spare = keptPart('r');
      if (spare && spare.expires > Date.now() + 60e3 && typeof spare.id === 'string' && address(spare, how)) {
        // asked for a moment ago and not answered (the player closed its window or the panel, or left the page): the
        // same request, and its page opens at this click
        p.req = spare;
        p.popup = openWindow(address(spare, how));
        show(p, true);
        poll(p, 0);
        return p.promise;
      }
      if (spare) keep('r', null);
      // the window opens at the click (one opened after an await is blocked), then goes to the request's page
      p.popup = openWindow(site + '/go');
      post('/player/v1/request', { slug: slug, with: how }).then(function (r) {
        if (pending !== p) return; // signed out before xgames.fun answered
        if (!r.ok || !r.data || !r.data.id) return endSignIn(p, null);
        var d = r.data;
        p.req = { id: d.id, secret: d.secret, expires: d.expires, code: d.code, site: d.site, url: d.url };
        keep('r', p.req);
        show(p);
        poll(p);
      });
      return p.promise;
    }
    function signOut() {
      var was = mineNow();
      if (pending) endSignIn(pending, null);
      host.code(null);
      keep('r', null);
      keep('b', null);
      drop();
      if (!was) return;
      // it sticks: nothing signs this game in by itself in this browser until the player taps Sign in again. This
      // browser stops asking, and xgames.fun is told (forget): it then names nobody to this game here
      host.mark('out');
      if (asks)
        post(site + '/api/player/v1/session/forget', host.tab ? { slug: slug || '', tab: host.tab } : { slug: slug }, {
          credentials: 'include',
          keepalive: true,
        });
    }

    // Back in view (from another tab, from an app), or shown again from the browser's back-forward cache. A sign-in
    // answered meanwhile lands now, not at the next look; a sign-out made in another tab of this game counts here
    // too; a token whose renewal slept past its time (a closed laptop) is renewed. And xgames.fun is asked, once for
    // this return and never within ASK_GAP_MS of the last time (nor more than may() allows), when a sign-in is known
    // to be on its way: one that took this tab to X (a phone may hand it to X's app, which answers in another browser:
    // asked about BEGUN_ASKS times at most, for BEGUN_MS after the tap), or one made in another tab of this game
    // (asked until xgames.fun says nobody is signed in, which ends it). Never on a timer, and nothing here reloads or
    // moves the page.
    function again() {
      if (pending && pending.req) poll(pending, 0);
      if (mineNow()) {
        if (host.mark() === 'out') return drop();
        var left = host.state().expires - Date.now();
        if (asks ? left < RENEW_MS : left <= 0) (asks ? renew : drop)();
        return;
      }
      if (host.state().token || !asks || Date.now() - asked < ASK_GAP_MS) return;
      var b = begun();
      if (!b && host.mark() !== 'in') return;
      resume(!!b).then(function (s) {
        if (s) return;
        if (s === false && !b && host.mark() === 'in') host.mark(null);
        // the player is back and nobody is signed in: the click that went to X has its answer (a login X's app
        // finishes later is still found, the next time the player is back)
        if (pending && pending.begun) endSignIn(pending, null);
      });
    }
    if (doc && typeof doc.addEventListener === 'function')
      doc.addEventListener('visibilitychange', function () {
        if (doc.visibilityState === 'visible') again();
      });
    if (typeof globalThis.addEventListener === 'function')
      globalThis.addEventListener('pageshow', function (e) {
        if (e && e.persisted) again();
      });

    return {
      version: VERSION,
      start: start,
      signIn: signIn,
      signOut: signOut,
      link: link,
      refresh: refresh,
      hold: hold,
    };
  }
  /* signin-client:end */

  // ---- which sign-in client runs: xgames.fun's newest, or the copy carried above --------------------------------
  // One request as the page loads, to this page's own host and nowhere else: GET SIGNIN_URL, on a host that serves
  // this one game (the game's link, its own domain, `xcore dev`, which answers it). The answer is a module that
  // exports `v` (the version of `host` above that it takes) and, by default, the same function as `signin` above. When
  // it comes in time with `v: 1` it is the client that runs; in every other case (no such address; an answer that is
  // not a module, or one for another version, or one that fails; a click before it came) the copy carried above runs,
  // and the game behaves the same. The choice is made once a page: a client is never changed under a sign-in. A change
  // that needs another `host` is served at another address (…/v2.js), so this one keeps its meaning.
  var SIGNIN_URL = '/platform/v1/signin/v1.js';
  var LOAD_MS = 1000; // waited this long for xgames.fun's client before the carried one starts
  var READY_MS = 1500; // gf.ready waits this long, at most, for a sign-in the page expects
  var driver = null,
    driverFns = [],
    hostMade = null;
  // may the client draw its own panel when no window opens: off with globalThis.GAMESFUN_SIGNIN_PANEL = false before
  // this file, or data-signin-panel="off" on its <script> (the game then shows the code itself, from gf.onCode)
  var script = globalThis.document && document.currentScript;
  var attr = function (name) {
    return script && script.getAttribute ? script.getAttribute(name) : null;
  };
  var panelOn = globalThis.GAMESFUN_SIGNIN_PANEL !== false && attr('data-signin-panel') !== 'off';
  // must a sign-in never leave the page (on the game's own link a sign-in takes the tab to X and back, and the game
  // starts again): globalThis.GAMESFUN_SIGNIN_STAY = true before this file, or data-signin-stay on its <script>; one
  // call alone with gf.signIn({stay: true}). The sign-in then opens a window on xgames.fun instead
  var stayOn = globalThis.GAMESFUN_SIGNIN_STAY === true || attr('data-signin-stay') !== null;
  function where() {
    return dev ? 'dev' : pathSlug ? 'path' : edge ? 'edge' : site ? 'domain' : null;
  }
  function hostNow() {
    if (hostMade) return hostMade;
    var w = where();
    // a host that serves this one game: only there is anything kept (where games share an origin, another game's page
    // could read it)
    var own = w === 'edge' || w === 'domain' || w === 'dev';
    hostMade = {
      v: 1,
      slug: slug,
      site: studio(),
      where: w,
      framed: !!framed,
      panel: panelOn,
      stay: stayOn,
      returned: returned,
      back: function () {
        return noFragment(loc.href);
      },
      tab: dev ? devId() : null,
      ask: dev ? devAsk : null,
      state: function () {
        return { player: gf.player, token: gf.token, expires: gf.expires };
      },
      set: setPlayer,
      code: function (value) {
        gf.code = value || null;
        if (value) emit(codeFns, gf.code);
      },
      mark: function (value) {
        if (!own) return null;
        // xcore dev: each tab is its own player, so what a tab did is the tab's own
        var v = dev ? tabStore('signed', value) : store('signed', value);
        return v === 'in' || v === 'out' ? v : null;
      },
      kept: function (value) {
        return own ? tabStore('signin', value) : null;
      },
    };
    return hostMade;
  }
  function use(make) {
    if (driver) return driver;
    var h = hostNow(),
      d = null;
    if (make) {
      try {
        d = make(h);
      } catch {
        d = null;
      }
      if (!d || typeof d.start !== 'function' || typeof d.signIn !== 'function' || typeof d.signOut !== 'function')
        d = null;
    }
    driver = d || signin(h);
    /** Which sign-in client this page runs: its version, and whether its host served it (else the copy carried here). */
    gf.signInClient = { version: String(driver.version || ''), shared: !!d };
    var fns = driverFns;
    driverFns = [];
    for (var i = 0; i < fns.length; i++) fns[i](driver);
    return driver;
  }
  function load() {
    var w = where();
    if (driver) return;
    // asked only of a host of this game's own; where games share a host nothing is loaded from it
    if (!(w === 'edge' || w === 'domain' || w === 'dev')) return void use();
    setTimeout(function () {
      use();
    }, LOAD_MS);
    import(loc.origin + SIGNIN_URL).then(
      function (m) {
        use(m && m.v === 1 && typeof m.default === 'function' ? m.default : null);
      },
      function () {
        use();
      },
    );
  }
  // This page signs in by itself. gf.ready waits, READY_MS at most, for what the page expects to find: a sign-in this
  // tab kept or began, the player signed in here last time, or (the top window of the game's own link, unless the
  // player signed out here) xgames.fun's answer to the question asked as the page loads, so a player it names is there
  // when gf.ready answers. Elsewhere a first visit waits for nothing; a sign-in found later comes by gf.onChange.
  function own() {
    if (!dev && !slug) return readyResolve(gf.player); // no game of xgames.fun's here
    var h = hostNow();
    load();
    var asking = (h.where === 'edge' || h.where === 'dev') && !h.framed && h.mark() !== 'out';
    if (!asking && h.mark() !== 'in' && !h.kept()) readyResolve(gf.player);
    else
      setTimeout(function () {
        readyResolve(gf.player);
      }, READY_MS);
    var done = function () {
      readyResolve(gf.player);
    };
    var go = function (d) {
      Promise.resolve()
        .then(function () {
          return d.start();
        })
        .then(done, done);
    };
    if (driver) go(driver);
    else driverFns.push(go);
  }

  /**
   * The player's sign-in. From a click (a window may open). → player | null. `prompt: false` opens nothing and only
   * takes a sign-in the page already has. `how`: 'x' (default) or 'google' ('wallet', from before, signs in with X: a
   * wallet signs nobody in now; the player links one on xgames.fun's account page); signIn('google') is the same as
   * signIn({how: 'google'}).
   * On the game's own link (the top window), the tap takes this tab to X (or Google) and back, on a phone and a
   * computer alike, and the game starts again with the player signed in (gf.ready answers with them): call it inside
   * the tap, with no await before it. Nothing the game held in memory is kept, so a game that must not start again
   * passes `stay: true` and gets the window instead. When that sign-in comes back with nobody signed in,
   * gf.signInEnded says 'cancelled' or 'failed'. Framed by a page that is not xgames.fun's play page (a post on X, a
   * site that embeds the game), where the tab cannot be moved: the window on xgames.fun, as before.
   */
  gf.signIn = function (opts) {
    if (typeof opts === 'string') opts = { how: opts };
    opts = opts || {};
    var how = opts.how === 'google' ? 'google' : 'x';
    if (gf.token && gf.expires > Date.now() + 60e3) return Promise.resolve(gf.player);
    if (local) {
      if (opts.prompt === false) return Promise.resolve(gf.player);
      store('signedIn', true);
      setPlayer(LOCAL_PLAYER, 'local', 0);
      return Promise.resolve(gf.player);
    }
    if (opts.prompt === false)
      return gf.ready.then(function () {
        return gf.player;
      });
    if (above && aboveAuth) {
      return new Promise(function (resolve) {
        var end = setTimeout(function () {
          resolve(gf.player);
        }, 300e3);
        var wait = function (a) {
          if (gf.token || (a && a.status === 'error')) {
            clearTimeout(end);
            resolve(gf.player);
          } else waiters.push(wait); // an answer without a token yet (the page is still signing)
        };
        waiters.push(wait);
        above.postMessage({ type: 'gf:auth-signin', with: how }, '*');
      });
    }
    if (!dev && !slug) return Promise.resolve(null); // no game of xgames.fun's here: nobody to sign in to
    // a click cannot wait for xgames.fun's client: the one carried here answers it if none was chosen yet
    return use().signIn(opts);
  };
  /**
   * For a game that draws its own "Sign in with X" (or Google) button as a link: the address its <a href> goes to,
   * where a sign-in takes this tab to X and back (the top window of the game's own link, a game that did not ask to
   * stay); '' everywhere else, where the button calls gf.signIn() from its click instead. `how`: 'x' (default) or
   * 'google', or {how, stay}. The link's own click calls gf.signIn({how, link: true}), which moves nothing (the tap on
   * the link does) and answers as signIn does: it marks the sign-in as the player's own, so the page is signed in
   * when the tab comes back even after a Sign out here. Never with rel="noreferrer": xgames.fun goes straight on to X
   * only for a move the browser shows came from the player's tap on the game's page.
   */
  gf.signInLink = function (opts) {
    if (typeof opts === 'string') opts = { how: opts };
    opts = opts || {};
    if (local || above || (!dev && !slug)) return '';
    var d = use();
    return typeof d.link === 'function' ? String(d.link(opts) || '') : '';
  };
  gf.signOut = function () {
    gf.code = null;
    if (local) store('signedIn', null);
    if (above && aboveAuth) above.postMessage({ type: 'gf:auth-signout' }, '*');
    if (driver) driver.signOut();
    setPlayer(null, '', 0);
    return Promise.resolve(null);
  };
  // the page's own start, once everything above is in place
  if (discover) discover.then(start);
  else start();

  // ---- live: what the game's owner sets on xgames.fun/console (the Live tab), with no republish ----
  // GET /platform/v1/live, answered by the play edge itself from one cached record a game: {announcement: {id, text,
  // level: 'info'|'warning', startsAt, endsAt} | null, config: {…}, version, maintenance: {message, since} | null}. The
  // config is the owner's JSON object (8 KB); while maintenance is on, players who open the game get xgames.fun's
  // holding page instead, and the game's api/ and saves and scores answer code 'maintenance'. A change reaches players
  // within about 35 seconds. On this machine (localhost, xcore check) nothing is live; `xcore dev` answers from the
  // game's .gamesfun/live.json; where there is no such route (an older host) nothing is live and nothing is asked again.
  //   A small banner shows the announcement (each one until the player closes it), and a pause that starts while the
  //   game is open. Off: globalThis.GAMESFUN_LIVE_BANNER = false before this file, data-live-banner="off" on its
  //   <script>, or gf.live.banner(false) before the page has loaded.
  var LIVE_EMPTY = { announcement: null, config: {}, version: 0, maintenance: null };
  var LIVE_POLL_MS = 60000; // asked again this often while gf.live.onChange has a listener (and the page is in view)
  var LIVE_BANNER_MS = 300000; // and this often for the banner alone
  var liveValue = null,
    liveAt = 0,
    liveFlight = null,
    liveFns = [],
    liveGone = false,
    liveTimer = null,
    banner = null,
    bannerKey = '',
    bannerEnd = null;
  var me = globalThis.document && document.currentScript;
  var bannerOn =
    globalThis.GAMESFUN_LIVE_BANNER !== false &&
    !(me && me.getAttribute && me.getAttribute('data-live-banner') === 'off');
  var num = function (v) {
    return typeof v === 'number' && isFinite(v) && v > 0 ? v : null;
  };
  /** An answer → what a game gets: an announcement only inside its window (by this clock too), a plain-object config. */
  function liveClean(d) {
    if (!d || typeof d !== 'object') return LIVE_EMPTY;
    var now = Date.now();
    var a = d.announcement;
    a =
      a && typeof a === 'object' && typeof a.text === 'string' && a.text
        ? {
            id: String(a.id || 'a'),
            text: a.text,
            level: a.level === 'warning' ? 'warning' : 'info',
            startsAt: num(a.startsAt),
            endsAt: num(a.endsAt),
          }
        : null;
    if (a && ((a.startsAt && a.startsAt > now) || (a.endsAt && a.endsAt <= now))) a = null;
    var m = d.maintenance;
    return {
      announcement: a,
      config: d.config && typeof d.config === 'object' && !Array.isArray(d.config) ? d.config : {},
      version: num(d.version) || 0,
      maintenance: m && typeof m === 'object' ? { message: String(m.message || ''), since: num(m.since) } : null,
    };
  }
  function setLive(v) {
    var before = liveValue ? JSON.stringify(liveValue) : '';
    liveValue = v;
    gf.live.value = v;
    if (JSON.stringify(v) !== before) {
      emit(liveFns, v);
      renderBanner();
    }
  }
  function liveRefresh() {
    if (local) {
      setLive(LIVE_EMPTY);
      return ok(LIVE_EMPTY);
    }
    if (liveFlight) return liveFlight;
    liveFlight = call(PLATFORM + 'live', { method: 'GET' }, "the game's live settings").then(function (r) {
      liveFlight = null;
      liveAt = Date.now();
      if (r.data) {
        setLive(liveClean(r.data));
        return { data: liveValue, error: null, status: r.status };
      }
      // no such route here (an older host): nothing is live, and nothing is asked again
      if (r.status === 404) {
        liveGone = true;
        setLive(LIVE_EMPTY);
        return { data: liveValue, error: null, status: 404 };
      }
      // not reachable now: what was known stays
      return withCode({ data: liveValue || LIVE_EMPTY, error: r.error, status: r.status }, r);
    });
    return liveFlight;
  }
  function liveMaintenance(d) {
    var v = liveValue || LIVE_EMPTY;
    if (v.maintenance) return;
    setLive({
      announcement: v.announcement,
      config: v.config,
      version: v.version,
      maintenance: { message: String(d.why || ''), since: num(d.since) },
    });
  }
  function livePoll() {
    if (liveTimer || liveGone || local || typeof setInterval !== 'function') return;
    liveTimer = setInterval(function () {
      if (liveGone) {
        clearInterval(liveTimer);
        liveTimer = null;
        return;
      }
      if (globalThis.document && document.visibilityState === 'hidden') return;
      var every = liveFns.length ? LIVE_POLL_MS : bannerOn ? LIVE_BANNER_MS : 0;
      if (every && Date.now() - liveAt >= every) liveRefresh();
    }, 15000);
  }
  // the banner: one line at the top, above the game, closable; text only (never HTML)
  function renderBanner() {
    var doc = globalThis.document;
    if (!doc || typeof doc.createElement !== 'function') return;
    if (!doc.body) {
      doc.addEventListener('DOMContentLoaded', renderBanner, { once: true });
      return;
    }
    var v = liveValue,
      show = null;
    if (bannerOn && v && v.maintenance)
      show = {
        key: 'm' + (v.maintenance.since || ''),
        text: v.maintenance.message || 'This game is paused for maintenance.',
        level: 'warning',
      };
    else if (bannerOn && v && v.announcement)
      show = { key: v.announcement.id, text: v.announcement.text, level: v.announcement.level };
    if (show && store('live-closed') === show.key) show = null;
    clearTimeout(bannerEnd);
    if (!show) {
      if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
      banner = null;
      return;
    }
    // an announcement that ends while the game is open goes when it ends
    var ends = !v.maintenance && v.announcement.endsAt;
    if (ends)
      bannerEnd = setTimeout(
        function () {
          setLive(liveClean(liveValue));
        },
        Math.min(Math.max(ends - Date.now(), 0), 2147483647),
      );
    if (!banner) {
      banner = doc.createElement('div');
      banner.setAttribute('data-gamesfun', 'live');
      var root = banner.attachShadow ? banner.attachShadow({ mode: 'open' }) : banner;
      root.innerHTML =
        '<div role="status" aria-live="polite" style="position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
        'box-sizing:border-box;max-width:min(640px,calc(100vw - 16px));display:flex;align-items:flex-start;gap:10px;padding:8px 10px 8px 14px;' +
        'border-radius:10px;font:14px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35);pointer-events:auto">' +
        '<span style="white-space:pre-wrap;overflow-wrap:anywhere"></span>' +
        '<button type="button" aria-label="Close" style="all:unset;cursor:pointer;padding:0 4px;font-size:18px;line-height:1;opacity:.75">×</button></div>';
      root.querySelector('button').addEventListener('click', function () {
        store('live-closed', bannerKey);
        renderBanner();
      });
      doc.body.appendChild(banner);
    }
    var root2 = banner.shadowRoot || banner;
    var box = root2.querySelector('[role=status]');
    box.style.background = show.level === 'warning' ? '#4a3510' : '#1d1d26';
    box.style.color = show.level === 'warning' ? '#ffe6b0' : '#e8e8f0';
    box.style.border = '1px solid ' + (show.level === 'warning' ? '#a8761c' : '#3a3a4a');
    root2.querySelector('span').textContent = show.text;
    bannerKey = show.key;
  }
  gf.live = {
    /** The last answer (null until one came). */
    value: null,
    /** → {data: {announcement, config, version, maintenance}}: what is known if it is under a minute old, else asked. */
    get: function () {
      if (liveValue && (liveGone || local || Date.now() - liveAt < LIVE_POLL_MS) && !liveFlight) return ok(liveValue);
      return liveRefresh();
    },
    /** Asks now. → as get */
    refresh: liveRefresh,
    /** fn(live) on every change; while any listener is there it is asked every minute (the page in view). → unsubscribe */
    onChange: function (fn) {
      if (typeof fn === 'function') liveFns.push(fn);
      livePoll();
      if (!liveAt && !liveFlight) liveRefresh();
      return function () {
        liveFns = liveFns.filter(function (f) {
          return f !== fn;
        });
      };
    },
    /** The default banner on (true) or off (false): a game that shows the announcement its own way turns it off. */
    banner: function (on) {
      bannerOn = on !== false;
      renderBanner();
      if (bannerOn && !local) {
        livePoll();
        if (!liveAt && !liveFlight) liveRefresh();
      }
    },
  };
  // the banner's first look once the page has loaded (so a game's own scripts can turn it off first), then every 5 min
  if (!local && globalThis.document && typeof document.addEventListener === 'function') {
    var liveStart = function () {
      setTimeout(function () {
        if (bannerOn && !liveAt && !liveFlight) liveRefresh();
        if (bannerOn) livePoll();
      }, 0);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', liveStart, { once: true });
    else liveStart();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible' || liveGone || !(liveFns.length || bannerOn)) return;
      if (liveAt && Date.now() - liveAt >= LIVE_POLL_MS) liveRefresh();
    });
  }

  // ---- full screen, from a click: a post on X and a phone show the game in a small frame first ----
  // Inside xgames.fun's play page the page around the game goes full screen (gf:fullscreen), or fills the screen where the
  // browser has no full screen (an app's own browser: X's, Phantom's); a click in the game lets that page ask. Anywhere
  // else the browser's own full screen; framed where that is not allowed (another site's frame, a post on X), the game's
  // own link in a tab of its own. An iPhone's Safari has no full screen for a page: {on: false, how: 'none'}, the game
  // plays as it is (its button can say "Add to Home Screen" there).
  var fullFns = [];
  gf.isFullscreen = false;
  function setFull(on) {
    if (gf.isFullscreen === on) return;
    gf.isFullscreen = on;
    emit(fullFns, on);
  }
  gf.onFullscreen = function (fn) {
    if (typeof fn === 'function') fullFns.push(fn);
    return function () {
      fullFns = fullFns.filter(function (f) {
        return f !== fn;
      });
    };
  };
  var doc = globalThis.document;
  function nativeFull() {
    return !!doc && !!(doc.fullscreenElement || doc.webkitFullscreenElement);
  }
  if (doc && doc.addEventListener)
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) {
      doc.addEventListener(ev, function () {
        setFull(nativeFull());
      });
    });
  /** on: true (in), false (out), or left out (the other way). → {data: {on, how: 'page'|'browser'|'tab'|'none'}} */
  gf.fullscreen = function (on) {
    var want = on === undefined ? !gf.isFullscreen : !!on;
    if (above) {
      // the play page answers gf:fullscreen-state; it tells only a change, so a refusal there leaves it as it was
      try {
        above.postMessage({ type: 'gf:fullscreen', v: 1, on: want }, '*');
      } catch {
        /* gone */
      }
      return new Promise(function (resolve) {
        var off,
          timer = setTimeout(function () {
            off();
            resolve(ok({ on: gf.isFullscreen, how: 'page' }));
          }, 1500);
        off = gf.onFullscreen(function (now) {
          clearTimeout(timer);
          off();
          resolve(ok({ on: now, how: 'page' }));
        });
      });
    }
    var el = doc && doc.documentElement;
    if (!want) {
      var exit = doc && (doc.exitFullscreen || doc.webkitExitFullscreen);
      if (exit && nativeFull())
        return Promise.resolve(exit.call(doc)).then(
          function () {
            return ok({ on: false, how: 'browser' });
          },
          function () {
            return ok({ on: nativeFull(), how: 'browser' });
          },
        );
      return Promise.resolve(ok({ on: false, how: 'none' }));
    }
    var req = el && (el.requestFullscreen || el.webkitRequestFullscreen);
    var allowed = doc && doc.fullscreenEnabled !== false && doc.webkitFullscreenEnabled !== false;
    var tab = function () {
      // framed by a page that allows no full screen (a post on X): the game's own link, where it can
      // (noopener: open answers null either way, so 'tab' says it was asked for, not that a popup blocker let it)
      if (!framed || !globalThis.open) return ok({ on: false, how: 'none' });
      try {
        globalThis.open(loc.href, '_blank', 'noopener');
      } catch {
        return ok({ on: false, how: 'none' });
      }
      return ok({ on: false, how: 'tab' });
    };
    if (!req || !allowed) return Promise.resolve(tab());
    return Promise.resolve()
      .then(function () {
        return req.call(el);
      })
      .then(
        function () {
          setFull(nativeFull());
          return ok({ on: nativeFull(), how: 'browser' });
        },
        function () {
          return tab();
        },
      );
  };

  // ---- a wallet app, for a player in a browser with no wallet (X's own browser, a post opened in X's app) ----
  // Two places a game can be when a player taps its Claim button with no wallet in the browser:
  // - inside xgames.fun's play page: the page can open the game's page in a wallet app's browser (Phantom or Solflare),
  //   or in the person's own browser, signed in. It says whether it will in gf:host (openWallet: true when this browser
  //   has no wallet and it opens one when asked; false when it will not; not said by an older page), and again when that
  //   changes (a wallet can show up a moment after the page loads). The game tells it a Claim button is showing
  //   (gf:wallet-need, once a page load) so the later tap opens the app at once, and asks from the tap (gf:open-wallet).
  //   The page answers neither: it opens the app, or shows its own sheet with the links;
  // - on its own host, the top window (a post's card on X opens <slug>-play.<site>/ by itself): this tab goes to
  //   <site>/wallet/open?slug=<slug>&app=<app>&back=<this page>, the same site and game its own sign-in uses (studio(),
  //   slug), and that page opens the wallet app (or shows its links); the wallet's browser comes back to `back` signed
  //   in. Whether a wallet is here is what loot's page client finds (gf/loot/wallets.js, as gf.loot.ready() asks it).
  // Framed by anything else (X's timeline frames the game inside its own site, another site embeds it) nothing opens:
  // a frame cannot move the tab, so the game shows its own fallback (its link to copy, for example).
  var walletOffer = null,
    walletFns = [],
    walletWanted = false,
    walletTold = false,
    walletLooked = false;
  var WALLET_APPS = ['phantom', 'solflare', 'browser'];
  var WALLET_SETTLE_MS = 400; // as gf.loot.ready() waits for wallets to announce themselves
  var WALLET_LATE_MS = 1500; // and once more after this: a wallet can register up to about this long after load
  function setWalletOffer(v) {
    if (walletOffer === v) return;
    walletOffer = v;
    emit(walletFns, v);
  }
  function tellWalletNeed() {
    if (walletTold || !above) return;
    try {
      above.postMessage({ type: 'gf:wallet-need', v: 1 }, '*');
      walletTold = true;
    } catch {
      /* gone */
    }
  }
  function walletNo(code, why) {
    return Promise.resolve({ data: null, error: why, status: 0, code: code });
  }
  /** The top window on the game's own host, with no page above: where this tab can go to xgames.fun itself. */
  function ownHost() {
    return !framed && !local && !dev && !!slug && /^https?:$/.test(loc.protocol);
  }
  /** An address without its fragment. */
  function noFragment(u) {
    var i = u.indexOf('#');
    return i < 0 ? u : u.slice(0, i);
  }
  /** `href` when it is an address of this game on this same host (its own folder under /p/<slug>/), else null. */
  function ownAddress(href) {
    try {
      var u = new URL(href, loc.href);
      if (u.origin !== loc.origin) return null;
      if (pathSlug && u.pathname.indexOf('/p/' + pathSlug + '/') !== 0) return null;
      return noFragment(u.href);
    } catch {
      return null;
    }
  }
  // on its own host: is a wallet in this browser? (once, from the first wallet call; null until it has settled)
  function lookForWallet() {
    if (walletLooked || !ownHost()) return;
    walletLooked = true;
    var mod;
    try {
      mod = import(new URL('gf/loot/wallets.js', root).href);
    } catch {
      return;
    }
    Promise.resolve(mod)
      .then(function (m) {
        var look = function (ms) {
          return m.solanaWallets({ waitMs: ms }).then(function (found) {
            setWalletOffer(!(found && found.length));
          });
        };
        return look(WALLET_SETTLE_MS).then(function () {
          if (walletOffer === true && typeof setTimeout === 'function')
            setTimeout(function () {
              look(0).catch(function () {});
            }, WALLET_LATE_MS - WALLET_SETTLE_MS);
        });
      })
      .catch(function () {
        /* no loot page client here (gf/loot/): not known */
      });
  }
  /**
   * Can this game be opened in a wallet app's browser? → true: no wallet in this browser, and xgames.fun's play page
   * opens one when asked, or (on the game's own host) xgames.fun's wallet page will; false: it will not (a wallet is
   * here, or this is a developer's browser); null: not known (framed by something other than the play page, an older
   * play page, or on its own host before the look for a wallet has settled or without gf/loot/).
   */
  gf.canOpenWallet = function () {
    lookForWallet();
    return walletOffer;
  };
  /** fn(true | false | null) when canOpenWallet() changes. → unsubscribe */
  gf.onCanOpenWallet = function (fn) {
    if (typeof fn === 'function') walletFns.push(fn);
    gf.ready.then(lookForWallet);
    return function () {
      walletFns = walletFns.filter(function (f) {
        return f !== fn;
      });
    };
  };
  /**
   * The game is showing something that will need a wallet (a Claim button): xgames.fun's play page gets ready, so the
   * later tap opens the wallet app at once. Safe to call every time the button shows: the page is told once a page load
   * (and as soon as it answers, when it has not yet). → {data: {told: true}}; on the game's own host, where there is
   * nobody to tell, {data: {told: false}} (and it starts the look for a wallet); framed by anything else, code
   * 'no-page' (nothing is sent).
   */
  gf.walletNeeded = function () {
    walletWanted = true;
    tellWalletNeed();
    return gf.ready.then(function () {
      if (above) return ok({ told: true });
      if (ownHost()) {
        lookForWallet();
        return ok({ told: false });
      }
      return walletNo('no-page', 'No xgames.fun play page around this game: nothing to get ready.');
    });
  };
  /**
   * Open this game in a wallet app's browser, signed in: app 'phantom' (default), 'solflare', or 'browser' (the
   * person's own). Call it from inside the player's tap, never after an await or a timer: the message (or, on its own
   * host, the tab's move) goes at once, in this call, and a browser opens an app only from a tap.
   * Inside xgames.fun's play page: `view` left out, the play page as it is; 'claim' with `href`, an address of this
   * game's own play page on xgames.fun (https://xgames.fun/play/<name>?…); 'wallet', xgames.fun's page that adds a
   * wallet. → {data: {asked: true}} (the page answers nothing more), or code 'not-offered' when canOpenWallet() is not
   * true there.
   * On the game's own host (the top window): this tab goes to xgames.fun's wallet page, which comes back to this page
   * (or to `href` with 'claim', when it is an address on this same host). → {data: {asked: true, left: true}}: the page
   * is leaving.
   * Errors, with nothing opened: code 'invalid' (a bad argument), 'no-page' (framed by something other than the play
   * page: a frame cannot move the tab). The game then shows its own fallback.
   */
  gf.openWallet = function (app, opts) {
    if (app === undefined) app = 'phantom';
    if (WALLET_APPS.indexOf(app) < 0)
      return walletNo('invalid', "app is 'phantom', 'solflare' or 'browser', not " + JSON.stringify(app) + '.');
    if (opts !== undefined && (opts === null || typeof opts !== 'object'))
      return walletNo('invalid', 'The options are an object: {view, href}.');
    var view = opts ? opts.view : undefined,
      href = opts ? opts.href : undefined;
    if (view !== undefined && view !== 'claim' && view !== 'wallet')
      return walletNo('invalid', "view is 'claim' or 'wallet', or left out.");
    if (href !== undefined && view !== 'claim') return walletNo('invalid', "href goes only with view 'claim'.");
    if (view === 'claim' && (typeof href !== 'string' || !href))
      return walletNo('invalid', "view 'claim' needs href: an address of this game's own play page on xgames.fun.");
    if (!above && ownHost()) {
      var back = (view === 'claim' && ownAddress(href)) || noFragment(loc.href);
      var to =
        studio() +
        '/wallet/open?slug=' +
        encodeURIComponent(slug) +
        '&app=' +
        encodeURIComponent(app) +
        '&back=' +
        encodeURIComponent(back);
      try {
        loc.assign(to);
      } catch {
        return walletNo('no-page', "This tab could not go to xgames.fun's wallet page.");
      }
      return ok({ asked: true, left: true });
    }
    if (!above) return walletNo('no-page', 'No xgames.fun play page around this game to open a wallet app.');
    if (walletOffer !== true)
      return walletNo('not-offered', 'The page around this game does not open a wallet app here.');
    var msg = { type: 'gf:open-wallet', v: 1, app: app };
    if (view !== undefined) msg.view = view;
    if (href !== undefined) msg.href = href;
    try {
      above.postMessage(msg, '*');
    } catch {
      return walletNo('no-page', 'The page around this game is gone.');
    }
    return ok({ asked: true });
  };

  // ---- saves: this player's own, any JSON value (64 KB each, 16 a player) ----
  function seg(s) {
    return SEG.test(String(s)) ? encodeURIComponent(s) : null;
  }
  gf.saves = {
    /** → {data: the value, or null} */
    get: function (key) {
      if (!seg(key)) return bad('save key');
      if (local) return ok(store('save:' + key));
      if (!gf.token) return signedOut();
      return json('GET', PLATFORM + 'saves/' + seg(key), undefined, 'reading the save').then(function (r) {
        return withCode(
          { data: r.data ? r.data.value : null, error: r.status === 404 ? null : r.error, status: r.status },
          r.status === 404 ? {} : r,
        );
      });
    },
    put: function (key, value) {
      if (!seg(key)) return bad('save key');
      if (local) {
        var keys = store('saves') || [];
        if (keys.indexOf(key) < 0) store('saves', keys.concat([key]));
        store('save:' + key, value);
        return ok({ ok: true });
      }
      if (!gf.token) return signedOut();
      return json('PUT', PLATFORM + 'saves/' + seg(key), { value: value }, 'saving');
    },
    delete: function (key) {
      if (!seg(key)) return bad('save key');
      if (local) {
        store(
          'saves',
          (store('saves') || []).filter(function (k) {
            return k !== key;
          }),
        );
        store('save:' + key, null);
        return ok({ ok: true, deleted: true });
      }
      if (!gf.token) return signedOut();
      return json('DELETE', PLATFORM + 'saves/' + seg(key), undefined, 'removing the save');
    },
    /** → {data: [{key, bytes, updatedAt}]} */
    list: function () {
      if (local)
        return ok(
          (store('saves') || []).map(function (k) {
            return { key: k };
          }),
        );
      if (!gf.token) return signedOut();
      return json('GET', PLATFORM + 'saves', undefined, 'listing the saves').then(function (r) {
        return pick(r, function (d) {
          return d.keys;
        });
      });
    },
  };

  // ---- leaderboards ----
  gf.scores = {
    /** → {data: {improved, best, rank}}. order: 'high' (default) or 'low' (a time) */
    submit: function (board, score, opts) {
      opts = opts || {};
      if (!seg(board)) return bad('board name');
      if (local) {
        var list = store('board:' + board) || [];
        var low = opts.order === 'low';
        var mine = list.filter(function (e) {
          return e.player === LOCAL_PLAYER.id;
        })[0];
        var improved = !mine || (low ? score < mine.score : score > mine.score);
        if (improved) {
          list = list.filter(function (e) {
            return e.player !== LOCAL_PLAYER.id;
          });
          list.push({ player: LOCAL_PLAYER.id, name: opts.name || LOCAL_PLAYER.name, score: score, at: Date.now() });
          list.sort(function (a, b) {
            return low ? a.score - b.score : b.score - a.score;
          });
          store('board:' + board, list);
        }
        return ok({ improved: improved, best: improved ? score : mine.score, rank: 1 });
      }
      if (!gf.token) return signedOut();
      var body = { score: score };
      if (opts.name) body.name = opts.name;
      if (opts.order) body.order = opts.order;
      return json('POST', PLATFORM + 'scores/' + seg(board), body, 'submitting the score');
    },
    /**
     * → {data: [{rank, player, name, score, at, me?}]}: `player` is an id of this game's own (never the account), `me`
     * true on the signed-in player's entry. Anyone may read; signed out, the top 100 only (offset + limit past 100: 401)
     */
    top: function (board, opts) {
      opts = opts || {};
      if (!seg(board)) return bad('board name');
      var limit = Math.max(1, Math.min(100, opts.limit | 0 || 10)),
        offset = Math.max(0, opts.offset | 0);
      if (local)
        return ok(
          (store('board:' + board) || []).slice(offset, offset + limit).map(function (e, i) {
            return Object.assign({ rank: offset + i + 1 }, e);
          }),
        );
      return json(
        'GET',
        PLATFORM + 'scores/' + seg(board) + '?limit=' + limit + '&offset=' + offset,
        undefined,
        'reading the board',
      ).then(function (r) {
        return pick(r, function (d) {
          return d.entries;
        });
      });
    },
    /** This player's own entry. → {data: {rank, score, name, at} | null} */
    mine: function (board) {
      if (!seg(board)) return bad('board name');
      if (local) {
        var list = store('board:' + board) || [];
        for (var i = 0; i < list.length; i++)
          if (list[i].player === LOCAL_PLAYER.id) return ok(Object.assign({ rank: i + 1 }, list[i]));
        return ok(null);
      }
      if (!gf.token) return signedOut();
      return json('GET', PLATFORM + 'scores/' + seg(board) + '/me', undefined, 'reading your score').then(function (r) {
        return pick(r, function (d) {
          return d.entry;
        });
      });
    },
  };

  // ---- the game's own server (server/) ----
  /** The address of the game's server path p ('rooms/abc'): api/ beside the game. */
  gf.apiUrl = function (p) {
    return new URL('api/' + String(p || '').replace(/^\/+/, ''), root).href;
  };
  gf.socketUrl = function (p) {
    return gf.apiUrl(p).replace(/^http/, 'ws');
  };
  /** A call to the game's server, signed in when the player is: init as fetch's; an object body is sent as JSON. */
  gf.api = function (p, init) {
    init = init || {};
    var body = init.body;
    var headers = Object.assign({}, init.auth === false ? {} : bearer());
    if (
      body !== undefined &&
      body !== null &&
      typeof body === 'object' &&
      !(body instanceof Blob) &&
      !(body instanceof ArrayBuffer) &&
      !(body instanceof FormData)
    ) {
      body = JSON.stringify(body);
      headers['content-type'] = 'application/json';
    }
    return call(
      gf.apiUrl(p),
      Object.assign({}, init, { headers: Object.assign(headers, init.headers || {}), body: body }),
      "the game's server",
    );
  };

  // ---- the game's Solana economy (xcore loot add: xsolana.json and loot's page client in gf/loot/, beside the game) ----
  // The same calls from any engine: every answer is {data, error, status} and every value JSON-safe (big numbers as
  // strings), so Godot's and Unity's glue reach it like the rest. Pass back a listing, a claim or a collectible that
  // another call returned as it came: it is the terms the player was shown.
  //   await gf.loot.ready();         // {live, project, wallets: [names], spec}: is the economy live, which wallets
  //   await gf.loot.connect();       // {address, wallet}: the wallet asks the player (connect('Phantom') or connect(1))
  //   await gf.loot.link();          // {wallet}: the wallet signs that it is this player's, for the game's server
  //                                  // (xcore add vouchers pays only a wallet the player proved is theirs)
  //   await gf.loot.call('shop');    // any method of loot's page client: shop, buy, boxes, openBox, claims, claim,
  //                                  // collectibles, balances, stake, harvest, recipes, craft, lotteries, buyTickets,
  //                                  // claimGrant, auctions, bid, listings, buyListing, pay, … (loot's docs, play/)
  //   gf.loot.address                // the connected wallet's address, or ''
  var loot = { mods: null, spec: null, app: null, wallet: null, account: null, rpc: null };
  function lootSafe(v) {
    return JSON.parse(
      JSON.stringify(v === undefined ? null : v, function (k, x) {
        if (typeof x === 'bigint') return x.toString();
        if (x instanceof Uint8Array) return Array.prototype.slice.call(x);
        return x;
      }),
    );
  }
  function lootAnswer(work) {
    return Promise.resolve()
      .then(work)
      .then(
        function (d) {
          return { data: lootSafe(d), error: null, status: 200 };
        },
        function (e) {
          return { data: null, error: String((e && e.message) || e), status: 0 };
        },
      );
  }
  function lootLoad() {
    if (loot.mods) return Promise.resolve(loot.mods);
    var at = function (p) {
      return new URL(p, root).href;
    };
    var client = Promise.all([import(at('gf/loot/play/index.js')), import(at('gf/loot/wallets.js'))]).catch(
      function (e) {
        throw new Error(
          "The economy's page client did not load (gf/loot/: run xcore loot add): " + String((e && e.message) || e),
        );
      },
    );
    // xsolana.json; a game made before it was named so keeps loot.json (read only when there is no xsolana.json)
    var specFile = function (name) {
      return fetch(at(name), { cache: 'no-store' }).then(function (r) {
        return { name: name, r: r };
      });
    };
    var spec = specFile('xsolana.json')
      .then(function (f) {
        return f.r.status === 404 ? specFile('loot.json') : f;
      })
      .then(function (f) {
        if (f.r.status === 404) throw new Error('This game has no economy here (no xsolana.json beside it).');
        if (!f.r.ok) throw new Error(f.name + ' could not be read (' + f.r.status + ').');
        return f.r.text().then(function (t) {
          try {
            return JSON.parse(t);
          } catch {
            throw new Error(f.name + ' is not JSON: check it with xcore loot check.');
          }
        });
      });
    // the game's own RPC (xcore add rpc: server/rpc.js at api/rpc, its URL a secret of the server) when it has one;
    // else the play host's shared relay (PAGE_RPC). Asked once a page load; any other answer is the shared relay.
    var own = fetch(gf.apiUrl('rpc'), { cache: 'no-store' })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(
        function (j) {
          return j && j.gamesfun === 'rpc' && j.own === true ? gf.apiUrl('rpc') : null;
        },
        function () {
          return null;
        },
      );
    return Promise.all([client, spec, own]).then(function (m) {
      loot.spec = m[1];
      loot.rpc = m[2];
      loot.mods = { play: m[0][0], wallets: m[0][1] };
      return loot.mods;
    });
  }
  gf.loot = {
    address: '',
    /** → {live, project, wallets: [names], spec} */
    ready: function () {
      return lootAnswer(function () {
        return lootLoad().then(function (m) {
          return m.wallets.solanaWallets({ waitMs: 400 }).then(function (found) {
            var live = !!(loot.spec.live && loot.spec.live.project);
            return {
              live: live,
              project: live ? loot.spec.live.project : null,
              wallets: found.map(function (w) {
                return w.name;
              }),
              spec: loot.spec,
            };
          });
        });
      });
    },
    /** Connect a wallet: its name, or its number in ready()'s list (default the first). → {address, wallet} */
    connect: function (which) {
      return lootAnswer(function () {
        return lootLoad().then(function (m) {
          return m.wallets.solanaWallets({ waitMs: 400 }).then(function (found) {
            if (!found.length)
              throw new Error('No Solana wallet in this browser (Phantom, Solflare or Backpack, set to devnet).');
            var w =
              typeof which === 'string'
                ? found.filter(function (x) {
                    return x.name === which;
                  })[0]
                : found[Math.max(0, Math.min(found.length - 1, which | 0))];
            if (!w) throw new Error('No wallet named ' + which + ' in this browser.');
            return m.wallets.connectWallet(w).then(function (account) {
              loot.wallet = w;
              loot.account = account;
              loot.app =
                loot.spec.live && loot.spec.live.project
                  ? m.play.solanaApp({
                      spec: loot.spec,
                      rpcUrl: loot.rpc || m.wallets.PAGE_RPC,
                      wallet: m.play.walletStandardSigner(w, account),
                    })
                  : null;
              gf.loot.address = account.address;
              return { address: account.address, wallet: w.name, live: !!loot.app };
            });
          });
        });
      });
    },
    /** Prove the connected wallet is this signed-in player's, to the game's server (xcore add vouchers: api/vouchers/link). → {wallet} */
    link: function () {
      return lootAnswer(function () {
        if (!loot.wallet || !loot.account) throw new Error('Connect a wallet first (GamesFun.loot.connect()).');
        if (!gf.token) throw new Error('Sign in first: a wallet is linked to a signed-in player.');
        var f = loot.wallet.features && loot.wallet.features['solana:signMessage'];
        if (!f) throw new Error(loot.wallet.name + ' cannot sign a message, so it cannot be linked.');
        var address = loot.account.address;
        return gf.api('vouchers/link?wallet=' + encodeURIComponent(address)).then(function (r) {
          if (!r.data || !r.data.text) throw new Error(r.error || "The game's server could not start the link.");
          return f
            .signMessage({ account: loot.account, message: new TextEncoder().encode(r.data.text) })
            .then(function (out) {
              var sig = out && out[0] && out[0].signature,
                bin = '';
              for (var i = 0; sig && i < sig.length; i++) bin += String.fromCharCode(sig[i]);
              return gf.api('vouchers/link', {
                method: 'POST',
                body: { wallet: address, text: r.data.text, signature: btoa(bin) },
              });
            })
            .then(function (done) {
              if (!done.data || !done.data.ok) throw new Error(done.error || 'The wallet was not linked.');
              return { wallet: done.data.wallet };
            });
        });
      });
    },
    disconnect: function () {
      return lootAnswer(function () {
        var w = loot.wallet;
        loot.app = loot.wallet = loot.account = null;
        gf.loot.address = '';
        var f = w && w.features && w.features['standard:disconnect'];
        return f
          ? Promise.resolve(f.disconnect()).then(function () {
              return null;
            })
          : null;
      });
    },
    /** One method of loot's page client, with its arguments. → its answer */
    call: function (method) {
      var args = Array.prototype.slice.call(arguments, 1);
      return lootAnswer(function () {
        if (!loot.app)
          throw new Error(
            loot.account
              ? 'The economy is not live yet: its owner puts it live with xcore loot approve (on devnet: test SOL, nothing real).'
              : 'Connect a wallet first (GamesFun.loot.connect()).',
          );
        var own = /^[a-z][A-Za-z]*$/.test(String(method)) && Object.prototype.hasOwnProperty.call(loot.app, method);
        var fn = own ? loot.app[method] : null;
        if (typeof fn !== 'function') throw new Error('loot has no ' + method + '.');
        return fn.apply(loot.app, args);
      });
    },
  };

  // ---- the game's own database (xcore add database: server/ with a SQLite database on xgames.fun) ----
  // Documents in collections: {id, owner, value, updatedAt}. Each player has a space of their own in a collection (the
  // same id in two players' spaces is two documents); a signed-in player reads and writes their own (the rules at the
  // top of server/database.js, or gamesfun.json → database.collections, say otherwise per collection). opts.owner names
  // another space to read: 'server' (what the game's server wrote) or a player's id.
  // On this machine only the local player's space exists, in this browser's storage.
  function localDocs(c) {
    var docs = store('db2:' + c);
    if (docs) return docs;
    // an older gamesfun.js kept one id per collection here: each document moves to its owner's space
    var old = store('db:' + c) || {};
    docs = {};
    Object.keys(old).forEach(function (id) {
      docs[old[id].owner + '/' + id] = old[id];
    });
    return docs;
  }
  function newId() {
    var a = new Uint8Array(9);
    (
      globalThis.crypto || {
        getRandomValues: function (b) {
          for (var i = 0; i < b.length; i++) b[i] = (Math.random() * 256) | 0;
          return b;
        },
      }
    ).getRandomValues(a);
    return Array.prototype.map
      .call(a, function (b) {
        return ('0' + b.toString(16)).slice(-2);
      })
      .join('');
  }
  function localOwner(opts) {
    var o = opts && opts.owner;
    return !o || o === 'me' ? LOCAL_PLAYER.id : String(o);
  }
  // a list's place: the last document of a page ([updatedAt, owner, id]), handed back as it came
  function localCursor(d) {
    return btoa(JSON.stringify([d.updatedAt, d.owner, d.id]));
  }
  function localAfter(text) {
    try {
      var c = JSON.parse(atob(String(text)));
      return Array.isArray(c) && c.length === 3 ? c : null;
    } catch {
      return null;
    }
  }
  function order3(a, b) {
    var x = [a.updatedAt, a.owner, a.id],
      y = [b.updatedAt, b.owner, b.id];
    for (var i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  }
  function notYours() {
    return Promise.resolve({ data: null, error: 'A player writes only their own documents.', status: 403 });
  }
  var localDb = {
    get: function (c, id, opts) {
      return ok(localDocs(c)[localOwner(opts) + '/' + id] || null);
    },
    put: function (c, id, value, opts) {
      if (localOwner(opts) !== LOCAL_PLAYER.id) return notYours();
      var docs = localDocs(c);
      var key = LOCAL_PLAYER.id + '/' + id;
      docs[key] = { id: id, owner: LOCAL_PLAYER.id, value: value, updatedAt: Date.now() };
      store('db2:' + c, docs);
      return ok(docs[key]);
    },
    add: function (c, value) {
      return localDb.put(c, newId(), value);
    },
    list: function (c, opts) {
      opts = opts || {};
      if (noOffset(opts)) return noOffset(opts);
      var docs = localDocs(c);
      var all = Object.keys(docs).map(function (k) {
        return docs[k];
      });
      if (opts.owner)
        all = all.filter(function (d) {
          return d.owner === localOwner(opts);
        });
      var old = opts.order === 'old';
      all.sort(function (a, b) {
        return old ? order3(a, b) : order3(b, a);
      });
      if (opts.after) {
        var at = localAfter(opts.after);
        if (!at) return Promise.resolve({ data: null, error: "after is the last answer's after.", status: 400 });
        var mark = { updatedAt: at[0], owner: at[1], id: at[2] };
        all = all.filter(function (d) {
          return old ? order3(d, mark) > 0 : order3(d, mark) < 0;
        });
      }
      var n = Math.max(1, Math.min(100, opts.limit | 0 || 50));
      var page = all.slice(0, n);
      var more = all.length > n;
      return Promise.resolve({
        data: page,
        after: more ? localCursor(page[page.length - 1]) : null,
        more: more,
        error: null,
        status: 200,
      });
    },
    delete: function (c, id, opts) {
      if (localOwner(opts) !== LOCAL_PLAYER.id) return notYours();
      var docs = localDocs(c);
      var key = LOCAL_PLAYER.id + '/' + id;
      var had = !!docs[key];
      delete docs[key];
      store('db2:' + c, docs);
      return ok({ deleted: had });
    },
  };
  function useLocalDb() {
    return local;
  }
  var ownerSaid = {};
  // offset paging is gone (each player has a space of their own, and a page follows the last one's place): a real
  // offset is refused, so code that pages with it stops at once instead of reading its first page again and again;
  // 0 (or none) is the first page, which is what it always was
  function noOffset(opts) {
    var o = opts && opts.offset;
    return o !== undefined && o !== null && o !== '' && Number(o) !== 0
      ? Promise.resolve({
          data: null,
          error:
            "gf.db.list takes no offset any more: pass the last answer's after for the next page (gf.db.list(c, {after}))",
          status: 0,
          code: 'offset',
        })
      : null;
  }
  function ownerQuery(opts) {
    return opts && opts.owner !== undefined && opts.owner !== null && opts.owner !== ''
      ? '?owner=' + encodeURIComponent(opts.owner)
      : '';
  }
  gf.db = {
    /** opts {owner: 'me' | 'server' | a player's id}; without it, the player's own (in a collection only the server
     * writes: the server's, then the player's own). Another player's document is read by its owner: gf.db.get(c, id,
     * {owner: doc.owner}). → {data: {id, owner, value, updatedAt} | null} */
    get: function (c, id, opts) {
      if (!seg(c) || !seg(id)) return bad('collection or id');
      if (useLocalDb()) return localDb.get(c, id, opts);
      return gf.api('db/' + seg(c) + '/' + seg(id) + ownerQuery(opts)).then(function (r) {
        // not in this player's space, and another player has a document with this id: null, as any document that is
        // not there, and said once, since an id alone named any player's before (gamesfun.js 1.3)
        if (r.code === 'owner') {
          if (!ownerSaid[c]) {
            ownerSaid[c] = true;
            if (globalThis.console) console.warn('gf.db.get: ' + r.error);
          }
          return { data: null, error: null, status: 404, code: 'owner', why: r.error };
        }
        return withCode(
          { data: r.data ? r.data.item : null, error: r.status === 404 ? null : r.error, status: r.status },
          r.status === 404 ? {} : r,
        );
      });
    },
    /** Creates or replaces the player's own document. → {data: the document} */
    put: function (c, id, value) {
      if (!seg(c) || !seg(id)) return bad('collection or id');
      if (useLocalDb()) return localDb.put(c, id, value);
      return gf.api('db/' + seg(c) + '/' + seg(id), { method: 'PUT', body: { value: value } }).then(function (r) {
        return pick(r, function (d) {
          return d.item;
        });
      });
    },
    /** A new document of the player's own, with an id made for it. → {data: the document} */
    add: function (c, value) {
      if (!seg(c)) return bad('collection');
      if (useLocalDb()) return localDb.add(c, value);
      return gf.api('db/' + seg(c), { method: 'POST', body: { value: value } }).then(function (r) {
        return pick(r, function (d) {
          return d.item;
        });
      });
    },
    /** → {data: [document], after, more}: newest first, a page at a time; pass `after` back for the next page.
     * opts {owner: 'me' | 'server' | a player's id, limit (≤ 100), after, order: 'new' | 'old'}; an offset but 0 is
     * refused.
     * The order is by when each document was last written: one written between two pages moves to the front, so a
     * listing taken while players write can show it twice or miss it. */
    list: function (c, opts) {
      opts = opts || {};
      if (!seg(c)) return bad('collection');
      if (noOffset(opts)) return noOffset(opts);
      if (useLocalDb()) return localDb.list(c, opts);
      var q = [];
      ['owner', 'limit', 'after', 'order'].forEach(function (k) {
        if (opts[k] !== undefined && opts[k] !== null) q.push(k + '=' + encodeURIComponent(opts[k]));
      });
      return gf.api('db/' + seg(c) + (q.length ? '?' + q.join('&') : '')).then(function (r) {
        var a = pick(r, function (d) {
          return d.items;
        });
        a.after = (r.data && r.data.after) || null;
        a.more = !!(r.data && r.data.more);
        return a;
      });
    },
    /** Deletes the player's own document. → {data: {deleted}} */
    delete: function (c, id) {
      if (!seg(c) || !seg(id)) return bad('collection or id');
      if (useLocalDb()) return localDb.delete(c, id);
      return gf.api('db/' + seg(c) + '/' + seg(id), { method: 'DELETE' });
    },
  };

  // ---- multiplayer rooms (xcore add multiplayer: server/rooms.js on xgames.fun) ----
  // A room is a relay with a host: the first player in is the host (id 1), the others get ids of their own; a message
  // goes to one player (to: id), to everyone else (0), or to everyone but one (-id). On this machine, tabs of the same
  // browser share a room instead (BroadcastChannel), so two tabs play together before the game is published.
  var CODE_RE = /^[A-Z0-9]{4,8}$/;
  var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  function roomCode(s) {
    var c = String(s == null ? '' : s)
      .trim()
      .toUpperCase();
    return CODE_RE.test(c) ? c : null;
  }
  function reaches(id, from, to) {
    return id !== from && (to === 0 || (to > 0 ? id === to : id !== -to));
  }
  function roomOf(code) {
    var room = { code: code, id: 0, host: 0, isHost: false, peers: {}, open: false, local: false };
    var fns = {};
    room.on = function (ev, fn) {
      (fns[ev] = fns[ev] || []).push(fn);
      return function () {
        fns[ev] = (fns[ev] || []).filter(function (f) {
          return f !== fn;
        });
      };
    };
    var fire = function (ev, a, b) {
      var list = fns[ev] || [];
      for (var i = 0; i < list.length; i++) {
        try {
          list[i](a, b);
        } catch {
          /* a listener's own error */
        }
      }
    };
    var setHost = function (id) {
      if (room.host === id) return;
      room.host = id;
      room.isHost = id === room.id;
      fire('host', id);
    };
    return { room: room, fire: fire, setHost: setHost };
  }
  // A frame's messages go to the room as one: a game that sends a packet per player per object every frame (Godot's
  // MultiplayerSynchronizer does) would otherwise pass the room's messages-a-second long before its bytes. Bytes queued
  // in one task go as [BATCH][to: int32, length: uint32, bytes]…, JSON as {t: 'msgs', m: [{to, d}]}; the room answers
  // each player the same way, from one sender. Order is kept: a queue of one kind is sent before the other's.
  var BATCH = -2147483648;
  var BATCH_BYTES = 60000;
  function batcher(send) {
    var kind = null,
      items = [],
      size = 0,
      due = false,
      last = 0;
    var flush = function () {
      due = false;
      if (!items.length) return;
      last = Date.now();
      var list = items,
        k = kind;
      items = [];
      size = 0;
      kind = null;
      if (k === 'json') {
        send(
          list.length === 1
            ? JSON.stringify({ t: 'msg', to: list[0].to, d: list[0].d })
            : JSON.stringify({ t: 'msgs', m: list }),
        );
        return;
      }
      if (list.length === 1) return send(framed4(list[0].b, list[0].to));
      var n = 4;
      for (var i = 0; i < list.length; i++) n += 8 + list[i].b.length;
      var out = new Uint8Array(n),
        dv = new DataView(out.buffer),
        at = 4;
      dv.setInt32(0, BATCH, true);
      for (var j = 0; j < list.length; j++) {
        dv.setInt32(at, list[j].to, true);
        dv.setUint32(at + 4, list[j].b.length, true);
        out.set(list[j].b, at + 8);
        at += 8 + list[j].b.length;
      }
      send(out.buffer);
    };
    var add = function (k, item, bytes) {
      if (kind !== k || size + bytes > BATCH_BYTES) flush();
      kind = k;
      items.push(item);
      size += bytes;
      if (!due) {
        due = true;
        // at the end of this task, and no more than about 60 times a second (a screen at 144 Hz runs a game's frame,
        // and its sends, 144 times)
        var wait = last + 16 - Date.now();
        if (wait > 0) setTimeout(flush, wait);
        else (globalThis.queueMicrotask || setTimeout)(flush);
      }
    };
    return {
      json: function (to, d) {
        add('json', { to: to, d: d }, 64);
      },
      bytes: function (to, b) {
        var u8 = b instanceof Uint8Array ? b.slice() : new Uint8Array(b).slice();
        add('bytes', { to: to, b: u8 }, 8 + u8.length);
      },
      flush: flush,
    };
  }
  /** A message from the room with bytes: one [from][bytes], or a batch of them. */
  function unbatch(buf, each) {
    if (buf.byteLength < 4) return;
    var dv = new DataView(buf),
      first = dv.getInt32(0, true);
    if (first !== BATCH) return each(first, new Uint8Array(buf, 4));
    for (var at = 4; at + 8 <= buf.byteLength;) {
      var from = dv.getInt32(at, true),
        len = dv.getUint32(at + 4, true);
      if (at + 8 + len > buf.byteLength) return;
      each(from, new Uint8Array(buf, at + 8, len));
      at += 8 + len;
    }
  }
  function framed4(bytes, n) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var out = new Uint8Array(4 + u8.length);
    new DataView(out.buffer).setInt32(0, n | 0, true);
    out.set(u8, 4);
    return out.buffer;
  }

  function joinOnline(code, opts) {
    var r = roomOf(code),
      room = r.room;
    return new Promise(function (resolve) {
      var ws,
        welcomed = false,
        ping = null;
      try {
        ws = new WebSocket(gf.socketUrl('rooms/' + code));
      } catch (e) {
        return resolve({ data: null, error: 'the room could not be reached (' + e.message + ')', status: 0 });
      }
      ws.binaryType = 'arraybuffer';
      var timer = setTimeout(function () {
        if (!welcomed) ws.close(4008, 'timed out');
      }, 15000);
      ws.onopen = function () {
        ws.send(
          JSON.stringify({
            t: 'hello',
            token: gf.token && gf.token !== 'local' ? gf.token : undefined,
            name: opts.name || (gf.player && gf.player.name) || '',
            host: typeof opts.host === 'boolean' ? opts.host : undefined,
          }),
        );
        ping = setInterval(function () {
          if (ws.readyState === 1) ws.send('ping');
        }, 25000);
      };
      ws.onmessage = function (e) {
        if (typeof e.data !== 'string') {
          unbatch(e.data, function (from, u8) {
            r.fire('bytes', from, u8);
          });
          return;
        }
        if (e.data === 'pong') return;
        var m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.t === 'welcome') {
          welcomed = true;
          clearTimeout(timer);
          room.id = m.id;
          room.open = true;
          for (var i = 0; i < m.peers.length; i++) room.peers[m.peers[i].id] = m.peers[i];
          r.setHost(m.host);
          resolve({ data: room, error: null, status: 200 });
        } else if (m.t === 'join') {
          room.peers[m.peer.id] = m.peer;
          r.fire('join', m.peer);
        } else if (m.t === 'leave') {
          var gone = room.peers[m.id] || { id: m.id };
          delete room.peers[m.id];
          r.fire('leave', gone);
        } else if (m.t === 'host') r.setHost(m.id);
        else if (m.t === 'msg') r.fire('message', m.from, m.d);
        else if (m.t === 'msgs') for (var j = 0; j < m.d.length; j++) r.fire('message', m.from, m.d[j]);
        else if (m.t === 'error') r.fire('error', m);
      };
      ws.onclose = function (e) {
        clearInterval(ping);
        clearTimeout(timer);
        var was = room.open;
        room.open = false;
        if (!welcomed) resolve({ data: null, error: e.reason || 'the room could not be joined', status: e.code });
        else if (was) r.fire('close', { code: e.code, reason: e.reason });
      };
      var out = batcher(function (m) {
        if (room.open) ws.send(m);
      });
      room.send = function (data, to) {
        if (room.open) out.json(to | 0, data === undefined ? null : data);
      };
      room.sendBytes = function (bytes, to) {
        if (room.open) out.bytes(to | 0, bytes);
      };
      room.lock = function (on) {
        out.flush();
        if (room.open) ws.send(JSON.stringify({ t: 'lock', on: on !== false }));
      };
      room.leave = function () {
        out.flush();
        if (ws.readyState <= 1) ws.close(1000, 'left');
      };
    });
  }

  function joinLocal(code, opts) {
    var r = roomOf(code),
      room = r.room;
    room.local = true;
    var ch = new BroadcastChannel('gamesfun-room:' + code);
    var joined = Date.now() + Math.random();
    var times = {}; // id → when it joined, for the host
    var me = { id: 0, name: opts.name || 'Player', player: gf.player };
    var replies = [];
    var nonce = Math.random().toString(36).slice(2);
    var newHost = function () {
      var best = null;
      for (var k in times) if (best === null || times[k] < times[best]) best = k;
      if (best !== null) r.setHost(Number(best));
    };
    ch.onmessage = function (e) {
      var m = e.data || {};
      if (m.t === 'who' && room.open)
        ch.postMessage({
          t: 'here',
          to: m.nonce,
          peer: { id: room.id, name: me.name, player: me.player },
          joined: joined,
        });
      else if (m.t === 'here' && m.to === nonce) replies.push(m);
      else if (!room.open) return;
      else if (m.t === 'join' && m.peer.id !== room.id) {
        room.peers[m.peer.id] = m.peer;
        times[m.peer.id] = m.joined;
        r.fire('join', m.peer);
      } else if (m.t === 'leave' && room.peers[m.id]) {
        var gone = room.peers[m.id];
        delete room.peers[m.id];
        delete times[m.id];
        r.fire('leave', gone);
        newHost();
      } else if (m.t === 'msg' && reaches(room.id, m.from, m.to)) r.fire('message', m.from, m.d);
      else if (m.t === 'bytes' && reaches(room.id, m.from, m.to)) r.fire('bytes', m.from, new Uint8Array(m.b));
    };
    ch.postMessage({ t: 'who', nonce: nonce });
    return new Promise(function (resolve) {
      setTimeout(function () {
        // refused: answered (the channel closes below), as a refusal online is
        if (opts.host === true && replies.length)
          return resolve({ data: null, error: 'Someone is in this room already: choose another code.', status: 4009 });
        if (opts.host === false && !replies.length)
          return resolve({ data: null, error: 'No one is in this room.', status: 4004 });
        var taken = {};
        for (var i = 0; i < replies.length; i++) {
          room.peers[replies[i].peer.id] = replies[i].peer;
          times[replies[i].peer.id] = replies[i].joined;
          taken[replies[i].peer.id] = true;
        }
        room.id = replies.length ? 0 : 1;
        while (!room.id || taken[room.id]) room.id = 2 + Math.floor(Math.random() * 0x7ffffffd);
        times[room.id] = joined;
        room.open = true;
        newHost();
        ch.postMessage({ t: 'join', peer: { id: room.id, name: me.name, player: me.player }, joined: joined });
        resolve({ data: room, error: null, status: 200 });
      }, 300);
    }).then(function (answer) {
      if (!answer.data) {
        ch.close();
        return answer;
      }
      room.send = function (data, to) {
        if (room.open) ch.postMessage({ t: 'msg', from: room.id, to: to | 0, d: data === undefined ? null : data });
      };
      room.sendBytes = function (bytes, to) {
        if (room.open)
          ch.postMessage({
            t: 'bytes',
            from: room.id,
            to: to | 0,
            b: new Uint8Array(framed4(bytes, 0), 4).slice().buffer,
          });
      };
      room.lock = function () {};
      room.leave = function () {
        if (!room.open) return;
        room.open = false;
        ch.postMessage({ t: 'leave', id: room.id });
        ch.close();
        r.fire('close', { code: 1000, reason: 'left' });
      };
      globalThis.addEventListener && globalThis.addEventListener('pagehide', room.leave);
      return answer;
    });
  }

  gf.rooms = {
    /** A new room code: 6 letters and digits, none that read alike. */
    code: function () {
      var a = new Uint8Array(6),
        s = '';
      globalThis.crypto.getRandomValues(a);
      for (var i = 0; i < a.length; i++) s += CODE_CHARS[a[i] % CODE_CHARS.length];
      return s;
    },
    /** The room this page was opened for (?room=CODE, as xgames.fun's room links and their X cards pass it), or null. */
    fromLink: function () {
      try {
        return roomCode(new URLSearchParams(loc.search || '').get('room'));
      } catch {
        return null;
      }
    },
    /** The link that opens the game in this room: xgames.fun's play page once published (its X card shows the room). */
    link: function (code) {
      var c = roomCode(code);
      if (!c) return null;
      if (slug) return studio() + '/play/' + slug + '?room=' + c;
      return loc.origin + loc.pathname + '?room=' + c;
    },
    /** Join (or open) a room. → {data: room | null, error, status}; opts {name, host}: host true opens a new room only
     *  (a Host button), false joins one only (a Join button), unset either. */
    join: function (code, opts) {
      var c = roomCode(code);
      if (!c) return Promise.resolve({ data: null, error: 'A room code is 4 to 8 letters and digits.', status: 0 });
      opts = opts || {};
      if (local && typeof BroadcastChannel === 'function') return joinLocal(c, opts);
      return joinOnline(c, opts);
    },
  };

  globalThis.GamesFun = gf;
})();
