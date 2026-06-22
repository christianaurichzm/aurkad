import { sendAction } from './wsManager';

// Client side of the server's custom network events: module code subscribes
// to channels and sends custom actions back. Channel and payload are opaque
// to the engine.

type Handler = (payload: unknown) => void;

const handlers = new Map<string, Set<Handler>>();

/** Subscribe to a channel pushed from the server. Returns an unsubscribe fn. */
export function onServerEvent(channel: string, handler: Handler): () => void {
  let set = handlers.get(channel);
  if (!set) {
    set = new Set();
    handlers.set(channel, set);
  }
  set.add(handler);
  return () => {
    set!.delete(handler);
  };
}

/** Send a custom action to the server (handled by on('customAction', ...)). */
export function sendServerEvent(channel: string, payload?: unknown): void {
  sendAction({ type: 'custom', channel, payload });
}

/** Called by the WS layer when a `custom` message arrives. */
export function dispatchServerEvent(channel: string, payload: unknown): void {
  const set = handlers.get(channel);
  if (!set) return;
  for (const handler of set) {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[customEvents] handler for "${channel}" threw`, err);
    }
  }
}
