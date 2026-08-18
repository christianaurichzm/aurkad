import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PasswordReset } from './PasswordReset';

const mocks = vi.hoisted(() => ({ confirmPasswordReset: vi.fn() }));

vi.mock('../io/network', () => ({
  confirmPasswordReset: mocks.confirmPasswordReset,
  httpError: (e: unknown) => (e as { message?: string }) ?? {},
}));

const fill = async (password: string, repeat: string) => {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText('New password'), password);
  await user.type(
    screen.getByPlaceholderText('Repeat the new password'),
    repeat,
  );
  await user.click(screen.getByRole('button', { name: 'Save' }));
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirmPasswordReset.mockResolvedValue({ success: true });
});

describe('the screen a reset link opens', () => {
  it('sends the token with the new password', async () => {
    render(<PasswordReset token="tok-123" onDone={vi.fn()} />);

    await fill('long-enough-password', 'long-enough-password');

    expect(mocks.confirmPasswordReset).toHaveBeenCalledWith(
      'tok-123',
      'long-enough-password',
    );
    expect(screen.getByText(/you can log in now/i)).toBeInTheDocument();
  });

  // Both checks happen before the round trip, so a typo costs nothing and the
  // server is not asked to rule on a password the player cannot have meant.
  it('refuses two passwords that differ, without asking the server', async () => {
    render(<PasswordReset token="tok-123" onDone={vi.fn()} />);

    await fill('long-enough-password', 'long-enough-passwerd');

    expect(mocks.confirmPasswordReset).not.toHaveBeenCalled();
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
  });

  it('refuses one that is too short', async () => {
    render(<PasswordReset token="tok-123" onDone={vi.fn()} />);

    await fill('short', 'short');

    expect(mocks.confirmPasswordReset).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it('shows what the server said when the link is spent', async () => {
    mocks.confirmPasswordReset.mockRejectedValue({
      message: 'That link is no longer valid',
    });
    render(<PasswordReset token="old" onDone={vi.fn()} />);

    await fill('long-enough-password', 'long-enough-password');

    expect(screen.getByText(/no longer valid/i)).toBeInTheDocument();
  });
});
