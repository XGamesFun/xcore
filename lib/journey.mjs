// The first-session walk: the page check's look at a game as a first-time player meets it, on a phone, inside the play
// page's frame (./check.mjs serves the stand-in), from the link towards the first reward. It taps what such a player
// would tap, a few times, and records what the game asked of them on the way: a sign-in, a wallet, a wallet that signs
// (SOL for its fee), its own server, scores and saves written, the waits it shows, and what failed or the frame
// blocked. docs/BEFORE-YOU-BUILD.md, lens 6 ("How the player experiences it"), measured instead of reasoned about.
//
// What it taps: the game's own path when gamesfun.json declares one ("journey": [{"tap": "<css selector>"} |
// {"wait": ms}]), else the most prominent visible button or link whose words look like a start ("Play", "Start",
// "Tap to start", "Continue"…), then one that looks like a step forward ("Claim", "Open", "Sign in"…), then the centre
// of the largest canvas, then any other button. It never types, never taps a link out of the game, and never taps a
// button that only changes settings, shares or closes.
//
// What it reports informs and never fails the check: an error or a block it meets is said in its section, and the
// check's own judgments (check 3: errors and sandbox blocks as the page loads) stay where they were.
// The callbacks given to page.addInitScript and frame.evaluate run in the browser, not in Node.
/* global window, document, location, getComputedStyle, innerHeight, innerWidth, MutationObserver */
import { join } from 'node:path';
import { BLOCKED_SAYS, TOP_THROWS, watchFrameBlocks } from './check.mjs';

/** At most this many taps, and this long in all (the page's first load counted). */
export const WALK = Object.freeze({ taps: 6, ms: 45_000 });
export const SECTION = 'First session (as a first-time player on a phone, in the play frame)';
const PHONE = { width: 393, height: 660 };

/** loot's page client methods that only read (gf.loot.call(name) of any other signs a transaction, and pays its fee). */
export const LOOT_READS = Object.freeze([
  'auctions',
  'balances',
  'boxes',
  'claims',
  'collectibles',
  'listing',
  'listings',
  'lotteries',
  'now',
  'project',
  'recipes',
  'rentedTo',
  'shop',
  'staked',
  'ticketWeight',
]);

