import { Router } from 'express';
import mongoose from 'mongoose';
import { getLastTickAt } from '../../metrics.js';
import { openConnectionCount } from '../../net/connections.js';

// If no tick has been recorded in this window the simulation loop is
// considered stalled and the instance reports not-ready.
const TICK_STALENESS_MS = 5_000;

export function createHealthRouter() {
  const router = Router();

  // Liveness: the process is up and the event loop responds. No dependency
  // checks, so a slow DB never restarts a healthy process. `players` is
  // counted in memory too, and lives here because the login screen shows it
  // before authentication, which /players/online (USER-gated) cannot serve.
  router.get('/healthz', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      players: openConnectionCount(),
    });
  });

  // Readiness: safe to route game traffic, with the DB connected and the loop
  // ticking. 503 while booting or when a dependency is down, so orchestrators
  // hold traffic until the instance is serving.
  router.get('/readyz', (_req, res) => {
    const dbReady =
      mongoose.connection.readyState === mongoose.ConnectionStates.connected;
    const lastTick = getLastTickAt();
    const loopReady = lastTick > 0 && Date.now() - lastTick < TICK_STALENESS_MS;
    const ready = dbReady && loopReady;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      db: dbReady,
      loop: loopReady,
    });
  });

  return router;
}
