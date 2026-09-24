import { expect, it, vi } from 'vitest';
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

it('keeps game movement out of editable controls and still releases held keys', () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  handleInput();
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
  expect(
    vi
      .mocked(sendAction)
      .mock.calls.map(([action]) =>
        action.type === 'keyboard' ? action.keyboardAction.type : undefined,
      ),
  ).toEqual(['press', 'release']);
});
