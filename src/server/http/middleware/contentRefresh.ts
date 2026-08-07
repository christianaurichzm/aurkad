import { type NextFunction, type Request, type Response } from 'express';
import { scheduleContentRefresh } from '../../engine/scripting/contentConstants.js';

// Content-definition paths whose mutations should regenerate script constants.
const CONTENT_DEFINITION_PATH =
  /^\/(saveMap|npcs|items|maps|spells|arrows|loot|dialogs|quests|recipes)\b/;

/**
 * After a successful admin edit to content definitions, rebuilds the typed
 * constants (Items/Npcs/...) and their .d.ts, debounced by
 * `scheduleContentRefresh`. Mounted once for the whole app, since the paths
 * span several routers and a router-local copy would miss one that moved.
 * Scoped by path so gameplay writes (shop buy, assign points) skip it, and
 * by status so a rejected save does too.
 */
export function contentRefresh(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (
    (req.method === 'POST' ||
      req.method === 'PUT' ||
      req.method === 'DELETE') &&
    CONTENT_DEFINITION_PATH.test(req.path)
  ) {
    res.on('finish', () => {
      if (res.statusCode < 300) scheduleContentRefresh();
    });
  }
  next();
}
