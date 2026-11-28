// `xcore publish`: a game to xgames.fun at a link anyone can play (../lib/publish/index.mjs). publishCommand makes the
// command: this package's own, which checks a game by the page check, and the kit's (@xgamesfun/kit), which passes its
// six gates, its name, its upkeep and its own way of finding a game. A game the kit made goes to the kit's (../bin).
import { guard, parse, printJson } from '../lib/cli.mjs';
import { resolveGame as findGame, shown as showDir, named as nameOf } from '../lib/games.mjs';
import { checkSummary, LABEL, pageCheck, preflight, publishGame, publishStatus } from '../lib/publish/index.mjs';
import { studioOrigin } from '../lib/publish/client.mjs';
import { gate } from '../lib/publish/gate.mjs';
import { buildFailure, pageRoots, runBuild } from '../lib/publish/page.mjs';
import { CMD } from '../lib/command.mjs';
import { confirmFirstPublish, creatorCapWords, firstPublish } from '../lib/publish/first.mjs';
import { reviewNudge } from '../lib/review.mjs';
import { cardPrinted, drawable } from '../lib/card.mjs';
import { plural, sizeText } from '../lib/util.mjs';
import { uploadWords } from '../lib/publish/tree.mjs';

const usage = `Usage: xcore publish [dir] [--draft] [--new] [--title <name>] [--no-card] [--yes <code>] [--status] [--check [--verify [--port <n>]]] [--json]

Publish a game to xgames.fun at a link anyone can play. xgames.fun hosts it; you do not need a server.

Sign in first with ${CMD} login. In a GitHub Actions job with "permissions: id-token: write", the job's OIDC token
is used instead of a login.

The first publish of a folder creates a new game on the account this computer is signed in to, and counts toward
its games (2 on a Free account, one of its free slots; up to 10 on a Creator account). It first prints the account,
the game's name and where it goes, and changes nothing; an account with no room for another game is told so before
anything is uploaded. At a terminal, type "publish" to go on; otherwise run the same command again with --yes <code>,
using the code it prints. Publishing a folder that is already linked to a game updates that game without asking.

What happens:
  - A game you adopted (${CMD} adopt) is built first if it has a build. Its published folder (gamesfun.json
    page.out) is uploaded, with its server/ bundle if it has one.
  - The page check (${CMD} check) must pass on the files being published. It runs again unless nothing changed
    since it last passed.
  - If the checks fail, the game is uploaded only as a private draft, and you are told which checks failed.
  - Files that look like keys, .env files and symbolic links stop the publish. evidence/, hidden files and notes at
    the top level (README.md, NOTES.md, LAUNCH.md and similar) are left out.
  - Only files xgames.fun does not already have are uploaded.
  - Server code (server/, a gf-server-v1 Worker) is sent as one bundled file, where xgames.fun accepts server code.
    server/ is never served as public files.
  - The link is unlisted: only people you give it to can find it. Publishing the same folder again makes a new
    version at the same link.

Preview picture:
  A link to the game shared on X or in a chat shows a square card with the game's picture behind its title. The
  picture is assets/card.jpg (or assets/card.png) in the published files: a JPEG or PNG with the matching extension,
  at most 1,500,000 bytes, ideally 960×960.
  - With no picture, publish makes one from the newest ${CMD} check screenshot (evidence/verify-N/), says so, and goes
    on. Replace it with ${CMD} card [dir] --force.
  - Publish stops before uploading anything if there is no picture and no screenshot, or xgames.fun cannot draw the
    picture (too big, not a JPEG or PNG, the wrong extension, truncated, or a JPEG variant it does not support). Make
    one with ${CMD} card [dir], or publish without one with --no-card (or "card": false in gamesfun.json).
  - A picture that is small (under 600 px a side: blurry) or far from square (cropped to its middle) is uploaded
    with a warning and its fix.
  - X and chat apps cache cards, so a link shared earlier can show the old card for a while.

Options:
  --draft        publish a private version in your xgames.fun Studio, with no public link
  --new          publish as a new game (a new link), not as an update of this folder's game
  --title <name> the game's name on xgames.fun (default: its page title)
  --yes <code>   confirm the first publish of a folder (a new game on the account), with the code that was printed
  --no-card      publish without a preview picture: the link shows a plain card (a gradient with the title)
  --status       show this folder's link and the account it is published from; publishes nothing
  --check        run only the offline checks (files, secrets, backend origins, the server bundle); publishes nothing
  --verify       with --check: also run the publish checks on these files and remember a pass, so the next publish
                 does not run them again (the GitHub Action's check step)
  --port <n>     with --verify: the port the page check serves on (default: any free port)
  --json         print the result as JSON

Environment:
  GAMESFUN_STUDIO=<origin>  publish to another xgames.fun (a local Studio during development)`;

