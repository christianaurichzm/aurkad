import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// The collector's address is only known once it is listening, so the config
// this module reads is a mutable object rather than a frozen copy. Hoisted
// because the mock factory below runs before any top-level statement here.
const { tracing } = vi.hoisted(() => ({
  tracing: {
    endpoint: undefined as string | undefined,
    serviceName: 'test-engine',
    samplePercent: 100,
  },
}));

vi.mock('./config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config.js')>();
  return {
    config: {
      ...actual.config,
      tracing,
      instance: { ...actual.config.instance, wsPublicUrl: 'ws://one:8080/ws' },
    },
  };
});

import {
  flushSpans,
  formatTraceparent,
  parseTraceparent,
  resetTracingForTest,
  startSpan,
  tracingStats,
  type TraceContext,
} from './tracing.js';

const TRACE = 'a'.repeat(32);
const SPAN = 'b'.repeat(16);

describe('traceparent', () => {
  it('reads a well-formed header, sampled flag and all', () => {
    expect(parseTraceparent(`00-${TRACE}-${SPAN}-01`)).toEqual({
      traceId: TRACE,
      spanId: SPAN,
      sampled: true,
    });
    expect(parseTraceparent(`00-${TRACE}-${SPAN}-00`)?.sampled).toBe(false);
  });

  it('follows a version it does not know, which is what the spec asks', () => {
    // A later version may append fields; the first four are pinned forever.
    expect(parseTraceparent(`01-${TRACE}-${SPAN}-01-something`)?.traceId).toBe(
      TRACE,
    );
    expect(parseTraceparent(`ff-${TRACE}-${SPAN}-01`)).toBeNull();
  });

  it('refuses the shapes that would merge unrelated work into one trace', () => {
    expect(parseTraceparent(undefined)).toBeNull();
    expect(parseTraceparent('')).toBeNull();
    expect(parseTraceparent('nonsense')).toBeNull();
    expect(parseTraceparent(`00-${'0'.repeat(32)}-${SPAN}-01`)).toBeNull();
    expect(parseTraceparent(`00-${TRACE}-${'0'.repeat(16)}-01`)).toBeNull();
    expect(parseTraceparent(`00-${TRACE.slice(1)}-${SPAN}-01`)).toBeNull();
  });

  it('round-trips what it formats, and takes the first of a repeated header', () => {
    const context: TraceContext = {
      traceId: TRACE,
      spanId: SPAN,
      sampled: true,
    };
    expect(parseTraceparent(formatTraceparent(context))).toEqual(context);
    expect(
      parseTraceparent([`00-${TRACE}-${SPAN}-01`, 'second'])?.traceId,
    ).toBe(TRACE);
  });
});

describe('spans', () => {
  beforeEach(() => {
    resetTracingForTest();
    tracing.endpoint = 'http://127.0.0.1:1/v1/traces';
    tracing.samplePercent = 100;
  });

  it('starts a trace when there is no parent', () => {
    const span = startSpan('root');

    expect(span.context.traceId).toMatch(/^[\da-f]{32}$/);
    expect(span.context.spanId).toMatch(/^[\da-f]{16}$/);
    expect(span.context.sampled).toBe(true);
  });

  it('joins the parent trace and keeps its own span id', () => {
    const parent = parseTraceparent(`00-${TRACE}-${SPAN}-01`);
    const span = startSpan('child', { parent });

    expect(span.context.traceId).toBe(TRACE);
    expect(span.context.spanId).not.toBe(SPAN);
  });

  it('inherits an unsampled decision instead of taking its own', () => {
    tracing.samplePercent = 100;
    const parent = parseTraceparent(`00-${TRACE}-${SPAN}-00`);

    const span = startSpan('child', { parent });
    span.end();

    expect(span.context.sampled).toBe(false);
    expect(tracingStats().pending).toBe(0);
  });

  it('records nothing when the sampler is off, but still hands out ids', () => {
    tracing.samplePercent = 0;

    const span = startSpan('root');
    span.end();

    expect(span.context.traceId).toMatch(/^[\da-f]{32}$/);
    expect(tracingStats().pending).toBe(0);
  });

  it('buffers nothing at all when no collector is configured', () => {
    tracing.endpoint = undefined;

    startSpan('root').end();

    expect(tracingStats().pending).toBe(0);
  });

  it('counts a span once, however many times end is called', () => {
    const span = startSpan('root');
    span.end();
    span.end();

    expect(tracingStats().pending).toBe(1);
  });

  it('drops the oldest span rather than growing without a bound', () => {
    for (let i = 0; i < 2100; i++) startSpan(`span-${i}`).end();

    const stats = tracingStats();
    expect(stats.pending).toBe(2048);
    expect(stats.dropped).toBe(52);
  });
});

