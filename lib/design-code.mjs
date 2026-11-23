// `xcore review`'s design ↔ code pass: what the economy spec says the game's server does off chain, against what the
// server's code does. The economy kit (@xgamesfun/solana) follows value only through the spec, so a conversion that
// lives in server code (a code that multiplies earnings, a stake that counts as an entry, a prize bought with farm
// yield) hides every loop through it, and a per-person limit the server keeps leaves the kit computing with the
// chain's caps, which only bound a leaked voucher key. Two declarations close the gap:
//   offchain      `offchain: [{key, name, takes, gives, rate}]` in xsolana.json: what the server turns what players
//                 hold or did into
//   serverLimit   a voucher grant's server bound (SERVER_LIMIT below): what the server signs at most for one identity
//                 per window
// Read in both directions, one finding code each:
//   design-unbuilt     a declaration with no code in server/ that appears to do it (medium)
//   code-undeclared    a conversion in server/ the spec doesn't declare (medium; with a drafted declaration)
//   bound-undeclared   a voucher grant whose bound lives on its server, with no serverLimit (low; and a question)
// Then the drafts are added to a temporary copy of the spec (never the real one; only fields the installed kit's schema
// takes) and its check is run with and without them: what appears only with the drafts is what the server was hiding.
// The reading is by signals, never one rule per game, and says "appears to" where the code alone doesn't settle it.
// Each part is a module of ./design-code/; this file re-exports what the pass has always exported.
export { designOf, SERVER_LIMIT } from './design-code/design.mjs';
export { conversionsIn } from './design-code/conversions.mjs';
export { boundsIn } from './design-code/bounds.mjs';
export { designCode } from './design-code/compare.mjs';
export { draftsChecked, kitTakes } from './design-code/drafts.mjs';
export { designCodeLine, designCodeMarkdown } from './design-code/record.mjs';
