import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TwoFactorPanel } from './TwoFactorPanel';

const mocks = vi.hoisted(() => ({
  fetchTwoFactor: vi.fn(),
  beginTwoFactor: vi.fn(),
  confirmTwoFactor: vi.fn(),
  removeTwoFactor: vi.fn(),
}));

vi.mock('../../io/network', () => ({
  ...mocks,
  friendlyHttpError: (e: { message?: string }) => e?.message ?? 'failed',
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchTwoFactor.mockResolvedValue({ enabled: false, recoveryLeft: 0 });
});

describe('TwoFactorPanel', () => {
  it('walks an enrollment from password to printed codes', async () => {
    mocks.beginTwoFactor.mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUrl: 'otpauth://totp/host:Boss?secret=JBSWY3DPEHPK3PXP',
    });
    mocks.confirmTwoFactor.mockResolvedValue({
      recoveryCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'],
    });
    const user = userEvent.setup();
    render(<TwoFactorPanel />);

    await user.click(await screen.findByRole('button', { name: 'Set up' }));
    await user.type(screen.getByPlaceholderText('Current password'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Set up' }));

    // The secret is on screen for the app to read, and nothing is stored yet.
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(mocks.beginTwoFactor).toHaveBeenCalledWith('pw');

    await user.type(
      screen.getByPlaceholderText('Authentication code'),
      '123456',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(mocks.confirmTwoFactor).toHaveBeenCalledWith('123456');
    expect(await screen.findByText('AAAAA-BBBBB')).toBeInTheDocument();
    expect(screen.getByText('CCCCC-DDDDD')).toBeInTheDocument();
  });

  it('says what the server said when the password is refused', async () => {
    mocks.beginTwoFactor.mockRejectedValue({
      status: 403,
      message: 'Current password is wrong',
    });
    const user = userEvent.setup();
    render(<TwoFactorPanel />);

    await user.click(await screen.findByRole('button', { name: 'Set up' }));
    await user.type(screen.getByPlaceholderText('Current password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Set up' }));

    expect(
      await screen.findByText('Current password is wrong'),
    ).toBeInTheDocument();
  });

  it('asks for both halves to turn it off, and warns when codes run low', async () => {
    mocks.fetchTwoFactor.mockResolvedValue({ enabled: true, recoveryLeft: 2 });
    mocks.removeTwoFactor.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<TwoFactorPanel />);

    expect(
      await screen.findByText('On. 2 recovery codes left.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Few recovery codes left. Turn it off and set it up again for a new sheet.',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    await user.type(screen.getByPlaceholderText('Current password'), 'pw');
    await user.type(
      screen.getByPlaceholderText('Authentication code'),
      '123456',
    );
    await user.click(screen.getByRole('button', { name: 'Turn off' }));

    expect(mocks.removeTwoFactor).toHaveBeenCalledWith('pw', '123456');
  });
});
