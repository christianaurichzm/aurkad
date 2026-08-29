import { describe, it, expect, vi, afterEach } from 'vitest';
import { friendlyHttpError, httpClient } from './httpClient';

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

describe('the trace on every call', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** One fetch, answering with whatever the case needs. */
  const stubFetch = (answer: Partial<Response> = {}) => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
      ...answer,
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  const headerOf = (fetch: ReturnType<typeof vi.fn>): string => {
    const init = fetch.mock.calls[0]?.[1] as {
      headers: Record<string, string>;
    };
    return init.headers.traceparent;
  };

  // The trace starts in the browser, or it could never tell a slow network
  // from a slow player machine.
  it('starts a trace the server can continue', async () => {
    const fetch = stubFetch();

    await httpClient('/thing', { method: 'GET' });

    expect(headerOf(fetch)).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-01$/);
  });

  it('gives each request its own trace, not one per session', async () => {
    const fetch = stubFetch();

    await httpClient('/thing', { method: 'GET' });
    const first = headerOf(fetch);
    vi.unstubAllGlobals();
    const second = stubFetch();
    await httpClient('/thing', { method: 'GET' });

    expect(headerOf(second)).not.toBe(first);
  });

  it('lets a caller override it, and keeps reading the id off a failure', async () => {
    const fetch = stubFetch({
      ok: false,
      status: 500,
      headers: new Headers({
        'Content-Type': 'application/json',
        'X-Request-Id': '94dfd758',
      }),
      json: () => Promise.resolve({ message: 'boom' }),
    });

    await expect(
      httpClient('/thing', {
        method: 'GET',
        headers: { traceparent: 'given-by-the-caller' },
      }),
    ).rejects.toMatchObject({ status: 500, requestId: '94dfd758' });
    expect(headerOf(fetch)).toBe('given-by-the-caller');
  });
});
