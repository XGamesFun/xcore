// A brought game's own backend (backend.json) and its Solana economy on loot (@xgamesfun/solana): where they go, what
// is refused, and the page client copied beside the economy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adopt, addLoot } from '../lib/publish/adopt.mjs';
import { ECONOMY_FILE, economyFile, solanaRoot } from '../lib/economy.mjs';
import { solanaRpc, rpcWords, SHARED_RPC } from '../lib/solana-rpc.mjs';
import { fixture, run, tempDir } from './helpers.mjs';
import { ownWords } from '../commands/loot.mjs';

test('backend use custom: backend.json in the folder the build copies, its origins checked', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'vite-like');
  await adopt(dir);
  const r = run([
    'backend',
    'use',
    'custom',
    dir,
    '--url',
    'https://api.orbit-example.net',
    '--origin',
    'wss://api.orbit-example.net',
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'public', 'backend.json'), 'utf8')), {
    version: 1,
    provider: 'custom',
    url: 'https://api.orbit-example.net',
    origins: ['https://api.orbit-example.net', 'wss://api.orbit-example.net'],
  });
  // --url alone: its wss:// twin comes with it
  assert.equal(run(['backend', 'use', 'custom', dir, '--url', 'https://api.orbit-example.net/v1']).status, 0);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'public', 'backend.json'), 'utf8')).origins, [
    'https://api.orbit-example.net',
    'wss://api.orbit-example.net',
  ]);
  // xgames.fun's own hosts: its publish route refuses them, so xcore does too (the game reaches its own host anyway)
  const own = run(['backend', 'use', 'custom', dir, '--url', 'https://play.xgames.fun/loot/v1/health']);
  assert.equal(own.status, 1);
  assert.match(own.stderr, /play\.xgames\.fun" is xgames\.fun itself/);
  for (const bad of ['http://localhost:3000', 'https://10.0.0.1'])
    assert.equal(run(['backend', 'use', 'custom', dir, '--url', bad]).status, 1, bad);
});

test("an economy: where it goes, then @xgamesfun/solana's page client beside it; loot.json still read", async t => {
  assert.ok(solanaRoot(), '@xgamesfun/solana is installed with this package');
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'vite-like');
  await adopt(dir);
  const before = await addLoot(dir);
  assert.equal(before.economy, null);
  assert.match(before.steps.join('\n'), /xsolana_save \{"spec": …, "file": "public\/xsolana\.json"\}/);
  await writeFile(path.join(dir, 'public', ECONOMY_FILE), '{}');
  const after = await addLoot(dir);
  assert.equal(after.page.package, '@xgamesfun/solana');
  assert.ok(
    existsSync(path.join(dir, 'public', 'gf', 'loot', 'play', 'index.js')) &&
      existsSync(path.join(dir, 'public', 'gf', 'loot', 'wallets.js')),
  );
  assert.equal((await addLoot(dir)).page.changed, false, "a copy that is the installed package's is left alone");
  // the copy this package puts in the game fits the hosting it checks: nothing in gf/loot/ is a fix
  const again = await adopt(dir, { noBuild: true });
  assert.deepEqual(
    again.fix.filter(f => /gf\/loot\//.test(f.what)).map(f => f.what),
    [],
  );
  assert.match(run(['loot', 'add', '--help']).stdout, /^Usage: xcore loot add/);
  const old = await fixture(tmp, 'static');
  await writeFile(path.join(old, 'loot.json'), '{}');
  assert.equal(economyFile(old), path.join(old, 'loot.json'));
});

