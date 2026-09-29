# Aurkad

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

`game.json`, `scripts/`, `assets/` and `theme/` are bind-mounted into the
container, so you edit them on the host: scripts hot-reload instantly, the
theme on a page reload, `game.json` on `docker compose restart app`.

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
- **`brand` in `game.json` and `theme/`** - what the game is called and how it
  looks. `brand.name` goes on the browser tab and the login card, `brand.logo`
  names a picture in `theme/` to go beside it. `theme/theme.css` loads after the
  engine's stylesheet, so it can repaint anything: the colour tokens every panel
  is drawn from, fonts, a background for the login screen, textures on the
  panels. Every file in `theme/` is public at `/theme/<name>`, because the login
  screen needs it before anyone has a session. The two corner radii
  (`--radius-control`, `--radius-panel`) and the UI icons are variables too:
  `--icon-attack: url(/theme/icons/sword.svg)` replaces one, written from the
  root because a relative url inside a variable does not resolve against
  `theme.css`. `public/styles.css` lists every name, and opens with the ids and
  classes a theme can rely on across releases; anything else in the markup may
  change.
- **`scripts/`** - server-side game logic in JavaScript (or TypeScript). Files
  are loaded at boot and hot-reloaded on save. See `scripts/example.js` and the
  typed API in `scripts/global.d.ts` - `npm run docs:api` renders it, and the
  client-side module API, as a browsable reference. Example:

  ```js
  on('playerLevelUp', ({ player, level }) => {
    if (level === 10) giveItem(player, SWORD_ID, 1);
  });
  ```

- **Maps, NPCs, items, shops** - edited in-game via the admin tools, or managed
  through the admin REPL (console attached to the running server).
- **`GAME_DIR`** - the whole game in one folder. With `GAME_DIR=games/my-game`
  the engine reads `game.json`, `theme/`, `assets/`, `scripts/`, `content/` and
  the game's own `modules/` from there instead of the repository root, so
  switching games is one variable, or one Docker mount. The official modules
  still come from the engine's `modules/` and the game's load alongside them;
  one with an official module's id replaces it.

## Content packs

Export and import all game content (maps, NPCs, items, shops, spells, arrows) as a JSON bundle:

```bash
npm run content:export   # writes content/pack.json
npm run content:import   # loads content/pack.json into MongoDB
```

## Replay

Records what players did (keys, item use, chat, custom actions), so a support ticket ("my sword vanished around eight") has something to read. Start a capture from the admin console or in-game chat, without restarting:

```
replay start item-loss   # begin capturing (ADMIN, lands in the audit trail)
replay                   # status: how much is buffered, what was dropped
replay save incident     # write a file and keep recording
replay stop              # write what is left and stop
replay list              # recordings on disk
```

`REPLAY_RECORD=true` starts a capture at boot instead, saved on shutdown. Either way the buffer is a ring (`REPLAY_MAX_EVENTS`): a capture left running keeps the recent minutes rather than growing without bound, and the file says how many older actions fell out. Nothing reaches disk until someone saves it.

```bash
npm run replay -- replays/<file>.json                    # summary, timeline, action log
npm run replay -- replays/<file>.json --at=20:03         # only a minute around the complaint
npm run replay -- replays/<file>.json --player=Alice --grep=sword
npm run replay -- replays/<file>.json --type=keyboard    # log kinds (default: all but keyboard)
npm run replay -- replays/<file>.json --run              # re-simulate the movement headlessly
```

`--run` rebuilds a world from the recorded seed and replays the keyboard input through it. It reproduces the input, not the incident: a capture started mid-session does not carry the state that predates it.

## Atomic economy writes (replica set)

A trade moves an item between two player documents, and mailing one moves it from a player into the delivery queue. MongoDB can only write two documents together on a **replica set**; standalone `mongod` cannot, so the engine writes them one at a time and a crash in between duplicates or loses the item.

The server detects which it is talking to and says so on boot:

```
[DB] Transactions available; economic commits are atomic
[DB] Standalone MongoDB: no transactions. A trade writes each player separately, ...
```

Standalone is a fine default for a small server. To close the window, run the same single node as a replica set - no cluster, no extra host:

```bash
docker run -d --name engine-mongo -p 127.0.0.1:27017:27017 mongo:7 --replSet rs0 --bind_ip_all
docker exec engine-mongo mongosh --quiet --eval \
  'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
# then point the server at it
MONGO_URI='mongodb://127.0.0.1:27017/game?replicaSet=rs0' npm start
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

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Your game is yours: maps, sprites, quests, dialogs, content packs, scripts in
`scripts/` and modules in `modules/` carry no obligation from this license. You
can keep them closed and sell them.

The name and logo are not covered by the code license. See [TRADEMARK.md](TRADEMARK.md).

Commercial support, integration, custom modules and performance audits are
available from the author.
