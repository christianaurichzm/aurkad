import { createServer } from 'http';
import express, { Request, Response } from 'express';
import app from './app';
import path from 'path';
import { addPlayerOnMap, changeSprite, login, mapSave } from './gameService';
import session from 'express-session';
import { startWebSocketServer } from './wsServer';
import { Access, Player } from '../shared/types';
import checkAccess from './checkAccess';
import { getItems, getNpcs } from './database';

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
  '/changeSprite',
  checkAccess(Access.ADMIN),
  (req: Request, res: Response) => {
    if (req.session.username) {
      changeSprite(req.body.spriteId, req.session.username);
      res.status(200).send('Sucess');
    }
  },
);

app.post(
  '/openMapEditor',
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

app.use(express.static(path.join(__dirname, publicFolder)));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, `${publicFolder}/index.html`));
});

const server = createServer(app);
startWebSocketServer(server, sessionMiddleware);

server.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
