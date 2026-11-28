// What the bring-your-own-game skill tells an agent about sign-in, saves and leaderboards: guest saves carried over at
// sign-in with calls the client has, a page-written board said for what it is, and where the calls are read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const REF = path.join(ROOT, 'skills', 'bring-your-own-game', 'references', 'sign-in-saves-rooms.md');
const flat = text => text.replace(/\s+/g, ' ');

test("the sign-in reference carries a guest's saves into an empty account, with calls each client has", async () => {
  const text = await readFile(REF, 'utf8');
  assert.match(flat(text), /their saves stay in the browser at sign-in/);
  const snippet = /```js\n([\s\S]*?)```/.exec(text)?.[1] ?? '';
  assert.match(snippet, /GamesFun\.saves\.guest\.list\(\)/);
  assert.match(snippet, /if \(!error && mine == null\) await GamesFun\.saves\.guest\.move\(key\)/);
  const client = await readFile(path.join(ROOT, 'lib', 'client', 'gamesfun.js'), 'utf8');
  assert.match(client, /guest: \{[\s\S]*?move: function/, 'gamesfun.js has saves.guest.move');
  const gd = await readFile(path.join(ROOT, 'lib', 'client', 'godot', 'gamesfun.gd'), 'utf8');
  const cs = await readFile(path.join(ROOT, 'lib', 'client', 'unity', 'GamesFun.cs'), 'utf8');
  for (const [name, source] of [
    ['saves_guest_list', gd],
    ['saves_guest_move', gd],
    ['SavesGuestList', cs],
    ['SavesGuestMove', cs],
  ]) {
    assert.ok(text.includes(name), name);
    assert.ok(source.includes(name), `${name} is in the client`);
  }
});

test('the sign-in reference says a page-written board takes any score, and where the calls are listed', async () => {
  const text = flat(await readFile(REF, 'utf8'));
  assert.match(text, /A leaderboard the page writes takes any score a player sends/);
  assert.match(text, /env\.GF\.scores\.setup\(board, \{ writer: 'server' \}\)/);
  assert.doesNotMatch(text, /the calls are listed at the top of the file it writes/);
  assert.match(text, /a web game's `gamesfun\.js` is minified/);
});
