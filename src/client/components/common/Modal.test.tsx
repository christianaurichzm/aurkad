import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

describe('Modal', () => {
  it('names the dialog, contains keyboard focus and restores the opener', async () => {
    const user = userEvent.setup();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(
      <Modal title="Settings" onClose={vi.fn()}>
        <button>Inside</button>
        <button disabled>Unavailable</button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog).toHaveFocus();
    // Layout is supplied by the browser in production.
    const rects = vi
      .spyOn(HTMLElement.prototype, 'getClientRects')
      .mockReturnValue(
        Object.assign([new DOMRect()], { item: () => new DOMRect() }),
      );
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.getByRole('button', { name: 'Inside' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    rects.mockRestore();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('closes only the topmost dialog on one Escape', async () => {
    const lower = vi.fn();
    const top = vi.fn();
    render(
      <>
        <Modal title="Inventory" onClose={lower}>
          Bag
        </Modal>
        <Modal title="Shop" onClose={top}>
          Wares
        </Modal>
      </>,
    );
    await userEvent.keyboard('{Escape}');
    expect(top).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
  });

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
