import { describe, it, expect, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import { broadcastGameState, resetPlayerNetState } from './snapshot.js';
import { playersWsMap } from './connections.js';
import { config } from '../config.js';
import { createFixture } from '../sim/simFixture.js';
import { rebuildQuadtree } from '../spatial/spatialManager.js';

function fakeWs(bufferedAmount: number) {
  return {
    readyState: WebSocket.OPEN,
    bufferedAmount,
    send: vi.fn(),
  };
}

afterEach(() => {
  playersWsMap.clear();
  resetPlayerNetState('Alice');
});

describe('broadcast backpressure', () => {
  it('skips a congested client and sends to a healthy one', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice' });
    rebuildQuadtree(sim.mapId, sim.map);

    const congested = fakeWs(config.ws.maxBufferedBytes + 1);
    playersWsMap.set('Alice', congested as unknown as WebSocket);
    broadcastGameState();
    expect(congested.send).not.toHaveBeenCalled();

    resetPlayerNetState('Alice');
    const healthy = fakeWs(0);
    playersWsMap.set('Alice', healthy as unknown as WebSocket);
    broadcastGameState();
    expect(healthy.send).toHaveBeenCalled();
  });
});
