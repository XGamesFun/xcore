# GamesFun: sign-in, saves, leaderboards and the game's own database on xgames.fun, for a Godot 4 Web export.
# Written by `xcore add signin` (autoloaded as GamesFun in project.godot); `xcore add signin` again brings it up to date.
# It loads xgames.fun's page client (gamesfun.js, carried inside this file) into the page and calls it. Every call
# answers a Dictionary {data, error, status}; outside a Web export (the editor, a desktop build) the error says so and
# the game plays on. Export for the Web with Thread Support off: xgames.fun pages are not cross-origin isolated.
#
#   var player = await GamesFun.sign_in()          # from a button press: the player signs in -> Dictionary or null
#   GamesFun.player_changed.connect(func(p): ...)  # sign-in and sign-out (p: Dictionary or null)
#   GamesFun.sign_in_code.connect(func(c): ...)    # {code, site, url, window}: show it when window is false
#   await GamesFun.saves_put("main", {"level": 3}) # this player's saves (JSON, 64 KB each, 16 a player)
#   var r = await GamesFun.saves_get("main")       # r.data is the value, or null
#   await GamesFun.scores_submit("best", 1200)     # leaderboards: r.data {improved, best, rank}
#   await GamesFun.fullscreen()                    # from a button: full screen (again: back)
#   var top = await GamesFun.scores_top("best")    # top.data: [{rank, player, name, score, at}]
#   await GamesFun.db_add("levels", {"name": "Moon"})  # the game's own database (xcore add database)
#   multiplayer.multiplayer_peer = await GamesFun.join_room(code)  # Godot's multiplayer over xgames.fun (xcore add multiplayer)
#   await GamesFun.loot_call("shop")               # the game's Solana economy (xcore loot add): loot_ready, loot_connect
#
# A script that also runs without the autoload (headless tests, `godot --script`) fails to parse on the bare name
# GamesFun: reach it there as get_node_or_null("/root/GamesFun"), and play on when that is null.
extends Node

signal player_changed(player)
signal sign_in_code(info)

## The signed-in player ({id, name, level, wallet, x}), or null.
var player = null

var _bridge = null
var _keep = []


class _Pending:
	extends RefCounted
	signal done(result)
	var callback

	func _init():
		callback = JavaScriptBridge.create_callback(_on)

	func _on(args):
		done.emit(JSON.parse_string(str(args[0])) if args.size() > 0 else null)


func _ready():
	if not OS.has_feature("web"):
		return
	if str(JavaScriptBridge.eval("typeof globalThis.GamesFun", true)) != "object":
		JavaScriptBridge.eval(Marshalls.base64_to_utf8(SOURCE), true)
	# one entry for every call: a path into GamesFun ("saves.put"), its arguments as JSON, a callback with the answer
	JavaScriptBridge.eval(
		"globalThis.GamesFunGodot = globalThis.GamesFunGodot || { run: function (path, args, cb) {"
		+ " var gf = globalThis.GamesFun, parts = String(path).split('.'), self = gf, fn = gf;"
		+ " for (var i = 0; i < parts.length; i++) { self = fn; fn = fn && fn[parts[i]]; }"
		+ " var answer = function (r) { cb(JSON.stringify(r === undefined ? null : r)); };"
		+ " if (typeof fn !== 'function') return answer({ data: null, error: 'no such call: ' + path, status: 0 });"
		+ " Promise.resolve(fn.apply(self, JSON.parse(args))).then(answer, function (e) { answer({ data: null, error: String(e), status: 0 }); });"
		+ " }, watch: function (onPlayer, onCode) {"
		+ " globalThis.GamesFun.onChange(function (p) { onPlayer(JSON.stringify(p)); });"
		+ " globalThis.GamesFun.onCode(function (c) { onCode(JSON.stringify(c)); });"
		+ " } };",
		true
	)
	# rooms (xcore add multiplayer): a handle per joined room, its events queued until GamesFunPeer polls them
	JavaScriptBridge.eval(
		"(function (G) { if (G.joinRoom) return; var rooms = {}, n = 0;"
		+ " var b64 = function (u8) { var s = ''; for (var i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); };"
		+ " G.joinRoom = function (code, opts, cb) { globalThis.GamesFun.rooms.join(code, JSON.parse(opts)).then(function (r) {"
		+ " if (!r.data) return cb(JSON.stringify({ error: r.error || 'the room could not be joined' }));"
		+ " var room = r.data, q = [], h = ++n; rooms[h] = { room: room, q: q };"
		+ " room.on('bytes', function (from, u8) { q.push({ t: 'b', from: from, d: b64(u8) }); });"
		+ " room.on('message', function (from, d) { q.push({ t: 'm', from: from, d: d }); });"
		+ " room.on('join', function (p) { q.push({ t: 'join', peer: p }); });"
		+ " room.on('leave', function (p) { q.push({ t: 'leave', id: p.id }); });"
		+ " room.on('host', function (id) { q.push({ t: 'host', id: id }); });"
		+ " room.on('close', function () { q.push({ t: 'close' }); });"
		+ " room.on('error', function (m) { q.push({ t: 'error', code: m.code, why: m.why }); });"
		+ " var peers = []; for (var k in room.peers) peers.push(room.peers[k]);"
		+ " cb(JSON.stringify({ handle: h, id: room.id, host: room.host, code: room.code, peers: peers })); }); };"
		+ " G.poll = function (h) { var e = rooms[h]; if (!e || !e.q.length) return ''; var out = JSON.stringify(e.q); e.q.length = 0; return out; };"
		+ " G.sendBytes = function (h, to, d) { var e = rooms[h]; if (e) e.room.sendBytes(Uint8Array.from(atob(d), function (c) { return c.charCodeAt(0); }), to); };"
		+ " G.sendJson = function (h, to, d) { var e = rooms[h]; if (e) e.room.send(JSON.parse(d), to); };"
		+ " G.lock = function (h, on) { var e = rooms[h]; if (e) e.room.lock(on); };"
		+ " G.leave = function (h) { var e = rooms[h]; if (e) { e.room.leave(); delete rooms[h]; } };"
		+ " })(globalThis.GamesFunGodot);",
		true
	)
	_bridge = JavaScriptBridge.get_interface("GamesFunGodot")
	var on_player = JavaScriptBridge.create_callback(_on_player)
	var on_code = JavaScriptBridge.create_callback(_on_code)
	_keep += [on_player, on_code]
	_bridge.watch(on_player, on_code)
	var first = await _run("ready.then", [])
	if typeof(first) == TYPE_DICTIONARY:
		_set_player(first)


