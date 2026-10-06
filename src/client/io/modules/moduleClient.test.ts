import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
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
const serve = (code: string | ((engine: Record<string, unknown>) => void)) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve([{ id: 'test', client: 'client.js' }]),
      }),
    ),
  );
  vi.doMock('/modules/test/client', () => ({
    default:
      typeof code === 'string'
        ? // eslint-disable-next-line @typescript-eslint/no-implied-eval
          new Function('engine', 'React', `'use strict';${code}`)
        : code,
  }));
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

describe('module toasts', () => {
  it('stack over the world, one under the other, and take themselves away', async () => {
    const frame = document.createElement('div');
    frame.id = 'canvasFrame';
    document.body.append(frame);
    serve(`
      for (const text of ['Achievement unlocked', 'Quest complete']) {
        const el = document.createElement('div');
        el.textContent = text;
        engine.ui.toast(el, 1000);
      }
    `);
    vi.useFakeTimers();
    try {
      await loadClientModules();
      const stacks = document.querySelectorAll('.module-toasts');
      expect(stacks).toHaveLength(1);
      expect([...stacks[0].children].map((c) => c.textContent)).toEqual([
        'Achievement unlocked',
        'Quest complete',
      ]);
      vi.advanceTimersByTime(1400);
      expect(stacks[0].children).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('follows the frame when the window is resized under a notice', async () => {
    const frame = document.createElement('div');
    frame.id = 'canvasFrame';
    document.body.append(frame);
    let left = 100;
    frame.getBoundingClientRect = () =>
      ({ left, top: 0, width: 400, height: 300 }) as DOMRect;
    serve(`engine.ui.notice('Quest complete');`);
    await loadClientModules();
    const stack = document.querySelector<HTMLElement>('.module-toasts')!;
    expect(stack.style.left).toBe('300px');

    left = 0;
    window.dispatchEvent(new Event('resize'));

    expect(stack.style.left).toBe('200px');
  });

  it('draws a notice in the stylesheet look, painted by its tone and translated', async () => {
    const frame = document.createElement('div');
    frame.id = 'canvasFrame';
    document.body.append(frame);
    serve(`
      engine.i18n({ pt: { 'Quest complete': 'Missão cumprida' } });
      engine.ui.notice('Quest complete', { tone: 'warning', label: 'Quests', detail: '+50 XP' });
    `);
    setLanguage('pt');
    await loadClientModules();
    const notice = document.querySelector<HTMLElement>(
      '.module-toasts > .notice',
    );
    expect(notice?.dataset.tone).toBe('warning');
    expect(notice?.getAttribute('style')).toBeNull();
    expect(notice?.querySelector('.notice-label')?.textContent).toBe('Quests');
    expect(notice?.querySelector('.notice-detail')?.textContent).toBe('+50 XP');
    expect(notice?.textContent).toBe('QuestsMissão cumprida+50 XP');
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

// A module's client half is plain JavaScript, so the declaration file is all
// the editor and typecheck know of the engine. A member missing there can't
// be called without an error; a stale one typechecks and then throws.
describe('the engine a module is handed', () => {
  /** Member names of a type literal or interface in clientEngine.d.ts. */
  function declared(
    pick: (s: ts.Statement) => ts.NodeArray<ts.TypeElement> | undefined,
  ) {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'modules/clientEngine.d.ts'),
      'utf8',
    );
    const file = ts.createSourceFile('e.d.ts', source, ts.ScriptTarget.Latest);
    const members = file.statements.map(pick).find(Boolean) ?? [];
    const names = members.flatMap((m) =>
      m.name && ts.isIdentifier(m.name) ? [m.name.text] : [],
    );
    return [...new Set(names)].sort();
  }

  async function handedEngine(): Promise<Record<string, unknown>> {
    let handed: Record<string, unknown> = {};
    serve((engine) => (handed = engine));
    await loadClientModules();
    return handed;
  }

  it('is what the declaration file says it is', async () => {
    const engine = await handedEngine();
    const members = declared((s) => {
      if (!ts.isVariableStatement(s)) return undefined;
      const d = s.declarationList.declarations[0];
      return d &&
        ts.isIdentifier(d.name) &&
        d.name.text === 'engine' &&
        d.type &&
        ts.isTypeLiteralNode(d.type)
        ? d.type.members
        : undefined;
    });

    expect(Object.keys(engine).sort()).toEqual(members);
  });

  it('hands over the ui toolkit the declaration file describes', async () => {
    const engine = await handedEngine();
    const members = declared((s) =>
      ts.isInterfaceDeclaration(s) && s.name.text === 'ModuleUi'
        ? s.members
        : undefined,
    );

    expect(Object.keys(engine.ui as object).sort()).toEqual(members);
  });
});
