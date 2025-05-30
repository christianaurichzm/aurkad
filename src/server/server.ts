const currentNodeVersion = process.versions.node;
const [major] = currentNodeVersion.split('.').map(Number);

const REQUIRED_MAJOR_VERSION = 17;

if (major < REQUIRED_MAJOR_VERSION) {
  process.exit(1);
}

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import dotenv from 'dotenv';
dotenv.config({
  path:
    process.env.NODE_ENV === 'production'
      ? './.env.production'
      : './.env.development',
});
import { createServer } from 'http';
import express, { Request, Response } from 'express';
import https from 'https';
import http from 'http';
import app from './app.js';
import { imageMap } from '../shared/mappings.js';
import path from 'path';

import {
  broadcast,
  playersWsMap,
  startGameLoops,
  startWebSocketServer,
} from './wsServer.js';
import { Access, PersistentNpc, PlayerServer } from '../shared/types.js';
import checkAccess from './checkAccess.js';
import {
  defaultTiles,
  deleteNpcEverywhere,
  players,
  updatePlayer,
} from './gameData.js';
import { SPRITE_HEIGHT, SPRITE_WIDTH, TILE_SIZE } from '../shared/constants.js';
import {
  login,
  mapSave,
  disconnectPlayer,
  handlePlayerUpdate,
} from './services/gameService.js';
import {
  addPlayerOnMap,
  createOrUpdateMap,
  getMapById,
  listMaps,
  removePlayerFromMap,
} from './services/mapService.js';
import { connectToDatabase, loadInitialData } from './initDb.js';
import { banPlayer, getBan, unbanPlayer } from './services/banService.js';
import { buyShopItem, getShopById, listShops } from './services/shopService.js';
import {
  createOrUpdateItem,
  deleteItem,
  getItemById,
  listItems,
} from './services/inventoryService.js';
import {
  changeSprite,
  enrichPlayer,
  getPlayerById,
  getPlayerByName,
  persistPlayerSessionState,
} from './services/playerService.js';
import {
  createOrUpdateNpc,
  listNpcs,
  updateNpcAll,
} from './services/npcService.js';

export const IMAGES_PATH = process.env.IMAGES_BASE_URL || '.';

import session from 'express-session';

declare module 'express-session' {
  interface SessionData {
    username: PlayerServer['name'];
    accessLevel: Access;
  }
}

export type ExtendedRequest = Request & {
  session: session.Session & Partial<session.SessionData>;
};

const port = process.env.PORT || 8080;

const sessionMiddleware = session({
  secret: 'changeit',
  resave: false,
  saveUninitialized: false,
});

app.use(sessionMiddleware);

app.post('/login', async (req: Request, res: Response) => {
  const username = req.body.username;
  if (!username) {
    return res.status(400).send('Username is required');
  }

  const ban = await getBan(username);
  if (ban) {
    if (!ban.until || Date.now() < ban.until) {
      return res.status(403).json({
        message: `You are banned from this game.${ban.reason ? ` Reason: ${ban.reason}` : ''}${ban.until ? ` Until: ${new Date(ban.until).toLocaleString()}` : ''}`,
      });
    } else {
      await unbanPlayer(username);
    }
  }

  try {
    const basicPlayer = await login(username);
    if (!basicPlayer) return res.status(404).send('User not found');

    const player = enrichPlayer(basicPlayer);

    req.session.username = username;
    req.session.accessLevel = basicPlayer.access;
    players[basicPlayer.id] = basicPlayer;
    const map = addPlayerOnMap(basicPlayer.id);
    req.session.save((err) => {
      if (err) {
        console.error('Session save failed:', err);
        return res.status(500).send('Failed to save session');
      }
      res.status(200).json({ player, map });
    });
  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).send('Internal server error');
  }
});

app.post('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy failed:', err);
      res.status(500).send('Failed to destroy session');
      return;
    }
    disconnectPlayer(req.session.username!);
    res.status(200).send('Logged out');
  });
});

app.post(
  '/saveMap',
  checkAccess(Access.ADMIN),
  (req: Request, res: Response) => {
    const { mapId, tiles, name, type } = req.body;
    mapSave(mapId, tiles, name, type);
    res.status(200).send('Success');
  },
);

app.post(
  '/openMapEditor',
  checkAccess(Access.ADMIN),
  (req: Request, res: Response) => {
    res.status(200).send('Authorized');
  },
);

app.post(
  '/openModEditor',
  checkAccess(Access.MOD),
  (req: Request, res: Response) => {
    res.status(200).send('Authorized');
  },
);

