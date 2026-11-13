// `xcore review`'s design ↔ code pass (lib/design-code.mjs): small games written here, each a spec and a server/. A
// code lookup that multiplies a claim, undeclared and then declared; a declaration no code does; a bounds grant whose
// check keeps a cap an hour; and a guild whose farm yield buys a boost on the prize, where the drafted declaration makes
// the economy check see the loop. The kit's own wording is never pinned: its findings are read by their structure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { reviewGame } from '../lib/review.mjs';
import { kitTakes, SERVER_LIMIT } from '../lib/design-code.mjs';
import { run, tempDir } from './helpers.mjs';

// the installed @xgamesfun/solana, whatever the shell running the tests names
const INSTALLED = { ...process.env, GAMESFUN_SOLANA: '' };
const KEY = '2LW2C9sZbxoizKZ9eXYrsiF8xLP8GajJpnjAyNYKTrh1';

/** A game folder: index.html, xsolana.json and server/<file> for each of `server`. → its folder */
async function game(tmp, name, spec, server) {
  const dir = path.join(tmp.dir, name);
  await mkdir(path.join(dir, 'server'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>game</title><script src="game.js"></script>\n');
  await writeFile(path.join(dir, 'game.js'), 'console.log("play");\n');
  await writeFile(path.join(dir, 'xsolana.json'), JSON.stringify(spec, null, 2));
  for (const [f, text] of Object.entries(server)) await writeFile(path.join(dir, 'server', f), text);
  return dir;
}
const review = (dir, env = INSTALLED) => reviewGame(dir, { env });
const design = r => r.findings.filter(f => f.source === 'design');
const of = (r, id) => design(r).filter(f => f.id === id);
/** The line `needle` is on in `text`, 1-based. */
const lineOf = (text, needle) => text.split('\n').findIndex(l => l.includes(needle)) + 1;

const raid = (extra = {}) => ({
  key: 'raid-prize',
  name: 'Raid prize',
  prize: { gives: 'tokens', amount: 100, from: 'mint', currency: 'gold' },
  vouchers: [KEY],
  limits: { perPerson: 1, perDay: 50 },
  trust: 'decides',
  ...extra,
});
const spec = (more = {}) => ({
  version: 2,
  network: 'devnet',
  name: 'Card Raid',
  currency: 'sol',
  tokens: [
    { key: 'sol', source: 'sol' },
    { key: 'gold', source: 'game', name: 'Raid Gold', symbol: 'GOLD', decimals: 0 },
  ],
  items: [{ key: 'card', name: 'Raid Card', id: 1 }],
  grants: [raid()],
  ...more,
});

// (a) a claim multiplied by a boost from a code lookup
const CARD_PAY = `// The raid's pay: the server ran the raid (a room), and a raid card's code boosts what it pays.
export const PAY = {
  async check({ body, player, env }) {
    const raid = await env.RAIDS.get(player.sub);
    if (!raid?.won) return { why: 'No raid won.' };
    const card = await env.DB.prepare('select boost from cards where code = ?').bind(body.code).first();
    const boost = card ? card.boost : 1;
    return { grant: 'raid-prize', round: raid.id, amount: 100 * boost };
  },
};

export const VOUCHERS = { payOnly: 'x', perMinute: 20 };
`;

test('(a) a claim multiplied by a boost a code lookup gives, with no offchain: code-undeclared at its line, with a draft', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp, 'card-raid', spec(), { 'vouchers.js': CARD_PAY });
  const r = await review(dir);
  const [f, ...rest] = of(r, 'code-undeclared');
  assert.deepEqual(rest, []);
  const line = lineOf(CARD_PAY, 'amount: 100 * boost');
  assert.equal(f.where, `server/vouchers.js:${line}`);
  assert.equal(f.severity, 'medium');
  assert.equal(f.route, 'api/vouchers/pay');
  assert.match(f.message, /appears to turn a Raid Card into more GOLD/);
  assert.match(f.message, /a code lookup at server\/vouchers\.js:6/);
  assert.equal(f.draft.takes, 'item:card');
  assert.equal(f.draft.gives, 'gold');
  assert.match(f.draft.key, /^[a-z][a-z0-9-]{0,31}$/);
  const [c] = r.designCode.conversions;
  assert.deepEqual(
    { where: c.where, line: c.line, effect: c.effect, by: c.by, changes: c.changes, grants: c.grants },
    { where: 'server/vouchers.js', line, effect: 'multiplier', by: 'boost', changes: 'payout', grants: ['raid-prize'] },
  );
  // the tell line, and the draft in review.md and review.json
  assert.ok(
    r.tell.some(
      x =>
        x.from === 'design' &&
        x.text ===
          `server/vouchers.js:${line} turns a Raid Card into more GOLD; the economy model doesn't see it until it's declared.`,
    ),
    JSON.stringify(r.tell),
  );
  const md = await readFile(path.join(r.outDir, 'review.md'), 'utf8');
  assert.match(md, /## Design and code/);
  assert.match(md, /\*\*Drafted from code: confirm each with the person before adding\.\*\*/);
  const json = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(md.slice(md.indexOf('## Design and code')))[1]);
  assert.deepEqual(json.offchain, [f.draft]);
  const saved = JSON.parse(await readFile(path.join(r.outDir, 'review.json'), 'utf8'));
  assert.deepEqual(saved.designCode.drafts.offchain[0].declaration, f.draft);
  // the real spec is never touched
  assert.equal(JSON.parse(await readFile(path.join(dir, 'xsolana.json'), 'utf8')).offchain, undefined);
  // the command's one line
  const cli = run(['review', dir], { env: { GAMESFUN_SOLANA: '' } });
  assert.match(
    cli.stdout,
    /^design and code: 1 conversion in server\/ \(1 undeclared\), 0 declared offchain \(0 unbuilt\)/m,
  );
});

