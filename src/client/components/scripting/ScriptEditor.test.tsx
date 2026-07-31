import { useEffect, useRef } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listScripts: vi.fn(),
  getScript: vi.fn(),
  saveScript: vi.fn(),
  createScript: vi.fn(),
  deleteScript: vi.fn(),
  getScriptTypes: vi.fn(),
  getScriptErrors: vi.fn(),
}));

vi.mock('../../io/network', () => ({
  listScripts: mocks.listScripts,
  getScript: mocks.getScript,
  saveScript: mocks.saveScript,
  createScript: mocks.createScript,
  deleteScript: mocks.deleteScript,
  getScriptTypes: mocks.getScriptTypes,
  getScriptErrors: mocks.getScriptErrors,
}));

vi.mock('monaco-editor', () => ({
  languages: {
    typescript: {
      javascriptDefaults: {
        setCompilerOptions: vi.fn(),
        addExtraLib: vi.fn(),
      },
      ScriptTarget: { ESNext: 99 },
    },
  },
  editor: {
    getModels: () => [],
    getModel: () => null,
    setModelMarkers: vi.fn(),
  },
  Uri: { parse: (v: string) => v },
  MarkerSeverity: { Error: 8 },
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { KeyS: 49 },
}));

// Holds the keybinding the component registers, so tests can fire it.
const commands = vi.hoisted(() => ({ current: null as null | (() => void) }));

// Stands in for the Monaco widget, which does not run in jsdom; a textarea
// is enough to exercise ScriptEditor's own state. onMount fires once, as the
// real editor does (switching files swaps the model, not the editor).
vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  loader: { config: vi.fn() },
  default: function MockEditor({
    value,
    onChange,
    onMount,
  }: {
    value: string;
    onChange?: (v: string) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
  }) {
    const mounted = useRef(false);
    useEffect(() => {
      if (mounted.current) return;
      mounted.current = true;
      onMount?.(
        {
          addCommand: (_key: number, handler: () => void) => {
            commands.current = handler;
          },
        },
        {},
      );
    });
    return (
      <textarea
        data-testid="editor"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
    );
  },
}));

import { ScriptEditor } from './ScriptEditor';

beforeEach(() => {
  vi.clearAllMocks();
  commands.current = null;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  mocks.getScriptTypes.mockResolvedValue({ globalDts: '', contentDts: '' });
  mocks.getScriptErrors.mockResolvedValue([]);
  mocks.listScripts.mockResolvedValue([
    { name: 'a.js', size: 1, mtimeMs: 0 },
    { name: 'b.js', size: 1, mtimeMs: 0 },
  ]);
});

describe('ScriptEditor', () => {
  // With the editor disabled the routes 404, which must read as switched
  // off, not as an empty file list.
  it('says the editor is switched off instead of showing nothing', async () => {
    mocks.listScripts.mockRejectedValue({ status: 404 });
    render(<ScriptEditor />);

    expect(
      await screen.findByText(/SCRIPT_EDITOR_ENABLED/),
    ).toBeInTheDocument();
  });

  it('does not blame the setting for an unrelated failure', async () => {
    mocks.listScripts.mockRejectedValue({ status: 500 });
    render(<ScriptEditor />);

    await waitFor(() => expect(mocks.listScripts).toHaveBeenCalled());
    expect(screen.queryByText(/SCRIPT_EDITOR_ENABLED/)).not.toBeInTheDocument();
  });

  it('lists script files', async () => {
    render(<ScriptEditor />);
    expect(await screen.findByText('a.js')).toBeInTheDocument();
    expect(screen.getByText('b.js')).toBeInTheDocument();
  });

  it('loads a file into the editor on click', async () => {
    mocks.getScript.mockResolvedValue('console.log("a");');
    render(<ScriptEditor />);

    fireEvent.click(await screen.findByText('a.js'));

    expect(mocks.getScript).toHaveBeenCalledWith('a.js');
    await waitFor(() =>
      expect(screen.getByTestId('editor')).toHaveValue('console.log("a");'),
    );
  });

  it('saves edited content and shows a status message', async () => {
    mocks.getScript.mockResolvedValue('console.log(1);');
    mocks.saveScript.mockResolvedValue(true);
    render(<ScriptEditor />);

    fireEvent.click(await screen.findByText('a.js'));
    await waitFor(() =>
      expect(screen.getByTestId('editor')).toHaveValue('console.log(1);'),
    );

    fireEvent.change(screen.getByTestId('editor'), {
      target: { value: 'console.log(2);' },
    });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(mocks.saveScript).toHaveBeenCalledWith('a.js', 'console.log(2);'),
    );
    expect(await screen.findByText('Saved · hot-reloaded')).toBeInTheDocument();
  });

  it('shows a failure message when saving fails', async () => {
    mocks.getScript.mockResolvedValue('x');
    mocks.saveScript.mockResolvedValue(false);
    render(<ScriptEditor />);

    fireEvent.click(await screen.findByText('a.js'));
    await waitFor(() => expect(screen.getByTestId('editor')).toHaveValue('x'));
    fireEvent.change(screen.getByTestId('editor'), {
      target: { value: 'y' },
    });
    fireEvent.click(screen.getByText('Save'));

    expect(await screen.findByText('Save failed.')).toBeInTheDocument();
  });

  it('creates a new file and selects it', async () => {
    mocks.createScript.mockResolvedValue(true);
    mocks.getScript.mockResolvedValue('');
    render(<ScriptEditor />);

    await screen.findByText('a.js');
    fireEvent.change(screen.getByPlaceholderText('new-script.js'), {
      target: { value: 'quest' },
    });
    fireEvent.click(screen.getByText('+ New'));

    await waitFor(() =>
      expect(mocks.createScript).toHaveBeenCalledWith('quest.js'),
    );
  });

  it('deletes a file after confirmation', async () => {
    mocks.deleteScript.mockResolvedValue(true);
    render(<ScriptEditor />);

    await screen.findByText('a.js');
    fireEvent.click(screen.getAllByTitle('Delete')[0]);

    await waitFor(() =>
      expect(mocks.deleteScript).toHaveBeenCalledWith('a.js'),
    );
  });

  it('does not delete when the confirmation is dismissed', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<ScriptEditor />);

    await screen.findByText('a.js');
    fireEvent.click(screen.getAllByTitle('Delete')[0]);

    expect(mocks.deleteScript).not.toHaveBeenCalled();
  });

  // The keybinding is registered once on mount, so it must not save the file
  // as it was when opened.
  it('Ctrl+S saves content typed after the editor mounted', async () => {
    mocks.getScript.mockResolvedValue('original');
    mocks.saveScript.mockResolvedValue(true);
    render(<ScriptEditor />);

    fireEvent.click(await screen.findByText('a.js'));
    await waitFor(() =>
      expect(screen.getByTestId('editor')).toHaveValue('original'),
    );

    fireEvent.change(screen.getByTestId('editor'), {
      target: { value: 'edited after mount' },
    });

    expect(commands.current).toBeTypeOf('function');
    commands.current!();

    await waitFor(() =>
      expect(mocks.saveScript).toHaveBeenCalledWith(
        'a.js',
        'edited after mount',
      ),
    );
  });
});

