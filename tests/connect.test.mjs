// `xcore connect`: xcore's skill into each agent's skills folder (the one @xgamesfun/solana's connect uses), the solana
// kit's connect as `xcore loot connect` runs it, and the lines for a project's AGENTS.md, never written there. Every
// test runs with HOME (and USERPROFILE) in a temporary folder and a stand-in for the agents' commands: nothing reaches
// the real ~/.claude or a real agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, run, tempDir } from './helpers.mjs';

/** HOME in `dir` for this test (os.homedir() reads it), put back after. */
function homeIn(t, dir) {
  const was = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  t.after(() => {
    for (const [k, v] of Object.entries(was))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  });
}

/** A stand-in for the agents' commands: which are installed, and every command they were given. */
function agents(installed) {
  const calls = [];
  const runAgent = async (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (!installed.includes(bin)) return { code: 1, out: 'not found' };
    if (args[0] === 'mcp' && args[1] === 'get') return { code: 1, out: 'No MCP server found' };
    return { code: 0, out: '' };
  };
  return { runAgent, calls };
}

test('connect: the skill copied for each agent found, the solana kit connected, and the project left alone', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const home = path.join(tmp.dir, 'home');
  const project = path.join(tmp.dir, 'project');
  await mkdir(home, { recursive: true });
  await mkdir(project, { recursive: true });
  homeIn(t, home);
  const { connectAgents, SNIPPET } = await import('../commands/connect.mjs');
  const { runAgent, calls } = agents(['claude']);

  // a dry run: says what it would copy and the commands it would run, and changes nothing
  let r = await connectAgents({ dryRun: true, run: runAgent, cwd: project });
  assert.equal(r.ok, true);
  const claude = r.agents.find(a => a.agent === 'claude');
  assert.deepEqual(claude.skill, {
    dir: path.join(home, '.claude', 'skills', 'bring-your-own-game'),
    action: 'copied',
  });
  assert.equal(r.agents.find(a => a.agent === 'codex').found, false);
  // the MCP server's command, as it is registered (not said as `xcore loot mcp`)
  assert.ok(
    r.solana.lines.some(l =>
      /^claude mcp add --transport stdio --scope user xsolana -- (npx|cmd) .*@xgamesfun\/solana@[\d.]+ xsolana mcp$/.test(
        l,
      ),
    ),
    r.solana.lines.join('\n'),
  );
  assert.ok(!r.solana.lines.some(l => /xcore loot mcp/.test(l)));
  assert.ok(!existsSync(path.join(home, '.claude')), 'a dry run writes nothing');
  assert.ok(!calls.some(c => / mcp add /.test(c)), 'a dry run registers nothing');

  // for real: the skill (with its references) and the solana kit's skill, under this HOME only
  r = await connectAgents({ run: runAgent, cwd: project });
  assert.equal(r.ok, true, JSON.stringify(r));
  const copied = path.join(home, '.claude', 'skills', 'bring-your-own-game');
  assert.equal(
    await readFile(path.join(copied, 'SKILL.md'), 'utf8'),
    await readFile(path.join(ROOT, 'skills', 'bring-your-own-game', 'SKILL.md'), 'utf8'),
  );
  assert.ok(existsSync(path.join(home, '.claude', 'skills', 'xsolana-economy', 'SKILL.md')), 'the solana skill too');
  assert.ok(
    calls.some(c => /^claude mcp add .* xsolana -- /.test(c)),
    'the xsolana tools registered',
  );
  assert.deepEqual(await readdir(project), [], "nothing written into the person's project");
  assert.match(SNIPPET, /npx -y @xgamesfun\/xcore check/);
  assert.match(SNIPPET, /xsolana/);
  assert.ok(SNIPPET.split('\n').length <= 5);

  // again: its own skill replaced; a folder of that name that is not xcore's is left as it is
  r = await connectAgents({ run: runAgent, cwd: project });
  assert.equal(r.agents.find(a => a.agent === 'claude').skill.action, 'replaced');
  await writeFile(path.join(copied, 'SKILL.md'), '---\nname: something-else\n---\nmine\n');
  r = await connectAgents({ run: runAgent, cwd: project });
  assert.equal(r.ok, false);
  assert.equal(r.agents.find(a => a.agent === 'claude').skill.action, 'left');
  assert.equal(await readFile(path.join(copied, 'SKILL.md'), 'utf8'), '---\nname: something-else\n---\nmine\n');
});

test('xcore connect --dry-run --json with no agent on this machine: says so, writes nothing', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const home = path.join(tmp.dir, 'home');
  await mkdir(home);
  // no agent can be found: PATH names an empty folder
  const r = run(['connect', '--dry-run', '--json'], {
    cwd: tmp.dir,
    env: { HOME: home, USERPROFILE: home, PATH: path.join(tmp.dir, 'empty') },
  });
  const out = JSON.parse(r.stdout);
  assert.equal(out.dryRun, true);
  assert.ok(out.agents.every(a => !a.found));
  assert.ok(out.solana.lines.some(l => /No coding agent found/.test(l)));
  assert.equal(r.status, 1);
  assert.deepEqual(await readdir(home), []);
});