test('(b) the same game with a matching offchain declaration: no design finding', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const declared = spec({
    offchain: [{ key: 'card-boost', name: 'Raid card boost', takes: 'item:card', gives: 'gold', rate: 50 }],
  });
  const dir = await game(tmp, 'card-raid', declared, { 'vouchers.js': CARD_PAY });
  const r = await review(dir);
  // (its check reads state the server keeps, so its bound is asked about: bound-undeclared, as in (d))
  const offchain = r => design(r).filter(f => f.id !== 'bound-undeclared');
  assert.deepEqual(offchain(r), []);
  assert.equal(r.designCode.conversions.length, 1, 'the conversion is still read');
  assert.deepEqual(r.designCode.drafts.offchain, []);
  // declared by what it takes and gives, not by its name: still matched
  const other = spec({ offchain: [{ key: 'forge', takes: 'item:card', gives: 'gold' }] });
  const dir2 = await game(tmp, 'card-raid-2', other, { 'vouchers.js': CARD_PAY });
  assert.deepEqual(offchain(await review(dir2)), []);
});

test('(c) a declared offchain entry no server code does: design-unbuilt', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const plain = CARD_PAY.replace(/\n {4}const card[^\n]*\n[^\n]*\n/, '\n').replace('100 * boost', "'grant'");
  const declared = spec({ offchain: [{ key: 'card-boost', takes: 'item:card', gives: 'gold', rate: 50 }] });
  const dir = await game(tmp, 'card-raid', declared, { 'vouchers.js': plain });
  const r = await review(dir);
  const [f, ...rest] = of(r, 'design-unbuilt');
  assert.deepEqual(rest, []);
  assert.equal(f.route, 'offchain:card-boost');
  assert.equal(f.severity, 'medium');
  assert.match(f.message, /no code in server\/ appears to do it/);
  assert.deepEqual(r.designCode.unbuilt, [{ kind: 'offchain', key: 'card-boost' }]);
  assert.deepEqual(of(r, 'code-undeclared'), []);
});

