import { Router, type Request, type Response } from 'express';
import { Access } from '../../../shared/types.js';
import checkAccess from '../middleware/checkAccess.js';
import {
  parseBody,
  ScriptContentBodySchema,
  CreateScriptBodySchema,
} from '../bodySchemas.js';
import {
  listScriptFiles,
  readScriptFile,
  writeScriptFile,
  createScriptFile,
  deleteScriptFile,
  readTypeDefs,
} from '../../engine/scripting/scriptsRepository.js';

// Monaco script editor backend, mounted only when SCRIPT_EDITOR_ENABLED=true
// (server.ts). Writes here run on the server with full host access (see
// the trust model in engine/scripting/sandbox.ts), so it is ADMIN-gated too.
export function createScriptsRouter() {
  const router = Router();

  router.get('/admin/scripts', checkAccess(Access.ADMIN), (_req, res) => {
    res.json(listScriptFiles());
  });

  router.get('/admin/scripts/types', checkAccess(Access.ADMIN), (_req, res) => {
    res.json(readTypeDefs());
  });

  router.get(
    '/admin/scripts/:name',
    checkAccess(Access.ADMIN),
    (req: Request, res: Response) => {
      const content = readScriptFile(req.params.name ?? '');
      if (content === null) return res.status(404).json({ error: 'Not found' });
      res.json({ name: req.params.name, content });
    },
  );

  router.put(
    '/admin/scripts/:name',
    checkAccess(Access.ADMIN),
    (req: Request, res: Response) => {
      const body = parseBody(ScriptContentBodySchema, req.body, res);
      if (!body) return;
      const ok = writeScriptFile(req.params.name ?? '', body.content);
      if (!ok) return res.status(400).json({ error: 'Invalid script name' });
      res.status(200).json({ success: true });
    },
  );

  router.post(
    '/admin/scripts',
    checkAccess(Access.ADMIN),
    (req: Request, res: Response) => {
      const body = parseBody(CreateScriptBodySchema, req.body, res);
      if (!body) return;
      const result = createScriptFile(body.name, body.content ?? '');
      if (result === 'invalid') {
        return res.status(400).json({ error: 'Invalid script name' });
      }
      if (result === 'exists') {
        return res.status(409).json({ error: 'Script already exists' });
      }
      res.status(201).json({ name: body.name });
    },
  );

  router.delete(
    '/admin/scripts/:name',
    checkAccess(Access.ADMIN),
    (req: Request, res: Response) => {
      const ok = deleteScriptFile(req.params.name ?? '');
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.status(204).send();
    },
  );

  return router;
}