func _on_player(args):
	_set_player(JSON.parse_string(str(args[0])))


func _on_code(args):
	sign_in_code.emit(JSON.parse_string(str(args[0])))


func _set_player(p):
	if typeof(p) != TYPE_DICTIONARY:
		p = null
	if JSON.stringify(p) == JSON.stringify(player):
		return
	player = p
	player_changed.emit(player)


func _run(path: String, args: Array):
	if _bridge == null:
		return {"data": null, "error": "xgames.fun runs in a Web export only", "status": 0}
	var pending = _Pending.new()
	_keep.append(pending)
	_bridge.run(path, JSON.stringify(args), pending.callback)
	var result = await pending.done
	_keep.erase(pending)
	return result


## The player's sign-in, from a button press (a window may open). how: "x" or "google". -> Dictionary or null
func sign_in(how := "x"):
	var p = await _run("signIn", [{"how": how}])
	_set_player(p)
	return player


func sign_out():
	await _run("signOut", [])
	_set_player(null)


## Full screen, from a button press: on xgames.fun the page around the game goes full screen (or fills the screen in an
## app's own browser, X's among them); elsewhere the browser's own, or the game's link in a tab of its own (a post on X).
## on: true, false, or null (the other way). -> {"on": bool, "how": "page" | "browser" | "tab" | "none"}
func fullscreen(on = null):
	var r = await _run("fullscreen", [] if on == null else [on])
	return r.get("data") if r is Dictionary and r.get("data") != null else {"on": false, "how": "none"}


func is_signed_in() -> bool:
	return player != null


func saves_get(key: String):
	return await _run("saves.get", [key])


func saves_put(key: String, value):
	return await _run("saves.put", [key, value])


func saves_delete(key: String):
	return await _run("saves.delete", [key])


func saves_list():
	return await _run("saves.list", [])


## opts: {"name": "...", "order": "high" | "low"}
func scores_submit(board: String, score: float, opts := {}):
	return await _run("scores.submit", [board, score, opts])


## opts: {"limit": 10, "offset": 0}
func scores_top(board: String, opts := {}):
	return await _run("scores.top", [board, opts])


func scores_mine(board: String):
	return await _run("scores.mine", [board])


## opts: {"owner": "me" | "server" | a player's id}; without it, the player's own. Another player's document is read
## by its owner: db_get(c, id, {"owner": doc.owner})
func db_get(collection: String, id: String, opts := {}):
	return await _run("db.get", [collection, id, opts])


func db_put(collection: String, id: String, value):
	return await _run("db.put", [collection, id, value])


func db_add(collection: String, value):
	return await _run("db.add", [collection, value])


## opts: {"owner": "me" | "server" | a player's id, "limit": 50, "after": the last answer's "after", "order": "new" | "old"}
## The answer's "after" is null on the last page. An "offset" but 0 is refused (it is gone: page with "after"), here as
## well, so a loop that paged with it stops in the editor too.
func db_list(collection: String, opts := {}):
	if opts.has("offset") and opts["offset"] != null and str(opts["offset"]) != "" and float(str(opts["offset"])) != 0.0:
		return {"data": null, "error": "db_list takes no offset any more: pass the last answer's after for the next page", "status": 0, "code": "offset"}
	return await _run("db.list", [collection, opts])


func db_delete(collection: String, id: String):
	return await _run("db.delete", [collection, id])