// (d) a bounds grant whose check keeps a cap an hour
const HOURLY_PAY = `// The raid's pay: the page plays and reports; the server times the run and caps what one player takes an hour.
const PER_HOUR = 300; // GOLD one player may take in an hour

export const PAY = {
  async check({ body, player, env }) {
    const run = await env.RUNS.get(\`\${player.sub}:\${body.runId}\`);
    if (!run || Date.now() - run.at < 60_000) return { why: 'Faster than the game allows.' };
    const taken = Number((await env.TAKEN.get(\`\${player.sub}:\${Math.floor(Date.now() / 3_600_000)}\`)) ?? 0);
    if (taken + 100 > PER_HOUR) return { why: 'That is all for this hour.' };
    return { grant: 'raid-prize', round: run.id, amount: 100 };
  },
};

export const VOUCHERS = { payOnly: 'x', perMinute: 20 };
`;

test('(d) a bounds grant whose check enforces a cap an hour, with no serverLimit: bound-undeclared and a question naming the constant', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp, 'hourly', spec({ grants: [raid({ trust: 'bounds' })] }), { 'vouchers.js': HOURLY_PAY });
  const r = await review(dir);
  const [f, ...rest] = of(r, 'bound-undeclared');
  assert.deepEqual(rest, []);
  assert.equal(f.severity, 'low');
  assert.equal(f.route, 'grant:raid-prize');
  const line = lineOf(HOURLY_PAY, 'taken + 100 > PER_HOUR');
  assert.match(f.message, new RegExp(`appears to cap it at 300 an hour .*server/vouchers\\.js:${line}`));
  assert.deepEqual(r.designCode.bounds, [
    {
      grant: 'raid-prize',
      where: 'server/vouchers.js',
      line,
      code: "if (taken + 100 > PER_HOUR) return { why: 'That is all for this hour.' };",
      name: 'PER_HOUR',
      value: 300,
      every: '1h',
      per: 'person',
      unit: 'amount',
      amount: 300,
    },
  ]);
  assert.ok(
    r.ask.some(
      x =>
        x.from === 'design' &&
        x.text ===
          `How much does your server let one person take from “Raid prize” per hour? (it appears to be 300 (PER_HOUR) in server/vouchers.js:${line})`,
    ),
    JSON.stringify(r.ask),
  );
  // the draft, in the agreed shape
  assert.deepEqual(r.designCode.drafts[SERVER_LIMIT.field], [
    {
      grant: 'raid-prize',
      from: `server/vouchers.js:${line}`,
      [SERVER_LIMIT.field]: { per: 'person', amount: 300, every: '1h' },
    },
  ]);
  // no conversion here, so no offchain draft
  assert.deepEqual(r.designCode.conversions, []);
  // declared on the grant: nothing asked (the installed kit may refuse the field: the economy's own findings aside)
  await writeFile(
    path.join(dir, 'xsolana.json'),
    JSON.stringify(
      spec({ grants: [raid({ trust: 'bounds', [SERVER_LIMIT.field]: { per: 'person', amount: 300, every: '1h' } })] }),
    ),
  );
  const d = await review(dir);
  assert.deepEqual(design(d), []);
  // declared, with no cap in the code: design-unbuilt
  await writeFile(path.join(dir, 'server', 'vouchers.js'), HOURLY_PAY.replace(/\n {4}if \(taken[^\n]*/, ''));
  assert.deepEqual(
    design(await review(dir)).map(x => `${x.id} ${x.route}`),
    ['design-unbuilt grant:raid-prize'],
  );
});

