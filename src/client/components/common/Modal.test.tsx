import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

describe('Modal', () => {
  it('closes with Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <Modal title="Settings" onClose={onClose}>
        <button>Inside</button>
      </Modal>,
    );

    expect(screen.getByText('Settings')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
