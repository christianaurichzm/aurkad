import { WebSocketServer, WebSocket, RawData } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws: WebSocket) => {
  ws.on('error', console.error);

  ws.on('message', (data: RawData) => {
    console.log('received: %s', data);
  });

  ws.send('something');
});

console.log('WebSocket server is running on ws://localhost:8080');
