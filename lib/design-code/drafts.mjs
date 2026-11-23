// The drafts, checked by the kit: the economy check run on a temporary copy of the spec with and without the drafted
// declarations (only the fields the installed kit's schema takes).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { solanaCommand, solanaRoot } from '../economy.mjs';
import { arr, OFFCHAIN, SERVER_LIMIT } from './design.mjs';

/** What the installed kit's schema takes: the offchain list, a grant's serverLimit. */
export function kitTakes(env = process.env) {
  const root = solanaRoot(env);
  let schema = null;
  try {
    schema = JSON.parse(readFileSync(path.join(root ?? '', 'js', 'economy', 'schema.json'), 'utf8'));
  } catch {}
  return {
    version: root ? (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version ?? null) : null,
    offchain: Boolean(schema?.properties?.[OFFCHAIN]),
    serverLimit: Boolean(schema?.$defs?.grant?.properties?.[SERVER_LIMIT.field]),
  };
}

/** The check's answer, as lines to compare: its warnings, and its ask and tell lines. */
function checkLines(json) {
  const block = (head, mark) => {
    const lines = String(json?.text ?? '').split('\n');
    const at = lines.findIndex(l => head.test(l));
    const out = [];
    if (at >= 0)
      for (const l of lines.slice(at + 1)) {
        if (!l.startsWith(mark)) break;
        out.push(l.slice(mark.length).trim());
      }
    return out;
  };
  return {
    warnings: arr(json?.warnings).map(w => ({
      code: w.code ?? null,
      severity: w.severity ?? null,
      where: w.where ?? null,
      message: w.message ?? '',
    })),
    ask: block(/^Ask the person\b/, '? '),
    tell: block(/^Tell the person\b/, '> '),
    refusals: arr(json?.refusals).map(r => ({
      code: r.code ?? null,
      where: r.where ?? null,
      message: r.message ?? '',
    })),
  };
}

/**
 * The drafts added to a temporary copy of the spec, and the kit's check run on it and on the spec as it is (both in the
 * same temporary folder, so only the drafts differ). The real spec is never touched. → {ran: false, why} or {ran: true,
 * version, added, left, only, gone, refused}
 */
export async function draftsChecked(file, spec, drafts, { env = process.env } = {}) {
  const takes = kitTakes(env);
  const xsolana = solanaCommand(env);
  if (!xsolana) return { ran: false, why: 'the economy tools (@xgamesfun/solana) are not installed here' };
  const left = [];
  const offchain = [];
  for (const d of drafts.offchain)
    if (!takes.offchain)
      left.push({ draft: d.declaration.key, why: `@xgamesfun/solana ${takes.version} takes no "offchain"` });
    else if (!d.ready) left.push({ draft: d.declaration.key, why: 'what it takes or gives is not read from the code' });
    else offchain.push(d.declaration);
  const limits = [];
  for (const d of drafts.serverLimit)
    if (!takes.serverLimit)
      left.push({
        draft: `grant:${d.grant}`,
        why: `@xgamesfun/solana ${takes.version} takes no "${SERVER_LIMIT.field}" (a later kit reads it)`,
      });
    else limits.push(d);
  if (!offchain.length && !limits.length)
    return {
      ran: false,
      version: takes.version,
      why: drafts.offchain.length + drafts.serverLimit.length ? 'no draft the installed kit takes' : 'nothing drafted',
      left,
    };
  const drafted = structuredClone(spec);
  if (offchain.length) drafted[OFFCHAIN] = [...arr(drafted[OFFCHAIN]), ...offchain];
  for (const d of limits) {
    const g = arr(drafted.grants).find(x => x.key === d.grant);
    if (g) g[SERVER_LIMIT.field] = d[SERVER_LIMIT.field];
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'xcore-design-code-'));
  try {
    const name = path.basename(file);
    const run = async (sub, value) => {
      await writeFile(path.join(dir, `${sub}-${name}`), JSON.stringify(value, null, 2));
      const r = spawnSync(xsolana[0], [xsolana[1], 'check', `${sub}-${name}`, '--json'], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 60_000,
        env,
      });
      try {
        return JSON.parse(r.stdout);
      } catch {
        return null;
      }
    };
    const before = await run('as-is', spec);
    const after = await run('drafted', drafted);
    if (!before || !after) return { ran: false, version: takes.version, why: 'xsolana check gave no JSON', left };
    const a = checkLines(before);
    const b = checkLines(after);
    const key = w => `${w.code} ${w.message}`;
    const diff = (x, y, k = v => v) => x.filter(v => !y.some(w => k(w) === k(v)));
    return {
      ran: true,
      version: takes.version,
      added: { offchain: offchain.map(d => d.key), [SERVER_LIMIT.field]: limits.map(d => d.grant) },
      left,
      only: { warnings: diff(b.warnings, a.warnings, key), ask: diff(b.ask, a.ask), tell: diff(b.tell, a.tell) },
      gone: { warnings: diff(a.warnings, b.warnings, key), ask: diff(a.ask, b.ask), tell: diff(a.tell, b.tell) },
      refused: diff(b.refusals, a.refusals, key),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
