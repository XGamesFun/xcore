// xgames.fun's sign-in client, version 1: everything a game's page says to xgames.fun to sign a player in (the
// question asked as the page loads, the window or the link at the player's click, the token kept for the tab and
// renewed before its hour ends, Sign out). xgames.fun serves this file at /platform/v1/signin/v1.js on every game's
// host; gamesfun.js asks for it there and runs it in place of the copy it carries (what it is handed, and what it
// answers, are written beside that copy in gamesfun.js).
//
// Made from lib/client/gamesfun.js by lib/signin-client.mjs (node lib/signin-client.mjs --write). Never edited here.
function signin(host) {
  var VERSION = '1.0.0';
  var POLL_MS = 2000; // a sign-in request is asked about this often
  var RENEW_MS = 300e3; // a token is renewed this long before it ends
  var BEGUN_MS = 600e3; // a sign-in that took this tab to X can still be answered this long after the tap
  var BEGUN_ASKS = 20; // and xgames.fun is asked about it this often at most
  var ASK_GAP_MS = 5000; // back in view, xgames.fun is asked no more often than this
  var slug = host.slug,
    site = host.site,
    doc = globalThis.document;
  // xgames.fun remembers a browser by a cookie of its own site, and a browser sends that only from the top page of a
  // host under that site: never from a game's own domain, nor from a frame inside another site (a post on X). Only
  // there is it asked; everywhere else the player signs in by a click, and a reload keeps what this tab kept.
  var silent = (host.where === 'edge' || host.where === 'dev') && !host.framed;
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
            return { ok: res.ok, status: res.status, data: data };
          });
      })
      .catch(function () {
        return { ok: false, status: 0, data: null };
      })
      .finally(function () {
        if (end) clearTimeout(end);
      });
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
  // b: a sign-in that took this tab to X {at, n}} ----
  function keptPart(part) {
    var k = host.kept();
    return k && typeof k === 'object' && k[part] && typeof k[part] === 'object' ? k[part] : null;
  }
  function keep(part, value) {
    var k = host.kept();
    var next = { s: (k && k.s) || null, r: (k && k.r) || null, b: (k && k.b) || null };
    next[part] = value || null;
    host.kept(next.s || next.r || next.b ? next : null);
  }
  // the sign-in that took this tab to X, while it can still be answered
  function begun() {
    var b = keptPart('b');
    if (b && b.at > Date.now() - BEGUN_MS && (b.n | 0) < BEGUN_ASKS) return b;
    if (b) keep('b', null);
    return null;
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
      return { player: r.ok && r.data && r.data.player ? r.data.player : guess, token: s.token, expires: s.expires };
    });
  }
  function adopt(s) {
    mine = s.token;
    host.mark('in');
    if (keptPart('b')) keep('b', null);
    keep('s', { token: s.token, expires: s.expires, player: s.player });
    plan(s.expires);
    host.set(s.player, s.token, s.expires);
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
    var wait = silent ? Math.max(left - RENEW_MS, 10e3) : Math.max(left, 0);
    timer = setTimeout(silent ? renew : drop, Math.min(wait, 2e9));
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
      // token. It could not be reached: asked again each minute, until the token ends
      if (s === false || left <= 75e3) timer = setTimeout(drop, Math.max(left, 0));
      else timer = setTimeout(renew, 60e3);
    });
  }
  // The question to xgames.fun, with no click and nothing shown: is this browser's player signed in to this game?
  // → the session (taken already), false (asked, and nobody is), or null (not asked, or no answer). `clicked`: the
  // player's own click on Sign in took this tab to X, so it is asked even after a sign-out here, and counted.
  function resume(clicked) {
    var b = clicked ? begun() : null;
    if (!silent || (!b && host.mark() === 'out')) return Promise.resolve(null);
    if (asking) return asking;
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
    if (k && typeof k.token === 'string' && k.token && k.player && k.expires > Date.now() + 60e3) {
      // a reload inside the token's hour: this tab's own sign-in, taken back as it was
      if (host.state().token) return Promise.resolve(host.state().player);
      mine = k.token;
      plan(k.expires);
      host.set(k.player, k.token, k.expires);
      check(k.token);
      return Promise.resolve(k.player);
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
  // ---- a sign-in that takes this tab to X (or Google) and back: a phone, on the game's own link ----
  // One tap in the game, the provider's own screen, and the game again, signed in: no window, no request, no code.
  // The tab goes to xgames.fun, which sends it straight on to the provider and afterwards back to this address; the
  // page then loads afresh and start() finds the player (the question above). So the game starts again: what it held
  // in memory is gone, which is why a game can ask to stay (signIn({stay: true}), or GAMESFUN_SIGNIN_STAY for the
  // page). Only where the question can be asked at all (the top page of the game's own link), and by default only on
  // a device whose main pointer is a finger (no hover, a coarse pointer: phones and tablets, the same test
  // xgames.fun's own sign-in page makes): there a window is a second tab the player must find their way back from,
  // while on a computer the window leaves the game running beside it.
  function handheld() {
    try {
      return !!globalThis.matchMedia && globalThis.matchMedia('(hover: none) and (pointer: coarse)').matches;
    } catch {
      return false;
    }
  }
  function leaves(opts) {
    if (!silent || host.stay || opts.stay === true) return false;
    return opts.stay === false || handheld();
  }
  function beginAt(how) {
    return (
      site +
      '/api/player/v1/' +
      (how === 'google' ? 'google' : 'x') +
      '/begin?slug=' +
      encodeURIComponent(slug || '') +
      (host.tab ? '&tab=' + encodeURIComponent(host.tab) : '') +
      '&back=' +
      encodeURIComponent(String(globalThis.location.href).replace(/#gf-signin=[a-z]*$/, ''))
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
    p.timer = setTimeout(function () {
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
    // it sticks: nothing signs this game in by itself, in this browser or (once xgames.fun has heard) any other of
    // the player's, until they click Sign in again
    host.mark('out');
    if (silent)
      post(site + '/api/player/v1/session/forget', host.tab ? { slug: slug || '', tab: host.tab } : { slug: slug }, {
        credentials: 'include',
        keepalive: true,
      });
  }

  // Back in view (from another tab, from an app), or shown again from the browser's back-forward cache. A sign-in
  // answered meanwhile lands now, not at the next look; a sign-out made in another tab of this game counts here
  // too; a token whose renewal slept past its time (a closed laptop) is renewed. And xgames.fun is asked, once for
  // this return and never within ASK_GAP_MS of the last time, when a sign-in is known to be on its way: one that
  // took this tab to X (a phone may hand it to X's app, which answers in another browser: asked about BEGUN_ASKS
  // times at most, for BEGUN_MS after the tap), or one made in another tab of this game (asked until xgames.fun says
  // nobody is signed in, which ends it). Never on a timer, and nothing here reloads or moves the page.
  function again() {
    if (pending && pending.req) poll(pending, 0);
    if (mineNow()) {
      if (host.mark() === 'out') return drop();
      var left = host.state().expires - Date.now();
      if (silent ? left < RENEW_MS : left <= 0) (silent ? renew : drop)();
      return;
    }
    if (host.state().token || !silent || Date.now() - asked < ASK_GAP_MS) return;
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

  return { version: VERSION, start: start, signIn: signIn, signOut: signOut, link: link };
}

/** The version of `host` this client takes: the one in its address. */
export const v = 1;
export default signin;
