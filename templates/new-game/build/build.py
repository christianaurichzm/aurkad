"""Builds new-game's template from what render.py leaves in .cache/ (README.md
says how to run both): the sheets and the map of each view, and what every
new game gets whichever it is.

    python3 build.py

    ../game/         game.json's world, the npcs and items, the icons, the
                     effects and the theme
    ../orthogonal/   the atlas, the characters and the map, top-down
    ../isometric/    the same on the 2:1 diamond

The ground is painted here, flat, as textures that wrap: grass and dirt repeat
every PERIOD cells, so any cell of a map takes the frame its position names.
A path and a pond are decals over it, a frame for each set of neighbours they
join. Both views share that art; the diamond is the square sheared. What
stands - trees, rocks, characters - is rendered for each view.
"""
import json
import math
import os
import random
from collections import deque
from functools import lru_cache

from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.cache')
ROOT = os.path.dirname(HERE)
T = 64  # a cell, in the pixels the engine draws
S = 2  # sheet pixels for each of those
C = T * S  # a cell on the sheet
M = 2  # sheet pixels a ground frame carries past its cell, for the next to overlap
PERIOD = 4  # cells a ground texture takes to repeat
W = PERIOD * C
COLS, ROWS = 32, 22


# ─── textures that wrap ──────────────────────────────────────────────────────
def wrapped(img, fn):
    """fn applied to `img` as if it went on forever: run on a 3x3 tiling and
    the middle kept, so a blur reaches across the seam."""
    w, h = img.size
    big = Image.new(img.mode, (3 * w, 3 * h))
    for i in range(3):
        for j in range(3):
            big.paste(img, (i * w, j * h))
    return fn(big).crop((w, h, 2 * w, 2 * h))


def noise(size, blobs, seed):
    """size x size of smooth noise that wraps, `blobs` across: the random grid
    tiled 3x3 before it is scaled up, so the middle copy is smooth at its edges
    the way it is inside."""
    r = random.Random(seed)
    small = Image.new('L', (blobs, blobs))
    small.putdata([r.randrange(256) for _ in range(blobs * blobs)])
    big = Image.new('L', (3 * blobs, 3 * blobs))
    for i in range(3):
        for j in range(3):
            big.paste(small, (i * blobs, j * blobs))
    return big.resize((3 * size, 3 * size), Image.BICUBIC).crop((size, size, 2 * size, 2 * size))


def octaves(size, *specs):
    out = None
    for blobs, seed, weight in specs:
        n = noise(size, blobs, seed)
        out = n if out is None else Image.blend(out, n, weight)
    return out


def stretch(img, lo, hi):
    return img.point(lambda v: max(0, min(255, int((v - lo) * 255 / (hi - lo)))))


def flat(colour, size):
    return Image.new('RGB', (size, size), colour)


def specks(size, blobs, seed, keep, blur):
    n = noise(size, blobs, seed).point(keep)
    return wrapped(n, lambda big: big.filter(ImageFilter.GaussianBlur(blur)))


