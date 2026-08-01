const currentNodeVersion = process.versions.node;
const major = currentNodeVersion.split('.').map(Number)[0] ?? 0;

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
import app, { handleRouteError } from './app.js';
import { config } from './config.js';
import { createSessionMiddleware } from './http/session.js';
import { createHttpLimiter } from './http/middleware/rateLimit.js';
import { createAuthRouter } from './http/routes/authRoutes.js';
import { createContentRouter } from './http/routes/contentRoutes.js';
import { createModRouter } from './http/routes/modRoutes.js';
import { createAssetsRouter } from './http/routes/assetsRoutes.js';
import { createAudioRouter } from './http/routes/audioRoutes.js';
import { createModulesRouter } from './http/routes/modulesRoutes.js';
import { createConsoleRouter } from './http/routes/consoleRoutes.js';
import { createAdminAuthRouter } from './http/routes/adminAuthRoutes.js';
import { createScriptsRouter } from './http/routes/scriptsRoutes.js';
import { registerServerCommands } from './admin/serverCommands.js';
import { createHealthRouter } from './http/routes/healthRoutes.js';
import { createMetricsRouter } from './http/routes/metricsRoutes.js';
import {
  markServerShuttingDown,
  startGameLoops,
  startWebSocketServer,
  stopWebSocketServer,
} from './net/index.js';
import { connectToDatabase, loadInitialData } from './initDb.js';
import { startLiveOps } from './services/liveOpsService.js';
import {
  importContentPack,
  reportUnknownBehaviors,
} from './content/contentPack.js';
import { loadKvStore, startKvStore } from './persistence/kvStore.js';
import { getAllPlayers } from './sim/world.js';
import { persistPlayersOnShutdown } from './services/player/playerService.js';
import { startPlayerSnapshotLoop } from './persistence/playerSnapshot.js';
import { startCensusJob } from './services/economy/economyCensus.js';
import { logger } from './logger.js';
import { startAdminRepl } from './admin/repl.js';
import { loadScripts, unloadAllScripts } from './engine/scripting/index.js';
import {
  rebuildContentConstants,
  writeContentDts,
} from './engine/scripting/contentConstants.js';
import {
  loadModules,
  unloadAllModules,
} from './engine/modules/moduleLoader.js';
import { startRecording, flushReplay } from './sim/replayRecorder.js';
import {
  registerInstance,
  deregisterInstance,
  refreshRegistry,
} from './persistence/instanceRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const port = config.port;

// Health probes mount before session so they stay cheap and sessionless.
app.use(createHealthRouter());

const sessionMiddleware = createSessionMiddleware();
app.use(sessionMiddleware);

const clientDist = path.join(__dirname, '../client');

// The built client, above the limiter: the page is a dozen cached file
// reads before anyone logs in, and counted by address one busy tab behind a
// shared connection would lock its neighbours out of login. A path with no
// file falls through to the routers below.
if (config.nodeEnv === 'production') {
  app.use(express.static(clientDist));
}

// Everything below is rate limited, and nothing above is: the probes answer
// before this line by construction, so a liveness check can never be told to
// slow down. After the session rather than before, so a logged-in caller is
// counted by name instead of sharing a bucket with everyone behind their
// address (auth routes keep their own, stricter limiter on top).
app.use(createHttpLimiter());

// After session: the scrape endpoint is admin-gated (see metricsRoutes).
app.use(createMetricsRouter());

app.use(createAuthRouter());
app.use(createContentRouter());
app.use(createModRouter());
app.use(createAssetsRouter());
app.use(createAudioRouter());
app.use(createModulesRouter());
app.use(createConsoleRouter());
app.use(createAdminAuthRouter());
// Off by default: saving a script here runs on the server (see the trust
// model in engine/scripting/sandbox.ts). Not mounted at all when disabled,
// so the endpoints 404 rather than merely 403.
if (config.scripting.editorEnabled) {
  app.use(createScriptsRouter());
}

