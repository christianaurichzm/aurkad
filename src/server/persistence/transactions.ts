import mongoose from 'mongoose';
import { logger } from '../logger.js';

/**
 * Multi-document writes, and whether this deployment can do them. MongoDB
 * has transactions only on a replica set or through mongos. The compose
 * files run a one-node replica set, but an operator's Mongo may be
 * standalone, so this is detected and said at boot: without it, a trade
 * writes two players in turn, and a crash between leaves the item on both
 * sides or neither.
 *
 * The probe is the `hello` command, as in the drivers: `setName` means a
 * replica set, `isdbgrid` mongos. A throwaway transaction would write to the
 * operator's database to learn the same.
 */
let supported = false;

export async function probeTransactionSupport(): Promise<boolean> {
  supported = false;
  const db = mongoose.connection.db;
  if (!db) return false;

  try {
    const hello = await db.admin().command({ hello: 1 });
    supported = !!hello.setName || hello.msg === 'isdbgrid';
  } catch (err) {
    // A deployment that will not answer `hello` is not one to try transactions
    // against; the sequential path still works.
    logger.warn('[DB] Could not probe transaction support', { err });
    return false;
  }

  if (supported) {
    logger.info('[DB] Transactions available; economic commits are atomic');
  } else {
    logger.warn(
      '[DB] Standalone MongoDB: no transactions. A trade writes each player ' +
        'separately, so a crash between the two writes can duplicate or lose ' +
        'the traded item. Run Mongo as a replica set to close that window.',
    );
  }
  return supported;
}

export function supportsTransactions(): boolean {
  return supported;
}

/** For tests and for a reconnect that has not been probed yet. */
export function setTransactionSupportForTest(value: boolean): void {
  supported = value;
}

/**
 * Runs `work` inside one transaction, or reports that it could not. False
 * when the deployment has none and when the commit failed, both meaning
 * nothing was written, so the caller decides how to degrade.
 */
export async function withTransaction(
  work: (session: mongoose.ClientSession) => Promise<void>,
  context: string,
): Promise<boolean> {
  if (!supported) return false;

  let session: mongoose.ClientSession | undefined;
  try {
    const active = await mongoose.startSession();
    session = active;
    await active.withTransaction(async () => {
      await work(active);
    });
    return true;
  } catch (err) {
    logger.error('[DB] transaction aborted; nothing was written', {
      context,
      err,
    });
    return false;
  } finally {
    await session?.endSession().catch((err) =>
      logger.error('[DB] transaction session cleanup failed', {
        context,
        err,
      }),
    );
  }
}
