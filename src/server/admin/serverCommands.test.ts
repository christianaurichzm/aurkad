import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerCommand,
  handleWebCommand,
  clearCommands,
} from '../engine/commands.js';
import { registerServerCommands } from './serverCommands.js';
import { drainGameEvents } from '../engine/eventBus.js';
import { serverState } from '../services/world/serverState.js';
import { Access } from '../../shared/types.js';
import { createFixture } from '../sim/simFixture.js';

const run = (line: string, accessLevel = Access.ADMIN) => {
  const [name, ...args] = line.split(/\s+/);
  const out: string[] = [];
  const matched = handleWebCommand(name!, args, accessLevel, (m) =>
    out.push(m),
  );
  return { matched, out };
};

beforeEach(() => {
  clearCommands();
  drainGameEvents();
  serverState.mode = 'normal';
  serverState.motd = '';
  serverState.mutes.clear();
});

afterEach(() => clearCommands());

describe('handleWebCommand access', () => {
  it('runs a command the caller has access to', () => {
    registerCommand('ping', { access: Access.MOD }, ({ reply }) =>
      reply('pong'),
    );
    expect(run('ping', Access.ADMIN)).toEqual({ matched: true, out: ['pong'] });
  });

  it('refuses a command above the caller access level', () => {
    registerCommand('danger', { access: Access.ADMIN }, ({ reply }) =>
      reply('boom'),
    );
    const { matched, out } = run('danger', Access.MOD);
    expect(matched).toBe(true);
    expect(out[0]).toMatch(/permission/i);
  });

  it('reports no match for an unknown command', () => {
    expect(run('nope').matched).toBe(false);
  });
});

describe('server ops commands', () => {
  beforeEach(() => registerServerCommands());

  it('broadcast queues a global chat event', () => {
    const { out } = run('broadcast hello world');
    expect(out).toEqual(['Broadcast sent.']);
    const events = drainGameEvents();
    expect(events).toEqual([
      {
        type: 'chatGlobal',
        payload: { type: 'chat', scope: 'global', message: 'hello world' },
      },
    ]);
  });

  it('mode sets the server mode and rejects invalid values', () => {
    expect(run('mode maintenance').out[0]).toMatch(/maintenance/);
    expect(serverState.mode).toBe('maintenance');
    run('mode bogus');
    expect(serverState.mode).toBe('maintenance');
  });

  it('motd sets and clears the message of the day', () => {
    run('motd Event at 8pm');
    expect(serverState.motd).toBe('Event at 8pm');
  });

  it('players lists online players', () => {
    const sim = createFixture(0);
    sim.addPlayer({ name: 'Alice' });
    sim.addPlayer({ name: 'Bob' });
    const { out } = run('players');
    expect(out[0]).toBe('Online (2): Alice, Bob');
  });
});
