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
import { spawn } from 'node:child_process';
import { BIN, fixture, run, tempDir } from './helpers.mjs';
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

test('xcore loot mcp lists the tools under the names they answer to, and a call to a listed name works', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const child = spawn(process.execPath, [BIN, 'loot', 'mcp'], {
    cwd: tmp.dir,
    env: { ...process.env, GAMESFUN_KIT: '' },
  });
  t.after(() => child.kill());
  const answers = new Map();
  let rest = '';
  child.stdout.setEncoding('utf8');
  const got = id =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer ${id}: ${rest}`)), 60_000);
      const look = () => {
        if (!answers.has(id)) return;
        clearTimeout(timer);
        child.stdout.off('data', look);
        resolve(answers.get(id));
      };
      child.stdout.on('data', look);
      look();
    });
  child.stdout.on('data', chunk => {
    const lines = (rest + chunk).split('\n');
    rest = lines.pop();
    for (const l of lines.filter(Boolean)) {
      const m = JSON.parse(l);
      answers.set(m.id, m);
    }
  });
  const send = m => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  send({
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
  });
  await got(1);
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  const names = (await got(2)).result.tools.map(x => x.name);
  assert.ok(names.length > 5, names.join(', '));
  assert.deepEqual(
    names.filter(n => !/^xsolana_[a-z_]+$/.test(n)),
    [],
    'every listed name is a valid MCP tool name the server answers to',
  );
  assert.ok(names.includes('xsolana_check'));
  send({ id: 3, method: 'tools/call', params: { name: 'xsolana_guide', arguments: {} } });
  const call = await got(3);
  assert.notEqual(call.result?.isError, true, JSON.stringify(call).slice(0, 400));
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
  assert.equal(bare.status, 2, 'a usage mistake (@xgamesfun/solana 0.29.12 and later)');
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
  // (the economy file it finds from where the person stands: @xgamesfun/solana 0.29.13 and later)
  assert.match(made.stdout, /xcore loot approve public\/xsolana\.json --keypair /);
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
  assert.deepEqual(fromFolder(['handover', '--keypair', 'k.json', '--to=keys/new.json'], cwd), [
    'handover',
    '--keypair',
    path.join(cwd, 'k.json'),
    `--to=${path.join(cwd, 'keys/new.json')}`,
  ]);
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
  const plain = ownWords();
  assert.equal(
    plain('`xsolana check` then xsolana_simulate; xsolana_save stays'),
    '`xcore loot check` then xcore loot simulate; xsolana_save stays',
  );
  // a file named from elsewhere: the commands it suggests that read the file name it too, run from here
  assert.equal(
    say('Next: xsolana simulate and xsolana explain, or xsolana check [file]'),
    'Next: xcore loot simulate public/xsolana.json and xcore loot explain public/xsolana.json, or xcore loot check [file]',
  );
  assert.equal(
    say('then xsolana handover --keypair k.json'),
    'then xcore loot handover public/xsolana.json --keypair k.json',
  );
  // the MCP server's command is what connect registers in an agent: said as it is, so a dry run shows the real thing
  assert.equal(
    say(
      'claude mcp add --transport stdio --scope user xsolana -- npx -y --package=@xgamesfun/solana@0.20.1 xsolana mcp',
    ),
    'claude mcp add --transport stdio --scope user xsolana -- npx -y --package=@xgamesfun/solana@0.20.1 xsolana mcp',
  );
  assert.equal(
    say('cmd /c npx -y --package=@xgamesfun/solana@0.20.1 xsolana mcp'),
    'cmd /c npx -y --package=@xgamesfun/solana@0.20.1 xsolana mcp',
  );
  assert.equal(plain('npx -y --package=@xgamesfun/solana@0.20.1 xsolana check'), 'xcore loot check');
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

test('the RPC follows the economy’s cluster: mainnet’s relay with ?cluster=mainnet, an RPC of the other cluster refused, commands left to the tools on mainnet’s relay', async t => {
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
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const { dir } = tmp;
  assert.equal(economyCluster(dir), 'devnet');
  await writeFile(path.join(dir, 'xsolana.json'), JSON.stringify({ version: 2, network: 'mainnet' }));
  assert.equal(economyCluster(dir), 'mainnet');
  await writeFile(path.join(dir, 'xsolana.json'), JSON.stringify({ version: 2 }));
  assert.equal(economyCluster(dir), 'devnet');
});

test('the cluster is read where the economy is: a named file, the folder, a brought game’s static folder; loot.json too; an unknown network is devnet', async t => {
  const { economyCluster, LOOT_PROGRAMS } = await import('../lib/solana-rpc.mjs');
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = path.join(tmp.dir, 'where'),
    brought = path.join(tmp.dir, 'brought');
  await mkdir(dir);
  await writeFile(path.join(dir, 'other.json'), JSON.stringify({ version: 2, network: 'mainnet' }));
  assert.equal(economyCluster(path.join(dir, 'other.json')), 'mainnet', 'a file named on the command');
  assert.equal(economyCluster(dir), 'devnet', 'the folder has none');
  await writeFile(path.join(dir, 'loot.json'), JSON.stringify({ version: 2, network: 'mainnet' }));
  assert.equal(economyCluster(dir), 'mainnet', 'an older game’s loot.json');
  await writeFile(path.join(dir, 'xsolana.json'), JSON.stringify({ version: 2, network: 'testnet' }));
  assert.equal(economyCluster(dir), 'devnet', 'a network loot does not know');
  // a brought game: its economy in its static folder (gamesfun.json)
  await mkdir(path.join(brought, 'public'), { recursive: true });
  await writeFile(
    path.join(brought, 'gamesfun.json'),
    JSON.stringify({ name: 'g', page: { static: 'public', out: 'dist' } }),
  );
  await writeFile(path.join(brought, 'public', 'xsolana.json'), JSON.stringify({ version: 2, network: 'mainnet' }));
  assert.equal(economyCluster(brought), 'mainnet');
  assert.deepEqual(Object.keys(LOOT_PROGRAMS), ['devnet', 'mainnet']);
});

test('the page’s wallet chain and relay follow the economy’s cluster', async () => {
  const w = await import('../loot-page/wallets.js');
  assert.deepEqual(
    [w.chainOf('devnet'), w.chainOf('mainnet'), w.chainOf(undefined)],
    ['solana:devnet', 'solana:mainnet', 'solana:devnet'],
  );
  assert.equal(w.pageRpc('devnet'), w.PAGE_RPC);
  assert.equal(w.pageRpc('mainnet'), `${w.PAGE_RPC}?cluster=mainnet`);
});

test('a mainnet page: the wallet signer names its chain, or the kit settles on devnet before solanaApp names mainnet', async () => {
  const { execFileSync } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  const play = new URL('../node_modules/@xgamesfun/solana/js/play/index.js', import.meta.url).href;
  const run = chain => {
    const code = `import * as p from ${JSON.stringify(play)};
const wallet = { name: 'W', features: { 'solana:signTransaction': { signTransaction: async () => [] } } };
const signer = p.walletStandardSigner(wallet, { address: '11111111111111111111111111111111' }${chain ? `, ${JSON.stringify(chain)}` : ''});
try { p.solanaApp({ spec: { network: 'mainnet', live: { project: '11111111111111111111111111111111' } }, rpcUrl: 'https://mainnet.example/', wallet: signer }); console.log('ok'); } catch (e) { console.log(e.message); }`;
    return execFileSync(process.execPath, ['--input-type=module', '-e', code], {
      encoding: 'utf8',
      env: { ...process.env, XSOLANA_CLUSTER: '' },
    }).trim();
  };
  assert.match(run(null), /already works on devnet/, 'the hazard: the default chain settles devnet');
  assert.equal(run('solana:mainnet'), 'ok');
  // and the page names it
  const page = readFileSync(new URL('../lib/client/gamesfun.js', import.meta.url), 'utf8');
  assert.match(
    page,
    /walletStandardSigner\(\s*w,\s*account,\s*m\.wallets\.chainOf \? m\.wallets\.chainOf\(lootCluster\(\)\)/,
  );
});

test("xcore loot --help lists every command of the installed tools, and <command> --help is that command's own", () => {
  const list = run(['loot', '--help']);
  assert.equal(list.status, 0);
  for (const c of ['check', 'approve', 'handover', 'keygen', 'token', 'client'])
    assert.match(list.stdout, new RegExp(`^ {2}xcore loot ${c}\\b`, 'm'), c);
  assert.doesNotMatch(list.stdout, /^Usage: xsolana /m);
  const one = run(['loot', 'handover', '--help']);
  assert.equal(one.status, 0);
  assert.match(one.stdout, /^Usage: xcore loot handover \[file\] --keypair <owner keyfile> --to <new owner keyfile>/);
  assert.match(run(['loot', 'add', '--help']).stdout, /^Usage: xcore loot add/);
});

test('loot add refuses an economy file that does not read, before anything is copied', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  await writeFile(path.join(dir, 'xsolana.json'), '{"grants": [');
  const r = run(['loot', 'add', dir]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /xsolana\.json is not valid JSON/);
  assert.equal(existsSync(path.join(dir, 'gf')), false, 'no page client copied');
  await writeFile(path.join(dir, 'xsolana.json'), '[]');
  const list = run(['loot', 'add', dir, '--json']);
  assert.equal(list.status, 1);
  assert.equal(JSON.parse(list.stdout).code, 'not-json');
  assert.match(JSON.parse(list.stdout).error, /holds no economy/);
});

test('backend use custom keeps the origins backend.json had, says so, and refuses a file that does not read', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  const file = path.join(dir, 'backend.json');
  await writeFile(file, JSON.stringify({ origins: ['https://api.orbit-example.net'] }));
  const r = run(['backend', 'use', 'custom', dir, '--url', 'https://api.example.com', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.deepEqual(out.kept, ['https://api.orbit-example.net']);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).origins, [
    'https://api.example.com',
    'wss://api.example.com',
    'https://api.orbit-example.net',
  ]);
  const words = run(['backend', 'use', 'custom', dir, '--url', 'https://api.example.com']);
  assert.match(words.stdout, /https:\/\/api\.orbit-example\.net was in it already and is kept/);
  for (const broken of ['{"origins": ["https://api.orbit-example.net"', '[]', 'null']) {
    await writeFile(file, broken);
    const b = run(['backend', 'use', 'custom', dir, '--url', 'https://api.example.com']);
    assert.equal(b.status, 1, broken);
    assert.match(b.stderr, /backend\.json (is not valid JSON|is not a JSON object)/, broken);
    assert.equal(await readFile(file, 'utf8'), broken, 'left as it was');
  }
});

test('backend use custom with a new --url replaces the backend it named, and an over-full file names its own origins', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await fixture(tmp, 'static');
  const file = path.join(dir, 'backend.json');
  const origins = async () => JSON.parse(await readFile(file, 'utf8')).origins;
  assert.equal(
    run(['backend', 'use', 'custom', dir, '--url', 'https://a.example.com', '--origin', 'https://cdn.example.org'])
      .status,
    0,
  );
  for (const host of ['b', 'c', 'd', 'e', 'f']) {
    const r = run(['backend', 'use', 'custom', dir, '--url', `https://${host}.example.com/api`]);
    assert.equal(r.status, 0, r.stderr);
  }
  assert.deepEqual(await origins(), ['https://f.example.com', 'wss://f.example.com', 'https://cdn.example.org']);
  // the same url again keeps it as it is
  run(['backend', 'use', 'custom', dir, '--url', 'https://f.example.com']);
  assert.deepEqual(await origins(), ['https://f.example.com', 'wss://f.example.com', 'https://cdn.example.org']);
  // over the cap with the file's own origins: they are named, and the file is left as it was
  const many = Array.from({ length: 7 }, (_, i) => `https://h${i}.example.net`);
  await writeFile(file, JSON.stringify({ url: 'https://f.example.com', origins: many }));
  const over = run(['backend', 'use', 'custom', dir, '--url', 'https://g.example.com']);
  assert.equal(over.status, 1);
  assert.match(over.stderr, /at most 8/);
  assert.match(
    over.stderr,
    /has https:\/\/h0\.example\.net, .*https:\/\/h6\.example\.net already, and they are kept: take the ones/,
  );
  assert.deepEqual(await origins(), many);
});

