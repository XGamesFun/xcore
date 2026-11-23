// The record: the pass's one line for the command and its part of review.md.
import { DRAFTED, OFFCHAIN, SERVER_LIMIT } from './design.mjs';

/** One line for the command. */
export function designCodeLine(dc) {
  if (!dc) return 'design and code: no economy';
  const undeclared = dc.findings.filter(f => f.id === 'code-undeclared').length;
  const bounds = dc.findings.filter(f => f.id === 'bound-undeclared').length;
  const w = dc.withDrafts;
  const loops = w?.ran ? w.only.warnings.length : 0;
  return `design and code: ${dc.conversions.length} conversion${dc.conversions.length === 1 ? '' : 's'} in server/ (${undeclared} undeclared), ${dc.design.offchain.length} declared offchain (${dc.unbuilt.length} unbuilt), ${bounds} grant${bounds === 1 ? '' : 's'} with a server bound undeclared; ${w?.ran ? `with the drafts, the economy check reports ${loops} new finding${loops === 1 ? '' : 's'}` : `drafts not checked (${w?.why ?? 'nothing drafted'})`}`;
}

/** review.md's "Design and code" section. */
export function designCodeMarkdown(dc) {
  const lines = ['## Design and code', ''];
  if (!dc) return [...lines, 'This game has no economy: nothing to compare.', ''];
  const cell = v =>
    String(v ?? '')
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ');
  lines.push(
    'What the economy spec says the server does off chain ("offchain", and each voucher grant\'s "serverLimit"), against what server/ does. The economy check follows value only through the spec: a conversion or a bound that lives only in code is invisible to it.',
    '',
    `- Declared: ${dc.design.offchain.length ? dc.design.offchain.map(k => `offchain \`${k}\``).join(', ') : 'no offchain'}; ${dc.design.grants.filter(g => g[SERVER_LIMIT.field]).length} of ${dc.design.grants.length} voucher grants with a ${SERVER_LIMIT.field}.`,
    '',
    '### What the server converts',
    '',
  );
  if (!dc.conversions.length)
    lines.push('No multiplier, bonus or entry found that reads what a player holds or did.', '');
  else {
    lines.push(
      '| Where | What it reads | What it changes | Feeds | Route | Declared |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const c of dc.conversions) {
      const undeclared = dc.findings.some(f => f.id === 'code-undeclared' && f.where === `${c.where}:${c.line}`);
      lines.push(
        `| ${c.where}:${c.line} \`${cell(c.code)}\` | ${cell(c.reads.map(r => `${r.what} (${r.where}:${r.line})`).join(', '))}${c.takes ? `: ${c.takes}` : ''} | ${c.effect} \`${cell(c.by)}\`${c.factor ? ` ×${c.factor}` : ''} on ${c.changes}${c.gives ? ` (${c.gives})` : ''} | ${c.grants.map(k => `grant:${k}`).join(', ') || 'not read'} | ${c.route ? `\`${c.route}\`` : 'not read'} | ${undeclared ? 'no' : 'yes'} |`,
      );
    }
    lines.push('');
  }
  lines.push('### What the server bounds', '');
  if (!dc.bounds.length) lines.push('No cap a window found where a grant is paid.', '');
  else {
    lines.push('| Grant | Where | Cap | Window | Counts | Declared |', '| --- | --- | --- | --- | --- | --- |');
    for (const b of dc.bounds) {
      const declared = dc.design.grants.find(g => g.key === b.grant)?.[SERVER_LIMIT.field];
      lines.push(
        `| \`${b.grant}\` | ${b.where}:${b.line} \`${cell(b.code)}\` | ${b.value ?? 'not read'} (\`${cell(b.name)}\`, ${b.unit}) | ${b.every ?? 'not read'} | ${b.per} | ${declared ? `\`${cell(JSON.stringify(declared))}\`` : 'no'} |`,
      );
    }
    lines.push('');
  }
  const own = dc.findings;
  lines.push('### Findings', '');
  if (!own.length) lines.push('None: the design and the code agree, as far as this reading sees.', '');
  for (const f of own) lines.push(`- **${f.id}** (${f.severity}${f.route ? `, ${f.route}` : ''}): ${f.message}`);
  if (own.length) lines.push('');
  const { offchain, serverLimit } = dc.drafts;
  lines.push('### Suggested declarations', '');
  if (!offchain.length && !serverLimit.length) lines.push('Nothing to draft.', '');
  else {
    lines.push(
      `**${DRAFTED[0].toUpperCase()}${DRAFTED.slice(1)}.** Nothing here is in xsolana.json until you add it.`,
      '',
    );
    for (const d of offchain)
      lines.push(
        `- offchain \`${d.declaration.key}\`, from ${d.from}${d.ready ? '' : ' (fill in what the code does not say)'}; ${d.rate ? `its "rate", ${d.rate}, is the code's factor: confirm it with the person.` : 'no "rate" is read from the code: the kit counts 1 for each one taken until it is set.'}`,
      );
    for (const d of serverLimit) lines.push(`- grant \`${d.grant}\`'s ${SERVER_LIMIT.field}, from ${d.from}.`);
    lines.push('', '```json');
    const block = {
      ...(offchain.length ? { [OFFCHAIN]: offchain.map(d => d.declaration) } : {}),
      ...(serverLimit.length
        ? { grants: serverLimit.map(d => ({ key: d.grant, [SERVER_LIMIT.field]: d[SERVER_LIMIT.field] })) }
        : {}),
    };
    lines.push(JSON.stringify(block, null, 2), '```', '');
  }
  lines.push('### The economy check, with the drafts', '');
  const w = dc.withDrafts;
  if (!w?.ran) lines.push(`Not run: ${w?.why ?? 'nothing drafted'}.`, '');
  else {
    const added = [
      ...w.added.offchain.map(k => `offchain \`${k}\``),
      ...w.added[SERVER_LIMIT.field].map(k => `\`${k}\`'s ${SERVER_LIMIT.field}`),
    ];
    lines.push(
      `@xgamesfun/solana ${w.version}'s check, on a temporary copy of the spec with ${added.join(', ')} added (the spec itself untouched).`,
      '',
    );
    const only = [
      ...w.only.warnings.map(x => `${x.code}${x.severity ? ` (${x.severity})` : ''}: ${x.message}`),
      ...w.only.tell.map(t => `Tell: ${t}`),
      ...w.only.ask.map(t => `Ask: ${t}`),
    ];
    const gone = [...w.gone.warnings.map(x => `${x.code}: ${x.message}`), ...w.gone.ask.map(t => `Ask: ${t}`)];
    lines.push(
      only.length
        ? 'Only with the drafts, the economy check now reports:'
        : 'The drafts change nothing the economy check reports.',
      '',
    );
    for (const x of only) lines.push(`- ${x}`);
    if (only.length) lines.push('');
    if (gone.length) {
      lines.push('Gone with the drafts:', '');
      for (const x of gone) lines.push(`- ${x}`);
      lines.push('');
    }
    if (w.refused.length) {
      lines.push('The drafts do not check yet:', '');
      for (const r of w.refused) lines.push(`- ${r.code}: ${r.message}`);
      lines.push('');
    }
  }
  for (const l of w?.left ?? []) lines.push(`- Left out of the check: ${l.draft}: ${l.why}.`);
  if (w?.left?.length) lines.push('');
  return lines;
}