app.post(
  '/openContentEditor',
  checkAccess(Access.ADMIN),
  (req: Request, res: Response) => {
    res.status(200).send('Authorized');
  },
);

app.get(
  '/npcs',
  checkAccess(Access.ADMIN),
  async (req: Request, res: Response) => {
    try {
      const npcs = await listNpcs();
      res.status(200).json(npcs);
    } catch (error) {
      res.status(500).json({ error: 'Could not fetch NPCs' });
    }
  },
);

app.get(
  '/items',
  checkAccess(Access.ADMIN),
  async (req: Request, res: Response) => {
    try {
      const items = await listItems();
      res.status(200).json(items);
    } catch (error) {
      res.status(500).json({ error: 'Could not fetch items' });
    }
  },
);

app.get(
  '/maps',
  checkAccess(Access.ADMIN),
  async (req: Request, res: Response) => {
    try {
      const items = await listMaps();
      res.status(200).json(items);
    } catch (error) {
      res.status(500).json({ error: 'Could not fetch items' });
    }
  },
);

app.get('/maps/:mapId', async (req, res) => {
  try {
    const { mapId } = req.params;
    const map = await getMapById(mapId);

    if (!map) {
      return res.status(404).json({ error: 'Map not found' });
    }

    res.json({
      id: map.id,
      name: map.name,
      tiles: map.tiles,
      type: map.type,
    });
  } catch (e) {
    console.error('Error in route /maps/:mapId:', e);
    res.status(500).json({
      error: 'Internal server error',
      details: String(e),
    });
  }
});

app.get(
  '/shops',
  checkAccess(Access.ADMIN),
  async (req: Request, res: Response) => {
    try {
      const shops = await listShops();
      res.status(200).json(shops);
    } catch (error) {
      res.status(500).json({ error: 'Could not fetch items' });
    }
  },
);

app.get('/shop/:shopId', async (req, res) => {
  try {
    const { shopId } = req.params;
    const shop = await getShopById(shopId);

    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const products = await Promise.all(
      shop.products.map(async (entry) => {
        const item = await getItemById(entry.itemId);
        const currency = await getItemById(entry.currency);

        if (!item) {
          throw new Error(`Item ${entry.itemId} not found`);
        }
        if (!currency) {
          throw new Error(`Currency ${entry.currency} not found`);
        }

        return {
          item: {
            id: item.id,
            name: item.name,
            sprite: item.sprite,
            description: item.description,
            type: item.type,
          },
          currency: {
            id: currency.id,
            name: currency.name,
            sprite: currency.sprite,
            description: currency.description,
            type: currency.type,
          },
          price: entry.price,
        };
      }),
    );

    res.json({
      id: shop.id,
      name: shop.name,
      products,
    });
  } catch (e) {
    console.error('Error in route /shop/:shopId:', e);
    res.status(500).json({
      error: 'Internal server error',
      details: String(e),
    });
  }
});

function updateStateAndBroadcast(updateFn: () => void) {
  updateFn();
  broadcast();
}

app.post(
  '/mod/changeSprite',
  checkAccess(Access.MOD),
  (req: Request, res: Response) => {
    if (req.session.username) {
      changeSprite(req.body.spriteId, req.session.username);
      res.status(200).send('Sucess');
    }
  },
);

app.post(
  '/mod/kick',
  checkAccess(Access.MOD),
  async (req: Request, res: Response) => {
    const { playerName } = req.body;
    const player = getPlayerByName(playerName);

    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const ws = playersWsMap.get(playerName);

    if (ws && ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'kick',
          message: 'You were kicked from the game by a moderator.',
        }),
        (err) => {
          if (err) {
            ws.close();
          } else {
            setTimeout(() => {
              if (ws.readyState === ws.OPEN) ws.close();
            }, 100);
          }
        },
      );
    } else {
      updateStateAndBroadcast(() => {
        disconnectPlayer(playerName);
        playersWsMap.delete(playerName);
      });
    }

    res.status(200).json({ success: true });
  },
);

app.post(
  '/mod/ban',
  checkAccess(Access.ADMIN),
  (req: Request, res: Response) => {
    const { playerName, reason, until } = req.body;
    if (!playerName) return res.status(400).json({ error: 'No player name' });
    banPlayer(playerName, reason, until);
    const ws = playersWsMap.get(playerName);
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'kick',
          message: reason
            ? `You were banned: ${reason}`
            : 'You were banned from the game.',
        }),
      );
      ws.close();
    }
    res.status(200).json({ success: true });
  },
);

