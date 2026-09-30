import {
  getClientModules,
  getLoadedModuleIds,
  readModuleClientFile,
} from '../../engine/modules/moduleLoader.js';
import { createRouter } from '../../app.js';

// Serves module browser entries to the client loader. The list tells the client
// which modules ship client code; the per-module route returns that code.
export function createModulesRouter() {
  const router = createRouter();

  router.get('/modules', (_req, res) => {
    res.json(getClientModules());
  });

  router.get('/modules/loaded', (_req, res) => {
    res.json(getLoadedModuleIds());
  });

  router.get('/modules/:id/client', (req, res) => {
    const code = readModuleClientFile(req.params.id ?? '');
    if (code === null) return res.status(404).send('Module client not found');
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-store');
    res.send(code);
  });

  return router;
}