// (e) a guild: staked GOLD earns EMBER, and EMBER buys a forge boost on the raid prize, on the server
const guild = (more = {}) => ({
  version: 2,
  network: 'devnet',
  name: 'Ember Guild',
  currency: 'sol',
  tokens: [
    { key: 'sol', source: 'sol' },
    { key: 'gold', source: 'game', name: 'Guild Gold', symbol: 'GOLD', decimals: 0 },
    { key: 'ember', source: 'game', name: 'Ember', symbol: 'EMBER', decimals: 0 },
  ],
  farms: [
    {
      key: 'hall',
      name: 'The guild hall',
      stakes: 'gold',
      rewards: 'ember',
      runs: '30d',
      rate: { perDay: 1, minted: true },
    },
  ],
  grants: [raid({ trust: 'bounds' })],
  ...more,
});
const FORGE = `// The forge: embers a player holds (the guild hall's yield) buy a boost on the raid prize.
const EMBER_MINT = 'Ember1111111111111111111111111111111111111';

export async function forgeBoost(env, wallet) {
  const embers = await emberBalance(env, wallet);
  return embers >= 50 ? 2 : 1;
}

async function emberBalance(env, wallet) {
  const r = await env.RPC.getTokenAccountsByOwner(wallet, { mint: EMBER_MINT });
  return r.value.reduce((n, a) => n + Number(a.amount), 0);
}
`;
const GUILD_PAY = `import { forgeBoost } from './forge.js';

const PER_HOUR = 300; // GOLD one player may take in an hour

export const PAY = {
  async check({ body, player, env }) {
    const run = await env.RUNS.get(\`\${player.sub}:\${body.runId}\`);
    if (!run || Date.now() - run.at < 60_000) return { why: 'Faster than the game allows.' };
    const taken = Number((await env.TAKEN.get(\`\${player.sub}:\${Math.floor(Date.now() / 3_600_000)}\`)) ?? 0);
    if (taken + 100 > PER_HOUR) return { why: 'That is all for this hour.' };
    const boost = await forgeBoost(env, player.wallet);
    return { grant: 'raid-prize', round: run.id, amount: 100 * boost };
  },
};

export const VOUCHERS = { payOnly: 'x', perMinute: 20 };
`;

/** The kit's loop findings: W-VALUE warnings that follow a loop through a drafted offchain route (named as it names it). */
const loopsThrough = (warnings, draft) =>
  warnings.filter(w => w.code === 'W-VALUE' && w.message.includes(`“${draft.name ?? draft.key}”`));

test('(e) a guild whose farm yield buys a boost on the prize: drafted, the economy check reports a loop it did not before', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const dir = await game(tmp, 'ember-guild', guild(), { 'vouchers.js': GUILD_PAY, 'forge.js': FORGE });
  const r = await review(dir);
  const [f] = of(r, 'code-undeclared');
  assert.equal(f.where, `server/vouchers.js:${lineOf(GUILD_PAY, 'amount: 100 * boost')}`);
  assert.equal(f.draft.takes, 'ember', 'read through forgeBoost, in server/forge.js');
  assert.equal(f.draft.gives, 'gold', "the raid prize's token");
  // (one level of the game's own functions: forgeBoost, which PAY.check calls, and not emberBalance under it)
  assert.deepEqual(r.designCode.conversions[0].reads, [
    { kind: 'balance', what: 'a balance', where: 'server/forge.js', line: lineOf(FORGE, 'await emberBalance(') },
  ]);
  assert.deepEqual(of(r, 'bound-undeclared').length, 1);
  const w = r.designCode.withDrafts;
  if (!kitTakes(INSTALLED).offchain) {
    assert.equal(w.ran, false, 'a kit without offchain runs nothing');
    return;
  }
  assert.equal(w.ran, true, JSON.stringify(w));
  assert.deepEqual(w.added.offchain, [f.draft.key]);
  // the payoff: a loop through the server's conversion, found only once it is declared
  const loops = loopsThrough(w.only.warnings, f.draft);
  assert.equal(loops.length, 1, JSON.stringify(w.only));
  assert.ok(['high', 'medium'].includes(loops[0].severity));
  assert.deepEqual(w.refused, []);
  // the kit's question about undeclared off-chain work is gone with it
  assert.ok(
    w.gone.warnings.some(x => x.where === 'economy.offchain'),
    JSON.stringify(w.gone),
  );
  // with the kit as installed, serverLimit is left out of the check (until the kit takes it), and said so
  if (!kitTakes(INSTALLED).serverLimit)
    assert.ok(w.left.some(l => l.draft === 'grant:raid-prize' && /takes no "serverLimit"/.test(l.why)));
  const md = await readFile(path.join(r.outDir, 'review.md'), 'utf8');
  const section = md.slice(md.indexOf('## Design and code'), md.indexOf('## Live'));
  assert.match(section, /Only with the drafts, the economy check now reports:\n\n- W-VALUE \((high|medium)\): /);
  t.diagnostic(section);
});

