import { defineConfig, devices } from '@playwright/test';

const production = process.env.E2E_PRODUCTION === 'true';

// Register and login share one budget per address, and every test spends it
// from this machine: at the default 20 a 429 passes for a browser failure.
const env = { AUTH_RATE_LIMIT_MAX: '1000' };

// A built game behind TLS. `npm run e2e:production` builds first, as two of
// these starting together would otherwise race to write dist/.
const builtGame = (tlsPort: number, gameFolder = '') => ({
  command: `node --experimental-strip-types e2e/productionServer.ts ${gameFolder}`,
  url: `https://127.0.0.1:${tlsPort}/readyz`,
  ignoreHTTPSErrors: true,
  env,
  timeout: 120_000,
});

// One smoke suite: can a fresh account log in, move and attack on the real
// stack? It covers what server tests cannot: the Vite proxy, the session
// cookie, the WebSocket handshake and React in a real browser.
//
// Needs `npm run db:up` or a running dev server.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'dot' : 'list',
  use: {
    baseURL: production ? 'https://localhost:8443' : 'http://localhost:3000',
    ignoreHTTPSErrors: production,
    trace: 'retain-on-failure',
    // Pinned: the client picks its language from navigator.language and the
    // assertions are in English.
    locale: 'en-US',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: production
    ? [builtGame(8443), builtGame(8444, 'demos/gravewatch')]
    : {
        // Starts server and client as a developer would, reusing ones already up.
        command: 'npm run dev',
        // Vite answers on :3000 long before Express listens on :8080, so
        // readiness waits on /healthz, which answers only once the real server
        // is up.
        url: 'http://localhost:8080/healthz',
        reuseExistingServer: !process.env.CI,
        env,
        // A ceiling, not a delay; a cold CI runner pays for transpiling the
        // server and the first Mongo connection.
        timeout: 120_000,
      },
});
