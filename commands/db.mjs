// `xcore db info|query|export|import|restore`: the game's own database (gamesfun.json → database), on this machine
// (the one `xcore dev` runs) or, with --live, on xgames.fun (../lib/db.mjs).
import { guard, parse, printJson, UsageError, notOneOf, folderArg, verbNamed, tooMany } from '../lib/cli.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import { dbExport, dbImport, dbInfo, dbQuery, dbRestore, importOf, liveChange, queryProblem } from '../lib/db.mjs';
import { consented } from '../lib/consent.mjs';
import { economyFile } from '../lib/economy.mjs';
import { pageRoots } from '../lib/publish/page.mjs';
import { CMD } from '../lib/command.mjs';
import { DATABASE_LIMITS, STUDIO_BODY_BYTES } from '../lib/server/contract.mjs';
import { plural, sizeText } from '../lib/util.mjs';

const usage = `Usage: xcore db info [dir] [--live] [--json]
       xcore db query "<sql>" [dir] [--params '<json list>'] [--write] [--live [--yes <code>]] [--json]
       xcore db export [dir] [--out <file> [--force]] [--live] [--json]
       xcore db import <file.sql> [dir] [--live [--yes <code>]] [--json]
       xcore db restore <time> [dir] --live [--yes <code>] [--json]

The game's folder is the last word or --dir <folder> (default: the current directory).

Work with the game's own database: one D1 database per game, added with ${CMD} add database (gamesfun.json →
database).

Without --live, the commands use the local database that ${CMD} dev runs (stored in .gamesfun/dev/d1/; its
migrations are applied first). With --live, they use the game's database on xgames.fun, which records every call in
the game's audit log.

Commands:
  info               where the database is, its size, and the migrations applied (locally, also its tables and row
                     counts)
  query "<sql>"      run one statement. It is read-only (SELECT, EXPLAIN, PRAGMA table_info or table_list) unless you
                     pass --write. --params '["moon", 3]' fills its ? placeholders
  export             write the whole database as SQL to --out <file> or to .gamesfun/exports/ (a hidden folder, never
                     published). The file holds your players' data: it is readable by you only, a file among the
                     game's published files is refused, and an existing one is written over only with --force; keep it
                     out of git and off shared drives. Live, while it runs the database answers nothing else (players'
                     calls wait or fail): best when few are playing
  import <file.sql>  run a file of SQL statements, all or none; at most ${sizeText(DATABASE_LIMITS.importBytes)} (live, ${sizeText(STUDIO_BODY_BYTES)} as sent). A dump from
                     export (local, live, or D1's own) loads over the existing data or into an empty database: tables
                     are kept, each row is updated by its key, and no row is deleted
  restore <time>     live only: return the database to its state at <time> (a date such as 2026-11-08T12:00:00Z, or
                     unix seconds; up to 30 days back). For a game with an economy, what happened on chain (loot
                     balances, payouts) is not rolled back, so the database and the chain can disagree afterwards

Confirming live changes:
  A change to the live database (query --write --live, import --live, restore) first prints exactly what it would
  change, with a code, and changes nothing. The printout names the game and the statement and its params; or the
  file's name, size and SHA-256; or the time it goes back to. Run the command again with --yes <code> to apply it,
  or, at a terminal, type the confirmation word (write, import, restore). A code works once, within 15 minutes,
  and only for the change it was printed with. With --json, the printout is {planned: true, code, plan, confirm}:
  confirm is the command to run once the person has said yes.`;

/** A size as the person reads it (../lib/util.mjs sizeText, the one every command prints sizes with). */
const kb = sizeText;

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
 * A change to the live database, asked first (../lib/consent.mjs consented). At a terminal the person may type the
 * change's `word` (write, import, restore) instead of running it again with the code.
 */
const asked = ({ change, ...rest }) => consented({ sub: 'db', plan: change.plan, code: change.code, ...rest });
const onGame = c => `(game ${c.plan.game} on ${c.plan.origin})`;

export default {
  name: 'db',
  summary: "query, export, import or restore the game's D1 database, locally or live",
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
          force: { type: 'boolean' },
          yes: { type: 'string' },
          dir: { type: 'string' },
        },
        usage,
      );
      const [word, ...rest] = positionals;
      const takes = { query: 'a statement', import: 'a file', restore: 'a time' };
      const verbs = ['info', 'query', 'export', 'import', 'restore'];
      const verb = verbNamed(word, verbs);
      if (!verb) throw new UsageError(`${notOneOf(word, verbs)}\n\n${usage}`);
      if (takes[verb] && !rest[0]) throw new UsageError(`${verb} needs ${takes[verb]}\n\n${usage}`);
      const most = takes[verb] ? 2 : 1;
      if (rest.length > most) throw new UsageError(`${tooMany(rest.slice(most))}\n\n${usage}`);
      const arg = takes[verb] ? rest[0] : null;
      const dir = await resolveGame(folderArg(values.dir, takes[verb] ? rest[1] : rest[0], usage));
      const live = !!values.live;
      const whose = shown(dir) === '.' ? 'the game' : shown(dir);
      const where = live ? `${whose}'s database on xgames.fun` : `${whose}'s database on this machine`;
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
          const go = await asked({
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
        // the server's rule (creator-studio lib/game-database.mjs): while an export runs, nothing else is answered
        if (live && !values.json)
          console.error(
            `Exporting ${where}. While it runs (seconds for a small database, minutes for a large one) the database answers nothing else, so players' calls to the game's server wait or fail: best when few are playing.`,
          );
        const r = await dbExport(dir, { live, out: values.out ?? null, force: !!values.force, log });
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
          const go = await asked({
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
      const go = await asked({
        change,
        lines: [
          `${where[0].toUpperCase()}${where.slice(1)} ${onGame(change)} would go back to how it was at ${at}${p.preview?.bookmark ? ` (bookmark ${p.preview.bookmark})` : ''}. Everything written after that is lost; ${CMD} db export --live keeps a copy first.`,
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
