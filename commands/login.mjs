import { createInterface } from 'node:readline/promises';
import { guard, parse, printJson } from '../lib/cli.mjs';
import { openUrl } from '../lib/open.mjs';
import { login, savedLogin, studioOrigin } from '../lib/publish/client.mjs';
import { storeName } from '../lib/credentials.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore login [--code] [--status] [--json]

Sign in to games.fun so you can publish your games (${CMD} publish). Your browser opens games.fun: sign in
there and approve this computer. xcore never sees your password; it keeps a publish token for 30 days in
${storeName()} (never in a game or in this folder). ${CMD} logout ends it.
  --code     no browser on this machine (SSH, a container): open the printed link anywhere and paste the code it shows
  --status   who this computer is signed in as, and where the token is kept
GAMESFUN_STUDIO=<origin> signs in to another games.fun (a local Studio while developing).`;

export default {
  name: 'login',
  summary: 'sign in to games.fun so you can publish your games',
  usage,
  run: args =>
    guard(async () => {
      const { values } = parse(args, { code: { type: 'boolean' }, status: { type: 'boolean' } }, usage);
      const origin = studioOrigin();
      if (values.status) {
        const s = await savedLogin(origin);
        const out = s
          ? { studio: origin, email: s.email, expiresAt: s.expiresAt, store: s.store }
          : { studio: origin, signedIn: false };
        if (values.json) printJson(out);
        else
          console.log(
            s
              ? `Signed in to ${origin} as ${s.email} until ${s.expiresAt} (token in ${s.store === 'file' ? 'a file only you can read' : s.store}).`
              : `Not signed in to ${origin}. Run: ${CMD} login`,
          );
        return 0;
      }
      const rl = values.code ? createInterface({ input: process.stdin, output: process.stderr }) : null;
      try {
        const r = await login({
          origin,
          code: values.code,
          open: url => openUrl(url, { web: true }),
          prompt: q => rl.question(q),
          log: m => console.error(m),
        });
        if (values.json) printJson({ studio: origin, ...r });
        else
          console.log(
            `Signed in to ${origin} as ${r.email}. The token is kept in ${r.store === 'file' ? 'a file only you can read' : r.store === 'dpapi' ? 'a file encrypted for your Windows user' : r.store === 'keychain' ? 'the macOS keychain' : 'the Secret Service'} until ${new Date(r.expiresAt).toISOString().slice(0, 10)}. Next: ${CMD} publish`,
          );
        return 0;
      } finally {
        rl?.close();
      }
    }),
};