// What a first-time player taps, in this order. DENY is never tapped by the walk's own choice.
const START =
  /\b(play|start|begin|tap|touch|click|press|new game|let'?s go|go|enter|continue|next|ok|okay|got it|ready)\b/i;
const FORWARD =
  /\b(claim|collect|reward|free|open|spin|get|sign ?in|log ?in|connect|join|try|redeem|mint|unlock|buy)\b/i;
const DENY =
  /\b(settings?|options?|sound|mute|unmute|music|audio|volume|share|help|how to|about|credits?|privacy|terms|close|back|exit|quit|sign ?out|log ?out|disconnect|full ?screen|language|menu|leaderboards?|report|cookies?|reset|delete|remove|tweet|discord|telegram|twitter)\b|^[×✕✖x]$/i;
/** Text a page shows while the player waits: a cooldown, a draw, a refill, a clock running down. Best effort. */
const WAIT =
  /\b(wait|try again|again in|come back|cool ?down|ready in|available in|unlocks? in|refills? in|resets? in|next \w+( \w+)? in|draws? in|ends in|starts in|opens in|time left|remaining)\b|\b\d{1,2}:\d{2}(:\d{2})?\b.*\b(left|remaining|until)\b|\b(in|after)\s+\d+\s*(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)\b/i;

/**
 * Run in every frame as it loads (page.addInitScript, with LOOT_READS); acts in the game's frame only. GamesFun is
 * handed to the page wrapped: every call that asks something of the player is noted in window.__gfWalk, and goes on
 * as it would. The page's last change to its DOM is kept in window.__gfQuiet (when the page has settled).
 */
function instrument(reads) {
  if (window === window.top) return;
  const log = (window.__gfWalk = []);
  window.__gfWalkId = Math.random().toString(36).slice(2);
  const note = (kind, detail) => {
    try {
      log.push({ kind, detail: String(detail ?? '').slice(0, 120) });
    } catch {}
  };
  window.__gfQuiet = Date.now();
  try {
    new MutationObserver(() => (window.__gfQuiet = Date.now())).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  } catch {}
  const read = new Set(reads);
  const provider = o => ((typeof o === 'string' ? o : o?.how) === 'google' ? 'Google' : 'X');
  const hooks = {
    '': {
      signIn: a => note('signin', provider(a[0])),
      openWallet: a => note('wallet', `openWallet('${a[0] ?? 'phantom'}')`),
      api: a => note('server', `${String(a[1]?.method ?? 'GET').toUpperCase()} api/${a[0]}`),
    },
    loot: {
      connect: () => note('wallet', 'loot.connect()'),
      link: () => note('wallet', 'loot.link() (signs a message)'),
      call: a => (read.has(String(a[0])) ? note('read', `loot.${a[0]}`) : note('sign', `loot.call('${a[0]}')`)),
    },
    scores: { submit: a => note('score', a[0]) },
    saves: { put: a => note('save', a[0]) },
  };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const wrapped = new WeakMap();
  const views = new WeakMap();
  const fixed = (t, k) => {
    const d = Object.getOwnPropertyDescriptor(t, k);
    return d && !d.configurable && !d.writable && !d.set;
  };
  const view = (obj, at) => {
    if (views.has(obj)) return views.get(obj);
    const p = new Proxy(obj, {
      get(t, k) {
        const v = Reflect.get(t, k);
        if (typeof k !== 'string' || fixed(t, k)) return v;
        if (at === '' && k !== '' && has(hooks, k) && v && typeof v === 'object') return view(v, k);
        const hook = has(hooks[at], k) ? hooks[at][k] : null;
        if (!hook || typeof v !== 'function') return v;
        if (!wrapped.has(v))
          wrapped.set(v, function (...a) {
            try {
              hook(a);
            } catch {}
            return v.apply(t, a);
          });
        return wrapped.get(v);
      },
    });
    views.set(obj, p);
    return p;
  };
  // gamesfun.js sets globalThis.GamesFun once, at its end (and leaves one that is there alone)
  let shown;
  try {
    Object.defineProperty(window, 'GamesFun', {
      configurable: true,
      enumerable: true,
      get: () => shown,
      set: v => {
        shown = v && typeof v === 'object' ? view(v, '') : v;
      },
    });
  } catch {}
}

/**
 * Run in the game's frame: what is on screen, and what a player could tap. Each tappable thing is marked
 * data-gf-walk="<k>" so the walk can find it again. → {lines, sig, targets: [{k, kind, text, tier, area, top, leaves}],
 * fields: [words]}
 */
function survey({ start, forward, deny }) {
  const START = new RegExp(start, 'i'),
    FORWARD = new RegExp(forward, 'i'),
    DENY = new RegExp(deny, 'i');
  const seen = el => {
    const r = el.getBoundingClientRect(),
      s = getComputedStyle(el);
    return (
      r.width > 4 &&
      r.height > 4 &&
      s.visibility !== 'hidden' &&
      s.display !== 'none' &&
      Number(s.opacity) > 0.05 &&
      r.bottom > 0 &&
      r.top < innerHeight &&
      r.right > 0 &&
      r.left < innerWidth
    );
  };
  // an element hidden behind a parent with opacity 0 still has its own opacity: walk up
  const shown = el => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (Number(s.opacity) <= 0.05 || s.visibility === 'hidden') return false;
    }
    return true;
  };
  const words = el =>
    (el.innerText || el.value || el.getAttribute('aria-label') || el.title || el.querySelector?.('img[alt]')?.alt || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
  for (const e of document.querySelectorAll('[data-gf-walk]')) e.removeAttribute('data-gf-walk');
  const targets = [],
    fields = [];
  let k = 0,
    visible = 0;
  const all = [...document.querySelectorAll('body *')].slice(0, 4000);
  const picked = new Set();
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'template', 'head', 'meta', 'link'].includes(tag)) continue;
    if (!seen(el)) continue;
    visible++;
    const type = String(el.type || '').toLowerCase();
    const field =
      (tag === 'input' && !/^(button|submit|image|reset|hidden|checkbox|radio|range|color|file)$/.test(type)) ||
      tag === 'textarea' ||
      tag === 'select' ||
      (el.isContentEditable && !el.parentElement?.isContentEditable);
    if (field) {
      if (shown(el)) fields.push(el.placeholder || el.getAttribute('aria-label') || el.name || tag);
      continue;
    }
    const role = el.getAttribute('role');
    const link = tag === 'a' && el.hasAttribute('href');
    const semantic =
      tag === 'button' ||
      link ||
      role === 'button' ||
      role === 'link' ||
      (tag === 'input' && /^(button|submit|image|reset)$/.test(type)) ||
      el.hasAttribute('onclick') ||
      tag === 'summary';
    const pointer =
      getComputedStyle(el).cursor === 'pointer' &&
      (!el.parentElement || getComputedStyle(el.parentElement).cursor !== 'pointer');
    const text = words(el);
    // "Tap to start" drawn as a plain element (a listener on the page): the innermost element that says it
    const tapTo =
      text.length < 60 &&
      /^(tap|touch|click|press)\b.*\b(start|play|begin|continue)\b/i.test(text) &&
      ![...el.children].some(c => /^(tap|touch|click|press)\b/i.test(c.innerText || ''));
    if (!(semantic || pointer || tapTo) || el.disabled || !shown(el)) continue;
    // inside a target already taken (a <span> in a <button>): the outer one is the target
    if ([...picked].some(p => p.contains(el))) continue;
    picked.add(el);
    let leaves = null;
    if (link) {
      try {
        const u = new URL(el.getAttribute('href'), location.href);
        if (/^(_blank|_top|_parent)$/i.test(el.target || '')) leaves = `opens ${u.href} out of the frame`;
        else if (el.hasAttribute('download')) leaves = 'a download';
        else if (/^https?:$/.test(u.protocol) && u.origin !== location.origin) leaves = `a link to ${u.origin}`;
        else if (!/^(https?|javascript):$/.test(u.protocol)) leaves = `a ${u.protocol} link`;
      } catch {}
    }
    const r = el.getBoundingClientRect();
    const tier = DENY.test(text) ? 9 : START.test(text) ? 0 : FORWARD.test(text) ? 1 : 3;
    el.setAttribute('data-gf-walk', String(k));
    targets.push({
      k: k++,
      kind: link ? 'link' : tag === 'button' || tag === 'input' ? 'button' : tag,
      text,
      id: el.id || '',
      tier,
      area: Math.round(r.width * r.height),
      top: Math.round(r.top),
      leaves,
    });
  }
  // the largest canvas: where a game that draws itself is played
  const canvas = [...document.querySelectorAll('canvas')]
    .filter(c => seen(c) && c.width > 0 && c.height > 0)
    .map(c => [c, c.getBoundingClientRect()])
    .sort((a, b) => b[1].width * b[1].height - a[1].width * a[1].height)[0];
  if (canvas) {
    canvas[0].setAttribute('data-gf-walk', String(k));
    targets.push({
      k,
      kind: 'canvas',
      text: '',
      id: canvas[0].id || '',
      tier: 2,
      area: Math.round(canvas[1].width * canvas[1].height),
      top: Math.round(canvas[1].top),
      leaves: null,
    });
  }
  const lines = (document.body?.innerText ?? '')
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 200);
  return { lines, sig: `${lines.join('\n')}|${visible}`, targets, fields: [...new Set(fields)].slice(0, 4) };
}

