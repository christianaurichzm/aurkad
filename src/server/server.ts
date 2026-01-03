const currentNodeVersion = process.versions.node;
const [major] = currentNodeVersion.split('.').map(Number);

const REQUIRED_MAJOR_VERSION = 18;

if (major < REQUIRED_MAJOR_VERSION) {
  console.error(
    `[boot] Node.js >= ${REQUIRED_MAJOR_VERSION} is required (current: ${currentNodeVersion}).`,
  );
  process.exit(1);
}

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';

import { createServer } from 'http';
import express from 'express';
import mongoose from 'mongoose';
import app from './app.js';
import { config } from './config.js';
import { createSessionMiddleware } from './http/session.js';
import { createAuthRouter } from './http/routes/authRoutes.js';
import { createContentRouter } from './http/routes/contentRoutes.js';
import { createModRouter } from './http/routes/modRoutes.js';
import { createAssetsRouter } from './http/routes/assetsRoutes.js';
import {
  markServerShuttingDown,
  startGameLoops,
  startWebSocketServer,
  stopWebSocketServer,
} from './wsServer.js';
import { connectToDatabase, loadInitialData } from './initDb.js';
import { players } from './gameData.js';
import { persistPlayerSessionState } from './services/playerService.js';
import { startPlayerSnapshotLoop } from './persistence/playerSnapshot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const port = config.port;

const sessionMiddleware = createSessionMiddleware();
app.use(sessionMiddleware);

app.use(createAuthRouter());
app.use(createContentRouter());
app.use(createModRouter());
app.use(createAssetsRouter());

if (config.nodeEnv === 'production') {
  const clientDist = path.join(__dirname, '../client');
  app.use(express.static(clientDist));
  app.get('*', (_, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const server = createServer(app);
let stopGameLoops: (() => void) | undefined;
let stopSnapshots: (() => void) | undefined;

async function startServer() {
  try {
    await connectToDatabase();
    await loadInitialData();
    startWebSocketServer(server, sessionMiddleware);
    stopGameLoops = startGameLoops();
    stopSnapshots = startPlayerSnapshotLoop();
    server.listen(port, () => {
      console.log(`Server is listening on port ${port}`);
    });
  } catch (err) {
    console.error('Falha ao iniciar o servidor:', err);
    process.exit(1);
  }
}

startServer();

let isShuttingDown = false;
async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  const forceExitTimer = setTimeout(() => {
    console.error('[Shutdown] Forced exit after timeout.');
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref?.();

  console.log(`[Shutdown] Received ${signal}. Closing server...`);

  stopGameLoops?.();
  stopSnapshots?.();
  markServerShuttingDown();

  const httpClose = new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

  await stopWebSocketServer();
  await httpClose;

  console.log('[Shutdown] Persisting player states...');
  for (const player of Object.values(players)) {
    await persistPlayerSessionState(player);
  }

  try {
    await mongoose.disconnect();
  } catch (e) {
    console.error('[Shutdown] mongoose.disconnect failed:', e);
  }

  console.log('[Shutdown] Server exiting cleanly.');
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((e) => console.error('[Shutdown] failed:', e));
});
process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((e) => console.error('[Shutdown] failed:', e));
});
