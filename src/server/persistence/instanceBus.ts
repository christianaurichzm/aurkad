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

/** Started once at boot; returns the stop for shutdown. */
export function startInstanceBus(): () => void {
  if (!from) return () => {};

  let lastId: mongoose.Types.ObjectId | undefined;
  let running = false;

  // Where the stream is, asked for at once rather than on the first poll: an
  // instance is deaf until it knows, and a booting instance must not replay an
  // hour of chat at the players who are already here either.
  const positioned = InstanceEventModel.findOne()
    .sort({ _id: -1 })
    .select('_id')
    .lean<{ _id: mongoose.Types.ObjectId } | null>()
    .then((newest) => {
      lastId = newest?._id ?? new mongoose.Types.ObjectId();
    });

  const poll = async (): Promise<void> => {
    await positioned;

    const events = await InstanceEventModel.find({ _id: { $gt: lastId } })
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
      lastId = event._id;
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
