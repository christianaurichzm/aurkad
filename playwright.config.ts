import { defineConfig, devices } from '@playwright/test';

const production = process.env.E2E_PRODUCTION === 'true';

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
  webServer: {
    // Starts server and client as a developer would, reusing ones already up.
    command: production
      ? 'npm run build && node --experimental-strip-types e2e/productionServer.ts'
      : 'npm run dev',
    // Vite answers on :3000 long before Express listens on :8080, so readiness
    // waits on /healthz, which answers only once the real server is up.
    url: production
      ? 'https://127.0.0.1:8443/readyz'
      : 'http://localhost:8080/healthz',
    ignoreHTTPSErrors: production,
    reuseExistingServer: !production && !process.env.CI,
    // A ceiling, not a delay; a cold CI runner pays for transpiling the server
    // and the first Mongo connection.
    timeout: 120_000,
  },
});
