// Trail of privileged actions: who did what, to whom, and whether it was
// let through. Core, not a module, since a trail `game.json` can switch off
// is not a trail. Recording never fails a request: writes are fire and
// forget, and a failure shows only in the log.

import mongoose from 'mongoose';
import AuditLogModel from '../../model/AuditLog.js';
import { logger } from '../../logger.js';

export type AuditSource = 'http' | 'chat' | 'repl' | 'web';
export type AuditOutcome = 'allowed' | 'denied';

export interface AuditEntry {
  actor?: string | undefined;
  actorAccess?: number | undefined;
  requiredAccess?: number | undefined;
  action: string;
  target?: string | undefined;
  outcome: AuditOutcome;
  status?: number | undefined;
  source: AuditSource;
  ip?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface AuditRecord extends AuditEntry {
  at: number;
}

/** Longest string kept from a payload; the rest is replaced by its length. */
const MAX_VALUE_CHARS = 120;
/** Payload keys kept. Beyond this the request is unusually shaped anyway. */
const MAX_DETAIL_KEYS = 20;

// Substring match, because the shape of a body is not ours to predict: a route
// added later may call it `newPassword` or `apiToken`.
const SECRET_KEY = /pass|secret|token|hash|credential/i;

function summarizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value as object).length} keys}`;
  }
  if (typeof value === 'string') {
    return value.length > MAX_VALUE_CHARS ? `[${value.length} chars]` : value;
  }
  return value;
}

/**
 * A request body reduced to something worth keeping forever. It must never
 * store a secret, or the trail itself leaks it, and it must stay small:
 * `/saveMap` carries a whole tile grid. Nested values become their shape
 * ("[14 items]"), which is what an auditor reads.
 */
export function summarizeDetails(
  body: unknown,
): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return undefined;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_DETAIL_KEYS) break;
    out[key] = SECRET_KEY.test(key) ? '[redacted]' : summarizeValue(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Writes one entry. Never awaited by the caller and never throws: the audited
 * action has already happened, and losing the entry is strictly better than
 * failing the request that produced it.
 */
export function recordAdminAction(entry: AuditEntry): void {
  // Without a connection mongoose buffers the write for ten seconds before
  // rejecting it, which turns every command run during boot or a test into a
  // delayed error. There is nowhere to put the entry, so say so immediately.
  if (mongoose.connection.readyState !== 1) return;
  void AuditLogModel.create({ ...entry, at: new Date() }).catch((err) =>
    logger.error('[audit] failed to record an action', {
      action: entry.action,
      actor: entry.actor,
      err,
    }),
  );
}

export interface AuditQuery {
  actor?: string | undefined;
  action?: string | undefined;
  outcome?: AuditOutcome | undefined;
  /** Epoch ms; entries strictly older than this, for paging backwards. */
  before?: number | undefined;
  limit?: number | undefined;
}

const MAX_PAGE = 200;

/** Newest first. The only read path, used by the operator dashboard. */
export async function listAuditLog(
  query: AuditQuery = {},
): Promise<AuditRecord[]> {
  const filter: Record<string, unknown> = {};
  if (query.actor) filter['actor'] = query.actor;
  // Prefix rather than exact: "POST /mod" finds every moderation route, which
  // is the question an operator actually has.
  if (query.action) {
    filter['action'] = { $regex: `^${escapeRegex(query.action)}` };
  }
  if (query.outcome) filter['outcome'] = query.outcome;
  if (query.before) filter['at'] = { $lt: new Date(query.before) };

  const limit = Math.min(Math.max(Math.floor(query.limit ?? 50), 1), MAX_PAGE);

  const rows = await AuditLogModel.find(filter)
    // Explicit projection: spreading the document would put mongo's _id and
    // __v in an API response, which is storage detail the reader cannot use.
    .select('-_id -__v')
    .sort({ at: -1 })
    .limit(limit)
    .lean<Array<AuditEntry & { at: Date }>>()
    .exec();

  return rows.map((row) => ({ ...row, at: new Date(row.at).getTime() }));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
