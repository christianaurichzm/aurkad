import { createServer } from 'http';

import app from './app';
import { initializeWebSocketServer } from './wsServer';

const server = createServer(app);
const port = process.env.PORT || 8080;

initializeWebSocketServer(server);

server.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  console.log(`WebSocket server started on ws://localhost:${port}`);
});
