// GamesFun: sign-in, saves, leaderboards and the game's own database on xgames.fun, for a Unity WebGL build.
// Written by `xcore add signin` (with GamesFun.jslib beside it); `xcore add signin` again brings it up to date.
// Every call answers the JSON text {"data": …, "error": …, "status": …}; parse it with JsonUtility or your own JSON
// library. Outside a WebGL build (the editor, a desktop build) the error says so and the game plays on. In Player
// Settings → Publishing Settings, keep Compression Format Disabled (or turn on Decompression Fallback) and keep
// threads off: xgames.fun sends files as they are and its pages are not cross-origin isolated.
//
//   string player = await GamesFun.SignIn();                     // from a button press: the player JSON, or "null"
//   GamesFun.PlayerChanged += json => { … };                     // sign-in and sign-out
//   GamesFun.SignInCode += json => { … };                        // {code, site, url, window}: show it when window is false
//   await GamesFun.SavesPut("main", "{\"level\":3}");            // this player's saves (JSON, 64 KB each, 16 a player)
//   string save = await GamesFun.SavesGet("main");               // {"data": the value, …}
//   await GamesFun.ScoresSubmit("best", 1200);                   // leaderboards
//   string top = await GamesFun.ScoresTop("best", 10);
//   await GamesFun.DbAdd("levels", "{\"name\":\"Moon\"}");       // the game's own database (xcore add database)
//   var room = await GamesFun.JoinRoom(await GamesFun.RoomFromLink() ?? GamesFun.RoomCode());  // multiplayer (xcore add multiplayer)
//   room.OnMessage += (from, json) => { … }; room.Send("{\"x\":1}");
//   string shop = await GamesFun.LootCall("shop");               // the game's Solana economy (xcore loot add): LootReady, LootConnect
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using UnityEngine;

public class GamesFun : MonoBehaviour
{
#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")] private static extern void GamesFunInit(string objectName);
    [DllImport("__Internal")] private static extern void GamesFunCall(int id, string path, string argsJson);
    [DllImport("__Internal")] private static extern void GamesFunRoomJoin(int id, string code, string optsJson);
    [DllImport("__Internal")] internal static extern void GamesFunRoomSend(int handle, int to, string json);
    [DllImport("__Internal")] internal static extern void GamesFunRoomSendBytes(int handle, int to, string base64);
    [DllImport("__Internal")] internal static extern void GamesFunRoomLock(int handle, int on);
    [DllImport("__Internal")] internal static extern void GamesFunRoomLeave(int handle);
#endif

    /// <summary>The signed-in player as JSON ({id, name, level, wallet, x}), or "null".</summary>
    public static string Player { get; private set; } = "null";
    public static bool SignedIn => Player != "null";
    public static event Action<string> PlayerChanged;
    public static event Action<string> SignInCode;

    private static int next;
    private static readonly Dictionary<int, TaskCompletionSource<string>> pending = new Dictionary<int, TaskCompletionSource<string>>();
    private const string NotHere = "{\"data\":null,\"error\":\"xgames.fun runs in a WebGL build only\",\"status\":0}";

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    private static void Boot()
    {
        var host = new GameObject("GamesFun");
        DontDestroyOnLoad(host);
        host.AddComponent<GamesFun>();
#if UNITY_WEBGL && !UNITY_EDITOR
        GamesFunInit("GamesFun");
#endif
    }

