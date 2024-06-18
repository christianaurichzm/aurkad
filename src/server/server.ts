import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import * as path from 'path';

const app = express();
const port = process.env.PORT || 8080;

app.use(express.static(path.join(__dirname, '../../public')));

app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../../public/index.html'));
});

const server = createServer(app);

const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  ws.on('error', console.error);

  ws.on('message', (data: RawData) => {
    console.log('received: %s', data.toString());
  });

  ws.send('something');
});

server.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
