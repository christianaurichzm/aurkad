import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { loadClientModule } from '../../../test/clientModule';
import { focusDialog } from '../../hooks/useDialogFocus';

it('names the NPC, traps Tab, chooses once and restores the opener', async () => {
  const opener = document.createElement('input');
  document.body.append(opener);
  opener.focus();
  const mod = loadClientModule('dialog', { ui: { focusDialog } });
  const rects = vi
    .spyOn(HTMLElement.prototype, 'getClientRects')
    .mockReturnValue(
      Object.assign([new DOMRect()], { item: () => new DOMRect() }),
    );
  mod.handlers.get('dialog:show')!({
    id: 1,
    speaker: 'Tomás',
    text: 'Ready for the crossing?',
    choices: ['Wares', 'Goodbye'],
  });
  expect(screen.getByRole('dialog', { name: 'Tomás' })).toHaveFocus();
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
  expect(screen.getByRole('button', { name: '2. Goodbye' })).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: '1. Wares' })).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(mod.engine.sendServerEvent).toHaveBeenCalledExactlyOnceWith(
    'dialog:choose',
    { id: 1, index: 1 },
  );
  expect(opener).toHaveFocus();
  expect(screen.queryByRole('dialog')).toBeNull();
  rects.mockRestore();
  opener.remove();
});

it('answers the next line of a conversation with its own choices', async () => {
  const mod = loadClientModule('dialog');
  mod.handlers.get('dialog:show')!({ id: 1, text: 'Hello.' });
  await userEvent.keyboard('1');
  mod.handlers.get('dialog:show')!({
    id: 1,
    speaker: 'Tomás',
    text: 'Anything else?',
    choices: ['Wares', 'Rumours', 'Goodbye'],
  });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  await userEvent.keyboard('3');
  expect(mod.engine.sendServerEvent).toHaveBeenCalledTimes(2);
  expect(mod.engine.sendServerEvent).toHaveBeenLastCalledWith('dialog:choose', {
    id: 1,
    index: 2,
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});
