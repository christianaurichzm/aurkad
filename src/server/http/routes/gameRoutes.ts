import express from 'express';
import { gamePath } from '../../config.js';
import { gameConfig, type GameConfig } from '../../gameConfig.js';
import { createRouter } from '../../app.js';

// What a game looks like before anyone logs in: its name and logo, whether
// it has levels and attribute points to spend, and the stylesheet and
// pictures in theme/, next to game.json. Mounted before the session, like
// the probes: every login screen asks for all of it, and a page load is not
// worth a rate-limit bucket.
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

  router.get('/game', (_req, res) => {
    res.json({
      name: brand.name,
      logo: brand.logo ? `/theme/${encodeURI(brand.logo)}` : '/favicon.svg',
      levels,
      attributes,
    });
  });

  router.use('/theme', express.static(themeDir));
  // index.html links the stylesheet for every game, so a game without one is
  // answered with nothing to apply rather than a 404 in every console.
  router.get('/theme/theme.css', (_req, res) => {
    res.type('css').send('');
  });

  return router;
}