describe('OTLP export', () => {
  let collector: Server;
  let received: string[] = [];
  let answer = 200;

  beforeAll(async () => {
    collector = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        received.push(body);
        res.statusCode = answer;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => collector.listen(0, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => collector.close(() => resolve()));
  });

  beforeEach(() => {
    resetTracingForTest();
    received = [];
    answer = 200;
    tracing.samplePercent = 100;
    const { port } = collector.address() as AddressInfo;
    tracing.endpoint = `http://127.0.0.1:${port}/v1/traces`;
  });

  it('posts what a collector expects, down to the hex ids and the status', async () => {
    const parent = parseTraceparent(`00-${TRACE}-${SPAN}-01`)!;
    const ok = startSpan('GET /healthz', {
      parent,
      kind: 'server',
      attributes: { 'http.request.method': 'GET' },
    });
    ok.setAttributes({ 'http.response.status_code': 200 });
    ok.end();

    const broken = startSpan('script.http webhook', { kind: 'client' });
    broken.fail('connect ECONNREFUSED');
    broken.end();

    await flushSpans();

    expect(received).toHaveLength(1);
    const payload = JSON.parse(received[0]!) as {
      resourceSpans: [
        {
          resource: { attributes: { key: string; value: unknown }[] };
          scopeSpans: [{ spans: Record<string, unknown>[] }];
        },
      ];
    };
    const resource = payload.resourceSpans[0].resource.attributes;
    expect(resource).toContainEqual({
      key: 'service.name',
      value: { stringValue: 'test-engine' },
    });
    expect(resource).toContainEqual({
      key: 'service.instance.id',
      value: { stringValue: 'ws://one:8080/ws' },
    });

    const [first, second] = payload.resourceSpans[0].scopeSpans[0].spans as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(first.traceId).toBe(TRACE);
    expect(first.parentSpanId).toBe(SPAN);
    expect(first.name).toBe('GET /healthz');
    expect(first.kind).toBe(2);
    expect(String(first.startTimeUnixNano)).toMatch(/^\d{19}$/);
    expect(
      BigInt(String(first.endTimeUnixNano)) >=
        BigInt(String(first.startTimeUnixNano)),
    ).toBe(true);
    expect(first.attributes).toContainEqual({
      key: 'http.response.status_code',
      value: { intValue: '200' },
    });
    expect(first.status).toEqual({ code: 0 });

    // A failed span carries the reason, and no parent field at all when it is
    // a root: an empty parentSpanId is a span some collectors reject.
    expect(second.status).toEqual({
      code: 2,
      message: 'connect ECONNREFUSED',
    });
    expect(second).not.toHaveProperty('parentSpanId');

    expect(tracingStats()).toEqual({
      pending: 0,
      dropped: 0,
      failedExports: 0,
    });
  });

  it('drops a batch the collector refused instead of retrying it forever', async () => {
    answer = 503;
    startSpan('root').end();

    await flushSpans();
    expect(tracingStats().pending).toBe(0);
    expect(tracingStats().failedExports).toBe(1);

    // And the next batch is attempted regardless: one outage does not switch
    // exporting off for the life of the process.
    answer = 200;
    startSpan('root').end();
    await flushSpans();
    expect(received).toHaveLength(2);
    expect(tracingStats().failedExports).toBe(0);
  });

  it('sends nothing when there is nothing to send', async () => {
    await flushSpans();

    expect(received).toHaveLength(0);
  });
});