test('loot with a command the tools do not have, and --json: a usage refusal as JSON on stdout', () => {
  const r = run(['loot', 'bogus', '--json']);
  assert.equal(r.status, 2, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual([out.ok, out.code], [false, 'usage']);
  assert.match(out.error, /Unknown subcommand "bogus"/);
  // without --json, the tools' own words
  assert.notEqual(run(['loot', 'bogus']).status, 0);
  // --json before the command is for that command
  const first = run(['loot', '--json', 'bogus']);
  assert.equal(first.status, 2, first.stderr);
  assert.match(JSON.parse(first.stdout).error, /Unknown subcommand "bogus"/);
  const guide = run(['loot', '--json', 'guide']);
  assert.equal(guide.status, 0, guide.stderr);
  assert.equal(typeof JSON.parse(guide.stdout).text, 'string');
});

test("loot handover reads a loot.json game's file, version names the program of the folder's cluster, a refusal says xcore", async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const legacy = path.join(tmp.dir, 'legacy');
  await mkdir(legacy);
  const examples = path.join(solanaRoot(), 'examples');
  const spec = await readFile(
    path.join(
      examples,
      readdirSync(examples).find(f => f.endsWith('.json')),
    ),
    'utf8',
  );
  await writeFile(path.join(legacy, 'loot.json'), spec);
  const h = run(['loot', 'handover', '--keypair', 'none.json', '--to', 'other.json'], { cwd: legacy });
  assert.equal(h.status, 1);
  assert.doesNotMatch(h.stderr, /xsolana\.json does not exist/, 'loot.json is the file it reads');
  assert.doesNotMatch(h.stderr, /^xsolana: /m, "a refusal is xcore's");
  const main = path.join(tmp.dir, 'mainshop');
  await mkdir(main);
  await writeFile(path.join(main, 'xsolana.json'), JSON.stringify({ ...JSON.parse(spec), network: 'mainnet' }));
  const v = run(['loot', 'version'], { cwd: main, env: { XSOLANA_CLUSTER: '' } });
  assert.equal(v.status, 0, v.stderr);
  assert.match(v.stdout, /mainnet/);
  assert.doesNotMatch(v.stdout, /devnet/);
  assert.match(run(['loot', 'version'], { cwd: legacy, env: { XSOLANA_CLUSTER: '' } }).stdout, /devnet/);
});