// The SPA fallback stays down here, under the limiter: anything reaching it is
// neither a file nor a route, so it is the one static answer worth counting.
if (config.nodeEnv === 'production') {
  app.get('*', (_, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Last in the chain, so it sees what any route above forwarded.
app.use(handleRouteError);

const server = createServer(app);
let stopGameLoops: (() => void) | undefined;
let stopSnapshots: (() => void) | undefined;
let stopCensus: (() => void) | undefined;
let stopKv: (() => Promise<void>) | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

async function startServer() {
  try {
    await connectToDatabase();
    await importContentPack();
    await loadKvStore();
    await loadInitialData();

    const { wsPublicUrl, mapIds, heartbeatMs } = config.instance;
    if (wsPublicUrl && mapIds) {
      await registerInstance(wsPublicUrl, mapIds);
      await refreshRegistry();
      // A missed beat must not be fatal: the registry entry has a TTL, so the
      // instance only looks stale until the next beat lands. Letting the
      // rejection escape the timer would kill the process instead.
      heartbeatTimer = setInterval(() => {
        void (async () => {
          try {
            await registerInstance(wsPublicUrl, mapIds);
            await refreshRegistry();
          } catch (err) {
            logger.error('[instance] Heartbeat failed', { err });
          }
        })();
      }, heartbeatMs);
      logger.info('[instance] Registered', { wsPublicUrl, mapIds });
    }
    stopKv = startKvStore();
    // Build typed content constants (and their .d.ts) before scripts/modules
    // load so `Items.X` etc. resolve at load time.
    await rebuildContentConstants();
    writeContentDts();
    registerServerCommands();
    startLiveOps();
    loadModules();
    await loadScripts();
    // Only now can content that names a script behaviour be checked: before
    // this the registry is empty and every reference would look broken.
    await reportUnknownBehaviors();
    startWebSocketServer(server, sessionMiddleware);
    stopGameLoops = startGameLoops();
    stopSnapshots = startPlayerSnapshotLoop();
    stopCensus = startCensusJob();
    if (process.env.REPLAY_RECORD === 'true') {
      startRecording();
      logger.info('[Replay] Session recording started');
    }
    server.listen(port, () => {
      logger.info('Server is listening', { port });
      startAdminRepl();
    });
  } catch (err) {
    logger.error('Failed to start server', { err });
    process.exit(1);
  }
}

void startServer();

let isShuttingDown = false;
async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  const forceExitTimer = setTimeout(() => {
    logger.error('[Shutdown] Forced exit after timeout');
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref?.();

  logger.info('[Shutdown] Received signal; closing server', { signal });

  stopGameLoops?.();
  stopSnapshots?.();
  stopCensus?.();
  clearInterval(heartbeatTimer);
  if (config.instance.wsPublicUrl) {
    await deregisterInstance(config.instance.wsPublicUrl).catch(
      () => undefined,
    );
  }
  unloadAllScripts();
  unloadAllModules();
  markServerShuttingDown();

  const httpClose = new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

  await stopWebSocketServer();
  await httpClose;

  const replayPath = flushReplay();
  if (replayPath) logger.info('[Replay] Session saved', { path: replayPath });

  logger.info('[Shutdown] Persisting player states...');
  const { saved, failed } = await persistPlayersOnShutdown(getAllPlayers());
  if (failed > 0) {
    logger.error('[Shutdown] some players could not be persisted', {
      saved,
      failed,
    });
  } else {
    logger.info('[Shutdown] Player states persisted', { saved });
  }

  await stopKv?.();

  try {
    await mongoose.disconnect();
  } catch (e) {
    logger.error('[Shutdown] mongoose.disconnect failed', { err: e });
  }

  logger.info('[Shutdown] Server exiting cleanly');
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((e) =>
    logger.error('[Shutdown] failed', { err: e }),
  );
});
process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((e) =>
    logger.error('[Shutdown] failed', { err: e }),
  );
});