/**
 * The publish command. check, label, prepare, rpcFile: as publishGame takes them (the kit's six gates, its name, its
 * upkeep, its workspace's .env); resolveGame and shown: how the command finds a game and names its folder. card:
 * whether publish asks for the game's preview picture (../lib/card.mjs); by default only with this package's own check
 * (a kit with its own check makes its own card), and false turns it off.
 */
export function publishCommand({
  check = pageCheck,
  card = check === pageCheck,
  label = LABEL,
  prepare,
  rpcFile,
  resolveGame = findGame,
  shown = showDir,
  named = nameOf,
} = {}) {
  const own = { check, label, ...(prepare ? { prepare } : {}), ...(rpcFile ? { rpcFile } : {}) };
  return {
    name: 'publish',
    summary: 'publish the game to xgames.fun at an unlisted link anyone can play',
    usage,
    run: args =>
      guard(async () => {
        const { values, positionals } = parse(
          args,
          {
            draft: { type: 'boolean' },
            new: { type: 'boolean' },
            title: { type: 'string' },
            status: { type: 'boolean' },
            check: { type: 'boolean' },
            verify: { type: 'boolean' },
            port: { type: 'string' },
            'no-card': { type: 'boolean' },
            yes: { type: 'string' },
          },
          usage,
        );
        const askCard = card && !values['no-card'];
        const dir = await resolveGame(positionals[0]);
        const origin = studioOrigin();
        // a game that pays results through vouchers, changed since its last security review: one line, never a refusal
        const nudge = values.status || values.json ? null : reviewNudge(dir);
        if (nudge) console.error(nudge);
        if (values.status) {
          const s = await publishStatus(dir, { origin });
          if (values.json) printJson(s);
          else {
            console.log(
              s.signedIn
                ? `Signed in to ${origin} as ${s.signedIn.email ?? s.signedIn.as}.`
                : s.signIn.oidcError
                  ? `GitHub's OIDC token could not be had: ${s.signIn.oidcError}`
                  : s.signIn.state === 'expired'
                    ? `The sign-in to ${origin} ended on ${String(s.signIn.expiresAt).slice(0, 10)} (${CMD} login).`
                    : s.signIn.state === 'unreadable'
                      ? `Signed in to ${origin} as ${s.signIn.email}, but this session cannot read the token (${CMD} login here).`
                      : `Not signed in to ${origin} (${CMD} login).`,
            );
            console.log(statusLine(named(dir), origin, s));
          }
          return 0;
        }
        if (values.check) {
          // a brought game with a build: what is checked is what its build makes now
          const roots = pageRoots(dir);
          if (roots.build) {
            if (!values.json) console.error(`Building it (${roots.build})…`);
            const b = await runBuild(dir, { onLine: values.json ? () => {} : l => console.error(`  ${l}`) });
            if (b.code !== 0)
              throw Object.assign(
                new Error(
                  `Its build (${roots.build}) failed with exit code ${b.code}${buildFailure(b) ? ` (${buildFailure(b)})` : ''}: nothing was checked.`,
                ),
                { code: 'build' },
              );
          }
          const p = await preflight(dir, { origin });
          const ok = !p.problems.length && !p.secrets && !p.names;
          const out = checkSummary(p);
          if (ok && values.verify) {
            const g = await gate(dir, {
              check,
              run: true,
              kit: label,
              onLine: values.json ? () => {} : l => console.error(`  ${l}`),
              args: [...(roots.build ? ['--no-build'] : []), ...(values.port ? [`--port=${values.port}`] : [])],
              ...(roots.build ? { built: true } : {}),
            });
            out.verify = { ...g.report, reused: g.reused, changedDuring: g.changedDuring };
            out.ok = ok && g.report.pass;
          }
          if (values.json) printJson(out);
          else {
            console.log(
              ok
                ? checkLines(named(dir), out, p).join('\n')
                : [...p.problems, p.secrets, p.names].filter(Boolean).join('\n'),
            );
            // reported, never a refusal here: publish is what stops for it
            if (card)
              console.log(
                `  ${cardPrinted(askCard ? p.cardWords : { ...p.cardWords, level: p.cardWords.level === 'stop' ? 'off' : p.cardWords.level })}`,
              );
          }
          if (!values.json && out.verify) console.log(verifyLine(out.verify, shown(dir)));
          return out.ok ? 0 : 1;
        }
        // the first publish of a folder makes a game on the signed-in account, which counts toward its games: confirmed
        // first, and refused here when the account has no room (before anything is built or uploaded)
        const first = await firstPublish(dir, { origin, newGame: values.new, title: values.title ?? null });
        if (first?.full) throw first.full;
        if (first) {
          const go = await confirmFirstPublish(first, { args, values });
          if (go !== true) return go;
        }
        const r = await publishGame(dir, {
          ...own,
          origin,
          draft: values.draft,
          newGame: values.new,
          title: values.title ?? null,
          card: askCard,
          progress: values.json ? () => {} : l => console.error(l),
        }).catch(e => {
          // A new game needs room on the account (xgames.fun's words say so): name what makes some.
          // A Creator account at its cap (xgames.fun's 409 game-cap): the words of the check before uploading.
          if (e?.code === 'game-cap')
            throw Object.assign(
              new Error(
                creatorCapWords(Number(/up to (\d+) games?/.exec(e.message)?.[1]) || 10, {
                  origin,
                  then: 'No game was made.',
                }),
              ),
              { status: e.status, code: e.code, next: `${CMD} plan --all` },
            );
          if (e?.code === 'no-free-slot')
            throw Object.assign(
              new Error(
                `${e.message}\n  ${CMD} plan --all   your account and its games; archive one you no longer need on ${origin}/console\n  A Creator account runs every game you own, up to 10: your console → Plans`,
              ),
              { status: e.status, code: e.code },
            );
          throw e;
        });
        if (values.json) printJson(r.url ? { ...r, xPostUrl: playerCardUrl(r.url) } : r);
        else {
          console.log(
            (r.url
              ? publishedLines(r.title ? `“${r.title}”` : named(dir), r)
              : r.kept
                ? keptLines(r.title ? `“${r.title}”` : named(dir), r)
                : draftLines(named(dir), r, shown(dir))
            ).join('\n'),
          );
          if (r.url) {
            const line = cardAfter(r, origin, { asked: card, shown: shown(dir) });
            if (line) console.log(line);
          }
        }
        return r.url || values.draft ? 0 : 1;
      }, args),
  };
}

