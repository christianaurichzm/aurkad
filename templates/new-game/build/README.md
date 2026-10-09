# Rebuilding new-game's art

`npm run new-game` copies `../game` and then `../orthogonal` or `../isometric`
into the new folder. Those three are what this folder builds; nothing here is
copied into a game.

```sh
cd templates/new-game/build
for view in ortho iso; do
  blender -b --python render.py -- .cache/$view $view 48 all
done
python3 build.py
```

`render.py` draws the KayKit models in Blender, once per view, into `.cache/`
(gitignored); `build.py` cuts what it rendered into the sheets, paints the
ground, lays out the meadow and writes the content. Rendering both views takes
a few minutes; after that, a change to the map, the npcs or the items is only
`python3 build.py`, in seconds. The last argument of `render.py` can be
`props`, `chars` or `items` to redo just that part.

It needs Blender 4.2 or later, Python 3 with a Pillow built with libimagequant
(the atlas and character sheets are saved as 256 colours, a third of the
size), and four KayKit packs by Kay Lousberg (CC0), unzipped side by side
under `KAYKIT` (default `~/Downloads/iso/kaykit`): Forest Nature Pack, Dungeon
Remastered, Character Pack: Adventurers and Character Pack: Skeletons, from
kaylousberg.itch.io.
