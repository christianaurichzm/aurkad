# Aurkad

A server-authoritative 2D MMO engine. Node.js + WebSocket + MongoDB on the
server, React + Canvas on the client. You run your own server, build your own
content, and define your own rules.

## Quick start

Requires Docker with the Compose plugin; there is nothing to clone. In an
empty folder:

```bash
curl -LO https://github.com/christianaurichzm/aurkad/releases/latest/download/compose.yml
echo "ADMIN=yourname" > .env      # registering this username makes you admin
docker compose up -d
```

Open https://localhost. The browser warns once about the certificate: logins
only travel over HTTPS, so Caddy sits in front even on your own computer and
signs `localhost` itself. On a server, point a domain at it, add
`PUBLIC_URL=https://your.domain` to `.env` and run `docker compose up -d`
again; Caddy fetches a real certificate.

The first `up` writes a small playable game into `game/`: a map, a few
monsters and items, a `game.json` with the name the login screen shows and
every official module listed, only dialog, quest and mail on for the Mage's
quest, and art rendered from Kay Lousberg's KayKit models (CC0;
`templates/new-game/build` makes it). For another name, or a map
drawn in 2:1 diamonds, make it yourself before that first `up` with
`docker compose run --rm new-game "My Game" --isometric`; the map editor then
starts new maps the same way. The folder is yours to edit on the host: the
engine runs as whoever owns the folder `compose.yml` is in, scripts hot-reload,
and the rest applies on `docker compose restart app`. The world (maps, players,
items) lives in MongoDB. Upgrading the engine is changing the version on the
`image:` lines of `compose.yml` and running `docker compose up -d`; `game/` is
never touched (see [Upgrading](#upgrading)).

The art is six PNG sheets in `game/assets/`. Each is cut on the grid below
unless a JSON file beside it says otherwise, as the new game's do for two:
`tiles.json` names every frame of the tile atlas and the piece the map editor
offers it as, and `sprites.json` sizes the character frames, which can be
bigger than a cell:

| Sheet              | Cell | Layout                                                           |
| ------------------ | ---- | ---------------------------------------------------------------- |
| `tiles.png`        | 64px | any number of tiles per row; leave cell 0 transparent            |
| `sprites.png`      | 64px | 4x4 per character: rows face down, left, right, up; columns walk |
| `items.png`        | 64px | one icon per cell                                                |
| `spells.png`       | 32px | a spell's frames side by side                                    |
| `arrows.png`       | 32px | four per arrow: down, up, right, left                            |
| `attackeffect.png` | 64px | six frames of the melee swing                                    |

## Upgrading

The engine and your game are separate. The server, the web client and the
official modules are inside the image. `game/` and the database are yours, and
an upgrade never writes to `game/`.

1. Read the release notes. Each one opens with "Upgrading from" the previous
   release: whether to back up first, whether `compose.yml` changed, and
   anything a game made on that release may have to change.
2. Back up the database:
   `docker compose exec -T mongo mongodump --archive --gzip > backup.gz`
3. Change the version on the `image:` lines of `compose.yml` and run
   `docker compose up -d`.

Players' browsers pick up the new client on their next load, and a tab whose
client no longer matches the server reloads by itself.

Version numbers are measured against games that already exist:

- **Patch** (`1.0.x`): fixes. You can always go back to the previous patch.
- **Minor** (`1.x.0`): additions. Your scripts, content and `game.json` keep
  working, and a new official module ships switched off. A minor may move the
  database to a new schema version, and the notes say so: the older version
  refuses to start on it, so going back means restoring the backup.
- **Major** (`x.0.0`): something a game relied on changed. The notes list each
  change.

To go back: `docker compose stop app`, restore the backup if the notes said the
schema moved
(`docker compose exec -T mongo mongorestore --archive --gzip --drop < backup.gz`),
put the old version back on the `image:` lines and `docker compose up -d`.

An upgrade does not change what `new-game` copied into `game/` when you made
it. Improvements to the starter scripts and art reach new games only; compare
with `templates/new-game` in the release if you want them.

## Customizing your game

- **`game.json`**: balance and rules: starting stats, leveling curve, combat
  cooldowns, regen, respawn point, and which modules are on. Loaded at boot and
  merged over defaults, so you only write the keys you want to change.
  [`game.example.json`](game.example.json) lists every key with its default.

  It is validated at boot and a bad file stops the server with all the problems
  listed. A misspelled key, a string where a number belongs, or a value that
  breaks the game (zero starting health, an XP curve that never grows) is an
  error rather than a setting that silently does nothing. Delete the file and
  the engine runs on defaults.

- **`brand` in `game.json` and `theme/`**: what the game is called and how it
  looks. `brand.name` goes on the browser tab and the login card, `brand.logo`
  names a picture in `theme/` to go beside it. `theme/theme.css` loads after the
  engine's stylesheet, so it can repaint anything: the colour tokens every panel
  is drawn from, the names over the map (`--color-name-admin`,
  `--color-name-friendly`, one per access and NPC behavior), the three fonts
  (`--font-ui` for text, `--font-display` for titles and names, `--font-world`
  for levels, bars and keys), a background for the login screen, textures on
  the panels. Every file in `theme/` is public at `/theme/<name>`, because the
  login screen needs it before anyone has a session. The two corner radii
  (`--radius-control`, `--radius-panel`) and the UI icons are variables too:
  `--icon-attack: url(/theme/icons/sword.svg)` replaces one, written from the
  root because a relative url inside a variable does not resolve against
  `theme.css`. `public/styles.css` lists every name, and opens with the ids and
  classes a theme can rely on across releases; anything else in the markup may
  change. The player card's portrait is the character's sprite, marked with its
  id: a `background-image` on `#hud-portrait[data-sprite="12"]` and a hidden
  `> canvas` show a picture instead, for that sprite (a class, say) or, without
  the attribute, for everyone.

  None of that needs CSS to start with. The **Appearance** section of `/admin`
  picks six colours (the rest are mixed from them), the corners, a font, where
  the menu and the player card sit (right of the world, left of it, or in a bar
  under it) and whether the world darkens behind a conversation, with a preview
  of the result, and takes a logo and a login background as uploads. It saves
  to `theme/theme.json`, which can be written by hand as well; the server puts
  its variables ahead of `theme.css`, so where both set the same thing the
  stylesheet written by hand wins. With more than one instance, `theme/` has to
  be a volume they share.

- **`scripts/`**: server-side game logic in JavaScript (or TypeScript). Files
  are loaded at boot and hot-reloaded on save. A new game starts with
  `scripts/example.js`, a tour of the API to edit or delete. The engine's
  `scripts/global.d.ts` types it all, and `npm run docs:api` renders that,
  and the client-side module API, as a browsable reference. Example:

  ```js
  on('playerLevelUp', ({ player, level }) => {
    if (level === 10) giveItem(player, SWORD_ID, 1);
  });
  ```

- **Maps, NPCs, items, shops**: edited in-game via the admin tools, or managed
  through the admin REPL (console attached to the running server).
- **`GAME_DIR`**: the whole game in one folder. With `GAME_DIR=games/my-game`
  the engine reads `game.json`, `theme/`, `assets/`, `scripts/`, `content/` and
  the game's own `modules/` from there instead of the repository root, so
  switching games is one variable, or one Docker mount. The official modules
  still come from the engine's `modules/` and the game's load alongside them;
  one with an official module's id replaces it. The world itself (maps,
  players, items) lives in MongoDB, in a database named after the folder
  (`my-game`), so games sharing one MongoDB never see each other's data. A
  database named in `MONGO_URI` wins.

## Content packs

Export and import all game content as one JSON file per collection in `content/`: `maps.json`, `npcs.json`, `items.json`, `shops.json`, `spells.json`, `arrows.json`, `loot.json`, `dialogs.json`, `quests.json` and `recipes.json`.

```bash
npm run content:export   # writes the database's content to content/*.json
npm run content:import   # loads content/*.json into MongoDB
```

With Docker, run the same two from the folder `compose.yml` is in: `docker compose run --rm app node dist/server/contentPack/cli.js export` (or `import`).

The server also imports `content/` on every boot, but only the rows that changed in their files since the last import or `content:export`: those win over the database for the ids they define, and the rest leave it alone, so what the admin tools changed survives a restart. `content:import` writes every row, putting the database back to the files. A pack goes in whole or not at all: if any file or entry is invalid, nothing is written, the log lists every problem, and the server runs on the content the database already had (`content:import` exits with an error).

## More

How the engine is put together is in [ARCHITECTURE.md](ARCHITECTURE.md),
including [running MongoDB as a replica set](ARCHITECTURE.md#atomic-economy-writes-replica-set)
so a trade cannot lose an item, and [splitting the maps between several
servers](ARCHITECTURE.md#multi-instance-sharding).

[CONTRIBUTING.md](.github/CONTRIBUTING.md) covers working on the engine:
[running it from source](.github/CONTRIBUTING.md#development-setup) or as a
production build without Docker, the
[3,000+ tests](.github/CONTRIBUTING.md#quality-bar), and
[replaying what players did](.github/CONTRIBUTING.md#replay).

## Measured

What one server held under `npm run loadtest`, on a production build. The bots
are headless clients that log in and play over the same HTTP and WebSocket
contract as the browser. They ran on the same laptop as the server (Ryzen 7
7735HS, 16 threads, 34 GB, Node 22, MongoDB 7 in Docker) and took CPU from it,
so every number here is a floor. A tick has 50 ms (20 Hz).

| Players | Where                                       | Tick p50 | Tick p99 |
| ------- | ------------------------------------------- | -------- | -------- |
| 1000    | 10 per screen, over 100 screens             | 37.8 ms  | 46.8 ms  |
| 1000    | the same, with `NET_VIEWER_CADENCE_TICKS=2` | 25.4 ms  | 33.3 ms  |
| 300     | all starting on one screen                  | 17.3 ms  | 25.6 ms  |

- 1000 is as far as the test world and the harness went, not where the server
  stopped.
- With the density fixed, the tick grows in a straight line with the
  population: about 0.033 ms and 600 bytes per player per tick.
- A player costs CPU and a neighbour costs bandwidth. From 10 to 300 players on
  a screen, the bytes sent to each player triple and the tick goes up 70%.
- Memory at 1000 online was 0.22 MB per player. In a one hour soak of 150
  players logging in and out, resident memory stayed flat (-0.6 MB an hour).

Measured on 2026-08-15, the soak on 2026-07-31.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Your game is yours: maps, sprites, quests, dialogs, content packs, scripts in
`scripts/` and modules in `modules/` carry no obligation from this license. You
can keep them closed and sell them.

The name and logo are not covered by the code license. See [TRADEMARK.md](.github/TRADEMARK.md).

Commercial support, integration, custom modules and performance audits are
available from the author.
