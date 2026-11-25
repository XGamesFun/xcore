// `xcore domain`: the game served on a domain of your own, like play.mygame.com (../lib/publish/site.mjs).
import { guard, parse, printJson, UsageError, tooMany, folderArg, verbOrFolder } from '../lib/cli.mjs';
import { resolveGame } from '../lib/games.mjs';
import { changeDomain, describeDomain, describeSite, gameSite } from '../lib/publish/site.mjs';
import { studioOrigin } from '../lib/publish/client.mjs';
import { staleClient } from '../lib/add.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore domain [list] [dir] [--json]
       xcore domain add <domain> [dir] [--json]
       xcore domain check <domain> [dir] [--json]
       xcore domain remove <domain> [dir] [--json]

The game's folder is the last word or --dir <folder> (default: the current directory). ls also means list, and rm or delete also mean remove.

Serve the published game on your own domain (play.mygame.com) in addition to its xgames.fun link.

Players see your address, and sign-in, saves, scores, rooms and the economy work there as they do on xgames.fun.
Sign-in still opens a small xgames.fun window, and a post on X still uses the xgames.fun link.

Domains per plan: Free 0, Creator 1, Scale 5.

Commands:
  list              list the domains and their state
  add <domain>      request a domain; prints the DNS records to add at your DNS provider
  check <domain>    check its DNS records now (xgames.fun also checks on its own); the domain goes live once they
                    are correct
  remove <domain>   stop serving the game there

If the game's plan no longer allows a domain, the domain is kept but paused: it redirects players to the xgames.fun
link.`;

const plainly = e => {
  // xgames.fun's own words already say what to do; add the command only when they don't
  // (an older xgames.fun's words name `xcore plan activate`, which is gone: that part is left out)
  if (e?.code === 'plan') {
    const words = e.message.replace(/:?\s*[^.:]*plan activate[^.]*\.?\s*$/, '.').replace(/\.\.$/, '.');
    const account =
      'a Creator account runs every game you own (up to 10) at Creator limits. Buy or renew it in your console → Plans.';
    throw new Error(
      /console → Plans/.test(words)
        ? words
        : words !== e.message
          ? `${words} ${account[0].toUpperCase()}${account.slice(1)}`
          : `${words} Custom domains come with Creator (1) and Scale (5): ${account}`,
    );
  }
  if (e?.code === 'domains-off')
    throw new Error(`${e.message} (custom domains need xgames.fun's operator to set them up first.)`);
  throw e;
};

export default {
  name: 'domain',
  summary: 'serve the published game on your own domain',
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(args, { dir: { type: 'string' } }, usage);
      const { verb, rest } = verbOrFolder(positionals, ['list', 'add', 'check', 'remove'], 'list', usage);
      const needs = verb !== 'list';
      if (needs && !rest[0]) throw new UsageError(`${verb} needs a domain, like play.mygame.com\n\n${usage}`);
      if (rest.length > (needs ? 2 : 1)) throw new UsageError(`${tooMany(rest.slice(needs ? 2 : 1))}\n\n${usage}`);
      const dir = await resolveGame(folderArg(values.dir, needs ? rest[1] : rest[0], usage));
      const out = values.json ? printJson : null;
      const origin = studioOrigin();
      if (verb === 'list') {
        const site = await gameSite(dir).catch(plainly);
        if (out) out(site);
        else console.log(describeSite(site, origin));
        return 0;
      }
      const site = await changeDomain(dir, verb, rest[0]).catch(plainly);
      if (out) {
        out(site);
        return 0;
      }
      const host = String(rest[0])
        .trim()
        .toLowerCase()
        .replace(/^[a-z]+:\/\//, '')
        .replace(/\/.*$/, '');
      const d = site.domains?.find(x => x.hostname === host);
      if (verb === 'remove') {
        console.log(
          `${host} no longer serves the game; its xgames.fun link still does. You can delete its DNS records.`,
        );
        return 0;
      }
      if (!d) throw new Error(`xgames.fun did not answer with ${host}.`);
      console.log(describeDomain(d));
      if (d.status !== 'active')
        console.log(
          `\nThen: ${CMD} domain check ${host} (DNS can take a few minutes; xgames.fun also checks by itself).`,
        );
      // the page must know its domain: gamesfun.js asks the play edge which game it is on a host of its own, and an
      // older copy does not
      // a hint after the domain was added: a folder whose copies can't be read gets none, and the domain stays added
      const stale = await staleClient(dir).catch(() => []);
      if (stale.length)
        console.log(
          `\nThis folder's ${stale.join(', ')} is older than this xcore's: on its own domain an older copy can't tell which game it is, so sign-in fails there. Run ${CMD} add signin ${dir}, then ${CMD} publish ${dir}, so the page knows its domain.`,
        );
      return 0;
    }, args),
};
