// `xcore files ls|put|get|rm|usage`: the game's project files (env.GF.files), on this machine (the ones `xcore dev`
// serves) or, with --live, on xgames.fun (../lib/files.mjs).
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { named, resolveGame } from '../lib/games.mjs';
import { filesGet, filesList, filesPut, filesRemove, filesUsage } from '../lib/files.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore files ls [prefix/] [--dir <game>] [--live] [--json]
       xcore files put <file> [path] [--public] [--type <mime>] [--dir <game>] [--live] [--json]
       xcore files get <path> [--out <file>] [--force] [--dir <game>] [--live] [--json]
       xcore files rm <path> [--dir <game>] [--live] [--json]
       xcore files usage [--dir <game>] [--live] [--json]

The game's project files: files you or the game's server write, never players (replays, generated levels, content
packs, a large saved world). The server reads and writes them with env.GF.files (docs/SERVER.md, "Project files").
Without --live, the ones on this machine that ${CMD} dev gives the server (kept in .gamesfun/dev/files/, never
published); with --live, the game's files on xgames.fun (each call kept in the game's audit log).
  ls [prefix/]       the files, or those in one folder ("replays/")
  put <file> [path]  a file from this machine, at [path] (default: its name). --public serves it at
                     https://<slug>.xgamesusercontent.com/<path>, another site (here: the files origin xcore dev
                     prints); without it only the game's server reads it. Up to 25 MB a file
  get <path>         a file's bytes, into --out <file> (default: its name here; --force writes over one)
  rm <path>          delete one
  usage              the bytes kept, against the game's cap (Free: 100 MB)
A path is letters, digits, . _ and -, with / between folders: levels/forest-3.json.
--dir <game> names the game's folder (default: the one you are in).`;

const mb = n =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} bytes`;

export default {
  name: 'files',
  summary: "the game's project files (env.GF.files): ls, put, get, rm, usage; here, or --live on xgames.fun",
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
        },
        usage,
      );
      const [verb, a, b] = positionals;
      if (!['ls', 'put', 'get', 'rm', 'usage'].includes(verb)) throw new UsageError(usage);
      if (['put', 'get', 'rm'].includes(verb) && !a)
        throw new UsageError(`${verb} needs ${verb === 'put' ? 'a file' : 'a path'}\n\n${usage}`);
      const dir = await resolveGame(values.dir);
      const live = !!values.live;
      const where = live ? 'on xgames.fun' : 'on this machine';
      const json = values.json ? printJson : null;

      if (verb === 'ls') {
        const r = await filesList(dir, { live, prefix: a ?? '' });
        if (json) return json(r);
        if (!r.items.length) console.log(`${named(dir)} has no project files ${where}${a ? ` in ${a}` : ''}.`);
        for (const f of r.items)
          console.log(`${f.public ? 'public ' : 'private'}  ${mb(f.bytes).padStart(9)}  ${f.path}  (${f.type})`);
        if (r.after) console.log(`… more after ${r.after}`);
        return 0;
      }
      if (verb === 'put') {
        const r = await filesPut(dir, a, b ?? null, { live, isPublic: !!values.public, type: values.type ?? null });
        if (json) return json(r);
        console.log(
          `Put ${r.path} ${where} (${mb(r.bytes)}${values.public ? ', public' : ', only the game’s server reads it'}).${r.url ? `\n  ${r.url}` : values.public && !live ? `\n  served at the files origin ${CMD} dev prints, /${r.path}` : ''}`,
        );
        return 0;
      }
      if (verb === 'get') {
        const r = await filesGet(dir, a, { live });
        const out = path.resolve(values.out ?? path.basename(a));
        if (json && !values.out) {
          const { body, ...facts } = r;
          return json({ ...facts, base64: body.toString('base64') });
        }
        if (existsSync(out) && !values.force)
          throw new UsageError(`${out} is there already: --force writes over it, or --out <file>\n\n${usage}`);
        await writeFile(out, r.body);
        const { body: _body, ...facts } = r;
        if (json) return json({ ...facts, file: out });
        console.log(`Got ${r.path} from ${where} (${mb(r.bytes)}, ${r.type}) into ${out}.`);
        return 0;
      }
      if (verb === 'rm') {
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
