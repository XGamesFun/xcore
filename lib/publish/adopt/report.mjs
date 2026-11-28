// The report in words: its lines, and where the adopt leaves the game with the command to run next.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CMD } from '../../command.mjs';
import { plural, sizeText } from '../../util.mjs';

/** The report as plain lines (the command and the tool's text). */
export function reportLines(r, { shown = d => d } = {}) {
  const lines = [];
  const kind = r.shape
    ? r.shape.kind === 'build'
      ? `a project with a build (${r.shape.framework})`
      : r.shape.kind !== 'build' && r.page?.build
        ? `built by ${r.page.build}`
        : r.shape.kind === 'static' && r.shape.engine
          ? `a ${r.shape.engine} project (its web export, ${r.page?.out ?? 'as exported'}: export again after a change, then check)`
          : r.shape.kind === 'static' && r.shape.exported
            ? `a ${r.shape.exported} web export (the exported files only: change the game in its ${r.shape.exported} project and export again)`
            : r.shape.kind === 'static'
              ? `plain static files${r.shape.server ? ` (its ${r.shape.server.framework} server is not published${r.hasServer ? '; its server/ is' : ''})` : ''}`
              : r.shape.kind === 'server'
                ? `rendered by a server (${r.shape.framework})`
                : existsSync(path.join(r.dir, 'project.godot'))
                  ? 'a Godot project'
                  : existsSync(path.join(r.dir, 'ProjectSettings', 'ProjectVersion.txt'))
                    ? 'a Unity project'
                    : r.page
                      ? 'files made outside xcore'
                      : 'no game the kit can see'
    : '';
  const name = shown(r.dir);
  // (a folder refused before its shape was read has no kind to say: its name alone heads the list)
  lines.push(`${name === '.' ? path.basename(r.dir) : name}:${kind ? ` ${kind}.` : ''}`);
  if (r.built?.ran) lines.push(`  built with ${r.page?.build ?? 'its build'} in ${r.built.seconds} s`);
  if (r.page)
    lines.push(
      `  published folder: ${r.page.out}${r.page.build ? `, made by: ${r.page.build}` : ''}${r.page.static && r.page.static !== r.page.out ? `; client files such as gamesfun.js go in ${r.page.static}` : ''}; ${plural(r.files, 'file')}, ${sizeText(r.bytes)}`,
    );
  if (r.fromRecord) lines.push('  using settings from gamesfun.json (override with --build, --out or --static)');
  if (r.kept?.length) lines.push(`  kept from gamesfun.json: ${r.kept.join(', ')}`);
  if (r.wrote) lines.push('  wrote gamesfun.json with the build and publish settings');
  const list = (title, items) => {
    if (!items.length) return;
    lines.push('', `${title}:`);
    for (const i of items) lines.push(`  - ${i.what}`, `    fix: ${i.fix}`);
  };
  // a step before adopt can read the game (its packages) is not a reason it cannot be hosted
  list(
    'Before adopt can run',
    r.refused.filter(i => i.setup),
  );
  list(
    'Cannot be hosted as it is',
    r.refused.filter(i => !i.setup),
  );
  list('Fix before publishing', r.fix);
  list('Worth a look', r.warn);
  if (r.origins.declared.length) lines.push('', `backend.json lets the page reach: ${r.origins.declared.join(', ')}`);
  lines.push('', adoptNext(r, { shown }).words);
  return lines;
}

/**
 * Where an adopt leaves the game, and what to do next (the report's last line, and `state` and `next` in --json):
 *   refused (nothing recorded; `made` lists any file written to help, such as a Godot Web preset) → fix, adopt again
 *   fix     (recorded, with problems that stop a publish)                                         → fix, then check
 *   ready   (recorded; only "worth a look" left, if anything)                                     → check, then publish
 * → { state, words, next (the command to run, or null while something must be fixed by hand first) }
 */
export function adoptNext(r, { shown = d => d } = {}) {
  const name = shown(r.dir);
  // the folder for the next commands, when it is not the one they run in
  const at = name === '.' ? '' : ` ${/[\s"'$`\\]/.test(name) ? JSON.stringify(name) : name}`;
  if (r.refused.length)
    return {
      state: 'refused',
      words: r.made?.length
        ? `Wrote ${r.made.join(' and ')}; no record yet (gamesfun.json). Do the above and adopt again.`
        : 'Nothing was written. Fix the above and adopt again.',
      next: null,
    };
  if (r.fix.length)
    return {
      state: 'fix',
      words: `Next: fix the list above, then run ${CMD} check${at}.`,
      next: null,
    };
  return {
    state: 'ready',
    words: [
      'Next:',
      `  1. ${CMD} check${at}   run the page in Chrome as xgames.fun serves it`,
      `  2. ${CMD} card${at}    make its preview picture (optional: publish can use the check's screenshot)`,
      `  3. ${CMD} login && ${CMD} publish${at}`,
    ].join('\n'),
    next: `${CMD} check${at}`,
  };
}
