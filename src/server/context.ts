import { AsyncLocalStorage } from 'async_hooks';
import type { TraceContext } from './tracing.js';

export type ReqCtx = {
  requestId: string;
  username?: string;
  /**
   * The trace this work belongs to, and the span inside it. Kept here so every
   * line logged under the request carries it, even from code that knows
   * nothing about HTTP. `requestId` is the first eight characters of the trace
   * id, so the id a player reads off an error is the head of the trace.
   */
  trace?: TraceContext;
};

export const reqCtx = new AsyncLocalStorage<ReqCtx>();
