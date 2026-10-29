# Modules

Official, optional toolkit features. Each module is a folder here with a
manifest and a server entry, toggled and configured from `game.json`. A game
kept in a folder of its own (`GAME_DIR`) can bring modules in its `modules/`:
they load alongside these, and one with the same id as a bundled module
replaces it.

```
modules/
  guild/
    module.json   # manifest
    server.js     # server entry (runs in the script sandbox)
    client.js     # optional browser entry
```

The bundled modules are below. **Default** is what a game whose `game.json`
does not name a module gets; `new-game` writes one that names them all,
switched off but for dialog, quest and mail, which its starter game needs.
Each is built on the script API and hooks; none of them live in the core.

| Module         | Default | What it does                                                          |
| -------------- | ------- | --------------------------------------------------------------------- |
| `achievements` | off     | Named milestones counted off the engine's hooks                       |
| `archery`      | on      | Press R to shoot an arrow at the enemy you face                       |
| `auction`      | off     | Auction house with escrow; needs MongoDB transactions                 |
| `bank`         | on      | Per-player item storage                                               |
| `crafting`     | on      | Turns authored recipes into items                                     |
| `cutscene`     | off     | Letterboxed captions a script plays at one player                     |
| `daynight`     | off     | Tints the world through a day cycle on the wall clock                 |
| `dialog`       | on      | NPC dialog boxes and the conversations authored in the editor         |
| `equipment`    | on      | Set bonuses on top of core equipment stats                            |
| `guild`        | on      | Guilds, with a panel and a name tag                                   |
| `knockback`    | off     | Pushes the target a tile back on a hit that does not kill             |
| `leaderboard`  | off     | The level board, plus any board a script submits to                   |
| `lighting`     | off     | Darkness over the world with holes where the lights are               |
| `los`          | off     | Line of sight for NPCs, so walls hide players                         |
| `magic`        | on      | Spells with mana and cooldowns, cast from a hotbar                    |
| `mail`         | on      | An item and a note to another player, online or not                   |
| `minimap`      | off     | Corner minimap of the current map                                     |
| `party`        | on      | Groups with invites and shared kill XP                                |
| `pet`          | on      | A follower that fights for you                                        |
| `pk`           | on      | A kill on a PvP map flags you; a flagged player is fair game anywhere |
| `quest`        | on      | Quests with a tracker                                                 |
| `social`       | off     | Friends and ignore lists                                              |
| `status`       | on      | Timed buffs and debuffs                                               |
| `trade`        | on      | Item swaps between online players                                     |
| `weather`      | off     | Rain and snow over the world                                          |

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

- `server`: entry file (JavaScript). Compile TypeScript modules to `.js`.
- `client`: browser entry, served to the game client.
- `enabledByDefault`: loaded unless `game.json` disables it (default `true`).
- `config`: default config, overridable per game.
- `dependencies`: module ids that must load first.

**One of `server` and `client` is required, not both.** A module that only
draws (the `minimap`, the `daynight` tint, the `weather`, the `lighting`
darkness, the `cutscene` frame) declares `client` alone and never enters the
sandbox. Note that `config` reaches the **server** entry only, so a
client-only module keeps its settings as constants in its own file.

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

### Translations (server side)

Same rule as the browser half: the key is the English the module already
writes, so a language with no entry for it answers in that English.

```js
i18n({ pt: { 'Pet dismissed.': 'Bicho dispensado.' } });

reply('Pet dismissed.'); // translated at the funnel
sendMessage(player, 'Pet dismissed.'); // same
reply(t(player, 'Trades: {count}', { count })); // a sentence with a value
```

A command reply and `sendMessage` translate on their own, for the player they
are answering: a handler written in plain English needs no change to be
translatable. `t` is for the sentences that carry a value, which a template
literal would otherwise weld into a string no table can key.

`broadcastMessage` is **not** translated: it is one event fanned out to every
viewer, so there is no single language to write it in. A game that wants a
broadcast in each player's language loops with `sendMessage` instead.

