// Small helpers several modules share. Node's own modules only: nothing of this package, so any module may import it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** A JSON file's value, or null when it is missing or not JSON. */
export const readJson = file => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * A JSON file the person keeps (gamesfun.json, xsolana.json, backend.json): its value, or null when there is no such
 * file. One that is there and cannot be read, or is not JSON, throws in words that name it (`name`: the file as the
 * person knows it) and say what to do, with code 'not-json': a broken file is never taken for a missing one.
 */
export const readOwnJson = (file, name = path.basename(file)) => {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw Object.assign(new Error(`${name} could not be read (${e.message}); fix it first`, { cause: e }), {
      code: 'not-json',
    });
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw Object.assign(new Error(`${name} is not valid JSON (${e.message}); fix it first`, { cause: e }), {
      code: 'not-json',
    });
  }
};

/** The SHA-256 of bytes or text, in hex. */
export const sha256 = data => createHash('sha256').update(data).digest('hex');

/** A count and its word: "1 file", "2 files" (`many` when adding an s is not the plural: "1 entry", "2 entries"). */
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/**
 * A size in bytes as a person reads it: "812 bytes", "2.3 KB", "4.3 MB", "100 MB", "1.5 GB". Every size a command
 * prints goes through here, in the units xgames.fun's limits are set in (1 MB is 1,048,576 bytes: a game's 100 MB, a
 * file's 25 MB, a save's 64 KB), so a size and the limit it is held to are said on one scale, and a limit reads as
 * the documents state it.
 */
export const sizeText = bytes => {
  const n = Number(bytes) || 0;
  if (n < 1024) return plural(n, 'byte');
  const units = ['KB', 'MB', 'GB'];
  let size = n / 1024,
    unit = 0;
  // 1,048,575 bytes is "1 MB", never "1024 KB"
  while (unit < units.length - 1 && Number(size.toFixed(1)) >= 1024) {
    size /= 1024;
    unit++;
  }
  return `${Number(size.toFixed(1))} ${units[unit]}`;
};
