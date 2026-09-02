import crypto from 'node:crypto';
import { config } from './config.js';
import { reqCtx } from './context.js';
import { logger } from './logger.js';

/**
 * Distributed tracing: one id that survives every hop a request takes.
 * `/metrics` says whether the server is healthy and the request log what a
 * process did; neither follows one action across the engine's three real
 * boundaries: the browser, a script's webhook, and the instance a warp
 * hands a player to.
 *
 * W3C Trace Context, which every collector reads, without an OpenTelemetry
 * SDK: the wire format is a four-field header and a JSON body, not worth a
 * dependency tree in a self-hosted server. Spans go over OTLP/HTTP to the
 * collector OTEL_EXPORTER_OTLP_ENDPOINT names (Tempo, Jaeger, an agent);
 * with none, the ids still ride on every log line.
 *
 * Nothing here spans the tick: twenty root spans a second would drown the
 * traces about one player's request, and tick time is a distribution that
 * belongs in `/metrics`.
 */

/** OTLP's span kinds, as the protocol numbers them. */
const KIND = { internal: 1, server: 2, client: 3 } as const;
export type SpanKind = keyof typeof KIND;

export type Attributes = Record<string, string | number | boolean | undefined>;

export interface TraceContext {
  /** 32 hex characters. */
  traceId: string;
  /** 16 hex characters. */
  spanId: string;
  /** Whether this trace is being recorded, which every hop must agree on. */
  sampled: boolean;
}

export interface Span {
  readonly context: TraceContext;
  setAttributes(attributes: Attributes): void;
  /** Marks the span failed; the message becomes its status description. */
  fail(message: string): void;
  end(): void;
}

const ALL_ZERO_TRACE = '0'.repeat(32);
const ALL_ZERO_SPAN = '0'.repeat(16);
const TRACEPARENT = /^([\da-f]{2})-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})$/;

export const newTraceId = (): string => crypto.randomBytes(16).toString('hex');
export const newSpanId = (): string => crypto.randomBytes(8).toString('hex');

/**
 * Reads an incoming `traceparent`, or null when nothing in it is usable.
 * An unknown version is still followed, as the spec pins the first four
 * fields for that, and extra fields are ignored. All-zero ids are the
 * spec's "invalid" and are refused, so a caller sending zeroes cannot merge
 * every request into one trace.
 */
