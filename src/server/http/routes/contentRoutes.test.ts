import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtendedRequest } from '../session.js';
import { Access } from '../../../shared/types.js';

const mocks = vi.hoisted(() => ({
  createOrUpdateItem: vi.fn(),
  createOrUpdateSpell: vi.fn(),
  createOrUpdateArrow: vi.fn(),
}));

vi.mock('../../services/auditService.js', () => ({
  recordAdminAction: vi.fn(),
  summarizeDetails: () => undefined,
}));
vi.mock('../../services/content/itemService.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createOrUpdateItem: mocks.createOrUpdateItem,
}));
vi.mock('../../services/content/spellService.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createOrUpdateSpell: mocks.createOrUpdateSpell,
}));
vi.mock('../../services/content/arrowService.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createOrUpdateArrow: mocks.createOrUpdateArrow,
}));

import { createContentRouter } from './contentRoutes.js';

const app = express();
app.use(express.json());
app.use((req: ExtendedRequest, _res, next) => {
  req.session = {
    username: 'op',
    accessLevel: Access.ADMIN,
  } as ExtendedRequest['session'];
  next();
});
app.use(createContentRouter());

const item = { name: 'Sword', type: 'weapon', sprite: 1, description: '' };

beforeEach(() => vi.clearAllMocks());

describe('the id in a content path', () => {
  // A PUT upserts, so an id the counter never hands out would become a record.
  it.each(['/items/-1', '/items/1.5', '/items/0', '/spells/-1', '/arrows/1.5'])(
    'refuses PUT %s',
    async (path) => {
      const res = await request(app).put(path).send(item);

      expect(res.status).toBe(400);
      expect(mocks.createOrUpdateItem).not.toHaveBeenCalled();
      expect(mocks.createOrUpdateSpell).not.toHaveBeenCalled();
      expect(mocks.createOrUpdateArrow).not.toHaveBeenCalled();
    },
  );

  it('updates under a counter id', async () => {
    await request(app).put('/items/7').send(item).expect(200);

    expect(mocks.createOrUpdateItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
    );
  });
});
