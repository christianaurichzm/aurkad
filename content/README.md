# Content pack

Versionable game content as JSON. Put files here and they are imported into
MongoDB at server boot (files win for the ids they define). Mongo stays the
runtime source of truth; commit these files to version your game.

The starter pack (`items.json`, `npcs.json`, `shops.json`) is included and
active. Maps are created in-game via the admin map editor and exported with
`npm run content:export`.

## Files loaded at boot

- `items.json`
- `npcs.json`
- `shops.json`
- `maps.json`

The `*.example.json` files are **not** loaded; they are reference templates.

## Workflow

```bash
npm run content:export   # snapshot current DB -> content/*.json
npm run content:import   # apply content/*.json -> DB (also runs at boot)
```

Edit content in-game with the admin tools, run `content:export`, then commit.
Or edit the JSON by hand and `content:import` (or restart).

## Import order & validation

Imported as items → npcs → shops → maps (later types reference earlier ids).
Each entry is validated; invalid entries are skipped with a logged reason, so
one bad row never blocks the rest.

## Formats

**items.json**: `id` is a number and must be stable across machines.

```json
[
  { "id": 1, "name": "Health Potion", "sprite": 0, "type": "consumable",
    "effects": [{ "attribute": "health", "type": "add", "value": 20 }] },
  { "id": 2, "name": "Iron Sword", "sprite": 1, "type": "weapon",
    "effects": [{ "attribute": "attack", "type": "add", "value": 5 }] }
]
```

`type`: `weapon | helmet | chestplate | gloves | boots | consumable | money`.
`effect.attribute`: `health | maxHealth | attack | speed | attackRange | experience | experienceToNextLevel | level`.
`effect.type`: `add | multiply`.

**npcs.json**: `id` is a string.

```json
[
  { "id": "goblin", "name": "Goblin", "sprite": 2, "maxHealth": 30,
    "attack": 5, "behavior": "aggressive", "experienceValue": 10,
    "itemsToDrop": [{ "itemId": 1, "chance": 0.5, "quantity": 1 }] }
]
```

`behavior`: `aggressive | hostile | neutral | friendly | shopkeeper | guard`.
`width`, `height`, `attackRange` default to one tile (48) if omitted.

**shops.json**

```json
[
  { "id": "general", "name": "General Store",
    "products": [{ "itemId": 1, "currency": 2, "price": 10 }] }
]
```

`currency` is the item id used as money for that product.

**maps.json**: `tiles` is a 2D array (rows of columns).

```json
[
  { "id": "overworld", "name": "Overworld", "type": "normal",
    "tiles": [
      [{ "tileIndex": 0 }, { "tileIndex": 0, "blocked": true }],
      [{ "tileIndex": 0, "triggers": [{ "action": "heal" }] },
       { "tileIndex": 0, "triggers": [{ "action": "kill" }] }]
    ] }
]
```

Tile fields: `tileIndex` (required), `blocked`, `avoidNpc`, `fringe`,
`warp`, `npcSpawn`, `item`, `shop`, `triggers`.
`triggers[].action`: `heal | kill | message` (message also takes `text`).