const quote = t => `“${t}”`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const describe = t =>
  t.kind === 'canvas'
    ? `the canvas${t.id ? ` #${t.id}` : ''} (its centre)`
    : t.text
      ? `${quote(t.text)} (${t.kind})`
      : `a ${t.kind} with no words${t.id ? ` (#${t.id})` : ''}`;

/** gamesfun.json "journey": [{tap: selector} | {wait: ms}] → {steps} or {problem} */
export function readJourney(journey) {
  if (journey == null) return { steps: null };
  const ok =
    Array.isArray(journey) &&
    journey.length > 0 &&
    journey.length <= 40 &&
    journey.every(
      s =>
        s &&
        typeof s === 'object' &&
        Object.keys(s).length === 1 &&
        ((typeof s.tap === 'string' && s.tap.trim() && s.tap.length <= 300) ||
          (Number.isFinite(s.wait) && s.wait >= 0 && s.wait <= 15_000)),
    );
  return ok
    ? { steps: journey.map(s => (s.tap ? { tap: s.tap.trim() } : { wait: s.wait })) }
    : {
        steps: null,
        problem:
          'gamesfun.json "journey" is not a list of {"tap": "<css selector>"} or {"wait": <ms up to 15000>}: the walk chose its own taps',
      };
}

/**
 * The walk. browser: the check's; site: servePage's answer; out: where the screenshots go; journey: gamesfun.json's
 * "journey"; network: the economy's ('devnet' | 'mainnet' | null: no economy file); economyFirst: the economy check's own
 * sentence on what a first-time player needs before their first action, said when the walk stops short of a wallet.
 * → the section's data (JSON)
 */
export async function firstSession(
  browser,
  site,
  { out, journey = null, network = null, economyFirst = null, taps = WALK.taps, ms = WALK.ms },
) {
  const began = Date.now(),
    deadline = began + ms;
  const declared = readJourney(journey);
  const major = /^(\d+)/.exec(String(browser.version?.() ?? ''))?.[1] ?? '130';
  const page = await browser.newPage({
    viewport: PHONE,
    hasTouch: true,
    isMobile: true,
    userAgent: `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`,
  });
  const game = () => page.frame({ name: 'game' });
  const inGame = (fn, arg, none) => (game()?.evaluate(fn, arg) ?? Promise.resolve(none)).catch(() => none);
  let step = 0;
  const errors = [],
    blocked = [];
  // each kind once, at the tap it first happened at (the frame keeps its own list of what it tried)
  const block = what => blocked.some(b => b.what === what) || blocked.push({ step, what });
  page.on('pageerror', e => {
    const text = String(e.message ?? e);
    if (TOP_THROWS.test(text)) return block('top');
    errors.push({ step, text: `thrown: ${text.slice(0, 200)}` });
  });
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const text = m.text();
    const sandboxed = BLOCKED_SAYS.find(([, re]) => re.test(text));
    if (sandboxed) return block(sandboxed[0]);
    if ((m.location()?.url ?? '').startsWith(`${site.framedOrigin}/`)) return; // the stand-in play page's own
    // what the page check judges (check 3 and 4): a refused request or a file that failed to load
    if (/Content Security Policy|^Refused to |^Failed to load resource|WebSocket connection to/i.test(text)) return;
    errors.push({ step, text: `console: ${text.slice(0, 200)}` });
  });
  await page.addInitScript(instrument, LOOT_READS);
  await page.addInitScript(watchFrameBlocks, TOP_THROWS.source);

  const shots = [];
  const shoot = async () => {
    const file = `journey-${shots.length + 1}.png`;
    const bytes = await page.screenshot({ path: join(out, file) }).catch(() => null);
    shots.push(file);
    return { file, bytes };
  };
  // the page's DOM still for `quiet` ms, at least `min`, at most `max`
  const settle = async ({ min = 600, quiet = 400, max = 3000 } = {}) => {
    const t0 = Date.now();
    await page.waitForTimeout(Math.max(0, Math.min(min, deadline - Date.now())));
    while (Date.now() - t0 < max && Date.now() < deadline) {
      const q = await inGame(() => Date.now() - (window.__gfQuiet ?? 0), null, Infinity);
      if (q >= quiet) break;
      await page.waitForTimeout(150);
    }
  };
  // what the page asked since the last look (a page that reloads starts its own list again)
  let logId = null,
    logSeen = 0,
    reloads = 0;
  const asked = async () => {
    const now = await inGame(() => ({ id: window.__gfWalkId, log: window.__gfWalk ?? [] }), null, null);
    if (!now) return [];
    if (now.id !== logId) {
      if (logId !== null) reloads++;
      logId = now.id;
      logSeen = 0;
    }
    const fresh = now.log.slice(logSeen);
    logSeen = now.log.length;
    return fresh;
  };
  const blockedSoFar = async () => {
    for (const b of (await inGame(() => window.__gfBlocked ?? [], null, [])) ?? []) block(b);
  };
  const look = () =>
    inGame(survey, { start: START.source, forward: FORWARD.source, deny: DENY.source }, null).then(
      s => s ?? { lines: [], sig: '', targets: [], fields: [] },
    );
  const waitsIn = lines => lines.filter(l => l.length <= 160 && WAIT.test(l));

  const steps = [];
  const waits = [];
  const seenWait = new Set();
  const noteWaits = lines => {
    for (const w of waitsIn(lines)) {
      // a clock running down shows a new line each second: one wait, its first words
      const key = w.replace(/\d+/g, '#');
      if (seenWait.has(key)) continue;
      seenWait.add(key);
      waits.push({ step, text: w.slice(0, 120) });
    }
  };
  let stopped = null;
  let load = null;
  try {
    await page.goto(site.framedUrl, { waitUntil: 'load', timeout: 20_000 });
    for (let i = 0; i < 20 && !game(); i++) await page.waitForTimeout(100);
    if (!game()) throw new Error("the play page's frame has no game in it");
    await settle({ min: 1500, quiet: 500, max: 6000 });
    let now = await look();
    await blockedSoFar();
    noteWaits(now.lines);
    let shot = await shoot();
    load = { shot: shot.file, shows: now.lines.slice(0, 3), asked: await asked() };
    const tried = new Map(); // target key → taps with no answer seen
    let canvasTaps = 0;
    const plan = declared.steps ? [...declared.steps] : null;
    while (!stopped) {
      // the declared journey's waits, then what they let the page show (and ask), counted to the tap before them
      if (plan && plan[0]?.wait != null) {
        while (plan[0]?.wait != null)
          await page.waitForTimeout(Math.max(0, Math.min(plan.shift().wait, deadline - Date.now() - 2500)));
        now = await look();
        noteWaits(now.lines);
        await blockedSoFar();
        const more = await asked();
        if (steps.length) {
          shot = await shoot();
          const last = steps.at(-1);
          last.screen = shot.file;
          last.asked.push(...more);
        } else load.asked.push(...more);
      }
      if (plan && !plan.length) {
        stopped = 'the end of the declared journey';
        break;
      }
      if (steps.length >= taps) {
        stopped = plan ? `its limit of ${taps} taps, before the declared journey's end` : `its limit of ${taps} taps`;
        break;
      }
      if (Date.now() > deadline - 2500) {
        stopped = `its time limit (${Math.round(ms / 1000)} s)`;
        break;
      }
      // the next tap: the declared journey's, or the one a first-time player would choose
      let target = null,
        selector = null;
      if (plan) {
        selector = plan.shift().tap;
        let el = null;
        try {
          el = game().locator(selector).first();
        } catch {}
        const there = el
          ? await el
              .waitFor({ state: 'visible', timeout: Math.max(500, Math.min(4000, deadline - Date.now() - 2500)) })
              .then(() => true)
              .catch(e => (/Timeout/i.test(e.message) ? false : 'invalid'))
          : 'invalid';
        if (there !== true) {
          stopped = `the declared journey's tap ${steps.length + 1} (${selector}), which ${there === 'invalid' ? 'is not a CSS selector' : 'was not on the page'}`;
          break;
        }
        now = await look(); // marked again: it may have shown up since the last look
        const k = await el.evaluate(e => e.getAttribute('data-gf-walk')).catch(() => null);
        target =
          now.targets.find(t => String(t.k) === k) ??
          (await el
            .evaluate(e => ({
              k: null,
              kind: e.tagName.toLowerCase(),
              text: (e.innerText || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60),
              id: e.id || '',
              leaves: null,
            }))
            .catch(() => ({ k: null, kind: 'element', text: '', id: '', leaves: null })));
        if (target.leaves) {
          stopped = `the declared journey's tap ${steps.length + 1} (${selector}): ${target.leaves}, which leaves the game`;
          break;
        }
      } else {
        const key = t => `${t.kind}:${t.text}:${t.id}`;
        const open = now.targets.filter(
          t => !t.leaves && t.tier !== 9 && (tried.get(key(t)) ?? 0) < 1 && !(t.kind === 'canvas' && canvasTaps >= 2),
        );
        open.sort((a, b) => a.tier - b.tier || !!b.text - !!a.text || b.area - a.area || a.top - b.top);
        target = open[0] ?? null;
        if (!target) {
          stopped = now.fields.length
            ? `a field that asks them to type (${now.fields.map(quote).join(', ')}): the walk never types`
            : now.targets.some(t => t.leaves)
              ? 'a screen whose only taps are links out of the game'
              : 'a screen with nothing left that a first-time player would tap';
          break;
        }
      }
      // the tap, at the centre of what was chosen, as a finger
      const before = { shot, sig: now.sig, lines: now.lines };
      // still before the tap: a screen that moves on its own says nothing about the tap
      let still = false;
      if (before.shot.bytes) {
        await page.waitForTimeout(250);
        still = !!(await page.screenshot().catch(() => null))?.equals(before.shot.bytes);
      }
      const spot = selector ? game().locator(selector).first() : game().locator(`[data-gf-walk="${target.k}"]`).first();
      await spot.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
      const box = await spot.boundingBox().catch(() => null);
      if (!box) {
        stopped = `${describe(target)}, which could not be tapped (it has no place on screen)`;
        break;
      }
      step = steps.length + 1;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      if (target.kind === 'canvas') canvasTaps++;
      await settle();
      await blockedSoFar();
      const frameNow = game();
      let left = null;
      try {
        const u = new URL(frameNow?.url() ?? '');
        if (!frameNow) left = 'the game is gone from the frame';
        else if (u.origin !== site.origin) left = `the frame went to ${u.origin}`;
      } catch {
        left = 'the game is gone from the frame';
      }
      now = left ? { lines: [], sig: '', targets: [], fields: [] } : await look();
      noteWaits(now.lines);
      shot = await shoot();
      const changed = now.sig !== before.sig;
      const moved = !!(still && shot.bytes && !shot.bytes.equals(before.shot.bytes));
      const answered = changed || moved ? true : still ? false : null;
      const appeared = now.lines.filter(l => !before.lines.includes(l)).slice(0, 3);
      const startLeft = now.targets.some(t => t.tier === 0 && !t.leaves);
      steps.push({
        step,
        tapped: describe(target),
        ...(selector ? { selector } : {}),
        answered,
        appeared,
        screen: shot.file,
        asked: await asked(),
        playing: !!answered && (target.kind === 'canvas' || !startLeft),
      });
      if (!selector && answered !== true) {
        const key = `${target.kind}:${target.text}:${target.id}`;
        tried.set(key, (tried.get(key) ?? 0) + 1);
      }
      if (left) stopped = `a tap that moved the game out of its frame (${left})`;
    }
  } catch (e) {
    stopped = `an error of its own: ${String(e.message ?? e).split('\n')[0]}`;
  } finally {
    await page.close().catch(() => {});
  }
  return summarize({
    steps,
    load,
    errors,
    blocked,
    waits,
    stopped,
    shots,
    declared,
    network,
    economyFirst,
    reloads,
    taps,
    began,
  });
}

