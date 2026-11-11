// The sign-in client a game's own host can serve: one function, the one gamesfun.js carries (lib/client/gamesfun.js,
// between its two `signin-client` marks), as a module of its own at lib/client/signin-v1.js. A game's page asks its own
// host for it as it loads (GET SIGNIN_PATH: `xcore dev` answers it here) and runs it in place of the copy it carries
// when it comes, so a change to sign-in could reach a game without publishing it again.
//
// gamesfun.js is where the function is written; the module is made from it and never edited:
//   node lib/signin-client.mjs --write     write lib/client/signin-v1.js again from gamesfun.js
//   node lib/signin-client.mjs --check     exit 1 when it is not what gamesfun.js makes (tests/signin-client.test.mjs
//                                          holds the same)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'client');
/** The address, on a game's own host, of the sign-in client: `v1` is the version of what gamesfun.js hands it. */
export const SIGNIN_PATH = '/platform/v1/signin/v1.js';
/** The module's file, and the file its function is written in. */
export const SIGNIN_FILE = path.join(CLIENT, 'signin-v1.js');
export const SIGNIN_SOURCE = path.join(CLIENT, 'gamesfun.js');
const START = '/* signin-client:start */',
  END = '/* signin-client:end */';

const HEAD = `// xgames.fun's sign-in client, version 1: everything a game's page says to xgames.fun to sign a player in (the
// question asked as the page loads, the link or the window at the player's tap, the token kept for the tab and
// renewed before its hour ends, Sign out). A game's own host can serve this file at ${SIGNIN_PATH};
// gamesfun.js asks for it there and runs it in place of the copy it carries (what it is handed, and what it
// answers, are written beside that copy in gamesfun.js).
//
// Made from lib/client/gamesfun.js by lib/signin-client.mjs (node lib/signin-client.mjs --write). Never edited here.
`;

/** The module's text, made from gamesfun.js's text: the function between the marks, and what a module exports. */
export function signinModule(client) {
  const a = client.indexOf(START),
    b = client.indexOf(END);
  if (a < 0 || b < a || client.indexOf(START, a + 1) >= 0)
    throw new Error('gamesfun.js: the signin-client marks are not there, once each');
  const body = client
    .slice(a + START.length, b)
    .replace(/^\n/, '')
    .split('\n')
    // the function sits two spaces in, inside gamesfun.js's own function
    .map(line => {
      if (line && !line.startsWith('  ')) throw new Error(`gamesfun.js: not indented between the marks: ${line}`);
      return line.slice(2);
    })
    .join('\n')
    .trimEnd();
  if (!/^function signin\(host\) \{/.test(body)) throw new Error('gamesfun.js: no function signin(host) at the mark');
  return `${HEAD}${body}\n\n/** The version of \`host\` this client takes: the one in its address. */\nexport const v = 1;\nexport default signin;\n`;
}
/** What the module should be now, and what the file holds. */
export function signinModuleState() {
  const want = signinModule(readFileSync(SIGNIN_SOURCE, 'utf8'));
  let have = null;
  try {
    have = readFileSync(SIGNIN_FILE, 'utf8');
  } catch {}
  return { want, have, same: want === have };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const state = signinModuleState();
  if (process.argv.includes('--write')) {
    if (!state.same) writeFileSync(SIGNIN_FILE, state.want);
    console.log(state.same ? 'lib/client/signin-v1.js is up to date' : 'lib/client/signin-v1.js written');
  } else if (!state.same) {
    console.error(
      'lib/client/signin-v1.js is not what lib/client/gamesfun.js makes: node lib/signin-client.mjs --write',
    );
    process.exitCode = 1;
  } else console.log('lib/client/signin-v1.js is what lib/client/gamesfun.js makes');
}
