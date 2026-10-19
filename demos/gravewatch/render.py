"""Gravewatch's renderer: KayKit models drawn the way the engine projects an
isometric map - an orthographic camera 30 degrees above the ground, turned
45, so a 2x2 unit cell comes out as the engine's 64x32 diamond.

    blender -b --python render.py -- job.json

build.py writes the job and cuts up what this writes. World units: a cell is
2 units, column c runs along +x and row r along -y, so cell (c, r) is centred
on (2c + 1, -(2r + 1)) and the world origin lands on the engine's view origin.
The job's `scale` is pixels rendered per pixel the engine draws: at 2 the
diamond is 128x64.

The map is not rendered: the kit it is laid out from is, a piece at a time.
  piece   a model or a few, alone on the ground with their shadow caught, and
          with `ids` an id.png beside it: each pixel coloured by its cell,
          red the column, green the row, blue 255. A model given a `cell`
          is all that cell's; the others are cut by the cell under each of
          their points, which is how a crypt three cells wide becomes frames
          that sort with the actors one cell at a time.
  ground  a stretch of ground that repeats every few cells, rendered seamless
          so that any cell of a map can take the frame its position names.
  light   a piece lit by its own flames alone, on a plain ground and over
          black, its shadows cast: the light a lamp throws, which the client
          adds over the night wherever the piece is put.
"""
import json
import math
import sys

import bpy
from mathutils import Matrix, Vector

job = json.load(open(sys.argv[sys.argv.index('--') + 1]))
OUT = job['out']  # every item's `out` is relative to this
CAM_ROT = (math.radians(60), 0.0, math.radians(45))
S = job.get('scale', 1)
PPU = S * 64 / (2 * math.sqrt(2))  # a cell's 2 units of diagonal onto 64 px
LIBRARY = {}  # model() imports, by path and tint
# What the glTF importer gives the weapons that ship inside a KayKit
# character, by the hand that holds them: the Y-up to Z-up turn, and the grip
# moved from the bone's tail back to where the hand closes.
GRIPS = {
    'right': Matrix(((-1, 0, 0, 0), (0, 0, 1, -0.079), (0, 1, 0, 0), (0, 0, 0, 1))),
    'left': Matrix(((1, 0, 0, 0), (0, 0, 1, -0.095), (0, -1, 0, 0), (0, 0, 0, 1))),
    'shield': Matrix(((1, 0, 0, 0), (0, 0, 1, -0.095), (0, -1, 0, 0.156), (0, 0, 0, 1))),
}


def lin(hex_colour):
    """An sRGB hex colour as the linear RGBA Blender's nodes take."""
    c = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c) + (1.0,)


def moon(steep):
    """Toward the moon: the top left of the screen and a little in front,
    the side every sprite in the game is lit from. A frame that has to hold
    its own shadow - a character, a piece of the kit - is lit by the same
    moon higher up, so the shadow pools at its feet."""
    right = Vector((1, 1, 0)).normalized()
    toward = Vector((1, -1, 0)).normalized()
    if steep:
        return (-right * 0.3 + toward * 0.2 + Vector((0, 0, 1.1))).normalized()
    return (-right * 0.7 + toward * 0.45 + Vector((0, 0, 1.1))).normalized()