const BLOCK_WORDS = {
  popup: 'tried to open a pop-up, which the play frame blocks: nothing opens for them',
  form: 'submitted a form, which the play frame blocks: nothing is sent',
  top: 'tried to move the whole page (top.location), which the play frame blocks',
};
const at = s => (s === 0 ? 'as it loads' : `at tap ${s}`);

/** The walk's findings, and the sentences to pass on (tell). */
function summarize({
  steps,
  load,
  errors,
  blocked,
  waits,
  stopped,
  shots,
  declared,
  network,
  economyFirst = null,
  reloads,
  taps,
  began,
}) {
  const all = [
    ...(load?.asked ?? []).map(a => ({ ...a, step: 0 })),
    ...steps.flatMap(s => s.asked.map(a => ({ ...a, step: s.step }))),
  ];
  const first = kinds => all.find(a => kinds.includes(a.kind)) ?? null;
  const signIn = first(['signin']);
  const wallet = first(['wallet', 'sign']);
  const sol = first(['sign']);
  const reached = steps.find(s => s.playing)?.step ?? null;
  const walk = {
    journey: declared.steps ? 'declared in gamesfun.json' : 'chosen by the walk',
    ...(declared.problem ? { journeyProblem: declared.problem } : {}),
    taps: steps.length,
    seconds: Math.round((Date.now() - began) / 100) / 10,
    load,
    steps,
    playReached: reached,
    firstSignIn: signIn ? { step: signIn.step, provider: signIn.detail } : null,
    firstWallet: wallet ? { step: wallet.step, call: wallet.detail } : null,
    firstSol: sol ? { step: sol.step, call: sol.detail, network: network ?? 'devnet' } : null,
    walletPrompts: all.filter(a => a.kind === 'wallet' || a.kind === 'sign').length,
    server: all.filter(a => a.kind === 'server').map(a => ({ step: a.step, call: a.detail })),
    scores: all.filter(a => a.kind === 'score').map(a => ({ step: a.step, board: a.detail })),
    saves: all.filter(a => a.kind === 'save').map(a => ({ step: a.step, key: a.detail })),
    waits,
    errors,
    blocked: blocked.map(b => ({ step: b.step, what: b.what })),
    ...(reloads ? { reloads } : {}),
    stopped,
    // the walk saw no wallet asked for: it stopped short of any reward the chain pays
    shortOfReward: !wallet,
    ...(economyFirst ? { economyFirst } : {}),
    screenshots: shots,
  };
  walk.tell = tell(walk, { taps });
  return walk;
}

