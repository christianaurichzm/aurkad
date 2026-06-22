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
