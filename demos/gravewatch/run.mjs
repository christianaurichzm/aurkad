/**
 * Runs Gravewatch from this folder on a throwaway mongodb-memory-server
 * database, after building the server. build.py rebuilds the art.
 *
 *   node demos/gravewatch/run.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const dir = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(dir, '../..'));
if (!fs.existsSync(`${dir}/assets/tiles.png`))
  throw new Error(
    'demos/gravewatch has no art yet: run python3 demos/gravewatch/build.py (needs Blender and the KayKit packs).',
  );
execSync('npm run build:server', { stdio: 'inherit' });

const mongo = await MongoMemoryServer.create({
  instance: { dbName: 'gravewatch' },
});
const children = [];
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  await Promise.all(
    children.map((child) =>
      child.exitCode !== null || child.signalCode !== null || !child.pid
        ? Promise.resolve()
        : new Promise((resolve) => child.once('exit', resolve)),
    ),
  );
  await mongo.stop();
  process.exit(code);
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
const start = (args, env) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env });
  children.push(child);
  child.once('error', (err) => {
    console.error(err);
    void stop(1);
  });
  child.once('exit', (code) => {
    if (!stopping) void stop(code ?? 1);
  });
};
const env = {
  ...process.env,
  NODE_ENV: 'development',
  GAME_DIR: dir,
  PORT: '8087',
  MONGO_URI: mongo.getUri('gravewatch'),
  BOOTSTRAP_ADMIN_USERNAME: 'warden',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3007',
};
start(['--enable-source-maps', 'dist/server/server.js'], env);
start(['node_modules/vite/bin/vite.js', '--config', `${dir}/vite.config.ts`], env);
console.log(
  '\nGravewatch: http://localhost:3007 - register warden for the creator tools.\nThe database is temporary and resets when this command stops.\n',
);
