import { beforeAll, expect, it, vi } from 'vitest';
import { handleInput, pressKey, releaseKey } from './keyboard';
import { Key } from '../../shared/types';
import { sendAction } from './network';

vi.mock('./network', () => ({
  sendAction: vi.fn(),
  openModEditor: vi.fn(),
  openMapEditor: vi.fn(),
  openContentEditor: vi.fn(),
}));
vi.mock('../core/gameState', () => ({ getPlayer: () => null }));
vi.mock('../graphics/movementAnimation', () => ({ getAnimatedState: vi.fn() }));

beforeAll(() => handleInput());

const sentKeyActions = () =>
  vi
    .mocked(sendAction)
    .mock.calls.map(([action]) =>
      action.type === 'keyboard' ? action.keyboardAction.type : undefined,
    );

it('keeps game movement out of editable controls and still releases held keys', () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  for (const html of [
    '<input>',
    '<textarea></textarea>',
    '<select><option>A</option></select>',
    '<div contenteditable="true" tabindex="0"><span tabindex="0">Text</span></div>',
  ]) {
    document.body.innerHTML = html;
    const target =
      document.body.querySelector<HTMLElement>('span') ??
      (document.body.firstElementChild as HTMLElement);
    target.focus();
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      }),
    );
  }
  expect(sendAction).not.toHaveBeenCalled();
  document.body.innerHTML = '';
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
  );
  document.body.innerHTML = '<textarea></textarea>';
  document.querySelector('textarea')!.focus();
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
  expect(sentKeyActions()).toEqual(['press', 'release']);
});

// A reconnect opens a session with no keys held, and a key already down
// sends no new keydown, so the client presses it again itself.
it('presses a key still held again on a new socket, and only while it is held', () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  document.body.innerHTML = '';
  vi.mocked(sendAction).mockClear();

  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
  );
  window.dispatchEvent(new Event('socketOpen'));
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
  window.dispatchEvent(new Event('socketOpen'));

  expect(sentKeyActions()).toEqual(['press', 'press', 'release']);
});

// The server holds one key for all of them, so it hears the first press and
// the last release.
it('keeps a key down while another device still holds it', async () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  document.body.innerHTML = '';
  vi.mocked(sendAction).mockClear();

  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }),
  );
  await pressKey(Key.ArrowLeft, 'gamepad');
  releaseKey(Key.ArrowLeft, 'gamepad');
  expect(sentKeyActions()).toEqual(['press']);

  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft' }));
  expect(sentKeyActions()).toEqual(['press', 'release']);
});

// CapsLock and a held Shift, which runs, report a letter as its capital, and
// Shift can land between the press and the release.
it('takes a capital for its letter, on the press and on the release', () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  document.body.innerHTML = '';
  vi.mocked(sendAction).mockClear();

  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'e', cancelable: true }),
  );
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'E' }));
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'E', cancelable: true }),
  );
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'e' }));

  expect(sentKeyActions()).toEqual(['press', 'release', 'press', 'release']);
});

it('leaves the browser its Cmd and Ctrl+Shift shortcuts', () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  document.body.innerHTML = '';
  vi.mocked(sendAction).mockClear();

  for (const init of [
    { key: 'f', metaKey: true },
    { key: 'c', metaKey: true },
    { key: 'C', ctrlKey: true, shiftKey: true },
  ]) {
    const event = new KeyboardEvent('keydown', { ...init, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }

  expect(sendAction).not.toHaveBeenCalled();
});

// Arrows move whatever is held with them: running and attacking are Shift and
// Control, and Cmd+Left would leave the game.
it('still takes an arrow with a modifier held', () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  document.body.innerHTML = '';
  vi.mocked(sendAction).mockClear();

  const event = new KeyboardEvent('keydown', {
    key: 'ArrowLeft',
    ctrlKey: true,
    shiftKey: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft' }));

  expect(event.defaultPrevented).toBe(true);
  expect(sentKeyActions()).toEqual(['press', 'release']);
});

it('holds the game back while a modal dialog is open, wherever the focus is', () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
  vi.mocked(sendAction).mockClear();

  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
  );
  expect(sendAction).not.toHaveBeenCalled();

  document.body.innerHTML = '<div role="dialog"></div>';
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
  );
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
  expect(sentKeyActions()).toEqual(['press', 'release']);
});

it('leaves Tab to the page', () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  document.body.innerHTML = '';
  vi.mocked(sendAction).mockClear();

  const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
  window.dispatchEvent(event);

  expect(event.defaultPrevented).toBe(false);
  expect(sendAction).not.toHaveBeenCalled();
});

// macOS swallows the keyup of whatever is let go under Cmd.
it('lets go of the keyboard when Cmd comes up', () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  document.body.innerHTML = '';
  vi.mocked(sendAction).mockClear();

  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      metaKey: true,
      cancelable: true,
    }),
  );
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }));

  expect(sentKeyActions()).toEqual(['press', 'release']);
});

it('lets go only of what the keyboard held when the window loses focus', async () => {
  vi.mocked(sendAction).mockClear();

  await pressKey(Key.ArrowUp, 'gamepad');
  window.dispatchEvent(new Event('blur'));
  expect(sentKeyActions()).toEqual(['press']);

  releaseKey(Key.ArrowUp, 'gamepad');
  expect(sentKeyActions()).toEqual(['press', 'release']);
});
