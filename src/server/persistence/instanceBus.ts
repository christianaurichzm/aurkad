import mongoose from 'mongoose';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Server-wide events across instances: a global chat line, a broadcast, the
 * MOTD, the mode, a mute, a kick, a live-ops flag. A map lives on one
 * instance, so the world already reaches the right process; these would
 * otherwise reach only the instance that received them.
 *
 * A capped collection, polled. Capped because nobody keeps this stream: the
 * size is the whole retention, and an instance down longer than the buffer
 * misses lines it could not have delivered. Polled because change streams
 * need a replica set and a standalone Mongo still has to work. Silent with
 * no `WS_PUBLIC_URL`, as there is then no second instance to tell.
 */

const InstanceEventSchema = new mongoose.Schema(
  {
    from: { type: String, required: true },
    type: { type: String, required: true },
    payload: mongoose.Schema.Types.Mixed,
    at: { type: Date, default: Date.now },
  },
  { capped: { size: 1_000_000, max: 5_000 } },
);

const InstanceEventModel = mongoose.model('InstanceEvent', InstanceEventSchema);

// Half a second, because the loudest thing on here is chat: a second of lag
// reads as a broken conversation, and anything under this is a poll that costs
// more than the message.
const POLL_MS = 500;

// One batch, so a burst cannot turn into an unbounded read. Anything past it
// waits for the next poll half a second later, still in order.
const BATCH = 200;

const from = config.instance.wsPublicUrl;

type Handler = (payload: never) => void;
const handlers = new Map<string, Handler>();

/**
 * What to do with one kind of event arriving from elsewhere. The handler is
 * the local half of the action, never the part that publishes, or two
 * instances would keep handing the same line back to each other.
 */
export function onInstanceEvent<T>(
  type: string,
  handler: (payload: T) => void,
): void {
  handlers.set(type, handler);
}

export function publishToInstances(type: string, payload: unknown): void {
  if (!from) return;

  // Fire and forget with a catch: an operator's command answers from their
  // instance and must not wait on, or fail with, the write that tells others.
  void InstanceEventModel.create({ from, type, payload }).catch((err) =>
    logger.error('[bus] publish failed', { type, err }),
  );
}

// How far back each poll reads again. An id is the publisher's clock
// second and then a per-process random value, so a line from another
// instance can land after one read here and still sort before it. This
// covers insert latency and clock skew; lines from a publisher further
// behind are lost.
const LOOKBACK_MS = 10_000;

const idAt = (ms: number) =>
  mongoose.Types.ObjectId.createFromTime(Math.floor(ms / 1000));

/** Started once at boot; returns the stop for shutdown. */
export function startInstanceBus(): () => void {
  if (!from) return () => {};

  // What was read so far, by id, while it is young enough to be read again.
  const seen = new Map<string, mongoose.Types.ObjectId>();
  let floor = Date.now() - LOOKBACK_MS;
  let running = false;

  // Where the stream is, asked at once rather than on the first poll: until
  // then the instance is deaf, and a booting one must not replay chat at the
  // players already here, so the current window counts as read.
  const positioned = InstanceEventModel.find({ _id: { $gte: idAt(floor) } })
    .select('_id')
    .lean<{ _id: mongoose.Types.ObjectId }[]>()
    .then((docs) => {
      for (const { _id } of docs) seen.set(_id.toHexString(), _id);
    });

  const poll = async (): Promise<void> => {
    await positioned;
    const startedAt = Date.now();

    const events = await InstanceEventModel.find({
      _id: { $gte: idAt(floor), $nin: [...seen.values()] },
    })
      .sort({ _id: 1 })
      .limit(BATCH)
      .lean<
        {
          _id: mongoose.Types.ObjectId;
          from: string;
          type: string;
          payload: unknown;
        }[]
      >();

    for (const event of events) {
      seen.set(event._id.toHexString(), event._id);
      if (event.from === from) continue;

      const handler = handlers.get(event.type);
      if (!handler) continue;
      // Isolated like the tick systems: one instance sending something this
      // build does not understand cannot stop the rest of the batch.
      try {
        (handler as (payload: unknown) => void)(event.payload);
      } catch (err) {
        logger.error('[bus] handler threw', { type: event.type, err });
      }
    }

    // A full batch may have left older lines unread, so the window only moves
    // on after a poll that read everything there was.
    if (events.length < BATCH) {
      floor = startedAt - LOOKBACK_MS;
      const oldest = idAt(floor).getTimestamp().getTime();
      for (const [key, id] of seen) {
        if (id.getTimestamp().getTime() < oldest) seen.delete(key);
      }
    }
  };

  const timer = setInterval(() => {
    if (running) return;
    running = true;
    poll()
      .catch((err) => logger.error('[bus] poll failed', { err }))
      .finally(() => {
        running = false;
      });
  }, POLL_MS);
  timer.unref?.();

  return () => clearInterval(timer);
}
