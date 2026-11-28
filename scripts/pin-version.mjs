#!/usr/bin/env node
// Pins every `npx -y @xgamesfun/xcore` example in the README, docs/ and the skill to package.json's version, so a copied
// command runs the release the documents describe. Run it after `npm version` (CONTRIBUTING.md, "Releases");
// tests/docs.test.mjs fails while an example names another version or none.
import { readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** The documents whose npx examples are pinned. */
export const PINNED_DOCS = [
  'README.md',
  ...readdirSync(path.join(ROOT, 'docs'))
    .filter(f => f.endsWith('.md'))
    .map(f => `docs/${f}`),
  'skills/bring-your-own-game/SKILL.md',
];
/** `npx -y @xgamesfun/xcore`, with or without a version after it. */
export const NPX = /npx -y @xgamesfun\/xcore(?:@[\w.<>-]+)?(?![\w@/-])/g;

/** The text with every npx example at `v`. */
export const pinned = (text, v = version) => text.replace(NPX, `npx -y @xgamesfun/xcore@${v}`);

// run as a script (in any folder, with spaces or on Windows); imported by a test, it only exports
const entry = (() => {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return null;
  }
})();
if (import.meta.url === entry) {
  for (const rel of PINNED_DOCS) {
    const file = path.join(ROOT, rel);
    const text = readFileSync(file, 'utf8');
    const next = pinned(text);
    if (next !== text) {
      writeFileSync(file, next);
      console.log(`pinned ${rel} to ${version}`);
    }
  }
}
