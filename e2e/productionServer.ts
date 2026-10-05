import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

// A built app behind TLS termination, using its own disposable game and DB.
// Ports differ from development so the smoke run never replaces a dev server.
const directory = await mkdtemp(path.join(tmpdir(), 'aurkad-production-'));
const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
await mkdir(path.join(directory, 'content'));
await mkdir(path.join(directory, 'scripts'));
await mkdir(path.join(directory, 'assets'));
// Four 64px frames in each direction, enough for the default character layout.
const sheet = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAABlBMVEX///8ollrPOVFQAAACCUlEQVR4nO3QQQEAMBDCsJt/05ORB60CyN3bbv1/AAHoAboA9ABdAHqALgA9QBeAHqALQA/QBaAH6ALQA3QB6AG6APQAXQB6gC4APUAXgB6gC0AP0AWgB+gC0AN0AegBugD0AF0AeoAuAD1AF4AeoAtAD9AFoAfoAtADdAHoAboA9ABdAHqALgA9QBeAHqALQA/QBaAH6ALQA3QB6AG6APQAXQB6gC4APUAXgB6gC0AP0AWgB+gC0AN0AegBugD0AF0AeoAuAD1AF4AeoAtAD9AFoAfoAtADdAHoAboA9ABdAHqALgA9QBeAHqALQA/QBaAH6ALQA3QB6AG6APQAXQB6gC4APUAXgB6gC0AP0AWgB+gC0AN0AegBugD0AF0AeoAuAD1AF4AeoAtAD9AFoAfoAtADdAHoAboA9ABdAHqALgA9QBeAHqALQA/QBaAH6ALQA3QB6AG6APQAXQB6gC4APUAXgB6gC0AP0AWgB+gC0AN0AegBugD0AF0AeoAuAD1AF4AeoAtAD9AFoAfoAtADdAHoAboA9ABdAHqALgA9QBeAHqALQA/QBaAH6ALQA3QB6AG6APQAXQB6gC4APUAXgB6gC0AP0AWgB+gC0AN0AegBugD0AF0AeoAuAD1AF4AeoAtAD9AFoAfoAtADdAHoAboA9ABdAHqALgA9QBeAHqALQA/QzQN8h+oADyVAj8gAAAAASUVORK5CYII=',
  'base64',
);
for (const name of [
  'tiles',
  'sprites',
  'items',
  'spells',
  'arrows',
  'attackeffect',
])
  await writeFile(path.join(directory, 'assets', `${name}.png`), sheet);
await writeFile(
  path.join(directory, 'game.json'),
  JSON.stringify({
    world: { startMapId: '1', respawnTile: { col: 5, row: 5 } },
  }),
);
await writeFile(
  path.join(directory, 'content/maps.json'),
  JSON.stringify([
    {
      id: '1',
      name: 'Smoke',
      type: 'normal',
      tiles: Array.from({ length: 20 }, () =>
        Array.from({ length: 20 }, () => ({ tileIndex: 0 })),
      ),
    },
  ]),
);
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    path.join(directory, 'key.pem'),
    '-out',
    path.join(directory, 'cert.pem'),
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ],
  { stdio: 'ignore' },
);
const app = spawn(
  process.execPath,
  ['--enable-source-maps', 'dist/server/server.js'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: '8081',
      MONGO_URI: mongo.getUri('production_smoke'),
      SESSION_SECRET: randomBytes(32).toString('hex'),
      BOOTSTRAP_ADMIN_USERNAME: 'e2e-map-admin',
      CORS_ALLOWED_ORIGINS: 'https://localhost:8443',
      TRUST_PROXY: '1',
      USE_SECURE_COOKIES: 'true',
      GAME_DIR: directory,
      CONTENT_PATH: path.join(directory, 'content'),
      ANALYTICS_ENABLED: 'false',
      SCRIPT_EDITOR_ENABLED: 'false',
      ASSETS_PATH: path.join(directory, 'assets'),
      WS_PUBLIC_URL: '',
      MAP_IDS: '',
    },
  },
);
const proxy = createHttpsServer(
  {
    key: await readFile(path.join(directory, 'key.pem')),
    cert: await readFile(path.join(directory, 'cert.pem')),
  },
  (req, res) => {
    const upstream = httpRequest(
      {
        hostname: '127.0.0.1',
        port: 8081,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          'x-forwarded-proto': 'https',
          'x-forwarded-for': '127.0.0.1',
        },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  },
);
proxy.on('upgrade', (req, socket, head) => {
  const upstream = connect(8081, '127.0.0.1', () => {
    const headers = {
      ...req.headers,
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '127.0.0.1',
    };
    upstream.write(
      `${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers)
        .map(
          ([key, value]) =>
            `${key}: ${Array.isArray(value) ? value.join(', ') : value}`,
        )
        .join('\r\n')}\r\n\r\n`,
    );
    upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});
await new Promise<void>((resolve) => proxy.listen(8443, '127.0.0.1', resolve));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  proxy.close();
  const exited = new Promise<void>((resolve) =>
    app.once('exit', () => resolve()),
  );
  app.kill('SIGTERM');
  const timeout = setTimeout(() => app.kill('SIGKILL'), 10_000);
  await exited;
  clearTimeout(timeout);
  await mongo.stop();
  await rm(directory, { recursive: true, force: true });
  process.exit(0);
}
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
app.once('exit', (code) => {
  if (!stopping) {
    void mongo.stop().finally(() => process.exit(code ?? 1));
  }
});