def reset(catcher, steep=False, boost=1):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    LIBRARY.clear()  # its meshes went with the scene
    WICKS.clear()
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = job.get('samples', 48)
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    light = job['light']
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = lin(light['sky'])
    bg.inputs[1].default_value = light['sky_strength']
    scene.world = world

    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.rotation_euler = CAM_ROT
    forward = cam.rotation_euler.to_matrix() @ Vector((0, 0, -1))
    cam.location = -forward * 120
    cam.data.clip_end = 400
    scene.collection.objects.link(cam)
    scene.camera = cam

    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = light['sun'] * boost
    sun.data.color = lin(light['sun_colour'])[:3]
    sun.data.angle = math.radians(6)
    sun.rotation_euler = (-moon(steep)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(sun)

    if catcher:
        bpy.ops.mesh.primitive_plane_add(size=40)
        bpy.context.object.is_shadow_catcher = True
    return scene, cam


def frame(scene, cam, size, anchor, ppu=PPU):
    """Size the image and put the world origin on pixel `anchor`."""
    w, h = size
    scene.render.resolution_x, scene.render.resolution_y = w, h
    cam.data.ortho_scale = max(w, h) / ppu
    cam.data.shift_x = (w / 2 - anchor[0]) / max(w, h)
    cam.data.shift_y = (anchor[1] - h / 2) / max(w, h)


def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def render_to(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def tinted(material, tint):
    """A copy of a KayKit material with its palette texture shifted, for the
    packs' autumn pines turned into a graveyard's black firs."""
    m = material.copy()
    nt = m.node_tree
    tex = next(n for n in nt.nodes if n.type == 'TEX_IMAGE')
    link = next(l for l in nt.links if l.from_node == tex and l.from_socket.name == 'Color')
    hsv = nt.nodes.new('ShaderNodeHueSaturation')
    hsv.inputs['Hue'].default_value = tint.get('hue', 0.5)
    hsv.inputs['Saturation'].default_value = tint.get('saturation', 1)
    hsv.inputs['Value'].default_value = tint.get('value', 1)
    target = link.to_socket
    nt.links.new(tex.outputs['Color'], hsv.inputs['Color'])
    nt.links.new(hsv.outputs['Color'], target)
    return m


# ─── characters ──────────────────────────────────────────────────────────────
def character(spec):
    scene, cam = reset(catcher=True, steep=True, boost=job['light'].get('figure_boost', 1))
    if job['light'].get('figure_fill'):
        # Low from the front and right, against the moon: the lamps' light.
        energy, colour = job['light']['figure_fill']
        right, front = Vector((1, 1, 0)).normalized(), Vector((1, -1, 0)).normalized()
        fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'SUN'))
        fill.data.energy = energy
        fill.data.color = lin(colour)[:3]
        fill.data.angle = math.radians(20)
        toward = (front + right * 0.4 + Vector((0, 0, 0.35))).normalized()
        fill.rotation_euler = (-toward).to_track_quat('-Z', 'Y').to_euler()
        scene.collection.objects.link(fill)
    objs = load(spec['model'])
    rig = next(o for o in objs if o.type == 'ARMATURE')
    rig.rotation_mode = 'XYZ'
    rig.scale = [spec.get('scale', 1)] * 3
    keep = set(spec.get('show', []))
    for o in objs:
        if o.type == 'MESH' and (o.parent_bone or o.parent is None):
            o.hide_render = o.name not in keep
    for held in spec.get('attach', []):
        for o in load(held['model']):
            if o.type != 'MESH':
                continue
            o.parent = rig
            o.parent_type = 'BONE'
            o.parent_bone = 'handslot.l' if held['grip'] != 'right' else 'handslot.r'
            o.matrix_parent_inverse = Matrix.Identity(4)
            o.matrix_basis = GRIPS[held['grip']]
    if spec.get('tint'):
        for o in objs:
            if o.type == 'MESH':
                o.data.materials[0] = tinted(o.data.materials[0], spec['tint'])
    frame(scene, cam, spec['size'], spec['anchor'], spec['ppu'])
    # Facing per engine direction row: Down, Left, Right, Up are the grid
    # moves (row+1, col-1, col+1, row-1), which face -y, -x, +x, +y. KayKit
    # characters face -y.
    turns = [0.0, -math.pi / 2, math.pi / 2, math.pi]
    for anim in spec['anims']:
        action = bpy.data.actions[anim['action']]
        rig.animation_data_create()
        rig.animation_data.action = action
        if hasattr(rig.animation_data, 'action_slot') and action.slots:
            rig.animation_data.action_slot = action.slots[0]
        start, end = action.frame_range
        for d, turn in enumerate(turns):
            rig.rotation_euler = (0, 0, turn)
            for i, t in enumerate(anim['at']):
                scene.frame_set(int(round(start + t * (end - start))))
                render_to(scene, f"{OUT}/{spec['out']}/{anim['name']}_{d}_{i}.png")


# ─── item icons ──────────────────────────────────────────────────────────────
def icon(spec):
    """One model turned to show its best side, filling a square."""
    scene, cam = reset(catcher=False)
    objs = load(spec['model'])
    for o in objs:
        if o.parent is None:
            o.rotation_mode = 'XYZ'
            o.rotation_euler = [math.radians(a) for a in spec.get('rotate', (0, 0, 0))]
    bpy.context.view_layer.update()
    rot = cam.rotation_euler.to_matrix()
    right, up = rot @ Vector((1, 0, 0)), rot @ Vector((0, 1, 0))
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == 'MESH' for c in o.bound_box]
    xs, ys = [p.dot(right) for p in pts], [p.dot(up) for p in pts]
    side = spec['size']
    ppu = (side - 2 * spec.get('pad', 5)) / max(max(xs) - min(xs), max(ys) - min(ys))
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    frame(scene, cam, (side, side), (side / 2 - cx * ppu, side / 2 + cy * ppu), ppu)
    render_to(scene, f"{OUT}/{spec['out']}")


