import mongoose from 'mongoose';
import { logger } from '../logger.js';
import { connectToDatabase } from '../initDb.js';
import { importContentPack, exportContentPack } from './contentPack.js';

// Standalone entry: `node dist/server/contentPack/cli.js export|import`
// Connects to Mongo, runs the operation, and disconnects.
async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd !== 'import' && cmd !== 'export') {
    logger.error('[content] Usage: contentPack/cli.js <import|export>');
    process.exit(1);
  }

  await connectToDatabase();
  try {
    if (cmd === 'export') {
      await exportContentPack();
    } else if (!(await importContentPack({ all: true }))) {
      process.exitCode = 1;
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((e) => {
  logger.error('[content] CLI failed', { err: e });
  process.exit(1);
});