test("an engine's export: the economy goes in a folder of the project's own, laid over the export", async t => {
  const { buildTree } = await import('../lib/publish/tree.mjs');
  const { checkPage, pageRoots, writePage } = await import('../lib/publish/page.mjs');
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = path.join(tmp.dir, 'godot-game');
  await mkdir(path.join(dir, 'build', 'web'), { recursive: true });
  await writeFile(path.join(dir, 'project.godot'), 'config_version=5\n');
  await writeFile(
    path.join(dir, 'build', 'web', 'index.html'),
    '<!doctype html><title>Godot game</title><canvas></canvas>',
  );
  await writeFile(path.join(dir, 'build', 'web', 'index.pck'), 'pck');
  await writeFile(path.join(dir, 'build', 'web', 'note.txt'), "the export's");
  await writePage(dir, { out: 'build/web' });
  const first = await addLoot(dir);
  assert.equal(path.relative(dir, first.home), 'gamesfun', 'not the export folder');
  assert.ok(existsSync(path.join(dir, 'gamesfun', '.gdignore')), 'Godot keeps out of it');
  assert.equal(JSON.parse(await readFile(path.join(dir, 'gamesfun.json'), 'utf8')).page.static, 'gamesfun');
  assert.ok(first.steps.some(s => /laid over the engine's export \(build\/web\)/.test(s)));
  await writeFile(path.join(dir, 'gamesfun', ECONOMY_FILE), JSON.stringify({ name: 'godot-game' }));
  await writeFile(path.join(dir, 'gamesfun', 'note.txt'), "the overlay's");
  const second = await addLoot(dir);
  assert.equal(second.page.changed, true);
  const roots = pageRoots(dir);
  assert.equal(roots.overlay, path.join(dir, 'gamesfun'));
  const built = await buildTree(dir);
  const paths = built.tree.files.map(f => f.path);
  for (const p of ['index.html', 'index.pck', ECONOMY_FILE, 'gf/loot/play/index.js'])
    assert.ok(paths.includes(p), `${p} goes up`);
  assert.ok(!paths.includes('.gdignore'));
  assert.equal(paths.filter(p => p === 'note.txt').length, 1, 'a file in both goes up once');
  const note = built.tree.files.find(f => f.path === 'note.txt');
  const { sourceBytes } = await import('../lib/publish/tree.mjs');
  assert.equal(String(await sourceBytes(built.sources.get(note.sha256))), "the overlay's", "the overlay's copy wins");
  // adopt again keeps it; a static folder inside the export (or around it) is refused when there is no build
  await adopt(dir, {});
  assert.equal(JSON.parse(await readFile(path.join(dir, 'gamesfun.json'), 'utf8')).page.static, 'gamesfun');
  assert.throws(() => checkPage({ out: 'build/web', static: 'build/web/extra' }), /folders apart/);
  assert.throws(() => checkPage({ out: 'build/web', static: '.' }), /folders apart/);
  assert.equal(checkPage({ out: 'build/web', static: 'gamesfun' }).static, 'gamesfun');
  // a web game with no build keeps its economy in its own folder, as before
  const plain = path.join(tmp.dir, 'plain');
  await mkdir(plain);
  await writeFile(path.join(plain, 'index.html'), '<!doctype html><title>p</title>');
  assert.equal((await addLoot(plain)).home, plain);
});

test("gamesfun loot runs @xgamesfun/solana's own tools on the economy file", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const examples = path.join(solanaRoot(), 'examples');
  await writeFile(
    path.join(tmp.dir, 'xsolana.json'),
    await readFile(
      path.join(
        examples,
        readdirSync(examples).find(f => f.endsWith('.json')),
      ),
    ),
  );
  const r = run(['loot', 'check'], { cwd: tmp.dir });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Ready|warning/);
  // its commands said as this package's, the file as it was named
  await mkdir(path.join(tmp.dir, 'public'));
  await rename(path.join(tmp.dir, 'xsolana.json'), path.join(tmp.dir, 'public', 'xsolana.json'));
  const p = run(['loot', 'publish', 'public/xsolana.json'], { cwd: tmp.dir });
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /xcore loot approve public\/xsolana\.json/);
  assert.doesNotMatch(p.stdout, /npx -y|xsolana (approve|check)/);
});

test("xsolana's words as xcore's", () => {
  const say = ownWords({ file: 'public/xsolana.json', named: 'xsolana.json' });
  assert.equal(
    say('runs this: npx -y @xgamesfun/solana@0.20.1 approve xsolana.json'),
    'runs this: xcore loot approve public/xsolana.json',
  );
  assert.equal(
    say('`xsolana check` then xsolana_simulate; xsolana_save stays'),
    '`xcore loot check` then xcore loot simulate; xsolana_save stays',
  );
  assert.equal(say('npx -y --package=@xgamesfun/solana@0.20.1 xsolana mcp'), 'xcore loot mcp');
  assert.equal(say('xsolana: the tools for loot'), 'xsolana: the tools for loot');
  assert.equal(say('  xsolana guide [part]            what'), '  xcore loot guide [part]         what');
});

test("the RPC: xgames.fun's shared relay unless XSOLANA_RPC_URL (or LOOT_RPC_URL) names a devnet one", () => {
  assert.deepEqual(solanaRpc({}, { file: null }), { url: SHARED_RPC, shared: true, problem: null });
  assert.equal(
    solanaRpc({ XSOLANA_RPC_URL: 'https://own.example/rpc' }, { file: null }).url,
    'https://own.example/rpc',
  );
  assert.equal(solanaRpc({ LOOT_RPC_URL: 'https://old.example/rpc' }, { file: null }).url, 'https://old.example/rpc');
  assert.match(
    solanaRpc({ XSOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com' }, { file: null }).problem,
    /mainnet/,
  );
  assert.doesNotMatch(
    rpcWords(solanaRpc({ XSOLANA_RPC_URL: 'https://own.example/rpc?api-key=secret' }, { file: null })),
    /secret/,
  );
});
