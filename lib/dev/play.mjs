// `xcore dev`'s stand-in for xgames.fun's play page (/play/): the game in a frame with the play page's sandbox and
// allow list (../play-policy.mjs), and the page above's side of the bridge gamesfun.js talks to there, as
// creator-studio's play page answers it: gf:host-ready → gf:host, gf:wallet, then gf:auth with the player this page
// has signed in; gf:auth-signin → a dev player signed in by the dev host (POST /platform/v1/dev/token) and gf:auth
// again; gf:auth-signout → gf:auth with nobody. So what a game does when xgames.fun's play page signs the player in
// (gf.ready, its first save read, a sign-in and a sign-out from inside the frame, what the sandbox blocks) can be seen
// before it is published. The page keeps its player in this tab (sessionStorage), as the play page keeps its own.
// Same origin as the game here (the dev host is one origin), where xgames.fun's play page is another site.
import { PLAY_FRAME_ALLOW, PLAY_FRAME_SANDBOX } from '../play-policy.mjs';

/** Where xcore dev serves it. */
export const PLAY_PATH = '/play/';

/** The stand-in's page, framing the game at `game` (its address on the dev host). */
export function playStandIn(game = '/game/') {
  const src = JSON.stringify(game).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>play (xcore dev)</title><link rel="icon" href="data:,">
<style>html,body{margin:0;height:100%;background:#111;color:#ddd;font:13px system-ui,sans-serif}body{display:flex;flex-direction:column}
#bar{display:flex;gap:12px;align-items:center;padding:6px 12px;background:#1b1b1b}#bar button{font:inherit}
iframe{flex:1;display:block;border:0;width:100%}</style></head><body>
<div id="bar"><span>xcore dev: the game as xgames.fun's play page frames it</span><span id="who">signed out</span><button id="in">Sign in</button><button id="out" hidden>Sign out</button></div>
<iframe id="game" name="play-game" sandbox="${PLAY_FRAME_SANDBOX}" allow="${PLAY_FRAME_ALLOW}" allowfullscreen referrerpolicy="no-referrer"></iframe>
<script>
(() => {
  const frame = document.getElementById('game');
  const KEY = 'gamesfun:dev-play';
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { session = null; }
  if (session && !(session.expires > Date.now())) session = null;
  let busy = false;
  const keep = () => { try { session ? sessionStorage.setItem(KEY, JSON.stringify(session)) : sessionStorage.removeItem(KEY); } catch {} };
  const auth = () => {
    const p = session && session.player;
    return { type: 'gf:auth', v: 1, level: p ? p.level || 3 : 0, wallet: p ? p.wallet || '' : '', short: '',
      x: p && p.x ? p.x : null, google: null, name: p ? p.name : null, token: p ? session.token : '', expires: p ? session.expires : 0,
      canLink: false, linking: false, status: busy ? 'signing' : p ? 'signed-in' : 'none', error: '' };
  };
  const post = m => { try { frame.contentWindow.postMessage(m, location.origin); } catch {} };
  const show = () => {
    const p = session && session.player;
    document.getElementById('who').textContent = p ? 'signed in: ' + (p.name || p.id) : 'signed out';
    document.getElementById('in').hidden = !!p;
    document.getElementById('out').hidden = !p;
  };
  const signIn = async () => {
    if (busy) return;
    busy = true;
    post(auth());
    try {
      const r = await fetch('/platform/v1/dev/token', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: Math.random().toString(36).slice(2, 12).replace(/[^a-z0-9]/g, '0') + 'play' }) });
      const j = await r.json();
      if (r.ok && j && j.token) session = { token: j.token, expires: j.expires, player: j.player };
    } catch {}
    busy = false;
    keep(); show(); post(auth());
  };
  const signOut = () => { session = null; keep(); show(); post(auth()); };
  document.getElementById('in').onclick = signIn;
  document.getElementById('out').onclick = signOut;
  addEventListener('message', e => {
    if (e.source !== frame.contentWindow || e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
    const t = e.data.type;
    if (t === 'gf:host-ready') {
      post({ type: 'gf:host', v: 1, wallet: true, auth: true, friends: false, shop: false, prizes: 0, openWallet: false });
      post({ type: 'gf:wallet', v: 1, wallets: [] });
      post(auth());
    } else if (t === 'gf:auth-signin') signIn();
    else if (t === 'gf:auth-signout') signOut();
    else if (t === 'gf:fullscreen') post({ type: 'gf:fullscreen-state', v: 1, on: e.data.on === true, native: false });
  });
  show();
  frame.src = ${src};
})();
</script></body></html>`;
}
