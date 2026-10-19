# Gravewatch: the isometric demo

A walled churchyard in a black pine wood, on a map with
`"orientation": "isometric"`: the same square-grid simulation as every other
map, drawn as 2:1 diamonds. One persistent world; the night belongs to the
operator.

```sh
node demos/gravewatch/run.mjs
```

Open **http://localhost:3007**. Register **warden** to get the creator tools,
or any other name to just play. The database is a throwaway
mongodb-memory-server instance (the first run may download MongoDB), so
accounts and edits are gone when the command stops. Server on 8087, client on
3007; no Docker, and no existing game database is touched.

## What to try

- **Walking.** Arrows move along the grid, which on this map is turned 45
  degrees: Up goes northeast, Right southeast, Down southwest, Left northwest.
  Or click (tap, on a phone) where to go: the way round walls, and round
  whoever stands in it, is found for you. Clicking one of the dead beside
  you attacks it; clicking Agathe, Brand or Hobb beside you talks to them;
  farther off, the click walks you up to them first.
- **Occlusion.** Walk behind the crypt, the graves and the pines: whatever
  stands in front of you is drawn over you, and fades when it would hide you.
- **Sister Agathe** at the shrine, **Captain Brand** by the south gate and
  **Hobb** the gravedigger: face them and press **F**. Agathe and Brand hand
  out the two quests; Hobb's plank floor is his shop.
- **The roaming dead** outside the fence: **Ctrl** attacks.
- **The siege.** As warden, in the chat:

  ```
  flag siege true for 10            now, for ten minutes
  flag siege true at 21:00 for 30   tonight at nine
  flag siege clear                  call it off
  ```

  The night goes black, the bell tolls, and every 30 seconds the dead climb
  out of the woods by both gates (more for every player on the map) until
  wave 6 brings the Ossuary Lord. They hunt the whole map. When the flag ends
  the rest crumble and whoever held the churchyard is paid for each wave.
  The numbers are in `modules/gravewatch/module.json`; `flag xpMultiplier 2
  for 60` doubles the experience for the hour.
- **Editing the map.** As warden, press **Z**. The palette is the kit the map
  is built from (grounds, graves, the crypt, the fence, lanterns, the camp,
  the woods), with a tooltip naming each piece. Click a piece, then the map:
  a ground paints cell by cell (**Fill** covers the map with it), an object
  goes down whole and blocks where it should, the fence joins up with the
  fence beside it, and **✕** takes an object away. Clicking again picks
  another variant. Save, and everyone on the map sees it, a lantern you put
  down shining already. The throwaway database forgets it all when the
  command stops.

## Rebuilding the art

Everything in `assets/`, `content/`, `theme/theme.json` and its two pictures,
and `modules/gravewatch/module.json` is written by `build.py`. It renders the
kit in Blender through `render.py` (each piece alone with its shadow, each
ground as a few cells that repeat without a seam), cuts the renders into
per-cell frames, packs the atlas with the piece every frame belongs to, and
lays the map out from the kit. Everything is rendered at twice the size the
engine draws it (`S` in `build.py`), which the theme's smooth art shows at
the screen's own resolution on a large or HiDPI window. The colours in
`theme/theme.json` are the admin Appearance page's to change;
`theme/theme.css` holds the rest of the look.

```sh
python3 demos/gravewatch/build.py           # about 7 minutes, cached after
python3 demos/gravewatch/build.py --draft   # 12 samples, for layout work
```

It needs Python 3 with Pillow, Blender 4.2 or later (`BLENDER`, default
`blender` on the PATH) and four KayKit packs by Kay Lousberg (CC0) under
`KAYKIT` (default `~/Downloads/iso/kaykit`): Halloween Bits, Dungeon
Remastered, Adventurers and Skeletons. Renders are cached in `.cache/` by a
hash of the job and `render.py`. A Pillow with libimagequant saves the two
sheets as 256 colours, a third of the size.