app.post(
  '/mod/bring',
  checkAccess(Access.MOD),
  (req: ExtendedRequest, res: Response) => {
    const { playerName } = req.body;
    const me = getPlayerByName(req.session.username!);
    const target = getPlayerByName(playerName);

    if (!me || !target) return res.status(404).send('Player not found');

    updateStateAndBroadcast(() => {
      removePlayerFromMap(target.id);
      target.position = { ...me.position };
      target.mapId = me.mapId;
      addPlayerOnMap(target.id);
    });
    res.status(200).send('Player brought to you');
  },
);

app.post(
  '/mod/goto',
  checkAccess(Access.MOD),
  (req: ExtendedRequest, res: Response) => {
    const { playerName } = req.body;
    const me = getPlayerByName(req.session.username!);
    const target = getPlayerByName(playerName);

    if (!me || !target) return res.status(404).send('Player not found');

    updateStateAndBroadcast(() => {
      removePlayerFromMap(me.id);
      me.position = { ...target.position };
      me.mapId = target.mapId;
      addPlayerOnMap(me.id);
    });
    res.status(200).send('Teleported to player');
  },
);

app.post(
  '/mod/setSprite',
  checkAccess(Access.MOD),
  (req: Request, res: Response) => {
    const { playerName, spriteId } = req.body;
    const target = getPlayerByName(playerName);
    if (!target) return res.status(404).send('Player not found');

    updateStateAndBroadcast(() => {
      target.sprite = Number(spriteId);
      handlePlayerUpdate(target);
    });
    res.status(200).send('Sprite updated');
  },
);

app.post(
  '/mod/setAccess',
  checkAccess(Access.ADMIN),
  (req: Request, res: Response) => {
    const { playerName, accessLevel } = req.body;
    const target = getPlayerByName(playerName);
    if (!target) return res.status(404).send('Player not found');

    updateStateAndBroadcast(() => {
      target.access = accessLevel as Access;
      handlePlayerUpdate(target);
    });
    res.status(200).send('Access updated');
  },
);

app.post(
  '/mod/gomap',
  checkAccess(Access.MOD),
  (req: ExtendedRequest, res: Response) => {
    const { mapId } = req.body;
    const me = getPlayerByName(req.session.username!);
    if (!me) return res.status(404).send('Player not found');

    updateStateAndBroadcast(() => {
      removePlayerFromMap(me.id);
      me.mapId = mapId;
      addPlayerOnMap(me.id);
    });
    res.status(200).send('Moved to map');
  },
);

app.post(
  '/mod/setMyAccess',
  checkAccess(Access.ADMIN),
  (req: ExtendedRequest, res: Response) => {
    const { accessLevel } = req.body;
    const me = getPlayerByName(req.session.username!);
    if (!me) return res.status(404).send('Player not found');

    updateStateAndBroadcast(() => {
      me.access = accessLevel as Access;
      handlePlayerUpdate(me);
      req.session.accessLevel = accessLevel as Access;
      req.session.save(() => {});
    });
    res.status(200).send('Your access updated');
  },
);

app.post('/npcs', checkAccess(Access.ADMIN), (req, res) => {
  const {
    name,
    sprite,
    maxHealth,
    attack,
    behavior,
    experienceValue,
    itemsToDrop,
  }: PersistentNpc = req.body;

  const defaults = {
    width: SPRITE_WIDTH,
    height: SPRITE_HEIGHT,
    attackRange: TILE_SIZE,
  };

  const npcData = {
    ...defaults,
    name,
    sprite,
    maxHealth,
    attack,
    behavior,
    experienceValue,
    itemsToDrop,
  };

  const newNpc = createOrUpdateNpc(npcData);
  res.status(201).json(newNpc);
});

app.post('/players/:id/assignPoints', async (req, res) => {
  const { vitality = 0, attack = 0 } = req.body;

  const totalAssigned = vitality + attack;
  if (totalAssigned <= 0) {
    return res.status(400).json({ error: 'No points assigned' });
  }

  const player = await getPlayerById(req.params.id);
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }

  if (totalAssigned > player.unspentPoints) {
    return res.status(400).json({ error: 'Not enough unspent points' });
  }

  player.vitality += vitality;
  player.attack += attack;
  player.unspentPoints -= totalAssigned;

  player.maxHealth = 100 + player.vitality * 10;

  await updatePlayer(player);

  return res.json({
    success: true,
    unspentPoints: player.unspentPoints,
    vitality: player.vitality,
    attack: player.attack,
    maxHealth: player.maxHealth,
  });
});

