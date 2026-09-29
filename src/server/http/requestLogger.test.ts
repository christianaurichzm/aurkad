import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { tracing } = vi.hoisted(() => ({
  tracing: {
    endpoint: 'http://127.0.0.1:1/v1/traces',
    serviceName: 'test-engine',
    samplePercent: 100,
  },
}));

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return { ...actual, config: { ...actual.config, tracing } };
});

import { requestLoggerMiddleware } from './requestLogger.js';
import { pendingSpansForTest, resetTracingForTest } from '../tracing.js';

const TRACE = 'e'.repeat(32);
const SPAN = 'f'.repeat(16);

const app = express();
app.use(requestLoggerMiddleware);
app.get('/thing', (_req, res) => res.send('ok'));

beforeEach(() => resetTracingForTest());

describe('requestLoggerMiddleware', () => {
  it('answers with the trace it opened, and an id eight characters long', async () => {
    const res = await request(app).get('/thing');

    const traceparent = res.headers['traceparent'] as string;
    expect(traceparent).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-01$/);
    // The two ids are one id: the short one a player reads out is the head of
    // the long one a collector indexes.
    expect(res.headers['x-request-id']).toBe(traceparent.slice(3, 11));
  });

  it('continues an incoming trace instead of starting its own', async () => {
    const res = await request(app)
      .get('/thing')
      .set('traceparent', `00-${TRACE}-${SPAN}-01`);

    expect(res.headers['traceparent']).toMatch(
      new RegExp(`^00-${TRACE}-[\\da-f]{16}-01$`),
    );
    expect(res.headers['traceparent']).not.toContain(SPAN);
    expect(res.headers['x-request-id']).toBe(TRACE.slice(0, 8));
    expect(pendingSpansForTest()).toEqual([
      { name: 'GET /thing', traceId: TRACE, parentSpanId: SPAN },
    ]);
  });

  it('starts a trace of its own when the header is unusable', async () => {
    const res = await request(app).get('/thing').set('traceparent', 'nope');

    expect(res.headers['traceparent']).toMatch(/^00-[\da-f]{32}-/);
    expect(pendingSpansForTest()[0]?.parentSpanId).toBe('');
  });

  it('puts the trace on the log line, which is the point of carrying it', async () => {
    const written: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });

    await request(app)
      .get('/thing')
      .set('traceparent', `00-${TRACE}-${SPAN}-01`);
    spy.mockRestore();

    const line = written.find((entry) => entry.includes('GET /thing'));
    expect(line).toContain(TRACE);
    expect(line).toContain(`"requestId":"${TRACE.slice(0, 8)}"`);
  });
});
