import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Hotbar } from './Hotbar';
import { setHotbar, type HotbarSlot } from '../../io/modules/moduleActions';

const NOW = 1_700_000_000_000;

const slot = (over: Partial<HotbarSlot> = {}): HotbarSlot => ({
  id: 'arcane',
  name: 'Arcane Blast',
  description: 'Hurts what is near.',
  key: 'F1',
  cost: 30,
  cooldownMs: 3000,
  onUse: vi.fn(),
  ...over,
});

const put = (...slots: HotbarSlot[]) => act(() => setHotbar('magic', slots));
const button = () => screen.getByRole('button', { name: /Arcane Blast/ });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  put();
  vi.useRealTimers();
});

describe('the hotbar', () => {
  it('draws nothing until a module puts a slot on it', () => {
    const { container } = render(<Hotbar />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the key, the cost and the initial of a spell with no icon', () => {
    render(<Hotbar />);
    put(slot());

    expect(button().getAttribute('aria-label')).toBe('F1 Arcane Blast');
    expect(button().textContent).toBe('AF130');
    expect(button().dataset.state).toBe('ready');
  });

  it('describes the slot in its tooltip', () => {
    render(<Hotbar />);
    put(slot());

    const tip = document.getElementById(
      button().getAttribute('aria-describedby')!,
    )!;
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect([...tip.children].map((c) => c.textContent)).toEqual([
      'Arcane Blast',
      'Hurts what is near.',
      '30 MP · Ready',
      'Key F1',
    ]);
  });

  it('uses the slot on a click and on its key', () => {
    const onUse = vi.fn();
    render(<Hotbar />);
    put(slot({ onUse }));

    fireEvent.click(button());
    const press = new KeyboardEvent('keydown', { key: 'F1', cancelable: true });
    window.dispatchEvent(press);

    expect(onUse).toHaveBeenCalledTimes(2);
    expect(press.defaultPrevented).toBe(true);
  });

  it('leaves a key no slot holds to the browser, and ignores keys while typing', () => {
    const onUse = vi.fn();
    render(<Hotbar />);
    put(slot({ onUse }));

    const help = new KeyboardEvent('keydown', { key: 'F2', cancelable: true });
    window.dispatchEvent(help);
    expect(help.defaultPrevented).toBe(false);

    const input = document.body.appendChild(document.createElement('input'));
    input.focus();
    fireEvent.keyDown(input, { key: 'F1' });
    input.remove();

    expect(onUse).not.toHaveBeenCalled();
  });

  it('counts a cooldown down, covering the share still owed', () => {
    render(<Hotbar />);
    put(slot({ readyAt: NOW + 2250 }));

    const cover = () => button().querySelector<HTMLElement>('.hotbar-cooldown');
    expect(button().dataset.state).toBe('cooldown');
    expect(cover()!.textContent).toBe('3');
    expect(cover()!.style.getPropertyValue('--cd')).toBe('75%');

    act(() => void vi.advanceTimersByTime(1850));
    expect(cover()!.textContent).toBe('0.4');

    // Ready again with no word from the module: the bar keeps its own clock.
    act(() => void vi.advanceTimersByTime(400));
    expect(cover()).toBeNull();
    expect(button().dataset.state).toBe('ready');
  });

  it('marks a spell beyond the mana held', () => {
    render(<Hotbar />);
    put(slot({ noMana: true }));

    expect(button().dataset.state).toBe('nomana');
    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(button().textContent).toContain('MP!');
  });

  it('marks a spell aimed at friends with a cross, not by colour alone', () => {
    render(<Hotbar />);
    put(slot({ friendly: true }));

    expect(button().dataset.friendly).toBe('true');
    expect(button().textContent).toContain('+');
  });
});
