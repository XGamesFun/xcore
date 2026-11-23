// `xcore adopt <folder>`: bring a web game made anywhere (this package's README). It reads the folder's
// shape (plain static files, or a project whose build makes them: Vite, Next.js static export, Astro, SvelteKit's static
// adapter, Nuxt generate, Create React App, Parcel, Gatsby, or any `build` script), builds it, writes its record
// (gamesfun.json → page: lib/publish/page.mjs) and reports everything that does not fit xgames.fun's hosting
// (lib/publish/hosting.mjs), each with its fix:
//
//   refused   it cannot be hosted as it is: no static index.html (server-side rendering, a Node server as the
//             frontend), a build that fails; no record is written
//   fix       it would break or be refused once published: publish's own refusals (secrets, .env files, links,
//             backend.json), files over the limits, paths from the root, scripts, styles, fonts or frames from
//             other sites, files under the host's own paths
//   warn      worth a look: addresses the code names that backend.json does not, a service worker, the camera or
//             location, files served without a type, hidden files that do not go up
//
// The check after it is `xcore check` (../check.mjs: the page in Chrome, with the host's page policy).
// Each part is a module of ./adopt/; `xcore loot add`'s addLoot is ../loot-add.mjs. This file re-exports what it has
// always exported.
export { detectShape, packageManager, packagesInstalled } from './adopt/shape.mjs';
export { GODOT_EXCLUDE, godotWebPreset } from './adopt/engines.mjs';
export { scanPage, useCustom } from './adopt/page-scan.mjs';
export { adopt } from './adopt/run.mjs';
export { adoptNext, reportLines } from './adopt/report.mjs';
export { addLoot, ENGINE_OVERLAY } from '../loot-add.mjs';
