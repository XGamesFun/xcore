# Contributing

Thanks for helping improve `xcore`. Bug reports, fixes and documentation improvements are all welcome.

## Before you start

- For anything larger than a small fix, open an issue first so we can agree on the approach.
- Security problems go through [SECURITY.md](SECURITY.md), never a public issue.

## Development setup

You need Node 24 or newer, and Chrome, Edge or Chromium for the page-check tests.

```bash
git clone https://github.com/XGamesFun/xcore.git
cd xcore
npm ci
npm run lint
npm test
node bin/xcore.mjs --help     # run the command from your checkout
```

The tests that run a game's server under workerd skip unless `GAMESFUN_SERVER_DEPS` names a folder with Miniflare.
Install it once (about 180 MB) with `export GAMESFUN_SERVER_DEPS="$(node scripts/server-tools.mjs ~/.cache/xcore-server-tools)"`.
`XCORE_TEST_ALL=1 npm test` fails on any skipped test, as CI on Linux does.
`node scripts/check-engines.mjs --godot <Godot 4 binary> --dotnet dotnet` checks the Godot and Unity glue the way CI's
engines job does.

Set `GAMESFUN_DEBUG=1` to print stack traces for errors.

Inside the checkout, `npx @xgamesfun/xcore@<version> …` finds this folder's package of the same name and fails with
`xcore: not found`. Run `node bin/xcore.mjs …` there, or run the published version from another folder.

## Project layout

| Path                    | What it holds                                                                                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bin/xcore.mjs`         | the command's entry point: loads `commands/` and passes other commands to the game-making kit when it is installed                                                                                                                                  |
| `commands/`             | one module per command (`adopt`, `check`, `dev`, `publish`, `add`, `backend`, `loot`, `review`, `secret`, …)                                                                                                                                        |
| `lib/`                  | the code the commands use; `lib/publish/` is the publish pipeline, `lib/server/` the `gf-server-v1` contract                                                                                                                                        |
| `lib/client/`           | templates copied into a game: `gamesfun.js` (and its generated copy `signin-v1.js`), the Godot and Unity glue, and `server/` (the files `xcore add` writes into the game's server)                                                                  |
| `loot-page/`            | the browser-side wallet helper, copied into a game that has an economy                                                                                                                                                                              |
| `skills/`               | instructions for coding agents                                                                                                                                                                                                                      |
| `docs/`                 | longer documentation                                                                                                                                                                                                                                |
| `lib/api.mjs`, `types/` | the public library entry point and its types; every other module is internal (docs/API.md)                                                                                                                                                          |
| `tests/`                | `node:test` tests, with sample games in `tests/fixtures/`                                                                                                                                                                                           |
| `scripts/`              | release and CI helpers: pin-version (pins the npx examples), try-package (the packed package installed and run), server-tools (Miniflare for the workerd tests), check-engines and unity-stub (the Godot and Unity glue checked by the engines job) |

## Making a change

1. Branch from `main`.
2. Keep changes focused. Match the existing style: ES modules, no build step, and no new runtime dependency unless it
   is clearly needed (`tests/own.test.mjs` fails on an undeclared import).
3. Add or update tests in `tests/`. Run `npm run format` to format your changes with Prettier, then run `npm run lint`
   (ESLint plus a formatting check) and `npm test`.
4. Update `README.md`, `docs/` and the command's `--help` text when behaviour changes, and add a line to
   `CHANGELOG.md`.
5. Open a pull request that explains what changed and why.

CI runs the linter, the formatting check and the tests on Linux, macOS and Windows. On Linux it also installs the server
tools and requires every test to run, and an engines job has Godot parse the Godot glue and .NET compile the Unity
glue. A pull request needs all of them to pass.

## Releases

A release is triggered by pushing a `v<version>` tag. `.github/workflows/release.yml` then:

- runs the linter and the tests on Linux, macOS and Windows (job `test`);
- packs the package, installs the `.tgz` in an empty folder and runs it (job `package`, `scripts/try-package.mjs`);
- then, in the only job that holds npm's publish right (job `publish`, which installs nothing and runs no scripts or
  tests), checks that the tagged commit is on `main`, that the tag matches the version in `package.json`, and that the
  tarball is the one the package job tried, and publishes to npm with provenance. If npm already has that version, the
  publish step is skipped.

To release:

1. Bump the version: `npm version <x.y.z> --no-git-tag-version` (`package.json` and `package-lock.json`), run
   `node scripts/pin-version.mjs` (it pins the `npx -y @xgamesfun/xcore@<version>` examples in the README, docs/ and the
   skill; `tests/docs.test.mjs` fails until you do), and add its `CHANGELOG.md` entry.
2. Commit, merge to `main`, then tag the merge commit on main: `git tag v<x.y.z> && git push origin v<x.y.z>` (a tag on
   any other commit is refused).

The workflow uses npm's trusted publishing, so no token is stored. This needs a one-time setup on npmjs.com: under
`@xgamesfun/xcore` → Settings → Trusted publisher, enter GitHub Actions, the repository `XGamesFun/xcore`, the workflow
`release.yml` and the environment `npm`. Until that is set, npm rejects the publish with E404.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
