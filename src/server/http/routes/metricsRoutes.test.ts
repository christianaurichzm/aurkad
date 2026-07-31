import express, { type NextFunction, type Response } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';

vi.mock('../../services/world/gameData.js', () => ({
  getRuntimeState: () => ({ maps: {} }),
}));
vi.mock('../../net/connections.js', () => ({ playersWsMap: new Map() }));

import { createMetricsRouter } from './metricsRoutes.js';
import { recordTick, resetMetricsForTest } from '../../metrics.js';

function appAs(accessLevel: Access | undefined) {
  const app = express();
  app.use((req: ExtendedRequest, _res: Response, next: NextFunction) => {
    req.session = {
      ...(accessLevel !== undefined && { username: 'op', accessLevel }),
    } as ExtendedRequest['session'];
    next();
  });
  app.use(createMetricsRouter());
  return app;
}

beforeEach(() => {
  resetMetricsForTest();
});

describe('GET /metrics', () => {
  it('requires an admin session', async () => {
    expect((await request(appAs(undefined)).get('/metrics')).status).toBe(401);
    expect((await request(appAs(Access.MOD)).get('/metrics')).status).toBe(403);
  });

  it('serves the Prometheus text exposition format', async () => {
    const res = await request(appAs(Access.ADMIN)).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('# HELP engine_tick_duration_ms_p95');
    expect(res.text).toContain('# TYPE engine_tick_duration_ms_p95 gauge');
    expect(res.text).toContain('# TYPE engine_ticks_total counter');
  });

  it('exposes recorded tick percentiles', async () => {
    for (let i = 1; i <= 100; i++) recordTick(i, 0);

    const res = await request(appAs(Access.ADMIN)).get('/metrics');
    const valueOf = (name: string) =>
      Number(
        res.text
          .split('\n')
          .find((l) => l.startsWith(`${name} `))
          ?.split(' ')[1],
      );

    expect(valueOf('engine_tick_duration_ms_p50')).toBe(50);
    expect(valueOf('engine_tick_duration_ms_p99')).toBe(99);
    expect(valueOf('engine_ticks_total')).toBe(100);
  });

  it('emits no NaN values when there is no traffic yet', async () => {
    const res = await request(appAs(Access.ADMIN)).get('/metrics');
    expect(res.text).not.toContain('NaN');
    expect(res.text).not.toContain('undefined');
  });

  // Without these a soak can say "memory grew" and nothing else. The cache
  // counts are what name the map that grew.
  it('exposes process memory and the caches keyed by player or entity', async () => {
    const res = await request(appAs(Access.ADMIN)).get('/metrics');
    const valueOf = (name: string) =>
      Number(
        res.text
          .split('\n')
          .find((l) => l.startsWith(`${name} `))
          ?.split(' ')[1],
      );

    expect(valueOf('engine_process_rss_bytes')).toBeGreaterThan(0);
    expect(valueOf('engine_process_heap_used_bytes')).toBeGreaterThan(0);

    for (const cache of [
      'viewer_cold',
      'viewer_drops',
      'viewer_self',
      'viewer_chunks',
      'viewer_interest',
      'replication',
      'rate_limit',
      'dirty_players',
      'damage_ledger',
    ]) {
      expect(res.text).toContain(`# TYPE engine_cache_entries_${cache} gauge`);
      expect(valueOf(`engine_cache_entries_${cache}`)).toBe(0);
    }
  });
});
