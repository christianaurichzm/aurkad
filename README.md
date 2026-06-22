# engine

A server-authoritative 2D MMO engine. Node.js + WebSocket + MongoDB on the
server, React + Canvas on the client. You run your own server, build your own
content, and define your own rules.

## Run with Docker (fastest)

Requires Docker with the Compose plugin.

```bash
cp .env.example .env
# edit .env and set a strong SESSION_SECRET (openssl rand -hex 32)

npm run docker:up      # builds the image, starts MongoDB + the server
npm run docker:logs    # tail server logs
```

The game is served at http://localhost:8080.

`game.json`, `scripts/` and `assets/` are bind-mounted into the container, so
you edit them on the host: scripts hot-reload instantly, `game.json` applies on
`docker compose restart app`.

Stop everything with `npm run docker:down`.

## Local development

```bash
npm install
npm run db:up          # MongoDB only, in Docker
npm run dev            # server (8080) + client dev server with HMR
```

`npm run dev:seed` resets the database, seeds sample content and starts dev.

## Customizing your game

- **`game.json`** - balance and rules: starting stats, leveling curve, combat
  cooldowns, regen, respawn point. Loaded at boot and merged over defaults.
- **`scripts/`** - server-side game logic in JavaScript (or TypeScript). Files
  are loaded at boot and hot-reloaded on save. See `scripts/example.js` and the
  typed API in `scripts/global.d.ts`. Example:

  ```js
  on('playerLevelUp', ({ player, level }) => {
    if (level === 10) giveItem(player, SWORD_ID, 1);
  });
  ```

- **Maps, NPCs, items, shops** - edited in-game via the admin tools, or managed
  through the admin REPL (console attached to the running server).

## Tests

```bash
npm test               # watch mode
npm run test:run       # single run
npm run typecheck      # tsc, no emit
```
