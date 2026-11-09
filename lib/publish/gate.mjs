// The check before a game goes public: a check must pass on exactly the files being published. Which check is the
// caller's: this package's page check for a game made anywhere (../check.mjs), or the kit's six gates for a game the
// kit made (the kit passes its own `check`). A pass is remembered in <game>/.gamesfun/gate.json with the files'
// fingerprint (./tree.mjs), so publishing again without a change does not check again; any change to a published file
// checks again. A game whose checks fail can still go up as a private draft (a version in the person's xgames.fun
// Studio, with no public link), and the person is told which checks failed.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildTree } from './tree.mjs';

export const gateFile = dir => path.join(dir, '.gamesfun', 'gate.json');

export async function readGate(dir) {
  try {
    return JSON.parse(await readFile(gateFile(dir), 'utf8'));
  } catch {
    return null;
  }
}

/** The report xgames.fun records with the version: {pass, quick, passed, ran, failed:[{n, name}], at, kit, run}. */
export function reportOf(summary, kit = null) {
  if (!summary) return { pass: false, quick: false, passed: 0, ran: 0, failed: [], at: null, kit, run: null };
  return {
    pass: Boolean(summary.pass) && !(summary.failed ?? []).length && summary.ran > 0,
    quick: Boolean(summary.quick),
    passed: summary.passed ?? 0,
    ran: summary.ran ?? 0,
    failed: (summary.failed ?? []).map(c => ({ n: c.n, name: c.name })),
    at: summary.started ?? new Date().toISOString(),
    kit,
    run: summary.run ?? null,
  };
}

/**
 * The game's check result for its current files: the remembered pass when the files are unchanged, else a fresh check
 * (unless `run: false`). check(dir, {onLine, signal, args}) → its summary ({pass, quick, passed, ran, failed, started,
 * run}), or null when it gave no result. → { report, fingerprint, ran: bool, reused: bool, changedDuring: bool }
 */
export async function gate(
  dir,
  { check, run = true, kit = null, onLine = () => {}, onRun = () => {}, signal, args = [], built = false } = {},
) {
  const before = (await buildTree(dir)).fingerprint;
  const saved = await readGate(dir);
  if (saved?.fingerprint === before && saved.report?.pass)
    return { report: saved.report, fingerprint: before, ran: false, reused: true, changedDuring: false };
  if (!run)
    return { report: reportOf(null, kit), fingerprint: before, ran: false, reused: false, changedDuring: false };
  onRun(); // only when the check really runs (not for a remembered pass)
  const summary = await check(dir, { onLine, signal, args, built });
  const after = (await buildTree(dir)).fingerprint;
  const report = reportOf(summary, kit);
  if (after !== before)
    return { report: { ...report, pass: false }, fingerprint: after, ran: true, reused: false, changedDuring: true };
  await mkdir(path.dirname(gateFile(dir)), { recursive: true });
  await writeFile(
    gateFile(dir),
    JSON.stringify({ fingerprint: after, report, savedAt: new Date().toISOString() }, null, 2) + '\n',
  );
  return { report, fingerprint: after, ran: true, reused: false, changedDuring: false };
}