app.post('/maps', checkAccess(Access.ADMIN), async (req, res) => {
  const { name, type } = req.body;

  if (!name || !type) {
    return res.status(400).json({ error: 'Missing map name or type' });
  }

  const defaultMap = {
    players: {},
    npcs: {},
    droppedItems: [],
    tiles: defaultTiles,
  };

  const mapData = {
    name,
    type,
  };

  try {
    await createOrUpdateMap({ ...defaultMap, ...mapData });
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Error creating map:', error);
    res.status(500).json({ error: 'Failed to create map' });
  }
});

app.put('/maps/:id', checkAccess(Access.ADMIN), async (req, res) => {
  const { id } = req.params;
  const { name, type } = req.body;

  try {
    await createOrUpdateMap({
      id,
      ...(name && { name }),
      ...(type && { type }),
    });

    res.status(200).json({ message: 'Map updated successfully.' });
  } catch (error) {
    console.error('Error updating map:', error);
    res.status(500).json({ error: 'Failed to update map.' });
  }
});

app.put('/npcs/:id', checkAccess(Access.ADMIN), async (req, res) => {
  const { id } = req.params;
  const updated = await updateNpcAll(id, req.body);
  if (!updated) {
    return res.status(404).json({ error: 'NPC not found.' });
  }
  res.status(200).json(updated);
});
app.delete('/npcs/:id', checkAccess(Access.ADMIN), (req, res) => {
  const { id } = req.params;
  deleteNpcEverywhere(id);
  res.status(204).send();
});

app.post('/items', checkAccess(Access.ADMIN), async (req, res) => {
  try {
    const item = req.body;
    if (!item.name || item.sprite === undefined || !item.type) {
      return res.status(400).json({ error: 'Missing required item fields' });
    }

    await createOrUpdateItem(item);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create item.' });
  }
});

app.put('/items/:id', checkAccess(Access.ADMIN), async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid item id.' });
  try {
    await createOrUpdateItem({ ...req.body, id });
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update item.' });
  }
});

app.delete('/items/:id', checkAccess(Access.ADMIN), async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid item id.' });
  try {
    await deleteItem(id);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete item.' });
  }
});

app.post('/shop/buy', checkAccess(Access.USER), async (req, res) => {
  const { shopId, itemId } = req.body;
  const username = req.session.username;

  if (!username) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  const player = getPlayerByName(username);
  const shop = await getShopById(shopId);

  if (!player || !shop) {
    return res.status(404).json({ error: 'Shop or player not found' });
  }

  const success = await buyShopItem(player, itemId, shop);

  if (success) {
    const enrichedPlayer = enrichPlayer(player);
    return res.status(200).json({
      message: 'Purchase completed successfully!',
      inventory: enrichedPlayer.inventory,
    });
  } else {
    return res.status(400).json({
      error: 'Purchase failed: insufficient coins/item',
    });
  }
});

app.get('/assets/:name.bin', async (req, res) => {
  const { name } = req.params;
  const imageUrl = `${IMAGES_PATH}/${imageMap[name]}.png`;
  if (!imageUrl) return res.status(404).send('Image not found');

  try {
    const url = new URL(imageUrl);
    const client = url.protocol === 'https:' ? https : http;

    client
      .get(imageUrl, (imgRes) => {
        if (imgRes.statusCode !== 200) {
          return res.status(502).send('Failed to fetch image');
        }

        res.setHeader('Content-Type', 'application/octet-stream');
        imgRes.on('data', (chunk) => {
          const obfuscatedChunk = Buffer.from(chunk).map((byte) => byte ^ 0xa5);
          res.write(obfuscatedChunk);
        });

        imgRes.on('end', () => res.end());
      })
      .on('error', (err) => {
        console.error('Image fetch failed:', err);
        res.status(500).send('Internal error');
      });
  } catch (err) {
    console.error('Request failed:', err);
    res.status(500).send('Unexpected error');
  }
});

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../client');
  app.use(express.static(clientDist));
  app.get('*', (_, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const server = createServer(app);

async function startServer() {
  try {
    await connectToDatabase();
    await loadInitialData();
    startWebSocketServer(server, sessionMiddleware);
    startGameLoops();
    server.listen(port, () => {
      console.log(`Server is listening on port ${port}`);
    });
  } catch (err) {
    console.error('Falha ao iniciar o servidor:', err);
    process.exit(1);
  }
}

startServer();

async function shutdown() {
  console.log('[Shutdown] Persisting player states...');
  for (const player of Object.values(players)) {
    await persistPlayerSessionState(player);
  }
  console.log('[Shutdown] Server exiting cleanly.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
