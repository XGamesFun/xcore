# Security policy

`xcore` signs people in to games.fun, stores publish tokens, scans games for secrets before they go public and handles
Solana economies, so we take security reports seriously.

## Reporting a vulnerability

**Do not open a public issue for a security problem.** Report it privately through GitHub's
[private vulnerability reporting](https://github.com/XGamesFun/xcore/security/advisories/new) (the repository's
**Security** tab → **Report a vulnerability**).

Please include:

- what the problem is and what an attacker could do with it
- the steps or a minimal example to reproduce it
- the version (`xcore --version`), your operating system and your Node version

We aim to acknowledge a report within 3 business days and to keep you informed until it is fixed. Please give us
reasonable time to release a fix before you disclose the problem publicly. We are glad to credit you in the release
notes if you would like.

## Supported versions

Security fixes go into the latest published version of `@xgamesfun/xcore`. Please upgrade before reporting.

## In scope

- the `xcore` command and everything under `bin/`, `commands/`, `lib/` and `loot-page/`
- sign-in and token storage (`lib/credentials.mjs`, `lib/secret-store.mjs`, `lib/publish/client.mjs`)
- the secret scan and the publish checks (`lib/publish/scan.mjs`, `lib/publish/index.mjs`)
- the GitHub Actions OIDC publish path (`lib/publish/oidc.mjs`)

A key or secret that the publish scan fails to catch is in scope.

## Out of scope

- the games.fun website and hosting, `@xgamesfun/kit` and `@xgamesfun/solana`: report those to their own projects
- vulnerabilities in a game someone published with this tool
- findings that need an already-compromised machine or account
