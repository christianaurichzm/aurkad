import fs from 'fs';
import path from 'path';
import { type Response } from 'express';
import type { ExtendedRequest } from '../session.js';
import { logger } from '../../logger.js';
import { createRouter } from '../../app.js';

const ASSETS_DIR = process.env.ASSETS_PATH
  ? path.resolve(process.env.ASSETS_PATH)
  : path.resolve('assets');

const ALLOWED_EXTENSIONS = new Set(['.mp3', '.ogg', '.wav']);

export function createAudioRouter() {
  const router = createRouter();

  router.get('/audio/:filename', (req: ExtendedRequest, res: Response) => {
    if (!req.session.username) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const filename = req.params['filename']!;
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return res.status(400).send('Invalid file type');
    }

    const safeName = path.basename(filename);
    const filePath = path.join(ASSETS_DIR, safeName);

    fs.readFile(filePath, (err, data) => {
      if (err) {
        // A game that names a sound it never shipped is the ordinary case, and
        // at one line per swing per player it would bury the log it shares with
        // real failures. Anything that is not "no such file" still is one:
        // permissions on the asset directory are the operator's to see.
        const level = err.code === 'ENOENT' ? logger.warn : logger.error;
        level('Audio read failed', { file: filePath, err });
        return res.status(404).send('Audio not found');
      }

      const mimeTypes: Record<string, string> = {
        '.mp3': 'audio/mpeg',
        '.ogg': 'audio/ogg',
        '.wav': 'audio/wav',
      };

      res.setHeader('Content-Type', mimeTypes[ext] ?? 'audio/mpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(data);
    });
  });

  return router;
}
