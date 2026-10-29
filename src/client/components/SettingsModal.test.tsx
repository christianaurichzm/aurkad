import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAudioSettings, setAudioSettings } from '../audio';
import { changePassword } from '../io/network';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { SettingsModal } from './SettingsModal';

vi.mock('../io/network', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../io/network')>()),
  changePassword: vi.fn(),
}));

const open = () => {
  render(<SettingsModal />);
  act(() => {
    window.dispatchEvent(new Event('toggleSettings'));
  });
};

describe('SettingsModal', () => {
  beforeEach(() => {
    localStorage.clear();
    setAudioSettings({ music: 0.4, effects: 0.6, muted: false });
  });

  it('stays closed until the toggle event fires', () => {
    render(<SettingsModal />);
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });

  it('applies and persists a volume change', () => {
    open();

    // userEvent has no gesture for a range input; the change event is what the
    // browser emits when the thumb moves.
    fireEvent.change(screen.getByLabelText('Music'), {
      target: { value: '0.15' },
    });

    expect(getAudioSettings().music).toBe(0.15);
    expect(localStorage.getItem('audio')).toContain('0.15');
    expect(screen.getByText('15%')).toBeInTheDocument();
  });

  it('mutes from the checkbox and disables the sliders', async () => {
    open();

    await userEvent.click(screen.getByLabelText('Mute everything'));

    expect(getAudioSettings().muted).toBe(true);
    expect(screen.getByLabelText('Music')).toBeDisabled();
  });

  it('asks for the new password twice before changing it', async () => {
    open();

    await userEvent.type(
      screen.getByPlaceholderText('Current password'),
      'old',
    );
    await userEvent.type(
      screen.getByPlaceholderText('New password'),
      'longenough1',
    );
    await userEvent.type(
      screen.getByPlaceholderText('Repeat the new password'),
      'longenough2',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Change password' }),
    );

    expect(screen.getByText('The two passwords do not match.')).toBeTruthy();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('stays closed on the Escape that closes another panel', async () => {
    const Panel = ({ onClose }: { onClose: () => void }) => {
      useEscapeClose(true, onClose);
      return <div>Panel</div>;
    };

    let closed = false;
    render(
      <>
        <SettingsModal />
        <Panel onClose={() => (closed = true)} />
      </>,
    );

    await userEvent.keyboard('{Escape}');

    expect(closed).toBe(true);
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });
});
