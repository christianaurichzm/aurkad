import mongoose from 'mongoose';
import { config } from '../config.js';

// What an operator did, kept so abuse of a privileged action can be traced
// after the fact.
//
// Its own collection, never touched by gameplay: the point of a trail is that
// the thing being audited cannot rewrite it as a side effect of running.
const AuditLogSchema = new mongoose.Schema({
  at: { type: Date, required: true },
  /** Account that acted. Undefined only for an unauthenticated attempt. */
  actor: { type: String, index: true },
  /** Access level held at the time, which may since have changed. */
  actorAccess: { type: Number },
  /** Level the action required, so an escalation attempt is readable. */
  requiredAccess: { type: Number },
  /** "POST /mod/ban", "command kick", ... */
  action: { type: String, required: true, index: true },
  /** Who or what it was aimed at, when the request names one. */
  target: { type: String, index: true },
  outcome: { type: String, required: true, enum: ['allowed', 'denied'] },
  /** HTTP status, for the allowed-but-failed case. */
  status: { type: Number },
  source: {
    type: String,
    required: true,
    enum: ['http', 'chat', 'repl', 'web', 'script'],
  },
  ip: { type: String },
  /** Summarised, redacted request payload (see auditService). */
  details: { type: mongoose.Schema.Types.Mixed },
});

// Read pattern is "newest first, optionally for one actor".
AuditLogSchema.index({ at: -1 });

// Retention is the only thing that bounds this collection: entries are written
// by every privileged request and nothing ever deletes them by hand. MongoDB
// expires them itself, so a server nobody administers still stays bounded.
AuditLogSchema.index(
  { at: 1 },
  { expireAfterSeconds: config.audit.retentionDays * 24 * 60 * 60 },
);

export default mongoose.model('AuditLog', AuditLogSchema);
