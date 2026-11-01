import base from '../../vite.config.ts';

// The engine's client on :3007, beside the dev server on :3000. run.mjs gives
// it the demo server's PORT, which the base proxy follows.
export default {
  ...base,
  root: new URL('../..', import.meta.url).pathname,
  server: { ...base.server, host: '127.0.0.1', port: 3007, strictPort: true },
};
