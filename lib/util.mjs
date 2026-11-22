// Small helpers several modules share. Node's own modules only: nothing of this package, so any module may import it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** A JSON file's value, or null when it is missing or not JSON. */
export const readJson = file => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** The SHA-256 of bytes or text, in hex. */
export const sha256 = data => createHash('sha256').update(data).digest('hex');

/** A count and its word: "1 file", "2 files". */
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
