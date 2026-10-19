import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/dialog/client.jsx, compiled and loaded the way the
// browser gets it.

const LINE = {
  id: 1,
  speaker: 'Tomás',
  sprite: 12,
  npcId: 'npc-7',
  text: 'Ready for the crossing?',
  choices: ['Wares', 'Goodbye'],
};

let mod: ReturnType<typeof loadClientModule>;
let now: ReturnType<typeof vi.spyOn>;
const show = (payload: unknown) => mod.handlers.get('dialog:show')!(payload);
const choice = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  // jsdom lays nothing out, and the focus trap only counts what has a box.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue(
    Object.assign([new DOMRect()], { item: () => new DOMRect() }),
  );
  // The line types out against the clock, held here so only a test moves
  // it, however slow the run.
  now = vi.spyOn(performance, 'now').mockReturnValue(0);
  mod = loadClientModule('dialog');
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('style');
});

it('names who is talking and shows their portrait, swappable by sprite', () => {
  show(LINE);
  const dialog = screen.getByRole('dialog', { name: 'Tomás' });
  expect(dialog).toHaveFocus();
  expect(dialog.querySelector('.dialog-portrait')).toHaveAttribute(
    'data-sprite',
    '12',
  );
});

it('has no portrait for a box nobody is behind', () => {
  show({ id: 1, text: 'The door is locked.' });
  const dialog = screen.getByRole('dialog', { name: 'Conversation' });
  expect(dialog.querySelector('.dialog-portrait')).toBeNull();
});

it('writes the line out at its own pace', async () => {
  show(LINE);
  const unsaid = () => screen.getByRole('dialog').querySelector('p > span');
  expect(unsaid()).toHaveTextContent('Ready for the crossing?');
  now.mockReturnValue(250);
  await vi.waitFor(() => expect(unsaid()).toHaveTextContent('the crossing?'));
  expect(screen.getByRole('list')).toHaveAttribute('data-waiting');
  now.mockReturnValue(5000);
  await vi.waitFor(() =>
    expect(screen.getByRole('list')).not.toHaveAttribute('data-waiting'),
  );
});

it('takes no answer until the line is whole, then by number, once', async () => {
  const opener = document.createElement('input');
  document.body.append(opener);
  opener.focus();
  show(LINE);

  await userEvent.keyboard('1');
  expect(mod.engine.sendServerEvent).not.toHaveBeenCalled();
  expect(screen.getByRole('list')).toHaveAttribute('data-waiting');

  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('list')).not.toHaveAttribute('data-waiting');
  expect(mod.engine.sendServerEvent).not.toHaveBeenCalled();

  await userEvent.keyboard('2');
  await userEvent.keyboard('2');
  expect(mod.engine.sendServerEvent).toHaveBeenCalledExactlyOnceWith(
    'dialog:choose',
    { id: 1, index: 1 },
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(opener).toHaveFocus();
  opener.remove();
});

it('walks the choices with the arrows, answers with Enter and keeps Tab inside', async () => {
  show(LINE);
  await userEvent.keyboard(' ');
  expect(choice('1. Wares')).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}');
  expect(choice('2. Goodbye')).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}');
  expect(choice('1. Wares')).toHaveFocus();
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
  expect(choice('Leave the conversation')).toHaveFocus();
  await userEvent.tab();
  expect(choice('1. Wares')).toHaveFocus();
  await userEvent.keyboard('{ArrowUp}{Enter}');
  expect(mod.engine.sendServerEvent).toHaveBeenCalledExactlyOnceWith(
    'dialog:choose',
    { id: 1, index: 1 },
  );
});

// Escape must not answer with the last choice, which is only harmless while
// the last choice is a goodbye.
it('leaves on Escape without answering anything', async () => {
  show(LINE);
  await userEvent.keyboard('{Escape}');
  expect(mod.engine.sendServerEvent).toHaveBeenCalledExactlyOnceWith(
    'dialog:close',
    { id: 1 },
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('takes the box down when the server says the conversation is gone', () => {
  show(LINE);
  mod.handlers.get('dialog:hide')!({});
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mod.engine.sendServerEvent).not.toHaveBeenCalled();
});

it('answers the next line of a conversation with its own choices', async () => {
  show({ id: 1, text: 'Hello.' });
  await userEvent.keyboard('{Enter}1');
  show({
    id: 2,
    speaker: 'Tomás',
    text: 'Anything else?',
    choices: ['Wares', 'Rumours', 'Goodbye'],
    read: [0],
  });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  // The new line is written out again: the 3 that finished the last one does
  // not answer this one.
  await userEvent.keyboard('3');
  expect(mod.engine.sendServerEvent).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByText(/Anything/));
  expect(choice('1. Wares')).toHaveAttribute('data-read');
  expect(choice('2. Rumours')).not.toHaveAttribute('data-read');
  await userEvent.keyboard('3');
  expect(mod.engine.sendServerEvent).toHaveBeenLastCalledWith('dialog:choose', {
    id: 2,
    index: 2,
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('darkens the world around the speaker while the box is up, if the game wants it', async () => {
  document.documentElement.style.setProperty('--dialog-dim', 'rgba(0,0,0,0.6)');
  mod = loadClientModule('dialog', {
    getGameState: () => ({
      npcs: { 'npc-7': { position: { x: 640, y: 320 } } },
    }),
  });
  show(LINE);
  expect(mod.overlays.map((o) => o.order)).toEqual([50]);

  const gradient = { addColorStop: vi.fn() };
  const ctx = {
    canvas: { width: 1280, height: 896 },
    createRadialGradient: vi.fn(() => gradient),
    fillRect: vi.fn(),
  };
  mod.overlays[0].fn(ctx as never, { x: 100, y: 50 });
  expect(ctx.createRadialGradient).toHaveBeenCalledWith(
    672,
    352,
    64,
    672,
    352,
    256,
  );
  expect(gradient.addColorStop).toHaveBeenLastCalledWith(1, 'rgba(0,0,0,0.6)');
  expect(ctx.fillRect).toHaveBeenCalledWith(100, 50, 1280, 896);

  await userEvent.keyboard('{Escape}');
  expect(mod.overlays).toEqual([]);
});

it('leaves the world lit when the game turned the dim off', () => {
  document.documentElement.style.setProperty('--dialog-dim', 'transparent');
  show(LINE);
  expect(mod.overlays).toEqual([]);
});
