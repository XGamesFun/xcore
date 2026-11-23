// `xcore review`: the security review of a brought game, as a cheater would read it. Three parts, and the trade-offs
// for the person:
//   the economy   @xgamesfun/solana's own review of the economy file (`xsolana review --json`): each route that pays,
//                 what it trusts, its ceiling, its findings, and `tradeoffs` (words for the person). An installed
//                 package without `review` is said in one line, and the rest of the review goes on.
//   the server    this package's own static reading of server/ and the page, as two analyses: the payout ledger (each
//                 route that pays: who signs, what decides it, who is paid, the identity its limits count, the trust
//                 declared and observed, and the ceiling one person can take; findings payout-input, payout-ceiling,
//                 payout-signer, payout-trust) and key custody (each key, every place its bytes are and who can read
//                 it; finding key-custody). Besides them: a server of the game's own that does work before (or
//                 without) checking a player's token, and every api/ route the code names (for the live part).
//   design and code  ./design-code.mjs: what the spec declares the server does off chain ("offchain", a grant's
//                 "serverLimit") against what server/ does (findings design-unbuilt, code-undeclared,
//                 bound-undeclared), with drafted declarations and the economy check run on a copy of the spec with them.
//   live          (--live) each route asked with no sign-in and with a forged one, GET and POST; api/vouchers/key
//                 against the grants' keys; the published economy file's `live` against this folder's. Read-only:
//                 nothing it sends could spend or sign (a route that pays gets an empty body).
//   for the person  two lists the agent passes on: "Ask the person" (questions whose answers change the design) and
//                 "Tell the person, as written" (final sentences): the economy check's own, one per paid route from the
//                 ledger, one per key out of place, and what stops when the plan caps the server.
// The record goes in <game>/evidence/review-N/ (review.md and review.json), as the page check's goes in verify-N/.
// docs/SERVER.md, "What a payout rests on", is the guide the findings point to.
// Each part is a module of ./review/; this file re-exports what the review has always exported.
export { economyHome, SEVERITIES, TRUST, voucherGrants } from './review/where.mjs';
export {
  apiRoutes,
  braced,
  definitions,
  paysFromRequest,
  readVouchers,
  withoutComments,
  withoutStrings,
  wordsOfName,
} from './review/code.mjs';
export { economyReview, NO_REVIEW } from './review/economy.mjs';
export { serverReview } from './review/server.mjs';
export { XCORE_PARTS } from './review/token.mjs';
export { failOpenPaidReads, payoutCeiling, payoutFindings, payoutLedger } from './review/ledger.mjs';
export { custodyFindings, keyCustody } from './review/custody.mjs';
export { liveReview } from './review/live.mjs';
export { LEVELS, tradeoffs } from './review/tradeoffs.mjs';
export { economyTold, folderPlan, planCap, serverWork, toldLines } from './review/told.mjs';
export { counts, custodyTable, ledgerTable, reviewGame, reviewMarkdown, toldMarkdown } from './review/record.mjs';
export { reviewNudge } from './review/nudge.mjs';
