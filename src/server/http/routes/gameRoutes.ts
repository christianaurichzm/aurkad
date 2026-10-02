import { readFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { gamePath } from '../../config.js';
import { gameConfig, type GameConfig } from '../../gameConfig.js';
import { createRouter } from '../../app.js';
import { readTheme, themeVariables } from '../../theme.js';

// What a game looks like before anyone logs in: its name and logo, whether it
// has levels and attribute points to spend, where the menu sits, and the
// stylesheet and pictures in theme/, next to game.json. Mounted before the
// session, as the probes are: every login screen asks for all of it, and a
// page load is not worth a rate-limit bucket.
export function createGameRouter({
  brand = gameConfig.brand,
  levels = gameConfig.leveling.enabled,
  // A game that hands out no points has nothing to spend them on, and so
  // no Attributes window.
  attributes = levels && gameConfig.leveling.pointsPerLevel > 0,
  themeDir = gamePath('theme'),
}: {
  brand?: GameConfig['brand'];
  levels?: boolean;
  attributes?: boolean;
  themeDir?: string;
} = {}) {
  const router = createRouter();

  router.get('/game', async (_req, res) => {
    const theme = await readTheme(themeDir);
    // A logo uploaded from the Appearance page, over the one game.json names.
    const logo = theme.logo ?? brand.logo;
    res.json({
      name: brand.name,
      logo: logo ? `/theme/${encodeURI(logo)}` : '/favicon.svg',
      levels,
      attributes,
      layout: theme.layout,
      art: theme.art,
    });
  });

  // index.html links this stylesheet for every game: what theme.json asks for,
  // then the theme.css written by hand, which wins by coming last. A game with
  // neither is answered with nothing to apply rather than a 404 in every
  // console. Ahead of the static folder, which would serve theme.css alone;
  // relative url()s in it still resolve, the response being at the same path.
  router.get('/theme/theme.css', async (_req, res) => {
    const [theme, written] = await Promise.all([
      readTheme(themeDir),
      readFile(path.join(themeDir, 'theme.css'), 'utf8').catch(() => ''),
    ]);
    res.type('css').send(themeVariables(theme) + written);
  });
  router.use('/theme', express.static(themeDir));

  return router;
}
