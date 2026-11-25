// `xcore connect`: the coding agents on this machine (Claude Code, Codex) get xcore's bring-your-own-game skill and
// everything `xcore loot connect` gives them (@xgamesfun/solana's connect: its MCP tools and its xsolana-economy skill),
// and the person gets a few lines they may paste into their project's AGENTS.md or CLAUDE.md. By default for the
// project folder it runs in only (`--scope project`: the agents' skills folders in it, .claude/skills and
// .agents/skills); `--scope user` for every project of this user. The folders are the solana kit's (its AGENTS table),
// and the tools are registered through each agent's own commands. AGENTS.md and CLAUDE.md are never written.
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { NO_SOLANA, solanaRoot } from '../lib/economy.mjs';
import { CMD } from '../lib/command.mjs';
import { ownWords } from './loot.mjs';
import { onPath } from '../lib/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')).version;
/** Where connect puts the skill and the tools: the project folder it runs in (the default), or every project. */
export const SCOPES = ['project', 'user'];
const SKILL = 'bring-your-own-game';
const SKILL_SOURCE = path.join(ROOT, 'skills', SKILL);

const usage = `Usage: xcore connect [--scope project|user] [--dry-run] [--json]

Set up the coding agents on this machine (Claude Code, Codex) to bring games to xgames.fun.

It copies xcore's bring-your-own-game skill into each agent's skills folder, and does everything ${CMD} loot connect
does (adds the xsolana tools and the xsolana-economy skill). By default this is for the current project folder only:
the skills go in its .claude/skills and .agents/skills. It then prints a few lines you can paste into the project's
AGENTS.md or CLAUDE.md; it never writes those files. A skills folder with the same name that is not xcore's is left
unchanged.

Options:
  --scope project   the current folder only (the default)
  --scope user      every project of this user (~/.claude/skills, ~/.agents/skills, and the user's MCP settings)
  --dry-run         show what it would copy and the commands it would run, without changing anything
  --json            print the result as JSON`;

/** The lines for a project's AGENTS.md or CLAUDE.md: where to start, for an agent that never loaded the skill. */
export const SNIPPET = [
  '## xgames.fun',
  `- To host a web game on xgames.fun, run \`npx -y @xgamesfun/xcore@${VERSION} adopt <folder>\`, then \`npx -y @xgamesfun/xcore@${VERSION} check <folder>\`, and follow what each prints (the bring-your-own-game skill has the steps).`,
  '- For anything on-chain (a token, a shop, prizes, staking), use the xsolana tools (xsolana_guide first) before writing any Anchor, Rust or Solidity.',
  '- The first publish of a folder, going live with an economy, a coin launch, a change to the live database, replacing or deleting a live secret, and writing over or deleting a live project file print first and need the person’s yes (`--yes <code>`).',
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
/**
 * What a dry run runs in place of an agent's program: nothing. `--version` answers whether the program is on PATH; any
 * other command (`mcp get`, `mcp add`) answers as not done, so it is said as what would run.
 */
function dryRunner(present) {
  return async (bin, args) => ({ code: args[0] === '--version' && present(bin) ? 0 : 1, out: '' });
}

export async function connectAgents({
  dryRun = false,
  scope = 'project',
  run,
  cwd = process.cwd(),
  env = process.env,
  present = bin => Boolean(onPath(bin, { env })),
} = {}) {
  const kit = await solanaConnect(env);
  if (!kit) throw Object.assign(new Error(NO_SOLANA), { code: 'no-solana' });
  // A dry run starts no agent's program (an agent's first run can write its own settings, ~/.claude.json): an agent
  // is found by its program on PATH, and every command is said, not run. A real run asks each program.
  if (dryRun) run = dryRunner(present);
  run ??= kit.runAgent;
  const agents = [];
  for (const [id, a] of Object.entries(kit.AGENTS)) {
    if ((await run(a.bin, ['--version'])).code !== 0) {
      agents.push({ agent: id, name: a.name, found: false });
      continue;
    }
    const dir = path.join(a.skills(scope, cwd), SKILL);
    const there = await skillFolder(dir);
    const action =
      there === 'other'
        ? 'left'
        : dryRun
          ? there === 'ours'
            ? 'would-replace'
            : 'would-copy'
          : there === 'ours'
            ? 'replaced'
            : 'copied';
    if (!dryRun && action !== 'left') {
      await mkdir(path.dirname(dir), { recursive: true });
      if (there === 'ours') await rm(dir, { recursive: true, force: true });
      await cp(SKILL_SOURCE, dir, { recursive: true });
    }
    agents.push({ agent: id, name: a.name, found: true, skill: { dir, action } });
  }
  const lines = [];
  const say = ownWords();
  const code = await kit.connect({ dryRun, scope, run, cwd, log: (...m) => lines.push(say(m.join(' '))) });
  const left = agents.some(a => a.skill?.action === 'left');
  return { ok: code === 0 && !left, dryRun, scope, agents, solana: { code, lines }, snippet: SNIPPET };
}

export default {
  name: 'connect',
  summary: "set up Claude Code and Codex with xcore's skill and the xsolana tools",
  usage,
  run: args =>
    guard(async () => {
      const { values } = parse(args, { 'dry-run': { type: 'boolean' }, scope: { type: 'string' } }, usage);
      const scope = values.scope ?? 'project';
      if (!SCOPES.includes(scope)) throw new UsageError(`--scope is project or user\n\n${usage}`);
      const r = await connectAgents({ dryRun: !!values['dry-run'], scope });
      if (values.json) {
        printJson(r);
        return r.ok ? 0 : 1;
      }
      for (const a of r.agents) {
        if (!a.found) continue;
        const { dir, action } = a.skill;
        console.log(
          action === 'left'
            ? `${a.name}: ${dir} is there already and is not xcore's ${SKILL} skill, so it ${r.dryRun ? 'would be' : 'was'} left as it is. Move it away, then run ${CMD} connect again.`
            : r.dryRun
              ? `${a.name}: would ${action === 'would-replace' ? `replace the ${SKILL} skill at` : `copy skills/${SKILL} to`} ${dir}`
              : `${a.name}: the ${SKILL} skill ${action === 'replaced' ? 'replaced' : 'copied'} at ${dir}.`,
        );
      }
      // (the economy tools' own dry run ends with the line this command ends with too: said once, below)
      for (const line of r.solana.lines)
        if (!/^Nothing was changed: this was a dry run\.?$/.test(line.trim())) console.log(line);
      if (r.agents.some(a => a.found))
        console.log(
          `\n${r.dryRun ? `Nothing was changed: this was a dry run. Without --dry-run, it would connect ${scope === 'project' ? `${process.cwd()} only` : 'every project of this user'}.` : scope === 'project' ? `Connected for ${process.cwd()} only (${CMD} connect --scope user for every project).` : 'Connected for every project of this user.'} These lines may go in a project's AGENTS.md or CLAUDE.md (${CMD} connect never writes them):\n\n${r.snippet}`,
        );
      return r.ok ? 0 : 1;
    }, args),
};
