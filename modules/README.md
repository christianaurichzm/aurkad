# Modules

Official, optional toolkit features. Each module is a folder here with a
manifest and a server entry, toggled and configured from `game.json`.

```
modules/
  guild/
    module.json   # manifest
    server.js     # server entry (runs in the script sandbox)
```

## Manifest (`module.json`)

```json
{
  "id": "guild",
  "name": "Guild System",
  "version": "1.0.0",
  "server": "server.js",
  "description": "Player guilds.",
  "enabledByDefault": true,
  "config": { "maxMembers": 50 },
  "dependencies": []
}
```

- `server` - entry file (JavaScript). Compile TypeScript modules to `.js`.
- `enabledByDefault` - loaded unless `game.json` disables it (default `true`).
- `config` - default config, overridable per game.
- `dependencies` - module ids that must load first.

## Toggling & config (`game.json`)

```json
"modules": {
  "guild": { "enabled": true, "config": { "maxMembers": 100 } }
}
```

`enabled` overrides `enabledByDefault`. `config` is shallow-merged over the
manifest defaults and injected into the entry as a `config` global.

## Writing a module

The entry runs in the same sandbox as game scripts, so it has the full script
API (hooks via `on`, `command`, `store`, `getPlayerData`/`setPlayerData`,
`showDialog`, quests, custom events…; see `scripts/global.d.ts`) plus its
own `config`. Anything it registers is unregistered automatically on shutdown.

Modules load at boot, before game scripts. Unlike scripts they are not
hot-reloaded; restart to apply changes.

## Sharing an API between modules

A module publishes an API with `provide(name, api)`; other modules and scripts
consume it with `use(name)`:

```js
// modules/guild/server.js
provide('guild', { guildOf: (p) => /* ... */ });

// another module or a game script
const guild = use('guild');
if (guild && guild.guildOf(player)) { /* ... */ }
```

If a module declares another in `dependencies`, that dependency loads first (so
its API is available at load time) and the dependent is skipped if the
dependency is disabled or fails to load.

## Client UI (`client` entry)

A module can ship browser code too. Add `"client": "client.js"` to the
manifest; the server serves it and the client loads it after connecting. It
runs with an `engine` API injected, under the server entry's trust model and
with no import system:

```js
// modules/guild/client.js
const panel = engine.mount();               // a DOM element this module owns
engine.onServerEvent('guild:update', (g) => { panel.innerHTML = render(g); });
engine.sendServerEvent('guild:request');    // talk back to the server entry
```

`engine`:
- `mount()` → an `HTMLElement` to render into (vanilla DOM, or your own bundle).
- `onServerEvent(channel, handler)` / `sendServerEvent(channel, payload)` - the
  same custom-event channels the server entry uses (`sendEvent` / `customAction`).
- `log` / `warn` / `error`.

The server pushes state on a channel; the client renders it. Because the client
may connect after the first push, have the client request current state on load
(see `guild:request` above).
