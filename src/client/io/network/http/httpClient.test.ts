import { describe, it, expect } from 'vitest';
import { friendlyHttpError } from './httpClient';

// What a player may read when a call fails. A 4xx explains what the caller
// did; a 5xx is the server saying it broke, in words meant for its operator.
describe('friendlyHttpError', () => {
  it('passes a 4xx through, because that sentence was written to be read', () => {
    expect(
      friendlyHttpError({
        status: 401,
        message: 'Invalid username or password',
      }),
    ).toBe('Invalid username or password');
    expect(
      friendlyHttpError({ status: 409, message: 'Username already taken' }),
    ).toBe('Username already taken');
  });

  it('replaces a server internal with something a player can act on', () => {
    const shown = friendlyHttpError({
      status: 500,
      message: 'Internal server error',
    });

    expect(shown).not.toMatch(/internal server error/i);
    expect(shown).toMatch(/went wrong on our side/i);
  });

  // The id is on every response and on every log line for that request, so
  // eight characters take an operator to the stack.
  it('carries the request id when the server gave one', () => {
    expect(
      friendlyHttpError({
        status: 500,
        message: 'Internal server error',
        requestId: '94dfd758',
      }),
    ).toContain('94dfd758');
  });

  // A fetch that never reached the server rejects with a TypeError: no status,
  // no message worth showing.
  it('treats a failed fetch as our side too', () => {
    expect(friendlyHttpError(new TypeError('Failed to fetch'))).toMatch(
      /went wrong on our side/i,
    );
  });
});
