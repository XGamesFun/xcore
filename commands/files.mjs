// `xcore files ls|put|get|rm|usage`: the game's project files (env.GF.files), on this machine (the ones `xcore dev`
// serves) or, with --live, on xgames.fun (../lib/files.mjs).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { guard, parse, printJson, UsageError, notOneOf, verbNamed } from '../lib/cli.mjs';
import { named, resolveGame } from '../lib/games.mjs';
import {
  filesGet,
  filesList,
  filesPut,
  filesRemove,
  filesUsage,
  liveFile,
  putOf,
  sizeText as mb,
} from '../lib/files.mjs';
import { consented } from '../lib/consent.mjs';
import { CMD, typedPath } from '../lib/command.mjs';
import { sha256 } from '../lib/util.mjs';
import { privateTarget, writePrivate } from '../lib/publish/private-file.mjs';
import { stateFolder } from '../lib/state-folder.mjs';

const usage = `Usage: xcore files list [prefix/] [--dir <game>] [--live] [--json]
       xcore files put <file> [path] [--public] [--type <mime>] [--dir <game>] [--live [--yes <code>]] [--json]
       xcore files get <path> [--out <file>] [--force] [--dir <game>] [--live] [--json]
       xcore files remove <path> [--dir <game>] [--live [--yes <code>]] [--json]
       xcore files usage [--dir <game>] [--live] [--json]

--dir <folder> names the game's folder (default: the current directory). ls also means list, and rm or delete also mean remove.

Manage the game's project files: files written by you or by the game's server, never by players (replays, generated
levels, content packs, a large saved world). The server reads and writes them with env.GF.files (docs/SERVER.md,
"Project files").

Without --live, the commands use the local files that ${CMD} dev gives the server (stored in .gamesfun/dev/files/,
never published). With --live, they use the game's files on xgames.fun, and each call is recorded in the game's
audit log.

Commands:
  list [prefix/]     list the files, or those in one folder ("replays/")
  put <file> [path]  upload a file from this machine to [path] (default: its file name). Up to 25 MB per file.
                     --public serves it at https://<slug>.xgamesusercontent.com/<path>, a separate site (locally: the
                     files origin ${CMD} dev prints); without --public, only the game's server can read it.
                     --type <mime> sets its content type
  get <path>         download a file to --out <file> (default: .gamesfun/downloads/<path> in the game's folder, never
                     published; --force overwrites). A file among the game's published files is refused: the next
                     publish would make it public. The file is readable by you only
  remove <path>      delete a file
  usage              show the bytes stored, against the game's cap (Free: 100 MB)

Options:
  --dir <game>       the game's folder (default: the current directory)

A path uses letters, digits, ".", "_" and "-", with "/" between folders: levels/forest-3.json.

Confirming live changes:
  A new path is uploaded immediately. Overwriting a file xgames.fun already has (put --live) or deleting one
  (remove --live) cannot be undone: xgames.fun keeps one copy of each file and no earlier versions. So these first print
  what would be replaced or deleted, with a code, and change nothing. Run the command again with --yes <code> to
  apply it. A code works once, within 15 minutes, and only for the change it was printed with. With --json, the
  printout is {planned: true, code, plan, confirm}: confirm is the command to run once the person has said yes.
  Local files change immediately.`;

/** A file xgames.fun has, in the words of a printout: "1.2 MB, public, image/png". */
const facts = f =>
  [...(f.bytes === undefined ? [] : [mb(f.bytes)]), f.public ? 'public' : 'private', f.type].join(', ');

