import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getEl,
  getInputValue,
  show,
  hide,
  addEvent,
  removeEvent,
  safeParseInt,
  withLoading,
} from './domHelpers';

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as Record<string, unknown>).selectedTileKind;
});

const mount = (html: string) => {
  document.body.innerHTML = html;
};

describe('getEl', () => {
  it('is null for an id that is not on the page', () => {
    expect(getEl('nope')).toBeNull();
  });
});

describe('getInputValue', () => {
  it('reads the input when there is one', () => {
    mount('<input id="tileKind" value="wall">');
    expect(getInputValue('tileKind')).toBe('wall');
  });

  it('falls back to the selection the tileset editor parks on window', () => {
    (window as unknown as Record<string, unknown>).selectedTileKind = 'water';
    expect(getInputValue('tileKind')).toBe('water');
  });

  it('is empty rather than undefined when neither exists', () => {
    expect(getInputValue('tileKind')).toBe('');
  });
});

describe('show / hide', () => {
  it('sets and clears the display, and ignores a missing element', () => {
    mount('<div id="panel"></div>');
    const el = getEl('panel')!;

    show('panel');
    expect(el.style.display).toBe('flex');
    show('panel', 'block');
    expect(el.style.display).toBe('block');
    hide('panel');
    expect(el.style.display).toBe('none');

    expect(() => show('gone')).not.toThrow();
  });
});

describe('addEvent / removeEvent', () => {
  it('binds and unbinds by id, and ignores a missing element', () => {
    mount('<button id="go"></button>');
    const el = getEl('go')!;
    const handler = vi.fn();

    addEvent('go', 'click', handler);
    el.click();
    expect(handler).toHaveBeenCalledTimes(1);

    removeEvent('go', 'click', handler);
    el.click();
    expect(handler).toHaveBeenCalledTimes(1);

    expect(() => addEvent('gone', 'click', handler)).not.toThrow();
    expect(() => removeEvent('gone', 'click', handler)).not.toThrow();
  });
});

describe('safeParseInt', () => {
  it('falls back instead of returning NaN', () => {
    expect(safeParseInt('42')).toBe(42);
    expect(safeParseInt('12px')).toBe(12);
    expect(safeParseInt('')).toBe(0);
    expect(safeParseInt('abc', -1)).toBe(-1);
  });
});

describe('withLoading', () => {
  it('re-enables the button even when the work throws', async () => {
    mount('<button id="save"></button>');
    const btn = getEl<HTMLButtonElement>('save')!;

    await withLoading('save', () => Promise.resolve());
    expect(btn.disabled).toBe(false);

    await expect(
      withLoading('save', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(btn.disabled).toBe(false);
  });

  it('still runs the work when the button is not there', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    await withLoading('gone', fn);
    expect(fn).toHaveBeenCalled();
  });
});