# The game's Solana economy (xcore loot add: xsolana.json and gf/loot/ beside the exported index.html). Every answer is
# {data, error, status}; big numbers come as text. Pass a listing, claim or collectible another call returned back as
# it came: it is the terms the player was shown.
#   var r = await GamesFun.loot_ready()              # r.data {live, project, wallets: [names], spec}
#   r = await GamesFun.loot_connect()                # r.data {address, wallet, live}: the wallet asks the player
#   r = await GamesFun.loot_link()                   # r.data {wallet}: the wallet signs it is this player's, so the
#                                                    # game's server (xcore add vouchers) may pay it
#   var shop = await GamesFun.loot_call("shop")      # any method of loot's page client, its arguments in an Array:
#   await GamesFun.loot_call("buy", ["skin-red", {"listing": shop.data[0]}])
#   await GamesFun.loot_call("claimGrant", ["daily", {"voucher": v}])   # a voucher the game's server signed (api())


## Is the economy live, and which Solana wallets this browser has. -> r.data {live, project, wallets, spec}
func loot_ready():
	return await _run("loot.ready", [])


## Connect a wallet: its name, or its number in loot_ready's list. -> r.data {address, wallet, live}
func loot_connect(which = 0):
	return await _run("loot.connect", [which])


func loot_disconnect():
	return await _run("loot.disconnect", [])


## Prove the connected wallet is this signed-in player's, to the game's server (xcore add vouchers). -> r.data {wallet}
func loot_link():
	return await _run("loot.link", [])


## One method of loot's page client (shop, buy, openBox, claims, claim, collectibles, balances, stake, harvest, craft,
## lotteries, buyTickets, claimGrant, …) with its arguments.
func loot_call(method: String, args := []):
	return await _run("loot.call", [method] + args)


## Why the last join_room gave null.
var room_error := ""

const _Peer = preload("res://addons/gamesfun/gamesfun_peer.gd")
const _CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


## A new room code: 6 letters and digits, none that read alike.
func room_code() -> String:
	var s := ""
	for i in 6:
		s += _CODE_CHARS[randi() % _CODE_CHARS.length()]
	return s


## The room this page was opened for (xgames.fun's room links and their X cards pass ?room=CODE), or "".
func room_from_link() -> String:
	if _bridge == null:
		return ""
	var c = JavaScriptBridge.eval("globalThis.GamesFun.rooms.fromLink()", true)
	return str(c) if c != null else ""


## The link that opens the game in this room (xgames.fun's play page once published; its X card shows the room).
func room_link(code: String) -> String:
	if _bridge == null:
		return ""
	var l = JavaScriptBridge.eval("globalThis.GamesFun.rooms.link(%s)" % JSON.stringify(code), true)
	return str(l) if l != null else ""


## Join (or open) a room: a MultiplayerPeer to set as multiplayer.multiplayer_peer, or null (room_error says why).
## The first player in is the server (id 1). opts: {"name": "...", "host": true | false}: host true opens a new room
## only (a Host button), false joins one only (a Join button: as over ENet, no one there is an error); unset either. Outside a Web export (the editor, "Run Multiple
## Instances"), the same code makes a local ENet game on this machine: the first instance serves, the others join.
func join_room(code: String, opts := {}):
	room_error = ""
	code = code.strip_edges().to_upper()
	if not RegEx.create_from_string("^[A-Z0-9]{4,8}$").search(code):
		room_error = "A room code is 4 to 8 letters and digits."
		return null
	if _bridge == null:
		var port := 20000 + (hash(code) % 10000 + 10000) % 10000
		var enet := ENetMultiplayerPeer.new()
		# the first instance serves (Godot prints an error for the others' try, which is expected)
		if opts.get("host") != false and enet.create_server(port) == OK:
			return enet
		if opts.get("host") == true:
			room_error = "Someone is in this room already: choose another code."
			return null
		enet = ENetMultiplayerPeer.new()
		if enet.create_client("127.0.0.1", port) == OK:
			return enet
		room_error = "no room on this machine (ENet port %d)" % port
		return null
	var pending = _Pending.new()
	_keep.append(pending)
	_bridge.joinRoom(code, JSON.stringify(opts), pending.callback)
	var welcome = await pending.done
	_keep.erase(pending)
	if typeof(welcome) != TYPE_DICTIONARY or welcome.has("error"):
		room_error = str(welcome.error) if typeof(welcome) == TYPE_DICTIONARY else "the room could not be joined"
		return null
	if int(welcome.host) != 1:
		# Godot's server is id 1; the player who opened this room has left it
		_bridge.leave(int(welcome.handle))
		room_error = "The room's host has left: open a new room."
		return null
	var peer = _Peer.new()
	peer._setup(_bridge, int(welcome.handle), welcome)
	return peer


## A call to the game's own server (server/), signed in: init as fetch's ({"method": "POST", "body": {...}}).
func api(path: String, init := {}):
	return await _run("api", [path, init])


# xgames.fun's page client (lib/client/gamesfun.js), as base64
const SOURCE = "__GAMESFUN_SOURCE_B64__"