/** 2 to 4 sentences to pass on as they are: only what the walk saw, and what it could not reach. */
function tell(w, { taps }) {
  const out = [];
  const n = w.taps;
  // what was tapped, as a sentence names it: “Buy sword”, not “Buy sword” (button)
  const tappedAt = s => (w.steps.find(x => x.step === s)?.tapped ?? '').replace(/ \([a-z]+\)$/, '');
  const where = w.firstSignIn ? `${w.firstSignIn.provider}'s in-app browser` : "a social app's in-app browser";
  if (!w.load)
    return [`The walk could not open the game in the play frame (${w.stopped}), so it saw nothing of a first session.`];
  // reaching play
  if (w.playReached != null) {
    const before = [w.firstSignIn, w.firstWallet].filter(x => x && x.step <= w.playReached);
    out.push(
      `A first-time player on a phone reaches play in ${plural(w.playReached, 'tap')}${before.length ? `, after ${[w.firstSignIn && w.firstSignIn.step <= w.playReached ? `a sign-in with ${w.firstSignIn.provider} (${at(w.firstSignIn.step)})` : '', w.firstWallet && w.firstWallet.step <= w.playReached ? `a wallet (${at(w.firstWallet.step)})` : ''].filter(Boolean).join(' and ')}` : ', with no sign-in or wallet'}.`,
    );
  } else if (n === 0)
    out.push(`The walk found nothing a first-time player would tap to start, so it took no tap (${w.stopped}).`);
  else
    out.push(
      `In ${plural(n, 'tap')} the walk did not see the game answer as play (it taps buttons and the canvas's centre; a game played by swiping, keys or typing is not reached this way).`,
    );
  // what it asked of them
  if (w.firstSol)
    out.push(
      `${w.firstSol.step ? `At tap ${w.firstSol.step} (${tappedAt(w.firstSol.step)})` : 'As it loads'} the game asks a wallet to sign ${w.firstSol.call}, which needs ${w.firstSol.network === 'mainnet' ? 'real SOL' : 'devnet SOL (from a faucet)'} for its fee unless the game's server or page pays it${w.firstSignIn && w.firstSignIn.step <= w.firstSol.step ? `, on top of the sign-in with ${w.firstSignIn.provider}` : ''}: ${where} cannot hold a wallet, so they must open the game in a wallet app (${plural(w.walletPrompts, 'wallet prompt')} in the walk).`,
    );
  else if (w.firstWallet)
    out.push(
      `${w.firstWallet.step ? `At tap ${w.firstWallet.step} (${tappedAt(w.firstWallet.step)})` : 'As it loads'} the game asks for a wallet (${w.firstWallet.call}): ${where} cannot hold one, so they must open the game in a wallet app.`,
    );
  else if (w.firstSignIn && !(w.playReached != null && w.firstSignIn.step <= w.playReached))
    out.push(
      `It asks them to sign in with ${w.firstSignIn.provider} ${at(w.firstSignIn.step)}${w.firstSignIn.step ? ` (${tappedAt(w.firstSignIn.step)})` : ''}, and no wallet in the first ${plural(n, 'tap')}.`,
    );
  // short of the first reward: said every time, with what the economy says it needs (the walk can't play a game to it)
  if (w.shortOfReward && w.stopped)
    out.push(
      `Before any wallet prompt, the walk stopped at ${w.stopped}, so it did not reach a first reward${w.economyFirst ? `. The economy says: ${w.economyFirst}` : ': what claiming one asks (a sign-in, a wallet, SOL for its fee) was not seen'}`.replace(
        /([^.])$/,
        '$1.',
      ),
    );
  // the one thing most worth knowing next
  const extra = [];
  const b = w.blocked[0];
  if (b && BLOCK_WORDS[b.what])
    extra.push(`${b.step ? `Tapping ${tappedAt(b.step)}` : 'As it loads, the game'} ${BLOCK_WORDS[b.what]}.`);
  if (!w.shortOfReward && /^the declared journey's tap/.test(w.stopped ?? ''))
    extra.push(`The walk stopped at ${w.stopped}, so what follows it was not seen.`);
  if (!w.shortOfReward && /^a field that asks/.test(w.stopped ?? ''))
    extra.push(`The walk stopped at ${w.stopped}, so what follows it was not seen.`);
  if (w.errors.length)
    extra.push(
      `${plural(w.errors.length, 'error')} showed up during the walk (first, ${at(w.errors[0].step)}: ${w.errors[0].text.slice(0, 100)}).`,
    );
  if (w.waits.length) extra.push(`On the way they see a wait ${at(w.waits[0].step)}: ${quote(w.waits[0].text)}.`);
  out.push(...extra.slice(0, Math.max(1, 3 - out.length)));
  // what it could not reach, said plainly
  if (!w.shortOfReward && out.length < 4 && !/^(the declared journey's tap|a field that asks)/.test(w.stopped ?? '')) {
    if (/^the end of the declared journey$/.test(w.stopped ?? ''))
      out.push(`The walk followed the declared journey to its end (${plural(n, 'tap')}); nothing after it was seen.`);
    else if (n >= taps || /time limit/.test(w.stopped ?? ''))
      out.push(
        `The walk stopped at ${w.stopped}, so anything later (a first reward behind more play, a wait that starts after it) was not seen.`,
      );
    else if (w.stopped) out.push(`The walk stopped at ${w.stopped}; nothing past that was seen.`);
  }
  return out.slice(0, 4);
}

/** The section as lines of text, for the check's report. */
export function firstSessionLines(w) {
  if (!w) return [];
  if (w.error) return [`${SECTION}: the walk could not run (${w.error}); it never fails the check.`];
  const lines = [`${SECTION}:`];
  const asked = list =>
    list.length
      ? `; asked: ${list.map(a => (a.kind === 'signin' ? `sign-in with ${a.detail}` : `${a.detail}${a.kind === 'sign' ? ' (signs: wallet and SOL)' : ''}`)).join(', ')}`
      : '';
  lines.push(`  journey: ${w.journey}${w.journeyProblem ? ` (${w.journeyProblem})` : ''}`);
  if (w.load)
    lines.push(
      `  as it loads: ${w.load.shows.length ? w.load.shows.map(quote).join(', ') : 'no text on screen'}${asked(w.load.asked)} [${w.load.shot}]`,
    );
  for (const s of w.steps)
    lines.push(
      `  ${s.step}. tapped ${s.tapped}${s.selector ? ` [${s.selector}]` : ''} → ${s.answered === true ? 'the screen changed' : s.answered === false ? 'nothing on screen changed' : 'the screen moves on its own: no telling'}${s.appeared.length ? `; appeared: ${s.appeared.map(quote).join(', ')}` : ''}${asked(s.asked)} [${s.screen}]`,
    );
  const firstOf = x => (x ? at(x.step) : `none in the first ${plural(w.taps, 'tap')}`);
  lines.push(`  play reached: ${w.playReached != null ? `in ${plural(w.playReached, 'tap')}` : 'not seen'}`);
  lines.push(`  first sign-in: ${firstOf(w.firstSignIn)}${w.firstSignIn ? ` (${w.firstSignIn.provider})` : ''}`);
  lines.push(`  first wallet: ${firstOf(w.firstWallet)}${w.firstWallet ? ` (${w.firstWallet.call})` : ''}`);
  lines.push(
    `  first SOL: ${firstOf(w.firstSol)}${w.firstSol ? ` (${w.firstSol.call} signs a transaction; ${w.firstSol.network}: the player pays its fee unless the server or page does)` : ''}`,
  );
  lines.push(`  wallet prompts: ${w.walletPrompts}`);
  const calls = [
    ...w.server.map(c => `${c.call} (${at(c.step)})`),
    ...w.scores.map(c => `score ${c.board} (${at(c.step)})`),
    ...w.saves.map(c => `save ${c.key} (${at(c.step)})`),
  ];
  if (calls.length) lines.push(`  server, scores, saves: ${calls.join(', ')}`);
  lines.push(
    `  waits seen: ${w.waits.length ? w.waits.map(x => `${quote(x.text)} (${at(x.step)})`).join(', ') : 'none'}`,
  );
  const trouble = [
    ...w.errors.map(e => `${e.text} (${at(e.step)})`),
    ...w.blocked.map(b => `${BLOCK_WORDS[b.what] ?? b.what} (${at(b.step)})`),
  ];
  lines.push(`  errors or blocks during the walk: ${trouble.length ? trouble.join('; ') : 'none'}`);
  lines.push(`  stopped at: ${w.stopped} (${w.seconds} s)`);
  lines.push(`  screenshots: ${w.screenshots.join(', ')}`);
  lines.push('  Tell the person:');
  for (const t of w.tell) lines.push(`    ${t}`);
  return lines;
}
