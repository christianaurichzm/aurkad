// The version this engine supports, kept equal to `engines.node` in
// package.json. A message, not a shield: ESM evaluates every import below
// first, so an older Node may fail earlier, and this then names the cause.
const currentNodeVersion = process.versions.node;
const major = currentNodeVersion.split('.').map(Number)[0] ?? 0;

const REQUIRED_MAJOR_VERSION = 20;

if (major < REQUIRED_MAJOR_VERSION) {
  console.error(
    `[boot] Node.js >= ${REQUIRED_MAJOR_VERSION} is required (current: ${currentNodeVersion}).`,
  );
  process.exit(1);
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createServer } from 'node:http';
import express from 'express';
import mongoose from 'mongoose';
import app, { handleRouteError } from './app.js';
import { config } from './config.js';
import { startTracing, stopTracing } from './tracing.js';
import { releaseAllPresence, renewPresence } from './persistence/presence.js';
import {
  onInstanceEvent,
  startInstanceBus,
} from './persistence/instanceBus.js';
import { receiveGlobalLine } from './services/comms/chatService.js';
import { startInstances } from './services/world/instanceService.js';
import { kickLocally } from './services/player/playerService.js';
import {
  applyFlagFromInstance,
  forgetFlagFromInstance,
  type LiveOpsFlag,
} from './services/liveOpsService.js';
import { serverState, type ServerMode } from './services/world/serverState.js';
import type { ChatMessagePayload } from '../shared/types.js';
import { flushAnalytics, startAnalytics } from './services/analyticsService.js';
import { createSessionMiddleware } from './http/session.js';
import { createHttpLimiter } from './http/middleware/rateLimit.js';
import { createAuthRouter } from './http/routes/authRoutes.js';
import { createContentRouter } from './http/routes/contentRoutes.js';
import { createMapRouter } from './http/routes/mapRoutes.js';
import { createPlayerRouter } from './http/routes/playerRoutes.js';
import { createShopRouter } from './http/routes/shopRoutes.js';
import { contentRefresh } from './http/middleware/contentRefresh.js';
import { createModRouter } from './http/routes/modRoutes.js';
import { createAssetsRouter } from './http/routes/assetsRoutes.js';
import { createAudioRouter } from './http/routes/audioRoutes.js';
import { createModulesRouter } from './http/routes/modulesRoutes.js';
import { createConsoleRouter } from './http/routes/consoleRoutes.js';
import { createAdminAuthRouter } from './http/routes/adminAuthRoutes.js';
import { createThemeRouter } from './http/routes/themeRoutes.js';
import { createScriptsRouter } from './http/routes/scriptsRoutes.js';
import { registerServerCommands } from './admin/serverCommands.js';
import { runForwardedCommand } from './engine/commands.js';
import { registerPlayerCommands } from './admin/playerCommands.js';
import { createHealthRouter } from './http/routes/healthRoutes.js';
import { createGameRouter } from './http/routes/gameRoutes.js';
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
const __dirname = path.dirname(__filename);

const port = config.port;

// Health probes, and the name and theme the login screen shows, mount before
// session so they stay cheap and sessionless.
app.use(createHealthRouter());
app.use(createGameRouter());

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
// Above the routers that write content, so it sees the response of any of them.
app.use(contentRefresh);
app.use(createContentRouter());
app.use(createMapRouter());
app.use(createPlayerRouter());
app.use(createShopRouter());
app.use(createModRouter());
app.use(createAssetsRouter());
app.use(createAudioRouter());
app.use(createModulesRouter());
app.use(createConsoleRouter());
app.use(createAdminAuthRouter());
app.use(createThemeRouter());
// Off by default: saving a script here runs on the server (see the trust
// model in engine/scripting/sandbox.ts). Not mounted at all when disabled,
// so the endpoints 404 rather than merely 403.
if (config.scripting.editorEnabled) {
  app.use(createScriptsRouter());
}

