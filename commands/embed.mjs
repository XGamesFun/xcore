// `xcore embed`: the sites of your own that may show the published game in a frame (../lib/publish/site.mjs).
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame } from '../lib/games.mjs';
import { changeEmbed, describeSite, embedSnippet, gameSite, playUrl } from '../lib/publish/site.mjs';
import { studioOrigin } from '../lib/publish/client.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore embed [list] [dir] [--json]
       xcore embed add <site> [dir] [--json]
       xcore embed remove <site> [dir] [--json]

Allow your own sites to show the published game in a frame (an <iframe> in your page), in addition to xgames.fun
and posts on X.

A site is given as its origin: https://mygame.com (or http://localhost:<port> during development). Changes take
effect within about a minute, without a publish.

Sites per plan: Free 3, Creator 10, Scale 25.

Commands:
  list            list the sites, and where the game plays
  add <site>      allow a site, and print the <iframe> to put in its page
  remove <site>   remove a site

When framed on your site, the game signs players in itself (with a small xgames.fun window, or a code), as it does in
a post on X. Your page cannot sign players in for it.`;

export default {
  name: 'embed',
  summary: 'allow your own sites to show the published game in an <iframe>',
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(args, {}, usage);
      const verbs = ['list', 'add', 'remove'];
      const verb = verbs.includes(positionals[0]) ? positionals[0] : 'list';
      const rest = verbs.includes(positionals[0]) ? positionals.slice(1) : positionals;
      const needs = verb !== 'list';
      if (needs && !rest[0]) throw new UsageError(`${verb} needs a site, like https://mygame.com\n\n${usage}`);
      if (rest.length > (needs ? 2 : 1)) throw new UsageError(usage);
      const dir = await resolveGame(needs ? rest[1] : rest[0]);
      const out = values.json ? printJson : null;
      const origin = studioOrigin();
      if (verb === 'list') {
        const site = await gameSite(dir);
        if (out) out(site);
        else console.log(describeSite(site, origin));
        return 0;
      }
      const r = await changeEmbed(dir, rest[0], verb === 'add').catch(e => {
        if (e?.code === 'plan') throw new Error(`${e.message} More sites come with a bigger plan: ${CMD} plan.`);
        throw e;
      });
      if (out) out(r.site);
      else if (verb === 'add') {
        const url = playUrl(r.site, origin);
        console.log(
          `${r.changed ? `${r.origin} may now show the game` : `${r.origin} was already allowed`} (it applies within about a minute).` +
            (url ? `\nPut this in its page:\n\n  ${embedSnippet(url)}\n` : ''),
        );
      } else console.log(r.changed ? `${r.origin} may no longer show the game.` : `${r.origin} was not on the list.`);
      return 0;
    }, args),
};