# ─── the kit ─────────────────────────────────────────────────────────────────
def model(path, tint):
    """A model's meshes and where they sit relative to its origin, imported
    once however many pieces use it."""
    key = (path, json.dumps(tint, sort_keys=True))
    if key not in LIBRARY:
        objs = load(path)
        bpy.context.view_layer.update()
        parts = []
        for o in objs:
            if o.type != 'MESH':
                continue
            data = o.data
            if tint:
                data = data.copy()
                for i, m in enumerate(data.materials):
                    data.materials[i] = tinted(m, tint)
            parts.append((data, o.matrix_world.copy()))
        for o in objs:
            bpy.data.objects.remove(o)
        LIBRARY[key] = parts
    return LIBRARY[key]


# The wick's brown in the KayKit palettes, as the texture stores it.
WICK = ((0.38, 0.33, 0.29), (0.36, 0.31, 0.28))
WICKS = {}  # wicks(), by mesh


def wicks(data):
    """The top of each wick in a mesh: its faces painted the palette's wick
    brown, gathered by where they stand."""
    if data.name not in WICKS:
        pixels = {}
        tops = []
        uv = data.uv_layers.active.data
        for poly in data.polygons:
            nodes = data.materials[poly.material_index].node_tree.nodes
            img = next(n.image for n in nodes if n.type == 'TEX_IMAGE')
            if img.name not in pixels:
                pixels[img.name] = img.pixels[:]
            w, h = img.size
            u = sum(uv[i].uv[0] for i in poly.loop_indices) / poly.loop_total % 1
            v = sum(uv[i].uv[1] for i in poly.loop_indices) / poly.loop_total % 1
            k = 4 * (min(h - 1, int(v * h)) * w + min(w - 1, int(u * w)))
            colour = pixels[img.name][k:k + 3]
            if not any(all(abs(a - b) < 0.015 for a, b in zip(colour, c)) for c in WICK):
                continue
            top = max((data.vertices[i].co for i in poly.vertices), key=lambda co: co.z)
            near = next((t for t in tops if (t.xy - poly.center.xy).length < 0.06), None)
            if near is None:
                tops.append(Vector((poly.center.x, poly.center.y, top.z)))
            elif top.z > near.z:
                near.z = top.z
        WICKS[data.name] = tops
    return WICKS[data.name]


def flame_mesh():
    """A flame standing on the origin: a drop of light, white at its heart
    and orange at its edge."""
    if 'flame' not in bpy.data.meshes:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.06)
        o = bpy.context.object
        # A ball pulled up into a point, over the wick's tip.
        for v in o.data.vertices:
            t = v.co.z / 0.06
            if t > 0:
                v.co.xy *= 1 - 0.6 * t
            v.co.z = (0.084 * (t + 1) if t < 0 else 0.084 + 0.18 * t) - 0.03
        m = bpy.data.materials.new('flame')
        m.use_nodes = True
        N, L = m.node_tree.nodes, m.node_tree.links
        N.clear()
        out = N.new('ShaderNodeOutputMaterial')
        emit = N.new('ShaderNodeEmission')
        emit.inputs['Strength'].default_value = 1.6
        rim = N.new('ShaderNodeLayerWeight')
        rim.inputs['Blend'].default_value = 0.35
        ramp = N.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = lin('#fff4cc')
        ramp.color_ramp.elements[1].color = lin('#ff7a1f')
        L.new(rim.outputs['Facing'], ramp.inputs['Fac'])
        L.new(ramp.outputs['Color'], emit.inputs['Color'])
        L.new(emit.outputs[0], out.inputs['Surface'])
        o.data.materials.append(m)
        o.data.name = 'flame'
        bpy.data.objects.remove(o)
    return bpy.data.meshes['flame']


