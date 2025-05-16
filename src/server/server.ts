import { createServer } from 'http';
import express, { Request, Response } from 'express';
import app from './app';
import path from 'path';
import {
  addPlayerOnMap,
  changeSprite,
  login,
  mapSave,
  getPlayerByName,
  handlePlayerUpdate,
  removePlayerFromMap,
  disconnectPlayer,
} from './gameService';
import session from 'express-session';
import { broadcast, playersWsMap, startWebSocketServer } from './wsServer';
import { Access, Direction, Player, PlayerAction } from '../shared/types';
import checkAccess from './checkAccess';
import {
  addItem,
  addNpc,
  bannedPlayers,
  deleteItemEverywhere,
  deleteNpcEverywhere,
  getItems,
  getNpcs,
  updateItemEverywhere,
  updateNpcAll,
} from './database';
import { SPRITE_HEIGHT, SPRITE_WIDTH, TILE_SIZE } from '../shared/constants';

declare module 'express-session' {
  interface SessionData {
    username: Player['name'];
    accessLevel: Access;
  }
}

export type ExtendedRequest = Request & {
  session: session.Session & Partial<session.SessionData>;
};

const port = process.env.PORT || 8080;
const publicFolder = '../../public';

const sessionMiddleware = session({
  secret: 'changeit',
  resave: false,
  saveUninitialized: false,
});

app.use(sessionMiddleware);

app.post('/login', async (req: Request, res: Response) => {
  const username = req.body.username;
  if (!username) {
    res.status(400).send('Username is required');
    return;
  }

  const ban = bannedPlayers[username];
  if (ban) {
    if (!ban.until || Date.now() < ban.until) {
      return res.status(403).json({
        message: `You are banned from this game.${ban.reason ? ` Reason: ${ban.reason}` : ''}${ban.until ? ` Until: ${new Date(ban.until).toLocaleString()}` : ''}`,
      });
    } else {
      delete bannedPlayers[username];
    }
  }

  try {
    const player = await login(username);
    if (player) {
      req.session.username = username;
      req.session.accessLevel = player.access;
      const map = addPlayerOnMap(player.id);
      req.session.save((err) => {
        if (err) {
          console.error('Session save failed:', err);
          res.status(500).send('Failed to save session');
          return;
        }
        res.status(200).json({ player, map });
      });
    } else {
      res.status(404).send('User not found');
    }
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
    res.status(200).send('Logged out');
  });
});

app.post(
  '/saveMap',
  checkAccess(Access.ADMIN),
  (req: Request, res: Response) => {
    mapSave(req.body.mapId, req.body.tiles);
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

app.get('/npcs', checkAccess(Access.ADMIN), (req: Request, res: Response) => {
  try {
    const npcs = Object.values(getNpcs());
    res.status(200).json(npcs);
  } catch (error) {
    res.status(500).json({ error: 'Could not fetch NPCs' });
  }
});

app.get('/items', checkAccess(Access.ADMIN), (req: Request, res: Response) => {
  try {
    const items = Object.values(getItems());
    res.status(200).json(items);
  } catch (error) {
    res.status(500).json({ error: 'Could not fetch items' });
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
    bannedPlayers[playerName] = { reason, until };
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
  const { name, sprite, maxHealth, attack, behavior, experienceValue } =
    req.body;

  const defaults = {
    position: { x: 0, y: 0 },
    width: SPRITE_WIDTH,
    height: SPRITE_HEIGHT,
    direction: Direction.Down,
    action: PlayerAction.Idle,
    mapId: '1',
    attackRange: TILE_SIZE,
    itemsToDrop: [],
    health: maxHealth,
  };

  const npcData = {
    ...defaults,
    name,
    sprite,
    maxHealth,
    attack,
    behavior,
    experienceValue,
  };

  const newNpc = addNpc(npcData);
  res.status(201).json(newNpc);
});

app.put('/npcs/:id', checkAccess(Access.ADMIN), (req, res) => {
  const { id } = req.params;
  const updated = updateNpcAll(id, req.body);
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

app.post('/items', checkAccess(Access.ADMIN), (req, res) => {
  try {
    const newItem = addItem(req.body);
    res.status(201).json(newItem);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create item.' });
  }
});

app.put('/items/:id', checkAccess(Access.ADMIN), (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid item id.' });
  const updated = updateItemEverywhere(id, req.body);
  if (!updated) {
    return res.status(404).json({ error: 'Item not found.' });
  }
  res.status(200).json(updated);
});

app.delete('/items/:id', checkAccess(Access.ADMIN), (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid item id.' });
  deleteItemEverywhere(id);
  res.status(204).send();
});

app.use(express.static(path.join(__dirname, publicFolder)));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, `${publicFolder}/index.html`));
});

const server = createServer(app);
startWebSocketServer(server, sessionMiddleware);

server.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
