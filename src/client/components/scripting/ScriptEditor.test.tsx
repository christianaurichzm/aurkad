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
}));

vi.mock('../../io/network', () => ({
  listScripts: mocks.listScripts,
  getScript: mocks.getScript,
  saveScript: mocks.saveScript,
  createScript: mocks.createScript,
  deleteScript: mocks.deleteScript,
  getScriptTypes: mocks.getScriptTypes,
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
  editor: { getModels: () => [] },
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
  mocks.listScripts.mockResolvedValue([
    { name: 'a.js', size: 1, mtimeMs: 0 },
    { name: 'b.js', size: 1, mtimeMs: 0 },
  ]);
});

describe('ScriptEditor', () => {
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
    fireEvent.click(screen.getAllByTitle('Delete')[0]!);

    await waitFor(() =>
      expect(mocks.deleteScript).toHaveBeenCalledWith('a.js'),
    );
  });

  it('does not delete when the confirmation is dismissed', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<ScriptEditor />);

    await screen.findByText('a.js');
    fireEvent.click(screen.getAllByTitle('Delete')[0]!);

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
