import { createServer } from 'http';
import { Request, Response } from 'express';

import app from './app';
import { initializeWebSocketServer } from './wsServer';
import { addPlayerOnMap, getGameState, login } from './gameService';
import { getMap } from './database';

const server = createServer(app);
const port = process.env.PORT || 8080;

initializeWebSocketServer(server);

app.post('/login', async (req: Request, res: Response) => {
  try {
    const player = login(req.body.username);
    if (player) {
      const map = addPlayerOnMap(player.id);
      res.status(200).json({ map, playerId: player.id });
    } else {
      res.status(400).send('User not found');
    }
  } catch (error) {
    res.status(500).send('Internal server error');
  }
});

server.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  console.log(`WebSocket server started on ws://localhost:${port}`);
});
