import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

import build
from build import Atlas


class AtlasTest(unittest.TestCase):
    def test_filtered_frames_have_their_own_edge_pixels_around_them(self):
        atlas = Atlas()
        images = [Image.new('RGBA', (8, 6)) for _ in range(2)]
        for n, image in enumerate(images):
            image.putdata([(x * 30, y * 40, n * 255, 128 + x * 16)
                           for y in range(image.height) for x in range(image.width)])
            atlas.add(image, (4, 3), {'name': str(n)})

        with tempfile.TemporaryDirectory() as folder:
            atlas.save(folder, width=20)
            root = Path(folder) / 'assets'
            frames = json.loads((root / 'tiles.json').read_text())
            with Image.open(root / 'tiles.png') as sheet:
                self.assertEqual(sheet.getpixel((0, 0)), (0, 0, 0, 0))
                for fid, image in enumerate(images, 1):
                    frame = frames[str(fid)]
                    for y in range(-2, image.height + 2):
                        for x in range(-2, image.width + 2):
                            expected = image.getpixel((min(max(x, 0), image.width - 1),
                                                       min(max(y, 0), image.height - 1)))
                            self.assertEqual(sheet.getpixel((frame['x'] + x, frame['y'] + y)),
                                             expected, (fid, x, y))

    def test_connected_decals_keep_their_opacity_where_they_overlap(self):
        size = build.C + 2 * build.M
        for mask, offsets in [(10, [(0, 0), (build.C, 0)]),
                              (5, [(0, 0), (0, build.C)]),
                              (15, [(0, 0), (build.C, 0), (0, build.C), (build.C, build.C)])]:
            tile = build.join_opacity(Image.new('RGBA', (size, size), (80, 120, 40, 128)), mask)
            scene = Image.new('RGBA', (2 * size, 2 * size))
            for at in offsets:
                scene.alpha_composite(tile, at)
            xs = range(build.C, size) if mask & 2 else [build.C // 2]
            ys = range(build.C, size) if mask & 1 else [build.C // 2]
            for y in ys:
                for x in xs:
                    self.assertLessEqual(abs(scene.getpixel((x, y))[3] - 128), 1, (mask, x, y))


if __name__ == '__main__':
    unittest.main()