The language is a session fact, sent by the browser on connect and on every
switch, and the same account can be read in two languages on two machines.
A command run from the REPL has no player behind it and reads English.

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
const panel = engine.mount(); // a DOM element this module owns
engine.onServerEvent('guild:update', (g) => {
  panel.innerHTML = render(g);
});
engine.sendServerEvent('guild:request'); // talk back to the server entry
```

`engine`:

- `mount()` → an `HTMLElement` to render into (vanilla DOM, or your own bundle).
- `onServerEvent(channel, handler)` / `sendServerEvent(channel, payload)`:
  the custom-event channels of the server entry (`sendEvent` / `customAction`).
- `ui` → styled helpers matching the core look:
  - `ui.panel({ title?, anchor? })` → `{ body, setTitle, setBody(...nodes), show, hide, remove }`
  - `ui.button(label, onClick)`, `ui.input(placeholder)`, `ui.row(...)`, `ui.column(...)`
  - `ui.Window`: the same window as a React component, see below.
  - `ui.notice(text, { tone?, label?, detail?, ms? })`: a notice over the world,
    painted by `tone` (`primary`, `danger`, `warning`, `highlight`) in the same
    `.notice` a theme restyles; `ui.toast(element, ms?)` shows one you styled.
- `render(node)` / `useT()`: React, see below.
- `getPlayer()` / `usePlayer()`: the local player; the hook re-renders while
  mounted, for a window that shows the bag or the stats.
- `i18n(tables)` / `t(text, params?)`: translations, see below.
- `log` / `warn` / `error`.

```js
const ui = engine.ui;
const panel = ui.panel({ title: 'Guild' });
panel.setBody(ui.input('name'), ui.button('Create', () => engine.sendServerEvent('guild:create', ...)));
```

### React

`setBody` throws the whole body away, so a panel redrawn on every server event
loses whatever the player was typing into it. A module that redraws often can
draw with React instead: the loader hands it `React` next to `engine` (the same
instance as the game's, so hooks work), and the server compiles a
`"client": "client.jsx"` entry on its own, with no bundler. A syntax error comes
back as the file and line, in the server log and in the browser console.

```jsx
const ui = engine.ui;
let guild = null;
let shown = false;

function draw() {
  engine.render(shown && <GuildWindow g={guild} />);
}

function toggle() {
  shown = !shown;
  draw();
}

function GuildWindow({ g }) {
  const t = engine.useT(); // re-renders on a language switch
  const [name, setName] = React.useState('');
  return (
    <ui.Window title={g ? g.name : t('Guild')} onClose={toggle}>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <button className="button-primary" onClick={() => engine.sendServerEvent('guild:create', { name })}>
        {t('Create Guild')}
      </button>
    </ui.Window>
  );
}

ui.actionButton('Guild', toggle, 'g', 'guild');
engine.onServerEvent('guild:update', (g) => {
  guild = g;
  draw();
});
```

The module keeps its state and calls `engine.render` again whenever it changes;
React keeps what did not. `ui.Window` is open while rendered, owns Escape and
Tab like `ui.panel`, and wears the same classes. Plain buttons and inputs take
the stylesheet's look; `className="button-primary"` marks the action a window
leads with and `"button-danger"` one that takes something away, as the core's
windows do. `modules/guild/client.jsx` is a whole module written this way.

### Translations

The key is the English string the module already draws, so a language with no
entry for it renders that English rather than nothing, so a module that ships
one language still reads.

```js
engine.i18n({ pt: { Guild: 'Guilda', 'Leave Guild': 'Sair da guilda' } });

ui.panel({ title: 'Guild' }); // translated by the toolkit
ui.button('Leave Guild', leave); // same
engine.t('{player} left', { player }); // DOM you build yourself, and any value
```

Text handed to the `ui` helpers follows a language switch on its own. A string
built with `engine.t` is translated once, where it is built, so it changes with
the next redraw, which for a panel fed by a server event is the next update.

Item, NPC and spell names are content, not module text: they stay in whatever
language the game was authored in.

The server pushes state on a channel; the client renders it. Because the client
may connect after the first push, have the client request current state on load
(see `guild:request` above).
