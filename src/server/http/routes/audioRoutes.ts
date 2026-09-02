import path from 'node:path';
import { logger } from '../../logger.js';
import { createRouter } from '../../app.js';

const ASSETS_DIR = process.env.ASSETS_PATH
  ? path.resolve(process.env.ASSETS_PATH)
  : path.resolve('assets');

const ALLOWED_EXTENSIONS = new Set(['.mp3', '.ogg', '.wav']);

export function createAudioRouter() {
  const router = createRouter();

  router.get('/audio/:filename', (req, res) => {
    if (!req.session.username) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const filename = req.params['filename'];
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return res.status(400).send('Invalid file type');
    }

    res.setHeader('Cache-Control', 'private, max-age=3600');

    // Streamed, not read into memory: a track is megabytes, and a Range header
    // lets a player seek instead of refetching. The type comes from the
    // extension, and `root` keeps a name inside the asset directory, the same
    // rule as basename above.
    res.sendFile(path.basename(filename), { root: ASSETS_DIR }, (err) => {
      if (!err) return;

      // A game that names a sound it never shipped is the ordinary case, and
      // at one line per swing per player it would bury the log it shares with
      // real failures. Anything that is not "no such file" still is one:
      // permissions on the asset directory are the operator's to see.
      const code = (err as NodeJS.ErrnoException).code;
      const level = code === 'ENOENT' ? logger.warn : logger.error;
      level('Audio read failed', { file: filename, err });

      // Nothing to answer with once the body started going out.
      if (!res.headersSent) res.status(404).send('Audio not found');
    });
  });

  return router;
}
