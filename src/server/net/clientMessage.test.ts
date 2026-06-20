import { describe, it, expect } from 'vitest';
import { ClientMessageSchema } from './clientMessage.js';
import { Key } from '../../shared/types.js';

describe('ClientMessageSchema', () => {
  describe('keyboard', () => {
    it('accepts a valid press', () => {
      const result = ClientMessageSchema.safeParse({
        type: 'keyboard',
        keyboardAction: { key: Key.ArrowRight, type: 'press' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts an optional seq', () => {
      const result = ClientMessageSchema.safeParse({
        type: 'keyboard',
        keyboardAction: { key: Key.ArrowUp, type: 'release' },
        seq: 42,
      });
      expect(result.success).toBe(true);
      if (result.success && result.data.type === 'keyboard') {
        expect(result.data.seq).toBe(42);
      }
    });

    it('rejects an unknown key', () => {
      const result = ClientMessageSchema.safeParse({
        type: 'keyboard',
        keyboardAction: { key: 'Space', type: 'press' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects a missing keyboardAction', () => {
      expect(ClientMessageSchema.safeParse({ type: 'keyboard' }).success).toBe(
        false,
      );
    });
  });

  describe('item', () => {
    it('accepts a use action', () => {
      const result = ClientMessageSchema.safeParse({
        type: 'item',
        item: 0,
        action: 'use',
      });
      expect(result.success).toBe(true);
    });

    it('accepts a drop action', () => {
      const result = ClientMessageSchema.safeParse({
        type: 'item',
        item: 3,
        action: 'drop',
      });
      expect(result.success).toBe(true);
    });

    it('rejects an unknown action', () => {
      const result = ClientMessageSchema.safeParse({
        type: 'item',
        item: 0,
        action: 'equip',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a negative item index', () => {
      const result = ClientMessageSchema.safeParse({
        type: 'item',
        item: -1,
        action: 'use',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('chat', () => {
    it('accepts a global message', () => {
      const result = ClientMessageSchema.safeParse({
        type: 'chat',
        message: 'hello',
        scope: 'global',
      });
      expect(result.success).toBe(true);
    });

    it('rejects an empty message', () => {
      const result = ClientMessageSchema.safeParse({
        type: 'chat',
        message: '',
        scope: 'map',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a message over 200 chars', () => {
      const result = ClientMessageSchema.safeParse({
        type: 'chat',
        message: 'a'.repeat(201),
        scope: 'player',
      });
      expect(result.success).toBe(false);
    });

    it('rejects an unknown scope', () => {
      const result = ClientMessageSchema.safeParse({
        type: 'chat',
        message: 'hi',
        scope: 'zone',
      });
      expect(result.success).toBe(false);
    });
  });

  it('rejects an unknown message type', () => {
    const result = ClientMessageSchema.safeParse({ type: 'unknown' });
    expect(result.success).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(ClientMessageSchema.safeParse(null).success).toBe(false);
    expect(ClientMessageSchema.safeParse('keyboard').success).toBe(false);
    expect(ClientMessageSchema.safeParse(42).success).toBe(false);
  });
});
