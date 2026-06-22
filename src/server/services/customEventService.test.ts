import { describe, it, expect, beforeEach } from 'vitest';
import {
  sendCustomEvent,
  sendMapCustomEvent,
  broadcastCustomEvent,
  handleCustomAction,
} from './customEventService.js';
import { drainGameEvents } from '../engine/eventBus.js';
import { on, clearAll } from '../engine/hooks.js';
import { createFixture } from '../sim/simFixture.js';

beforeEach(() => {
  clearAll();
  drainGameEvents(); // clear any queued events from prior tests
});

// --- Server -> client: queued GameEvents -------------------------------------

describe('server -> client custom events', () => {
  it('sendCustomEvent queues a customPlayer event', () => {
    const sim = createFixture(0);
    const player = sim.addPlayer({ name: 'Alice' });

    sendCustomEvent(player, 'questUpdate', { id: 1, step: 2 });

    const events = drainGameEvents();
    expect(events).toEqual([
      {
        type: 'customPlayer',
        username: 'Alice',
        channel: 'questUpdate',
        payload: { id: 1, step: 2 },
      },
    ]);
  });

  it('sendMapCustomEvent queues a customMap event', () => {
    sendMapCustomEvent('map1', 'bossSpawn', { name: 'Dragon' });
    expect(drainGameEvents()).toEqual([
      {
        type: 'customMap',
        mapId: 'map1',
        channel: 'bossSpawn',
        payload: { name: 'Dragon' },
      },
    ]);
  });

  it('broadcastCustomEvent queues a customAll event', () => {
    broadcastCustomEvent('serverAnnounce', 'Event starting!');
    expect(drainGameEvents()).toEqual([
      {
        type: 'customAll',
        channel: 'serverAnnounce',
        payload: 'Event starting!',
      },
    ]);
  });
});

// --- Client -> server: customAction hook -------------------------------------

describe('client -> server custom actions', () => {
  it('handleCustomAction emits the customAction hook with the player', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice' });

    const received: Array<{ name: string; channel: string; payload: unknown }> =
      [];
    on('customAction', ({ player, channel, payload }) =>
      received.push({ name: player.name, channel, payload }),
    );

    handleCustomAction({
      type: 'custom',
      username: 'Alice',
      channel: 'acceptInvite',
      payload: { guild: 'dragons' },
    });

    expect(received).toEqual([
      { name: 'Alice', channel: 'acceptInvite', payload: { guild: 'dragons' } },
    ]);
  });

  it('ignores actions from an unknown player', () => {
    let fired = false;
    on('customAction', () => {
      fired = true;
    });

    handleCustomAction({
      type: 'custom',
      username: 'Ghost',
      channel: 'x',
      payload: null,
    });

    expect(fired).toBe(false);
  });
});
