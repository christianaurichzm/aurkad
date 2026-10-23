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
npm run db:up                        # MongoDB only, in Docker
npm run new-game -- games/my-game    # named after the folder, or pass "A Name"; --isometric
GAME_DIR=games/my-game npm run dev   # server (8080) + client dev server with HMR
```

In development the first account registered becomes the admin.
`npm run docker:up` runs your changes the way a release runs: it builds an
image from the checkout and starts `compose.game.yml` on it, with `game/` at
the root of the checkout and a database of its own. As in a release, the admin
there is the account named by `ADMIN` in a `.env` at the root of the checkout.

`npm run build && npm start` runs the production build without Docker. It
reads `.env.production` (`.env.example` lists every variable) and refuses to
boot without `CORS_ALLOWED_ORIGINS` and `USE_SECURE_COOKIES=true`: the session
cookie only travels over HTTPS, so the server runs behind a TLS proxy, with
`TRUST_PROXY=1`.

## Quality bar

Every change must keep these green, and CI enforces them:

```bash
npm run check          # all four below, stopping at the first that fails
npm run format:check   # prettier
npm run lint           # eslint over src, modules, new-game's scripts
npm run typecheck      # tsc over every tsconfig in the repo, in parallel, no emit
npm run test:run       # vitest single run
```

`npm test` runs vitest in watch mode while you work. A pre-commit hook
(`.githooks/`) runs prettier + eslint automatically.

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

## Replay

Records what players did (keys, item use, chat, custom actions), so a support
ticket ("my sword vanished around eight") has something to read. Start a
capture from the admin console or in-game chat, without restarting:

```
replay start item-loss   # begin capturing (ADMIN, lands in the audit trail)
replay                   # status: how much is buffered, what was dropped
replay save incident     # write a file and keep recording
replay stop              # write what is left and stop
replay list              # recordings on disk
```

`REPLAY_RECORD=true` starts a capture at boot instead, saved on shutdown.
Either way the buffer is a ring (`REPLAY_MAX_EVENTS`): a capture left running
keeps the recent minutes rather than growing without bound, and the file says
how many older actions fell out. Nothing reaches disk until someone saves it.

```bash
npm run replay -- replays/<file>.json                    # summary, timeline, action log
npm run replay -- replays/<file>.json --at=20:03         # only a minute around the complaint
npm run replay -- replays/<file>.json --player=Alice --grep=sword
npm run replay -- replays/<file>.json --type=keyboard    # log kinds (default: all but keyboard)
npm run replay -- replays/<file>.json --run              # re-simulate the movement headlessly
```

`--run` rebuilds a world from the recorded seed and replays the keyboard input
through it. It reproduces the input, not the incident: a capture started
mid-session does not carry the state that predates it.

## Commit style

Short, imperative, `type(scope): title` in English. Examples:

```
fix: guard against double-scheduling WS reconnect
perf: avoid cloning RuntimeNpc on npc collision checks
refactor: split chat/custom fan-out out of net/snapshot
```

Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `chore`.

The subject is at most 72 characters. A body is optional: at most three lines
wrapped at 72, saying what changed and why.

A `!` after the type or scope (`feat(script)!: ...`) marks a breaking change.
Release notes are built from commit subjects alone, so the `!` has to be in the
subject, not in a footer.

## Compatibility

A game made on one release has to keep running on the next one with nothing
changed in its folder: scripts and modules written against
`scripts/global.d.ts` and `modules/clientEngine.d.ts`, `content/*.json`,
`game.json`, a `.env`, and a database. Anything that stops accepting what the
previous release accepted is a breaking change and needs a major version:

- a script global, type, hook or hook payload field removed or renamed, a new
  required parameter, a return that can now be `undefined`;
- a content or `game.json` field that becomes required, a range that narrows,
  a key that goes away;
- an official module removed, or its `enabledByDefault` changed. A new module
  ships with `"enabledByDefault": false`: a `game.json` only names the modules
  that existed when the game was made, so one that defaults to on starts
  running in every existing game;
- a variable dropped from `.env.example`.

Prefer the compatible path: an optional parameter instead of a required one, a
default for a new field, and for a renamed API the old name kept as a shim that
logs a deprecation warning, removed in the next major.

`npm run compat` checks all of the above against the latest release tag and
prints the upgrade notes. `npm version` runs it first and refuses a bump smaller
than the changes need; the release workflow runs it again, puts its output at
the top of the release notes, and boots a game made on the previous release on
the new image before publishing.

Two changes are not breaking but still show up in the notes. A
`DB_SCHEMA_VERSION` bump (`src/server/services/dbService.ts`, with its upgrade
step) needs at least a minor, because the previous build refuses the upgraded
database. A change to `compose.game.yml` means existing installs have to
download the new `compose.yml`. Changing a default that games do not override
(a balance number, a module's config) is a judgment call: if it changes how
existing games play, mark the commit with `!`.

`PROTOCOL_VERSION` (`src/shared/wsProtocol.ts`) is separate from all of this.
It counts wire format changes between the server and the browser, and only
ever goes up.

## Pull requests

1. Branch from `main`.
2. Keep PRs focused; one concern per PR.
3. Ensure the quality-bar commands above pass locally.
4. Fill in the PR template (what changed, why, how it was verified).

## Reporting security issues

Do **not** open a public issue for vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
project's [Apache-2.0](../LICENSE) license, as stated in section 5 of that
license. No separate contributor agreement is required.
