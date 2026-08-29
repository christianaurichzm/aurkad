import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  emitGameEvent: vi.fn(),
  publishToInstances: vi.fn(),
}));

vi.mock('../../engine/eventBus.js', () => ({
  emitGameEvent: mocks.emitGameEvent,
}));

vi.mock('../../persistence/instanceBus.js', () => ({
  publishToInstances: mocks.publishToInstances,
}));

const { getChatLog, handleChatAction, receiveGlobalLine } =
  await import('./chatService.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a global line and the rest of the fleet', () => {
  it('puts what was said here on the bus', () => {
    handleChatAction({ type: 'chat', scope: 'global', message: 'server up' });

    expect(mocks.publishToInstances).toHaveBeenCalledWith('chat', {
      type: 'chat',
      scope: 'global',
      message: 'server up',
    });
  });

  it('keeps map chat off it, since a map is on one instance already', () => {
    handleChatAction({
      type: 'chat',
      scope: 'map',
      mapId: '1',
      message: 'over here',
    });

    expect(mocks.publishToInstances).not.toHaveBeenCalled();
  });

  it('delivers a line from another instance to this one', () => {
    receiveGlobalLine({
      type: 'chat',
      scope: 'global',
      message: 'said on beta',
      username: 'Alice',
    });

    expect(mocks.emitGameEvent).toHaveBeenCalledWith({
      type: 'chatGlobal',
      payload: expect.objectContaining({ message: 'said on beta' }),
    });
    // The log is per instance, and `chat` in the console is how an operator
    // reads the room they are standing in.
    expect(getChatLog()).toContainEqual(
      expect.objectContaining({ username: 'Alice', message: 'said on beta' }),
    );
  });

  it('does not put an arriving line back on the bus', () => {
    receiveGlobalLine({
      type: 'chat',
      scope: 'global',
      message: 'said on beta',
    });

    // The one bug this whole mechanism can have: two instances handing the
    // same line back and forth until somebody restarts them.
    expect(mocks.publishToInstances).not.toHaveBeenCalled();
  });
});
