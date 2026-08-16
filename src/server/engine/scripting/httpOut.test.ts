import { describe, it, expect, vi, afterEach } from 'vitest';
import { httpRequest } from './httpOut.js';

const okResponse = (body = 'pong', status = 200) =>
  new Response(body, { status });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('httpRequest', () => {
  it('sends a json body with the content type set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const res = await httpRequest('s.js', 'https://93.184.216.34/hook', {
      json: { content: 'hi' },
    });

    expect(res).toMatchObject({ ok: true, status: 200, body: 'pong' });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"content":"hi"}');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('defaults to GET when there is no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await httpRequest('s.js', 'https://93.184.216.34/status');

    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('GET');
  });

  // The whole point of the return shape: a script fires one of these without
  // awaiting, and a rejection nobody catches ends the process.
  it('reports a transport failure instead of rejecting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));

    const res = await httpRequest('s.js', 'https://93.184.216.34/hook');

    expect(res).toMatchObject({ ok: false, status: 0, error: 'ECONNRESET' });
  });

  it('reports a non-2xx as a result, not a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('no', 404)));

    const res = await httpRequest('s.js', 'https://93.184.216.34/hook');

    expect(res).toMatchObject({ ok: false, status: 404, body: 'no' });
    expect(res.error).toBeUndefined();
  });

  it.each([
    ['http://127.0.0.1:8080/admin', 'loopback'],
    ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
    ['http://10.0.0.5/', 'private class A'],
    ['http://192.168.1.1/', 'home router'],
    ['http://172.20.0.3:27017/', 'docker network'],
    ['http://[::1]:3000/', 'ipv6 loopback'],
    // Same address, two spellings. `new URL` normalizes the first into the
    // second, which is how the dotted-only check let it through.
    ['http://[::ffff:127.0.0.1]/', 'ipv4-mapped loopback'],
    ['http://[::ffff:7f00:1]/', 'ipv4-mapped loopback in hex'],
  ])('refuses %s (%s)', async (url) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await httpRequest('s.js', url);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/blocked address/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['file:///etc/passwd', 'ftp://example.com/x', 'not a url'])(
    'refuses %s',
    async (url) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const res = await httpRequest('s.js', url);

      expect(res.ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  // The literal cases above never reach the resolver. This one goes through
  // the real one: `localhost` is answered from /etc/hosts, not the network.
  it('refuses a name that resolves to this machine', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await httpRequest('s.js', 'http://localhost:8080/admin');

    expect(res.error).toMatch(/blocked address/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not follow redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('', 302));
    vi.stubGlobal('fetch', fetchMock);

    await httpRequest('s.js', 'https://93.184.216.34/r');

    expect((fetchMock.mock.calls[0]![1] as RequestInit).redirect).toBe(
      'manual',
    );
  });

  it('truncates a response bigger than the cap', async () => {
    const huge = 'x'.repeat(300 * 1024);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(huge)));

    const res = await httpRequest('s.js', 'https://93.184.216.34/big');

    expect(res.ok).toBe(true);
    expect(res.body.length).toBe(256 * 1024);
  });

  it('caps the timeout a script can ask for', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await httpRequest('s.js', 'https://93.184.216.34/slow', {
      timeoutMs: 10 * 60 * 1000,
    });

    // AbortSignal.timeout does not expose its delay, so this proves only that
    // an absurd number still produces a live signal rather than a NaN one -
    // which is the way the clamp would actually break.
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal!.aborted).toBe(false);
  });
});