def place(scene, placements):
    """Each model where its placement says. One with a `cell` is that cell's
    in id.png; the rest are cut by the cell under each of their points."""
    objs = []
    for p in placements:
        m = (Matrix.Translation(p['at'])
             @ Matrix.Rotation(math.radians(p.get('turn', 0)), 4, 'Z')
             @ Matrix.Scale(p.get('scale', 1), 4))
        for data, local in model(p['model'], p.get('tint')):
            o = bpy.data.objects.new(p['name'], data)
            o.matrix_world = m @ local
            scene.collection.objects.link(o)
            cell = p.get('cell')
            o.color = (cell[0] / 255, cell[1] / 255, 1, 1) if cell else (0, 0, 1, 0)
            objs.append(o)
            # The packs' candles end in a bare wick: one that gives light is
            # given a flame on each, bright on its own, as no lamp lights it.
            # Near the light only: the palette's wick brown is a post's wood
            # too, and a candle's wick is never far from its flame's light.
            for tip in [o.matrix_world @ t for t in wicks(data)] if p.get('lights') else ():
                if all((tip - Vector(l['at'])).length > 0.8 for l in p.get('lights', ())):
                    continue
                f = bpy.data.objects.new('flame', flame_mesh())
                f.matrix_world = Matrix.Translation(tip)
                f.color = o.color
                f.visible_shadow = False
                scene.collection.objects.link(f)
                objs.append(f)
    for l in [l for p in placements for l in p.get('lights', ())]:
        pl = bpy.data.objects.new('lamp', bpy.data.lights.new('lamp', 'POINT'))
        pl.data.energy = l['energy']
        pl.data.color = lin(l['colour'])[:3]
        pl.data.shadow_soft_size = 0.1
        # A flame lights the piece and casts nothing: it sits in the wax or
        # the lantern's glass, and the shadow catcher would ring the base
        # with the dark of everything round it.
        pl.data.use_shadow = False
        pl.location = l['at']
        scene.collection.objects.link(pl)
    return objs


def id_material():
    """What id.png is drawn with: each point's cell as a colour."""
    m = bpy.data.materials.new('cell-id')
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    N.clear()
    out = N.new('ShaderNodeOutputMaterial')
    emit = N.new('ShaderNodeEmission')
    L.new(emit.outputs[0], out.inputs['Surface'])
    info = N.new('ShaderNodeObjectInfo')
    geo = N.new('ShaderNodeNewGeometry')
    sep = N.new('ShaderNodeSeparateXYZ')
    L.new(geo.outputs['Position'], sep.inputs[0])

    def cell(axis, k):
        scale = N.new('ShaderNodeMath')
        scale.operation = 'MULTIPLY'
        scale.inputs[1].default_value = k
        L.new(sep.outputs[axis], scale.inputs[0])
        fl = N.new('ShaderNodeMath')
        fl.operation = 'FLOOR'
        L.new(scale.outputs[0], fl.inputs[0])
        byte = N.new('ShaderNodeMath')
        byte.operation = 'DIVIDE'
        byte.inputs[1].default_value = 255
        L.new(fl.outputs[0], byte.inputs[0])
        return byte.outputs[0]

    under = N.new('ShaderNodeCombineColor')
    L.new(cell('X', 0.5), under.inputs[0])
    L.new(cell('Y', -0.5), under.inputs[1])
    under.inputs[2].default_value = 1.0
    mx = N.new('ShaderNodeMix')
    mx.data_type = 'RGBA'
    L.new(info.outputs['Alpha'], mx.inputs['Factor'])
    L.new(under.outputs[0], mx.inputs['A'])
    L.new(info.outputs['Color'], mx.inputs['B'])
    L.new(mx.outputs['Result'], emit.inputs['Color'])
    return m


def piece(spec):
    """One piece of the kit alone on the ground, its shadow caught under it.

    color.png  the piece, the world origin on meta.json's `anchor`
    id.png     with `ids`: each pixel's cell, as the map render used to give
    """
    scene, cam = reset(catcher=True, steep=True)
    catcher = next(o for o in scene.objects if o.is_shadow_catcher)
    catcher.color = (0, 0, 1, 0)
    objs = place(scene, spec['placements'])
    bpy.context.view_layer.update()

    # The frame: every corner of what was placed, and of its shadow.
    rot = cam.rotation_euler.to_matrix()
    right, up = rot @ Vector((1, 0, 0)), rot @ Vector((0, 1, 0))
    to_light = moon(steep=True)
    xs, ys = [], []
    for o in objs:
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            for q in (p, p - (max(p.z, 0) / to_light.z) * to_light):
                xs.append(q.dot(right) * PPU)
                ys.append(-q.dot(up) * PPU)
    x0, y0 = math.floor(min(xs)) - 6 * S, math.floor(min(ys)) - 6 * S
    x1, y1 = math.ceil(max(xs)) + 6 * S, math.ceil(max(ys)) + 6 * S
    size, anchor = (x1 - x0, y1 - y0), (-x0, -y0)
    frame(scene, cam, size, anchor)
    out = f"{OUT}/{spec['out']}"
    render_to(scene, f'{out}/color.png')
    with open(f'{out}/meta.json', 'w') as f:
        json.dump({'anchor': anchor, 'size': size}, f)
    if not spec.get('ids'):
        return

    catcher.is_shadow_catcher = False
    scene.view_layers[0].material_override = id_material()
    for l in bpy.data.lights:
        l.energy = 0
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0
    scene.view_settings.view_transform = 'Raw'
    scene.render.dither_intensity = 0
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    scene.cycles.filter_width = 0.01
    render_to(scene, f'{out}/id.png')


