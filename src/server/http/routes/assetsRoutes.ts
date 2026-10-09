import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import { SHEETS } from '../../../shared/mappings.js';
import { gamePath } from '../../config.js';
import { logger } from '../../logger.js';
import { createRouter } from '../../app.js';

const ASSETS_DIR = process.env.ASSETS_PATH
  ? path.resolve(process.env.ASSETS_PATH)
  : gamePath('assets');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg', '.wav']);

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
  const router = createRouter();

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

  return router;
}
