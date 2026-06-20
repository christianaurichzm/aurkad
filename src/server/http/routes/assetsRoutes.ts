import fs from 'fs';
import path from 'path';
import { Router, type Response } from 'express';
import { imageMap } from '../../../shared/mappings.js';
import { logger } from '../../logger.js';
import type { ExtendedRequest } from '../session.js';

const ASSETS_DIR = process.env.ASSETS_PATH
  ? path.resolve(process.env.ASSETS_PATH)
  : path.resolve('assets');

export function createAssetsRouter() {
  const router = Router();

  router.get(
    '/assets/:name.bin',
    async (req: ExtendedRequest, res: Response) => {
      if (!req.session.username) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const name = req.params['name']!;
      const imageId = imageMap[name];
      if (!imageId) return res.status(404).send('Image not found');

      const assetKey = req.session.assetKey;
      if (!assetKey) return res.status(401).json({ error: 'No asset key' });

      const filePath = path.join(ASSETS_DIR, `${imageId}.png`);

      fs.readFile(filePath, (err, data) => {
        if (err) {
          logger.error('Asset read failed', { file: filePath, err });
          return res.status(404).send('Asset not found');
        }

        const keyBytes = Buffer.from(assetKey, 'hex');
        const keyLen = keyBytes.length;
        const out = data.map((byte, i) => byte ^ (keyBytes[i % keyLen] ?? 0));

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.send(out);
      });
    },
  );

  return router;
}
