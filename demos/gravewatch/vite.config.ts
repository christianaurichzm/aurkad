import base from '../../vite.config.ts';

// The engine's client on :3007, proxied to the demo's server on :8087, so it
// runs beside the dev server on :3000/:8080.
const proxy = Object.fromEntries(
  Object.entries(base.server!.proxy as Record<string, { target: string }>).map(
    ([path, opts]) => [path, { ...opts, target: opts.target.replace(':8080', ':8087') }],
  ),
);

export default {
  ...base,
  root: new URL('../..', import.meta.url).pathname,
  server: { ...base.server, host: '127.0.0.1', port: 3007, strictPort: true, proxy },
};
