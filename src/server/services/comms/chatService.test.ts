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

const {
  chatAllowanceCount,
  forgetChatAllowance,
  getChatLog,
  handleChatAction,
  receiveGlobalLine,
} = await import('./chatService.js');
const { advanceTick, resetClock } = await import('../../sim/clock.js');
const { resetScheduler, runScheduledTasks } =
  await import('../../sim/scheduler.js');
const { playersWsMap } = await import('../../net/connections.js');

beforeEach(() => {
  vi.clearAllMocks();
  resetClock();
  resetScheduler();
});

const say = (username: string, message = 'hello') =>
  handleChatAction({ type: 'chat', scope: 'global', message, username });

const linesSent = () =>
  mocks.emitGameEvent.mock.calls.filter(
    ([event]) => (event as { type: string }).type === 'chatGlobal',
  ).length;

// One second at the 20 Hz the suite runs at.
const waitASecond = () => {
  for (let i = 0; i < 20; i++) advanceTick();
};

describe('how fast one player may talk', () => {
  it('lets a burst through, then one line a second', () => {
    for (let i = 0; i < 6; i++) say('Flooder');
    expect(linesSent()).toBe(5);

    waitASecond();
    say('Flooder');
    say('Flooder');
    expect(linesSent()).toBe(6);
  });

  it('counts each player on their own', () => {
    for (let i = 0; i < 5; i++) say('Talker');
    say('Bystander');

    expect(linesSent()).toBe(6);
  });

  it('tells the sender why the line went nowhere', () => {
    const send = vi.fn();
    playersWsMap.set('Hasty', { readyState: 1, send } as never);
    try {
      for (let i = 0; i < 6; i++) say('Hasty');
    } finally {
      playersWsMap.delete('Hasty');
    }

    expect(send).toHaveBeenCalledOnce();
    expect(JSON.parse(send.mock.calls[0]![0] as string)).toMatchObject({
      scope: 'player',
      message: 'You are sending messages too fast.',
    });
  });

  it('keeps a spent burst spent across a reconnect, then lets it go', () => {
    for (let i = 0; i < 5; i++) say('Rejoiner');
    forgetChatAllowance('Rejoiner');
    say('Rejoiner');
    expect(linesSent()).toBe(5);

    const before = chatAllowanceCount();
    for (let s = 0; s < 6; s++) {
      waitASecond();
      runScheduledTasks();
    }
    expect(chatAllowanceCount()).toBe(before - 1);
  });
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
