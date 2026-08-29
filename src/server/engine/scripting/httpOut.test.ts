import {
  describe,
  it,
  expect,
  afterEach,
  beforeAll,
  afterAll,
  vi,
} from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { httpRequest, send } from './httpOut.js';

/**
 * `rebind.test` must not resolve, and the real resolver may take a DNS
 * timeout to say so, failing the test for the network's reasons. Every other
 * name here is an address literal or `localhost` from the hosts file, so the
 * real lookup still answers those.
 */
vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  return {
    ...actual,
    lookup: (host: string, ...rest: unknown[]) =>
      host === 'rebind.test'
        ? Promise.reject(new Error('getaddrinfo ENOTFOUND rebind.test'))
        : (actual.lookup as (...args: unknown[]) => Promise<unknown>)(
            host,
            ...rest,
          ),
  };
});

/**
 * A real server on the loopback. The address check refuses this machine, so
 * `send`, the half that opens the socket, is pointed at it with the address
 * already approved. It also proves the pin: a request for a name that
 * resolves nowhere still arrives, because nothing asks the resolver.
 */
let server: Server;
let port = 0;
let seen: IncomingMessage[] = [];
let answer: (req: IncomingMessage, respond: Respond) => void;

interface Respond {
  writeHead: (status: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(req);
    req.resume();
    answer(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

afterEach(() => {
  seen = [];
});

const pong = () => {
  answer = (_req, res) => res.end('pong');
};

const local = (host = '127.0.0.1', path = '/hook') =>
  new URL(`http://${host}:${port}${path}`);

describe('send', () => {
  it('posts a json body with the content type and length set', async () => {
    let received = '';
    answer = (req, res) => {
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => (received += chunk));
      req.on('end', () => res.end('pong'));
    };

    const res = await send(local(), '127.0.0.1', {
      headers: { 'content-type': 'application/json' },
      body: '{"content":"hi"}',
    });

    expect(res).toMatchObject({ ok: true, status: 200, body: 'pong' });
    expect(received).toBe('{"content":"hi"}');
    expect(seen[0]!.method).toBe('POST');
    expect(seen[0]!.headers['content-length']).toBe('16');
  });

  it('defaults to GET when there is no body', async () => {
    pong();

    await send(local(), '127.0.0.1', {});

    expect(seen[0]!.method).toBe('GET');
  });

  // The byte cap can only mean anything if the bytes are the ones the caller
  // reads: a compressed body would be unreadable as a string and larger in
  // memory than the cap allows.
  it('asks for no compression, whatever the caller asked for', async () => {
    pong();

    await send(local(), '127.0.0.1', {
      headers: { 'accept-encoding': 'gzip' },
    });

    expect(seen[0]!.headers['accept-encoding']).toBe('identity');
  });

  it('reports a non-2xx as a result, not a failure', async () => {
    answer = (_req, res) => {
      res.writeHead(404);
      res.end('no');
    };

    const res = await send(local(), '127.0.0.1', {});

    expect(res).toMatchObject({ ok: false, status: 404, body: 'no' });
    expect(res.error).toBeUndefined();
  });

  it('does not follow a redirect', async () => {
    answer = (_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${port}/elsewhere` });
      res.end();
    };

    const res = await send(local(), '127.0.0.1', {});

    expect(res).toMatchObject({ ok: false, status: 302 });
    expect(seen).toHaveLength(1);
  });

  it('truncates a response bigger than the cap', async () => {
    answer = (_req, res) => res.end('x'.repeat(300 * 1024));

    const res = await send(local(), '127.0.0.1', {});

    expect(res.ok).toBe(true);
    expect(res.body.length).toBe(256 * 1024);
  });

  it('gives up on a server that never answers', async () => {
    answer = () => {
      // Holds the request open, which is what the timeout is for.
    };

    await expect(send(local(), '127.0.0.1', { timeoutMs: 50 })).rejects.toThrow(
      /abort/i,
    );
  });

  // The clamp's real failure mode is not a wrong number, it is NaN: a signal
  // that never fires, or one that fires immediately.
  it('survives a timeout that is not a number', async () => {
    pong();

    await expect(
      send(local(), '127.0.0.1', { timeoutMs: Number('nonsense') }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('rejects when nothing is listening', async () => {
    const closed = new URL(`http://127.0.0.1:${port}/x`);
    closed.port = String(port === 1 ? 2 : 1);

    await expect(send(closed, '127.0.0.1', {})).rejects.toThrow();
  });

  // DNS rebinding: a name checked once and resolved again by the request
  // could reach an address the check refused. `rebind.test` resolves nowhere,
  // so the request arrives because the socket was handed the address, and
  // the Host header shows it is still a request for that name.
  describe('the pinned address', () => {
    it('is where the socket goes, whatever the name resolves to', async () => {
      pong();

      const res = await send(local('rebind.test'), '127.0.0.1', {});

      expect(res).toMatchObject({ ok: true, body: 'pong' });
      expect(seen[0]!.headers.host).toBe(`rebind.test:${port}`);
    });
  });
});

describe('httpRequest', () => {
  it.each([
    ['loopback', (p: number) => `http://127.0.0.1:${p}/admin`],
    ['ipv6 loopback', (p: number) => `http://[::1]:${p}/`],
    // Same address, two spellings: `new URL` normalizes the first into the
    // second, which a dotted-only check would let through.
    ['ipv4-mapped loopback', (p: number) => `http://[::ffff:127.0.0.1]:${p}/`],
    ['ipv4-mapped in hex', (p: number) => `http://[::ffff:7f00:1]:${p}/`],
    // Answered from /etc/hosts, so this one goes through the real resolver.
    ['this machine by name', (p: number) => `http://localhost:${p}/admin`],
  ])('refuses %s even with a server answering on it', async (_name, url) => {
    pong();

    const res = await httpRequest('s.js', url(port));

    expect(res).toMatchObject({ ok: false, status: 0 });
    expect(res.error).toMatch(/blocked address/);
    expect(seen).toHaveLength(0);
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.20.0.3:27017/',
  ])('refuses %s', async (url) => {
    const res = await httpRequest('s.js', url);

    expect(res.error).toMatch(/blocked address/);
  });

  it.each(['file:///etc/passwd', 'ftp://example.com/x', 'not a url'])(
    'refuses %s',
    async (url) => {
      const res = await httpRequest('s.js', url);

      expect(res.ok).toBe(false);
      expect(res.status).toBe(0);
    },
  );

  it('refuses a name that resolves nowhere', async () => {
    const res = await httpRequest('s.js', 'http://rebind.test/hook');

    expect(res.error).toMatch(/cannot resolve/);
  });

  // A script fires these without awaiting, and an uncaught rejection ends the
  // process. 192.0.2.1 is the documentation range, answered by nobody, and
  // the 1ms timeout ends the attempt before it leaves.
  it('reports a transport failure instead of rejecting', async () => {
    const res = await httpRequest('s.js', 'http://192.0.2.1/hook', {
      timeoutMs: 1,
    });

    expect(res).toMatchObject({ ok: false, status: 0 });
    expect(res.error).toBeTruthy();
  });

  it('reports an unserializable json body instead of throwing', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const res = await httpRequest('s.js', 'http://93.184.216.34/hook', {
      json: circular,
    });

    expect(res.error).toBe('json body is not serializable');
  });
});
