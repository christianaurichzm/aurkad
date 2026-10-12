import { beforeAll, expect, it, vi } from 'vitest';
import { handleInput } from './keyboard';
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
