import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../../test/mongo.js';
import ArrowModel from '../../model/Arrow.js';
import { createOrUpdateArrow } from './arrowService.js';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await startMemoryMongo();
  await mongoose.connect(mongod.getUri());
}, 30_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
  );
});

const arrow = (name: string) => ({
  name,
  description: '',
  sprite: 0,
  damage: 1,
});

describe('createOrUpdateArrow', () => {
  it('gives two arrows created at once an id each', async () => {
    await Promise.all([
      createOrUpdateArrow(arrow('Iron')),
      createOrUpdateArrow(arrow('Fire')),
    ]);

    expect(await ArrowModel.countDocuments()).toBe(2);
  });

  // A pack or a seed writes its own ids and leaves the counter where it was.
  it('numbers a new arrow above ones that came with their own id', async () => {
    await createOrUpdateArrow({ ...arrow('Packed'), id: 8 });

    const created = await createOrUpdateArrow(arrow('New'));

    expect(created.id).toBe(9);
  });
});
