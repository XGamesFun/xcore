// A brought game's own backend (backend.json) and its Solana economy on loot (@xgamesfun/solana): where they go, what
// is refused, and the page client copied beside the economy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adopt, addLoot } from '../lib/publish/adopt.mjs';
import { ECONOMY_FILE, economyFile, lootProgram, solanaRoot } from '../lib/economy.mjs';
import { solanaRpc, rpcWords, SHARED_RPC } from '../lib/solana-rpc.mjs';
import { fixture, run, tempDir } from './helpers.mjs';
import { fromFolder, ownWords, rpcFor } from '../commands/loot.mjs';

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
  // (going live: a key file made here, then what it would send; the page only when asked for)
  assert.match(p.stdout, /xcore loot keygen ~\/\.config\/xsolana\/[a-z0-9-]+\.json/);
  assert.match(p.stdout, /xcore loot approve public\/xsolana\.json --keypair ~\/\.config\/xsolana\/[a-z0-9-]+\.json/);
  assert.match(p.stdout, /xcore loot approve public\/xsolana\.json --browser/);
  assert.doesNotMatch(p.stdout, /npx -y|xsolana (approve|check|keygen)/);
});

test('gamesfun loot approve opens nothing unless told how it is signed; a key file is made outside the game', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const examples = path.join(solanaRoot(), 'examples');
  const game = path.join(tmp.dir, 'game');
  await mkdir(path.join(game, 'public'), { recursive: true });
  await writeFile(
    path.join(game, 'public', 'xsolana.json'),
    await readFile(path.join(examples, 'artwork-auction.json')),
  );
  // No way to sign named: the two ways, in this package's words, and nothing started.
  const bare = run(['loot', 'approve', 'public/xsolana.json'], { cwd: game });
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /say how going live is signed/);
  assert.match(bare.stderr, /--keypair <keyfile>/);
  assert.match(bare.stderr, /xcore loot keygen <file>/);
  // A key file: its address is printed, never the key; the command it names is this package's.
  const keys = path.join(tmp.dir, 'keys');
  const made = run(['loot', 'keygen', path.join(keys, 'game.json')], { cwd: game });
  assert.equal(made.status, 0, made.stderr);
  const bytes = JSON.parse(await readFile(path.join(keys, 'game.json'), 'utf8'));
  assert.equal(bytes.length, 64);
  assert.ok(!made.stdout.includes(bytes.slice(0, 4).join(',')));
  assert.match(made.stdout, /Its address:\n {2}[1-9A-HJ-NP-Za-km-z]{32,44}\n/);
  assert.match(made.stdout, /xcore loot approve xsolana\.json --keypair /);
  // A key file named from where the person stands is found from the economy file's own folder, and its name ending
  // in .json is never taken for the economy file. (A key that does not exist is said before anything is read.)
  await mkdir(path.join(game, 'k'));
  const missing = run(['loot', 'approve', 'public/xsolana.json', '--keypair', 'k/none.json'], { cwd: game });
  assert.equal(missing.status, 1);
  // (the game's own k/ folder, however the system writes a path; never the economy file's folder)
  assert.match(missing.stderr, /game[\\/]k[\\/]none\.json does not exist/);
  assert.doesNotMatch(missing.stderr, /public[\\/]k[\\/]none\.json/);
  const first = run(['loot', 'approve', '--keypair=k/none.json', 'public/xsolana.json'], { cwd: game });
  assert.equal(first.status, 1);
  assert.match(first.stderr, /game[\\/]k[\\/]none\.json does not exist/);
  assert.doesNotMatch(first.stderr, /public[\\/](k[\\/])?none\.json/);
});

test('a key file named beside flags is given whole; approve never goes to the shared relay', () => {
  const cwd = path.resolve('/games/mine');
  assert.deepEqual(
    fromFolder(['approve', 'public/xsolana.json', '--keypair', 'keys/k.json', '--yes', 'ab12cd34'], cwd),
    ['approve', 'public/xsolana.json', '--keypair', path.join(cwd, 'keys/k.json'), '--yes', 'ab12cd34'],
  );
  assert.deepEqual(fromFolder(['approve', '--keypair=keys/k.json'], cwd), [
    'approve',
    `--keypair=${path.join(cwd, 'keys/k.json')}`,
  ]);
  assert.deepEqual(fromFolder(['approve', '--keypair', '~/.config/xsolana/k.json'], cwd), [
    'approve',
    '--keypair',
    '~/.config/xsolana/k.json',
  ]);
  assert.deepEqual(fromFolder(['approve', '--keypair', '/abs/k.json'], cwd), ['approve', '--keypair', '/abs/k.json']);
  // Going live makes mints and token accounts, which the shared relay does not pass: with no RPC of the person's
  // own, approve is left to the tools' default; every other command reads through the relay.
  const shared = solanaRpc({}, { file: null });
  assert.equal(rpcFor('approve', {}, shared), null);
  assert.equal(rpcFor('status', {}, shared), SHARED_RPC);
  assert.equal(rpcFor('check', {}, shared), SHARED_RPC);
  const own = solanaRpc({ XSOLANA_RPC_URL: 'https://own.example/rpc' }, { file: null });
  assert.equal(rpcFor('approve', {}, own), 'https://own.example/rpc');
  assert.equal(rpcFor('approve', { XSOLANA_RPC_URL: ' https://env.example/rpc ' }, shared), 'https://env.example/rpc');
});

