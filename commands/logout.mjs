import { guard, parse, printJson } from '../lib/cli.mjs';
import { logout, signInsPage, studioOrigin } from '../lib/publish/client.mjs';
import { forgetReach } from '../lib/login-reach.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore logout [--forget] [--json]

Sign this computer out of xgames.fun. The publish token is revoked on xgames.fun and deleted from this computer.
Your published games stay published.

If xgames.fun does not answer or does not revoke it, the token is kept here, so you can run ${CMD} logout again.
--forget deletes it from this computer anyway; it then stays live until it expires, unless you revoke it on
xgames.fun (your console → Sign-ins).`;

// not revoked at xgames.fun: why, and what is left to do
/** How xgames.fun failed to answer a revoke: not at all, or with a server error (its HTTP status). */
const noAnswer = status => (status ? `answered with a server error (${status})` : 'did not answer');

const NOT_REVOKED = {
  ended: o => `Signed out of ${o}; its token had already ended there (expired or revoked).`,
  unreadable: o =>
    `Forgot the sign-in on this computer, but this session could not read its token (it is kept where this session cannot reach, such as the Secret Service over SSH), so it was not revoked at ${o}. It ends by itself when it expires; to end it sooner, revoke it at ${signInsPage(o)}.`,
  offline: (o, forgot, status) =>
    forgot
      ? `Forgot the token on this computer, but ${o} ${noAnswer(status)}, so it may still be live until it expires; to end it, revoke it at ${signInsPage(o)}.`
      : `Not signed out: ${o} ${noAnswer(status)}, so the token could not be revoked. It is kept on this computer so you can try again: ${CMD} logout. To forget it here anyway: ${CMD} logout --forget (it then stays live until it expires, or until you revoke it at ${signInsPage(o)}).`,
  refused: (o, forgot) =>
    forgot
      ? `Forgot the token on this computer, but ${o} did not revoke it, so it may still be live until it expires; to end it, revoke it at ${signInsPage(o)}.`
      : `Not signed out: ${o} did not revoke the token. It is kept on this computer so you can try again: ${CMD} logout. To forget it here anyway: ${CMD} logout --forget (it then stays live until it expires, or until you revoke it at ${signInsPage(o)}).`,
};

export default {
  name: 'logout',
  summary: 'sign this computer out of xgames.fun and revoke its publish token',
  usage,
  run: args =>
    guard(async () => {
      const { values } = parse(args, { forget: { type: 'boolean' } }, usage);
      const origin = studioOrigin();
      const r = await logout(origin, { forget: !!values.forget });
      const kept = !r.forgot && !!r.why;
      if (!kept) await forgetReach(origin);
      if (values.json) printJson({ studio: origin, ...r, ...(kept ? { next: `${CMD} logout` } : {}) });
      else
        console.log(
          kept
            ? NOT_REVOKED[r.why](origin, false, r.status)
            : !r.forgot
              ? `This computer was not signed in to ${origin}.`
              : r.revoked
                ? `Signed out of ${origin}; the token is revoked.`
                : NOT_REVOKED[r.why](origin, true, r.status),
        );
      // still signed in: not a sign-out
      return kept ? 1 : 0;
    }, args),
};