describe('runtime error reporting', () => {
  const failure = {
    script: 'a.js',
    message: 'TypeError: x is not a function',
    line: 12,
    column: 3,
    source: 'hook' as const,
    context: 'playerJoin',
    at: Date.now(),
    count: 1,
  };

  it('marks a file that has failed, so a broken script is visible unopened', async () => {
    mocks.getScriptErrors.mockResolvedValue([failure]);
    render(<ScriptEditor />);

    expect(await screen.findByText(/⚠\s*a\.js/)).toBeInTheDocument();
    expect(screen.getByText('b.js')).toBeInTheDocument();
    expect(screen.queryByText(/⚠\s*b\.js/)).not.toBeInTheDocument();
  });

  it('lists the failures of the open file with their line and hook', async () => {
    mocks.getScriptErrors.mockResolvedValue([failure]);
    mocks.getScript.mockResolvedValue('// code');
    render(<ScriptEditor />);

    fireEvent.click(await screen.findByText(/a\.js/));

    expect(await screen.findByText('Runtime errors (1)')).toBeInTheDocument();
    expect(
      screen.getByText('TypeError: x is not a function'),
    ).toBeInTheDocument();
    expect(screen.getByText(/line 12 · playerJoin/)).toBeInTheDocument();
  });

  it('shows the repeat count for a failure that keeps happening', async () => {
    mocks.getScriptErrors.mockResolvedValue([{ ...failure, count: 240 }]);
    mocks.getScript.mockResolvedValue('// code');
    render(<ScriptEditor />);

    fireEvent.click(await screen.findByText(/a\.js/));

    expect(await screen.findByText(/x240/)).toBeInTheDocument();
  });

  it('does not show another file’s failures', async () => {
    mocks.getScriptErrors.mockResolvedValue([{ ...failure, script: 'b.js' }]);
    mocks.getScript.mockResolvedValue('// code');
    render(<ScriptEditor />);

    fireEvent.click(await screen.findByText(/a\.js/));
    await screen.findByTestId('editor');

    expect(screen.queryByText(/Runtime errors/)).not.toBeInTheDocument();
  });

  it('hides the panel entirely when nothing has failed', async () => {
    mocks.getScript.mockResolvedValue('// code');
    render(<ScriptEditor />);

    fireEvent.click(await screen.findByText('a.js'));
    await screen.findByTestId('editor');

    expect(screen.queryByText(/Runtime errors/)).not.toBeInTheDocument();
  });

  // A syntax error appears only once the watcher reloads the file, which
  // follows the save response.
  it('re-checks for errors after a save', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.getScript.mockResolvedValue('x');
    mocks.saveScript.mockResolvedValue(true);
    render(<ScriptEditor />);

    fireEvent.click(await screen.findByText('a.js'));
    fireEvent.change(await screen.findByTestId('editor'), {
      target: { value: 'x = 1;' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(mocks.saveScript).toHaveBeenCalled());
    const before = mocks.getScriptErrors.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);

    expect(mocks.getScriptErrors.mock.calls.length).toBeGreaterThan(before);
    vi.useRealTimers();
  });
});
