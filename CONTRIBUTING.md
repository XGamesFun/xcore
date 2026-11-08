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

Set `GAMESFUN_DEBUG=1` to print stack traces for errors.

## Project layout

| Path            | What it holds                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `bin/xcore.mjs` | the command's entry point: loads `commands/` and hands other commands to the kit                               |
| `commands/`     | one module per command (`adopt`, `check`, `backend`, `loot`, `login`, `logout`, `publish`)                     |
| `lib/`          | everything the commands use; `lib/publish/` is the publish pipeline, `lib/server/` the `gf-server-v1` contract |
| `loot-page/`    | the browser-side wallet helper copied into a game with an economy                                              |
| `skills/`       | instructions for coding agents                                                                                 |
| `docs/`         | longer documentation                                                                                           |
| `tests/`        | `node:test` tests, with sample games in `tests/fixtures/`                                                      |

## Making a change

1. Branch from `main`.
2. Keep changes focused. Match the existing style: ES modules, no build step, no new runtime dependency unless it is
   clearly needed (`tests/own.test.mjs` fails on an undeclared import).
3. Add or update tests in `tests/`. Run `npm run format` to format your changes with Prettier, then `npm run lint`
   (ESLint, and a check that everything is formatted) and `npm test`.
4. Update `README.md`, `docs/` and the command's `--help` text when behaviour changes, and add a line to
   `CHANGELOG.md`.
5. Open a pull request that explains what changed and why.

CI runs the linter, the formatting check and the tests on Linux, macOS and Windows; a pull request needs both to pass.

## Releases

Maintainers release by pushing a `v<version>` tag; `.github/workflows/release.yml` publishes to npm with provenance.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
