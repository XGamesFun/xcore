# Using xcore from code

Most people use the `xcore` command. For a script or a test of your own, the package also has a small library entry
point with the same checks the commands run. TypeScript types ship with it (`types/index.d.ts`).

```js
import { adopt, check, publishCheck, publishStatus, PLAN_LIMITS } from '@xgamesfun/xcore';

const report = await adopt('./my-game');
if (!report.ok) console.log(report.refused, report.fix);

const record = await check('./my-game', { noBuild: true });
console.log(record.pass, record.outDir);
```

Everything else in the package is internal. It is not reachable by an import, and it can change in any release.
Publishing, the database, secrets and the economy are done with the command line.

## Calls

| Call                           | Does what the command does        | Returns                                                                                                        |
| ------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `adopt(dir, options?)`         | `xcore adopt`                     | the report: `ok`, `refused`, `fix`, `warn` (each `{what, fix}`), `page`, `shape`, `files`, `bytes`             |
| `check(dir, options?)`         | `xcore check`                     | the record: `pass`, `checks` (`{n, name, ok, detail}`), `notes`, `outDir` (with `record.json` and screenshots) |
| `publishCheck(dir, options?)`  | `xcore publish --check`           | `ok`, `files`, `bytes`, `skipped`, `problems`, `secrets`, `backend`, `cardWarnings`, `server`                  |
| `publishStatus(dir, options?)` | `xcore publish --status`          | `signedIn`, `signIn.state`, `link` (`never`, `started`, `public`, `draft`, `draft-over-public`), `known`       |
| `PLAN_LIMITS`                  | the limits `xcore plan` describes | `{free, creator, scale}`, each with `cpuMs`, `saves`, `scores`, `reads` and `files` (sizes in bytes)           |

- `adopt` options: `build`, `out`, `static`, `noBuild`, `onLine` (as the command's flags).
- `check` options: `noBuild`, `out`, `port`, `log`. It needs Chrome, Edge or Chromium, or downloads Playwright's
  Chromium once.
- `publishCheck` and `publishStatus` take `origin` (default: `GAMESFUN_STUDIO`, else `https://xgames.fun`).
  `publishCheck` sends nothing.

The calls write what the commands write: `adopt` writes `gamesfun.json`, and `check` writes its record under
`evidence/`.
