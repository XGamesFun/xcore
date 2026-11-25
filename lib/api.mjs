// @xgamesfun/xcore as a library: the few calls a developer's own script or test can use, the same ones the commands
// run. Everything else in lib/ is internal and may change in any release. Types: ../types/index.d.ts. docs/API.md
// documents them.
import { adopt as adoptFolder } from './publish/adopt/run.mjs';
import { pageVerify } from './check.mjs';
import { checkSummary, preflight, publishStatus as statusOf } from './publish/index.mjs';
import { PLAN_LIMITS } from './server/contract.mjs';

export { PLAN_LIMITS };

/** `xcore adopt`: write the folder's record (gamesfun.json → page) and list what does not fit the hosting. */
export const adopt = (dir, options = {}) => adoptFolder(dir, options);

/** `xcore check`: the page check in Chrome, as xgames.fun hosts the game. */
export const check = (dir, options = {}) => pageVerify(dir, options);

/** `xcore publish --check`: the offline part of a publish (files, secrets, backend origins, server bundle). */
export const publishCheck = async (dir, options = {}) => checkSummary(await preflight(dir, options));

/** `xcore publish --status`: the sign-in, and where the folder's game is published. */
export const publishStatus = (dir, options = {}) => statusOf(dir, options);
