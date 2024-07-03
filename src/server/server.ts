import { createServer } from 'http';
import { Request, Response } from 'express';
import app from './app';
import {
  addPlayerOnMap,
  changeSprite,
  getPlayerByName,
  login,
  mapSave,
} from './gameService';
import session from 'express-session';
import cors from 'cors';
import { startWebSocketServer } from './wsServer';
import { Access, Player } from '../shared/types';
import checkAccess from './checkAccess';

declare module 'express-session' {
  interface SessionData {
    username: Player['name'];
    accessLevel: Access;
  }
}

export type ExtendedRequest = Request & {
  session: session.Session & Partial<session.SessionData>;
};

const server = createServer(app);
const port = process.env.PORT || 8080;

app.use(cors());

const sessionMiddleware = session({
  secret: 'changeit',
  resave: false,
  saveUninitialized: false,
});

app.use(sessionMiddleware);
startWebSocketServer(server, sessionMiddleware);

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
        res.status(200).json({ playerId: player.id, map });
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

server.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
