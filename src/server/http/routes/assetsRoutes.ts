import fs from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express, { Router, type Response } from 'express';
import {
  SHEETS,
  SPRITE_LAYOUTS,
  type SpriteLayoutName,
} from '../../../shared/mappings.js';
import { SPRITE_HEIGHT, SPRITE_WIDTH } from '../../../shared/constants.js';
import { Access } from '../../../shared/types.js';
import { gamePath } from '../../config.js';
import { logger } from '../../logger.js';
import checkAccess from '../middleware/checkAccess.js';

const ASSETS_DIR = process.env.ASSETS_PATH
  ? path.resolve(process.env.ASSETS_PATH)
  : gamePath('assets');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg', '.wav']);

// The new game's characters are near three megabytes; a sheet past this is a
// mistake, and every player downloads it at login.
const SHEET_LIMIT = '16mb';

// The cell each sheet is cut on (the README's table). Characters are cut by
// their sprites.json, and tiles by tiles.json when it places frames.
const CELL: Record<(typeof SHEETS)[number], number> = {
  tiles: 64,
  sprites: 64,
  items: 64,
  spells: 32,
  arrows: 32,
  attackeffect: 64,
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Box = { x: number; y: number; width: number; height: number };

// A PNG opens with its signature and then IHDR, whose first eight bytes are
// the width and the height.
function pngSize(bytes: Buffer) {
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(PNG) ||
    bytes.toString('latin1', 12, 16) !== 'IHDR'
  )
    return undefined;
  const size = {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
  return size.width && size.height ? size : undefined;
}

/**
 * Why `bytes` cannot be the game's `sheet`, in a sentence for the Art page, or
 * undefined. A picture the client cannot cut never reaches a player: a frame
 * of tiles.json outside tiles.png stops the game loading for everyone.
 */
async function sheetProblem(
  sheet: (typeof SHEETS)[number],
  bytes: Buffer,
  layout: SpriteLayoutName | undefined,
): Promise<string | undefined> {
  const size = pngSize(bytes);
  if (!size) return 'Not a PNG image';
  const { width, height } = size;
  const measured = `this picture is ${width}x${height}`;

  if (sheet === 'sprites') {
    // Kept as it is, the layout was made for whatever sheet this replaces,
    // characters placed by hand included; only a new one has a block to fit.
    if (!layout) return undefined;
    const frames = SPRITE_LAYOUTS[layout];
    const blockWidth = (frames.width ?? SPRITE_WIDTH) * (frames.columns ?? 4);
    const blockHeight = (frames.height ?? SPRITE_HEIGHT) * 4;
    return width % blockWidth || height % blockHeight
      ? `In this layout a character is ${blockWidth}x${blockHeight} and ${measured}: pick the layout the sheet was drawn in`
      : undefined;
  }

  if (sheet === 'tiles') {
    const placed = await readFile(path.join(ASSETS_DIR, 'tiles.json'), 'utf8')
      .then((text) => JSON.parse(text) as Record<string, Box>)
      .catch((): Record<string, Box> => ({}));
    const { animations: _, ...frames } = placed;
    const outside = Object.entries(frames).find(
      ([, f]) => f.x + f.width > width || f.y + f.height > height,
    );
    if (outside)
      return `tiles.json places tile ${outside[0]} outside it: ${measured}. Edit the sheet you downloaded, keeping its size`;
    if (Object.keys(frames).length > 0) return undefined;
  }

  const cell = CELL[sheet];
  return width % cell || height % cell
    ? `${sheet}.png is cut in ${cell} px squares and ${measured}`
    : undefined;
}

// Renamed into place, so a player loading the game never reads half a sheet.
async function replace(file: string, data: string | Buffer) {
  await writeFile(`${file}.tmp`, data);
  await rename(`${file}.tmp`, file);
}

// One upload at a time: sprites.png and the sprites.json that cuts it are two
// files, and two uploads interleaved could leave each with the other's.
let writing: Promise<unknown> = Promise.resolve();

/**
 * Streams one file out of the asset directory rather than reading it into
 * memory: a track is megabytes, and a Range header lets a player seek.
 * `root` keeps a name inside the directory, like basename at the call
 * sites before it.
 */
function sendAsset(res: Response, file: string, notFound: string) {
  res.sendFile(file, { root: ASSETS_DIR }, (err) => {
    if (!err) return;

    // A game that names a sound it never shipped is the ordinary case, and
    // at one line per swing per player it would bury the log it shares with
    // real failures. Anything that is not "no such file" still is one:
    // permissions on the asset directory are the operator's to see.
    const code = (err as NodeJS.ErrnoException).code;
    const level = code === 'ENOENT' ? logger.warn : logger.error;
    level('Asset read failed', { file, err });

    // Nothing to answer with once the body started going out.
    if (!res.headersSent) res.status(404).send(notFound);
  });
}

export function createAssetsRouter() {
  const router = Router();

  // The sheets' optional metadata: tiles.json places isometric frames in the
  // tile atlas and animates tiles, sprites.json sizes the character frames.
  // Absent means the 64 px grid every sheet starts from, nothing moving.
  router.get(['/assets/tiles.json', '/assets/sprites.json'], (req, res) => {
    if (!req.session.username)
      return res.status(401).json({ error: 'Unauthorized' });
    fs.readFile(
      path.join(ASSETS_DIR, path.basename(req.path)),
      'utf8',
      (err, data) => {
        if (err && err.code === 'ENOENT') return res.json({});
        if (err)
          return res
            .status(500)
            .json({ error: 'Could not read atlas metadata' });
        res.type('json').send(data);
      },
    );
  });

  router.get('/assets/:name.png', (req, res) => {
    if (!req.session.username) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const name = req.params['name'];
    if (!(SHEETS as readonly string[]).includes(name))
      return res.status(404).send('Image not found');

    // Revalidated rather than cached outright, so a sheet the game replaced
    // reaches the next login while an unchanged one is a 304.
    res.setHeader('Cache-Control', 'private, no-cache');
    sendAsset(res, `${name}.png`, 'Asset not found');
  });

  router.get('/audio/:filename', (req, res) => {
    if (!req.session.username) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const filename = req.params['filename'];
    if (!AUDIO_EXTENSIONS.has(path.extname(filename).toLowerCase())) {
      return res.status(400).send('Invalid file type');
    }

    res.setHeader('Cache-Control', 'private, max-age=3600');
    sendAsset(res, path.basename(filename), 'Audio not found');
  });

  /**
   * The Art page of the admin panel: a sheet replaced by someone who edits no
   * file, and for characters the layout it was drawn in, written as
   * sprites.json. Players get it at their next login, through the revalidated
   * GET above. With several instances the asset folder has to be a shared
   * volume, or a sheet reaches only the instance that took it.
   */
  router.put(
    '/admin/assets/:sheet',
    checkAccess(Access.ADMIN),
    // After the gate, so nobody without the access has a sheet read.
    express.raw({ type: 'image/png', limit: SHEET_LIMIT }),
    async (req, res) => {
      const sheet = SHEETS.find((name) => name === req.params.sheet);
      if (!sheet) return res.status(404).json({ error: 'No such sheet' });
      const asked = req.query['layout'];
      const layout = (Object.keys(SPRITE_LAYOUTS) as SpriteLayoutName[]).find(
        (name) => name === asked,
      );
      if (asked !== undefined && (sheet !== 'sprites' || !layout))
        return res.status(400).json({ error: 'No such layout' });
      if (!Buffer.isBuffer(req.body))
        return res.status(415).json({ error: 'Not a PNG image' });
      const bytes = req.body;

      const run = writing.then(async () => {
        const problem = await sheetProblem(sheet, bytes, layout);
        if (problem) return problem;
        if (layout)
          await replace(
            path.join(ASSETS_DIR, 'sprites.json'),
            `${JSON.stringify(SPRITE_LAYOUTS[layout], null, 2)}\n`,
          );
        await replace(path.join(ASSETS_DIR, `${sheet}.png`), bytes);
      });
      writing = run.catch(() => {});
      const problem = await run;
      if (problem) return res.status(422).json({ error: problem });
      res.status(204).end();
    },
  );

  return router;
}
