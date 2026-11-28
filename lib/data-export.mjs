// `xcore data export`: a published game's player saves and leaderboards, from xgames.fun, into one JSON file of the
// game's own (.gamesfun/exports/, which git leaves out). Through the owner's route (each export is kept in the game's
// audit log there):
//   GET /api/kit/games/<id>/data?part=saves&after=               → {ok, saves: [{pid, key, value, bytes, updatedAt}], after}
//   GET /api/kit/games/<id>/data?part=boards                     → {ok, boards: [{board, order, entries}]}
//   GET /api/kit/games/<id>/data?part=board&board=<b>&after=     → {ok, board, order, entries: [{pid, score, name, at, hidden?}], after}
// Each player is the game's pid, as xgames.fun/console shows them (never their X id or wallet). The game's database
// has its own export (xcore db export --live), and its project files theirs (xcore files get --live).
import path from 'node:path';
import { call, studioOrigin } from './publish/client.mjs';
import { OIDC_KIND, requireCredential } from './publish/oidc.mjs';
import { readLinks } from './publish/index.mjs';
import { stateFolder } from './state-folder.mjs';
import { privateTarget, writePrivate } from './publish/private-file.mjs';
import { CMD } from './command.mjs';

/** Pages read before an export stops (a guard against a cursor that never ends): 200 saves or 500 entries each. */
const MAX_PAGES = 100_000;

/** A save's value as the game wrote it: its JSON, parsed (the text as it is when it is not JSON). */
const parsed = text => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * Every save and every board's every entry of the folder's published game. → {file, game, saves, boards: [{board,
 * entries}], bytes}. `out`: the file (default: .gamesfun/exports/data-<when>.json), never one among the game's
 * published files, and never over a file that is there unless `force`. `progress(line)` says each part as it is read. Throws in plain words.
 */
export async function exportData(
  dir,
  {
    origin = studioOrigin(),
    env = process.env,
    fetchImpl = fetch,
    now = () => new Date(),
    out = null,
    force = false,
    progress = () => {},
  } = {},
) {
  // a place it may not go (among the published files, or a file there already) is said before anything is fetched
  const target = { dir, force, what: "your players' data" };
  if (out) privateTarget(out, target);
  const game = (await readLinks(dir))[origin]?.projectId;
  if (!game)
    throw Object.assign(new Error(`this folder's game is not on ${origin} yet: publish it first (${CMD} publish)`), {
      code: 'not-published',
    });
  const cred = await requireCredential(origin, { env, fetchImpl });
  const auth = await cred.auth();
  const get = async query => {
    try {
      return await call(origin, `/api/kit/games/${encodeURIComponent(game)}/data?${new URLSearchParams(query)}`, {
        ...auth,
        fetchImpl,
      });
    } catch (e) {
      if (e.status === 403 && cred.kind === OIDC_KIND)
        throw Object.assign(
          new Error(
            `xgames.fun does not let a GitHub Actions run export a game's saves and leaderboards: run ${CMD} data export from your own machine, signed in as the game's owner.`,
          ),
          { status: 403, code: 'ci', cause: e },
        );
      if (e.status === 404 && !e.code)
        throw Object.assign(
          new Error(
            `${origin} does not export saves and leaderboards yet (no /data route): try again after its next update.`,
          ),
          { status: 404, code: 'not-there', cause: e },
        );
      throw e;
    }
  };
  const pages = async (query, take) => {
    let after = '';
    for (let i = 0; i < MAX_PAGES; i++) {
      const r = await get({ ...query, after });
      take(r);
      if (!r.after) return;
      after = r.after;
    }
    throw new Error('the export did not end: xgames.fun kept answering more pages');
  };
  const saves = [];
  await pages({ part: 'saves' }, r => {
    for (const s of r.saves ?? []) saves.push({ ...s, value: parsed(s.value) });
  });
  progress(`saves: ${saves.length}`);
  const listed = (await get({ part: 'boards' })).boards ?? [];
  const boards = [];
  for (const b of listed) {
    const entries = [];
    let order = b.order;
    await pages({ part: 'board', board: b.board }, r => {
      order = r.order ?? order;
      entries.push(...(r.entries ?? []));
    });
    boards.push({ board: b.board, order, entries });
    progress(`board ${b.board}: ${entries.length} entries`);
  }
  const at = now();
  const record = {
    gamesfun: 'data-export-v1',
    origin,
    game,
    exportedAt: at.toISOString(),
    note: "Each player is the game's player id on xgames.fun (as its console shows them), never their X id or wallet. A save's value is the game's own JSON.",
    saves,
    boards,
  };
  const file = out
    ? path.resolve(out)
    : path.join(await stateFolder(dir), 'exports', `data-${at.toISOString().replace(/[:.]/g, '-')}.json`);
  const text = JSON.stringify(record, null, 2) + '\n';
  await writePrivate(file, text, target);
  return {
    file,
    game,
    saves: saves.length,
    boards: boards.map(b => ({ board: b.board, entries: b.entries.length })),
    bytes: Buffer.byteLength(text),
  };
}
