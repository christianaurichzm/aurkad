import { emitGameEvent } from '../../engine/eventBus.js';
import { emit } from '../../engine/hooks.js';
import { getPlayerByName } from '../player/playerService.js';
import type { ClientCustomAction } from '../../engine/actions.js';
import type { PlayerServer } from '../../../shared/types.js';

// Custom network events: the data pipe between a game's server-side scripts and
// its client-side code. The engine only routes; channel and payload are defined
// by the game.

// --- Server -> client --------------------------------------------------------

export function sendCustomEvent(
  player: PlayerServer,
  channel: string,
  payload: unknown,
): void {
  emitGameEvent({
    type: 'customPlayer',
    username: player.name,
    channel,
    payload,
  });
}

export function sendMapCustomEvent(
  mapId: string,
  channel: string,
  payload: unknown,
): void {
  emitGameEvent({ type: 'customMap', mapId, channel, payload });
}

export function broadcastCustomEvent(channel: string, payload: unknown): void {
  emitGameEvent({ type: 'customAll', channel, payload });
}

// --- Client -> server --------------------------------------------------------

// Routed from the action queue to game scripts through the customAction
// hook. The payload is untrusted client input, for scripts to validate.
export function handleCustomAction(action: ClientCustomAction): void {
  const player = getPlayerByName(action.username);
  if (!player) return;
  emit('customAction', {
    player,
    channel: action.channel,
    payload: action.payload,
  });
}
