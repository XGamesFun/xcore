// `xcore card [dir]`: the game's preview picture, what a link to it shows when it is shared (../lib/card.mjs). A
// picture of the game as it plays, or of a picture the person has, written as assets/card.jpg where publish takes it.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import {
  CARD_CLEAR,
  CARD_FILE,
  CARD_MAX_BYTES,
  CARD_SIZE,
  FROM_MAX_BYTES,
  cardJson,
  cardVerdict,
  drawable,
  makeCard,
} from '../lib/card.mjs';
import { pageRoots } from '../lib/publish/page.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore card [dir] [--wait <seconds>] [--tap] [--path <path-and-query>] [--from <picture>] [--force] [--no-build] [--json]

Make the game's preview picture: what a link to it shows when it is shared (a post on X, a chat). xgames.fun draws a
${CARD_SIZE}×${CARD_SIZE} card for the link with this picture behind it, "XGames.fun" and the game's title drawn large across its
top band and a "Tap to play" button at its bottom left; without a picture the card is a plain gradient with the
title. Publish asks for one (${CMD} publish --no-card goes without).
It writes ${CARD_FILE} (${CARD_SIZE}×${CARD_SIZE}, a JPEG of at most ${CARD_MAX_BYTES.toLocaleString('en-US')} bytes) into the files that go up:
the game's folder, or for a game you brought with a build, the folder its build copies as it is (gamesfun.json
page.static, such as public/), so the build carries it into what is published; a build with no such folder is told
where the picture has to live. It never replaces a picture that is there (card.jpg, or a card.png xgames.fun can
draw) without --force.
By default it serves the game as the page check does, opens it in Chrome at ${CARD_SIZE}×${CARD_SIZE}, waits, and takes a picture.
A page that does not answer, or answers with an error, makes no picture; one that throws or logs errors makes one
and says so, and the command fails unless --force.
  --wait <seconds>  how long to wait after the page loads (default 4)
  --tap             tap the middle of the page once first (a game that starts on a tap)
  --path <path>     open another page of the game, with its query (level.html?demo=1)
  --from <picture>  make it from a picture you have (key art, a screenshot; at most ${FROM_MAX_BYTES / 1024 / 1024} MB): scaled to cover
                    the square and cropped to its middle. --from ${CARD_FILE} --force re-crops the one there.
  --force           replace the picture that is there; keep one taken while the page had errors
  --no-build        a game with a build: take the picture of what is built already
Then open the picture and look at it: ${CARD_CLEAR}.`;

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
      // a page that threw or logged errors: the picture is written, and it fails unless --force says keep it
      const failed = !drawable(verdict) || (r.errors.length > 0 && !values.force);
      if (values.json) {
        printJson({
          ok: !failed,
          file: r.file,
          bytes: r.bytes,
          width: r.width,
          height: r.height,
          from: r.from,
          where: r.target.how,
          replaced: r.replaced,
          over: r.over,
          errors: r.errors,
          card: cardJson(verdict),
        });
        return failed ? 1 : 0;
      }
      const lines = [
        `${r.replaced ? 'Replaced' : 'Wrote'} ${shown(r.file)}: ${r.width}×${r.height}, ${(r.bytes / 1000).toFixed(0)} KB${r.from ? `, from ${shown(r.from)}` : ''}.`,
      ];
      if (r.errors.length)
        lines.push(
          `  The page had errors before the picture was taken, so it may show an error or a blank page: ${r.errors.slice(0, 3).join('; ')}${r.errors.length > 3 ? ` (and ${r.errors.length - 3} more)` : ''}.`,
          values.force
            ? '  Kept, as --force says.'
            : `  Look at it: fix the page (${CMD} check ${shown(dir)}) and run again, keep it with --force, or make it --from a picture you have.`,
        );
      if (!drawable(verdict)) lines.push(`  xgames.fun cannot draw it as it is: ${verdict.why}.`);
      if (r.target.how === 'static')
        lines.push(
          `  It is in ${rel(r.target.folder)}/, the folder ${roots.build} copies as it is: the build carries it into ${rel(roots.out)}/, which is what goes up (publish builds first).`,
        );
      else if (r.target.how === 'overlay')
        lines.push(
          `  It is in ${rel(r.target.folder)}/, which xcore lays over ${rel(roots.out)}/ when it publishes (gamesfun.json page.static), so an export does not remove it.`,
        );
      if (r.over)
        lines.push(`  ${CARD_FILE} now wins over ${shown(r.over)}: xgames.fun uses card.jpg when both are there.`);
      lines.push(
        `  The card draws "XGames.fun" and the title large across its top band and a "Tap to play" button at its bottom left: ${CARD_CLEAR}.`,
        `  Open ${shown(r.file)} and look at it before you publish${r.from ? '' : ': a loading screen or a blank page makes a poor card (--wait, --tap, --path, or --from a picture you have)'}.`,
      );
      console.log(lines.join('\n'));
      return failed ? 1 : 0;
    }, args),
};
