import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { clearStrings, registerStrings, translate } from './i18n.js';
import {
  clearCommands,
  handleChatCommand,
  registerCommand,
} from './commands.js';
import { drainGameEvents } from './eventBus.js';
import { createFixture, tile } from '../sim/simFixture.js';
import type { PlayerServer } from '../../shared/types.js';

beforeEach(() => {
  clearStrings();
  clearCommands();
  drainGameEvents();
  registerStrings({
    pt: {
      'Pet dismissed.': 'Bicho dispensado.',
      'Trades: {count}': 'Trocas: {count}',
    },
  });
});

afterEach(() => {
  clearStrings();
  clearCommands();
});

const speaking = (language?: string): PlayerServer => {
  const sim = createFixture(0);
  const player = sim.addPlayer({ name: 'Alice', position: tile(1, 1) });
  player.language = language;
  return player;
};

describe('translate', () => {
  it('answers in the language the session asked for', () => {
    expect(translate(speaking('pt'), 'Pet dismissed.')).toBe(
      'Bicho dispensado.',
    );
  });

  // The key is the fallback: a module ships its English whatever happens, so
  // the worst case of a table nobody wrote is the sentence the module meant.
  it('falls back to the English for a language or a sentence with no entry', () => {
    expect(translate(speaking('pt'), 'Pet summoned.')).toBe('Pet summoned.');
    expect(translate(speaking('de'), 'Pet dismissed.')).toBe('Pet dismissed.');
    expect(translate(speaking(), 'Pet dismissed.')).toBe('Pet dismissed.');
  });

  // A REPL command has no player, and neither does a broadcast.
  it('reads English with no player to ask', () => {
    expect(translate(undefined, 'Pet dismissed.')).toBe('Pet dismissed.');
  });

  it('fills placeholders', () => {
    expect(translate(speaking('pt'), 'Trades: {count}', { count: 3 })).toBe(
      'Trocas: 3',
    );
  });
});

describe('the chat command funnel', () => {
  // The point of translating there rather than in each command: a handler
  // written with plain English answers in the player's language for free.
  it('translates what a command replied', () => {
    const player = speaking('pt');
    registerCommand('pet', {}, ({ reply }) => reply('Pet dismissed.'));

    handleChatCommand(player, '/pet');

    expect(drainGameEvents()).toEqual([
      expect.objectContaining({
        type: 'chatPlayer',
        username: 'Alice',
        payload: expect.objectContaining({ message: 'Bicho dispensado.' }),
      }),
    ]);
  });

  it('answers an unknown command in the same language', () => {
    registerStrings({
      pt: { 'Unknown command: /{name}': 'Comando desconhecido: /{name}' },
    });

    handleChatCommand(speaking('pt'), '/nope');

    expect(drainGameEvents()[0]).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          message: 'Comando desconhecido: /nope',
        }),
      }),
    );
  });
});