def grass(size):
    # Yellower, duller and a step darker than the KayKit canopies, so a tree
    # stands out from the meadow instead of melting into it.
    blot = stretch(octaves(size, (size // 256, 1, 0), (size // 128, 2, 0.4), (size // 40, 3, 0.2)), 70, 190)
    out = Image.composite(flat('#90b854', size), flat('#709940', size), blot)
    # Faint and soft: at half size a crisp speck is one bright pixel, and a
    # field of them reads as grain.
    light = specks(size, size // 3, 4, lambda v: 255 if v > 200 else 0, 1.4)
    out = Image.composite(flat('#a2c463', size), out, light.point(lambda v: v // 8))
    dark = specks(size, size // 4, 5, lambda v: 255 if v < 50 else 0, 1.4)
    return Image.composite(flat('#5a8236', size), out, dark.point(lambda v: v // 8))


def dirt(size):
    base = stretch(octaves(size, (size // 30, 7, 0), (size // 8, 8, 0.4)), 80, 180)
    out = Image.composite(flat('#cfa66b', size), flat('#b18752', size), base)
    pebble = specks(size, size // 3, 9, lambda v: 255 if v > 215 else 0, 1.0)
    return Image.composite(flat('#8f6a3e', size), out, pebble.point(lambda v: v // 3))


def water(size):
    # Low in contrast: a decal is the same picture in every cell, and a bold
    # one shows the grid.
    base = stretch(octaves(size, (size // 32, 12, 0), (size // 10, 13, 0.35)), 60, 200)
    out = Image.composite(flat('#3784cc', size), flat('#2f78c2', size), base)
    glint = specks(size, size // 5, 14, lambda v: 255 if v > 232 else 0, 1.2)
    return Image.composite(flat('#8fc8ee', size), out, glint.point(lambda v: v // 6))


def cut(texture, x, y, size):
    """A size x size window of a texture that wraps, from (x, y)."""
    w = texture.width
    x, y = x % w, y % w
    n = -(-(max(x, y) + size) // w)
    tiled = Image.new(texture.mode, (n * w, n * w))
    for i in range(n):
        for j in range(n):
            tiled.paste(texture, (i * w, j * w))
    return tiled.crop((x, y, x + size, y + size))


# ─── decals: one frame for each set of neighbours ────────────────────────────
ARMS = {1: (0.5, -0.5), 2: (1.5, 0.5), 4: (0.5, 1.5), 8: (-0.5, 0.5)}  # up, right, down, left


def segment_distance(px, py, bx, by):
    """From (px, py) to the segment from the cell's middle to (bx, by)."""
    ax, ay = 0.5, 0.5
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


# The corners a cell joins (the editor's CORNER_JOINS): above right, below
# right, below left, above left, each set only with both its sides. The
# quarter of the cell toward one, as a signed distance.
CORNERS = {16: (1 | 2, lambda u, v: max(0.5 - u, v - 0.5)), 32: (2 | 4, lambda u, v: max(0.5 - u, 0.5 - v)),
           64: (4 | 8, lambda u, v: max(u - 0.5, 0.5 - v)), 128: (8 | 1, lambda u, v: max(u - 0.5, v - 0.5))}


def decal_shape(mask, radius, wobble, edge_noise, inward):
    """Signed distance, in cells, to a blob of `radius` round the middle with
    an arm of the same width out through each side `mask` joins, for every
    pixel of a frame that carries M past the cell. The wobble wraps per cell,
    so where two frames meet their edges meet too. A corner `mask` joins is
    filled out to the corner: four cells of water meet there, and the arms
    alone leave a hole where their rounded ends do."""
    size = C + 2 * M
    data = []
    nd = edge_noise.load()
    for y in range(size):
        v = (y - M) / C
        for x in range(size):
            u = (x - M) / C
            d = math.hypot(u - 0.5, v - 0.5)
            for bit, (bx, by) in ARMS.items():
                if mask & bit:
                    d = min(d, segment_distance(u, v, bx, by))
            d -= radius
            for bit, (_, quarter) in CORNERS.items():
                if mask & bit:
                    d = min(d, quarter(u, v))
            n = nd[(x - M) % C, (y - M) % C] / 255
            d += wobble * (n if inward else (n - 0.5) * 2)
            data.append(d)
    return data


def smooth(d, width):
    """1 inside, 0 outside, across `width` cells at the edge."""
    return max(0.0, min(1.0, 0.5 - d / width))


def alpha(values):
    img = Image.new('L', (C + 2 * M, C + 2 * M))
    img.putdata([round(255 * a) for a in values])
    return img


def path_frames():
    fill = dirt(C)
    rim_colour = flat('#547830', C + 2 * M).convert('RGBA')
    wobble = noise(C, 6, 21)
    frames = {}
    for mask in range(16):
        d = decal_shape(mask, 0.34, 0.05, wobble, inward=False)
        inside = alpha([smooth(v, 0.04) for v in d])
        rim = alpha([0.45 * smooth(v - 0.09, 0.06) * (1 - smooth(v, 0.02)) for v in d])
        frame = Image.new('RGBA', (C + 2 * M, C + 2 * M))
        rim_colour.putalpha(rim)
        frame.alpha_composite(rim_colour)
        dirt_layer = cut(fill, -M, -M, C + 2 * M).convert('RGBA')
        dirt_layer.putalpha(inside)
        frame.alpha_composite(dirt_layer)
        frames[mask] = frame
    return frames


def pond_frames():
    fill = water(C)
    sand = flat('#d8c48c', C + 2 * M).convert('RGBA')
    wobble = noise(C, 5, 22)
    frames = {}
    for mask in range(256):
        if any(mask & bit and mask & sides != sides for bit, (sides, _) in CORNERS.items()):
            continue
        # Half a cell round: a side it joins is water edge to edge.
        d = decal_shape(mask, 0.5, 0.12, wobble, inward=True)
        frame = Image.new('RGBA', (C + 2 * M, C + 2 * M))
        sand.putalpha(alpha([smooth(v, 0.03) for v in d]))
        frame.alpha_composite(sand)
        deep = cut(fill, -M, -M, C + 2 * M).convert('RGBA')
        deep.putalpha(alpha([smooth(v + 0.07, 0.05) for v in d]))
        frame.alpha_composite(deep)
        frames[mask] = frame
    return frames


# ─── projection ──────────────────────────────────────────────────────────────
def to_diamond(square):
    """A square ground frame, M past its cell all round, sheared onto the 2:1
    diamond the engine draws an isometric cell as, with its anchor."""
    w, h = C + 2 * M, C // 2 + M
    out = square.transform((w, h), Image.AFFINE, (1, 2, -C / 2 - M, -1, 2, C / 2 + M), Image.BICUBIC)
    return out, (C / 2 + M, C / 4 + M / 2)


# ─── props ───────────────────────────────────────────────────────────────────
SHADOW = '#18301f'
SHADOW_ALPHA = 140


def prop_frame(view, name, foot):
    obj = Image.open(f'{CACHE}/{view}/props/{name}_object.png').convert('RGBA')
    shadow = Image.open(f'{CACHE}/{view}/props/{name}_shadow.png').convert('RGBA')
    fx, fy = foot
    # A frame may hang at most 512 px from its foot: a tall tree's shadow
    # fades out before it gets there instead of ending on a straight edge.
    fade = Image.new('L', shadow.size, 0)
    draw = ImageDraw.Draw(fade)
    for rad in range(480, 340, -2):
        draw.ellipse((fx - rad, fy - rad, fx + rad, fy + rad), fill=round(255 * (480 - rad) / 140))
    draw.ellipse((fx - 340, fy - 340, fx + 340, fy + 340), fill=255)
    # Blender leaves a veil of shadow far around the prop, too faint to see on
    # grass but wide enough to double the frame, and a frame's box is what the
    # see-through fade tests against the player. Only what is darker is shadow.
    # Tinted and kept under the client's SOLID_ALPHA, which marks the prop
    # itself; a black shadow at full strength reads as a hole in the grass.
    a = shadow.getchannel('A').point(lambda v: 0 if v < 20 else round((v - 20) * SHADOW_ALPHA / 235))
    a = ImageChops.multiply(a, fade).filter(ImageFilter.GaussianBlur(2))
    shadow = Image.new('RGBA', shadow.size, SHADOW)
    shadow.putalpha(a)
    img = Image.alpha_composite(shadow, sharpened(obj))
    box = img.getchannel('A').point(lambda v: 255 if v > 3 else 0).getbbox()
    return img.crop(box), (fx - box[0], fy - box[1])


PROPS = {  # piece name: (group, renders, blocks)
    'tree': ('Forest', ['tree_a', 'tree_b', 'tree_c', 'tree_d', 'tree_e', 'tree_f'], True),
    'bush': ('Forest', ['bush_a', 'bush_b', 'bush_c'], True),
    'rock': ('Forest', ['rock_a', 'rock_b', 'rock_c'], True),
    'tall grass': ('Forest', ['grass_a', 'grass_b', 'grass_c'], False),
    'barrel': ('Camp', ['barrel'], True),
    'crates': ('Camp', ['crates'], True),
}


# ─── the atlas ───────────────────────────────────────────────────────────────
class Atlas:
    def __init__(self):
        self.frames = []  # (id, image, anchor in sheet pixels, piece)

    def add(self, img, anchor, piece):
        fid = len(self.frames) + 1
        self.frames.append((fid, img, anchor, piece))
        return fid

    def save(self, folder, width=2048):
        # Shelves, tallest first. Pixel (0, 0) stays clear, or the client takes
        # its colour for a key and makes every pixel of it transparent.
        x, y, shelf, placed = 4, 0, 0, {}
        for fid, img, _, _ in sorted(self.frames, key=lambda f: -f[1].height):
            if x + img.width > width:
                x, y, shelf = 0, y + shelf, 0
            placed[fid] = (x, y)
            x += img.width
            shelf = max(shelf, img.height)
        sheet = Image.new('RGBA', (width, y + shelf))
        meta = {}
        for fid, img, (ax, ay), piece in self.frames:
            px, py = placed[fid]
            sheet.paste(img, (px, py))
            meta[str(fid)] = {'x': px, 'y': py, 'width': img.width, 'height': img.height,
                              'drawWidth': img.width / S, 'drawHeight': img.height / S,
                              'anchorX': ax / S, 'anchorY': ay / S, 'piece': piece}
        save_png(sheet, f'{folder}/assets/tiles.png')
        write_json(f'{folder}/assets/tiles.json', meta)


def sharpened(img):
    """Blender's filter softens edges that the client halves again on screen."""
    out = img.convert('RGB').filter(ImageFilter.UnsharpMask(radius=1.6, percent=60, threshold=2)).convert('RGBA')
    out.putalpha(img.getchannel('A'))
    return out


def save_png(img, path):
    # Full colour, at several times the bytes: a 256-colour palette dithers
    # every shaded surface into grain and every soft edge into a jagged one.
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)


def write_json(path, value, indent=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(value, f, indent=indent)
        f.write('\n')


def piece(name, group, layer='object', at=(0, 0), variant=0, blocks=False, connect=None):
    p = {'name': name, 'group': group, 'layer': layer, 'at': list(at), 'variant': variant, 'blocks': blocks}
    if connect is not None:
        p['connect'] = connect
    return p


def build_kit(view):
    """Every frame of `view`'s atlas, and the ids the map is laid out with."""
    atlas = Atlas()
    ids = {}
    flat_frame = (lambda img: (img, (C / 2 + M, C / 2 + M))) if view == 'ortho' else to_diamond

    for name, texture in [('grass', grass(W)), ('dirt', dirt(W))]:
        for r in range(PERIOD):
            for c in range(PERIOD):
                img, anchor = flat_frame(cut(texture, c * C - M, r * C - M, C + 2 * M).convert('RGBA'))
                ids[name, c, r] = atlas.add(img, anchor, piece(name, 'Ground', 'ground', (c, r)))

    for name, frames, blocks in [('path', path_frames(), False), ('pond', pond_frames(), True)]:
        for mask, square in frames.items():
            img, anchor = flat_frame(square)
            ids[name, mask] = atlas.add(img, anchor, piece(name, 'Paths and water', 'decal',
                                                           blocks=blocks, connect=mask))

    feet = json.load(open(f'{CACHE}/{view}/props.json'))
    for name, (group, renders, blocks) in PROPS.items():
        ids[name] = []
        for variant, render in enumerate(renders):
            img, anchor = prop_frame(view, render, feet[render])
            ids[name].append(atlas.add(img, anchor, piece(name, group, variant=variant, blocks=blocks)))
    return atlas, ids


# ─── the map ─────────────────────────────────────────────────────────────────
# The path crosses from the lower left to the upper right through the middle,
# where a new player comes in; the pond is up in the quiet corner. It runs
# along rows and columns and bends in a few cells: a slant on a grid of cells
# is a staircase.
PATH = [(-4, 16), (0, 16), (5, 16), (8, 15.3), (9.3, 13.3), (10.5, 11.2), (13, 11), (19, 11), (21, 10.2),
        (21.8, 8), (23, 6.2), (26, 6), (31, 6), (35, 6)]
POND = (6.5, 5.5, 3.2, 2.3)  # centre column and row, half width and height
RESPAWN = (15, 11)
# The dead wander the meadow, alone or near one another. A hostile npc strays
# 3 tiles from its spawn and notices a player 4 from there, so each spawn is
# further than 7 from the respawn: the camp is somewhere to stand and read the
# screen. The bone knight comes at a player from 8, so it is roped to the far
# corner, and a player who has just died walks back into the camp, not into it.
SPAWNS = {'skeleton': [(23, 3), (24, 15), (25, 10), (6, 13)], 'bone-knight': [(26, 4)],
          'skeleton-rogue': [(5, 18), (27, 17)], 'skeleton-mage': [(11, 3), (23, 18)],
          'mage': [(13, 10)], 'barbarian': [(17, 9)], 'hunter': [(10, 8)]}
CAMP = [('barrel', 12, 10), ('crates', 13, 9)]
GROVES, CLUMPS = 10, 10


def path_cells():
    pts = [(c + 0.5, r + 0.5) for c, r in PATH]
    curve = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1:i + 3]
        for k in range(48):
            t = k / 48
            curve.append(tuple(0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t
                                      + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t ** 3) for j in (0, 1)))
    cells = []
    for x, y in curve:
        cell = (math.floor(x), math.floor(y))
        if cells and cell == cells[-1]:
            continue
        # A diagonal step goes round the side, so the path joins edge to edge.
        if cells and abs(cell[0] - cells[-1][0]) + abs(cell[1] - cells[-1][1]) == 2:
            cells.append((cell[0], cells[-1][1]))
        cells.append(cell)
    return {c for c in cells if 0 <= c[0] < COLS and 0 <= c[1] < ROWS}


def joins(cells, c, r, corners=False):
    """The neighbours of (c, r) in `cells`, as the editor's rejoin counts them."""
    mask = sum(bit for bit, (dc, dr) in [(1, (0, -1)), (2, (1, 0)), (4, (0, 1)), (8, (-1, 0))]
               if (c + dc, r + dr) in cells)
    if corners:
        for bit, (dc, dr) in [(16, (1, -1)), (32, (1, 1)), (64, (-1, 1)), (128, (-1, -1))]:
            if mask & CORNERS[bit][0] == CORNERS[bit][0] and (c + dc, r + dr) in cells:
                mask |= bit
    return mask


def lay_out(ids):
    rnd = random.Random(11)  # the same meadow in both views
    tiles = [[{'tileIndex': ids['grass', c % PERIOD, r % PERIOD]} for c in range(COLS)] for r in range(ROWS)]
    path = path_cells()
    pc, pr, rx, ry = POND
    pond = {(c, r) for r in range(ROWS) for c in range(COLS)
            if ((c + 0.5 - pc) / rx) ** 2 + ((r + 0.5 - pr) / ry) ** 2 <= 1}
    assert not path & pond and RESPAWN in path

    def put(c, r, name, blocks):
        tiles[r][c]['maskIndex'] = rnd.choice(ids[name])
        if blocks:
            tiles[r][c]['blocked'] = True

    for (c, r) in path:
        tiles[r][c]['maskIndex'] = ids['path', joins(path, c, r)]
    for (c, r) in pond:
        tiles[r][c]['maskIndex'] = ids['pond', joins(pond, c, r, corners=True)]
        tiles[r][c]['blocked'] = True
    taken = path | pond | {(c, r) for cells in SPAWNS.values() for c, r in cells}
    taken |= {(c, r) for _, c, r in CAMP}
    assert not (taken - path - pond) & (path | pond), 'an npc or the camp on the path or the pond'
    for npc in NPCS:
        for c, r in SPAWNS.get(npc['id'], []) if npc['behavior'] == 'hostile' else []:
            assert max(abs(c - RESPAWN[0]), abs(r - RESPAWN[1])) > 7, f"{npc['id']} {(c, r)} reaches the camp"
    near_spawn = lambda c, r: abs(c - RESPAWN[0]) <= 2 and abs(r - RESPAWN[1]) <= 2
    border = lambda c, r: c < 2 or r < 2 or c >= COLS - 2 or r >= ROWS - 2

    # The forest round the edge: a tree every other cell, bushes between.
    for r in range(ROWS):
        for c in range(COLS):
            if not border(c, r):
                continue
            tiles[r][c]['blocked'] = True
            if (c, r) in path:
                continue
            if (c + r) % 2 == 0:
                put(c, r, 'tree', True)
            elif rnd.random() < 0.5:
                put(c, r, 'bush', True)
    # Inside, trees stand in groves and grass in clumps: a wood reads as one,
    # and the meadow between stays open to walk and fight in. Every npc keeps
    # the cells round its spawn.
    around = {(c + dc, r + dr) for c, r in taken - path - pond for dc in (-1, 0, 1) for dr in (-1, 0, 1)}
    free = lambda c, r: not border(c, r) and (c, r) not in taken | around and not near_spawn(c, r) \
        and 'maskIndex' not in tiles[r][c]
    for _ in range(GROVES):
        gc, gr = rnd.uniform(3, COLS - 3), rnd.uniform(3, ROWS - 3)
        while not free(int(gc), int(gr)):
            gc, gr = rnd.uniform(3, COLS - 3), rnd.uniform(3, ROWS - 3)
        size = rnd.uniform(1.6, 2.8)
        for r in range(ROWS):
            for c in range(COLS):
                d = math.hypot(c + 0.5 - gc, r + 0.5 - gr) / size + rnd.uniform(-0.2, 0.2)
                if d > 1.8 or not free(c, r):
                    continue
                if d < 0.8 and (c + r) % 2 == 0:
                    put(c, r, 'tree', True)
                elif d < 1.0 and rnd.random() < 0.6:
                    put(c, r, 'bush', True)
                elif d > 1.0 and rnd.random() < 0.45:
                    put(c, r, 'tall grass', False)
    for _ in range(CLUMPS):
        gc, gr = rnd.uniform(2, COLS - 2), rnd.uniform(2, ROWS - 2)
        for r in range(ROWS):
            for c in range(COLS):
                if math.hypot(c + 0.5 - gc, r + 0.5 - gr) < 1.6 and free(c, r) and rnd.random() < 0.6:
                    put(c, r, 'tall grass', False)
    for r in range(ROWS):
        for c in range(COLS):
            if free(c, r) and rnd.random() < 0.025:
                put(c, r, 'rock', True)
    for name, c, r in CAMP:
        put(c, r, name, True)
    for npc, cells in SPAWNS.items():
        for c, r in cells:
            tiles[r][c]['npcSpawn'] = npc

    # Every npc can be reached from where a player comes in.
    seen, todo = set(), deque([RESPAWN])
    while todo:
        c, r = todo.popleft()
        if (c, r) in seen or not (0 <= c < COLS and 0 <= r < ROWS) or tiles[r][c].get('blocked'):
            continue
        seen.add((c, r))
        todo.extend([(c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1)])
    for cells in SPAWNS.values():
        for p in cells:
            assert p in seen, f'spawn {p} walled in'
    return tiles


# ─── characters ──────────────────────────────────────────────────────────────
CHARACTERS = ['knight', 'mage', 'rogue', 'skeleton', 'bone_knight', 'barbarian', 'hunter', 'skeleton_rogue',
              'skeleton_mage']  # sprite ids; 0 is every new player
SPRITE = {name: i for i, name in enumerate(CHARACTERS)}
PER_ROW = 3


def ease(lo, hi, v):
    t = min(1.0, max(0.0, (v - lo) / (hi - lo)))
    return t * t * (3 - 2 * t)


def character_frame(path, f):
    """A character as rendered, with its shadow kept inside the frame.

    The shadow comes out of the same render as the body, so only darkness tells
    them apart: the shadow is pure black, and even the ink line round the body,
    or a crossbow's dark limbs, are well above it. Blender's veil of shadow covers the whole frame and reads as a
    box on grass, and the shadow falling to the lower right reaches the frame's
    edge and ends there on a straight line: the faintest alpha goes, and what is
    dark fades out over the last cells before the edge.
    """
    r, g, b, a = Image.open(path).convert('RGBA').split()
    a = a.point([round(v * ease(6, 28, v)) for v in range(256)])
    dark = ImageChops.lighter(r, ImageChops.lighter(g, b)).point([round(255 * (1 - ease(2, 12, v))) for v in range(256)])
    a = ImageChops.multiply(a, ImageChops.invert(ImageChops.multiply(dark, ImageChops.invert(inside_frame(f)))))
    return sharpened(Image.merge('RGBA', (r, g, b, a)))


@lru_cache(maxsize=None)
def inside_frame(f):
    """255 in the frame, falling to 0 at its edges: slowly at the sides, where a
    shadow runs long and a short fade still ends on a visible line."""
    side, top, bottom = f * 2 // 5, f // 8, f // 5
    img = Image.new('L', (f, f))
    img.putdata([round(255 * min(ease(0, side, x), ease(0, side, f - 1 - x), ease(0, top, y), ease(0, bottom, f - 1 - y)))
                 for y in range(f) for x in range(f)])
    return img


def character_sheet(view):
    # The client stacks every sheet into one canvas, and iOS draws none over
    # 16.7 megapixels: the orthogonal frames are rendered at 288 and shrunk
    # to 252, and drawn that much larger, so they cover the same ground.
    f, cell = (288, 252) if view == 'ortho' else (256, 256)
    sheet = Image.new('RGBA', (PER_ROW * 6 * cell, -(-len(CHARACTERS) // PER_ROW) * 4 * cell))
    for i, name in enumerate(CHARACTERS):
        bx, by = (i % PER_ROW) * 6 * cell, (i // PER_ROW) * 4 * cell
        for d in range(4):
            cells = [('walk', k) for k in range(4)] + [('idle', 0), ('attack', 0)]
            for col, (anim, k) in enumerate(cells):
                im = character_frame(f'{CACHE}/{view}/chars/{name}/{anim}_{d}_{k}.png', f)
                if cell != f:
                    im = im.resize((cell, cell), Image.LANCZOS)
                sheet.alpha_composite(im, (bx + col * cell, by + d * cell))
    # The foot is on the cell's middle, which on an orthogonal map is half a
    # cell above the bottom of the box the client places a character by.
    foot = (144, 224 + C // 2) if view == 'ortho' else (128, 212)
    layout = {'width': cell, 'height': cell, 'anchorX': foot[0] * cell // f, 'anchorY': foot[1] * cell // f,
              'scale': f / cell / S, 'columns': 6, 'idleColumn': 4, 'attackColumn': 5}
    return sheet, layout


# ─── items and effects ───────────────────────────────────────────────────────
ICONS = ['potion', 'coin', 'sword', 'helmet', 'cider']
ICON = {name: i for i, name in enumerate(ICONS)}
ITEM_SIZE = 64


def item_sheet():
    sheet = Image.new('RGBA', (len(ICONS) * ITEM_SIZE, ITEM_SIZE))
    for i, name in enumerate(ICONS):
        im = Image.open(f'{CACHE}/ortho/items/{name}.png').convert('RGBA')
        sheet.alpha_composite(im.resize((ITEM_SIZE, ITEM_SIZE), Image.LANCZOS), (i * ITEM_SIZE, 0))
    return sheet


SS = 4  # effects are drawn this much larger and brought down, for soft edges


def ring(draw, cx, cy, r, thickness, colour, start=0, end=360):
    box = [(cx - r) * SS, (cy - r) * SS, (cx + r) * SS, (cy + r) * SS]
    draw.arc(box, start, end, fill=colour, width=round(thickness * SS))


def disc(draw, cx, cy, r, colour):
    draw.ellipse([(cx - r) * SS, (cy - r) * SS, (cx + r) * SS, (cy + r) * SS], fill=colour)


def shrink(img):
    return img.resize((img.width // SS, img.height // SS), Image.LANCZOS)


def lighter(hex_colour, f):
    return tuple(min(255, round(int(hex_colour[i:i + 2], 16) * f)) for i in (1, 3, 5))


def spell_sheet():
    """Four-frame bursts, 32 px, two spells to a row: fire 0, ice 4, heal 8,
    shock 12 (the client's grid, spellEffect.ts)."""
    img = Image.new('RGBA', (8 * 32 * SS, 2 * 32 * SS))
    draw = ImageDraw.Draw(img)
    for s, colour in enumerate(['#f07020', '#60c0f0', '#60e070', '#f0e040']):
        rgb = lighter(colour, 1)
        for f in range(4):
            i = s * 4 + f
            cx, cy = (i % 8) * 32 + 16, (i // 8) * 32 + 16
            if f == 0:
                disc(draw, cx, cy, 5, rgb + (255,))
                disc(draw, cx, cy, 2, (255, 255, 255, 255))
            elif f == 1:
                disc(draw, cx, cy, 9, rgb + (220,))
                disc(draw, cx, cy, 4, lighter(colour, 1.4) + (255,))
            elif f == 2:
                ring(draw, cx, cy, 13, 4, rgb + (200,))
            else:
                ring(draw, cx, cy, 15, 2, rgb + (110,))
    return shrink(img)


def arrow_sheet():
    """One arrow per 32 px cell, in the order the client reads them: down,
    up, right, left (projectiles.ts)."""
    img = Image.new('RGBA', (4 * 32 * SS, 32 * SS))
    draw = ImageDraw.Draw(img)
    for i, (dx, dy) in enumerate([(0, 1), (0, -1), (1, 0), (-1, 0)]):
        def at(t, s):  # t along the shaft, s across it
            return ((i * 32 + 16 + t * dx - s * dy) * SS, (16 + t * dy + s * dx) * SS)
        draw.line([at(-12, 0), at(7, 0)], fill=(138, 90, 42, 255), width=2 * SS)
        draw.polygon([at(13, 0), at(6, -3.5), at(6, 3.5)], fill=(200, 206, 214, 255))
        for side in (-1, 1):
            draw.polygon([at(-13, 0), at(-9, 0), at(-10, 3.5 * side), at(-14, 3.5 * side)],
                         fill=(208, 64, 64, 255))
    return shrink(img)


def attack_sheet():
    """Six frames of a swing drawn a tile ahead of the attacker
    (attackEffect.ts)."""
    img = Image.new('RGBA', (6 * T * SS, T * SS))
    draw = ImageDraw.Draw(img)
    for f, (span, a) in enumerate(zip([50, 100, 140, 140, 140, 140], [255, 255, 255, 200, 130, 60])):
        cx = f * T + 32
        ring(draw, cx, 40, 24, 5, (255, 255, 255, a), 200, 200 + span)
        ring(draw, cx, 40, 19, 2, (160, 208, 255, a), 200, 200 + span)
    return shrink(img)


ITEMS = [
    {'id': 1, 'name': 'Health Potion', 'description': 'A red draught that closes wounds.',
     'sprite': ICON['potion'], 'type': 'consumable',
     'effects': [{'attribute': 'health', 'type': 'add', 'value': 30}]},
    {'id': 2, 'name': 'Gold Coin', 'description': 'Currency.', 'sprite': ICON['coin'], 'type': 'money'},
    {'id': 3, 'name': 'Short Sword', 'description': 'Light and quick to draw.', 'sprite': ICON['sword'],
     'type': 'weapon', 'effects': [{'attribute': 'attack', 'type': 'add', 'value': 3}]},
    {'id': 4, 'name': 'Iron Helmet', 'description': 'A solid iron helmet.', 'sprite': ICON['helmet'],
     'type': 'helmet', 'effects': [{'attribute': 'defense', 'type': 'add', 'value': 2}]},
    {'id': 5, 'name': 'Mug of Cider', 'description': 'Sweet, cold and good for a scrape.',
     'sprite': ICON['cider'], 'type': 'consumable',
     'effects': [{'attribute': 'health', 'type': 'add', 'value': 10}]},
]

NPCS = [
    {'id': 'skeleton', 'name': 'Skeleton', 'sprite': SPRITE['skeleton'], 'maxHealth': 20, 'attack': 2,
     'behavior': 'hostile', 'experienceValue': 10,
     'itemsToDrop': [{'itemId': 2, 'chance': 0.8, 'quantity': 3}, {'itemId': 1, 'chance': 0.2, 'quantity': 1},
                     {'itemId': 5, 'chance': 0.2, 'quantity': 1}]},
    {'id': 'bone-knight', 'name': 'Bone Knight', 'sprite': SPRITE['bone_knight'], 'maxHealth': 60, 'attack': 8,
     'behavior': 'aggressive', 'leash': 5, 'experienceValue': 40,
     'itemsToDrop': [{'itemId': 2, 'chance': 1, 'quantity': 8}, {'itemId': 3, 'chance': 0.15, 'quantity': 1},
                     {'itemId': 4, 'chance': 0.2, 'quantity': 1}]},
    {'id': 'skeleton-rogue', 'name': 'Skeleton Rogue', 'sprite': SPRITE['skeleton_rogue'], 'maxHealth': 14,
     'attack': 3, 'behavior': 'hostile', 'moveIntervalMs': 600, 'experienceValue': 12,
     'itemsToDrop': [{'itemId': 2, 'chance': 0.8, 'quantity': 4}, {'itemId': 1, 'chance': 0.15, 'quantity': 1}]},
    {'id': 'skeleton-mage', 'name': 'Skeleton Mage', 'sprite': SPRITE['skeleton_mage'], 'maxHealth': 16,
     'attack': 3, 'attackRange': 3 * T, 'behavior': 'hostile', 'experienceValue': 15,
     'itemsToDrop': [{'itemId': 2, 'chance': 0.8, 'quantity': 4}, {'itemId': 1, 'chance': 0.3, 'quantity': 1}]},
    {'id': 'mage', 'name': 'Mage', 'sprite': SPRITE['mage'], 'maxHealth': 50, 'attack': 0,
     'behavior': 'friendly'},
    {'id': 'barbarian', 'name': 'Barbarian', 'sprite': SPRITE['barbarian'], 'maxHealth': 80, 'attack': 0,
     'behavior': 'guard'},
    {'id': 'hunter', 'name': 'Hunter', 'sprite': SPRITE['hunter'], 'maxHealth': 30, 'attack': 0,
     'behavior': 'friendly'},
]


def main():
    shared = os.path.join(ROOT, 'game')
    # scripts/example.js talks through dialog and hands out a quest, and quest
    # mails a reward the bag has no room for, which only mail lets a player
    # collect.
    write_json(f'{shared}/game.json',
               {'world': {'startMapId': '1', 'respawnTile': {'col': RESPAWN[0], 'row': RESPAWN[1]}},
                'modules': {'dialog': {'enabled': True}, 'mail': {'enabled': True},
                            'quest': {'enabled': True}}}, 2)
    write_json(f'{shared}/content/npcs.json', NPCS, 2)
    write_json(f'{shared}/content/items.json', ITEMS, 2)
    write_json(f'{shared}/theme/theme.json', {'art': 'smooth'}, 2)
    save_png(item_sheet(), f'{shared}/assets/items.png')
    save_png(spell_sheet(), f'{shared}/assets/spells.png')
    save_png(arrow_sheet(), f'{shared}/assets/arrows.png')
    save_png(attack_sheet(), f'{shared}/assets/attackeffect.png')

    for view, folder, orientation in [('ortho', 'orthogonal', 'orthogonal'), ('iso', 'isometric', 'isometric')]:
        out = os.path.join(ROOT, folder)
        atlas, ids = build_kit(view)
        atlas.save(out)
        tiles = lay_out(ids)
        write_json(f'{out}/content/maps.json',
                   [{'id': '1', 'name': 'Meadow', 'type': 'normal', 'orientation': orientation, 'tiles': tiles}])
        sheet, layout = character_sheet(view)
        save_png(sheet, f'{out}/assets/sprites.png')
        write_json(f'{out}/assets/sprites.json', layout, 2)
        print(view, len(atlas.frames), 'frames')


if __name__ == '__main__':
    main()
