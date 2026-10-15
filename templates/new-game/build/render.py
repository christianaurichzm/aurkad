"""new-game's renderer: KayKit models (Kay Lousberg, CC0) drawn the way the
engine projects a map, for build.py to cut into sheets.

    blender -b --python render.py -- <out> <view> <samples> <what>

`view` is `ortho` - an orthographic camera 30 degrees above the ground,
looking north: props and characters seen nearly from the front, as a 2D
artist draws them, over ground that build.py paints flat - or `iso`, the same
camera turned 45 degrees, which puts a cell on the engine's 2:1 diamond.
`what` is props, chars, items or all. Everything is rendered at twice the
pixels the engine draws.

World units: a cell is 2 units. KayKit characters face -y, which is the
engine's Down in both views.

    <out>/props/<name>_object.png, _shadow.png   a prop alone, and its shadow alone
    <out>/props.json                              each prop's foot pixel
    <out>/chars/<name>/<anim>_<dir>_<i>.png       a character frame, its foot on FOOT
    <out>/items/<name>.png                        an icon, ICON square
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
OUT, VIEW, SAMPLES, WHAT = args[0], args[1], int(args[2]), args[3]
KK = os.environ.get('KAYKIT') or os.path.expanduser('~/Downloads/iso/kaykit')
FOREST = KK + '/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/'
DUNGEON = KK + '/KayKit-Dungeon-Remastered-1.0-main/addons/kaykit_dungeon_remastered/Assets/gltf/'
HERO = KK + '/KayKit-Character-Pack-Adventures-1.0-main/addons/kaykit_character_pack_adventures/'
SKEL = KK + '/KayKit-Character-Pack-Skeletons-1.0-main/addons/kaykit_character_pack_skeletons/'

# Pixels per world unit. Orthogonal: a cell's 2 units onto 64 px. Isometric:
# a cell's 2 units of diagonal onto the diamond's 64 px. Characters stand a
# quarter larger than the world they walk in, or a knight would be no taller
# than a barrel.
CAM_ROT = (math.radians(60), 0.0, math.radians(45 if VIEW == 'iso' else 0))
PPU = 2 * (32 if VIEW == 'ortho' else 64 / (2 * math.sqrt(2)))
CHAR_PPU = PPU * 1.25
CHAR_FRAME = 224 if VIEW == 'ortho' else 192
FOOT = (CHAR_FRAME // 2, CHAR_FRAME - 32 if VIEW == 'ortho' else 164)
SUN = (-0.7, -0.45, 1.1)  # toward the sun: the shadows fall to the lower right

GRIPS = {
    'right': Matrix(((-1, 0, 0, 0), (0, 0, 1, -0.079), (0, 1, 0, 0), (0, 0, 0, 1))),
    'left': Matrix(((1, 0, 0, 0), (0, 0, 1, -0.095), (0, -1, 0, 0), (0, 0, 0, 1))),
    'shield': Matrix(((1, 0, 0, 0), (0, 0, 1, -0.095), (0, -1, 0, 0.156), (0, 0, 0, 1))),
}

PROPS = {  # name: (model, scale, turn in degrees)
    'tree_a': (FOREST + 'Tree_1_A_Color1.gltf', 1.0, 20),
    'tree_b': (FOREST + 'Tree_1_C_Color1.gltf', 1.0, 140),
    'tree_c': (FOREST + 'Tree_3_A_Color1.gltf', 1.0, 60),
    'tree_d': (FOREST + 'Tree_3_B_Color1.gltf', 1.0, 200),
    'tree_e': (FOREST + 'Tree_2_B_Color1.gltf', 0.85, 10),
    'tree_f': (FOREST + 'Tree_4_A_Color1.gltf', 0.8, 90),
    'bush_a': (FOREST + 'Bush_2_A_Color1.gltf', 1.0, 30),
    'bush_b': (FOREST + 'Bush_2_C_Color1.gltf', 1.0, 0),
    'bush_c': (FOREST + 'Bush_4_A_Color1.gltf', 1.0, 75),
    'rock_a': (FOREST + 'Rock_1_A_Color1.gltf', 1.5, 40),
    'rock_b': (FOREST + 'Rock_3_B_Color1.gltf', 1.3, 120),
    'rock_c': (FOREST + 'Rock_1_B_Color1.gltf', 1.4, 200),
    'grass_a': (FOREST + 'Grass_1_A_Color1.gltf', 1.2, 10),
    'grass_b': (FOREST + 'Grass_2_A_Color1.gltf', 1.2, 80),
    'grass_c': (FOREST + 'Grass_2_B_Color1.gltf', 1.2, 150),
    'barrel': (DUNGEON + 'barrel_large.gltf.glb', 1.25, 20),
    'crates': (DUNGEON + 'crates_stacked.gltf.glb', 1.25, 15),
}


def held(name, grip='right'):
    return {'model': SKEL + f'Assets/gltf/{name}.gltf', 'grip': grip}


CHARS = {  # name: (model, meshes shown, held, walk, attack, the attack's hit at)
    'knight': (HERO + 'Characters/gltf/Knight.glb',
               ['1H_Sword', 'Round_Shield', 'Knight_Helmet', 'Knight_Cape'], [],
               'Walking_A', '1H_Melee_Attack_Chop', 0.42),
    'mage': (HERO + 'Characters/gltf/Mage.glb', ['Mage_Hat', 'Mage_Cape', '2H_Staff'], [],
             'Walking_A', 'Spellcast_Shoot', 0.3),
    'rogue': (HERO + 'Characters/gltf/Rogue_Hooded.glb', ['Rogue_Cape', 'Knife'], [],
              'Walking_A', '1H_Melee_Attack_Stab', 0.42),
    'skeleton': (SKEL + 'Characters/gltf/Skeleton_Minion.glb', [], [held('Skeleton_Axe')],
                 'Walking_D_Skeletons', '1H_Melee_Attack_Chop', 0.42),
    'bone_knight': (SKEL + 'Characters/gltf/Skeleton_Warrior.glb', ['Skeleton_Warrior_Helmet'],
                    [held('Skeleton_Blade'), held('Skeleton_Shield_Small_A', 'shield')],
                    'Walking_D_Skeletons', '1H_Melee_Attack_Chop', 0.42),
    'barbarian': (HERO + 'Characters/gltf/Barbarian.glb', ['2H_Axe', 'Barbarian_Hat', 'Barbarian_Cape'], [],
                  'Walking_A', '2H_Melee_Attack_Chop', 0.42),
    'hunter': (HERO + 'Characters/gltf/Rogue.glb', ['Rogue_Cape', '1H_Crossbow'], [],
                  'Walking_A', '1H_Ranged_Shoot', 0.3),
    'skeleton_rogue': (SKEL + 'Characters/gltf/Skeleton_Rogue.glb', ['Skeleton_Rogue_Hood', 'Skeleton_Rogue_Cape'],
                       [held('Skeleton_Blade'), held('Skeleton_Blade', 'left')],
                       'Walking_D_Skeletons', 'Dualwield_Melee_Attack_Stab', 0.42),
    'skeleton_mage': (SKEL + 'Characters/gltf/Skeleton_Mage.glb', ['Skeleton_Mage_Hat'], [held('Skeleton_Staff')],
                      'Walking_D_Skeletons', 'Spellcast_Shoot', 0.3),
}

ITEMS = {  # name: (model, rotation in degrees, only this mesh, hue)
    'potion': (DUNGEON + 'bottle_A_labeled_brown.gltf.glb', (0, 0, 20), None, 0.47),
    'coin': (DUNGEON + 'coin_stack_small.gltf.glb', (0, 0, 0), None, None),
    'sword': (HERO + 'Assets/gltf/sword_1handed.gltf', (90, 45, 0), None, None),
    'helmet': (HERO + 'Characters/gltf/Knight.glb', (0, 0, -20), 'Knight_Helmet', None),
    'cider': (HERO + 'Assets/gltf/mug_full.gltf', (0, 0, 30), None, None),
}
ICON = 256


def lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c) + (1.0,)


def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def reset(sun_toward=SUN, rot=CAM_ROT):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = lin('#b4d2ff')
    w.node_tree.nodes['Background'].inputs[1].default_value = 0.9
    scene.world = w
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.clip_end = 400
    cam.rotation_euler = rot
    cam.location = -(cam.rotation_euler.to_matrix() @ Vector((0, 0, -1))) * 120
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.2
    sun.data.color = lin('#fff1dc')[:3]
    sun.data.angle = math.radians(4)
    sun.rotation_euler = (-Vector(sun_toward).normalized()).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(sun)
    bpy.ops.mesh.primitive_plane_add(size=60)
    catcher = bpy.context.object
    catcher.is_shadow_catcher = True
    return scene, cam, catcher


def frame(scene, cam, size, anchor, ppu):
    """Size the image and put the world origin on pixel `anchor`."""
    w, h = size
    scene.render.resolution_x, scene.render.resolution_y = w, h
    cam.data.ortho_scale = max(w, h) / ppu
    cam.data.shift_x = (w / 2 - anchor[0]) / max(w, h)
    cam.data.shift_y = (anchor[1] - h / 2) / max(w, h)


def render_to(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def props():
    feet = {}
    for name, (model, scale, turn) in PROPS.items():
        scene, cam, catcher = reset()
        objs = [o for o in load(model) if o.type == 'MESH']
        for o in objs:
            if o.parent is None:
                o.matrix_world = Matrix.Rotation(math.radians(turn), 4, 'Z') @ Matrix.Scale(scale, 4) @ o.matrix_world
        bpy.context.view_layer.update()
        rot = cam.rotation_euler.to_matrix()
        right, up = rot.col[0], rot.col[1]
        pts = [o.matrix_world @ Vector(k) for o in objs for k in o.bound_box]
        h = max(p.z for p in pts)
        # Room for the shadow, which falls away from the sun along the ground.
        pts += [Vector((dx, dy, 0)) for dx in (-1.5 * h, 1.5 * h) for dy in (-1.5 * h, 1.5 * h)]
        xs = [p.dot(right) * PPU for p in pts]
        ys = [-p.dot(up) * PPU for p in pts]
        size = (int(max(xs) - min(xs)) + 16, int(max(ys) - min(ys)) + 16)
        foot = (-min(xs) + 8, -min(ys) + 8)
        frame(scene, cam, size, foot, PPU)
        catcher.hide_render = True
        render_to(scene, f'{OUT}/props/{name}_object.png')
        catcher.hide_render = False
        for o in objs:
            o.visible_camera = False
        render_to(scene, f'{OUT}/props/{name}_shadow.png')
        feet[name] = foot
    with open(f'{OUT}/props.json', 'w') as f:
        json.dump(feet, f)


def characters():
    turns = [0.0, -math.pi / 2, math.pi / 2, math.pi]  # Down, Left, Right, Up
    for name, (model, show, attach, walk, attack, hit) in CHARS.items():
        scene, cam, _ = reset((-0.4, -0.25, 1.1))
        objs = load(model)
        rig = next(o for o in objs if o.type == 'ARMATURE')
        rig.rotation_mode = 'XYZ'
        for o in objs:
            if o.type == 'MESH' and (o.parent_bone or o.parent is None):
                o.hide_render = o.name not in set(show)
        for h in attach:
            for o in load(h['model']):
                if o.type != 'MESH':
                    continue
                o.parent = rig
                o.parent_type = 'BONE'
                o.parent_bone = 'handslot.l' if h['grip'] != 'right' else 'handslot.r'
                o.matrix_parent_inverse = Matrix.Identity(4)
                o.matrix_basis = GRIPS[h['grip']]
        frame(scene, cam, (CHAR_FRAME, CHAR_FRAME), FOOT, CHAR_PPU)
        for anim, action_name, at in [('walk', walk, [0, 0.25, 0.5, 0.75]), ('idle', 'Idle', [0]),
                                      ('attack', attack, [hit])]:
            action = bpy.data.actions[action_name]
            rig.animation_data_create()
            rig.animation_data.action = action
            if hasattr(rig.animation_data, 'action_slot') and action.slots:
                rig.animation_data.action_slot = action.slots[0]
            start, end = action.frame_range
            for d, turn in enumerate(turns):
                rig.rotation_euler = (0, 0, turn)
                for i, t in enumerate(at):
                    scene.frame_set(int(round(start + t * (end - start))))
                    render_to(scene, f'{OUT}/chars/{name}/{anim}_{d}_{i}.png')


def tinted(material, hue):
    m = material.copy()
    nt = m.node_tree
    tex = next(n for n in nt.nodes if n.type == 'TEX_IMAGE')
    link = next(l for l in nt.links if l.from_node == tex and l.from_socket.name == 'Color')
    hsv = nt.nodes.new('ShaderNodeHueSaturation')
    hsv.inputs['Hue'].default_value = hue
    hsv.inputs['Saturation'].default_value = 1.3
    target = link.to_socket
    nt.links.new(tex.outputs['Color'], hsv.inputs['Color'])
    nt.links.new(hsv.outputs['Color'], target)
    return m


def items():
    """Each item as an icon: the model turned to its best side, filling a square."""
    for name, (path, rotate, only, hue) in ITEMS.items():
        scene, cam, catcher = reset(rot=(math.radians(60), 0, math.radians(45)))
        catcher.hide_render = True
        objs = load(path)
        meshes = [o for o in objs if o.type == 'MESH' and (only is None or o.name == only)]
        for o in objs:
            if o.type == 'MESH' and o not in meshes:
                o.hide_render = True
            if o.parent is None:
                o.rotation_mode = 'XYZ'
                o.rotation_euler = [math.radians(a) for a in rotate]
        if hue is not None:
            for o in meshes:
                o.data.materials[0] = tinted(o.data.materials[0], hue)
        bpy.context.view_layer.update()
        rot = cam.rotation_euler.to_matrix()
        right, up = rot.col[0], rot.col[1]
        pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
        xs, ys = [p.dot(right) for p in pts], [p.dot(up) for p in pts]
        ppu = (ICON - 2 * 36) / max(max(xs) - min(xs), max(ys) - min(ys))
        cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
        frame(scene, cam, (ICON, ICON), (ICON / 2 - cx * ppu, ICON / 2 + cy * ppu), ppu)
        render_to(scene, f'{OUT}/items/{name}.png')


if WHAT in ('items', 'all'):
    items()
if WHAT in ('props', 'all'):
    props()
if WHAT in ('chars', 'all'):
    characters()
