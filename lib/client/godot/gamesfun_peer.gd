# GamesFunPeer: an xgames.fun room as Godot's MultiplayerPeer, so a game's high-level multiplayer (RPCs,
# MultiplayerSpawner, MultiplayerSynchronizer, multiplayer.peer_connected …) runs over xgames.fun as it runs over ENet.
# Written by `xcore add multiplayer`; made by GamesFun.join_room(), never by hand:
#
#   var peer = await GamesFun.join_room(GamesFun.room_from_link() if GamesFun.room_from_link() != "" else GamesFun.room_code())
#   if peer: multiplayer.multiplayer_peer = peer     # the first player in is the server (id 1), as with ENet
#
# The room's server (server/rooms.js) relays; the host's game is Godot's server. A client talks only to the host, and
# Godot relays client to client through it, as it does over ENet. Every packet is reliable and ordered (a WebSocket).
# When the host leaves, its clients see the server go (multiplayer.server_disconnected).
extends MultiplayerPeerExtension

## A JSON message from another player (send_json), outside Godot's RPCs: from, then any JSON value.
signal json_received(from: int, data)
## The room's host changed (the old host left): the new host's id.
signal host_changed(id: int)
## The room refused a message: code "rate" (too many a second; the rest were dropped), "too-big", "not-host".
signal room_error(code: String, why: String)

## The room's code (share it, or GamesFun.room_link(code)).
var code := ""
## Everyone in the room but this player: id -> {id, name, player}.
var players := {}

var _bridge = null
var _handle := 0
var _id := 0
var _host := 1
var _status := CONNECTION_CONNECTING
var _incoming := []
var _pending := []
var _target := 0
var _mode := TRANSFER_MODE_RELIABLE
var _channel := 0
var _refusing := false


func _setup(bridge, handle: int, welcome: Dictionary) -> void:
	_bridge = bridge
	_handle = handle
	_id = int(welcome.id)
	_host = int(welcome.host)
	code = str(welcome.code)
	for p in welcome.peers:
		players[int(p.id)] = p
	# Godot's shape: the server sees every client, a client sees only the server; said on the first poll, once the
	# peer is the game's multiplayer_peer
	if _id == 1:
		for id in players:
			_pending.append(id)
	elif players.has(1):
		_pending.append(1)


## A JSON message to one player (to: id), everyone else (0) or everyone but one (-id), outside Godot's RPCs.
func send_json(data, to := 0) -> void:
	if _status == CONNECTION_CONNECTED:
		_bridge.sendJson(_handle, to, JSON.stringify(data))


## The host closes the room to new players (or opens it again): as set_refuse_new_connections.
func lock(on := true) -> void:
	_set_refuse_new_connections(on)


func _poll() -> void:
	if _bridge == null:
		return
	if _status == CONNECTION_CONNECTING:
		_status = CONNECTION_CONNECTED
		for id in _pending:
			peer_connected.emit(id)
		_pending.clear()
	var text = str(_bridge.poll(_handle))
	if text == "" or text == "null":
		return
	var events = JSON.parse_string(text)
	if typeof(events) != TYPE_ARRAY:
		return
	for e in events:
		match str(e.t):
			"b":
				var from := int(e.from)
				if _id == 1 or from == 1:
					_incoming.append([from, Marshalls.base64_to_raw(str(e.d))])
			"m":
				json_received.emit(int(e.from), e.d)
			"join":
				var id := int(e.peer.id)
				players[id] = e.peer
				if _id == 1:
					peer_connected.emit(id)
			"leave":
				var id := int(e.id)
				if _id != 1 and id == 1:
					_lost()  # says peer_disconnected(1) while the server is still known
				players.erase(id)
				if _id == 1:
					peer_disconnected.emit(id)
			"host":
				_host = int(e.id)
				host_changed.emit(_host)
			"close":
				_lost()
			"error":
				# the room refused a message (too many a second, too big): said, as Godot would not see it otherwise
				push_warning("GamesFun room: %s" % str(e.get("why", e.get("code", ""))))
				room_error.emit(str(e.get("code", "")), str(e.get("why", "")))


func _lost() -> void:
	if _status == CONNECTION_DISCONNECTED:
		return
	if _id != 1 and players.has(1):
		peer_disconnected.emit(1)
	_status = CONNECTION_DISCONNECTED
	# a Godot client without its server has nothing left in the room: leave it, so its seat is free
	if _bridge != null:
		_bridge.leave(_handle)


func _put_packet_script(buffer: PackedByteArray) -> Error:
	if _status != CONNECTION_CONNECTED:
		return ERR_UNCONFIGURED
	# a client talks only to the server, as over ENet; Godot relays the rest
	var to := _target if _id == 1 else 1
	_bridge.sendBytes(_handle, to, Marshalls.raw_to_base64(buffer))
	return OK


func _get_packet_script() -> PackedByteArray:
	if _incoming.is_empty():
		return PackedByteArray()
	return _incoming.pop_front()[1]


func _get_available_packet_count() -> int:
	return _incoming.size()


func _get_packet_peer() -> int:
	return _incoming[0][0] if not _incoming.is_empty() else 0


func _get_max_packet_size() -> int:
	return 65536


func _get_packet_channel() -> int:
	return 0


func _get_packet_mode() -> TransferMode:
	return TRANSFER_MODE_RELIABLE


func _set_transfer_channel(channel: int) -> void:
	_channel = channel


func _get_transfer_channel() -> int:
	return _channel


func _set_transfer_mode(mode: TransferMode) -> void:
	_mode = mode


func _get_transfer_mode() -> TransferMode:
	return _mode


func _set_target_peer(peer: int) -> void:
	_target = peer


func _get_unique_id() -> int:
	return _id


func _is_server() -> bool:
	return _id == 1


# The game let go of the peer (multiplayer.multiplayer_peer = null, and no variable holds it): leave the room, as
# ENet's connection goes with its peer
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		_close()


func _close() -> void:
	if _bridge != null and _status != CONNECTION_DISCONNECTED:
		_bridge.leave(_handle)
	_status = CONNECTION_DISCONNECTED


func _disconnect_peer(peer: int, _force: bool) -> void:
	push_warning("GamesFunPeer: a room cannot drop one player; lock the room, or tell the player to leave with send_json")


func _set_refuse_new_connections(enable: bool) -> void:
	_refusing = enable
	if _bridge != null and _id == 1:
		_bridge.lock(_handle, enable)


func _is_refusing_new_connections() -> bool:
	return _refusing


func _is_server_relay_supported() -> bool:
	return true


func _get_connection_status() -> ConnectionStatus:
	return _status
