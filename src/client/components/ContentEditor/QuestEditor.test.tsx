/**
 * Authored quests, editor side: the form sends only the objective type
 * chosen, and a quest with no reward saves no reward.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Quest } from '../../../shared/types';
import { QuestEditor } from './QuestEditor';

const mocks = vi.hoisted(() => ({
  saveQuest: vi.fn(),
  deleteQuest: vi.fn(),
}));

vi.mock('../../io/network', () => ({
  saveQuest: mocks.saveQuest,
  deleteQuest: mocks.deleteQuest,
}));

vi.mock('../ChatPanel', () => ({ chatResultMsg: vi.fn() }));

const setup = (quests: Quest[] = []) => {
  render(
    <QuestEditor
      quests={quests}
      loadQuests={() =>
        Promise.resolve(quests.map((q) => ({ value: q.id, label: q.name })))
      }
      loadNpcs={() =>
        Promise.resolve([
          { value: 'orc', label: 'orc - Orc' },
          { value: 'elder', label: 'elder - Elder' },
        ])
      }
      loadItems={() =>
        Promise.resolve([
          { value: 1, label: '1 - Health Potion' },
          { value: 3, label: '3 - Gold Coin' },
        ])
      }
      loadMaps={() => Promise.resolve([{ value: '1', label: '1 - Village' }])}
      refreshData={vi.fn()}
      onDirtyChange={vi.fn()}
      requestDiscard={() => Promise.resolve(true)}
    />,
  );
};

/** What the save call was handed, once it happened. */
const saved = async (): Promise<Quest> => {
  await waitFor(() => expect(mocks.saveQuest).toHaveBeenCalled());
  return mocks.saveQuest.mock.calls[0][0] as Quest;
};

beforeEach(() => {
  mocks.saveQuest.mockReset();
  mocks.saveQuest.mockResolvedValue({});
});

describe('authoring a quest', () => {
  it('saves a kill objective with the npc and the count', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByPlaceholderText('goblin-hunt'), 'orcs');
    await user.type(screen.getByPlaceholderText('Goblin trouble'), 'Orcs');
    await screen.findByRole('option', { name: 'orc - Orc' });
    await user.selectOptions(screen.getAllByRole('combobox')[2], 'orc');
    await user.click(screen.getByRole('button', { name: 'Create quest' }));

    const quest = await saved();
    expect(quest.id).toBe('orcs');
    expect(quest.objective).toEqual({ type: 'kill', npcId: 'orc', count: 1 });
  });

  // The form flattens the union, so fields of other types must not be sent;
  // the server's schema refuses a mapId on a kill objective.
  it('sends only the fields of the objective type chosen', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByPlaceholderText('goblin-hunt'), 'scout');
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'reach');
    await screen.findByRole('option', { name: '1 - Village' });
    await user.selectOptions(screen.getAllByRole('combobox')[2], '1');
    await user.click(screen.getByRole('button', { name: 'Create quest' }));

    const objective = (await saved()).objective;
    expect(objective).toEqual({ type: 'reach', mapId: '1', row: 0, col: 0 });
    expect(objective).not.toHaveProperty('npcId');
    expect(objective).not.toHaveProperty('count');
  });

  // A reward of zeroes would be stored and carried by every round trip.
  it('leaves out a reward the designer never filled in', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByPlaceholderText('goblin-hunt'), 'q');
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'talk');
    await user.click(screen.getByRole('button', { name: 'Create quest' }));

    expect(await saved()).not.toHaveProperty('reward');
  });

  it('omits description when it was left blank', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByPlaceholderText('goblin-hunt'), 'q');
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'talk');
    await user.click(screen.getByRole('button', { name: 'Create quest' }));

    expect(await saved()).not.toHaveProperty('description');
  });
});

describe('editing an existing quest', () => {
  const stored: Quest = {
    id: 'orcs',
    name: 'Orcs at the gate',
    description: 'Thin out the warband.',
    objective: { type: 'kill', npcId: 'orc', count: 3 },
    reward: { experience: 150, items: [{ itemId: 1, quantity: 2 }] },
  };

  it('round-trips a document without inventing or dropping fields', async () => {
    const user = userEvent.setup();
    setup([stored]);

    await screen.findByRole('option', { name: 'Orcs at the gate' });
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'orcs');
    await user.click(screen.getByRole('button', { name: 'Save quest' }));

    expect(await saved()).toEqual(stored);
  });
});
