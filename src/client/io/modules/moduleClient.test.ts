import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// First, for its side effect: customEvents and wsManager import each other
// and gameStateSync subscribes at module scope, so load order decides
// whether that subscribe finds an initialized map. The app reaches wsManager
// first; a test importing moduleClient alone would hit a TDZ error.
import '../network/wsManager';
import { loadClientModules } from './moduleClient';
import { setLanguage } from '../../i18n';
import { escapeClaimed } from '../../hooks/useEscapeClose';

/**
 * The browser half of a module, loaded the way the real loader loads it.
 *
 * Tests that a language switch reaches text a module already drew. The table
 * arrives at runtime, after the React tree `useT` re-renders, so the toolkit
 * stamps the English on each element for the switch to re-apply. Only a real
 * DOM shows that this holds.
 */
const serve = (code: string) => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve({
        json: () => Promise.resolve([{ id: 'test', client: 'client.js' }]),
        text: () => Promise.resolve(url.endsWith('/client') ? code : ''),
      }),
    ),
  );
};

beforeEach(() => {
  setLanguage('en');
  document.body.innerHTML = '';
});

afterEach(() => {
  document
    .querySelectorAll<HTMLButtonElement>('.module-panel .window-close')
    .forEach((b) => b.click());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('module panels', () => {
  it('closes the top module panel, consumes Escape and restores focus', async () => {
    serve(`
      const first = engine.ui.panel({ title: 'Party' });
      const second = engine.ui.panel({ title: 'Invite' });
      first.show(); second.show();
    `);
    await loadClientModules();
    const panels = document.querySelectorAll<HTMLElement>('.module-panel');
    expect(document.activeElement).toBe(panels[1]);
    const key = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    expect(panels[1].style.display).toBe('none');
    expect(panels[0].style.display).toBe('flex');
    expect(document.activeElement).toBe(panels[0]);
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }),
    );
    expect(escapeClaimed()).toBe(false);
  });
});

describe('module client strings', () => {
  it('translates a panel title and follows a language switch', async () => {
    serve(`
      engine.i18n({ pt: { Guild: 'Guilda' } });
      const panel = engine.ui.panel({ title: 'Guild' });
      panel.show();
    `);

    await loadClientModules();

    expect(document.body.textContent).toContain('Guild');

    setLanguage('pt');

    expect(document.body.textContent).toContain('Guilda');
  });

  it('keeps the English a module ships no table for', async () => {
    serve(`
      engine.i18n({ pt: { Guild: 'Guilda' } });
      engine.ui.panel({ title: 'Leave Guild' }).show();
    `);

    await loadClientModules();
    setLanguage('pt');

    expect(document.body.textContent).toContain('Leave Guild');
  });

  it('translates an input placeholder the same way', async () => {
    serve(`
      engine.i18n({ pt: { 'Guild name': 'Nome da guilda' } });
      const panel = engine.ui.panel();
      panel.setBody(engine.ui.input('Guild name'));
      panel.show();
    `);

    await loadClientModules();
    setLanguage('pt');

    expect(document.querySelector('input')?.getAttribute('placeholder')).toBe(
      'Nome da guilda',
    );
  });
});
