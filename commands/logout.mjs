import { guard, parse, printJson } from '../lib/cli.mjs';
import { logout, studioOrigin } from '../lib/publish/client.mjs';

const usage = `Usage: xcore logout [--json]

Sign this computer out of games.fun: the publish token is revoked at games.fun and forgotten on this computer. Your
published games stay published.`;

export default {
  name: 'logout',
  summary: 'sign this computer out of games.fun (revokes its publish token)',
  usage,
  run: args =>
    guard(async () => {
      const { values } = parse(args, {}, usage);
      const origin = studioOrigin();
      const r = await logout(origin);
      if (values.json) printJson({ studio: origin, ...r });
      else
        console.log(
          !r.forgot
            ? `This computer was not signed in to ${origin}.`
            : r.revoked
              ? `Signed out of ${origin}; the token is revoked.`
              : `Forgot the token on this computer, but ${origin} did not answer, so it may still be live until it expires; revoke it from games.fun if you need to.`,
        );
      return 0;
    }),
};
