# Contributing

Thanks for your interest in improving Aurkad. This document covers how to
set up the project, the quality bar, and the conventions we follow.

## Code contributions are paused

External code contributions are not being accepted during the project's initial
validation period. Bug reports, feedback, questions and feature discussions are
very welcome: open an issue.

## Development setup

```bash
npm install
npm run db:up                        # MongoDB in Docker
npm run new-game -- games/my-game    # a small playable game to run against
GAME_DIR=games/my-game npm run dev   # server (8080) + client dev server with HMR
npm run starter                      # or the sample game in demos/starter
```

## Quality bar

Every change must keep these green, and CI enforces them:

```bash
npm run typecheck      # tsc, server + client + scripts + modules, no emit
npm run lint           # eslint over src, modules, the starter's scripts
npm run format:check   # prettier
npm run test:run       # vitest single run
```

A pre-commit hook (`.githooks/`) runs prettier + eslint automatically.

Guidelines:

- **The 20 Hz simulation loop is allocation-sensitive.** Do not allocate in the
  per-tick hot path (`src/server/sim/`, `src/server/net/snapshot.ts`,
  movement/combat). Prefer reused buffers and object pools.
- **Add tests with behavior changes.** Sim, netcode, persistence, and gameplay
  modules all have coverage; match the pattern of the nearest existing test.
- **Comments explain _why_, not _what_.** Keep them minimal; let names carry
  intent.
- **Server is TypeScript; game scripts and modules are plain JavaScript**
  (type-checked via `// @ts-check` + `.d.ts`, not compiled).

## Commit style

Short, imperative, `type(scope): title` in English. Examples:

```
fix: guard against double-scheduling WS reconnect
perf: avoid cloning RuntimeNpc on npc collision checks
refactor: split chat/custom fan-out out of net/snapshot
```

Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `chore`.

## Pull requests

1. Branch from `main`.
2. Keep PRs focused; one concern per PR.
3. Ensure the quality-bar commands above pass locally.
4. Fill in the PR template (what changed, why, how it was verified).

## Reporting security issues

Do **not** open a public issue for vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
project's [Apache-2.0](LICENSE) license, as stated in section 5 of that
license. No separate contributor agreement is required.
