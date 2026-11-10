import { createInterface } from 'node:readline/promises';
import { guard, parse, printJson } from '../lib/cli.mjs';
import { openUrl } from '../lib/open.mjs';
import { signInState, studioOrigin } from '../lib/publish/client.mjs';
import { loginWithReach, loginWords, readReach, reachWords } from '../lib/login-reach.mjs';
import { storeName } from '../lib/credentials.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore login [--code] [--status] [--json]

Sign in to xgames.fun so you can publish your games (${CMD} publish). Your browser opens xgames.fun: sign in
there, tick the games this computer may work on (or your whole account) and approve. xcore says which it got; a game
you publish as new from here is added to them, and for another, run ${CMD} login again and tick it. xcore never sees
your password; it keeps a publish token for 30 days in ${storeName()} (never in a game or in this folder).
${CMD} logout ends it.
  --code     no browser on this machine (SSH, a container): open the printed link anywhere and paste the code it shows
  --status   who this computer is signed in as, which games it reaches, and where the token is kept
GAMESFUN_STUDIO=<origin> signs in to another xgames.fun (a local Studio while developing).`;

export default {
  name: 'login',
  summary: 'sign in to xgames.fun so you can publish your games',
  usage,
  run: args =>
    guard(async () => {
      const { values } = parse(args, { code: { type: 'boolean' }, status: { type: 'boolean' } }, usage);
      const origin = studioOrigin();
      if (values.status) {
        const { token: _token, words, ...s } = await signInState(origin);
        const reach = s.state === 'signed-in' ? await readReach(origin) : null;
        if (values.json)
          printJson({
            ...s,
            signedIn: s.state === 'signed-in',
            ...(reach ? { scope: reach.scope, games: reach.games } : {}),
          });
        else
          console.log(
            s.state === 'signed-in'
              ? `${words}${reachWords(reach) ? ` ${reachWords(reach)}` : ''}`
              : `${words} Run: ${s.next}`,
          );
        return 0;
      }
      const rl = values.code ? createInterface({ input: process.stdin, output: process.stderr }) : null;
      try {
        const r = await loginWithReach({
          origin,
          code: values.code,
          open: url => openUrl(url, { web: true }),
          prompt: q => rl.question(q),
          log: m => console.error(m),
        });
        if (values.json) printJson({ studio: origin, ...r });
        else console.log(loginWords(r));
        return 0;
      } finally {
        rl?.close();
      }
    }, args),
};
