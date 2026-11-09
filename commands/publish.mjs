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
import { reviewNudge } from '../lib/review.mjs';

const usage = `Usage: xcore publish [dir] [--draft] [--new] [--title <name>] [--status] [--check [--verify [--port <n>]]] [--json]

Put a game on xgames.fun at a link anyone can play: xgames.fun hosts it, you need no server. Sign in first
(${CMD} login). The game's checks gate it: they must pass on the files you publish (they run now unless nothing
changed since they last passed; a game you brought: the page check, a game the kit made: its six gates). A game whose
checks fail goes up as a private draft only, and you are told which checks failed. Files that look like keys, .env
files and links refuse it; evidence/, hidden files and the makers' notes at the top (README.md, NOTES.md, LAUNCH.md…)
are left out. Only files xgames.fun does not have yet are uploaded. The link is unlisted: only people you give it to
find it. Publishing the same folder again makes a new version at the same link. A game with its own server code
(server/, a gf-server-v1 Worker) sends it bundled as one file, when xgames.fun takes server code; server/ is never a
public file.
In a GitHub Actions job with permissions id-token: write, the job's own OIDC token signs it in place of a login.
A brought game (${CMD} adopt) is built first when it has a build; its published folder (gamesfun.json page.out)
goes up, with its server/ bundle when it has one.
  --draft        a private version in your xgames.fun Studio, no public link
  --new          publish as a new game (a new link), not an update of this folder's game
  --title <name> the game's name on xgames.fun (default: its title)
  --status       this folder's link and the account it is published from; publishes nothing
  --check        the offline checks only (files, secrets, backend origins, the server bundle); publishes nothing
  --verify       with --check: also run the publish gate's checks on these files and remember a pass, so the
                 publish after it does not run them again (the GitHub Action's check step)
  --port <n>     with --verify: the port its page check serves on (default: any free one)
GAMESFUN_STUDIO=<origin> publishes to another xgames.fun (a local Studio while developing).`;

/**
 * The publish command. check, label, prepare, rpcFile: as publishGame takes them (the kit's six gates, its name, its
 * upkeep, its workspace's .env); resolveGame and shown: how the command finds a game and names its folder.
 */
export function publishCommand({
  check = pageCheck,
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
    summary: 'put a game on xgames.fun at a link anyone can play (unlisted)',
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
          },
          usage,
        );
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
            if (b.code !== 0) {
              console.error(
                `Its build (${roots.build}) failed with exit code ${b.code}${buildFailure(b) ? ` (${buildFailure(b)})` : ''}: nothing was checked.`,
              );
              return 1;
            }
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
          else
            console.log(
              ok
                ? checkLines(named(dir), out, p).join('\n')
                : [...p.problems, p.secrets, p.names].filter(Boolean).join('\n'),
            );
          if (!values.json && out.verify) console.log(verifyLine(out.verify, shown(dir)));
          return out.ok ? 0 : 1;
        }
        const r = await publishGame(dir, {
          ...own,
          origin,
          draft: values.draft,
          newGame: values.new,
          title: values.title ?? null,
          progress: values.json ? () => {} : l => console.error(l),
        }).catch(e => {
          // A new game needs one of the account's 2 free slots (xgames.fun's words say so); name the commands that free one.
          if (e?.code === 'no-free-slot')
            throw Object.assign(
              new Error(
                `${e.message}\n  ${CMD} plan activate <another game's folder>   moves that game to a paid slot\n  ${CMD} plan --all   your slots and games; archive one on ${origin}/console`,
              ),
              { status: e.status, code: e.code },
            );
          throw e;
        });
        if (values.json) printJson(r);
        else
          console.log(
            (r.url
              ? publishedLines(r.title ? `“${r.title}”` : named(dir), r)
              : draftLines(named(dir), r, shown(dir))
            ).join('\n'),
          );
        return r.url || values.draft ? 0 : 1;
      }, args),
  };
}

