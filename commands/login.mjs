import { createInterface } from 'node:readline/promises';
import { guard, parse, printJson } from '../lib/cli.mjs';
import { openUrl } from '../lib/open.mjs';
import { call, signInState, studioOrigin } from '../lib/publish/client.mjs';
import { currentReach, loginWithReach, loginWords, reachWords } from '../lib/login-reach.mjs';
import { storeName } from '../lib/credentials.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore login [--code] [--status] [--json]

Sign this computer in to xgames.fun so you can publish games (${CMD} publish).

Your browser opens xgames.fun. Sign in there, choose the games this computer may work on (or your whole account),
and approve. xcore reports which games it was given. A game you publish as new from this computer is added to them;
to work on another existing game, run ${CMD} login again and select it.

xcore never sees your password. It keeps a publish token for 30 days in ${storeName()}, never in a game or in this
folder. ${CMD} logout ends the session.

Options:
  --code     for a machine with no browser (SSH, a container): open the printed link on any device and paste the code
             it shows
  --status   show who this computer is signed in as, whether xgames.fun still takes its token (asked once), which
             games it can reach, and where the token is kept
  --json     print the result as JSON

Environment:
  GAMESFUN_STUDIO=<origin>  sign in to another xgames.fun (a local Studio during development)`;

/**
 * Whether xgames.fun takes the saved token now (GET /api/kit/me): {said: 'ok'} | {said: 'ended', words} (revoked or
 * expired there) | {said: 'unreachable' | 'error', why, words} (not confirmed).
 */
async function studioSays(origin, token) {
  try {
    await call(origin, '/api/kit/me', { token });
    return { said: 'ok', words: '' };
  } catch (e) {
    if (e.status === 401 || e.status === 403)
      return {
        said: 'ended',
        words: `But xgames.fun says this sign-in has ended (revoked, or signed out elsewhere): sign in again (${CMD} login).`,
      };
    return {
      said: e.code === 'unreachable' ? 'unreachable' : 'error',
      why: e.message,
      words: `Not confirmed with xgames.fun: ${e.message.replace(/\.$/, '')}.`,
    };
  }
}

export default {
  name: 'login',
  summary: 'sign this computer in to xgames.fun so you can publish',
  usage,
  run: args =>
    guard(async () => {
      const { values } = parse(args, { code: { type: 'boolean' }, status: { type: 'boolean' } }, usage);
      const origin = studioOrigin();
      if (values.status) {
        const { token, words, ...s } = await signInState(origin);
        const reach = s.state === 'signed-in' ? await currentReach(origin) : null;
        // the record here says signed in: xgames.fun is asked once whether the token still works
        const says = s.state === 'signed-in' ? await studioSays(origin, token) : null;
        const next = says?.said === 'ended' ? `${CMD} login` : s.next;
        if (values.json)
          printJson({
            ...s,
            next,
            signedIn: s.state === 'signed-in' && says?.said !== 'ended',
            ...(says
              ? { confirmed: says.said === 'ok', studioSays: says.said, ...(says.why ? { why: says.why } : {}) }
              : {}),
            ...(reach ? { scope: reach.scope, games: reach.games, reachChecked: reach.checked } : {}),
          });
        else
          console.log(
            s.state === 'signed-in'
              ? `${words}${says.words ? ` ${says.words}` : ''}${reachWords(reach) ? ` ${reachWords(reach)}` : ''}`
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
