// The first-session walk (lib/journey.mjs), as `xcore check` runs it: what it counts as a wallet prompt, and that a tap
// on the game's own Sign in is the sign-in, not play.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adopt } from '../lib/publish/adopt.mjs';
import { findChrome, playwrightChromium } from '../lib/browser.mjs';
import { pageVerify } from '../lib/check.mjs';
import { solanaRoot } from '../lib/economy.mjs';
import { LOOT_READS } from '../lib/journey.mjs';
import { fixture, ROOT, tempDir } from './helpers.mjs';

const browser = findChrome() ?? ((await playwrightChromium()).installed ? true : null);
const skip = browser ? false : 'no Chrome, Edge or Chromium here';

test("the walk's reads are the page client's: a loan, a loan's offer and a farm's walk sign nothing", () => {
  for (const name of ['loan', 'loanOffer', 'farmWalk']) assert.ok(LOOT_READS.includes(name), name);
  const play = path.join(solanaRoot(), 'js', 'play');
  const source = readdirSync(play)
    .filter(f => f.endsWith('.js'))
    .map(f => readFileSync(path.join(play, f), 'utf8'))
    .join('\n');
  for (const name of LOOT_READS)
    assert.match(
      source,
      new RegExp(`\\basync ${name}\\(|^ +${name}(: \\w+)?,$`, 'm'),
      `${name} is a method of the installed page client`,
    );
});

test(
  "a tap on the game's own Sign in is the sign-in, not play: play is the first tap after it that the game answers",
  { skip, timeout: 180_000 },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await fixture(tmp, 'static');
    await copyFile(path.join(ROOT, 'lib', 'client', 'gamesfun.js'), path.join(dir, 'gamesfun.js'));
    const $ = id => `document.getElementById('${id}')`;
    await writeFile(
      path.join(dir, 'index.html'),
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Signs</title><script src="./gamesfun.js"></script></head><body>
<button id="in" style="font-size:28px">Sign in</button><p id="who">Guest</p>
<canvas id="game" width="300" height="300" style="background:#123"></canvas><p id="level"></p>
<script>
${$('in')}.onclick = async () => { await GamesFun.signIn(); ${$('who')}.textContent = 'Local player · Best 0'; };
${$('game')}.onclick = () => { ${$('level')}.textContent = 'Level 1'; };
</script></body></html>`,
    );
    await adopt(dir);
    const r = await pageVerify(dir, { out: path.join(tmp.dir, 'out') });
    const w = r.firstSession;
    const signIn = w.steps.find(s => /Sign in/.test(s.tapped));
    assert.ok(signIn, JSON.stringify(w.steps));
    assert.equal(signIn.signIn, true);
    assert.equal(signIn.playing, false, 'signing in is not play');
    assert.deepEqual(w.firstSignIn, { step: signIn.step, provider: 'X', control: true });
    assert.ok(w.playReached > signIn.step, JSON.stringify(w.steps));
    assert.match(w.steps[w.playReached - 1].tapped, /canvas/);
    assert.match(
      w.tell[0],
      new RegExp(
        `^The game screen changed on tap ${w.playReached}, after the walk tapped “Sign in” \\(at tap ${signIn.step}, a sign-in with X, which the game may not need\\)\\.$`,
      ),
    );
  },
);
