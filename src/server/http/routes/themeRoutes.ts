import { readFile } from 'node:fs/promises';
import path from 'node:path';
import express, { Router, type Response } from 'express';
import { THEME_IMAGES, type ThemeImage } from '../../../shared/theme.js';
import { Access } from '../../../shared/types.js';
import { gamePath } from '../../config.js';
import {
  ThemeChoicesSchema,
  readTheme,
  removeThemeImage,
  saveThemeImage,
  writeTheme,
} from '../../theme.js';
import { parseBody } from '../bodySchemas.js';
import checkAccess from '../middleware/checkAccess.js';

// A logo is a few kilobytes and a login background a few hundred; past this a
// picture is a mistake, and the login screen would wait on it.
const IMAGE_LIMIT = '2mb';
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * The Appearance page of the admin panel: theme/theme.json and the two
 * pictures beside it, edited by someone who edits no file. gameRoutes
 * serves what it writes from the same folder, so with several instances
 * the folder has to be a shared volume.
 */
export function createThemeRouter({
  themeDir = gamePath('theme'),
}: { themeDir?: string } = {}) {
  const router = Router();
  const admin = checkAccess(Access.ADMIN);

  const slotOf = (name: string | undefined, res: Response) => {
    const slot = THEME_IMAGES.find((image) => image === name);
    if (!slot) res.status(404).json({ error: 'No such picture' });
    return slot;
  };

  router.get('/admin/theme', admin, async (_req, res) => {
    const [theme, css] = await Promise.all([
      readTheme(themeDir),
      // Comments stripped, so a theme.css holding only a comment wins nothing.
      readFile(path.join(themeDir, 'theme.css'), 'utf8').then(
        (text) => text.replace(/\/\*[\s\S]*?\*\//g, ''),
        () => '',
      ),
    ]);
    // A theme.css with rules wins over every choice made on the page, and
    // the variables it sets win over the ones the page would write: the
    // page locks those and leaves them out of its preview.
    res.json({
      theme,
      handwritten: css.trim() !== '',
      cssVariables: [...new Set(css.match(/--[\w-]+(?=\s*:)/g))],
    });
  });

  router.put('/admin/theme', admin, async (req, res) => {
    const choices = parseBody(ThemeChoicesSchema, req.body, res);
    if (choices) res.json(await writeTheme(themeDir, choices));
  });

  router.put(
    '/admin/theme/:slot',
    admin,
    // After the gate, so nobody without the access has two megabytes read.
    express.raw({ type: IMAGE_TYPES, limit: IMAGE_LIMIT }),
    async (req, res) => {
      const slot: ThemeImage | undefined = slotOf(req.params.slot, res);
      if (!slot) return;
      const theme =
        Buffer.isBuffer(req.body) &&
        (await saveThemeImage(themeDir, slot, req.body));
      if (theme) res.json(theme);
      else res.status(415).json({ error: 'Not a PNG, JPEG or WebP image' });
    },
  );

  router.delete('/admin/theme/:slot', admin, async (req, res) => {
    const slot = slotOf(req.params.slot, res);
    if (slot) res.json(await removeThemeImage(themeDir, slot));
  });

  return router;
}