    /// <summary>One call into xgames.fun's page client: a path ("saves.put") and its arguments as a JSON array.</summary>
    public static Task<string> Call(string path, string argsJson)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        var id = ++next;
        var done = new TaskCompletionSource<string>();
        pending[id] = done;
        GamesFunCall(id, path, argsJson);
        return done.Task;
#else
        return Task.FromResult(NotHere);
#endif
    }

    /// <summary>The player's sign-in, from a button press (a window may open). how: "x" or "google". → the player JSON, or "null".</summary>
    public static Task<string> SignIn(string how = "x") => Call("signIn", "[{\"how\":" + Str(how) + "}]");
    public static Task<string> SignOut() => Call("signOut", "[]");

    public static Task<string> SavesGet(string key) => Call("saves.get", "[" + Str(key) + "]");
    /// <summary>valueJson: any JSON text ("{\"level\":3}", "42", "\"text\"").</summary>
    public static Task<string> SavesPut(string key, string valueJson) => Call("saves.put", "[" + Str(key) + "," + valueJson + "]");
    public static Task<string> SavesDelete(string key) => Call("saves.delete", "[" + Str(key) + "]");
    public static Task<string> SavesList() => Call("saves.list", "[]");

    /// <summary>order: "high" (default) or "low" (a time).</summary>
    public static Task<string> ScoresSubmit(string board, double score, string name = null, string order = null) =>
        Call("scores.submit", "[" + Str(board) + "," + score.ToString("R", CultureInfo.InvariantCulture) + ",{"
            + (name != null ? "\"name\":" + Str(name) + (order != null ? "," : "") : "")
            + (order != null ? "\"order\":" + Str(order) : "") + "}]");
    public static Task<string> ScoresTop(string board, int limit = 10, int offset = 0) =>
        Call("scores.top", "[" + Str(board) + ",{\"limit\":" + limit + ",\"offset\":" + offset + "}]");
    public static Task<string> ScoresMine(string board) => Call("scores.mine", "[" + Str(board) + "]");

    /// <summary>owner: "me" (or null: the player's own), "server" or a player's id.</summary>
    public static Task<string> DbGet(string collection, string id, string owner = null) =>
        Call("db.get", "[" + Str(collection) + "," + Str(id) + (owner != null ? ",{\"owner\":" + Str(owner) + "}" : "") + "]");
    public static Task<string> DbPut(string collection, string id, string valueJson) => Call("db.put", "[" + Str(collection) + "," + Str(id) + "," + valueJson + "]");
    public static Task<string> DbAdd(string collection, string valueJson) => Call("db.add", "[" + Str(collection) + "," + valueJson + "]");
    /// <summary>owner: "me", "server", a player id, or null for everyone's; after: the last answer's "after" (null on
    /// the last page), for the next page; order: "new" or "old".</summary>
    public static Task<string> DbList(string collection, string owner = null, int limit = 50, string after = null, string order = "new") =>
        Call("db.list", "[" + Str(collection) + ",{" + (owner != null ? "\"owner\":" + Str(owner) + "," : "")
            + (after != null ? "\"after\":" + Str(after) + "," : "") + "\"limit\":" + limit + ",\"order\":" + Str(order) + "}]");
    public static Task<string> DbDelete(string collection, string id) => Call("db.delete", "[" + Str(collection) + "," + Str(id) + "]");

    // ---- the game's Solana economy (xcore loot add: xsolana.json and gf/loot/ beside the build's index.html) ----
    // Big numbers come as text. Pass a listing, claim or collectible another call returned back as it came (its JSON):
    // it is the terms the player was shown.

    /// <summary>Is the economy live, and which Solana wallets this browser has: {"data": {live, project, wallets, spec}, …}.</summary>
    public static Task<string> LootReady() => Call("loot.ready", "[]");
    /// <summary>Connect a wallet (the wallet asks the player): its number in LootReady's list. → {"data": {address, wallet, live}, …}</summary>
    public static Task<string> LootConnect(int which = 0) => Call("loot.connect", "[" + which + "]");
    /// <summary>Connect the wallet with this name ("Phantom").</summary>
    public static Task<string> LootConnect(string wallet) => Call("loot.connect", "[" + Str(wallet) + "]");
    public static Task<string> LootDisconnect() => Call("loot.disconnect", "[]");
    /// <summary>Prove the connected wallet is this signed-in player's, to the game's server (xcore add vouchers): the
    /// wallet signs a text once. → {"data": {wallet}, …}</summary>
    public static Task<string> LootLink() => Call("loot.link", "[]");
    /// <summary>One method of loot's page client (shop, buy, openBox, claims, claim, collectibles, balances, stake,
    /// harvest, craft, lotteries, buyTickets, claimGrant, …). argsJson: its arguments as JSON, without the brackets
    /// ("\"skin-red\", {\"listing\": …}").</summary>
    public static Task<string> LootCall(string method, string argsJson = "") =>
        Call("loot.call", "[" + Str(method) + (string.IsNullOrEmpty(argsJson) ? "" : "," + argsJson) + "]");

    /// <summary>A call to the game's own server (server/), signed in. initJson as fetch's: {"method":"POST","body":{…}}.</summary>
    public static Task<string> Api(string path, string initJson = "{}") => Call("api", "[" + Str(path) + "," + initJson + "]");

    // ---- multiplayer rooms (xcore add multiplayer) ----
    private static readonly Dictionary<int, GamesFunRoom> rooms = new Dictionary<int, GamesFunRoom>();
    private const string CodeChars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

    /// <summary>A new room code: 6 letters and digits, none that read alike.</summary>
    public static string RoomCode()
    {
        var b = new StringBuilder();
        for (var i = 0; i < 6; i++) b.Append(CodeChars[UnityEngine.Random.Range(0, CodeChars.Length)]);
        return b.ToString();
    }

    /// <summary>The room the page was opened for (?room=CODE, as xgames.fun's room links pass it), or null.</summary>
    public static async Task<string> RoomFromLink()
    {
        var r = await Call("rooms.fromLink", "[]");
        return r == "null" || r.StartsWith("{") ? null : r.Trim('"');
    }

    /// <summary>The link that opens the game in this room (xgames.fun's play page once published).</summary>
    public static async Task<string> RoomLink(string code)
    {
        var r = await Call("rooms.link", "[" + Str(code) + "]");
        return r == "null" || r.StartsWith("{") ? null : r.Trim('"');
    }

    /// <summary>Join (or open) a room; null when it could not be joined (RoomError says why). The first player in is the host (id 1).
    /// host: true opens a new room only (a Host button: refused when someone is in it), false joins one only (a Join
    /// button: refused when no one is in it), null either.</summary>
    public static async Task<GamesFunRoom> JoinRoom(string code, string name = null, bool? host = null)
    {
        RoomError = null;
#if UNITY_WEBGL && !UNITY_EDITOR
        var id = ++next;
        var done = new TaskCompletionSource<string>();
        pending[id] = done;
        var opts = new List<string>();
        if (name != null) opts.Add("\"name\":" + Str(name));
        if (host != null) opts.Add("\"host\":" + (host.Value ? "true" : "false"));
        GamesFunRoomJoin(id, code, "{" + string.Join(",", opts) + "}");
        var json = await done.Task;
        var w = JsonUtility.FromJson<Welcome>(json);
        if (!string.IsNullOrEmpty(w.error) || w.handle == 0) { RoomError = w.error ?? "the room could not be joined"; return null; }
        var room = new GamesFunRoom(w.handle, w.id, w.host, w.code, w.peers);
        rooms[w.handle] = room;
        return room;
#else
        await Task.Yield();
        RoomError = "xgames.fun rooms run in a WebGL build only";
        return null;
#endif
    }

    /// <summary>Why the last JoinRoom gave null.</summary>
    public static string RoomError { get; private set; }

    // JsonUtility fills these fields (CS0649 would say they are never assigned)
