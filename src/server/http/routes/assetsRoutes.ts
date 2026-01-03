import { Router, type Request, type Response } from 'express';
import https from 'https';
import http from 'http';
import { imageMap } from '../../../shared/mappings.js';
import { config } from '../../config.js';

export function createAssetsRouter() {
  const router = Router();

  router.get('/assets/:name.bin', async (req: Request, res: Response) => {
    const { name } = req.params;
    const imageId = imageMap[name];
    if (!imageId) return res.status(404).send('Image not found');

    const imageUrl = `${config.imagesBaseUrl}/${imageId}.png`;

    try {
      const url = new URL(imageUrl);
      const client = url.protocol === 'https:' ? https : http;

      client
        .get(imageUrl, (imgRes) => {
          if (imgRes.statusCode !== 200) {
            return res.status(502).send('Failed to fetch image');
          }

          res.setHeader('Content-Type', 'application/octet-stream');
          imgRes.on('data', (chunk) => {
            const obfuscatedChunk = Buffer.from(chunk).map(
              (byte) => byte ^ 0xa5,
            );
            res.write(obfuscatedChunk);
          });

          imgRes.on('end', () => res.end());
        })
        .on('error', (err) => {
          console.error('Image fetch failed:', err);
          res.status(500).send('Internal error');
        });
    } catch (err) {
      console.error('Request failed:', err);
      res.status(500).send('Unexpected error');
    }
  });

  return router;
}