// ---- What the command prints. `where` is the game's folder as the person reads it. ----------------------------------

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const kb = bytes => `${(bytes / 1024).toFixed(1)} KB`;
const failedNames = failed => failed.map(c => `${c.n} ${c.name}`).join('; ');

/** `publish --status`: where this folder's game is published, and whether it is live. */
function statusLine(where, origin, s) {
  let live = '';
  if (s.live?.error) live = ` xgames.fun says: ${s.live.error}`;
  else if (s.live) live = s.live.published ? ` Live: version ${s.live.version?.number}.` : ' Not live now.';
  const own = s.known?.gameUrl ? `\n  the game itself: ${s.known.gameUrl}` : '';
  const v = s.known?.lastVersion;
  switch (s.link) {
    case 'never':
      return `${where} has not been published to ${origin} yet.`;
    case 'started':
      return `${where} was started on ${origin}, but no version finished going up. Run ${CMD} publish again: it goes on with the same game.${live}`;
    case 'draft':
      return `${where} is a private draft (version ${v}).${live}${own}`;
    case 'draft-over-public':
      return `${where} is published at ${s.known.url}; its latest version (${v}) is a private draft, so an earlier version is the one playing.${live}${own}`;
    default:
      return `${where} is published at ${s.known.url} (version ${v}).${live}${own}`;
  }
}

/** `publish --check` when nothing is refused: what goes up, and the server bundle when there is one. */
function checkLines(where, out, p) {
  const talks = p.backend.length ? ` It may talk to: ${p.backend.join(', ')}.` : '';
  const lines = [
    `${where}: ${out.files} files${out.added?.length ? ` (with the ${plural(out.added.length, 'record')} xgames.fun keeps: ${out.added.join(', ')})` : ''}, ${(out.bytes / 1048576).toFixed(1)} MB, nothing refused.${talks} ` +
      `Left out: ${out.skipped.join(', ') || 'nothing'}.`,
  ];
  const sv = out.server;
  if (sv?.has && sv.ok) {
    const extras = [
      ...(sv.objects.length ? [`Durable Objects ${sv.objects.join(', ')}`] : []),
      ...(sv.compatibilityFlags.length ? [sv.compatibilityFlags.join(', ')] : []),
    ];
    lines.push(
      sv.stock
        ? `  server code: xcore's stock server (${kb(sv.bytes)}, sha256 ${sv.sha256.slice(0, 12)}…), which serves the page's api/db/ from the game's database under gamesfun.json → database.collections`
        : `  server code: ${sv.entry} bundled from ${plural(sv.files.length, 'file')} (${sv.files.join(', ')}) ` +
            `into one ${kb(sv.bytes)} file, sha256 ${sv.sha256.slice(0, 12)}…${extras.map(e => `, ${e}`).join('')}; ` +
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
    return `checks: PASS (${v.passed}/${v.ran}${reused}); publish will not run them again for these files.${evidence}`;
  }
  const why = failedNames(v.failed) || (v.changedDuring ? 'the files changed while it ran' : 'the checks did not run');
  return `the checks did not pass: ${why}. A publish now saves a private draft.${evidence}`;
}

/** A publish that went live. */
function publishedLines(where, r) {
  const lines = [
    `Published ${where} (version ${r.version.number}, unlisted): ${r.url}`,
    `  the game itself: ${r.gameUrl}`,
  ];
  if (r.friendsUrl) lines.push(`  play with friends: ${r.friendsUrl}`);
  lines.push(`  uploaded ${r.uploaded} new files; xgames.fun already had ${r.alreadyThere}.`);
  if (r.server) {
    lines.push(
      r.server.sent
        ? `  its server code went up too (${kb(r.server.bytes)}), at ${r.gameUrl ?? r.url}api/`
        : `  its server code did not go up: ${r.server.why}`,
    );
  }
  return lines;
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
