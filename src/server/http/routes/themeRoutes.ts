import { access } from 'node:fs/promises';
import path from 'node:path';
import express, { type Response } from 'express';
import { THEME_IMAGES, type ThemeImage } from '../../../shared/theme.js';
import { Access } from '../../../shared/types.js';
import { createRouter } from '../../app.js';
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
  const router = createRouter();
  const admin = checkAccess(Access.ADMIN);

  const slotOf = (name: string | undefined, res: Response) => {
    const slot = THEME_IMAGES.find((image) => image === name);
    if (!slot) res.status(404).json({ error: 'No such picture' });
    return slot;
  };

  router.get('/admin/theme', admin, async (_req, res) => {
    const [theme, handwritten] = await Promise.all([
      readTheme(themeDir),
      // The page has to say when a theme.css is there: it wins over every
      // choice made here, and the preview cannot show that.
      access(path.join(themeDir, 'theme.css')).then(
        () => true,
        () => false,
      ),
    ]);
    res.json({ theme, handwritten });
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