def ground(spec):
    """A ground that repeats every `period` cells: a texture that wraps on
    itself, and models laid out the same in every period, rendered over the
    cells 0..period-1 with a period of the same all round them."""
    scene, cam = reset(catcher=False, steep=True)
    n = spec['period']
    bpy.ops.mesh.primitive_plane_add(size=1, location=(n, -n, 0))
    plane = bpy.context.object
    plane.scale = (6 * n, 6 * n, 1)
    m = bpy.data.materials.new('ground')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Specular IOR Level'].default_value = 0.2
    uv = nt.nodes.new('ShaderNodeTexCoord')
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (3, 3, 1)
    img = nt.nodes.new('ShaderNodeTexImage')
    img.image = bpy.data.images.load(spec['texture'])
    img.interpolation = 'Cubic'
    img.extension = 'REPEAT'
    nt.links.new(uv.outputs['UV'], mapping.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], img.inputs['Vector'])
    nt.links.new(img.outputs['Color'], bsdf.inputs['Base Color'])
    plane.data.materials.append(m)
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            place(scene, [dict(p, at=[p['at'][0] + 2 * n * i, p['at'][1] - 2 * n * j, p['at'][2]])
                          for p in spec['placements']])
    frame(scene, cam, (n * 64 * S, n * 32 * S), (n * 32 * S, 0))
    render_to(scene, f"{OUT}/{spec['out']}/ground.png")


def light(spec):
    """What a piece's own flames throw on it and on the ground round it, over
    black: the light alone, for the client to add over the night wherever the
    piece stands. The ground is one plain colour, whatever lies under the
    piece on a map; `gain` scales the flames' strength in the piece's own
    render, which lights the piece and not the ground round it.

    color.png  the light, the world origin on meta.json's `anchor`
    """
    scene, cam = reset(catcher=False, steep=True)
    bpy.data.objects.remove(scene.objects['sun'])
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0
    scene.render.film_transparent = False
    bpy.ops.mesh.primitive_plane_add(size=80)
    m = bpy.data.materials.new('ground')
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = lin(spec['ground'])
    bsdf.inputs['Roughness'].default_value = 1.0
    bpy.context.object.data.materials.append(m)
    objs = place(scene, spec['placements'])
    for light in [light for p in spec['placements'] for light in p.get('inside', ())]:
        pl = bpy.data.objects.new('inside', bpy.data.lights.new('inside', 'POINT'))
        pl.data.energy = light['energy']
        pl.data.color = lin(light['colour'])[:3]
        pl.data.shadow_soft_size = 0.3
        pl.location = light['at']
        scene.collection.objects.link(pl)
    # Here a flame casts shadows (the stone behind a candle, the post under a
    # lantern), all but its own model's, the wax or the glass it sits in.
    lit = {p['name'] for p in spec['placements'] if p.get('lights')}
    for o in objs:
        if o.name.split('.')[0] == 'flame':
            o.visible_camera = False  # the piece's own frame has it
        elif o.name.split('.')[0] in lit:
            o.visible_shadow = False
    lamps = [o for o in scene.objects if o.type == 'LIGHT']
    for o in lamps:
        o.data.use_shadow = True
        o.data.energy *= spec['gain']
    bpy.context.view_layer.update()

    # The frame: the piece, and the ground `reach` units round each flame.
    rot = cam.rotation_euler.to_matrix()
    right, up = rot @ Vector((1, 0, 0)), rot @ Vector((0, 1, 0))
    points = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    for o in lamps:
        points += [Vector((o.location.x + spec['reach'] * math.cos(k * math.pi / 8),
                           o.location.y + spec['reach'] * math.sin(k * math.pi / 8), 0)) for k in range(16)]
    xs = [p.dot(right) * PPU for p in points]
    ys = [-p.dot(up) * PPU for p in points]
    x0, y0 = math.floor(min(xs)), math.floor(min(ys))
    size, anchor = (math.ceil(max(xs)) - x0, math.ceil(max(ys)) - y0), (-x0, -y0)
    frame(scene, cam, size, anchor)
    out = f"{OUT}/{spec['out']}"
    render_to(scene, f'{out}/color.png')
    with open(f'{out}/meta.json', 'w') as f:
        json.dump({'anchor': anchor, 'size': size}, f)


KINDS = {'character': character, 'icon': icon, 'piece': piece, 'ground': ground, 'light': light}
for spec in job['items']:
    KINDS[spec['kind']](spec)