export default {
  name: 'files',
  summary: "manage the game's project files (env.GF.files), locally or on xgames.fun",
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(
        args,
        {
          live: { type: 'boolean' },
          public: { type: 'boolean' },
          type: { type: 'string' },
          out: { type: 'string' },
          force: { type: 'boolean' },
          dir: { type: 'string' },
          yes: { type: 'string' },
        },
        usage,
      );
      const [word, a, b] = positionals;
      const verbs = ['list', 'put', 'get', 'remove', 'usage'];
      const verb = verbNamed(word, verbs);
      if (!verb) throw new UsageError(`${notOneOf(word, verbs)}\n\n${usage}`);
      if (['put', 'get', 'remove'].includes(verb) && !a)
        throw new UsageError(`${verb} needs ${verb === 'put' ? 'a file' : 'a path'}\n\n${usage}`);
      const dir = await resolveGame(values.dir);
      const live = !!values.live;
      const where = live ? 'on xgames.fun' : 'on this machine';
      const json = values.json ? printJson : null;

      if (verb === 'list') {
        const r = await filesList(dir, { live, prefix: a ?? '' });
        if (json) return json(r);
        if (!r.items.length) console.log(`${named(dir)} has no project files ${where}${a ? ` in ${a}` : ''}.`);
        for (const f of r.items)
          console.log(`${f.public ? 'public ' : 'private'}  ${mb(f.bytes).padStart(9)}  ${f.path}  (${f.type})`);
        if (r.after) console.log(`… more after ${r.after}`);
        return 0;
      }
      // the words a printout before a live change shares
      const liveGame = f => `${named(dir)}'s project files on xgames.fun (game ${f.game})`;
      const keepFirst = p => `${CMD} files get ${typedPath(p)} --live keeps a copy first`;
      if (verb === 'put') {
        if (live) {
          // what would be refused anyway (not there, too big to send, no path) is refused before anyone is asked
          const sending = await putOf(a, b ?? null, { live, type: values.type ?? null });
          const there = await liveFile(dir, sending.path);
          // a path xgames.fun has already: written over only after a yes to what it replaces (a new one is put at once)
          if (there.file) {
            const plan = {
              action: 'replace',
              origin: there.origin,
              game: there.game,
              path: there.path,
              was: there.file,
              file: path.basename(a),
              bytes: sending.bytes,
              sha256: sha256(await readFile(a)),
              type: sending.type,
              public: !!values.public,
            };
            const go = await consented({
              sub: 'files',
              args,
              values,
              plan,
              lines: [
                `${liveGame(there)} have ${there.path} already (${facts(there.file)}). This writes over it:`,
                `  file    ${plan.file} (${facts(plan)})`,
                `  sha256  ${plan.sha256}`,
                `The file there now is gone for good: xgames.fun keeps one copy of a file and no earlier one. ${keepFirst(there.path)}.`,
              ],
              nothing: 'Nothing was put',
            });
            if (go !== true) return go;
          }
        }
        const r = await filesPut(dir, a, b ?? null, { live, isPublic: !!values.public, type: values.type ?? null });
        if (json) return json(r);
        console.log(
          `Put ${r.path} ${where} (${mb(r.bytes)}${values.public ? ', public' : ', only the game’s server reads it'}).${r.url ? `\n  ${r.url}` : values.public && !live ? `\n  served at the files origin ${CMD} dev prints, /${r.path}` : ''}`,
        );
        return 0;
      }
      if (verb === 'get') {
        // a download is the game's own file, often one only its server reads: kept where publish never takes it
        const out = values.out ? path.resolve(values.out) : path.join(dir, '.gamesfun', 'downloads', ...a.split('/'));
        const target = { dir, force: !!values.force, what: 'this project file' };
        if (!(json && !values.out))
          try {
            privateTarget(out, target);
          } catch (e) {
            if (e.code === 'exists')
              throw new UsageError(`${out} is there already: --force writes over it, or --out <file>\n\n${usage}`);
            throw e;
          }
        const r = await filesGet(dir, a, { live });
        if (json && !values.out) {
          const { body, ...facts } = r;
          return json({ ...facts, base64: body.toString('base64') });
        }
        if (!values.out) await stateFolder(dir);
        await writePrivate(out, r.body, { ...target, force: true });
        const { body: _body, ...facts } = r;
        if (json) return json({ ...facts, file: out });
        console.log(
          `Got ${r.path} from ${live ? 'xgames.fun' : 'this machine'} (${mb(r.bytes)}, ${r.type}) into ${out}.`,
        );
        return 0;
      }
      if (verb === 'remove') {
        if (live) {
          const there = await liveFile(dir, a);
          if (!there.file) {
            if (json) return json({ ok: true, live: true, deleted: false });
            console.log(`${a} was not there ${where}.`);
            return 0;
          }
          const go = await consented({
            sub: 'files',
            args,
            values,
            plan: { action: 'delete', origin: there.origin, game: there.game, path: a, ...there.file },
            lines: [
              `This deletes ${a} (${facts(there.file)}) from ${liveGame(there)}.`,
              `It is gone for good: xgames.fun keeps one copy of a file and no earlier one. ${keepFirst(a)}.`,
            ],
            nothing: 'Nothing was deleted',
          });
          if (go !== true) return go;
        }
        const r = await filesRemove(dir, a, { live });
        if (json) return json(r);
        console.log(r.deleted ? `Deleted ${a} ${where}.` : `${a} was not there ${where}.`);
        return 0;
      }
      const r = await filesUsage(dir, { live });
      if (json) return json(r);
      console.log(
        `${named(dir)}'s project files ${where}: ${r.files} file${r.files === 1 ? '' : 's'}, ${mb(r.bytes)} of ${mb(r.cap)}.`,
      );
      return 0;
    }, args),
};
