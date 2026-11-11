// `xcore coin`: a coin that trades for a published game (../lib/coin.mjs): where it stands, launching one with a key
// file, and giving up a launch that was never sent.
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame, named } from '../lib/games.mjs';
import { ABOUT_SOL, coinStatus, dropLaunch, explorerOf, launchCoin, planText, VENUES } from '../lib/coin.mjs';
import { CMD } from '../lib/command.mjs';

const usage = `Usage: xcore coin [game] [--json]
       xcore coin launch [game] --name <name> --ticker <TICKER> --picture <file> --keypair <keyfile>
                         [--venue meteora|pumpfun] [--pair <SYMBOL>] [--description <text>] [--yes <code>] [--json]
       xcore coin drop [game] [--json]

A coin that trades, for a game published on xgames.fun (Solana devnet only for now). loot, the program of a game's
economy, runs no market: a coin people can buy and sell is launched on a venue, and the economy then names it.
  (no command)   where the game's coin stands, and what a launch can choose from: the venues, what each pairs a coin
                 with, and the pictures among the published game's files
  launch         what launching would do, signed by a key file on this machine (${CMD} loot keygen <file> makes one;
                 send it about ${ABOUT_SOL} devnet SOL). It sends nothing until it is run again with the code it prints
                 (--yes <code>), once the person whose game it is has read that and said yes. xgames.fun's launchpad
                 builds the launch; before the key signs, each transaction is held to being a launch for this one new
                 coin: no buy, no move of a token the key holds, nothing of the game's economy
      --name         the coin's name (at most 32 bytes)        --ticker   its ticker (2 to 10 bytes, no spaces)
      --picture      a picture among the published game's files (the path ${CMD} coin lists)
      --venue        meteora (the default) or pumpfun          --pair     what it trades against (the default: SOL)
      --keypair      the key file that signs and pays: the coin's creator fees belong to its address for good
  drop           gives up a launch that was begun and never sent
A game has one coin, and its name, ticker and picture stay as launched. The same from a browser wallet: the game's
console (xgames.fun/console), Token tab. A coin made elsewhere is named in the economy with ${CMD} loot token <mint>.`;

const venueName = v => VENUES[v]?.name ?? v;

/** Where the game's coin stands, in words. */
function statusText(game, s) {
  const own = s.own ?? null,
    launch = s.launch ?? {};
  if (own?.kind === 'launched')
    return [
      `${game}'s coin is live on Solana devnet: $${own.symbol} (${own.name}), on ${venueName(own.venue)}${own.pair ? `, paired with ${own.pair}` : ''}.`,
      `  mint      ${own.mint}`,
      `  explorer  ${explorerOf(own.mint)}`,
      `To use it in the game's economy, name it in xsolana.json's "tokens": ${CMD} loot token ${own.mint} prints its entry.`,
      'A devnet coin trades nothing of value.',
    ].join('\n');
  if (own?.kind === 'linked')
    return `${game} uses $${own.symbol}, a token made elsewhere (${own.mint}). A game has one coin: stop using it (the game's console, Token tab) to launch one of its own.`;
  if (launch.sent)
    return `${game}'s launch of $${own?.symbol ?? 'its coin'} was sent to Solana and a check on chain has not passed yet. Ask again in a moment: ${CMD} coin`;
  if (launch.partly)
    return `${game}'s coin $${own?.symbol ?? ''} exists on Solana and its launch wants one more transaction. Run the launch again with the same choices and key to send it.`;
  const lines = [];
  if (launch.started)
    lines.push(
      `${game} has a launch of $${own?.symbol ?? 'a coin'} that was begun and never sent. Launch again (it is built anew), or give it up: ${CMD} coin drop`,
    );
  else lines.push(`${game} has no coin yet.`);
  if (!launch.on) {
    lines.push(launch.why ?? s.why ?? 'Launching a coin is not on for this XGames.fun yet.');
    return lines.join('\n');
  }
  for (const v of s.venues ?? [])
    lines.push(`  ${v.venue.padEnd(8)} ${v.says}  Pairs: ${v.pairs.map(p => p.symbol).join(', ')}`);
  if (!(s.venues ?? []).length) lines.push('  The launchpad is not offering a venue right now.');
  const pictures = (s.pictures ?? []).map(p => p.path);
  lines.push(
    pictures.length
      ? `  pictures  ${pictures.slice(0, 12).join(', ')}${pictures.length > 12 || s.morePictures ? ', …' : ''}`
      : '  pictures  none among the published files (a coin needs a PNG, JPEG or WebP there)',
    `Launch one: ${CMD} coin launch --name <name> --ticker <TICKER> --picture <file> --keypair <keyfile>`,
  );
  return lines.join('\n');
}

