#!/usr/bin/env node
// Installs the tools `xcore dev` runs a game's server with (Miniflare and workerd, the version lib/dev/tools.mjs names)
// into <folder>, the way xcore installs them on first use, and prints the folder to set GAMESFUN_SERVER_DEPS to: the
// tests that run a game's server under workerd skip without it. CI runs it; on your machine:
//   export GAMESFUN_SERVER_DEPS="$(node scripts/server-tools.mjs ~/.cache/xcore-server-tools)"
import path from 'node:path';
import { ensureTools } from '../lib/dev/tools.mjs';

const [folder] = process.argv.slice(2);
if (!folder) {
  console.error('usage: node scripts/server-tools.mjs <folder>');
  process.exit(2);
}
const env = { ...process.env, GAMESFUN_CONFIG_DIR: path.resolve(folder) };
delete env.GAMESFUN_SERVER_DEPS;
console.log(ensureTools({ env }));