// ---- What the command prints. `where` is the game's folder as the person reads it. ----------------------------------

const failedNames = failed => failed.map(c => `${c.n} ${c.name}`).join('; ');

/**
 * `publish --status`: where this folder's game stands. xgames.fun's answer (what plays now, a takedown) leads; the
 * folder's own record (.gamesfun/publish.json) says what was last sent from here.
 */
export function statusLine(where, origin, s) {
  const k = s.known ?? {};
  const own = k.gameUrl ? `\n  the game itself: ${k.gameUrl}` : '';
  if (s.link === 'never') return `${where} has not been published to ${origin} yet.`;
  if (s.link === 'started')
    return `${where} was started on ${origin}, but no version finished going up. Run ${CMD} publish again; if xgames.fun answers that the game has no version yet, publish it with --new and archive the empty game in your console.${s.live?.error ? ` xgames.fun says: ${s.live.error}` : ''}`;
  // what plays now, by xgames.fun's word when it answered
  let now;
  if (s.live && !s.live.error)
    now = s.live.takenDown
      ? `${where} was taken down by xgames.fun: nothing plays at its link (${k.url ?? `/play/${k.slug}`}).`
      : s.live.published
        ? `${where} is live at ${s.live.url ?? k.url} (version ${s.live.version?.number}).`
        : `${where} is not live now: nothing plays at its link${k.url ? ` (${k.url})` : ''}.`;
  else
    now = `${where} ${k.url ? `was last published at ${k.url}` : 'has no public link yet'}${s.live?.error ? ` (xgames.fun did not say what plays now: ${s.live.error})` : ' (xgames.fun was not asked what plays now: not signed in)'}.`;
  const sent =
    s.link === 'kept'
      ? `  Version ${k.kept.version ?? '?'} was kept on xgames.fun but did not go live: ${k.kept.why ?? 'not published'}.`
      : s.link === 'draft' || s.link === 'draft-over-public'
        ? `  The latest version sent from here (${k.lastVersion}) is a private draft.`
        : `  The latest version sent from here: ${k.lastVersion}.`;
  return `${now}\n${sent}${own}`;
}

