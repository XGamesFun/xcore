// `xcore connect`: the coding agents on this machine (Claude Code, Codex) get xcore's bring-your-own-game skill and
// everything `xcore loot connect` gives them (@xgamesfun/solana's connect: its MCP tools and its xsolana-economy skill),
// and the person gets a few lines they may paste into their project's AGENTS.md or CLAUDE.md. The skill goes into each
// agent's own skills folder for the whole user, the folder the solana kit's connect uses (its AGENTS table); the tools
// are registered through each agent's own commands. Nothing is written into the person's project.
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { guard, parse, printJson } from '../lib/cli.mjs';
import { solanaRoot } from '../lib/economy.mjs';
import { CMD } from '../lib/command.mjs';
import { ownWords } from './loot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = 'bring-your-own-game';
const SKILL_SOURCE = path.join(ROOT, 'skills', SKILL);

const usage = `Usage: xcore connect [--dry-run] [--json]

Gives the coding agents on this machine (Claude Code, Codex) what they need to bring a game to xgames.fun: xcore's
bring-your-own-game skill, copied into each agent's skills folder for every project of this user, and everything
${CMD} loot connect does (the xsolana tools and the xsolana-economy skill). Then it prints a few lines you may
paste into a project's AGENTS.md or CLAUDE.md; it never writes into your project. A skills folder of that name that
is not xcore's is left as it is.
  --dry-run   say what it would copy and the commands it would run, and change nothing`;

/** The lines for a project's AGENTS.md or CLAUDE.md: where to start, for an agent that never loaded the skill. */
export const SNIPPET = [
  '## xgames.fun',
  '- To host a web game on xgames.fun, run `npx -y @xgamesfun/xcore adopt <folder>`, then `npx -y @xgamesfun/xcore check <folder>`, and follow what each prints (the bring-your-own-game skill has the steps).',
  '- For anything on-chain (a token, a shop, prizes, staking), use the xsolana tools (xsolana_guide first) before writing any Anchor, Rust or Solidity.',
  '- Going live with an economy, a coin launch, a change to the live database and replacing or deleting a live secret print first and need the person’s yes (`--yes <code>`).',
].join('\n');

/** What is in a skill folder: 'none', 'ours' (its SKILL.md is named bring-your-own-game), or 'other'. */
export async function skillFolder(dir) {
  try {
    await stat(dir);
  } catch {
    return 'none';
  }
  try {
    const text = await readFile(path.join(dir, 'SKILL.md'), 'utf8');
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
    return new RegExp(`^name:\\s*["']?${SKILL}["']?\\s*$`, 'm').test(front) ? 'ours' : 'other';
  } catch {
    return 'other';
  }
}

/** @xgamesfun/solana's connect (its AGENTS table, runAgent and connect), from the installed package or GAMESFUN_SOLANA. */
async function solanaConnect(env = process.env) {
  const root = solanaRoot(env);
  if (!root) return null;
  try {
    return await import(pathToFileURL(path.join(root, 'js', 'connect', 'connect.mjs')).href);
  } catch {
    return null;
  }
}

/**
 * Connects each agent found: the skill copied (or, with dryRun, said), then the solana kit's connect as `xcore loot
 * connect` runs it. `run(bin, args)` → {code, out} runs an agent's command (the kit's runAgent by default).
 * → {ok, dryRun, agents: [{agent, name, found, skill?: {dir, action}}], solana: {code, lines}, snippet}
 */
export async function connectAgents({ dryRun = false, run, cwd = process.cwd(), env = process.env } = {}) {
  const kit = await solanaConnect(env);
  if (!kit)
    throw Object.assign(
      new Error(
        'The economy tools (@xgamesfun/solana) are not installed here: reinstall @xgamesfun/xcore (npm i @xgamesfun/xcore), or set GAMESFUN_SOLANA to a solana-kit checkout.',
      ),
      { code: 'no-solana' },
    );
  run ??= kit.runAgent;
  const agents = [];
  for (const [id, a] of Object.entries(kit.AGENTS)) {
    if ((await run(a.bin, ['--version'])).code !== 0) {
      agents.push({ agent: id, name: a.name, found: false });
      continue;
    }
    const dir = path.join(a.skills('user', cwd), SKILL);
    const there = await skillFolder(dir);
    const action = there === 'other' ? 'left' : there === 'ours' ? 'replaced' : 'copied';
    if (!dryRun && action !== 'left') {
      await mkdir(path.dirname(dir), { recursive: true });
      if (there === 'ours') await rm(dir, { recursive: true, force: true });
      await cp(SKILL_SOURCE, dir, { recursive: true });
    }
    agents.push({ agent: id, name: a.name, found: true, skill: { dir, action } });
  }
  const lines = [];
  const say = ownWords();
  const code = await kit.connect({ dryRun, run, cwd, log: (...m) => lines.push(say(m.join(' '))) });
  const left = agents.some(a => a.skill?.action === 'left');
  return { ok: code === 0 && !left, dryRun, agents, solana: { code, lines }, snippet: SNIPPET };
}

export default {
  name: 'connect',
  summary: "give Claude Code and Codex xcore's skill and the xsolana tools; prints lines for a project's AGENTS.md",
  usage,
  run: args =>
    guard(async () => {
      const { values } = parse(args, { 'dry-run': { type: 'boolean' } }, usage);
      const r = await connectAgents({ dryRun: !!values['dry-run'] });
      if (values.json) {
        printJson(r);
        return r.ok ? 0 : 1;
      }
      for (const a of r.agents) {
        if (!a.found) continue;
        const { dir, action } = a.skill;
        console.log(
          action === 'left'
            ? `${a.name}: ${dir} is there already and is not xcore's ${SKILL} skill, so it was left as it is. Move it away, then run ${CMD} connect again.`
            : r.dryRun
              ? `${action === 'replaced' ? `replace the ${SKILL} skill at` : `copy skills/${SKILL} to`} ${dir}`
              : `${a.name}: the ${SKILL} skill ${action === 'replaced' ? 'replaced' : 'copied'} at ${dir}.`,
        );
      }
      for (const line of r.solana.lines) console.log(line);
      if (r.agents.some(a => a.found))
        console.log(
          `\nFor an agent working in one of your projects, these lines may go in that project's AGENTS.md or CLAUDE.md (${CMD} connect writes nothing there):\n\n${r.snippet}`,
        );
      return r.ok ? 0 : 1;
    }, args),
};
