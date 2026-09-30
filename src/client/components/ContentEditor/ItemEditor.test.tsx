/**
 * A field whose module is off (an arrow on a bow without archery) is hidden
 * but must survive a save, since the server clears what a save leaves out.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item } from '../../../shared/types';
import { ItemEditor } from './ItemEditor';

const mocks = vi.hoisted(() => ({
  updateItem: vi.fn(),
  fetchArrows: vi.fn(),
}));

vi.mock('../../io/network', () => ({
  updateItem: mocks.updateItem,
  createItem: vi.fn(),
  deleteItem: vi.fn(),
  fetchArrows: mocks.fetchArrows,
  fetchBehaviors: vi.fn().mockResolvedValue([]),
}));

vi.mock('../Inventory/ItemIcon', () => ({ ItemIcon: () => null }));

vi.mock('../ChatPanel', () => ({ chatResultMsg: vi.fn() }));

const bow: Item = {
  id: 7,
  name: 'Bow',
  description: '',
  sprite: 3,
  type: 'weapon',
  arrowId: 2,
};

const setup = (modules: string[]) =>
  render(
    <ItemEditor
      items={[bow]}
      loadItems={() => Promise.resolve([{ value: 7, label: '7 - Bow' }])}
      refreshData={vi.fn()}
      modules={modules}
      onDirtyChange={vi.fn()}
      requestDiscard={() => Promise.resolve(true)}
    />,
  );

beforeEach(() => {
  mocks.updateItem.mockReset();
  mocks.updateItem.mockResolvedValue({ success: true });
  mocks.fetchArrows.mockResolvedValue([{ id: 2, name: 'Iron Arrow' }]);
});

describe('fields owned by a disabled module', () => {
  it('hides the arrow but keeps it on save', async () => {
    const user = userEvent.setup();
    setup([]);

    await screen.findByRole('option', { name: '7 - Bow' });
    await user.selectOptions(screen.getAllByRole('combobox')[0], '7');
    expect(screen.queryByText('Arrow (ranged)')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save Item' }));

    await waitFor(() => expect(mocks.updateItem).toHaveBeenCalled());
    expect(mocks.updateItem.mock.calls[0][1]).toMatchObject({ arrowId: 2 });
  });

  it('shows the stored arrow once the module is on', async () => {
    const user = userEvent.setup();
    setup(['archery']);

    await screen.findByRole('option', { name: '7 - Bow' });
    await user.selectOptions(screen.getAllByRole('combobox')[0], '7');

    expect(screen.getByText('Arrow (ranged)')).toBeInTheDocument();
    expect(
      await screen.findByRole('option', {
        name: '2 - Iron Arrow',
        selected: true,
      }),
    ).toBeInTheDocument();
  });
});
