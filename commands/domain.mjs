// `xcore domain`: the game served on a domain of your own, like play.mygame.com (../lib/publish/site.mjs).
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame } from '../lib/games.mjs';
import { changeDomain, describeDomain, describeSite, gameSite } from '../lib/publish/site.mjs';
import { studioOrigin } from '../lib/publish/client.mjs';
import { staleClient } from '../lib/add.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore domain [list] [dir] [--json]
       xcore domain add <domain> [dir] [--json]
       xcore domain check <domain> [dir] [--json]
       xcore domain remove <domain> [dir] [--json]

The published game on a domain of your own (play.mygame.com), besides its xgames.fun link: players see your
address, and sign-in, saves, scores, rooms and the economy work there as on games.fun. Creator has 1 domain, Scale 5;
Free has none. Sign-in still opens a small games.fun window, and a post on X still uses the xgames.fun link.
  list              the domains and their state
  add <domain>      ask for one: prints the DNS records to add where your domain's DNS is
  check <domain>    look at its records now (games.fun also checks by itself); live once they are right
  remove <domain>   stop serving the game there
A game whose plan no longer has room for a domain keeps it, paused: it sends players to the xgames.fun link.`;

const plainly = e => {
  // games.fun's own words already say what to do; add the command only when they don't
  if (e?.code === 'plan')
    throw new Error(
      /plan activate/.test(e.message)
        ? e.message
        : `${e.message} Custom domains come with Creator (1) and Scale (5): put the game in a slot with ${CMD} plan activate.`,
    );
  if (e?.code === 'domains-off')
    throw new Error(`${e.message} (custom domains need games.fun's operator to set them up first.)`);
  throw e;
};

export default {
  name: 'domain',
  summary: 'serve the published game on a domain of your own (play.mygame.com): add, check, list, remove',
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(args, {}, usage);
      const verbs = ['list', 'add', 'check', 'remove'];
      const verb = verbs.includes(positionals[0]) ? positionals[0] : 'list';
      const rest = verbs.includes(positionals[0]) ? positionals.slice(1) : positionals;
      const needs = verb !== 'list';
      if (needs && !rest[0]) throw new UsageError(`${verb} needs a domain, like play.mygame.com\n\n${usage}`);
      if (rest.length > (needs ? 2 : 1)) throw new UsageError(usage);
      const dir = await resolveGame(needs ? rest[1] : rest[0]);
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
      if (!d) throw new Error(`games.fun did not answer with ${host}.`);
      console.log(describeDomain(d));
      if (d.status !== 'active')
        console.log(
          `\nThen: ${CMD} domain check ${host} (DNS can take a few minutes; games.fun also checks by itself).`,
        );
      // the page must know its domain: gamesfun.js 1.2.0 asks the play edge which game it is on a host of its own
      const stale = await staleClient(dir).catch(() => []);
      if (stale.length)
        console.log(
          `\nThis folder's ${stale.join(', ')} is older than this xcore's: on its own domain an older copy can't tell which game it is, so sign-in fails there. Run ${CMD} add signin ${dir}, then ${CMD} publish ${dir}, so the page knows its domain.`,
        );
      return 0;
    }),
};