// A kit that reads serverLimit (@xgamesfun/solana after 0.28.12): the installed one when it does, else a checkout named
// by GAMESFUN_SOLANA_NEXT (e.g. the kit at commit 30c2fb3).
const NEXT = (() => {
  if (kitTakes(INSTALLED).serverLimit) return INSTALLED;
  const next = process.env.GAMESFUN_SOLANA_NEXT;
  return next &&
    existsSync(path.join(next, 'package.json')) &&
    kitTakes({ ...process.env, GAMESFUN_SOLANA: next }).serverLimit
    ? { ...process.env, GAMESFUN_SOLANA: next }
    : null;
})();

test(
  '(e, serverLimit) with a kit that reads serverLimit, the drafted bound brings its "server signs at most" line and drops its question',
  {
    skip: NEXT
      ? false
      : 'no @xgamesfun/solana here reads serverLimit: set GAMESFUN_SOLANA_NEXT to a kit checkout that does (30c2fb3 or later)',
  },
  async t => {
    const tmp = await tempDir();
    t.after(tmp.cleanup);
    const dir = await game(tmp, 'ember-guild', guild(), { 'vouchers.js': GUILD_PAY, 'forge.js': FORGE });
    const r = await review(dir, NEXT);
    const w = r.designCode.withDrafts;
    assert.equal(w.ran, true, JSON.stringify(w));
    assert.deepEqual(w.added[SERVER_LIMIT.field], ['raid-prize']);
    assert.deepEqual(w.refused, []);
    // the kit now reasons from the server's own bound: a tell line that names it, and its question about it gone
    assert.ok(
      w.only.tell.some(x => x.includes('“Raid prize”') && x.includes('300')),
      JSON.stringify(w.only.tell),
    );
    assert.ok(
      w.gone.warnings.some(
        x =>
          x.code === 'W-ASSUMPTION' &&
          x.where === 'economy.grants.raid-prize' &&
          x.message.includes(SERVER_LIMIT.field),
      ),
      JSON.stringify(w.gone.warnings),
    );
    assert.equal(loopsThrough(w.only.warnings, of(r, 'code-undeclared')[0].draft).length, 1);
    const md = await readFile(path.join(r.outDir, 'review.md'), 'utf8');
    t.diagnostic(md.slice(md.indexOf('### The economy check, with the drafts'), md.indexOf('## Live')));
  },
);