test("loot's address is the installed tools' own, here and in the game's own rpc.js", async () => {
  const idl = JSON.parse(await readFile(path.join(solanaRoot(), 'js', 'client', 'idl', 'loot.json'), 'utf8'));
  assert.match(idl.address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.equal(lootProgram(), idl.address);
  assert.equal(lootProgram({ GAMESFUN_SOLANA: path.join(solanaRoot(), 'nowhere') }), null);
  // The file `xcore add rpc` writes into a game is the game's own from then on, so it carries the address as a word:
  // held here against the tools', so a move of the program is caught before a game's RPC refuses its transactions.
  const { RPC } = await import('../lib/client/server/rpc.js');
  assert.equal(RPC.scanPrograms[0], idl.address);
  // mainnet's loot, the kit's own constant for it
  const { CLUSTERS } = await import('@xgamesfun/solana/client');
  assert.deepEqual(RPC.loot, [CLUSTERS.devnet.program, CLUSTERS.mainnet.program]);
  assert.ok(RPC.scanPrograms.includes(CLUSTERS.mainnet.program));
});

test("xsolana's words as xcore's", () => {
  const say = ownWords({ file: 'public/xsolana.json', named: 'xsolana.json' });
  assert.equal(
    say('runs this: npx -y @xgamesfun/solana@0.20.1 approve xsolana.json'),
    'runs this: xcore loot approve public/xsolana.json',
  );
  assert.equal(
    say('1. npx -y @xgamesfun/solana@0.27.2 keygen ~/.config/xsolana/my-game.json'),
    '1. xcore loot keygen ~/.config/xsolana/my-game.json',
  );
  assert.equal(
    say('2. npx -y @xgamesfun/solana@0.27.2 approve xsolana.json --keypair ~/.config/xsolana/my-game.json'),
    '2. xcore loot approve public/xsolana.json --keypair ~/.config/xsolana/my-game.json',
  );
  assert.equal(say('(`xsolana keygen <file>` makes a key file)'), '(`xcore loot keygen <file>` makes a key file)');
  assert.equal(
    say('`xsolana check` then xsolana_simulate; xsolana_save stays'),
    '`xcore loot check` then xcore loot simulate; xsolana_save stays',
  );
  assert.equal(say('npx -y --package=@xgamesfun/solana@0.20.1 xsolana mcp'), 'xcore loot mcp');
  assert.equal(say('xsolana: the tools for loot'), 'xsolana: the tools for loot');
  assert.equal(say('  xsolana guide [part]            what'), '  xcore loot guide [part]         what');
});

test("the RPC: xgames.fun's shared relay unless XSOLANA_RPC_URL (or LOOT_RPC_URL) names a devnet one", () => {
  assert.deepEqual(solanaRpc({}, { file: null }), { url: SHARED_RPC, shared: true, problem: null, cluster: 'devnet' });
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

test('the RPC follows the economy’s cluster: mainnet’s relay with ?cluster=mainnet, an RPC of the other cluster refused, commands left to the tools on mainnet’s relay', async () => {
  const { economyCluster, relayFor } = await import('../lib/solana-rpc.mjs');
  assert.deepEqual(solanaRpc({}, { file: null, cluster: 'mainnet' }), {
    url: `${SHARED_RPC}?cluster=mainnet`,
    shared: true,
    problem: null,
    cluster: 'mainnet',
  });
  assert.equal(relayFor('/loot/v1/rpc', 'mainnet'), '/loot/v1/rpc?cluster=mainnet');
  assert.equal(relayFor('/loot/v1/rpc', 'devnet'), '/loot/v1/rpc');
  // a mainnet RPC is the economy's own on mainnet, and still a problem on devnet (xcore coin reads devnet's)
  assert.equal(
    solanaRpc({ XSOLANA_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=k' }, { file: null, cluster: 'mainnet' })
      .problem,
    null,
  );
  assert.match(
    solanaRpc({ XSOLANA_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=k' }, { file: null }).problem,
    /is a mainnet RPC, and the economy is on devnet/,
  );
  assert.match(
    solanaRpc({ XSOLANA_RPC_URL: 'https://api.devnet.solana.com' }, { file: null, cluster: 'mainnet' }).problem,
    /is not a mainnet RPC/,
  );
  // the relay answers published games' players on mainnet: a command here is left to the tools, which ask for an RPC
  assert.equal(rpcFor('check', {}, solanaRpc({}, { file: null, cluster: 'mainnet' })), null);
  assert.equal(
    rpcFor(
      'check',
      {},
      solanaRpc({ XSOLANA_RPC_URL: 'https://mainnet.example/rpc' }, { file: null, cluster: 'mainnet' }),
    ),
    'https://mainnet.example/rpc',
  );
  // the cluster of a folder's economy: its file's network, devnet when it names none or there is none
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const pathMod = (await import('node:path')).default;
  const dir = mkdtempSync(pathMod.join(tmpdir(), 'xcore-cluster-'));
  assert.equal(economyCluster(dir), 'devnet');
  writeFileSync(pathMod.join(dir, 'xsolana.json'), JSON.stringify({ version: 2, network: 'mainnet' }));
  assert.equal(economyCluster(dir), 'mainnet');
  writeFileSync(pathMod.join(dir, 'xsolana.json'), JSON.stringify({ version: 2 }));
  assert.equal(economyCluster(dir), 'devnet');
});
