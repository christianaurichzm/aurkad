import { describe, it, expect, beforeEach } from 'vitest';
import type WebSocket from 'ws';
import type { ChatMessagePayload } from '../../shared/types.js';
import { emitGameEvent } from '../engine/eventBus.js';
import { createFixture } from '../sim/simFixture.js';
import { playersWsMap } from './connections.js';
import {
  broadcastChat,
  broadcastMapChat,
  broadcastToMap,
  flushGameEvents,
} from './fanout.js';

type FakeSocket = WebSocket & { sent: string[] };

function connect(name: string, readyState = 1): FakeSocket {
  const sent: string[] = [];
  const ws = {
    readyState,
    sent,
    send: (data: string) => sent.push(data),
  } as unknown as FakeSocket;
  playersWsMap.set(name, ws);
  return ws;
}

const parsed = (ws: FakeSocket) => ws.sent.map((s) => JSON.parse(s) as unknown);

const chat = (message: string): ChatMessagePayload => ({
  type: 'chat',
  scope: 'global',
  message,
});

let fx: ReturnType<typeof createFixture>;

beforeEach(() => {
  fx = createFixture();
  playersWsMap.clear();
  flushGameEvents(); // leave no event from a previous test in the queue
});

describe('broadcastChat', () => {
  it('reaches every open socket and skips the ones already closing', () => {
    const open = connect('a');
    const closing = connect('b', 2);

    broadcastChat(chat('hello'));

    expect(parsed(open)).toEqual([chat('hello')]);
    expect(closing.sent).toEqual([]);
  });
});

describe('broadcastMapChat', () => {
  it('reaches only the players standing on the sender map', () => {
    fx.addMap({ id: 'map2', tiles: fx.map.tiles });
    fx.addPlayer({ name: 'here' });
    fx.addPlayer({ name: 'elsewhere', mapId: 'map2' });
    const here = connect('here');
    const elsewhere = connect('elsewhere');

    broadcastMapChat('here', chat('local'));

    expect(parsed(here)).toEqual([chat('local')]);
    expect(elsewhere.sent).toEqual([]);
  });

  it('sends nothing when the sender is not online', () => {
    const other = connect('other');

    broadcastMapChat('ghost', chat('local'));

    expect(other.sent).toEqual([]);
  });
});

describe('broadcastToMap', () => {
  it('sends nothing for a map that does not exist', () => {
    fx.addPlayer({ name: 'here' });
    const here = connect('here');

    broadcastToMap('nowhere', chat('local'));

    expect(here.sent).toEqual([]);
  });

  it('tolerates a player on the map with no socket', () => {
    fx.addPlayer({ name: 'online' });
    fx.addPlayer({ name: 'offline' });
    const online = connect('online');

    expect(() => broadcastToMap(fx.map.id, chat('local'))).not.toThrow();
    expect(parsed(online)).toEqual([chat('local')]);
  });
});

describe('flushGameEvents', () => {
  it('routes each event type to its recipients', () => {
    fx.addMap({ id: 'map2', tiles: fx.map.tiles });
    fx.addPlayer({ name: 'here' });
    fx.addPlayer({ name: 'elsewhere', mapId: 'map2' });
    const here = connect('here');
    const elsewhere = connect('elsewhere');

    emitGameEvent({ type: 'openShop', username: 'here', shopId: 's1' });
    emitGameEvent({ type: 'chatGlobal', payload: chat('all') });
    emitGameEvent({
      type: 'chatMap',
      senderUsername: 'here',
      payload: chat('map'),
    });
    emitGameEvent({ type: 'chatMapId', mapId: 'map2', payload: chat('map2') });
    emitGameEvent({
      type: 'chatPlayer',
      username: 'here',
      payload: chat('dm'),
    });
    emitGameEvent({
      type: 'customPlayer',
      username: 'here',
      channel: 'ch',
      payload: { n: 1 },
    });
    emitGameEvent({
      type: 'customMap',
      mapId: 'map2',
      channel: 'ch',
      payload: { n: 2 },
    });
    emitGameEvent({ type: 'customAll', channel: 'ch', payload: { n: 3 } });

    flushGameEvents();

    expect(parsed(here)).toEqual([
      { type: 'openShop', shopId: 's1' },
      chat('all'),
      chat('map'),
      chat('dm'),
      { type: 'custom', channel: 'ch', payload: { n: 1 } },
      { type: 'custom', channel: 'ch', payload: { n: 3 } },
    ]);
    expect(parsed(elsewhere)).toEqual([
      chat('all'),
      chat('map2'),
      { type: 'custom', channel: 'ch', payload: { n: 2 } },
      { type: 'custom', channel: 'ch', payload: { n: 3 } },
    ]);
  });

  it('drains the queue, so a second flush repeats nothing', () => {
    fx.addPlayer({ name: 'here' });
    const here = connect('here');

    emitGameEvent({ type: 'chatGlobal', payload: chat('once') });
    flushGameEvents();
    flushGameEvents();

    expect(here.sent).toHaveLength(1);
  });
});
