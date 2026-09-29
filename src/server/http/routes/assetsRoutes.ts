import fs from 'node:fs';
import path from 'node:path';
import { imageMap } from '../../../shared/mappings.js';
import { gamePath } from '../../config.js';
import { logger } from '../../logger.js';
import { createRouter } from '../../app.js';

const ASSETS_DIR = process.env.ASSETS_PATH
  ? path.resolve(process.env.ASSETS_PATH)
  : gamePath('assets');

export function createAssetsRouter() {
  const router = createRouter();

  router.get('/assets/:name.bin', (req, res) => {
    if (!req.session.username) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const name = req.params['name'];
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

      // Written into a buffer, not through Buffer.prototype.map, which is
      // Uint8Array's and calls a closure per byte, on the thread the 20 Hz
      // loop runs on; a login asks for every sheet. allocUnsafe is safe
      // because every byte below is written.
      const keyBytes = Buffer.from(assetKey, 'hex');
      const keyLen = keyBytes.length;
      const out = Buffer.allocUnsafe(data.length);
      for (let i = 0; i < data.length; i++) {
        out[i] = data[i]! ^ keyBytes[i % keyLen]!;
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.send(out);
    });
  });

  return router;
}