/** `publish --check` when nothing is refused: what goes up, and the server bundle when there is one. */
function checkLines(where, out, p) {
  const talks = p.backend.length ? ` It may talk to: ${p.backend.join(', ')}.` : '';
  const lines = [
    `${where}: ${uploadWords(out)}; nothing refused.${talks} ` + `Left out: ${out.skipped.join(', ') || 'nothing'}.`,
  ];
  const sv = out.server;
  if (sv?.has && sv.ok) {
    const extras = [
      ...(sv.objects.length ? [`Durable Objects ${sv.objects.join(', ')}`] : []),
      ...(sv.compatibilityFlags.length ? [sv.compatibilityFlags.join(', ')] : []),
    ];
    lines.push(
      sv.stock
        ? `  server code: xcore's stock server (${sizeText(sv.bytes)}, sha256 ${sv.sha256.slice(0, 12)}…), which serves the page's api/db/ from the game's database under gamesfun.json → database.collections`
        : `  server code: ${sv.entry} bundled from ${plural(sv.files.length, 'file')} (${sv.files.join(', ')}) ` +
            `into one ${sizeText(sv.bytes)} file, sha256 ${sv.sha256.slice(0, 12)}…${extras.map(e => `, ${e}`).join('')}; ` +
            'server/ and gamesfun.json are not public files',
      ...(sv.database
        ? [
            `  database: env.${sv.database.binding}, ${sv.database.migrations.length ? `${plural(sv.database.migrations.length, 'migration')} (${sv.database.migrations.join(', ')})` : 'no migrations'}`,
          ]
        : []),
      ...sv.warnings.map(w => `  ${w}`),
    );
  }
  return lines;
}

/** `publish --check --verify`: whether the publish gate's checks passed on these files. */
function verifyLine(v, where) {
  const evidence = v.run && !v.reused ? ` Evidence: ${where}/evidence/${v.run}/.` : '';
  if (v.pass) {
    const reused = v.reused ? ', these exact files passed before' : '';
    return `checks: PASS (${v.passed} of ${v.ran} passed${reused}); publish will not run them again for these files.${evidence}`;
  }
  const why = failedNames(v.failed) || (v.changedDuring ? 'the files changed while it ran' : 'the checks did not run');
  return `the checks did not pass: ${why}. A publish now saves a private draft.${evidence}`;
}

