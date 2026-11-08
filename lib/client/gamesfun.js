// gamesfun.js: sign-in, saves, leaderboards, the game's own database and multiplayer rooms for a game published on
// games.fun, from any engine. One file with no dependencies: a <script src="gamesfun.js"> in the page (or an import of it), and Godot's and
// Unity's glue (xcore add signin) load the same file. It sets globalThis.GamesFun; every call answers
// {data, error, status} and none throws, so a game plays on, as a guest, wherever games.fun is not there. A refusal from
// games.fun also carries code, its word for why (for example 'server-only': a board only the game's server writes).
//
//   const gf = GamesFun;
//   await gf.ready;                                   // what the page already knows (a sign-in the games.fun page has)
//   gf.player;                                        // null, or {id, name, level, wallet, x}
//   gf.local;                                         // true on this machine (localhost, xcore check, xcore dev)
//   gf.dev;                                           // true under xcore dev, where the game's server, saves and
//                                                     // sign-in answer as games.fun's will: "no server here" is
//                                                     // gf.local && !gf.dev, never gf.local alone
//   await gf.signIn();                                // from a click: the player signs in → player | null
//   gf.onChange(player => …);                         // sign-in and sign-out
//   gf.onCode(({code, site, url, window}) => …);      // the code: show it plainly when window is false (blocked);
//                                                     // when true, only as a quiet line: X's login hides the window's state
//   await gf.saves.put('main', {level: 3});           // this player's saves: JSON, 64 KB each, 16 a player
//   await gf.scores.submit('best', 1200);             // leaderboards: a player's best is kept
//   await gf.db.add('levels', {name: 'Moon'});        // the game's own database (xcore add database)
//   await gf.api('scores', {method: 'POST', body: {}}); // the game's own server (server/), signed in
//   const {data: room} = await gf.rooms.join(gf.rooms.fromLink() ?? gf.rooms.code()); // multiplayer (xcore add multiplayer)
//   room.on('message', (from, data) => …); room.send({x: 1}); share gf.rooms.link(room.code)
//
// Where sign-in comes from (games.fun's player sign-in: X first, a wallet as well):
// - inside games.fun's play page, the page above signs the player in and hands this page a token (gf:host / gf:auth);
//   only games.fun's own page may: framed by any other site (one embedding the game), the game signs in by itself;
// - on the game's own link or inside a post on X, a small window on games.fun signs in (or a code the player types at
//   <site>/go on any device), and this page asks the play host until it is answered (/player/v1/request);
// - on this machine (localhost, 127.0.0.1, xcore check), a local player and this browser's storage stand in, so the
//   game can be made and tested before it is published;
// - in `xcore dev` (its pages set globalThis.GAMESFUN_DEV), the dev host answers as games.fun would: a local sign-in
//   (each tab its own player), saves and scores on its platform, the game's own server for the database and rooms.
// The token lasts an hour and is kept in memory only. A server checks it with env.GF.verifyPlayer (server/), or any
// JWT library against <play host>/player/v1/key (a server of your own).
(function () {
  'use strict';
  if (globalThis.GamesFun) return;
  var VERSION = '1.3.0';
  var PLATFORM = '/platform/v1/';
  var SEG = /^[A-Za-z0-9_-]{1,64}$/;
  var POLL_MS = 2000;
  var loc = globalThis.location || { host: '', hostname: '', pathname: '/', protocol: 'https:', origin: '', href: '' };

  // ---- where this page is ----
  // a published game: <slug>-play.<site>/ (the play edge) or play.<site>/p/<slug>/ (the play host)
  var pathSlug = (/^\/p\/([a-z0-9]+(?:-[a-z0-9]+)*)\//.exec(loc.pathname) || [])[1] || null;
  var edge = pathSlug ? null : /^([a-z0-9]+(?:-[a-z0-9]+)*)-play\.([a-z0-9.-]+(?::\d+)?)$/.exec(loc.host);
  var slug = pathSlug || (edge ? edge[1] : null);
  var local = loc.protocol === 'file:' || /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(loc.hostname);
  // xcore dev: everything goes to the dev host, as it would to games.fun; only the sign-in is its own
  var dev = local && !!globalThis.GAMESFUN_DEV;
  if (dev) local = false;
  // on the game's own domain (play.mygame.com, xcore domain): games.fun's play edge says which game this is and where
  // games.fun is (GET /platform/v1/site, asked once at load; gf.ready waits for it)
  var site = null;
  function siteOrigin(v) {
    try {
      var u = new URL(v);
      if (u.origin !== v) return null;
      if (u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.\d+\.\d+\.\d+)$/.test(u.hostname)))
        return u.origin;
      // a stand-in games.fun in tests (http on a name this machine resolves)
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
  /** games.fun's word for a refusal (r.code), kept on the answer made from r. */
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
  function devTab(value) {
    try {
      if (value === undefined) return JSON.parse(sessionStorage.getItem('gamesfun:dev') || 'null');
      sessionStorage.setItem('gamesfun:dev', JSON.stringify(value));
    } catch {
      /* storage blocked: a new player each load */
    }
    return null;
  }
  function devSignIn(name) {
    var was = devTab() || {};
    var id =
      was.id ||
      Math.random()
        .toString(36)
        .slice(2, 12)
        .replace(/[^a-z0-9]/g, '0') + 'dev';
    return call(
      PLATFORM + 'dev/token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: id, name: name || was.name || '' }),
      },
      'xcore dev sign-in',
    ).then(function (r) {
      if (!r.data || !r.data.token) return null;
      devTab({ id: id, name: r.data.player.name, signedIn: true });
      setPlayer(r.data.player, r.data.token, r.data.expires);
      return gf.player;
    });
  }

  // ---- the page above (games.fun's play page) ----
  var above = null; // the parent window, once it answered gf:host
  var aboveAuth = false;
  var framed;
  try {
    framed = globalThis.parent && globalThis.parent !== globalThis;
  } catch {
    framed = true;
  }
  var waiters = [];
  // a token from games.fun: the player as the platform knows them (the token's subject), said once
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
      var guess = { id: '', name: x ? '@' + x.handle : a.short || '', level: a.level, wallet: a.wallet || '', x: x };
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
  // A message from the page above counts only from games.fun's own page (its origin, or www. of it): a site that
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
  if (discover) discover.then(start);
  else start();
  function start() {
    if (dev) {
      // signed in before in this tab (a reload, or xcore dev started again): the same player, with a new token
      var was = devTab();
      if (was && was.signedIn) devSignIn(was.name).then(readyResolve);
      else readyResolve(null);
    } else if (local) {
      setPlayer(store('signedIn') ? LOCAL_PLAYER : null, store('signedIn') ? 'local' : '', 0);
      readyResolve(gf.player);
    } else if (framed && globalThis.addEventListener) {
      globalThis.addEventListener('message', function (e) {
        if (e.source !== globalThis.parent || !e.data || typeof e.data !== 'object') return;
        if (!fromSite(e.origin)) return;
        if (e.data.type === 'gf:host') {
          above = e.source;
          aboveAuth = e.data.auth !== false;
          readyResolve(gf.player);
        } else if (e.data.type === 'gf:auth') {
          above = e.source;
          takeAuth(e.data).then(function () {
            readyResolve(gf.player);
          });
        }
      });
      // at boot, then every second until a page answers (40 s at most), as the kit's games say it
      var tries = 0;
      var hello = function () {
        if (above || tries++ > 40) return;
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
        readyResolve(gf.player);
      }, 1500);
    } else readyResolve(gf.player);
  }

  // ---- sign-in by itself: a request answered on games.fun (its own link, a post on X) ----
  var req = null,
    pollTimer = null,
    popup = null;
  function post(path, body) {
    return call(
      path,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      'games.fun sign-in',
    );
  }
  function poll(done) {
    clearTimeout(pollTimer);
    if (!req) return done(null);
    if (req.expires <= Date.now()) {
      req = null;
      gf.code = null;
      return done(null);
    }
    pollTimer = setTimeout(function () {
      post('/player/v1/request/status', { id: req.id, secret: req.secret }).then(function (r) {
        var s = r.data || {};
        if (s.state === 'signed-in') {
          req = null;
          gf.code = null;
          try {
            if (popup) popup.close();
          } catch {
            /* closed */
          }
          popup = null;
          var p = s.player || {};
          var x = p.x && p.x.handle ? p.x : null;
          var guess = {
            id: '',
            name: x ? '@' + x.handle : p.wallet || '',
            level: p.level,
            wallet: p.wallet || '',
            x: x,
          };
          takeToken(s.token, guess, s.expires).then(done);
          return;
        }
        if (s.state === 'expired') {
          req = null;
          gf.code = null;
          return done(null);
        }
        poll(done);
      });
    }, POLL_MS);
  }
  function requestSignIn(how) {
    if (!slug) return Promise.resolve(null);
    // the window opens at the click (one opened after an await is blocked), then goes to the code's page
    try {
      popup = globalThis.open(
        studio() + '/go',
        'gamesfun-signin',
        'popup,width=440,height=600,left=' +
          Math.max(0, Math.round((screen.availWidth || 1200) / 2 - 220)) +
          ',top=' +
          Math.max(0, Math.round((screen.availHeight || 800) / 2 - 300)),
      );
    } catch {
      popup = null;
    }
    return post('/player/v1/request', { slug: slug, with: how }).then(function (r) {
      if (!r.data || !r.data.id) {
        try {
          if (popup) popup.close();
        } catch {
          /* closed */
        }
        popup = null;
        return null;
      }
      req = { id: r.data.id, secret: r.data.secret, expires: r.data.expires };
      gf.code = { code: r.data.code, site: r.data.site, url: r.data.url, window: !!popup };
      if (popup && !popup.closed) {
        try {
          popup.location.href = r.data.url + (r.data.url.indexOf('?') < 0 ? '?' : '&') + 'with=' + how;
        } catch {
          popup = null;
        }
      }
      // always said: the game may show the code, and must when no window opened (a phone, a blocked window)
      emit(codeFns, gf.code);
      return new Promise(function (resolve) {
        poll(resolve);
      });
    });
  }

  /**
   * The player's sign-in. From a click (a window may open). → player | null. `prompt: false` opens nothing and only
   * takes a sign-in the page already has. `how`: 'x' (default) or 'wallet'.
   */
  gf.signIn = function (opts) {
    opts = opts || {};
    var how = opts.how === 'wallet' ? 'wallet' : 'x';
    if (gf.token && gf.expires > Date.now() + 60e3) return Promise.resolve(gf.player);
    if (dev) return opts.prompt === false ? Promise.resolve(gf.player) : devSignIn(opts.name);
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
        above.postMessage(how === 'x' ? { type: 'gf:auth-signin', with: 'x' } : { type: 'gf:auth-signin' }, '*');
      });
    }
    return requestSignIn(how);
  };
  gf.signOut = function () {
    clearTimeout(pollTimer);
    req = null;
    gf.code = null;
    if (local) store('signedIn', null);
    if (dev) devTab(Object.assign(devTab() || {}, { signedIn: false }));
    if (above && aboveAuth) above.postMessage({ type: 'gf:auth-signout' }, '*');
    setPlayer(null, '', 0);
    return Promise.resolve(null);
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
    /** → {data: [{rank, player, name, score, at}]}; anyone may read, signed in or not */
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
    var spec = fetch(at('xsolana.json'), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('This game has no economy here (no xsolana.json beside it).');
      return r.text().then(function (t) {
        try {
          return JSON.parse(t);
        } catch {
          throw new Error('xsolana.json is not JSON: check it with xcore loot check.');
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

  // ---- the game's own database (xcore add database: server/ with a SQLite database on games.fun) ----
  // Documents in collections: {id, owner, value, updatedAt}. Anyone reads; a signed-in player writes their own (the
  // rules at the top of server/database.js say otherwise per collection).
  function localDocs(c) {
    return store('db:' + c) || {};
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
  var localDb = {
    get: function (c, id) {
      return ok(localDocs(c)[id] || null);
    },
    put: function (c, id, value) {
      var docs = localDocs(c);
      if (docs[id] && docs[id].owner !== LOCAL_PLAYER.id)
        return Promise.resolve({ data: null, error: 'Another player owns this document.', status: 403 });
      docs[id] = { id: id, owner: LOCAL_PLAYER.id, value: value, updatedAt: Date.now() };
      store('db:' + c, docs);
      return ok(docs[id]);
    },
    add: function (c, value) {
      return localDb.put(c, newId(), value);
    },
    list: function (c, opts) {
      opts = opts || {};
      var all = Object.keys(localDocs(c)).map(function (k) {
        return localDocs(c)[k];
      });
      if (opts.owner)
        all = all.filter(function (d) {
          return d.owner === (opts.owner === 'me' ? LOCAL_PLAYER.id : opts.owner);
        });
      all.sort(function (a, b) {
        return opts.order === 'old' ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt;
      });
      var offset = opts.offset | 0;
      return ok(all.slice(offset, offset + (opts.limit | 0 || 50)));
    },
    delete: function (c, id) {
      var docs = localDocs(c);
      var had = !!docs[id];
      delete docs[id];
      store('db:' + c, docs);
      return ok({ deleted: had });
    },
  };
  function useLocalDb() {
    return local;
  }
  gf.db = {
    /** → {data: {id, owner, value, updatedAt} | null} */
    get: function (c, id) {
      if (!seg(c) || !seg(id)) return bad('collection or id');
      if (useLocalDb()) return localDb.get(c, id);
      return gf.api('db/' + seg(c) + '/' + seg(id)).then(function (r) {
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
    /** A new document with an id made for it. → {data: the document} */
    add: function (c, value) {
      if (!seg(c)) return bad('collection');
      if (useLocalDb()) return localDb.add(c, value);
      return gf.api('db/' + seg(c), { method: 'POST', body: { value: value } }).then(function (r) {
        return pick(r, function (d) {
          return d.item;
        });
      });
    },
    /** → {data: [document]}; opts {owner: 'me' | a player id, limit (≤ 100), offset, order: 'new' | 'old'} */
    list: function (c, opts) {
      opts = opts || {};
      if (!seg(c)) return bad('collection');
      if (useLocalDb()) return localDb.list(c, opts);
      var q = [];
      ['owner', 'limit', 'offset', 'order'].forEach(function (k) {
        if (opts[k] !== undefined) q.push(k + '=' + encodeURIComponent(opts[k]));
      });
      return gf.api('db/' + seg(c) + (q.length ? '?' + q.join('&') : '')).then(function (r) {
        return pick(r, function (d) {
          return d.items;
        });
      });
    },
    delete: function (c, id) {
      if (!seg(c) || !seg(id)) return bad('collection or id');
      if (useLocalDb()) return localDb.delete(c, id);
      return gf.api('db/' + seg(c) + '/' + seg(id), { method: 'DELETE' });
    },
  };

  // ---- multiplayer rooms (xcore add multiplayer: server/rooms.js on games.fun) ----
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
        var taken = {};
        for (var i = 0; i < replies.length; i++) {
          room.peers[replies[i].peer.id] = replies[i].peer;
          times[replies[i].peer.id] = replies[i].joined;
          taken[replies[i].peer.id] = true;
        }
        if (opts.host === true && replies.length)
          return { data: null, error: 'Someone is in this room already: choose another code.', status: 4009 };
        if (opts.host === false && !replies.length)
          return { data: null, error: 'No one is in this room.', status: 4004 };
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
    /** The room this page was opened for (?room=CODE, as games.fun's room links and their X cards pass it), or null. */
    fromLink: function () {
      try {
        return roomCode(new URLSearchParams(loc.search || '').get('room'));
      } catch {
        return null;
      }
    },
    /** The link that opens the game in this room: games.fun's play page once published (its X card shows the room). */
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
