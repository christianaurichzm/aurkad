import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Modal, ModuleWindow } from './Modal';

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

  it('is one of three widths, with the counter beside the title', () => {
    render(
      <Modal title="Inventory" size="regular" counter="14/24" onClose={vi.fn()}>
        Bag
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Inventory' });
    expect(dialog).toHaveStyle({ width: '380px' });
    expect(dialog).toHaveClass('game-window');
    expect(screen.getByText('14/24')).toBeInTheDocument();
  });

  it('opens a sized window on its side of the world, clear of the middle', () => {
    const world = document.createElement('div');
    world.id = 'canvasFrame';
    world.getBoundingClientRect = () => new DOMRect(10, 70, 800, 600);
    document.body.append(world);
    render(
      <>
        <Modal title="Bag" size="narrow" onClose={vi.fn()}>
          -
        </Modal>
        <Modal title="Stats" size="narrow" anchor="right" onClose={vi.fn()}>
          -
        </Modal>
      </>,
    );

    expect(screen.getByRole('dialog', { name: 'Bag' })).toHaveStyle({
      left: '22px',
      top: '114px',
    });
    expect(screen.getByRole('dialog', { name: 'Stats' })).toHaveStyle({
      left: '518px',
    });
    world.remove();
  });

  it('keeps the footer out of the body that scrolls', () => {
    render(
      <Modal title="Bank" footer={<button>Deposit</button>} onClose={vi.fn()}>
        Vault
      </Modal>,
    );

    const footer = screen.getByRole('button', {
      name: 'Deposit',
    }).parentElement;
    expect(footer).toHaveClass('window-footer');
    expect(screen.getByText('Vault')).not.toContainElement(footer);
  });

  it('takes a width name from a module, and a number as pixels', () => {
    render(
      <>
        <ModuleWindow title="Guild" width="wide" onClose={vi.fn()}>
          -
        </ModuleWindow>
        <ModuleWindow title="Old" width={300} onClose={vi.fn()}>
          -
        </ModuleWindow>
      </>,
    );

    expect(screen.getByRole('dialog', { name: 'Guild' })).toHaveStyle({
      width: '560px',
    });
    const old = screen.getByRole('dialog', { name: 'Old' });
    expect(old).toHaveStyle({ width: '300px' });
    expect(old).not.toHaveClass('game-window');
  });

  it('brings a floating window to the front when it is pressed', async () => {
    render(
      <>
        <ModuleWindow title="First" onClose={vi.fn()}>
          First body
        </ModuleWindow>
        <ModuleWindow title="Second" onClose={vi.fn()}>
          Second body
        </ModuleWindow>
      </>,
    );
    const z = (name: string) =>
      Number(screen.getByRole('dialog', { name }).style.zIndex);
    expect(z('Second')).toBeGreaterThan(z('First'));

    await userEvent.click(screen.getByText('First body'));

    expect(z('First')).toBeGreaterThan(z('Second'));
  });
});