/** The game's link that X shows as a player card (the game inside the post), for a plain /play/<slug> link. */
export function playerCardUrl(url) {
  try {
    const u = new URL(url);
    u.searchParams.set('card', 'player');
    return u.href;
  } catch {
    return null;
  }
}

/** The game's database past its plan's size, from xgames.fun's answer: what happens, and what to do. */
export function databaseLine(db) {
  if (!db) return null;
  const over = Number.isFinite(db.sizeBytes) && Number.isFinite(db.cap) && db.sizeBytes > db.cap;
  if (!over && !db.warning) return null;
  const size = over ? `${sizeText(db.sizeBytes)}, past its plan's ${sizeText(db.cap)}` : 'past its plan’s size';
  return `  Worth fixing now: its database is ${size}. xgames.fun stops the game's server for a database past its plan's size (every /api/ call answers 451) until it is under: delete rows (${CMD} db query "DELETE …" --write --live), or move to a plan that allows more (${CMD} plan --all).`;
}

/** A publish that went live. */
function publishedLines(where, r) {
  const x = playerCardUrl(r.url);
  const lines = [
    `Published ${where} (version ${r.version.number}, unlisted): ${r.url}`,
    ...(x
      ? [
          `  to play inside a post on X: ${x}`,
          '    (on X the plain link shows a picture card, and a tap opens the game; this one plays the game inside the post on desktop and Android, and on iPhone shows as a bare link that plays once the post is opened)',
        ]
      : []),
    `  the game itself: ${r.gameUrl}`,
  ];
  if (r.friendsUrl) lines.push(`  play with friends: ${r.friendsUrl}`);
  lines.push(`  uploaded ${plural(r.uploaded, 'new file')}; xgames.fun already had ${r.alreadyThere}.`);
  if (r.server) {
    lines.push(
      r.server.sent
        ? `  its server code went up too (${sizeText(r.server.bytes)}), at ${r.gameUrl ?? r.url}api/`
        : `  its server code did not go up: ${r.server.why}`,
    );
  }
  const db = databaseLine(r.database);
  if (db) lines.push(db);
  return lines;
}

/** A version xgames.fun kept but could not put live: neither a draft nor published. */
function keptLines(where, r) {
  return [
    `Kept ${where} as version ${r.version.number} on xgames.fun, but it did not go live: ${r.publishError}`,
    r.takenDown
      ? '  The game was taken down by xgames.fun, so nothing plays at its link.'
      : r.liveBefore
        ? `  Version ${r.liveBefore.version} still plays at ${r.liveBefore.url}. Publish again once the reason above is fixed.`
        : '  Nothing plays at its link yet. Publish again once the reason above is fixed.',
    ...(r.studioUrl ? [`  in your Studio: ${r.studioUrl}`] : []),
  ];
}

/** After a publish that went live: the card its link shows. */
function cardAfter(r, origin, { asked, shown: where }) {
  if (drawable(r.card) && r.slug)
    return `  its link's card: ${origin}/play/${r.slug}/card.png (a link shared before may keep its old card for a while: X and chat apps cache it)`;
  // without one (--no-card or gamesfun.json "card": false); a caller that makes its own card says its own
  if (asked && r.card && !drawable(r.card))
    return `  its link shows a plain card (a gradient with the title): no preview picture xgames.fun can draw (${CMD} card ${where} makes one)`;
  return null;
}

/** A publish saved as a private draft: asked for with --draft, refused by xgames.fun, or its checks failed. */
function draftLines(where, r, folder = where) {
  const lines = [`Saved ${where} as a private draft (version ${r.version.number}): ${r.studioUrl}`];
  if (r.publishError) lines.push(`  not published: ${r.publishError}`);
  else if (!r.verify.pass) {
    lines.push(
      `  its checks did not pass: ${failedNames(r.verify.failed) || 'verify did not run'}. ` +
        `Fix them (${CMD} check ${folder}) and publish again.`,
    );
  }
  return lines;
}

export default publishCommand();
