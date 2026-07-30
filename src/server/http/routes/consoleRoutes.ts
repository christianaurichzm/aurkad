import { Router, type Response } from 'express';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';
import checkAccess from '../middleware/checkAccess.js';
import { parseBody, ConsoleCommandBodySchema } from '../bodySchemas.js';
import { handleWebCommand, listCommands } from '../../engine/commands.js';

// Browser command console: runs registered commands (script, module and
// server ops) from the admin UI, with no terminal needed. It reaches only
// the command registry and cannot evaluate arbitrary code.
export function createConsoleRouter() {
  const router = Router();

  // Available commands (name, access, description) for the console UI.
  // Gated at MOD; handleWebCommand enforces each command's own access level, so
  // a mod operator can run mod commands but not admin-only ones.
  router.get('/admin/commands', checkAccess(Access.MOD), (_req, res) => {
    res.json(listCommands());
  });

  router.post(
    '/admin/console',
    checkAccess(Access.MOD),
    (req: ExtendedRequest, res: Response) => {
      const body = parseBody(ConsoleCommandBodySchema, req.body, res);
      if (!body) return;

      const line = body.line.trim().replace(/^\//, '');
      const parts = line.split(/\s+/).filter(Boolean);
      const name = parts[0] ?? '';
      const args = parts.slice(1);
      if (!name) return res.json({ output: [] });

      const accessLevel = req.session.accessLevel ?? Access.USER;
      const output: string[] = [];
      const matched = handleWebCommand(
        name,
        args,
        accessLevel,
        (m) => output.push(m),
        req.session.username,
      );
      if (!matched) output.push(`Unknown command: ${name}`);

      res.json({ output });
    },
  );

  return router;
}