// The SPA fallback stays down here, under the limiter: anything reaching it is
// neither a file nor a route, so it is the one static answer worth counting.
if (config.nodeEnv === 'production') {
  // path-to-regexp v8 rejects an unnamed wildcard when the route registers.
  app.get('/*splat', (_, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Last in the chain, so it sees what any route above forwarded.
app.use(handleRouteError);

const server = createServer(app);
let stopGameLoops: (() => void) | undefined;
let stopSnapshots: (() => void) | undefined;
let stopCensus: (() => void) | undefined;
let stopAnalytics: (() => void) | undefined;
let stopKv: (() => Promise<void>) | undefined;
let stopBus: (() => void) | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

/**
 * The half of an operator's action that runs on the instances that did not
 * receive the command: the same local effect, never the publish, or two
 * instances would hand a line back and forth forever. Map chat, movement
 * and combat are absent, since a map lives on one instance.
 */
function registerInstanceEvents(): void {
  onInstanceEvent<ChatMessagePayload>('chat', receiveGlobalLine);

  onInstanceEvent<{ text: string }>('motd', ({ text }) => {
    serverState.motd = text;
  });

  onInstanceEvent<{ mode: ServerMode }>('mode', ({ mode }) => {
    serverState.mode = mode;
  });

  onInstanceEvent<{ username: string; expiry: number | null }>(
    'mute',
    ({ username, expiry }) => {
      if (expiry === null) serverState.mutes.delete(username);
      else serverState.mutes.set(username, expiry);
    },
  );

  onInstanceEvent<{ username: string; reason: string }>(
    'kick',
    ({ username, reason }) => {
      void kickLocally(username, reason);
    },
  );

  onInstanceEvent<Parameters<typeof runForwardedCommand>[0]>(
    'playerCommand',
    runForwardedCommand,
  );
  onInstanceEvent<LiveOpsFlag>('flagSet', applyFlagFromInstance);
  onInstanceEvent<{ name: string }>('flagCleared', ({ name }) =>
    forgetFlagFromInstance(name),
  );
}

async function startServer() {
  try {
    await connectToDatabase();
    await importContentPack();
    await loadKvStore();
    await loadInitialData();

    const { wsPublicUrl, mapIds, heartbeatMs } = config.instance;
    // The address is this process's identity, which a lease is held with, so
    // the beat runs whenever there is one, even owning every map. Sharding adds
    // the registry to it.
    if (wsPublicUrl) {
      if (mapIds) {
        await registerInstance(wsPublicUrl, mapIds);
        await refreshRegistry();
      }
      // A missed beat must not be fatal: the registry entry has a TTL, so the
      // instance only looks stale until the next beat lands, and a lease is
      // written for three beats. Letting the rejection escape the timer would
      // kill the process instead.
      heartbeatTimer = setInterval(() => {
        void (async () => {
          try {
            if (mapIds) {
              await registerInstance(wsPublicUrl, mapIds);
              await refreshRegistry();
            }
            await renewPresence();
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
    registerPlayerCommands();
    startInstances();
    registerInstanceEvents();
    stopBus = startInstanceBus();
    startLiveOps();
    startTracing();
    loadModules();
    await loadScripts();
    // Only now can content that names a script behaviour be checked: before
    // this the registry is empty and every reference would look broken.
    await reportUnknownBehaviors();
    startWebSocketServer(server, sessionMiddleware);
    stopGameLoops = startGameLoops();
    stopSnapshots = startPlayerSnapshotLoop();
    stopCensus = startCensusJob();
    // After the modules and scripts are loaded, like every other subscriber:
    // the hooks it listens on are the ones the login path emits, and a login
    // cannot happen before the server is listening a few lines below.
    stopAnalytics = startAnalytics();
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
async function shutdown(signal: string, exitCode = 0) {
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
  stopAnalytics?.();
  stopBus?.();
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
    // `close` stops new connections and waits for open ones, and an idle
    // keep-alive socket in a browser is open, so the wait would run to the
    // force-exit timer before players are written. A request in flight still
    // gets to finish.
    server.closeIdleConnections();
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

  // After the last write of every player above, and before the connection
  // closes: an account still leased by a process that is gone waits out the
  // expiry before it can log in anywhere, for nothing.
  await releaseAllPresence().catch((err) =>
    logger.error('[presence] releasing leases on shutdown failed', { err }),
  );

  await stopKv?.();
  // Late, and awaited: the spans from above describe the shutdown, and a
  // batch left in the buffer is the part of the incident nobody reads. The
  // analytics writes are fire-and-forget, so this is where they land.
  await Promise.all([stopTracing(), flushAnalytics()]);

  try {
    await mongoose.disconnect();
  } catch (e) {
    logger.error('[Shutdown] mongoose.disconnect failed', { err: e });
  }

  logger.info('[Shutdown] Server exiting', { exitCode });
  await drainOutput();
  process.exit(exitCode);
}

/**
 * Lets what was just logged reach the pipe before the process exits.
 * `process.exit` does not flush: to a terminal the streams are synchronous,
 * but to a pipe (`docker logs`, a journal) the last writes are queued and
 * dropped, and they are the lines that say why the process is going away.
 */
function drainOutput(): Promise<unknown> {
  return Promise.all(
    [process.stdout, process.stderr].map(
      (stream) =>
        new Promise((resolve) => {
          // Queued behind everything already written, so its callback is the
          // signal that the rest went out.
          stream.write('', resolve);
        }),
    ),
  );
}

/**
 * The two ways this process dies without being asked to. Node prints and
 * exits, with players still in memory: they are written behind, so up to
 * PLAYER_SNAPSHOT_INTERVAL_MS of progress lives nowhere else. The signal
 * shutdown flushes them, bounded by its force-exit timer. Best effort, as
 * the state that threw may be the one being written, and the exit code is
 * non-zero either way so an orchestrator restarts.
 */
function crash(kind: string, err: unknown) {
  logger.error(`[crash] ${kind}`, { err });
  shutdown(kind, 1).catch(() => process.exit(1));
}

process.on('uncaughtException', (err) => crash('uncaughtException', err));
process.on('unhandledRejection', (reason) =>
  crash('unhandledRejection', reason),
);

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