// (f) two grants in one PAY.check, each in its own branch: a cap a function of the game's own keeps, called from one
// branch, bounds that branch's grant only
const TWO_LEDGER = `// The popping reward's ledger: one person's claims a day.
const PER_DAY = 3; // claims one person may make a day

export async function plan(env, person) {
  const today = Number((await env.CLAIMS.get(\`\${person}:\${new Date().toISOString().slice(0, 10)}\`)) ?? 0);
  if (today >= PER_DAY) return { ok: false };
  return { ok: true, round: \`pops:\${person}:\${today + 1}\` };
}
`;
const TWO_PAY = `// Two grants: a free entry for signing in, and the popping reward, which the ledger caps a day.
import { plan } from './ledger.js';

export const PAY = {
  async check({ body, player, env }) {
    if (body?.kind === 'free') {
      return { grant: 'free-entry', round: \`free:\${player.sub}\`, amount: 'grant' };
    }
    if (body?.kind === 'pops') {
      const p = await plan(env, player.sub);
      if (!p.ok) return { why: 'That is all for today.' };
      return { grant: 'raid-prize', round: p.round, amount: 100 };
    }
    return { why: 'Ask for "free" or "pops".' };
  },
};

export const VOUCHERS = { payOnly: 'x', perMinute: 20 };
`;

test('(f) two grants in one check: a cap called from one branch is filed under that branch’s grant only', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const free = {
    key: 'free-entry',
    name: 'Free entry',
    prize: { gives: 'tokens', amount: 1, from: 'mint', currency: 'gold' },
    vouchers: [KEY],
    limits: { perPerson: 1, perDay: 50 },
    trust: 'decides',
  };
  const dir = await game(tmp, 'two', spec({ grants: [raid({ trust: 'bounds' }), free] }), { 'vouchers.js': TWO_PAY, 'ledger.js': TWO_LEDGER });
  const r = await review(dir);
  const line = lineOf(TWO_LEDGER, 'today >= PER_DAY');
  assert.deepEqual(
    r.designCode.bounds.map(b => `${b.grant} ${b.where}:${b.line}`),
    [`raid-prize server/ledger.js:${line}`],
  );
});

// (g) the cap in a function of vouchers.js outside PAY that PAY calls, named "a day": read, and filed under the grant
// the code after the call pays (not the one an earlier branch returned)
const SLOT_PAY = `// Two grants; the popping reward's claims are held to so many a day by takeSlot, below PAY.
export const PAY = {
  async check({ body, player, env }) {
    if (body?.kind === 'free') return { grant: 'free-entry', round: \`free:\${player.sub}\`, amount: 'grant' };
    const wait = await takeSlot(env, player.sub);
    if (wait) return { why: wait };
    return { grant: 'raid-prize', round: \`raid:\${player.sub}:\${Date.now()}\`, amount: 100 };
  },
};

export const VOUCHERS = { payOnly: 'x', perMinute: 20 };

const CLAIMS_A_DAY = 3;

async function takeSlot(env, sub) {
  const day = new Date().toISOString().slice(0, 10);
  const today = Number((await env.CLAIMS.get(\`\${sub}:\${day}\`)) ?? 0);
  if (today >= CLAIMS_A_DAY) return 'That is all for today.';
  await env.CLAIMS.put(\`\${sub}:\${day}\`, String(today + 1));
  return null;
}
`;

test('(g) a cap a day in a vouchers.js function PAY calls: read, under the grant the code after the call pays', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const free = {
    key: 'free-entry',
    name: 'Free entry',
    prize: { gives: 'tokens', amount: 1, from: 'mint', currency: 'gold' },
    vouchers: [KEY],
    limits: { perPerson: 1, perDay: 50 },
    trust: 'decides',
  };
  const declared = { per: 'person', amount: 300, claims: 3, every: '1d' };
  const dir = await game(
    tmp,
    'slot',
    spec({ grants: [raid({ trust: 'bounds', [SERVER_LIMIT.field]: declared }), free] }),
    { 'vouchers.js': SLOT_PAY },
  );
  const r = await review(dir);
  const line = lineOf(SLOT_PAY, 'today >= CLAIMS_A_DAY');
  assert.deepEqual(
    r.designCode.bounds.map(b => `${b.grant} ${b.where}:${b.line} ${b.value} ${b.unit} ${b.every} ${b.per}`),
    [`raid-prize server/vouchers.js:${line} 3 claims 1d person`],
  );
  assert.deepEqual(of(r, 'design-unbuilt'), []);
});