#pragma warning disable 0649
    [Serializable] private class Welcome { public int handle; public int id; public int host; public string code; public string peers; public string error; }
    [Serializable] private class RoomEvent { public int h; public string t; public int from; public string data; }
#pragma warning restore 0649

    private void OnGamesFunRoom(string json)
    {
        var e = JsonUtility.FromJson<RoomEvent>(json);
        if (rooms.TryGetValue(e.h, out var room)) room.Handle(e.t, e.from, e.data);
        if (e.t == "close") rooms.Remove(e.h);
    }

    /// <summary>A C# string as a JSON string.</summary>
    public static string Str(string s)
    {
        if (s == null) return "null";
        var b = new StringBuilder("\"");
        foreach (var c in s)
        {
            switch (c)
            {
                case '"': b.Append("\\\""); break;
                case '\\': b.Append("\\\\"); break;
                case '\n': b.Append("\\n"); break;
                case '\r': b.Append("\\r"); break;
                case '\t': b.Append("\\t"); break;
                default:
                    if (c < ' ' || c == '\u2028' || c == '\u2029') b.Append("\\u").Append(((int)c).ToString("x4"));
                    else b.Append(c);
                    break;
            }
        }
        return b.Append('"').ToString();
    }

    // ---- from GamesFun.jslib (SendMessage) ----
    private void OnGamesFunResult(string message)
    {
        var bar = message.IndexOf('|');
        if (bar < 0 || !int.TryParse(message.Substring(0, bar), out var id)) return;
        if (!pending.TryGetValue(id, out var done)) return;
        pending.Remove(id);
        done.SetResult(message.Substring(bar + 1));
    }

    private void OnGamesFunPlayer(string json)
    {
        if (string.IsNullOrEmpty(json)) json = "null";
        if (json == Player) return;
        Player = json;
        PlayerChanged?.Invoke(json);
    }

    private void OnGamesFunCode(string json) => SignInCode?.Invoke(json);
}

