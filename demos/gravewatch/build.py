#!/usr/bin/env python3
"""Gravewatch: a walled churchyard on an isometric map, and the night the dead
come for it.

Everything you see is KayKit (Kay Lousberg, CC0) - the Halloween Bits,
Dungeon Remastered, Adventurers and Skeletons packs - rendered by Blender
through render.py at the engine's own projection and twice its resolution
(S), then cut up here:

  * the map is laid out from a kit, and the kit is what gets rendered: each
    piece alone with its shadow, cut into one frame per cell it stands on
    (what lets the engine sort a wall or a tree with the actors walking
    round it), each ground a few cells that repeat without a seam. tiles.json
    says which piece every frame belongs to, so the map editor's palette
    offers graves, fences and trees to put down rather than the atlas in
    pieces, and the map can be changed in the game and saved.
  * each character is rendered in the four diagonal facings an isometric map
    walks in: four walk frames, an idle and an attack.
  * items are rendered as icons.

    python3 demos/gravewatch/build.py [--draft] [--preview out.png]

Needs Python 3 with Pillow, Blender 4.2 or later (BLENDER, default `blender`
on the PATH) and the four packs unzipped under KAYKIT (default
~/Downloads/iso/kaykit). Renders are cached in .cache/ by what they were asked
for, so a second run that changed only content takes seconds. `--draft`
renders with few samples, for trying a layout.
"""
import hashlib
import io
import json
import math
import os
import random
import shutil
import subprocess
import sys
from array import array

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps, features

HERE = os.path.dirname(os.path.abspath(__file__))
KAYKIT = os.path.expanduser(os.environ.get('KAYKIT', '~/Downloads/iso/kaykit'))
BLENDER = os.environ.get('BLENDER') or shutil.which('blender') or os.path.expanduser(
    '~/.local/opt/blender-5.2.2-linux-x64/blender')
CACHE = os.path.join(HERE, '.cache')
DRAFT = '--draft' in sys.argv

T = 64
# Pixels rendered per pixel the engine draws: the frames say their size in
# the engine's pixels, and the theme's smooth art draws them at the screen's
# resolution, so a large or HiDPI window still gets a pixel per pixel.
S = 2
A = T * S  # a cell's width in the renders
COLS = ROWS = 40
ATLAS_W = 2048
OVERHANG = 512  # MAX_ISOMETRIC_OVERHANG in src/shared/constants.ts

rng = random.Random(1347)


def pack(name, kind):
    folder = {
        'halloween': 'KayKit-Halloween-Bits-1.0-main/addons/kaykit_halloween_bits/Assets/gltf',
        'dungeon': 'KayKit-Dungeon-Remastered-1.0-main/addons/kaykit_dungeon_remastered/Assets/gltf',
        'heroes': 'KayKit-Character-Pack-Adventures-1.0-main/addons/kaykit_character_pack_adventures',
        'skeletons': 'KayKit-Character-Pack-Skeletons-1.0-main/addons/kaykit_character_pack_skeletons',
    }[kind]
    path = os.path.join(KAYKIT, folder, name)
    if not os.path.exists(path):
        sys.exit(f'{path} not found: unzip the KayKit packs under KAYKIT ({KAYKIT}).')
    return path


H = lambda n: pack(f'{n}.gltf', 'halloween')
D = lambda n: pack(f'{n}.gltf.glb', 'dungeon')


def blender(name, items, samples):
    """Run render.py on a job, unless this exact job has run before."""
    job = {'items': items, 'samples': samples, 'light': LIGHT, 'scale': S}
    with open(os.path.join(HERE, 'render.py'), 'rb') as f:
        key = hashlib.sha1(json.dumps(job, sort_keys=True).encode() + f.read()).hexdigest()[:12]
    out = os.path.join(CACHE, f'{name}-{key}')
    if os.path.exists(os.path.join(out, 'done')):
        return out
    os.makedirs(out, exist_ok=True)
    job['out'] = out
    with open(os.path.join(out, 'job.json'), 'w') as f:
        json.dump(job, f)
    print(f'rendering {name} ({len(items)} items)...', flush=True)
    run = subprocess.run([BLENDER, '-b', '--python', os.path.join(HERE, 'render.py'), '--',
                          os.path.join(out, 'job.json')], capture_output=True, text=True)
    if run.returncode or 'Traceback' in run.stdout + run.stderr:
        sys.exit(f'blender failed on {name}:\n{run.stdout[-3000:]}\n{run.stderr[-3000:]}')
    open(os.path.join(out, 'done'), 'w').close()
    return out


# Moonlight: a cold key light and a dim violet sky, the same for every render.
# A figure gets the moon stronger and a warm fill from the front, the lamps'
# light: it stands in their pools, and lit by the moon alone it would be a
# dark shape against them.
LIGHT = {'sun': 3.4, 'sun_colour': '#bcc8ff', 'sky': '#474a6e', 'sky_strength': 0.8, 'figure_boost': 2.2,
         'figure_fill': [3.5, '#ffa860']}
LAMP = '#ffa04a'


# ─── the kit ─────────────────────────────────────────────────────────────────
# The pieces the map is laid out from, in the order the map editor's palette
# shows them. A ground repeats with the map; an object goes down whole, each
# of its cells a frame that sorts with the actors; the fence is joined, the
# frame on a cell being the one for whichever cells around it are fence too.
# A piece's variants are what a click in the editor picks among.
PINE_TINT = {'hue': 0.84, 'saturation': 0.5, 'value': 0.4}


def world(c, r, z=0.0):
    """Blender coordinates of a (fractional) cell's centre."""
    return [2 * c + 1, -(2 * r + 1), z]


def put(model, cell=(0, 0), turn=0, scale=1, off=(0, 0), tint=None, lamp=None, lamp_off=(0, 0), inside=None,
        own=True):
    """A model on a cell of its piece. `own`: all of it is that cell's, else
    it is cut by the cell under each of its points. `lamp`: a flame's height
    and strength, `lamp_off` cells from where the model stands. `inside`: the
    same for a light with no flame, behind a door or a window, which only the
    lamp's rendered light has (render_lights)."""
    c, r = cell[0] + off[0], cell[1] + off[1]
    p = {'name': os.path.basename(model).split('.')[0], 'model': model, 'at': world(c, r), 'turn': turn,
         'scale': scale}
    if tint:
        p['tint'] = tint
    if own:
        p['cell'] = list(cell)
    if lamp:
        p['lights'] = [{'at': world(c + lamp_off[0], r + lamp_off[1], lamp[0]), 'energy': lamp[1] * 2.5,
                        'colour': LAMP}]
    if inside:
        p['inside'] = [{'at': world(c + lamp_off[0], r + lamp_off[1], inside[0]), 'energy': inside[1] * 2.5,
                        'colour': LAMP}]
    return p


def obj(name, group, variants, cells=((0, 0),), blocks=None, origin=(0, 0), joined=False, lamp=None):
    """An object piece. `blocks`: the cells a walker cannot enter, all of
    them unless said; `lamp`: the cell that gives light and how far."""
    return {'name': name, 'group': group, 'layer': 'object', 'variants': variants, 'cells': list(cells),
            'blocks': set(cells if blocks is None else blocks), 'origin': origin, 'joined': joined, 'lamp': lamp}


def wrap_noise(size, lattice, seed):
    """Value noise that wraps round both edges: a random lattice tiled three
    by three, smoothed, and its middle kept."""
    g = random.Random(seed)
    small = Image.new('L', (lattice, lattice))
    small.putdata([g.randrange(256) for _ in range(lattice * lattice)])
    tiled = Image.new('L', (3 * lattice, 3 * lattice))
    for i in range(3):
        for j in range(3):
            tiled.paste(small, (i * lattice, j * lattice))
    return tiled.resize((3 * size, 3 * size), Image.BICUBIC).crop((size, size, 2 * size, 2 * size))


