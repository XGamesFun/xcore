// `xcore card [dir]`: the game's preview picture, what a link to it shows when it is shared (../lib/card.mjs). A
// picture of the game as it plays, or of a picture the person has, written as assets/card.jpg where publish takes it.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import { CARD_FILE, CARD_MAX_BYTES, CARD_SIZE, cardVerdict, makeCard } from '../lib/card.mjs';
import { pageRoots } from '../lib/publish/page.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore card [dir] [--wait <seconds>] [--tap] [--path <path-and-query>] [--from <picture>] [--force] [--no-build] [--json]

Make the game's preview picture: what a link to it shows when it is shared (a post on X, a chat). xgames.fun draws a
${CARD_SIZE}×${CARD_SIZE} card for the link with this picture behind it, "XGames.fun" and the game's title over its top left and
a "Tap to play" button over its bottom left; without a picture the card is a plain gradient with the title. Publish
asks for one (${CMD} publish --no-card goes without).
It writes ${CARD_FILE} (${CARD_SIZE}×${CARD_SIZE}, a JPEG of at most ${CARD_MAX_BYTES.toLocaleString('en-US')} bytes) into the files that go up:
the game's folder, or for a game you brought with a build, the folder its build copies as it is (gamesfun.json
page.static, such as public/), so the build carries it into what is published. It never replaces one that is there
without --force.
By default it serves the game as the page check does, opens it in Chrome at ${CARD_SIZE}×${CARD_SIZE}, waits, and takes a picture.
  --wait <seconds>  how long to wait after the page loads (default 4)
  --tap             tap the middle of the page once first (a game that starts on a tap)
  --path <path>     open another page of the game, with its query (level.html?demo=1)
  --from <picture>  make it from a picture you have (key art, a screenshot): scaled to cover the square and cropped
                    to its middle
  --force           replace the ${CARD_FILE} that is there
  --no-build        a game with a build: take the picture of what is built already
Then open the picture and look at it: the title goes over its top left and the button over its bottom left, so what
matters belongs in the middle.`;

export default {
  name: 'card',
  summary: "make the game's preview picture: what a shared link to it shows (assets/card.jpg)",
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(
        args,
        {
          wait: { type: 'string' },
          tap: { type: 'boolean' },
          path: { type: 'string' },
          from: { type: 'string' },
          force: { type: 'boolean' },
          'no-build': { type: 'boolean' },
        },
        usage,
      );
      if (positionals.length > 1) throw new UsageError(usage);
      const wait = values.wait === undefined ? 4 : Number(values.wait);
      if (!Number.isFinite(wait) || wait < 0 || wait > 120)
        throw new UsageError(`--wait takes a number of seconds (0–120)\n\n${usage}`);
      if (values.from && (values.tap || values.path !== undefined || values.wait !== undefined))
        throw new UsageError(
          `--from makes the picture from a file: --wait, --tap and --path are for the game's page\n\n${usage}`,
        );
      const dir = await resolveGame(positionals[0]);
      // its progress goes to stderr: stdout stays the command's own (the JSON of --json)
      const log = l => console.error(l);
      const r = await makeCard(dir, {
        from: values.from ?? null,
        wait,
        tap: values.tap === true,
        path: values.path ?? '',
        force: values.force === true,
        noBuild: values['no-build'] === true,
        log,
      }).catch(e => {
        if (e.code === 'exists') throw Object.assign(e, { next: `${CMD} card ${shown(dir)} --force` });
        throw e;
      });
      const roots = pageRoots(dir);
      const rel = p => path.relative(roots.dir, p).split(path.sep).join('/') || '.';
      const verdict = cardVerdict({ path: CARD_FILE, bytes: r.bytes, head: await readFile(r.file) });
      if (values.json) {
        printJson({
          ok: verdict.status === 'ok',
          file: r.file,
          bytes: r.bytes,
          width: r.width,
          height: r.height,
          from: r.from,
          where: r.target.how,
          replaced: r.replaced,
        });
        return verdict.status === 'ok' ? 0 : 1;
      }
      const lines = [
        `${r.replaced ? 'Replaced' : 'Wrote'} ${shown(r.file)}: ${r.width}×${r.height}, ${(r.bytes / 1000).toFixed(0)} KB${r.from ? `, from ${shown(r.from)}` : ''}.`,
      ];
      if (verdict.status !== 'ok') lines.push(`  It cannot be used as it is: ${verdict.why}.`);
      if (r.target.how === 'static')
        lines.push(
          `  It is in ${rel(r.target.folder)}/, the folder ${roots.build} copies as it is: the build carries it into ${rel(roots.out)}/, which is what goes up (publish builds first).`,
        );
      else if (r.target.how === 'overlay')
        lines.push(
          `  It is in ${rel(r.target.folder)}/, which xcore lays over ${rel(roots.out)}/ when it publishes (gamesfun.json page.static), so an export does not remove it.`,
        );
      else if (r.target.how === 'out-rebuilt')
        lines.push(
          `  It is in ${rel(roots.out)}/, what ${roots.build} makes, and the next build may remove it: put ${CARD_FILE} in the folder your build copies as it is (public/ for Vite), and name that folder in gamesfun.json page.static.`,
        );
      for (const a of r.also) lines.push(`  ${shown(a)} is there too: ${CARD_FILE} is the one xgames.fun uses now.`);
      lines.push(
        '  The card draws "XGames.fun" and the title over its top left and a "Tap to play" button over its bottom left: what matters belongs in the middle.',
        `  Open ${shown(r.file)} and look at it before you publish${r.from ? '' : ': a loading screen or a blank page makes a poor card (--wait, --tap, --path, or --from a picture you have)'}.`,
      );
      console.log(lines.join('\n'));
      return verdict.status === 'ok' ? 0 : 1;
    }, args),
};