/// <summary>
/// A xgames.fun room (GamesFun.JoinRoom): a relay with a host. The first player in is the host (Id 1); a message goes to
/// one player (to: their id), to everyone else (0), or to everyone but one (-id). Events come on Unity's main thread.
/// </summary>
public class GamesFunRoom
{
    public readonly string Code;
    public int Id { get; }
    public int Host { get; private set; }
    public bool IsHost => Host == Id;
    public bool Open { get; private set; } = true;
    /// <summary>The players already there when this one joined, as JSON: [{id, name, player}].</summary>
    public readonly string PeersJson;

    /// <summary>A JSON message: from, then the JSON text.</summary>
    public event Action<int, string> OnMessage;
    /// <summary>Bytes (SendBytes): from, then the bytes.</summary>
    public event Action<int, byte[]> OnBytes;
    /// <summary>A player joined: their id, then {id, name, player} as JSON.</summary>
    public event Action<int, string> OnJoin;
    public event Action<int> OnLeave;
    /// <summary>The host left, and this player is now the host when the id is Id.</summary>
    public event Action<int> OnHost;
    public event Action OnClose;
    /// <summary>The room refused a message (too many a second, so the rest were dropped; too big): why, in words.</summary>
    public event Action<string> OnError;

    private readonly int handle;

    internal GamesFunRoom(int handle, int id, int host, string code, string peersJson)
    {
        this.handle = handle;
        Id = id;
        Host = host;
        Code = code;
        PeersJson = peersJson;
    }

    internal void Handle(string t, int from, string data)
    {
        switch (t)
        {
            case "message": OnMessage?.Invoke(from, data); break;
            case "bytes": OnBytes?.Invoke(from, Convert.FromBase64String(data)); break;
            case "join": OnJoin?.Invoke(from, data); break;
            case "leave": OnLeave?.Invoke(from); break;
            case "host": Host = from; OnHost?.Invoke(from); break;
            case "close": Open = false; OnClose?.Invoke(); break;
            case "error":
                Debug.LogWarning("GamesFun room: " + data);
                OnError?.Invoke(data);
                break;
        }
    }

    /// <summary>Any JSON text, to one player (their id), everyone else (0) or everyone but one (-id).</summary>
    public void Send(string json, int to = 0)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        if (Open) GamesFun.GamesFunRoomSend(handle, to, json);
#endif
    }

    public void SendBytes(byte[] bytes, int to = 0)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        if (Open) GamesFun.GamesFunRoomSendBytes(handle, to, Convert.ToBase64String(bytes));
#endif
    }

    /// <summary>The host closes the room to new players (or opens it again).</summary>
    public void Lock(bool on = true)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        GamesFun.GamesFunRoomLock(handle, on ? 1 : 0);
#endif
    }

    public void Leave()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        if (Open) GamesFun.GamesFunRoomLeave(handle);
#endif
        Open = false;
    }
}