def texture(name, colours, period, seed):
    """A ground's texture over one period: blotches a cell wide over grain,
    coloured between two colours. Named by its content, so a change to it is
    a new render rather than a stale one from the cache."""
    size = A * period
    n = Image.blend(wrap_noise(size, period, seed), wrap_noise(size, 4 * period, seed + 1), 0.35)
    n = ImageOps.autocontrast(Image.blend(n, wrap_noise(size, 16 * period, seed + 2), 0.3), cutoff=1)
    im = ImageOps.colorize(n, colours[0], colours[1])
    buf = io.BytesIO()
    im.save(buf, 'PNG')
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f'{name}-{hashlib.sha1(buf.getvalue()).hexdigest()[:12]}.png')
    with open(path, 'wb') as f:
        f.write(buf.getvalue())
    return path


def ground(name, period, variants):
    """A ground piece: each variant a texture and what lies on it, laid out
    the same in every period."""
    return {'name': name, 'group': 'Ground', 'layer': 'ground', 'period': period, 'variants': variants}


def stones(period, count, seed):
    g = random.Random(seed)
    return [put(H(g.choice(['path_A', 'path_B', 'path_C', 'path_D'])), turn=g.randrange(360),
                off=(g.uniform(0, period) - 0.5, g.uniform(0, period) - 0.5), own=False) for _ in range(count)]


GROUT = ('#232227', '#2e2d33')


def grave(kind, candle=False):
    """A stone, and a candle on the grave in front of it."""
    v = [put(H(kind), off=(0, -0.2))]
    if candle:
        v.append(put(H('candle_melted'), cell=(0, 1), off=(0.3, -0.1), lamp=(0.5, 3)))
    return v


def fence(mask):
    """A fence post, and the bars from it to each joined neighbour: a whole
    run of bars laid toward the neighbour, of which only the half on the
    post's own cell is kept."""
    v = [put(H('fence_pillar'), cell=(1, 1), own=False)]
    for bit, (dc, dr) in ((1, (0, -1)), (2, (1, 0)), (4, (0, 1)), (8, (-1, 0))):
        if mask & bit:
            v.append(put(H('fence_seperate'), cell=(1 + dc, 1 + dr), turn=0 if dc else 90, own=False))
    return v


def post_lantern(turn):
    # The lantern hangs from an arm that turns with the post.
    arm = (0.62 * math.sin(math.radians(turn)), 0.62 * math.cos(math.radians(turn)))
    return [put(H('post_lantern'), turn=turn, lamp=(2.5, 60), lamp_off=arm)]


def glow(energy):
    """How far round a flame of this strength its light reaches, in the
    engine's pixels: what render_lights() frames."""
    return min(240, round(70 + 2.5 * energy))


def build_kit():
    return [
        ground('grass', 8, [{'texture': texture('grass', ('#3a4735', '#58644d'), 8, 11), 'placements': []}]),
        ground('earth', 4, [{'texture': texture('earth', ('#38332d', '#544c41'), 4, 21), 'placements': []}]),
        ground('path', 4, [{'texture': texture('path', ('#6c675a', '#8c8573'), 4, 31),
                            'placements': stones(4, 7, 5)}]),
        ground('flagstones', 1, [{'texture': texture('grout', GROUT, 1, 41), 'placements': [put(D(n), own=False)]}
                                 for n in ('floor_tile_small', 'floor_tile_small_broken_A',
                                           'floor_tile_small_broken_B')]),
        ground('planks', 1, [{'texture': texture('grout', GROUT, 1, 41), 'placements': [put(D(n), own=False)]}
                             for n in ('floor_wood_small', 'floor_wood_small_dark')]),

        obj('grave', 'Graves', [grave(k) for k in ('grave_A', 'grave_B', 'gravestone')]),
        obj('grave with a candle', 'Graves', [grave(k, True) for k in ('grave_A', 'grave_B', 'gravestone')],
            cells=[(0, 0), (0, 1)], blocks=[(0, 0)], lamp=((0, 1), glow(3))),
        obj('old grave', 'Graves', [grave(k) for k in ('grave_A_destroyed', 'gravemarker_A', 'gravemarker_B')]),
        obj('grave marker', 'Graves', [[put(H(k))] for k in ('gravemarker_A', 'gravemarker_B')]),
        obj('coffin', 'Graves', [[put(H('coffin_decorated'), turn=t)] for t in (0, 90)]),
        obj('bones', 'Graves', [[put(H(k), turn=t, scale=0.6 if k == 'skull' else 1, off=o)]
                                for k, t, o in (('bone_A', 30, (0.1, -0.2)), ('bone_B', 120, (-0.2, 0.1)),
                                                ('bone_C', 210, (0.2, 0.2)), ('skull', 300, (0, 0)),
                                                ('ribcage', 60, (-0.1, 0)), ('ribcage', 240, (0.1, 0.1)))],
            blocks=[]),

        # Lit within: a light in the portico, between the columns.
        obj('crypt', 'Churchyard', [[put(H('crypt'), cell=(1, 1.5), own=False, inside=(1.0, 112),
                                         lamp_off=(0, 1.9))]],
            cells=[(c, r) for r in range(4) for c in range(3)], lamp=((1, 3), glow(112))),
        obj('fence', 'Churchyard', [fence(mask) for mask in range(16)], cells=[(1, 1)], origin=(1, 1), joined=True),
        obj('gate arch', 'Churchyard', [[put(H('arch'))]], blocks=[]),
        obj('gate arch, turned', 'Churchyard', [[put(H('arch'), turn=90)]], blocks=[]),
        obj('shrine', 'Churchyard', [[put(H('shrine_candles'), lamp=(1.6, 18))]], lamp=((0, 0), glow(18))),
        obj('post lantern', 'Churchyard', [post_lantern(t) for t in (0, 90, 180, 270)], lamp=((0, 0), glow(60))),
        obj('lantern', 'Churchyard', [[put(H('lantern_standing'), lamp=(0.8, 12))]], blocks=[],
            lamp=((0, 0), glow(12))),
        obj('candles', 'Churchyard', [[put(H('candle_triple'), lamp=(0.9, 6))]], blocks=[], lamp=((0, 0), glow(6))),
        obj('bench', 'Churchyard', [[put(H('bench'))]]),
        obj('bench, turned', 'Churchyard', [[put(H('bench'), turn=90)]]),
        obj('skull post', 'Churchyard', [[put(H('post_skull'), turn=t)] for t in (0, 90, 180)]),

        obj('barrel', 'Camp', [[put(D('barrel_large'))]]),
        obj('barrels', 'Camp', [[put(D('barrel_small_stack'))]]),
        obj('crates', 'Camp', [[put(D('crates_stacked'), turn=15)]]),
        obj('table', 'Camp', [[put(D('table_medium_decorated_A'), turn=90)]]),
        obj('candle', 'Camp', [[put(D('candle_lit'), off=(0.4, 0.2), lamp=(0.7, 6))]], blocks=[],
            lamp=((0, 0), glow(6))),

        obj('pine', 'Woods', [[put(H(f'tree_pine_orange_{size}'), tint=PINE_TINT, turn=t)]
                              for size in ('large', 'medium', 'small') for t in (0, 150)]),
        obj('dead tree', 'Woods', [[put(H(f'tree_dead_{size}'), turn=t)]
                                   for size in ('large', 'medium', 'small') for t in (0, 200)]),
    ]


def slug(name):
    return name.replace(', ', '-').replace(' ', '-')


