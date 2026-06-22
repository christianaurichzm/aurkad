import { Router, type Request, type Response } from 'express';
import {
  getClientModules,
  readModuleClientFile,
} from '../../engine/modules/moduleLoader.js';

// Serves module browser entries to the client loader. The list tells the client
// which modules ship client code; the per-module route returns that code.
export function createModulesRouter() {
  const router = Router();

  router.get('/modules', (_req: Request, res: Response) => {
    res.json(getClientModules());
  });

  router.get('/modules/:id/client', (req: Request, res: Response) => {
    const code = readModuleClientFile(req.params.id ?? '');
    if (code === null) return res.status(404).send('Module client not found');
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-store');
    res.send(code);
  });

  return router;
}