/** The launch command as the person ran it, for the line that says how to send it (never the code of an older run). */
function sameCommand(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--yes') {
      i++;
      continue;
    }
    if (args[i].startsWith('--yes=') || args[i] === '--json') continue;
    out.push(/[^\w@%+=:,./~-]/.test(args[i]) ? `'${args[i].replaceAll("'", `'\\''`)}'` : args[i]);
  }
  return `${CMD} coin ${out.join(' ')}`;
}

export default {
  name: 'coin',
  summary: 'a coin that trades for a published game: where it stands, and launching one with a key file',
  usage,
  run: args =>
    guard(async () => {
      const { values, positionals } = parse(
        args,
        {
          name: { type: 'string' },
          ticker: { type: 'string' },
          symbol: { type: 'string' },
          description: { type: 'string' },
          picture: { type: 'string' },
          venue: { type: 'string' },
          pair: { type: 'string' },
          keypair: { type: 'string' },
          yes: { type: 'string' },
        },
        usage,
      );
      const verbs = ['launch', 'drop', 'status'];
      const verb = verbs.includes(positionals[0]) ? positionals[0] : 'status';
      const rest = verbs.includes(positionals[0]) ? positionals.slice(1) : positionals;
      if (rest.length > 1) throw new UsageError(usage);
      const symbol = values.ticker ?? values.symbol;
      if (verb === 'launch')
        for (const [flag, value] of [
          ['--name', values.name],
          ['--ticker', symbol],
          ['--picture', values.picture],
          ['--keypair', values.keypair],
        ])
          if (!value?.trim()) throw new UsageError(`launch needs ${flag}\n\n${usage}`);
      const dir = await resolveGame(rest[0]);
      const game = named(dir);
      const out = values.json ? printJson : null;

      if (verb === 'status') {
        const s = await coinStatus(dir, { refresh: true });
        if (out) out(s);
        else console.log(statusText(game, s));
        return 0;
      }
      if (verb === 'drop') {
        const s = await dropLaunch(dir);
        if (out) out(s);
        else
          console.log(`Gave up ${game}'s launch: nothing of it was sent. The game has no coin, and can begin another.`);
        return 0;
      }

      const r = await launchCoin(
        dir,
        {
          name: values.name.trim(),
          symbol: symbol.trim(),
          description: values.description?.trim() || '',
          picture: values.picture.trim(),
          venue: values.venue?.trim().toLowerCase() || undefined,
          pair: values.pair?.trim() || undefined,
        },
        { keyFile: values.keypair, yes: values.yes ?? null },
      );
      if (r.planned) {
        const command = sameCommand(args);
        if (out)
          out({
            ok: true,
            planned: true,
            code: r.code,
            plan: { ...r.plan, balance: r.plan.balance?.toString() ?? null },
            next: `${command} --yes ${r.code}`,
          });
        else console.log(planText(r.plan, { game, keyFile: values.keypair, code: r.code, command }));
        return 0;
      }
      if (out) out(r);
      else if (r.launched)
        console.log(
          [
            `$${r.coin.symbol} (${r.coin.name}) is live on Solana devnet, on ${venueName(r.coin.venue)}${r.coin.pair ? `, paired with ${r.coin.pair}` : ''}.`,
            `  mint      ${r.mint}`,
            `  explorer  ${r.explorer}`,
            `To use it in the game's economy, name it in xsolana.json's "tokens": ${CMD} loot token ${r.mint} prints its entry.`,
            'Its creator fees belong to the key file’s address: keep the file, and a copy of it somewhere safe.',
          ].join('\n'),
        );
      else
        console.log(
          r.partly
            ? `The coin exists on Solana (${r.mint}) and its launch wants one more transaction. Run the launch again with the same choices and key to send it.`
            : `The launch was sent to Solana and a check on chain has not passed yet (${r.mint}). Ask again in a moment: ${CMD} coin`,
        );
      return 0;
    }, args),
};