def render_kit(kit):
    items = []
    for p in kit:
        for v, variant in enumerate(p['variants']):
            out = f"{slug(p['name'])}-{v}"
            if p['layer'] == 'ground':
                items.append(dict(variant, kind='ground', out=out, period=p['period']))
            else:
                items.append({'kind': 'piece', 'out': out, 'placements': variant,
                              'ids': len(p['cells']) > 1 or any('cell' not in m for m in variant)})
    return blender('kit', items, 12 if DRAFT else 64)


def grade(im):
    """The night's colour: a little less saturated and cooler in the darks;
    and the edges a touch crisper than the denoiser leaves them."""
    rgb = ImageEnhance.Color(im.convert('RGB')).enhance(0.82).filter(ImageFilter.UnsharpMask(2, 80, 2))
    r, g, b = rgb.split()
    rgb = Image.merge('RGB', (r.point(lambda v: v * 0.94), g.point(lambda v: v * 0.97), b))
    out = rgb.convert('RGBA')
    out.putalpha(im.getchannel('A'))
    return out


def diamond_mask():
    """The pixels of a cell's box whose centres fall in the cell: the ground
    diamonds tile the map with neither gaps nor overlaps."""
    mask = Image.new('L', (A, A // 2))
    px = mask.load()
    for j in range(A // 2):
        for i in range(A):
            vx, vy = i + 0.5 - A / 2, j + 0.5 - A / 4
            x, y = 2 * vy + vx, 2 * vy - vx
            if -A / 2 <= x < A / 2 and -A / 2 <= y < A / 2:
                px[i, j] = 255
    return mask


def centre_in(anchor, c, r):
    """Where cell (c, r)'s centre lands in a render whose world origin is on
    pixel `anchor`: the engine's projectPoint, ISO_SCALE 0.5."""
    return anchor[0] + (c - r) * A // 2, anchor[1] + (c + r + 1) * A // 4


def cut_ground(im, period):
    """A ground render's diamonds, by the cell of the period they are."""
    mask = diamond_mask()
    frames = {}
    for r in range(period):
        for c in range(period):
            cx, cy = centre_in((period * A // 2, 0), c, r)
            d = im.crop((cx - A // 2, cy - A // 4, cx + A // 2, cy + A // 4))
            d.putalpha(mask)
            frames[c, r] = (d, (A // 2, A // 4))
    return frames


def cut(im, ids, anchor, cells, spill=True):
    """One frame per cell of `cells` out of a render, by the cell id.png
    gives each pixel, or all of it the first cell's when there is no id.png.
    A pixel the id pass missed - an antialiased edge - goes with its nearest
    neighbour that has one. A pixel on a cell not in `cells` - a shadow
    reaching past the piece - goes with the nearest of them, which draws it
    before whoever stands where it fell; without `spill` it is dropped, for
    the bars a fence post is rendered with toward its neighbour."""
    w, h = im.size
    pa = im.tobytes()
    owner = array('i', [0]) * (w * h)
    loose = []
    first = (cells[0][0] << 8 | cells[0][1]) + 1
    ib = ids.tobytes() if ids else None
    for i in range(w * h):
        if pa[4 * i + 3] == 0:
            continue
        if ib is None:
            owner[i] = first
        elif ib[4 * i + 2] == 255 and ib[4 * i + 3] == 255:
            owner[i] = (ib[4 * i] << 8 | ib[4 * i + 1]) + 1
        else:
            loose.append(i)
    for radius in (1, 2, 3):
        left = []
        for i in loose:
            x, y = i % w, i // w
            found = 0
            for dy in range(-radius, radius + 1):
                for dx in range(-radius, radius + 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and owner[ny * w + nx]:
                        found = owner[ny * w + nx]
                        break
                if found:
                    break
            if found:
                owner[i] = found
            else:
                left.append(i)
        loose = left

    pixels = {}
    for i in range(w * h):
        if owner[i]:
            cell = ((owner[i] - 1) >> 8, (owner[i] - 1) & 255)
            if cell not in cells:
                if not spill:
                    continue
                cell = min(cells, key=lambda k: abs(k[0] - cell[0]) + abs(k[1] - cell[1]))
            pixels.setdefault(cell, []).append(i)
    frames = {}
    for c, r in cells:
        mine = pixels.get((c, r), [])
        xs, ys = [i % w for i in mine], [i // w for i in mine]
        cx, cy = centre_in(anchor, c, r)
        # The box reaches the cell centre: the atlas wants anchors >= 0, and a
        # cell of a wide piece can lie wholly right of, or below, its centre.
        bx0, by0 = min(xs + [cx]), min(ys + [cy])
        bx1, by1 = max(xs + [cx]) + 1, max(ys + [cy]) + 1
        fw, fh = bx1 - bx0, by1 - by0
        buf = bytearray(fw * fh * 4)
        for i, x, y in zip(mine, xs, ys):
            o = ((y - by0) * fw + (x - bx0)) * 4
            buf[o:o + 4] = pa[4 * i:4 * i + 4]
        frames[c, r] = (Image.frombytes('RGBA', (fw, fh), bytes(buf)), (cx - bx0, cy - by0))
    return frames


def cut_kit(kit, out):
    """Every frame of the kit, and what tiles.json says about each:
    (image, anchor, piece metadata), and the frame ids by (piece, variant,
    cell within the piece)."""
    frames, ids = [], {}
    for p in kit:
        for v, _ in enumerate(p['variants']):
            d = os.path.join(out, f"{slug(p['name'])}-{v}")
            if p['layer'] == 'ground':
                n = p['period']
                im = grade(Image.open(os.path.join(d, 'ground.png')).convert('RGBA'))
                cells = sorted(cut_ground(im, n).items(), key=lambda kv: (kv[0][1], kv[0][0]))
            else:
                meta = json.load(open(os.path.join(d, 'meta.json')))
                im = grade(Image.open(os.path.join(d, 'color.png')).convert('RGBA'))
                id_png = os.path.join(d, 'id.png')
                ids_im = Image.open(id_png).convert('RGBA') if os.path.exists(id_png) else None
                cells = list(cut(im, ids_im, meta['anchor'], p['cells'], spill=not p['joined']).items())
            for (c, r), (fim, anchor) in cells:
                at = (c - p.get('origin', (0, 0))[0], r - p.get('origin', (0, 0))[1])
                piece = {'name': p['name'], 'group': p['group']}
                if p['layer'] == 'ground':
                    piece['layer'] = 'ground'
                if at != (0, 0):
                    piece['at'] = list(at)
                if p.get('joined'):
                    piece['connect'] = v
                elif v:
                    piece['variant'] = v
                if p['layer'] == 'object' and (c, r) in p['blocks']:
                    piece['blocks'] = True
                ids[p['name'], v, at] = len(frames)
                frames.append((fim, anchor, piece))
    return frames, ids


def shelves(images):
    """Where each image goes on a sheet ATLAS_W wide, packed in shelves
    tallest first, and the sheet's height."""
    order = sorted(range(len(images)), key=lambda i: -images[i].height)
    x = y = shelf = 0
    at = {}
    for i in order:
        im = images[i]
        if x + im.width > ATLAS_W:
            x, y, shelf = 0, y + shelf, 0
        at[i] = (x, y)
        x += im.width
        shelf = max(shelf, im.height)
    return at, y + shelf


def pack_atlas(frames):
    """Shelf-pack the frames; ids stay in the order given."""
    at, height = shelves([im for im, _, _ in frames])
    atlas = Image.new('RGBA', (ATLAS_W, height))
    meta = {}
    drawn = lambda v: v // S if v % S == 0 else v / S  # in the engine's pixels
    for i, (im, (ax, ay), piece) in enumerate(frames):
        fx, fy = at[i]
        dw, dh, ax, ay = drawn(im.width), drawn(im.height), drawn(ax), drawn(ay)
        # What the client's FrameSchema accepts; one frame outside it and the
        # whole tileset is refused.
        assert 0 <= ax <= OVERHANG and 0 <= ay <= OVERHANG and max(dw, dh) <= OVERHANG, (i, im.size, ax, ay)
        atlas.alpha_composite(im, (fx, fy))
        meta[str(i)] = {'x': fx, 'y': fy, 'width': im.width, 'height': im.height,
                        'drawWidth': dw, 'drawHeight': dh, 'anchorX': ax, 'anchorY': ay, 'piece': piece}
    return atlas, meta


# ─── the map ─────────────────────────────────────────────────────────────────
# Cell centres of the churchyard fence's corners, and where it opens.
FENCE = (11, 11, 29, 29)
GATE_SW = (20, 29)
GATE_SE = (29, 20)
CRYPT = (18, 13)  # the crypt's 3x4 cells start here
SHRINE = (23, 22)
RESPAWN = (22, 24)
NPC_POSTS = {(22, 21): 'agathe', (21, 27): 'brand', (25, 25): 'hobb'}
NPC_POST_OF = {npc: cell for cell, npc in NPC_POSTS.items()}
SHOP_MAT = (24, 25)  # Hobb's planks: step on them to trade


class Map:
    """The map as kit pieces: a ground per cell, an object piece by the cell
    its first cell goes on, the fence's cells."""

    def __init__(self, kit):
        self.kit = {p['name']: p for p in kit}
        self.ground = {}
        self.objects = {}
        self.fence = set()
        self.taken = set()  # anything standing there, blocking or not
        self.path = set()
        self.spawns = {}
        self.blocked = set()  # what the laid-out pieces block, once laid out

    def put(self, name, c, r, variant=None):
        p = self.kit[name]
        v = rng.randrange(len(p['variants'])) if variant is None else variant
        self.objects[c, r] = (name, v)
        for dc, dr in p['cells']:
            self.taken.add((c + dc, r + dr))

    def free(self, c, r):
        return 0 <= c < COLS and 0 <= r < ROWS and (c, r) not in self.taken and (c, r) not in self.path


def lay_path(m, a, b):
    (c0, r0), (c1, r1) = a, b
    for c in range(min(c0, c1), max(c0, c1) + 1):
        for r in range(min(r0, r1), max(r0, r1) + 1):
            m.path.add((c, r))
            m.ground[c, r] = 'path'


def value_noise(scale, seed):
    g = random.Random(seed)
    grid = {(i, j): g.random() for i in range(COLS // scale + 3) for j in range(ROWS // scale + 3)}

    def at(c, r):
        x, y = c / scale, r / scale
        i, j = int(x), int(y)
        fx, fy = x - i, y - j
        sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        top = grid[i, j] * (1 - sx) + grid[i + 1, j] * sx
        bottom = grid[i, j + 1] * (1 - sx) + grid[i + 1, j + 1] * sx
        return top * (1 - sy) + bottom * sy
    return at


def build_map(kit):
    m = Map(kit)
    x0, y0, x1, y1 = FENCE

    # the paths: from the crypt's door out through both gates
    lay_path(m, (20, 19), (20, COLS - 1))
    lay_path(m, (20, 20), (COLS - 1, 20))
    lay_path(m, (19, 17), (21, 18))

    # the churchyard fence, opened by an arch at each gate
    for c in range(x0, x1 + 1):
        for r in range(y0, y1 + 1):
            if c in (x0, x1) or r in (y0, y1):
                m.fence.add((c, r))
                m.taken.add((c, r))
    for gate, arch in ((GATE_SW, 'gate arch'), (GATE_SE, 'gate arch, turned')):
        m.fence.discard(gate)
        m.put(arch, *gate)

    # the crypt, its door on the churchyard side, and the flagstones before it
    cc, cr = CRYPT
    m.put('crypt', cc, cr)
    for c in range(cc, cc + 4):
        for r in (cr + 4, cr + 5):
            m.ground[c, r] = 'flagstones'
    m.put('post lantern', cc - 1, cr + 4, variant=2)
    m.put('post lantern', cc + 3, cr + 4, variant=0)
    m.put('candles', cc - 1, cr + 3)

    # graves in rows, each with its plot of earth in front
    def grave_at(name, c, r):
        m.put(name, c, r)
        m.ground[c, r + 1] = 'earth'

    for r in (20, 23, 26):
        for c in (13, 15, 17):
            grave_at('grave with a candle' if rng.random() < 0.3 else 'grave', c, r)
    for r in (13, 16):
        for c in (23, 25, 27):
            grave_at('grave with a candle' if rng.random() < 0.3 else 'grave', c, r)
    for c, r in ((13, 13), (15, 14), (13, 16), (16, 17)):
        m.put('grave marker', c, r)
    m.put('dead tree', 14, 12, variant=0)
    m.put('bench, turned', 16, 15)

    # the shrine, where the dead come back to their feet (the living, anyway)
    m.put('shrine', *SHRINE)
    for c, r in ((22, 21), (24, 21), (22, 23), (24, 23), (23, 21), (22, 22), (24, 22), (23, 23)):
        m.ground[c, r] = 'earth'

    # the survivors' corner, by the east gate, and the planks Hobb trades on
    m.ground[SHOP_MAT] = 'planks'
    m.taken |= set(NPC_POSTS) | {SHOP_MAT}
    m.put('barrel', 26, 23)
    m.put('crates', 27, 23)
    m.put('barrels', 27, 25)
    m.put('table', 25, 26)
    m.put('candle', 24, 26)
    m.put('bench', 25, 28)
    m.put('lantern', 26, 27)
    for c, r in ((23, 24), (24, 24), (25, 24), (26, 24), (23, 25), (26, 25), (24, 26), (26, 26), (23, 27),
                 (24, 27), (25, 27), (26, 27), (25, 25)):
        m.ground.setdefault((c, r), 'earth')
    # the gates' lamps
    m.put('post lantern', GATE_SW[0] + 1, GATE_SW[1] - 1, variant=1)
    m.put('post lantern', GATE_SE[0] - 1, GATE_SE[1] + 1, variant=1)
    for c, r in ((21, 19), (19, 21)):
        m.put('lantern', c, r)

    # outside: an old burial ground gone to the woods
    for c, r in ((6, 8), (8, 6), (4, 13), (33, 7), (35, 10), (7, 32), (9, 35), (34, 33)):
        grave_at('old grave', c, r)
    for c, r in ((7, 9), (34, 8), (8, 33)):
        m.put('coffin', c, r)
    for c, r in ((18, 32), (22, 36), (32, 18), (36, 22)):
        m.put('skull post', c, r)
    k = 0
    while k < 34:
        c, r = rng.randrange(2, COLS - 2), rng.randrange(2, ROWS - 2)
        inside = x0 < c < x1 and y0 < r < y1
        if m.free(c, r) and not inside:
            m.put('bones', c, r)
            k += 1

    # the roaming dead, well away from the fence
    for npc, cells in (('risen', ((6, 20), (14, 34), (34, 14), (8, 26), (26, 6), (33, 28))),
                       ('bone-knight', ((5, 5), (35, 35), (5, 30), (30, 4))),
                       ('grave-robber', ((10, 3), (3, 10))),
                       ('warlock', ((36, 3), (3, 36)))):
        for c, r in cells:
            m.spawns[(c, r)] = npc

    # the woods: thick at the map's edge, thin by the fence, never on a path
    wild = value_noise(6, 3)
    clear = set(m.path)
    for c, r in list(m.path):
        for dc in (-1, 0, 1):
            for dr in (-1, 0, 1):
                clear.add((c + dc, r + dr))
    clear |= set(m.spawns)
    for c in range(COLS):
        for r in range(ROWS):
            if not m.free(c, r) or (c, r) in clear:
                continue
            to_fence = max(x0 - c, c - x1, y0 - r, r - y1)
            if to_fence <= 2:
                continue
            border = min(c, r, COLS - 1 - c, ROWS - 1 - r)
            density = 0.75 if border == 0 else 0.3 if border < 3 else 0.12 + 0.2 * wild(c, r)
            if rng.random() < density:
                m.put('pine' if rng.random() < 0.45 else 'dead tree', c, r)
    return m


def lay_out(m, ids):
    """The map's tiles out of its pieces, and the cells they block."""
    tiles = [[{} for _ in range(COLS)] for _ in range(ROWS)]
    for r in range(ROWS):
        for c in range(COLS):
            p = m.kit[m.ground.get((c, r), 'grass')]
            v = rng.randrange(len(p['variants']))
            tiles[r][c]['tileIndex'] = ids[p['name'], v, (c % p['period'], r % p['period'])]
    for (c, r), (name, v) in m.objects.items():
        p = m.kit[name]
        for dc, dr in p['cells']:
            if 0 <= c + dc < COLS and 0 <= r + dr < ROWS:
                tiles[r + dr][c + dc]['maskIndex'] = ids[name, v, (dc, dr)]
                if (dc, dr) in p['blocks']:
                    m.blocked.add((c + dc, r + dr))
    # The fence the same way the map editor joins it (tileset/index.ts).
    for c, r in m.fence:
        mask = sum(bit for bit, (dc, dr) in ((1, (0, -1)), (2, (1, 0)), (4, (0, 1)), (8, (-1, 0)))
                   if (c + dc, r + dr) in m.fence)
        tiles[r][c]['maskIndex'] = ids['fence', mask, (0, 0)]
        m.blocked.add((c, r))
    for c, r in m.blocked:
        tiles[r][c]['blocked'] = True
    for (c, r), npc in list(m.spawns.items()) + list(NPC_POSTS.items()):
        assert (c, r) not in m.blocked, f'{npc} stands in a wall at {c},{r}'
        tiles[r][c]['npcSpawn'] = npc
    assert RESPAWN not in m.blocked and RESPAWN not in m.taken
    assert SHOP_MAT not in m.blocked
    c, r = SHOP_MAT
    tiles[r][c]['shop'] = 'hobb'
    return tiles


# The preview's frame, at the renders' scale: the whole map, with room above
# for the tall trees on its far edge. ORIGIN is where the view's (0, 0), the
# map's top corner, lands.
MARGIN_TOP, MARGIN_SIDE, MARGIN_BOTTOM = 300 * S, 96 * S, 48 * S
RENDER_W = (COLS + ROWS) * A // 2 + 2 * MARGIN_SIDE
RENDER_H = (COLS + ROWS) * A // 4 + MARGIN_TOP + MARGIN_BOTTOM
ORIGIN = (MARGIN_SIDE + ROWS * A // 2, MARGIN_TOP)


def cell_centre(c, r):
    return centre_in(ORIGIN, c, r)


def preview(tiles, frames, cast=()):
    """The map the way the client draws it: every ground diamond, then the
    props and whoever `cast` puts on the map, sorted by the depth of their
    cell's centre."""
    out = Image.new('RGBA', (RENDER_W, RENDER_H), (12, 14, 22, 255))

    def put_frame(index, c, r):
        im, (ax, ay), _ = frames[index]
        cx, cy = cell_centre(c, r)
        out.alpha_composite(im, (cx - ax, cy - ay))

    for r in range(ROWS):
        for c in range(COLS):
            put_frame(tiles[r][c]['tileIndex'], c, r)
    depth = []
    for r in range(ROWS):
        for c in range(COLS):
            if 'maskIndex' in tiles[r][c]:
                depth.append((c + r, 0, lambda i=tiles[r][c]['maskIndex'], c=c, r=r: put_frame(i, c, r)))
    for im, (ax, ay), (c, r) in cast:
        cx, cy = cell_centre(c, r)
        depth.append((c + r, 1, lambda im=im, x=cx - ax, y=cy - ay: out.alpha_composite(im, (x, y))))
    for _, _, draw in sorted(depth, key=lambda d: (d[0], d[1])):
        draw()
    return out


# ─── lamps ───────────────────────────────────────────────────────────────────
# A lamp's light is rendered on its own (render.py's `light`) and added over
# the night by the client, rather than cut out of the dark as a circle: so a
# candle lights the face of the stone it stands before, the stone throws its
# shadow, and a lantern pools on the path. Per piece, a gain on its flames
# and how far round them to frame, as a multiple of the reach glow() gave it;
# LAMP_LIGHT_ANY for a piece not named. A candle's flame is weak in its
# piece's render, which has only to show it lit; the shrine's stand on its own
# stone, which a full one blows out.
LAMP_LIGHT = {'grave with a candle': (6, 2.4), 'candles': (6, 2.4), 'candle': (6, 2.4), 'shrine': (0.6, 1.6),
              'crypt': (1, 1.6)}
LAMP_LIGHT_ANY = (1.6, 1.6)
LIGHT_GROUND = '#5a564c'  # between the grass and the path
NIGHT_GROUND = (30, 38, 48)  # the same ground on screen, under the night's dark


def fade_edges(im, band=0.2):
    """A light taken down to black over the outer `band` of its frame: a
    light never quite reaches nothing, and where its frame cuts it off the cut
    shows as a straight edge."""
    def ramp(n):
        line = Image.new('L', (n, 1))
        t = [min(1, i / (band * n), (n - 1 - i) / (band * n)) for i in range(n)]
        line.putdata([round(255 * v * v * (3 - 2 * v)) for v in t])
        return line
    across = ramp(im.width).resize(im.size)
    down = ramp(im.height).transpose(Image.Transpose.ROTATE_270).resize(im.size)
    return ImageChops.multiply(im, ImageChops.multiply(across, down).convert('RGB'))


def render_lights(kit, ids):
    """Every lamp piece's light, on one sheet at the engine's scale, and for
    each frame that holds a flame - which is how the module finds the lamps
    on the live map, the editor's as well as these - where its light is:
    [x, y, width, height, and the flame's cell's centre within that]."""
    items, cells = [], []
    for p in kit:
        if not p.get('lamp'):
            continue
        cell, radius = p['lamp']
        gain, reach = LAMP_LIGHT.get(p['name'], LAMP_LIGHT_ANY)
        for v, variant in enumerate(p['variants']):
            items.append({'kind': 'light', 'out': f"{slug(p['name'])}-{v}", 'placements': variant,
                          'ground': LIGHT_GROUND, 'gain': gain, 'reach': radius / 32 * reach})
            cells.append((p['name'], v, cell))
    out = blender('lights', items, 16 if DRAFT else 64)
    images, centres = [], []
    for item, (_, _, cell) in zip(items, cells):
        d = os.path.join(out, item['out'])
        with open(os.path.join(d, 'meta.json')) as f:
            anchor = json.load(f)['anchor']
        im = fade_edges(Image.open(os.path.join(d, 'color.png')).convert('RGB'))
        images.append(im.resize((im.width // S, im.height // S), Image.LANCZOS))
        cx, cy = centre_in(anchor, *cell)
        centres.append((cx // S, cy // S))
    at, height = shelves(images)
    sheet = Image.new('RGB', (ATLAS_W, height))
    rects = {}
    for i, (im, (cx, cy), key) in enumerate(zip(images, centres, cells)):
        sheet.paste(im, at[i])
        rects[str(ids[key])] = [*at[i], im.width, im.height, cx, cy]
    # Each light as its colour over an alpha of its brightest channel: drawn
    # plainly over the night it brightens what is under it as `screen` would,
    # which lets the client draw it on the canvas the names go on, before them.
    # In its weaker channels `screen` keeps more of what is under it than one
    # alpha can: that much of the night ground goes back into them.
    r, g, b = sheet.split()
    alpha = ImageChops.lighter(ImageChops.lighter(r, g), b)
    r, g, b = (ImageChops.add(ch, ImageChops.subtract(alpha, ch).point(lambda v, k=k: v * k / 255))
               for ch, k in zip((r, g, b), NIGHT_GROUND))
    return Image.merge('RGBa', (r, g, b, alpha)).convert('RGBA'), rects


# ─── characters ──────────────────────────────────────────────────────────────
# A frame is larger than the 64 px box a character stands in, for the sword
# swung wide and the shadow: the foot point is ANCHOR. Characters are drawn a
# quarter larger than the world they walk in, or a knight would stand no
# taller than a gravestone. Both in the engine's pixels; the sheet is S times
# that, and sprites.json's `scale` draws it back down.
FRAME, ANCHOR = 96, (48, 82)
CHAR_PPU = 28.3
F = FRAME * S  # a frame on the sheet
WALK, IDLE, ATTACK = 0, 4, 5  # columns: the walk cycle, then one of each
HERO = lambda n: pack(f'Characters/gltf/{n}.glb', 'heroes')
SKEL = lambda n: pack(f'Characters/gltf/{n}.glb', 'skeletons')
HELD = lambda n, grip='right': {'model': pack(f'Assets/gltf/{n}.gltf', 'skeletons'), 'grip': grip}


def cast(model, show=(), attach=(), walk='Walking_A', idle='Idle', attack='1H_Melee_Attack_Chop',
         hit=0.42, scale=1):
    return {'model': model, 'show': list(show), 'attach': list(attach), 'scale': scale,
            'anims': [{'name': 'walk', 'action': walk, 'at': [0, 0.25, 0.5, 0.75]},
                      {'name': 'idle', 'action': idle, 'at': [0]},
                      {'name': 'attack', 'action': attack, 'at': [hit]}]}


# Sprite ids, in sheet order.
CHARACTERS = [
    ('knight', cast(HERO('Knight'), ['1H_Sword', 'Round_Shield', 'Knight_Helmet', 'Knight_Cape'])),
    ('sister', cast(HERO('Mage'), ['Mage_Hat', 'Mage_Cape', 'Spellbook'], attack='Spellcast_Shoot', hit=0.3)),
    ('gravedigger', cast(HERO('Rogue_Hooded'), ['Rogue_Cape', 'Knife'], attack='1H_Melee_Attack_Stab')),
    ('captain', cast(HERO('Barbarian'), ['1H_Axe', 'Barbarian_Round_Shield', 'Barbarian_Cape', 'Barbarian_Hat'])),
    ('risen', cast(SKEL('Skeleton_Minion'), attach=[HELD('Skeleton_Axe')], walk='Walking_D_Skeletons')),
    ('bone-knight', cast(SKEL('Skeleton_Warrior'), ['Skeleton_Warrior_Helmet'],
                         [HELD('Skeleton_Blade'), HELD('Skeleton_Shield_Small_A', 'shield')],
                         walk='Walking_D_Skeletons')),
    ('grave-robber', cast(SKEL('Skeleton_Rogue'), ['Skeleton_Rogue_Cape', 'Skeleton_Rogue_Hood'],
                          [HELD('Skeleton_Blade'), HELD('Skeleton_Blade', 'left')],
                          walk='Walking_D_Skeletons', attack='Dualwield_Melee_Attack_Slice')),
    ('warlock', cast(SKEL('Skeleton_Mage'), ['Skeleton_Mage_Hat'], [HELD('Skeleton_Staff')],
                     walk='Walking_D_Skeletons', attack='Spellcast_Shoot', hit=0.3)),
    ('ossuary-lord', cast(SKEL('Skeleton_Warrior'), ['Skeleton_Warrior_Helmet'],
                          [HELD('Skeleton_Axe'), HELD('Skeleton_Shield_Large_A', 'shield')],
                          walk='Walking_D_Skeletons', attack='2H_Melee_Attack_Chop', scale=1.3)),
    # Players' looks beside the knight, so four at a gate are four people: the
    # heroes in gear none of the townsfolk wear. Last, since a sprite id is its
    # place on the sheet.
    ('rogue', cast(HERO('Rogue'), ['Knife', 'Knife_Offhand'], attack='Dualwield_Melee_Attack_Slice')),
    ('barbarian', cast(HERO('Barbarian'), ['2H_Axe'], attack='2H_Melee_Attack_Chop')),
    ('mage', cast(HERO('Mage'), ['2H_Staff'], attack='Spellcast_Shoot', hit=0.3)),
]
SPRITE = {name: i for i, (name, _) in enumerate(CHARACTERS)}
PER_ROW = 3  # characters across the sheet


def render_characters():
    items = [dict(spec, kind='character', out=name, size=[F, F], anchor=[a * S for a in ANCHOR],
                  ppu=CHAR_PPU * S) for name, spec in CHARACTERS]
    out = blender('characters', items, 16 if DRAFT else 64)
    sheet = Image.new('RGBA', (PER_ROW * 6 * F, -(-len(CHARACTERS) // PER_ROW) * 4 * F))
    for i, (name, _) in enumerate(CHARACTERS):
        bx, by = (i % PER_ROW) * 6 * F, (i // PER_ROW) * 4 * F
        for d in range(4):
            cells = [f'walk_{d}_{k}' for k in range(4)] + [f'idle_{d}_0', f'attack_{d}_0']
            for col, cell in enumerate(cells):
                im = Image.open(os.path.join(out, name, cell + '.png')).convert('RGBA')
                sheet.alpha_composite(im, (bx + col * F, by + d * F))
    return grade(sheet)


def figure(sheet, name, direction=0, column=IDLE):
    """One frame off the sheet, and its anchor: for the preview."""
    i = SPRITE[name]
    bx, by = (i % PER_ROW) * 6 * F, (i // PER_ROW) * 4 * F
    x, y = bx + column * F, by + direction * F
    return sheet.crop((x, y, x + F, y + F)), (ANCHOR[0] * S, ANCHOR[1] * S)


# ─── items ───────────────────────────────────────────────────────────────────
HOLY_WATER, GOLD, CIDER, AXE, BLADE = 1, 2, 3, 4, 5
ITEMS = [
    ({'id': HOLY_WATER, 'name': 'Holy Water', 'type': 'consumable',
      'description': 'Blessed at the shrine. It closes what the dead open.',
      'effects': [{'attribute': 'health', 'type': 'add', 'value': 40}]},
     {'model': D('bottle_A_labeled_green'), 'rotate': (0, 0, 20)}),
    ({'id': GOLD, 'name': 'Gold Coin', 'type': 'money', 'description': 'Currency.'},
     {'model': D('coin_stack_small'), 'rotate': (0, 0, 0)}),
    ({'id': CIDER, 'name': 'Hot Cider', 'type': 'consumable',
      'description': 'Warm, and sweeter than the night.',
      'effects': [{'attribute': 'health', 'type': 'add', 'value': 15}]},
     {'model': pack('Assets/gltf/mug_full.gltf', 'heroes'), 'rotate': (0, 0, 30)}),
    ({'id': AXE, 'name': 'Rusted Axe', 'type': 'weapon',
      'description': 'Pried from a Risen. It still bites.',
      'effects': [{'attribute': 'attack', 'type': 'add', 'value': 3}]},
     {'model': pack('Assets/gltf/Skeleton_Axe.gltf', 'skeletons'), 'rotate': (90, 45, 0)}),
    ({'id': BLADE, 'name': "Knight's Blade", 'type': 'weapon',
      'description': 'Steel that remembers a better order.',
      'effects': [{'attribute': 'attack', 'type': 'add', 'value': 7}]},
     {'model': pack('Assets/gltf/sword_1handed.gltf', 'heroes'), 'rotate': (90, 45, 0)}),
]


def render_items():
    items = [dict(icon, kind='icon', out=f'{item["id"]}.png', size=T) for item, icon in ITEMS]
    out = blender('items', items, 16 if DRAFT else 64)
    sheet = Image.new('RGBA', (len(ITEMS) * T, T))
    for i, (item, _) in enumerate(ITEMS):
        sheet.alpha_composite(Image.open(os.path.join(out, f'{item["id"]}.png')).convert('RGBA'), (i * T, 0))
    return sheet


def swing():
    """Six frames of a pale arc in front of whoever swings (graphics/attackEffect)."""
    out = Image.new('RGBA', (6 * T, T))
    for f, (span, alpha) in enumerate(zip((60, 110, 150, 150, 150, 150), (255, 255, 235, 180, 110, 50))):
        im = Image.new('RGBA', (T * 4, T * 4))
        d = ImageDraw.Draw(im)
        box = [T * 4 * 0.2, T * 4 * 0.35, T * 4 * 0.8, T * 4 * 0.85]
        d.arc(box, 200, 200 + span, fill=(235, 240, 255, alpha), width=16)
        d.arc([v + 10 for v in box[:2]] + [v - 10 for v in box[2:]], 200, 200 + span,
              fill=(150, 170, 255, alpha), width=6)
        out.alpha_composite(im.resize((T, T), Image.LANCZOS), (f * T, 0))
    return out


# ─── content ─────────────────────────────────────────────────────────────────
def loot(*drops):
    return [{'itemId': i, 'chance': c, 'quantity': q} for i, c, q in drops]


# The dead that walk the woods on an ordinary night. The siege raises more of
# the same through the module, with the stats in its config.
DEAD = {
    'risen': {'name': 'Risen', 'maxHealth': 30, 'attack': 3, 'behavior': 'hostile', 'experienceValue': 10,
              'itemsToDrop': loot((GOLD, 0.6, 2), (HOLY_WATER, 0.08, 1))},
    'bone-knight': {'name': 'Bone Knight', 'maxHealth': 70, 'attack': 7, 'behavior': 'hostile',
                    'experienceValue': 30, 'itemsToDrop': loot((GOLD, 1, 4), (AXE, 0.15, 1), (HOLY_WATER, 0.2, 1))},
    'grave-robber': {'name': 'Grave Robber', 'maxHealth': 45, 'attack': 6, 'behavior': 'aggressive',
                     'experienceValue': 25, 'moveIntervalMs': 700, 'itemsToDrop': loot((GOLD, 1, 6))},
    'warlock': {'name': 'Bone Warlock', 'maxHealth': 55, 'attack': 9, 'behavior': 'hostile',
                'experienceValue': 35, 'itemsToDrop': loot((HOLY_WATER, 0.4, 1), (GOLD, 1, 5))},
}
NPCS = [
    {'id': 'agathe', 'name': 'Sister Agathe', 'sprite': SPRITE['sister'], 'maxHealth': 100, 'attack': 0,
     'behavior': 'friendly', 'dialogId': 'agathe'},
    {'id': 'hobb', 'name': 'Hobb, gravedigger', 'sprite': SPRITE['gravedigger'], 'maxHealth': 100, 'attack': 0,
     'behavior': 'friendly', 'dialogId': 'hobb'},
    {'id': 'brand', 'name': 'Captain Brand', 'sprite': SPRITE['captain'], 'maxHealth': 100, 'attack': 0,
     'behavior': 'friendly', 'dialogId': 'brand'},
] + [dict(stats, id=npc, sprite=SPRITE[npc], respawnMs=30000) for npc, stats in DEAD.items()]
SHOPS = [{'id': 'hobb', 'name': "Hobb's Grave Goods", 'products': [
    {'itemId': HOLY_WATER, 'currency': GOLD, 'price': 10},
    {'itemId': CIDER, 'currency': GOLD, 'price': 4},
    {'itemId': AXE, 'currency': GOLD, 'price': 25},
    {'itemId': BLADE, 'currency': GOLD, 'price': 120},
]}]
QUESTS = [
    {'id': 'lay-them-down', 'name': 'Lay Them Down',
     'description': 'Sister Agathe wants six Risen back in the ground.',
     'objective': {'type': 'kill', 'npcId': 'risen', 'count': 6},
     'reward': {'experience': 60, 'items': [{'itemId': HOLY_WATER, 'quantity': 2}]}},
    {'id': 'bone-knights', 'name': 'The Bone Knights',
     'description': 'Captain Brand wants the woods cleared of Bone Knights before the bell.',
     'objective': {'type': 'kill', 'npcId': 'bone-knight', 'count': 3},
     'reward': {'experience': 120, 'items': [{'itemId': GOLD, 'quantity': 40}]}},
]
BYE = {'label': 'Goodbye.'}
DIALOGS = [
    {'id': 'agathe', 'name': 'Sister Agathe', 'nodes': [
        {'id': 'hello', 'text': 'While the shrine burns, this ground is ours. Fall out there and you wake here, '
                                'by its candles - the living, anyway.',
         'choices': [{'label': 'What walks the woods?', 'next': 'woods'},
                     {'label': 'Can I help?', 'next': 'help'}, BYE]},
        {'id': 'woods', 'text': 'Risen, mostly. Bone Knights along the east road. Robbers who were robbers '
                                'before they died, and the warlocks who raised them.',
         'choices': [{'label': 'Can I help?', 'next': 'help'}, BYE]},
        {'id': 'help', 'text': 'Put six Risen back in the ground. Holy water for your trouble.',
         'choices': [{'label': "I'll do it.", 'action': 'questStart:lay-them-down'}, BYE]},
    ]},
    {'id': 'hobb', 'name': 'Hobb, gravedigger', 'nodes': [
        {'id': 'hello', 'text': 'I dig by day and sell by night. Stand on the planks by my table and see '
                                'what the dead left me.',
         'choices': [{'label': 'Business is good?', 'next': 'trade'}, BYE]},
        {'id': 'trade', 'text': 'Never better. Nobody stays buried round here.', 'choices': [BYE]},
    ]},
    {'id': 'brand', 'name': 'Captain Brand', 'nodes': [
        {'id': 'hello', 'text': 'Two gates, one fence and whoever answers the bell. When it tolls, the '
                                'Ossuary Lord sends all he has.',
         'choices': [{'label': 'What happens then?', 'next': 'siege'},
                     {'label': 'Anything I can do now?', 'next': 'work'}, BYE]},
        {'id': 'siege', 'text': 'The night goes black and they come in waves, more for every blade on the '
                                'wall. Hold both gates until the Lord himself walks out of the trees.',
         'choices': [{'label': 'Anything I can do now?', 'next': 'work'}, BYE]},
        {'id': 'work', 'text': 'Thin them out. Three Bone Knights off the east road, and there is gold in it.',
         'choices': [{'label': 'Consider it done.', 'action': 'questStart:bone-knights'}, BYE]},
    ]},
]


def reachable(m, starts):
    """Steps from the nearest start to every walkable cell, the way an npc's
    path search walks the grid."""
    far = {s: 0 for s in starts}
    queue = list(starts)
    for c, r in queue:
        for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (c + dc, r + dr)
            if n not in far and 0 <= n[0] < COLS and 0 <= n[1] < ROWS and n not in m.blocked:
                far[n] = far[c, r] + 1
                queue.append(n)
    return far


def siege_config(m, lamps, sheet):
    """What modules/gravewatch needs to know about the map build.py made, and
    the lamps' light: render_lights()'s rects and the sheet they are on."""
    x0, y0, x1, y1 = FENCE
    to_gate = reachable(m, [GATE_SW, GATE_SE])
    # Where the horde climbs out: outside, a clearing's walk from a gate, near
    # enough that the dead find their way in by the path search alone.
    spawn = sorted(cell for cell, d in to_gate.items()
                   if 9 <= d <= 13 and not (x0 <= cell[0] <= x1 and y0 <= cell[1] <= y1)
                   and cell not in m.taken)
    assert len(spawn) >= 12, 'too few places for the dead to rise'
    kinds = {npc: {k: v for k, v in DEAD[npc].items() if k in ('name', 'maxHealth', 'attack', 'experienceValue')}
             | {'sprite': SPRITE[npc]} for npc in DEAD}
    kinds['ossuary-lord'] = {'name': 'The Ossuary Lord', 'maxHealth': 900, 'attack': 18, 'experienceValue': 500,
                             'sprite': SPRITE['ossuary-lord']}
    return {'mapId': '1', 'ambient': 0.6, 'siegeAmbient': 0.84, 'lamps': lamps, 'lightSheet': sheet,
            'spawnPoints': spawn, 'waveSeconds': 30, 'base': 3, 'perPlayer': 2, 'maxAlive': 45,
            'bossWave': 6, 'gold': GOLD, 'kinds': kinds}


# theme/theme.json: what the admin Appearance page edits, so an operator can
# retune the colours without touching theme.css.
THEME = {
    'colors': {'primary': '#5b5f8f', 'accent': '#f2a44b', 'background': '#0d0e16',
               'surface': '#1a1b27', 'text': '#ece8dc', 'danger': '#b3313f'},
    'corners': 'soft', 'font': 'system', 'layout': 'overlay', 'art': 'smooth', 'dialogDim': True,
}


def save_theme_image(directory, slot, im, fmt, **opts):
    """Saves a picture under the name the Appearance page would give it, its
    slot and a hash of its bytes, and drops the one it replaces."""
    buf = io.BytesIO()
    im.save(buf, fmt, **opts)
    data = buf.getvalue()
    name = f"{slot}-{hashlib.sha256(data).hexdigest()[:8]}.{'jpg' if fmt == 'JPEG' else fmt.lower()}"
    for old in os.listdir(directory):
        if old.startswith(slot + '-') and old != name:
            os.remove(os.path.join(directory, old))
    with open(os.path.join(directory, name), 'wb') as f:
        f.write(data)
    return name


def save_sheet(im, path):
    """A sheet as 256 colours where Pillow has libimagequant: a third of the
    bytes, and nothing an eye finds at the size the game draws it."""
    if features.check('libimagequant'):
        im = im.quantize(256, method=Image.Quantize.LIBIMAGEQUANT, dither=Image.Dither.FLOYDSTEINBERG)
    im.save(path, optimize=True)


def write_json(path, value, compact=False):
    with open(path, 'w') as f:
        json.dump(value, f, separators=(',', ':') if compact else None, indent=None if compact else 1)
        f.write('\n')


def main():
    kit = build_kit()
    frames, ids = cut_kit(kit, render_kit(kit))
    m = build_map(kit)
    tiles = lay_out(m, ids)
    atlas, meta = pack_atlas(frames)
    sheet = render_characters()
    items = render_items()
    lights, lamps = render_lights(kit, ids)

    assets = os.path.join(HERE, 'assets')
    content = os.path.join(HERE, 'content')
    theme = os.path.join(HERE, 'theme')
    module = os.path.join(HERE, 'modules', 'gravewatch')
    for d in (assets, content, theme, module):
        os.makedirs(d, exist_ok=True)
    save_sheet(atlas, os.path.join(assets, 'tiles.png'))
    write_json(os.path.join(assets, 'tiles.json'), meta)
    save_sheet(sheet, os.path.join(assets, 'sprites.png'))
    write_json(os.path.join(assets, 'sprites.json'),
               {'width': F, 'height': F, 'anchorX': ANCHOR[0] * S, 'anchorY': ANCHOR[1] * S, 'scale': 1 / S,
                'columns': 6, 'idleColumn': IDLE, 'attackColumn': ATTACK})
    items.save(os.path.join(assets, 'items.png'))
    swing().save(os.path.join(assets, 'attackeffect.png'))
    Image.new('RGBA', (T, T)).save(os.path.join(assets, 'spells.png'))
    Image.new('RGBA', (32, 32)).save(os.path.join(assets, 'arrows.png'))

    game_map = {'id': '1', 'name': 'Gravewatch', 'type': 'normal', 'orientation': 'isometric',
                'tiles': tiles, 'droppedItems': []}
    write_json(os.path.join(content, 'maps.json'), [game_map], compact=True)
    write_json(os.path.join(content, 'npcs.json'), NPCS)
    write_json(os.path.join(content, 'items.json'), [dict(item, sprite=i) for i, (item, _) in enumerate(ITEMS)])
    write_json(os.path.join(content, 'shops.json'), SHOPS)
    write_json(os.path.join(content, 'quests.json'), QUESTS)
    write_json(os.path.join(content, 'dialogs.json'), DIALOGS)
    write_json(os.path.join(module, 'module.json'), {
        'id': 'gravewatch', 'name': 'Gravewatch', 'version': '1.0.0', 'server': 'server.js', 'client': 'client.js',
        'description': 'The night over the churchyard, and the siege an operator calls with the `siege` flag.',
        'dependencies': ['lighting'], 'config': siege_config(m, lamps, save_theme_image(theme, 'lights', lights, 'PNG'))})

    cast_ = [figure(sheet, 'knight', 1, ATTACK) + ((21, 25),),
             figure(sheet, 'risen', 2, ATTACK) + ((20, 25),),
             figure(sheet, 'bone-knight', 1, 1) + ((20, 27),),
             figure(sheet, 'sister', 0) + (NPC_POST_OF['agathe'],),
             figure(sheet, 'captain', 0) + (NPC_POST_OF['brand'],),
             figure(sheet, 'gravedigger', 2) + (NPC_POST_OF['hobb'],),
             figure(sheet, 'grave-robber', 3, 2) + ((23, 31),),
             figure(sheet, 'warlock', 1, ATTACK) + ((32, 19),),
             figure(sheet, 'ossuary-lord', 1) + ((31, 21),)]
    scene = preview(tiles, frames, cast_)
    if '--preview' in sys.argv:
        scene.save(sys.argv[sys.argv.index('--preview') + 1])
    # The login backdrop: the churchyard, out of focus.
    cx, cy = cell_centre(20, 21)
    backdrop = scene.crop((cx - 800 * S, cy - 450 * S, cx + 800 * S, cy + 450 * S)).resize(
        (1600, 900), Image.LANCZOS).filter(ImageFilter.GaussianBlur(3))
    # The logo: the crypt, and the knight at its door.
    logo = Image.new('RGBA', (RENDER_W, RENDER_H))
    for c, r in sorted(next(p for p in kit if p['name'] == 'crypt')['cells'], key=sum):
        im, (ax, ay), _ = frames[ids['crypt', 0, (c, r)]]
        cx, cy = cell_centre(CRYPT[0] + c, CRYPT[1] + r)
        logo.alpha_composite(im, (cx - ax, cy - ay))
    knight, (ax, ay) = figure(sheet, 'knight', 0)
    cx, cy = cell_centre(CRYPT[0] + 1, CRYPT[1] + 4)
    logo.alpha_composite(knight, (cx - ax, cy - ay))
    logo = logo.crop(logo.getbbox())
    logo = logo.resize((logo.width * 152 // logo.height, 152), Image.LANCZOS)
    write_json(os.path.join(theme, 'theme.json'), dict(
        THEME,
        logo=save_theme_image(theme, 'logo', logo, 'PNG'),
        background=save_theme_image(theme, 'background', backdrop.convert('RGB'), 'JPEG', quality=86)))
    print(f'{len(frames)} frames ({len(kit)} pieces), atlas {atlas.width}x{atlas.height}, '
          f'{len(CHARACTERS)} characters, {len(ITEMS)} items')


if __name__ == '__main__':
    main()
