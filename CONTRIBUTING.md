# Contributing to Touch Grass

Ideas, bug reports and pull requests are welcome. The project is
source-available, not open source. Please read [LICENSE](LICENSE) first: you
may fork this repo to prepare contributions and run it privately to test
them, but you may not host a public copy or stream one. Submitting anything
grants the maintainer the rights described in LICENSE §3.

## Ideas

Open an issue with the `idea` label. Game mechanics, funny text, achievements
and dream lines are all fair game. Say what an agent would do with it and why
it would be fun to watch.

## Pull requests

1. Install [Bun](https://bun.sh) 1.4.2 or newer and Docker.
2. `bun install`
3. `docker run -d --name tg-redis -p 6379:6379 redis:7.4-alpine`
4. Make your change with a test that fails before it and passes after.
5. `bun run test && bun run test:int && bun run typecheck` must pass.
6. Open the PR against `main` and explain the behavior change.

House rules:

- Every tunable number lives in `shared/balance.ts`.
- Keep comments short (two lines at most) and only where the "why" is not
  obvious.
- Assets must be CC0 and listed in `web/assets/CREDITS.md`.
- The design lives in `docs/superpowers/specs/`. Bigger changes should start
  as an issue so the design can be updated first.
