import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerCommand,
  handleChatCommand,
  handleReplCommand,
  listCommands,
  clearCommands,
} from './commands.js';
import { drainGameEvents } from './eventBus.js';
import { createFixture } from '../sim/simFixture.js';
import { Access } from '../../shared/types.js';

beforeEach(() => {
  clearCommands();
  drainGameEvents();
});

function lastReplyTo(): string | undefined {
  const ev = drainGameEvents().find((e) => e.type === 'chatPlayer');
  return ev && 'payload' in ev ? (ev.payload as { message: string }).message : undefined;
}

describe('registry', () => {
  it('registerCommand adds a command and unregister removes it', () => {
    const unreg = registerCommand('foo', {}, () => {});
    expect(listCommands().map((c) => c.name)).toContain('foo');
    unreg();
    expect(listCommands().map((c) => c.name)).not.toContain('foo');
  });

  it('names are case-insensitive', () => {
    registerCommand('Vip', {}, () => {});
    expect(listCommands().map((c) => c.name)).toEqual(['vip']);
  });
});

describe('chat dispatch', () => {
  it('runs the handler with parsed args for a permitted player', () => {
    const sim = createFixture(0);
    const admin = sim.addPlayer({ name: 'Admin', access: Access.ADMIN });
    const seen: { args: string[]; source: string; name?: string } = { args: [], source: '' };

    registerCommand('vip', { access: Access.ADMIN }, ({ args, source, player }) => {
      seen.args = args;
      seen.source = source;
      seen.name = player?.name;
    });

    const handled = handleChatCommand(admin, '/vip Bob extra');

    expect(handled).toBe(true);
    expect(seen).toEqual({ args: ['Bob', 'extra'], source: 'chat', name: 'Admin' });
  });

  it('denies a player below the required access and does not run the handler', () => {
    const sim = createFixture(0);
    const user = sim.addPlayer({ name: 'User', access: Access.USER });
    let ran = false;
    registerCommand('vip', { access: Access.ADMIN }, () => {
      ran = true;
    });

    const handled = handleChatCommand(user, '/vip Bob');

    expect(handled).toBe(true); // consumed (suppressed from chat)
    expect(ran).toBe(false);
    expect(lastReplyTo()).toMatch(/permission/i);
  });

  it('replies "unknown" for an unregistered command but still consumes it', () => {
    const sim = createFixture(0);
    const p = sim.addPlayer({ name: 'P' });
    const handled = handleChatCommand(p, '/nope');
    expect(handled).toBe(true);
    expect(lastReplyTo()).toMatch(/unknown/i);
  });

  it('returns false for ordinary chat (no leading slash)', () => {
    const sim = createFixture(0);
    const p = sim.addPlayer({ name: 'P' });
    expect(handleChatCommand(p, 'hello world')).toBe(false);
  });

  it('treats a lone slash as ordinary chat', () => {
    const sim = createFixture(0);
    const p = sim.addPlayer({ name: 'P' });
    expect(handleChatCommand(p, '/ ')).toBe(false);
  });
});

describe('repl dispatch', () => {
  it('runs the handler bypassing access, with no player', () => {
    const out: string[] = [];
    const seen: { args: string[]; source: string; hasPlayer: boolean } = {
      args: [],
      source: '',
      hasPlayer: true,
    };
    registerCommand('vip', { access: Access.ADMIN }, ({ args, source, player, reply }) => {
      seen.args = args;
      seen.source = source;
      seen.hasPlayer = !!player;
      reply('done');
    });

    const handled = handleReplCommand('vip', ['Bob'], (s) => out.push(s));

    expect(handled).toBe(true);
    expect(seen).toEqual({ args: ['Bob'], source: 'repl', hasPlayer: false });
    expect(out).toEqual(['done']);
  });

  it('returns false for an unknown command', () => {
    expect(handleReplCommand('nope', [], () => {})).toBe(false);
  });
});

describe('error isolation', () => {
  it('a throwing handler is caught and replies an error', () => {
    const out: string[] = [];
    registerCommand('boom', {}, () => {
      throw new Error('kaboom');
    });
    expect(() => handleReplCommand('boom', [], (s) => out.push(s))).not.toThrow();
    expect(out).toEqual(['Command error.']);
  });
});
