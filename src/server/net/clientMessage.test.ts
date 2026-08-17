import { describe, it, expect } from 'vitest';
import { ClientMessageSchema } from './clientMessage.js';
import { Key } from '../../shared/types.js';
import fc from 'fast-check';

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

    it('accepts a drop quantity', () => {
      const result = ClientMessageSchema.safeParse({
        type: 'item',
        item: 3,
        action: 'drop',
        quantity: 4,
      });
      expect(result.success).toBe(true);
    });

    it('rejects an invalid drop quantity', () => {
      const result = ClientMessageSchema.safeParse({
        type: 'item',
        item: 3,
        action: 'drop',
        quantity: 0,
      });
      expect(result.success).toBe(false);
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

  describe('custom messages', () => {
    it('accepts a custom message with channel and payload', () => {
      const result = ClientMessageSchema.safeParse({
        type: 'custom',
        channel: 'guild:invite',
        payload: { target: 'Bob' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts a custom message without payload', () => {
      const result = ClientMessageSchema.safeParse({
        type: 'custom',
        channel: 'ping',
      });
      expect(result.success).toBe(true);
    });

    it('rejects an empty channel', () => {
      const result = ClientMessageSchema.safeParse({
        type: 'custom',
        channel: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects an over-long channel', () => {
      const result = ClientMessageSchema.safeParse({
        type: 'custom',
        channel: 'c'.repeat(65),
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

// Fuzzing the trust boundary: arbitrary JSON at the schema, since a
// modified client sends whatever it likes, and the server relies on nothing
// getting past except the shapes it declares.
describe('ClientMessageSchema under arbitrary input', () => {
  // Valid messages, mutated: arbitrary junk is never valid, so a property
  // filtered on validity would run zero times.
  const validMessage = fc.oneof(
    fc.record({
      type: fc.constant('keyboard'),
      keyboardAction: fc.record({
        key: fc.constantFrom(...Object.values(Key)),
        type: fc.constantFrom('press', 'release'),
      }),
    }),
    fc.record({
      type: fc.constant('item'),
      item: fc.nat(),
      action: fc.constantFrom('use', 'drop'),
    }),
    fc.record({
      type: fc.constant('chat'),
      message: fc.string({ minLength: 1, maxLength: 200 }),
      scope: fc.constantFrom('player', 'map', 'global'),
    }),
    fc.record({ type: fc.constant('custom'), channel: fc.constant('c') }),
  );

  it('accepts the four shapes it declares', () => {
    fc.assert(
      fc.property(validMessage, (message) => {
        expect(ClientMessageSchema.safeParse(message).success).toBe(true);
      }),
    );
  });

  // Swapping a valid string for another valid string leaves a message valid,
  // so the property is that a required field cannot go missing.
  it('refuses a message with any required field removed', () => {
    fc.assert(
      fc.property(
        validMessage.chain((message) =>
          fc.tuple(
            fc.constant(message),
            fc.constantFrom(...Object.keys(message)),
          ),
        ),
        ([message, field]) => {
          const without: Record<string, unknown> = { ...message };
          delete without[field];

          expect(ClientMessageSchema.safeParse(without).success).toBe(false);
        },
      ),
    );
  });

  it('refuses any type outside the four, however well formed the rest is', () => {
    fc.assert(
      fc.property(
        validMessage,
        fc
          .anything()
          .filter(
            (t) =>
              !['keyboard', 'item', 'chat', 'custom'].includes(t as string),
          ),
        (message, type) => {
          expect(
            ClientMessageSchema.safeParse({ ...message, type }).success,
          ).toBe(false);
        },
      ),
    );
  });

  it('refuses arbitrary values outright', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const result = ClientMessageSchema.safeParse(value);

        // Not `toBe(false)`: fc.anything() could in principle produce a real
        // message, and the property is that nothing ELSE gets through.
        if (result.success) {
          expect(['keyboard', 'item', 'chat', 'custom']).toContain(
            result.data.type,
          );
        }
      }),
    );
  });

  it('never throws, whatever it is handed', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => ClientMessageSchema.safeParse(value)).not.toThrow();
      }),
    );
  });

  // Every field the engine reads afterwards has to be the type it expects; a
  // parse that says yes and hands back a string where a number goes is worse
  // than one that says no.
  it('accepts a chat message only within the declared bounds', () => {
    fc.assert(
      fc.property(
        fc.record({
          type: fc.constant('chat'),
          message: fc.string(),
          scope: fc.oneof(
            fc.constantFrom('player', 'map', 'global'),
            fc.string(),
          ),
        }),
        (candidate) => {
          const result = ClientMessageSchema.safeParse(candidate);

          const valid =
            candidate.message.length >= 1 &&
            candidate.message.length <= 200 &&
            ['player', 'map', 'global'].includes(candidate.scope);
          expect(result.success).toBe(valid);
        },
      ),
    );
  });

  it('accepts an item quantity only when it is a positive integer', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.double(), fc.constant(undefined)),
        (quantity) => {
          const result = ClientMessageSchema.safeParse({
            type: 'item',
            item: 1,
            action: 'drop',
            quantity,
          });

          // isSafeInteger, not isInteger: zod's .int() refuses 2^53, rightly,
          // as a quantity past the safe range is not the number it prints.
          const valid =
            quantity === undefined ||
            (Number.isSafeInteger(quantity) && quantity > 0);
          expect(result.success).toBe(valid);
        },
      ),
    );
  });

  // The one field the schema does not constrain, so the test
  // states it: a script receiving this is receiving untrusted input.
  it('lets any payload through on a custom message, by design', () => {
    fc.assert(
      fc.property(fc.anything(), (payload) => {
        const result = ClientMessageSchema.safeParse({
          type: 'custom',
          channel: 'anything',
          payload,
        });

        expect(result.success).toBe(true);
      }),
    );
  });
});
