// `xcore db info|query|export|import|restore`: the game's own database (gamesfun.json → database), on this machine
// (the one `xcore dev` runs) or, with --live, on xgames.fun (../lib/db.mjs).
import { createInterface } from 'node:readline/promises';
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import { dbExport, dbImport, dbInfo, dbQuery, dbRestore, importOf, liveChange, queryProblem } from '../lib/db.mjs';
import { codeMatches, sameCommand, wrongCode } from '../lib/consent.mjs';
import { economyFile } from '../lib/economy.mjs';
import { pageRoots } from '../lib/publish/page.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore db info [dir] [--live] [--json]
       xcore db query "<sql>" [dir] [--params '<json list>'] [--write] [--live [--yes <code>]] [--json]
       xcore db export [dir] [--out <file>] [--live] [--json]
       xcore db import <file.sql> [dir] [--live [--yes <code>]] [--json]
       xcore db restore <time> [dir] --live [--yes <code>] [--json]

The game's own database (${CMD} add database: gamesfun.json → database, one D1 database a game). Without --live,
the one on this machine that ${CMD} dev runs (kept in .gamesfun/dev/d1/, its migrations applied first); with --live,
the game's database on xgames.fun, which keeps every call in the game's audit log.
  info               where it is, its size, the migrations applied (and, here, its tables and their rows)
  query "<sql>"      one statement; it only reads (SELECT, EXPLAIN, PRAGMA table_info or table_list) unless
                     --write. --params '["moon", 3]' fills its ? marks
  export             the whole database as SQL, into --out <file> or .gamesfun/exports/ (hidden: never published;
                     it holds your players' data, so keep it out of git and off shared drives)
  import <file.sql>  run a file of SQL statements, all of it or none; at most 5 MB (live, 4.5 MB as sent). A dump
                     from export (here, live or D1's) goes in over what is there, or into an empty database:
                     tables kept, each row updated by its key where it is (none deleted)
  restore <time>     live only: the database as it was at <time> (a date such as 2026-11-08T12:00:00Z, or unix
                     seconds; up to 30 days back). A game with an economy: what happened on chain (loot balances,
                     payouts) stays as it is, so the database and the chain can disagree after it.
A change to the live database (query --write --live, import --live, restore) first prints exactly what it would
change (the game, and the statement and its params; the file's name, size and SHA-256; or the time and what it goes
back to) with a code, and changes nothing. It goes on when run again with --yes <code>, or, at a terminal, when you
type its word (write, import, restore). A code printed for another change is refused. With --json, the printout is
{planned: true, code, plan, next}.`;

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const kb = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);

/** Rows as columns a person reads; long values cut short. */
function table(rows) {
  if (!rows.length) return '(no rows)';
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const cell = v => {
    const s = v === null || v === undefined ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.length > 60 ? `${s.slice(0, 59)}…` : s;
  };
  const width = cols.map(c => Math.max(c.length, ...rows.map(r => cell(r[c]).length)));
  const line = vals =>
    vals
      .map((v, i) => v.padEnd(width[i]))
      .join('  ')
      .trimEnd();
  return [line(cols), line(width.map(w => '-'.repeat(w))), ...rows.map(r => line(cols.map(c => cell(r[c]))))].join(
    '\n',
  );
}

/**
 * A change to the live database (../lib/consent.mjs): with --yes <code>, it goes on when the code is this change's and
 * is refused when it is another's. Without it, the printout (`lines`) and its code; at a terminal the person may type
 * `word` to go on, and elsewhere (a script, an agent) nothing changes. → true to go on, or the exit code to stop with
 */
async function consented({ change, lines, word, nothing, values, args }) {
  if (values.yes !== undefined) {
    if (!codeMatches(values.yes, change.code)) throw wrongCode();
    return true;
  }
  const next = `${sameCommand('db', args)} --yes ${change.code}`;
  if (values.json) {
    printJson({ ok: true, planned: true, code: change.code, plan: change.plan, next });
    return 0;
  }
  console.log(lines.join('\n'));
  if (!process.stdin.isTTY) {
    console.log(`${nothing}. To go on, run this again with the code:\n  ${next}`);
    return 0;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const typed = (
      await rl.question(`Type ${word} to go on (or run it again with --yes ${change.code}), anything else to stop: `)
    )
      .trim()
      .toLowerCase();
    if (typed === word) return true;
  } finally {
    rl.close();
  }
  console.log(`${nothing}.`);
  return 1;
}
const onGame = c => `(game ${c.plan.game} on ${c.plan.origin})`;

export default {
  name: 'db',
  summary: "the game's own database (D1): info, query, export, import, restore; here, or --live on xgames.fun",
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(
        args,
        {
          live: { type: 'boolean' },
          write: { type: 'boolean' },
          params: { type: 'string' },
          out: { type: 'string' },
          yes: { type: 'string' },
        },
        usage,
      );
      const [verb, ...rest] = positionals;
      const takes = { query: 'a statement', import: 'a file', restore: 'a time' };
      if (!['info', 'query', 'export', 'import', 'restore'].includes(verb)) throw new UsageError(usage);
      if (takes[verb] && !rest[0]) throw new UsageError(`${verb} needs ${takes[verb]}\n\n${usage}`);
      const arg = takes[verb] ? rest[0] : null;
      const dir = await resolveGame(takes[verb] ? rest[1] : rest[0]);
      const live = !!values.live;
      const where = live ? `${shown(dir)}'s database on xgames.fun` : `${shown(dir)}'s database on this machine`;
      const log = m => console.error(m);

      if (verb === 'info') {
        const r = await dbInfo(dir, { live, log });
        if (values.json) return printJson(r);
        if (live && !r.exists) {
          console.log(`${shown(dir)} has no database on xgames.fun yet: it is made on the first publish with one.`);
          return 0;
        }
        console.log(
          `${where}${r.name ? ` (${r.name})` : ''}: ${kb(r.sizeBytes ?? 0)}${r.cap ? ` of ${kb(r.cap)}` : ''}${r.folder ? `, in ${r.folder}/` : ''}`,
        );
        const applied = r.applied ?? [];
        console.log(`  migrations applied: ${applied.length ? applied.map(m => m.name ?? m).join(', ') : 'none'}`);
        if (r.tables)
          console.log(
            `  tables: ${r.tables.length ? r.tables.map(t => `${t.name} (${plural(t.rows, 'row')})`).join(', ') : 'none yet'}`,
          );
        return 0;
      }
      if (verb === 'query') {
        let params = [];
        if (values.params !== undefined) {
          try {
            params = JSON.parse(values.params);
          } catch {
            throw new UsageError(`--params is a JSON list, such as '["moon", 3]'\n\n${usage}`);
          }
        }
        if (live && values.write) {
          // what would be refused anyway is refused before anyone is asked
          const why = queryProblem(arg, { write: true });
          if (why) throw Object.assign(new Error(why), { code: 'bad-sql' });
          const change = await liveChange(dir, 'write', { sql: arg, params });
          const go = await consented({
            change,
            lines: [
              `This writes to ${where} ${onGame(change)}, which your players use:`,
              `  statement  ${arg}`,
              ...(params.length ? [`  params     ${JSON.stringify(params)}`] : []),
              `Only ${CMD} db restore --live puts it back.`,
            ],
            word: 'write',
            nothing: 'Nothing was written',
            values,
            args,
          });
          if (go !== true) return go;
        }
        const r = await dbQuery(dir, arg, { live, params, write: !!values.write, log });
        if (values.json) return printJson(r);
        console.log(table(r.results ?? []));
        const m = r.meta ?? {};
        const changed = m.changes ?? m.rows_written;
        console.log(
          `${plural((r.results ?? []).length, 'row')}${changed ? `; ${plural(changed, 'row')} changed` : ''} (${where})`,
        );
        return 0;
      }
      if (verb === 'export') {
        const r = await dbExport(dir, { live, out: values.out ?? null, log });
        if (values.json) return printJson(r);
        console.log(`Exported ${where} (${kb(r.bytes)}) to ${r.file}. It holds your players' data: keep it private.`);
        if (r.note) console.log(`  ${r.note}`);
        return 0;
      }
      if (verb === 'import') {
        if (live) {
          // what would be refused anyway (not there, too big to send) is refused before anyone is asked
          await importOf(arg, { live });
          const change = await liveChange(dir, 'import', { file: arg });
          const go = await consented({
            change,
            lines: [
              `This runs a file of SQL on ${where} ${onGame(change)}, which your players use:`,
              `  file    ${change.plan.file} (${kb(change.plan.bytes)})`,
              `  sha256  ${change.plan.sha256}`,
              `Rows can change or go, and while it runs the database answers nothing else. ${CMD} db export --live keeps a copy first; ${CMD} db restore --live puts it back.`,
            ],
            word: 'import',
            nothing: 'Nothing was imported',
            values,
            args,
          });
          if (go !== true) return go;
        }
        const r = await dbImport(dir, arg, { live, log });
        if (values.json) return printJson(r);
        console.log(
          `Imported ${arg} into ${where}${r.meta?.queries !== undefined ? ` (${plural(r.meta.queries, 'statement')})` : ''}${r.statements !== undefined ? ` (${plural(r.statements, 'statement')})` : ''}.${r.dump ? ' A dump goes in over what is there: its tables kept, each row updated by its key where it is, none deleted.' : ''}${r.left ? ` Its record of migrations (_gf_migrations, ${plural(r.left, 'statement')}) was left out: this database keeps its own.` : ''}`,
        );
        if (r.note) console.log(`  ${r.note}`);
        return 0;
      }
      // restore: what it would do, the chain's warning, then only on a yes
      if (!live)
        throw new UsageError(
          `restore is --live only: the database on this machine has no history (${CMD} db import a dump from ${CMD} db export)\n\n${usage}`,
        );
      const p = await dbRestore(dir, arg, { live, log });
      const roots = pageRoots(dir);
      const economy = !!(p.economy || economyFile(roots.static ?? dir) || economyFile(dir));
      const at = p.preview?.at ?? arg;
      const warning = economy
        ? 'This game has an economy: what happened on chain since then stays as it is. Loot balances, items and payouts are not rolled back, so a player can keep what they won while the database forgets it (or the other way round).'
        : null;
      const change = await liveChange(dir, 'restore', { timestamp: arg, preview: p.preview });
      if (values.json && values.yes === undefined)
        // the printout as JSON: what xgames.fun said it goes back to, and the chain's warning
        change.plan = { ...change.plan, preview: p.preview ?? null, economy, warning };
      const undone = p.preview?.migrations ?? [];
      const go = await consented({
        change,
        lines: [
          `${where} ${onGame(change)} would go back to how it was at ${at}${p.preview?.bookmark ? ` (bookmark ${p.preview.bookmark})` : ''}. Everything written after that is lost; ${CMD} db export --live keeps a copy first.`,
          ...(undone.length
            ? [
                `It rolls back ${plural(undone.length, 'migration')} applied after that time: ${undone.map(m => `${m.name}${m.at ? ` (${m.at})` : ''}`).join(', ')}.`,
              ]
            : []),
          ...(p.preview?.warning ? [`Warning: ${p.preview.warning}`] : []),
          ...(warning ? [`Warning: ${warning}`] : []),
        ],
        word: 'restore',
        nothing: 'Nothing was restored',
        values,
        args,
      });
      if (go !== true) return go;
      if (values.yes !== undefined && warning && !values.json) console.error(`Warning: ${warning}`);
      // the moment before the restore: going back to it undoes the restore (D1 Time Travel keeps that point too)
      const before = new Date().toISOString();
      const r = await dbRestore(dir, arg, { live, confirm: true, log });
      const undo = `${CMD} db restore ${before} --live`;
      if (values.json) return printJson({ ...r, economy, undo: { at: before, command: undo } });
      console.log(
        `Restored ${where} to ${r.restored?.at ?? at}${r.restored?.bookmark ? ` (bookmark ${r.restored.bookmark})` : ''}.`,
      );
      console.log(
        `  Before it, the database was at ${r.restored?.previous ? `bookmark ${r.restored.previous}` : before}. To undo this restore: ${undo} (the moment before it, by this machine's clock).`,
      );
      return 0;
    }, args),
};
