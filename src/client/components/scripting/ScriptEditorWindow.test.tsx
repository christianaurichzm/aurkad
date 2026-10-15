import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Access } from '../../../shared/types';
import { ScriptEditorWindow } from './ScriptEditorWindow';

const mocks = vi.hoisted(() => ({
  useGame: vi.fn(),
  usePlayerForceUpdate: vi.fn(),
}));

vi.mock('../../GameContext', () => ({ useGame: mocks.useGame }));
vi.mock('../../hooks/usePlayerForceUpdate', () => ({
  usePlayerForceUpdate: mocks.usePlayerForceUpdate,
}));

// Monaco stands aside: an editor holding unsaved edits to one file.
vi.mock('./ScriptEditor', async () => {
  const { useEffect } = await import('react');
  return {
    ScriptEditor: ({
      onDirtyChange,
    }: {
      onDirtyChange?: (file: string | null) => void;
    }) => {
      useEffect(() => {
        onDirtyChange?.('rules.js');
      }, [onDirtyChange]);
      return <div>editor</div>;
    },
  };
});

const setAccess = (access: Access) => {
  mocks.useGame.mockReturnValue({ player: { access } });
  mocks.usePlayerForceUpdate.mockReturnValue(null);
};

// What the creator tools' Scripts button sends.
const toggle = () =>
  act(() => {
    window.dispatchEvent(new Event('toggleScriptEditor'));
  });

describe('ScriptEditorWindow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('asks before closing over unsaved edits, by the button or the toggle', async () => {
    setAccess(Access.ADMIN);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ScriptEditorWindow />);

    toggle();
    expect(await screen.findByText('editor')).toBeInTheDocument();

    toggle();
    expect(confirm).toHaveBeenCalledWith(
      'Discard unsaved changes to rules.js?',
    );
    expect(screen.getByText('editor')).toBeInTheDocument();

    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('editor')).not.toBeInTheDocument();
  });

  it('does not open below ADMIN', () => {
    setAccess(Access.MOD);
    render(<ScriptEditorWindow />);

    toggle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
