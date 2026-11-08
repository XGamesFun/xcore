// GamesFun for a Unity WebGL build: xgames.fun's page client (gamesfun.js, carried here as base64) and the two entry
// points GamesFun.cs calls. Written by `xcore add signin`; `xcore add signin` again brings it up to date.
mergeInto(LibraryManager.library, {
  GamesFunInit: function (objectNamePtr) {
    var name = UTF8ToString(objectNamePtr);
    if (typeof globalThis.GamesFun !== 'object') {
      var b64 = '__GAMESFUN_SOURCE_B64__';
      var bytes = Uint8Array.from(atob(b64), function (c) {
        return c.charCodeAt(0);
      });
      (0, eval)(new TextDecoder().decode(bytes));
    }
    var send = function (method, text) {
      if (typeof SendMessage === 'function') SendMessage(name, method, text);
      else Module.SendMessage(name, method, text);
    };
    globalThis.GamesFunUnity = { send: send };
    globalThis.GamesFun.onChange(function (p) {
      send('OnGamesFunPlayer', JSON.stringify(p));
    });
    globalThis.GamesFun.onCode(function (c) {
      send('OnGamesFunCode', JSON.stringify(c));
    });
    globalThis.GamesFun.ready.then(function (p) {
      send('OnGamesFunPlayer', JSON.stringify(p));
    });
  },

  // rooms (xcore add multiplayer): GamesFunRoom.cs joins by id; every event goes to GamesFun.OnGamesFunRoom as JSON
  // {h, t, …}, bytes as base64
  GamesFunRoomJoin: function (id, codePtr, optsPtr) {
    var code = UTF8ToString(codePtr),
      opts = JSON.parse(UTF8ToString(optsPtr) || '{}');
    var U = globalThis.GamesFunUnity;
    U.rooms = U.rooms || {};
    U.n = U.n || 0;
    var b64 = function (u8) {
      var s = '';
      for (var i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
      return btoa(s);
    };
    globalThis.GamesFun.rooms.join(code, opts).then(function (r) {
      if (!r.data) return U.send('OnGamesFunResult', id + '|' + JSON.stringify({ error: r.error }));
      var room = r.data,
        h = ++U.n;
      U.rooms[h] = room;
      var ev = function (o) {
        o.h = h;
        U.send('OnGamesFunRoom', JSON.stringify(o));
      };
      room.on('message', function (from, d) {
        ev({ t: 'message', from: from, data: JSON.stringify(d) });
      });
      room.on('bytes', function (from, u8) {
        ev({ t: 'bytes', from: from, data: b64(u8) });
      });
      room.on('join', function (p) {
        ev({ t: 'join', from: p.id, data: JSON.stringify(p) });
      });
      room.on('leave', function (p) {
        ev({ t: 'leave', from: p.id });
      });
      room.on('host', function (hid) {
        ev({ t: 'host', from: hid });
      });
      room.on('close', function () {
        ev({ t: 'close' });
      });
      room.on('error', function (m) {
        ev({ t: 'error', data: m.why || m.code });
      });
      var peers = [];
      for (var k in room.peers) peers.push(room.peers[k]);
      U.send(
        'OnGamesFunResult',
        id +
          '|' +
          JSON.stringify({ handle: h, id: room.id, host: room.host, code: room.code, peers: JSON.stringify(peers) }),
      );
    });
  },
  GamesFunRoomSend: function (h, to, jsonPtr) {
    var room = (globalThis.GamesFunUnity.rooms || {})[h];
    if (room) room.send(JSON.parse(UTF8ToString(jsonPtr)), to);
  },
  GamesFunRoomSendBytes: function (h, to, b64Ptr) {
    var room = (globalThis.GamesFunUnity.rooms || {})[h];
    if (room)
      room.sendBytes(
        Uint8Array.from(atob(UTF8ToString(b64Ptr)), function (c) {
          return c.charCodeAt(0);
        }),
        to,
      );
  },
  GamesFunRoomLock: function (h, on) {
    var room = (globalThis.GamesFunUnity.rooms || {})[h];
    if (room) room.lock(!!on);
  },
  GamesFunRoomLeave: function (h) {
    var rooms = globalThis.GamesFunUnity.rooms || {};
    if (rooms[h]) {
      rooms[h].leave();
      delete rooms[h];
    }
  },

  // one entry for every call: an id, a path into GamesFun ("saves.put") and its arguments as JSON; the answer comes
  // back as "<id>|<JSON>" to GamesFun.OnGamesFunResult
  GamesFunCall: function (id, pathPtr, argsPtr) {
    var path = UTF8ToString(pathPtr),
      args = UTF8ToString(argsPtr);
    var gf = globalThis.GamesFun,
      parts = path.split('.'),
      self = gf,
      fn = gf;
    for (var i = 0; i < parts.length; i++) {
      self = fn;
      fn = fn && fn[parts[i]];
    }
    var answer = function (r) {
      globalThis.GamesFunUnity.send('OnGamesFunResult', id + '|' + JSON.stringify(r === undefined ? null : r));
    };
    if (typeof fn !== 'function') return answer({ data: null, error: 'no such call: ' + path, status: 0 });
    var parsed;
    try {
      parsed = JSON.parse(args);
    } catch (e) {
      return answer({ data: null, error: 'the arguments are not JSON: ' + args, status: 0 });
    }
    Promise.resolve(fn.apply(self, parsed)).then(answer, function (e) {
      answer({ data: null, error: String(e), status: 0 });
    });
  },
});
