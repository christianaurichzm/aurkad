# Content pack

Versionable game content as JSON. Put files here and they are imported into
MongoDB at server boot (files win for the ids they define). Mongo stays the
runtime source of truth; commit these files to version your game.

A game's pack is the `content/` in its folder, the one `GAME_DIR` points at;
`CONTENT_PATH` loads one from anywhere else. The examples below are not this
game's content, just the shape of each file.

Maps are created in-game via the admin map editor and exported with
`npm run content:export`.

## Files loaded at boot

- `arrows.json`
- `spells.json`
- `items.json`
- `loot.json`
- `dialogs.json`
- `quests.json`
- `recipes.json`
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

Imported as arrows → spells → items → loot → dialogs → quests → recipes →
npcs → shops → maps (later types reference earlier ids). Quests and npcs point
at each other, so no order satisfies both; quests go first because
`npc.questId` is the reference a save would break. Each entry is validated;
an invalid one is skipped with a logged reason and never blocks the rest.

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
`arrowId` makes a weapon fire that arrow (the `archery` module, key R);
`bound: true` keeps an item from being dropped, traded or banked.

**arrows.json**: what a ranged weapon fires. `id` is a number.

```json
[{ "id": 1, "name": "Wooden Arrow", "sprite": 0, "damage": 9, "rangeTiles": 6 }]
```

**spells.json**: the `magic` module's hotbar, in file order (F1, F2, …).

```json
[
  { "id": 1, "name": "Arcane Blast", "sprite": 0, "mpCost": 30, "damage": 15,
    "cooldownMs": 3000 },
  { "id": 2, "name": "Mending Light", "sprite": 57, "frames": 3, "mpCost": 30,
    "target": "party", "heal": 40, "visualTarget": "targets" }
]
```

`target`: `enemies` take `damage`; `self | party | guild` get `heal`, where 0
heals to full.

**npcs.json**: `id` is a string.

```json
[
  { "id": "goblin", "name": "Goblin", "sprite": 2, "maxHealth": 30,
    "attack": 5, "behavior": "aggressive", "experienceValue": 10,
    "itemsToDrop": [{ "itemId": 1, "chance": 0.5, "quantity": 1 }] }
]
```

`behavior`: `aggressive | hostile | neutral | friendly | shopkeeper | guard`.
`width`, `height`, `attackRange` default to one tile (64) if omitted.
`itemsToDrop[].chance` is 0..1, and each entry is an independent roll. For
relative rarity, a bounded number of drops or quantity ranges, use a table from
`loot.json` via `lootTableId` instead.
`lootTableId` and `scriptId` are optional references; see `loot.json` above and
`../scripts/example.js` for behaviors.

**loot.json**: reusable weighted drop tables. Point an NPC at one with
`lootTableId`; it then takes precedence over that NPC's `itemsToDrop`.

```json
[
  { "id": "goblin-tier1", "name": "Goblin (tier 1)",
    "guaranteed": [{ "itemId": 1, "quantity": { "min": 3, "max": 9 } }],
    "rolls": { "min": 1, "max": 2 },
    "entries": [
      { "itemId": 2, "weight": 30 },
      { "itemId": 3, "weight": 5, "quantity": 1 }
    ],
    "emptyWeight": 65 }
]
```

- `guaranteed`: rolled one by one, each with its own `chance` (0..1, default
  1 = always). The quest key, the boss trophy.
- `entries`: a weighted pool drawn `rolls` times (default exactly once).
  `weight` is relative, so adding an item does not mean recomputing the others.
- `emptyWeight`: weight of drawing nothing, competing with the entries. Above,
  a draw is 65/100 nothing, 30/100 item 2, 5/100 item 3.
- `quantity`: a number, or `{ "min": n, "max": m }` rolled per drop. Repeats
  of one item merge into a single stack.

**dialogs.json**: authored conversations. Point an NPC at one with `dialogId`;
the `dialog` module walks it on interact.

```json
[
  { "id": "guard-gate", "name": "Guard - east gate", "start": "gate",
    "nodes": [
      { "id": "gate", "text": "Halt. Have you dealt with the goblins?",
        "choices": [
          { "label": "I have.", "next": "praise", "condition": "goblinSlayer",
            "action": "guardGift" },
          { "label": "Not yet.", "next": "advice" },
          { "label": "Just passing through." }
        ] },
      { "id": "praise", "text": "Then the road is yours." },
      { "id": "advice", "text": "Speak to the Elder by the well." }
    ] }
]
```

- `start`: node the conversation opens on; defaults to the first.
- `choices[].next`: absent ends the conversation, which is how "Goodbye" is
  written. No terminal node to author.
- `condition` / `action`: names a predicate or handler a script registered as
  `dialogCondition.<name>` / `dialogAction.<name>`. Both fail closed: a missing
  or throwing condition hides the choice, and a failing action stops the
  conversation instead of showing a node that thanks the player for nothing.
  Either may take an argument after a colon (`questStart:goblin-hunt`).

**quests.json**: authored quests. The `quest` module advances these from the
hook the objective names, with no script involved.

```json
[
  { "id": "guard-orcs", "name": "Orcs at the gate",
    "description": "Thin out the warband.",
    "objective": { "type": "kill", "npcId": "orc", "count": 3 },
    "reward": { "experience": 150, "items": [{ "itemId": 1, "quantity": 2 }] } }
]
```

- `objective.type`: one of:
  - `kill` (`npcId`, `count`): counts on npcDeath, for the killer.
  - `collect` (`itemId`, `count`): counted from the inventory on pickup, so
    dropping and re-taking the same item does not count twice.
  - `talk` (`npcId`): completes on interact.
  - `reach` (`mapId`, `row`, `col`): completes on stepping onto that tile.
- `reward`: `experience` and `items` are handed over on completion; an item
  that does not fit goes to the player's mailbox rather than nowhere.
  `script` names a handler registered as `questReward.<name>`, run last, for a
  payout the document cannot describe.
- Two ways to offer one: `npc.questId` starts it on interact, or a dialog
  choice with `"action": "questStart:<id>"` lets the player accept or refuse.

**recipes.json**: crafting recipes. The `crafting` module turns these into
items; the exchange is atomic, so a bag with no room refuses the craft instead
of taking the materials.

```json
[
  { "id": "steel-sword", "name": "Steel Sword",
    "inputs": [{ "itemId": 2, "quantity": 1 }, { "itemId": 3, "quantity": 50 }],
    "output": { "itemId": 8, "quantity": 1 } }
]
```

- `inputs`: at least one; a recipe consuming nothing would print items. List
  an item once with the total, not twice: two rows of 2 both fit a stack of 3
  when checked one at a time.
- `condition`: optional, names a predicate registered as
  `recipeCondition.<name>`. Answering false hides the recipe, which is how
  "not learned yet" is written without a skill system. A name no script
  registered hides it too.
- Where players craft: attach the `workbench` behaviour to a tile trigger or an
  npc. No recipe field points at a place, so one bench serves every recipe.

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

Tile fields: `tileIndex` (required), `maskIndex`, `fringeIndex`, `blocked`,
`avoidNpc`, `warp`, `npcSpawn`, `item`, `shop`, `bank`, `door`,
`conditionalBlock`, `triggers`.
`triggers[].action`: `heal | kill | message` (also takes `text`), `sound`
(`file`), `changeSprite` (`spriteId`), `script` (`scriptId`, naming a behavior
a script registered with `attach()`).
