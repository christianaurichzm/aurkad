/**
 * Authored conversations, editor side: an unfilled optional field must not
 * be saved as an empty reference, and a choice can name a node just typed.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dialog } from '../../../shared/types';
import { DialogEditor } from './DialogEditor';

const mocks = vi.hoisted(() => ({
  saveDialog: vi.fn(),
  deleteDialog: vi.fn(),
  fetchDialogRefs: vi.fn(),
}));

vi.mock('../../io/network', () => ({
  saveDialog: mocks.saveDialog,
  deleteDialog: mocks.deleteDialog,
  fetchDialogRefs: mocks.fetchDialogRefs,
}));

vi.mock('../ChatPanel', () => ({ chatResultMsg: vi.fn() }));

const setup = (dialogs: Dialog[] = []) => {
  render(
    <DialogEditor
      dialogs={dialogs}
      loadDialogs={() =>
        Promise.resolve(dialogs.map((d) => ({ value: d.id, label: d.name })))
      }
      refreshData={vi.fn()}
      onDirtyChange={vi.fn()}
      requestDiscard={() => Promise.resolve(true)}
    />,
  );
};

/** What the save call was handed, once it happened. */
const saved = async (): Promise<Dialog> => {
  await waitFor(() => expect(mocks.saveDialog).toHaveBeenCalled());
  return mocks.saveDialog.mock.calls[0][0] as Dialog;
};

beforeEach(() => {
  mocks.saveDialog.mockReset();
  mocks.saveDialog.mockResolvedValue({});
  mocks.fetchDialogRefs.mockResolvedValue({
    conditions: ['trusted'],
    actions: ['guardGift'],
  });
});

describe('authoring a conversation', () => {
  it('saves the nodes and choices as a document', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByPlaceholderText('elder-intro'), 'guard-gate');
    await user.type(
      screen.getByPlaceholderText('Village elder - intro'),
      'Gate',
    );
    await user.click(screen.getByRole('button', { name: '+ Add node' }));
    await user.type(
      screen.getByPlaceholderText('Welcome, traveller.'),
      'Halt.',
    );
    await user.click(screen.getByRole('button', { name: '+ Add' }));
    await user.type(screen.getByPlaceholderText("Yes, I'll help"), 'Let me by');
    await user.click(screen.getByRole('button', { name: 'Create dialog' }));

    const dialog = await saved();
    expect(dialog.id).toBe('guard-gate');
    expect(dialog.nodes).toHaveLength(1);
    expect(dialog.nodes[0]?.text).toBe('Halt.');
    expect(dialog.nodes[0]?.choices?.[0]?.label).toBe('Let me by');
  });

  // Empty strings would be stored as references to nothing.
  it('leaves out the optional fields a designer did not fill', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByPlaceholderText('elder-intro'), 'd');
    await user.click(screen.getByRole('button', { name: '+ Add node' }));
    await user.click(screen.getByRole('button', { name: '+ Add' }));
    await user.type(screen.getByPlaceholderText("Yes, I'll help"), 'Bye');
    await user.click(screen.getByRole('button', { name: 'Create dialog' }));

    const choice = (await saved()).nodes[0]?.choices?.[0];
    expect(choice).toEqual({ label: 'Bye' });
  });

  it('omits start when the conversation just opens on its first node', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByPlaceholderText('elder-intro'), 'd');
    await user.click(screen.getByRole('button', { name: '+ Add node' }));
    await user.click(screen.getByRole('button', { name: 'Create dialog' }));

    expect(await saved()).not.toHaveProperty('start');
  });

  // Targets come from the form, so a node added now can be named now
  // without saving first.
  it('offers the nodes being edited as choice targets', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: '+ Add node' }));
    await user.click(screen.getByRole('button', { name: '+ Add node' }));
    await user.click(screen.getAllByRole('button', { name: '+ Add' })[0]);

    // Condition and action inputs are comboboxes too, through their suggestion
    // lists; the node targets are the real selects.
    const selects = screen
      .getAllByRole('combobox')
      .filter((el) => el.tagName === 'SELECT');
    const goesTo = selects[selects.length - 1];
    expect(
      within(goesTo).getByRole('option', { name: 'node2' }),
    ).toBeInTheDocument();
  });
});

describe('editing an existing conversation', () => {
  const stored: Dialog = {
    id: 'guard-gate',
    name: 'Gate',
    start: 'gate',
    nodes: [
      {
        id: 'gate',
        text: 'Halt.',
        choices: [
          { label: 'Let me by', next: 'pass', condition: 'trusted' },
          { label: 'Bye' },
        ],
      },
      { id: 'pass', text: 'Go on then.' },
    ],
  };

  it('round-trips a document without inventing or dropping fields', async () => {
    const user = userEvent.setup();
    setup([stored]);

    // The picker loads its options, so the document is only selectable once
    // they arrive. The first combobox is the picker; the next is "Starts at".
    await screen.findByRole('option', { name: 'Gate' });
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'guard-gate');
    await user.click(screen.getByRole('button', { name: 'Save dialog' }));

    expect(await saved()).toEqual(stored);
  });

  // With the quest module off, questStart is not registered; the choice
  // still survives the save for when it comes back on.
  it('flags a reference to a disabled module but keeps it', async () => {
    const withQuest: Dialog = {
      id: 'elder',
      name: 'Elder',
      nodes: [
        {
          id: 'hi',
          text: 'Help us?',
          choices: [{ label: 'Yes', action: 'questStart:goblinHunt' }],
        },
      ],
    };
    const user = userEvent.setup();
    setup([withQuest]);

    await screen.findByRole('option', { name: 'Elder' });
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'elder');

    expect(
      await screen.findByText(/questStart is not available/),
    ).toBeInTheDocument();
    const offered = [
      ...document.querySelectorAll('#dialog-actions option'),
    ].map((o) => o.getAttribute('value'));
    expect(offered).toEqual(['guardGift']);

    await user.click(screen.getByRole('button', { name: 'Save dialog' }));
    expect(await saved()).toEqual(withQuest);
  });
});
