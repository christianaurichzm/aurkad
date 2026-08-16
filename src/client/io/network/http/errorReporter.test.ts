import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const post = vi.fn().mockResolvedValue(undefined);
vi.mock('./httpClient', () => ({ httpClient: post }));

// The reporter tracks what it sent in module state, so each case gets a
// fresh module and unhooks at the end, or every past case's listeners
// still answer the shared window.
let uninstall: (() => void) | undefined;

async function freshReporter() {
  vi.resetModules();
  const { installErrorReporter } = await import('./errorReporter');
  uninstall = installErrorReporter();
}

const throwError = (message: string, error?: Error) =>
  window.dispatchEvent(
    new ErrorEvent('error', {
      message,
      error,
      filename: 'game.ts',
      lineno: 12,
      colno: 3,
    }),
  );

beforeEach(() => {
  post.mockClear();
});

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
});

describe('installErrorReporter', () => {
  it('reports an uncaught error with where it happened', async () => {
    await freshReporter();

    throwError('boom', new Error('boom'));

    expect(post).toHaveBeenCalledOnce();
    const [endpoint, options] = post.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(endpoint).toBe('/client-error');
    expect(options.body).toMatchObject({
      kind: 'error',
      message: 'boom',
      source: 'game.ts:12:3',
    });
    expect(options.body['stack']).toContain('Error: boom');
  });

  // A throwing render loop throws every frame; without this one broken
  // deploy floods the operator's log.
  it('reports one message once, however often it repeats', async () => {
    await freshReporter();

    for (let i = 0; i < 50; i++) throwError('same failure');

    expect(post).toHaveBeenCalledOnce();
  });

  it('stops after ten distinct failures, since the first few name the cause', async () => {
    await freshReporter();

    for (let i = 0; i < 25; i++) throwError(`failure ${i}`);

    expect(post).toHaveBeenCalledTimes(10);
  });

  it('reports a rejected promise nobody caught', async () => {
    await freshReporter();

    const event = new Event('unhandledrejection') as Event & {
      reason: unknown;
    };
    event.reason = new Error('offline');
    window.dispatchEvent(event);

    const [, options] = post.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(options.body).toMatchObject({
      kind: 'unhandledrejection',
      message: 'offline',
    });
  });

  // It reports crashes; it must not be the cause of one.
  it('swallows its own failure to report', async () => {
    post.mockRejectedValueOnce(new Error('network down'));
    await freshReporter();

    expect(() => throwError('boom')).not.toThrow();
  });
});
