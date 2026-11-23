// The nudge publish gives: one line when a game pays through voucher grants and no review is newer than its economy
// and server/.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { CMD } from '../command.mjs';
import { economyFile } from '../economy.mjs';
import { readJson } from '../util.mjs';
import { economyHome, voucherGrants } from './where.mjs';

/** The newest change to a file or under a folder (hidden files and node_modules left out), in ms; 0 when none. */
function newest(p) {
  let t = 0;
  const walk = q => {
    let s;
    try {
      s = statSync(q);
    } catch {
      return;
    }
    if (s.isDirectory()) {
      for (const e of readdirSyncSafe(q)) if (!e.startsWith('.') && e !== 'node_modules') walk(path.join(q, e));
    } else t = Math.max(t, s.mtimeMs);
  };
  walk(p);
  return t;
}
function readdirSyncSafe(q) {
  try {
    return readdirSync(q);
  } catch {
    return [];
  }
}

/**
 * One line for publish when the game pays results through voucher grants and no review (evidence/review-N/) is newer
 * than its economy file and server/; else null. A nudge only: publish goes on.
 */
export function reviewNudge(dir) {
  let file;
  try {
    file = economyFile(economyHome(dir));
  } catch {
    return null;
  }
  if (!file || !voucherGrants(readJson(file)).length) return null;
  const changed = Math.max(newest(file), newest(path.join(dir, 'server')));
  let reviewed = 0;
  for (const e of readdirSyncSafe(path.join(dir, 'evidence')))
    if (/^review-\d+$/.test(e)) reviewed = Math.max(reviewed, newest(path.join(dir, 'evidence', e, 'review.json')));
  if (reviewed > changed) return null;
  return `This game pays results through voucher grants, and ${CMD} review has not run since its economy or server/ changed: run it before players are paid (it says what a cheater gets, and what to fix).`;
}
