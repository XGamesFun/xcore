import { guard, parse, printJson } from '../lib/cli.mjs';
import { logout, studioOrigin } from '../lib/publish/client.mjs';
import { forgetReach } from '../lib/login-reach.mjs';

const usage = `Usage: xcore logout [--json]

Sign this computer out of xgames.fun: the publish token is revoked at xgames.fun and forgotten on this computer. Your
published games stay published.`;

// signed out here, but not revoked at xgames.fun: why, and whether anything is left to do
const NOT_REVOKED = {
  ended: o => `Signed out of ${o}; its token had already ended there (expired or revoked).`,
  unreadable: o =>
    `Forgot the sign-in on this computer, but this session could not read its token (it is kept where this session cannot reach, such as the Secret Service over SSH), so it was not revoked at ${o}. It ends by itself when it expires; revoke it from xgames.fun if you need it gone sooner.`,
  offline: o =>
    `Forgot the token on this computer, but ${o} did not answer, so it may still be live until it expires; revoke it from xgames.fun if you need to.`,
  refused: o =>
    `Forgot the token on this computer, but ${o} did not revoke it, so it may still be live until it expires; revoke it from xgames.fun if you need to.`,
};

export default {
  name: 'logout',
  summary: 'sign this computer out of xgames.fun (revokes its publish token)',
  usage,
  run: args =>
    guard(async () => {
      const { values } = parse(args, {}, usage);
      const origin = studioOrigin();
      const r = await logout(origin);
      await forgetReach(origin);
      if (values.json) printJson({ studio: origin, ...r });
      else
        console.log(
          !r.forgot
            ? `This computer was not signed in to ${origin}.`
            : r.revoked
              ? `Signed out of ${origin}; the token is revoked.`
              : NOT_REVOKED[r.why](origin),
        );
      return 0;
    }, args),
};
