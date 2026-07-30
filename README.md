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

- **`game.json`**: balance and rules: starting stats, leveling curve, combat
  cooldowns, regen, respawn point, and which modules are on. Loaded at boot and
  merged over defaults, so you only write the keys you want to change.
  `game.example.json` lists every key with its default.

  It is validated at boot and a bad file stops the server with all the problems
  listed. A misspelled key, a string where a number belongs, or a value that
  breaks the game (zero starting health, an XP curve that never grows) is an
  error rather than a setting that silently does nothing. Delete the file and
  the engine runs on defaults.
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

## Content packs

Export and import all game content (maps, NPCs, items, shops, spells, arrows) as a JSON bundle:

```bash
npm run content:export   # writes content/pack.json
npm run content:import   # loads content/pack.json into MongoDB
```

## Replay

Record a session by starting the server with `REPLAY_RECORD=true`. On shutdown the session is saved to `replays/<timestamp>.json`.

```bash
npm run replay -- replays/<file>.json        # summary + ASCII timeline
npm run replay -- replays/<file>.json --run  # also runs headless simulation
```

## Multi-instance (sharding by map)

Each instance declares which maps it owns. On cross-map warp the client is transparently redirected to the correct instance.

```bash
WS_PUBLIC_URL=ws://host:8080 MAP_IDS=map1,map2 PORT=8080 npm start
WS_PUBLIC_URL=ws://host:8081 MAP_IDS=map3,map4 PORT=8081 npm start
```

See `docker-compose.yml` for a commented two-instance Docker example.

## Tests

```bash
npm test               # watch mode
npm run test:run       # single run
npm run typecheck      # tsc, no emit
```
