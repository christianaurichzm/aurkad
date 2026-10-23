# Architecture

A server-authoritative 2D tile-based online RPG engine. The server owns all
game state and simulation; clients render an interpolated view and send input.

- **Server:** Node.js + TypeScript, WebSocket (`ws`), MongoDB (Mongoose).
- **Client:** React + Vite, Canvas 2D.
- **Shared:** protocol types, constants, and a quadtree, imported by both sides.

The project is organized in three tiers:

1. **Core**: the engine (this repository's `src/`).
2. **Official optional modules**: opt-in gameplay systems in `modules/`,
   toggled from `game.json`.
3. **Game scripts**: server-side game logic in a game folder's `scripts/`,
   hot-reloaded.

## Repository layout

```
src/
  server/
    sim/          20 Hz simulation loop, clock, RNG, replay, per-map quadtrees
    net/          WebSocket transport, snapshots, AOI, fan-out, wire stats
    services/     gameplay services (movement, combat, npc, player)
    engine/       hooks/events, module loader, scripting sandbox
    persistence/  repository layer over Mongoose, write-behind, KV store
    http/         Express app, routes, session, request logging
  client/
    core/         game bootstrap and client state
    graphics/     canvas renderers, camera, sprite atlas
    io/           network (http + ws sync) and module client runtime
    components/   React UI (HUD, inventory, editors, dialogs)
  shared/         wire protocol types, constants, geometry, quadtree
modules/          official optional modules (plain JS + manifests)
scripts/          the scripting API that game scripts are typed against
demos/            sample games, each a folder GAME_DIR can point at
```

## The simulation loop

The authoritative loop runs at a fixed **20 Hz** (`src/server/sim/loop.ts`). Each
tick runs an ordered pipeline of systems:

```
advanceTick → rebuildSpatialIndexes → processActions → updateNpcs
  → regenerateHealth → processMovementCompletion → processMovementIntent
  → runScheduledTasks → tickHook → flushGameEvents → broadcastGameState
```

Design properties:

- **Fixed-step with catch-up.** The loop accumulates elapsed time and runs up to
  `maxUpdatesPerTick` steps, so a stall doesn't drop the world out of sync.
- **Allocation-sensitive hot path.** The per-tick systems avoid allocation:
  reused buffers, object pools, and no cloning of runtime entities in inner
  loops. This is a hard rule (see [CONTRIBUTING.md](.github/CONTRIBUTING.md)).
- **Deterministic.** A seeded RNG (`sim/rng.ts`, mulberry32) drives drops, NPC
  wander, and respawns, so a recorded input stream replays identically
  (`sim/replayRecorder.ts`, `npm run replay`).
- **Fault-isolated.** A throwing system is logged and skipped; the loop stays
  alive.
- **`tick` hook.** Scripts and modules extend the tick via the `tick` event
  (pets, projectiles, DoTs, timed buffs) after movement settles, before flush.

## Netcode

State is streamed per tick as JSON, optimized around a per-player **area of
interest (AOI)**.

- **Hot/cold split.** Fast-changing state (`PlayerHot`: position, action) is
  separated from slow state (`PlayerCold`: stats, inventory). Cold state is sent
  only when one of its fields changes, compared in place against what the
  viewer was last sent (`net/viewerState.ts`).
- **AOI by camera viewport.** Each player receives only entities within their
  viewport plus a configurable margin (`NET_AOI_MARGIN_TILES`).
- **Static map chunking.** Tiles are delivered as 16×16 chunks on demand as the
  viewport moves, capped per tick, and cached client-side by map revision.
- **Delta snapshots.** Each entity's public state is diffed field by field once
  per tick (`net/entityReplication.ts`) and the resulting fragment reused by
  every viewer that can see it; only changed fields go on the wire. An entity
  entering a viewport is sent complete so the client can insert it blindly.
- **Explicit tombstones.** Entities leaving the AOI are named in the `leave`
  list of the update rather than encoded as diff deletions, which avoids
  embedding the full previous entity in the wire format.
- **Per-viewer cadence** (`NET_VIEWER_CADENCE_TICKS`, default 1 = every tick).
  Raising it trades latency for broadcast CPU, because the cost measured is per
  message rather than per byte. A viewer that skipped ticks gets the deltas of
  that span merged, so catching up costs about what one tick's delta costs.
- **Client prediction + interpolation.** The client predicts local movement and
  interpolates remote entities between snapshots for smooth motion below the
  server cadence.
- **Instrumented.** `net/netStats.ts` tracks bytes/tick, delta ratio, and churn.
  The protocol stays JSON until measurements justify a binary hot path.

Input is validated at the boundary with a Zod discriminated union
(`net/clientMessage.ts`) before it reaches the simulation.

`net/` has two halves. The **systems** (`transport.ts` inbound, `snapshot.ts`
and `fanout.ts` outbound) read the world and the services, and only the tick
loop and the server bootstrap call them. The **state** modules
(`connections.ts`, `entityReplication.ts`, `viewerState.ts`) hold sockets and
replication caches and import no gameplay, so a service can tell replication
that something changed (an entity despawned, an item definition was edited, a
tile was retiled) without a dependency cycle. A lint rule keeps gameplay off the
systems.

## World and state

Runtime state lives behind a **world registry** (`sim/world.ts`), not scattered
globals. The registry owns the ownership invariant between the global player set
and per-map player collections (`register`/`unregister`/`placePlayerOnMap`/…),
and provides `O(1)` lookups by name.

Entities are built by **lightweight composition**, not a heavy ECS. Components
(`Identity`, `BaseStats`, `Transform`, `Movement`, `Progression`,
`InventoryHolder`) are combined by intersection types; `PlayerServer` and
`RuntimeNpc` are flat, identical-shaped runtime objects. "Systems" are plain
functions (`processMovementIntent`, `updateNpcs`, combat). A heavy ECS
(archetypes, sparse sets, a query engine) is avoided: entity counts per map are
low, and an ECS pays off only at far larger scale.

## Persistence

All Mongoose access is behind a **repository layer** (`persistence/`). Key
properties:

- **Normalization boundary.** Repositories normalize records on read, so
  integrity bugs are resolved at the data edge rather than in gameplay code.
- **Write-behind.** Gameplay mutations mark players dirty
  (`persistence/dirtyPlayers.ts`); a snapshot loop flushes dirty players in
  batches off the hot path. Disconnect and shutdown persist immediately.
- **Record/runtime split.** `PlayerRecord` (DB) is separate from `PlayerServer`
  (runtime); secrets never enter the tick.
- **KV store.** A namespaced key-value store backs script/module data
  (`store.get`/`store.set`).

### Where each content type lives

Each kind of content the admin tools edit and a content pack carries has one
service, which owns its reads and writes, the zod schema a write has to pass
and, when the tick reads it, its in-memory cache:

| Content                                                            | Service                             |
| ------------------------------------------------------------------ | ----------------------------------- |
| items, NPCs, loot tables, spells, arrows, dialogs, quests, recipes | `services/content/<type>Service.ts` |
| maps                                                               | `services/world/mapService.ts`      |
| shops                                                              | `services/economy/shopService.ts`   |

Maps and shops sit with the gameplay their services also run (warps and
instances, buying and selling).

### Atomic economy writes (replica set)

A trade moves an item between two player documents, and mailing one moves it
from a player into the delivery queue. MongoDB can only write two documents
together on a **replica set**; standalone `mongod` cannot, so the engine writes
them one at a time and a crash in between duplicates or loses the item.

The auction module requires transactions and refuses operations on standalone
MongoDB. Listing commits the seller's inventory and escrow together. Buying
commits the buyer's inventory and a durable seller payment; a failed payment is
retried by the sweep after a restart. Cancellation and expiry commit the
returned item and removal of the listing together. The module's `list` and
`listings` APIs return promises.

The server detects which it is talking to and says so on boot:

```
[DB] Transactions available; economic commits are atomic
[DB] Standalone MongoDB: no transactions. A trade writes each player separately, ...
```

Both compose files run Mongo as a replica set of one node, so a server started
with them gets transactions with nothing to set up; a standalone volume from
before converts in place on the next `docker compose up`. A Mongo of your own
needs the same flag and one init command, with no cluster or extra host:

```bash
docker run -d --name engine-mongo -p 127.0.0.1:27017:27017 mongo:7 --replSet rs0 --bind_ip_all
docker exec engine-mongo mongosh --quiet --eval \
  'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
# then point the server at it
MONGO_URI='mongodb://127.0.0.1:27017/game' npm start
```

The member is named after the address the server reaches it on. A server in
another container reaches it under another name, so it connects with
`?directConnection=true`, as the compose files do.

## Extensibility

Three layers, in increasing order of coupling to the engine:

- **Hooks & events** (`engine/hooks.ts`, `engine/eventBus.ts`). Systems and
  scripts subscribe to lifecycle and gameplay events (`playerLevelUp`,
  `beforeDamage`, `tick`, …).
- **Modules** (`modules/`, loaded by `engine/modules/moduleLoader.ts`). Each is
  a folder with a `module.json` manifest and a `server.js` (plus optional
  `client.js`), toggled from `game.json`. Modules run on the same script API and
  hooks; none live in the core.
- **Scripts** (a game's `scripts/`). Server-side game logic in plain JS,
  hot-reloaded on save, using the typed API in `scripts/global.d.ts`.

### Scripting trust model

Scripts and modules run in a `node:vm` context. This is **trusted scripting, not
a security sandbox**: a host object passed to a script can reach the host realm.
Only run code authored by the server owner. Accepting scripts from strangers is
not a VM-library swap: the boundary has to be the OS (process or container per
world), and that is a different system. Handler time is budgeted and a repeat
overrunner is disabled, which bounds cost but not a handler that never returns.
See [SECURITY.md](.github/SECURITY.md).

## Client

The client renders layered Canvas 2D (foreground → mask → items → grid →
actors sorted by Y → fringe). Highlights:

- **Camera** (`graphics/camera.ts`) follows the interpolated local player and
  clamps to map bounds; maps ≤ one viewport render with zero offset
  (retro-compatible with the original single-screen maps).
- **Sprite atlas** (`graphics/atlas.ts`) packs sprite sheets into a single
  canvas at runtime for batched draws, at any source resolution.
- **Interpolation & prediction** smooth remote and local motion between the
  20 Hz snapshots.
- **Module overlays** draw through a registry and a coordinate API
  (`worldToScreen`/`screenToWorld`) without touching the core render path.

## Multi-instance sharding

The engine shards **by map**. Each instance declares the maps it owns
(`MAP_IDS`) and a public URL (`WS_PUBLIC_URL`), registering in an instance
registry in MongoDB. On a cross-map warp, the target map is looked up; if it
lives on another instance, the player is persisted and the client is
transparently redirected to the owning instance's URL, with no page reload.
Without these env vars, a single instance loads all maps (default behavior).

Two instances, each with half the maps:

```bash
WS_PUBLIC_URL=ws://host:8080 MAP_IDS=map1,map2 PORT=8080 npm start
WS_PUBLIC_URL=ws://host:8081 MAP_IDS=map3,map4 PORT=8081 npm start
```

In Docker, each instance is one more service in `compose.yml`, beside `app`
and on the same image. Each needs its own `WS_PUBLIC_URL` and a `MAP_IDS` that
overlaps no other's, so `app` gets the first pair too:

```yaml
services:
  app-b:
    image: ghcr.io/christianaurichzm/aurkad:<the version app runs>
    restart: unless-stopped
    user: root
    entrypoint: [/app/compose-entrypoint.sh]
    depends_on:
      mongo:
        condition: service_healthy
    environment:
      PORT: '8081'
      GAME_DIR: /srv/game
      MONGO_URI: mongodb://mongo:27017/?directConnection=true
      SESSION_SECRET: ${SESSION_SECRET:-}
      CORS_ALLOWED_ORIGINS: https://localhost,https://localhost:8444
      USE_SECURE_COOKIES: 'true'
      TRUST_PROXY: '1'
      WS_PUBLIC_URL: wss://localhost:8444
      MAP_IDS: map3,map4
    volumes:
      - .:/srv
```

Caddy then serves one site per instance, so its `command` gives way to a
Caddyfile mounted at `/etc/caddy/Caddyfile`, with `'8444:8444'` added to its
ports:

```
https://localhost { reverse_proxy app:8080 }
https://localhost:8444 { reverse_proxy app-b:8081 }
```

## Key design decisions

| Decision | Rationale |
|----------|-----------|
| Lightweight composition, not a heavy ECS | Low entity counts per map; systems are already plain functions |
| JSON wire protocol (for now) | Simpler and debuggable; binary only when bytes/tick is a measured bottleneck |
| Write-behind persistence | Keeps DB I/O off the 20 Hz hot path; MMO-standard durability trade-off |
| Server-authoritative movement + combat | Anti-cheat by construction; client predicts, server decides |
| `node:vm` trusted scripting | Fits the self-hosted model; the boundary is documented rather than claimed, and untrusted scripts need OS-level isolation |
| Shard by map | Natural isolation unit; cross-map warp is the only cross-instance path |