export function parseTraceparent(
  header: string | string[] | undefined,
): TraceContext | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;

  const match = TRACEPARENT.exec(raw.trim().toLowerCase().slice(0, 55));
  if (!match) return null;

  const [, version, traceId, spanId, flags] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (version === 'ff') return null;
  if (traceId === ALL_ZERO_TRACE || spanId === ALL_ZERO_SPAN) return null;

  return {
    traceId,
    spanId,
    sampled: (parseInt(flags, 16) & 1) === 1,
  };
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? '01' : '00'}`;
}

/**
 * The span this code is running under, if any. Null inside the tick: a warp
 * is not caused by an HTTP request, so its hand-off is a trace of its own,
 * not a child of whatever request came last.
 */
export const currentTrace = (): TraceContext | null =>
  reqCtx.getStore()?.trace ?? null;

/** The header to put on an outgoing request, so the next process joins in. */
export function traceHeaders(context: TraceContext): Record<string, string> {
  return { traceparent: formatTraceparent(context) };
}

interface FinishedSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  kind: number;
  startNs: bigint;
  endNs: bigint;
  attributes: Attributes;
  error?: string;
}

/**
 * Spans waiting for the next flush. Bounded, and the oldest goes first: a
 * collector that stopped answering must cost this process a fixed amount of
 * memory, not a growing one. Telemetry is never worth an outage.
 */
const MAX_PENDING = 2048;
const pending: FinishedSpan[] = [];
let droppedSpans = 0;
let failedExports = 0;

const FLUSH_INTERVAL_MS = 5_000;
let flushTimer: NodeJS.Timeout | undefined;

/** Counters for `/metrics`: a dropped span is invisible everywhere else. */
export const tracingStats = () => ({
  pending: pending.length,
  dropped: droppedSpans,
  failedExports,
});

const sampledIn = (): boolean =>
  config.tracing.samplePercent >= 100 ||
  (config.tracing.samplePercent > 0 &&
    crypto.randomInt(100) < config.tracing.samplePercent);

const NOOP_SPAN_METHODS = {
  setAttributes: () => {},
  fail: () => {},
  end: () => {},
};

/**
 * Opens a span. Always answers one, even when tracing is off or the trace was
 * not sampled: callers propagate `span.context` and the ids keep appearing on
 * log lines, so the correlation survives with none of the recording cost.
 */
export function startSpan(
  name: string,
  options: {
    parent?: TraceContext | null;
    kind?: SpanKind;
    attributes?: Attributes;
  } = {},
): Span {
  const parent = options.parent ?? null;
  const context: TraceContext = {
    traceId: parent?.traceId ?? newTraceId(),
    spanId: newSpanId(),
    // A sampling decision belongs to the trace, not to the hop: re-deciding
    // here is what produces a trace with holes in the middle of it.
    sampled: parent ? parent.sampled : sampledIn(),
  };

  if (!context.sampled) return { context, ...NOOP_SPAN_METHODS };

  const attributes: Attributes = { ...options.attributes };
  const startNs = BigInt(Date.now()) * 1_000_000n;
  const startedAt = process.hrtime.bigint();
  let error: string | undefined;
  let ended = false;

  return {
    context,
    setAttributes(next) {
      Object.assign(attributes, next);
    },
    fail(message) {
      error = message;
    },
    end() {
      // Ending twice would double-count the span; the second call is the bug
      // of whoever wrote the handler, not something to export.
      if (ended) return;
      ended = true;
      record({
        traceId: context.traceId,
        spanId: context.spanId,
        parentSpanId: parent?.spanId ?? '',
        name,
        kind: KIND[options.kind ?? 'internal'],
        startNs,
        endNs: startNs + (process.hrtime.bigint() - startedAt),
        attributes,
        ...(error ? { error } : {}),
      });
    },
  };
}

function record(span: FinishedSpan): void {
  // With no collector there is nowhere for a span to go, and holding them for
  // one that may never be configured is a leak with a nice name.
  if (!config.tracing.endpoint) return;

  if (pending.length >= MAX_PENDING) {
    pending.shift();
    droppedSpans++;
  }
  pending.push(span);
}

/** OTLP wants a typed value per attribute, one key per type. */
function otlpValue(value: string | number | boolean): Record<string, unknown> {
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { intValue: String(value) }
      : { doubleValue: value };
  }
  return { stringValue: value };
}

function otlpAttributes(
  attributes: Attributes,
): Array<{ key: string; value: Record<string, unknown> }> {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({ key, value: otlpValue(value!) }));
}

function otlpBody(spans: FinishedSpan[]): string {
  return JSON.stringify({
    resourceSpans: [
      {
        resource: {
          attributes: otlpAttributes({
            'service.name': config.tracing.serviceName,
            // Which process, when several answer under one service name. The
            // public URL is the only name an instance has that another
            // instance would recognise (see persistence/instanceRegistry.ts).
            'service.instance.id': config.instance.wsPublicUrl || undefined,
          }),
        },
        scopeSpans: [
          {
            scope: { name: 'aurkad' },
            spans: spans.map((span) => ({
              traceId: span.traceId,
              spanId: span.spanId,
              ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
              name: span.name,
              kind: span.kind,
              startTimeUnixNano: String(span.startNs),
              endTimeUnixNano: String(span.endNs),
              attributes: otlpAttributes(span.attributes),
              // 0 unset, 2 error. "Ok" is not sent: it means an
              // application explicitly declared success, and a request that
              // simply finished has not.
              status: span.error
                ? { code: 2, message: span.error }
                : { code: 0 },
            })),
          },
        ],
      },
    ],
  });
}

/**
 * Ships whatever has accumulated. An undeliverable batch is dropped, not
 * retried: the next flush is five seconds away, the buffer has a ceiling,
 * and a telemetry retry queue turns a collector outage into a server one.
 */
export async function flushSpans(): Promise<void> {
  const endpoint = config.tracing.endpoint;
  if (!endpoint || pending.length === 0) return;

  const batch = pending.splice(0, pending.length);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: otlpBody(batch),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`collector answered ${response.status}`);
    }
    failedExports = 0;
  } catch (err) {
    failedExports++;
    // Once per outage rather than once per flush: a collector that is down
    // stays down for minutes, and this log is not the incident.
    if (failedExports === 1) {
      logger.warn('[tracing] span export failed, dropping the batch', {
        endpoint,
        spans: batch.length,
        err,
      });
    }
  }
}

/** Starts the export loop. A no-op with no collector configured. */
export function startTracing(): void {
  if (!config.tracing.endpoint || flushTimer) return;

  flushTimer = setInterval(() => {
    void flushSpans();
  }, FLUSH_INTERVAL_MS);
  // The loop must never be the reason the process stays alive on shutdown.
  flushTimer.unref();

  logger.info('[tracing] exporting spans', {
    endpoint: config.tracing.endpoint,
    samplePercent: config.tracing.samplePercent,
  });
}

/** Stops the loop and ships what is left, for the shutdown path. */
export async function stopTracing(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = undefined;
  }
  await flushSpans();
}

/** Test seam: what is buffered, without standing up a collector to read it. */
export const pendingSpansForTest = (): ReadonlyArray<{
  name: string;
  traceId: string;
  parentSpanId: string;
}> =>
  pending.map(({ name, traceId, parentSpanId }) => ({
    name,
    traceId,
    parentSpanId,
  }));

/** Test seam: module-level buffers outlive a single test. */
export function resetTracingForTest(): void {
  pending.length = 0;
  droppedSpans = 0;
  failedExports = 0;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = undefined;
  }
}
